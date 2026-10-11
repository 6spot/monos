package daemon

import (
	"context"
	"encoding/json"
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
	dispatches map[string]protocol.Dispatch
}

// A recovery state is not another admission. It authorizes reconciliation of the
// same immutable effect, using its retained local failure or terminal result.
func (d *Daemon) retainedRecovery(op protocol.Operation, dispatch protocol.Dispatch) (bool, error) {
	result, err := d.DB.Effect(op.OperationID)
	if err != nil || result == nil && op.Inspection == nil {
		return false, err
	}
	if result != nil && (result.OperationID != op.OperationID || result.AttemptID != op.AttemptID) {
		return false, fmt.Errorf("retained recovery result scope mismatch")
	}
	// Older persisted failures may omit their classification. A missing result
	// is different: it supplies no evidence and was excluded above.
	if result != nil && !result.Success && result.CancelledByOperationID == nil && result.FailureKind != nil && *result.FailureKind != protocol.Recoverable {
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
	if op.Inspection != nil {
		retained, remote := start.Dispatch, dispatch
		remote.MutationAllowed, remote.ProcessReleased = retained.MutationAllowed, retained.ProcessReleased
		if !reflect.DeepEqual(retained, remote) || dispatch.ProcessReleased && (result == nil || !result.Success) {
			return false, fmt.Errorf("inspection recovery source changed")
		}
		return true, nil
	}
	if dispatch.NodeExecutionSource != nil || start.Dispatch.NodeExecutionSource != nil {
		if dispatch.NodeExecutionSource == nil || dispatch.MutationAllowed || dispatch.ProcessReleased || !reflect.DeepEqual(start.Dispatch.TaskID, dispatch.TaskID) || !reflect.DeepEqual(start.Dispatch.NodeExecutionSource, dispatch.NodeExecutionSource) || !reflect.DeepEqual(start.Dispatch.WorkspaceReservations, dispatch.WorkspaceReservations) {
			return false, fmt.Errorf("Node recovery source or authorization changed")
		}
	} else if dispatch.TaskConversationSource != nil || start.Dispatch.TaskConversationSource != nil {
		if dispatch.TaskConversationSource == nil || dispatch.MutationAllowed || dispatch.ProcessReleased || !reflect.DeepEqual(start.Dispatch.TaskID, dispatch.TaskID) || !reflect.DeepEqual(start.Dispatch.TaskConversationSource, dispatch.TaskConversationSource) || !reflect.DeepEqual(start.Dispatch.WorkspaceReservations, dispatch.WorkspaceReservations) {
			return false, fmt.Errorf("Task conversation recovery source or authorization changed")
		}
	} else if dispatch.TaskReviewSource != nil || start.Dispatch.TaskReviewSource != nil {
		if dispatch.TaskReviewSource == nil || dispatch.MutationAllowed || dispatch.ProcessReleased || !reflect.DeepEqual(start.Dispatch.TaskID, dispatch.TaskID) || !reflect.DeepEqual(start.Dispatch.TaskReviewSource, dispatch.TaskReviewSource) || !reflect.DeepEqual(start.Dispatch.WorkspaceReservations, dispatch.WorkspaceReservations) {
			return false, fmt.Errorf("Task review recovery source or authorization changed")
		}
	} else if dispatch.TaskReplanSource != nil || start.Dispatch.TaskReplanSource != nil {
		if dispatch.TaskReplanSource == nil || dispatch.MutationAllowed || dispatch.ProcessReleased || !reflect.DeepEqual(start.Dispatch.TaskID, dispatch.TaskID) || !reflect.DeepEqual(start.Dispatch.TaskReplanSource, dispatch.TaskReplanSource) || !reflect.DeepEqual(start.Dispatch.WorkspaceReservations, dispatch.WorkspaceReservations) {
			return false, fmt.Errorf("Task Replan recovery source or authorization changed")
		}
	} else if op.Workspace == nil {
		if dispatch.TaskPlanningSource == nil || dispatch.MutationAllowed || dispatch.ProcessReleased ||
			!reflect.DeepEqual(start.Dispatch.TaskID, dispatch.TaskID) ||
			!reflect.DeepEqual(start.Dispatch.TaskPlanningSource, dispatch.TaskPlanningSource) {
			return false, fmt.Errorf("initial planning recovery source or authorization changed")
		}
	}
	return true, nil
}

func (d *Daemon) prepareRecovery(ctx context.Context, inventory protocol.RunnerInventory, dispatches map[string]protocol.Dispatch) error {
	operations := []protocol.Operation{}
	retainedDispatches := map[string]protocol.Dispatch{}
	seen := map[string]protocol.Operation{}
	for _, op := range inventory.Operations {
		if op.State != protocol.PurpleRecovery {
			continue
		}
		dispatch, exists := dispatches[op.AttemptID]
		// Only exact source-bound terminal effects gain repository-free replay.
		nodeFree := dispatch.NodeExecutionSource != nil && (op.Kind == protocol.Stop || op.Kind == protocol.KindCompleteNode && op.Workspaces != nil || op.Kind == protocol.SettleCompletion)
		conversationStop := dispatch.TaskConversationSource != nil && op.Kind == protocol.Stop
		if op.Inspection == nil && op.Workspace == nil && !nodeFree && !conversationStop && (op.Kind != protocol.Stop || dispatch.TaskPlanningSource == nil && dispatch.TaskReplanSource == nil && dispatch.TaskReviewSource == nil) {
			continue
		}
		if prior, exists := seen[op.OperationID]; exists {
			if !reflect.DeepEqual(prior, op) {
				return fmt.Errorf("conflicting recovery inventory operation")
			}
			continue
		}
		seen[op.OperationID] = op
		if !exists {
			return fmt.Errorf("recovery operation has no inventory dispatch")
		}
		if err := host.ValidateEffectScope(dispatch, op); err != nil {
			return err
		}
		eligible, err := d.retainedRecovery(op, dispatch)
		if err != nil {
			return err
		}
		if eligible {
			operations = append(operations, op)
			raw, e := json.Marshal(dispatch)
			if e != nil {
				return e
			}
			var frozen protocol.Dispatch
			if e = json.Unmarshal(raw, &frozen); e != nil {
				return e
			}
			retainedDispatches[op.AttemptID] = frozen
		}
	}
	// Stop owns cancellation/checkpointing of its earlier open. Let settlement
	// reach the existing fence/worker rules before filling slots with fetches.
	sort.SliceStable(operations, func(i, j int) bool {
		priority := func(k protocol.OperationKind) int {
			if k == protocol.SettleCompletion {
				return 0
			}
			if k == protocol.Stop {
				return 1
			}
			return 2
		}
		return priority(operations[i].Kind) < priority(operations[j].Kind)
	})
	batch := &recoveryBatch{ctx: ctx, operations: operations, dispatches: retainedDispatches}
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
	d.replayPublication(ctx)
	d.replayRemotePublication(ctx)
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
		if !d.enqueueLocked(batch.ctx, effectKey(op), func() error {
			// An older connection may have finished while this entry waited for
			// its key. Recheck hard failures and scope; effect replays terminal
			// results without invoking the host or replacing immutable bytes.
			eligible, err := d.retainedRecovery(op, batch.dispatches[op.AttemptID])
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
