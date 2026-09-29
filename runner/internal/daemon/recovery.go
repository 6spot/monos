package daemon

import (
	"context"
	"fmt"
	"reflect"
	"sort"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
)

type recoveryBatch struct {
	ctx        context.Context
	ready      bool
	operations []protocol.Operation
}

// A recovery state is not another admission. It authorizes reconciliation of the
// same immutable effect, using its retained local failure or terminal result.
func (d *Daemon) retainedRecovery(op protocol.Operation) (bool, error) {
	result, err := d.DB.Effect(op.OperationID)
	if err != nil || result == nil {
		return false, err
	}
	if result.OperationID != op.OperationID || result.AttemptID != op.AttemptID {
		return false, fmt.Errorf("retained recovery result scope mismatch")
	}
	// Older persisted failures may omit their classification. A missing result
	// is different: it supplies no evidence and was excluded above.
	if !result.Success && result.CancelledByOperationID == nil && result.FailureKind != nil && *result.FailureKind != protocol.Recoverable {
		return false, nil
	}
	if err = d.DB.BeginEffect(op); err != nil {
		return false, err
	}
	start, err := d.DB.Start(op.AttemptID)
	if err != nil {
		return false, err
	}
	if err = host.ValidateEffectScope(start.Dispatch, op); err != nil {
		return false, err
	}
	return true, nil
}

func (d *Daemon) prepareRecovery(ctx context.Context, inventory protocol.RunnerInventory, dispatches map[string]protocol.Dispatch) error {
	operations := []protocol.Operation{}
	seen := map[string]protocol.Operation{}
	for _, op := range inventory.Operations {
		if op.State != protocol.Recovery || op.Workspace == nil {
			continue
		}
		if prior, exists := seen[op.OperationID]; exists {
			if !reflect.DeepEqual(prior, op) {
				return fmt.Errorf("conflicting recovery inventory operation")
			}
			continue
		}
		seen[op.OperationID] = op
		dispatch, exists := dispatches[op.AttemptID]
		if !exists {
			return fmt.Errorf("recovery operation has no inventory dispatch")
		}
		if err := host.ValidateEffectScope(dispatch, op); err != nil {
			return err
		}
		eligible, err := d.retainedRecovery(op)
		if err != nil {
			return err
		}
		if eligible {
			operations = append(operations, op)
		}
	}
	// Stop owns cancellation/checkpointing of its earlier open. Let settlement
	// reach the existing fence/worker rules before filling slots with fetches.
	sort.SliceStable(operations, func(i, j int) bool {
		return operations[i].Kind == protocol.Stop && operations[j].Kind != protocol.Stop
	})
	batch := &recoveryBatch{ctx: ctx, operations: operations}
	d.queueMu.Lock()
	d.recovery = batch
	d.queueMu.Unlock()
	context.AfterFunc(ctx, func() {
		d.queueMu.Lock()
		if d.recovery == batch {
			d.recovery = nil
		}
		d.queueMu.Unlock()
	})
	return nil
}

// Called only after the Ready frame has been sent on this connection. Inventory
// validation alone must not send results or start recovered effects before Ready.
func (d *Daemon) ConnectionReady(ctx context.Context) {
	d.queueMu.Lock()
	defer d.queueMu.Unlock()
	if d.recovery == nil || d.recovery.ctx.Done() != ctx.Done() || ctx.Err() != nil {
		return
	}
	d.recovery.ready = true
	d.drainRecoveryLocked()
}

// Use the existing single-flight queue, retaining overflow and keys still held
// by a cancelled connection. Slot release drains the remainder; failed effects
// are not reinserted or retried on heartbeat ticks.
func (d *Daemon) drainRecoveryLocked() {
	batch := d.recovery
	if batch == nil || !batch.ready {
		return
	}
	if batch.ctx.Err() != nil {
		d.recovery = nil
		return
	}
	pending := batch.operations[:0]
	for _, op := range batch.operations {
		if !d.enqueueLocked(batch.ctx, "workspace:"+op.OperationID, func() error {
			// An older connection may have finished while this entry waited for
			// its key. Recheck hard failures and scope; effect replays terminal
			// results without invoking the host or replacing immutable bytes.
			eligible, err := d.retainedRecovery(op)
			if err != nil || !eligible {
				return err
			}
			return d.effect(batch.ctx, op)
		}) {
			pending = append(pending, op)
		}
	}
	batch.operations = pending
}
