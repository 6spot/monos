package daemon

import (
	"context"
	"fmt"
	"reflect"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/journal"
	"monos.local/runner/internal/wire"
)

type activeInspection struct {
	attempt string
	cancel  context.CancelFunc
	done    chan struct{}
}

func retainedInspectionOrigin(db *journal.DB, i protocol.InspectionDescriptor) error {
	o := i.Origin
	switch string(o.Kind) {
	case "default_ref":
		return nil
	case "task_completion":
		if o.Identity == nil || o.IdentityDigest == nil {
			return fmt.Errorf("completion inspection identity missing")
		}
		_, digest, err := wire.Canonical(o.Identity)
		if err != nil || digest != *o.IdentityDigest {
			return fmt.Errorf("completion inspection digest mismatch")
		}
		if err = retainedResultIdentity(db, *o.Identity); err != nil {
			return err
		}
		original, err := db.Operation(o.Identity.OperationID)
		if err != nil {
			return err
		}
		var w *protocol.WorkspaceDescriptor
		for index := range original.Workspaces {
			member := &original.Workspaces[index]
			if member.Workspace.ResourceID == o.Identity.ResourceID && member.Workspace.WorkspaceID == o.Identity.WorkspaceID {
				w = &member.Workspace
				break
			}
		}
		if w == nil || w.ProjectID != i.ProjectID || w.TaskID != i.ScopeID || w.RunnerID != i.RunnerID || w.Resource.ResourceID != i.Resource.ResourceID || w.Resource.RepositoryIdentity != i.Resource.RepositoryIdentity {
			return fmt.Errorf("completion inspection source mismatch")
		}
		return nil
	case "task_open":
		if o.OperationID == nil || o.Workspace == nil || o.WorkspaceDigest == nil || o.Metadata == nil {
			return fmt.Errorf("open inspection identity missing")
		}
		op, err := db.Operation(*o.OperationID)
		if err != nil {
			return err
		}
		start, err := db.Start(op.AttemptID)
		if err != nil {
			return err
		}
		result, err := db.Effect(op.OperationID)
		if err != nil {
			return err
		}
		w, m := o.Workspace, o.Metadata
		_, digest, err := wire.Canonical(w)
		if err != nil || digest != *o.WorkspaceDigest || op.WorkspaceDigest == nil || *op.WorkspaceDigest != digest || !reflect.DeepEqual(op.Workspace, w) || op.Kind != protocol.KindOpenWorkspace || op.OperationID != w.OpenOperationID || op.ResourceID == nil || *op.ResourceID != w.ResourceID || w.Basis != nil || w.Transfer != nil || w.TaskID != i.ScopeID || w.ProjectID != i.ProjectID || w.RunnerID != i.RunnerID || w.Resource.ResourceID != i.Resource.ResourceID || w.Resource.RepositoryIdentity != i.Resource.RepositoryIdentity {
			return fmt.Errorf("retained initial open descriptor mismatch")
		}
		if start.Dispatch.NodeExecutionSource == nil || start.Dispatch.RunnerID != i.RunnerID || start.Dispatch.AttemptID != op.AttemptID || start.Dispatch.DispatchID != op.DispatchID || host.ValidateEffectScope(start.Dispatch, op) != nil {
			return fmt.Errorf("retained initial open dispatch mismatch")
		}
		if result == nil || !result.Success || result.AttemptID != op.AttemptID || result.OperationID != op.OperationID || result.Result.WorkspaceID == nil || *result.Result.WorkspaceID != w.WorkspaceID || !reflect.DeepEqual(result.Result.WorkspaceMetadata, m) || m.Checkpoint != nil || m.FinalizedCommit != m.BaseCommit || m.LeaseID != w.LeaseID || m.Generation != w.Generation || m.RepositoryIdentity != w.Resource.RepositoryIdentity {
			return fmt.Errorf("retained initial open result mismatch")
		}
		return nil
	default:
		return fmt.Errorf("unknown inspection origin")
	}
}

func (d *Daemon) inspect(ctx context.Context, op protocol.Operation) (host.Status, error) {
	d.inspectionMu.Lock()
	if d.inspections == nil {
		d.inspections = map[string]*activeInspection{}
	}
	if d.inspectionStopped[op.AttemptID] {
		d.inspectionMu.Unlock()
		result, err := d.cancelInspection(ctx, op)
		return host.Status{Known: err == nil, Result: &result}, err
	}
	if d.inspections[op.OperationID] != nil {
		d.inspectionMu.Unlock()
		return host.Status{}, host.ErrInspectionUnresolved
	}
	child, cancel := context.WithCancel(ctx)
	active := &activeInspection{attempt: op.AttemptID, cancel: cancel, done: make(chan struct{})}
	d.inspections[op.OperationID] = active
	d.inspectionMu.Unlock()
	defer cancel()
	if err := retainedInspectionOrigin(d.DB, *op.Inspection); err != nil {
		// Even changed source proof cannot discard a previously launched child.
		result, err := d.cancelInspection(child, op)
		return host.Status{Known: err == nil, Result: &result}, err
	}
	result, err := d.runInspection(child, op)
	return host.Status{Known: err == nil, Result: &result}, err
}

func (d *Daemon) finishInspection(op protocol.Operation) {
	d.inspectionMu.Lock()
	defer d.inspectionMu.Unlock()
	if active := d.inspections[op.OperationID]; active != nil {
		delete(d.inspections, op.OperationID)
		close(active.done)
	}
}

func (d *Daemon) runInspection(ctx context.Context, op protocol.Operation) (protocol.EffectResult, error) {
	if d.inspectionRun != nil {
		return d.inspectionRun(ctx, op)
	}
	return host.InspectRepository(ctx, op, d.Control.InspectionRepositoryAccess)
}
func (d *Daemon) cancelInspection(ctx context.Context, op protocol.Operation) (protocol.EffectResult, error) {
	if d.inspectionCancel != nil {
		return d.inspectionCancel(ctx, op)
	}
	return host.CancelInspection(ctx, op)
}

// Called before any Planner process release, including reconnect reconciliation.
// Inspection never emits writer_absent itself and cannot borrow a workspace lease.
func (d *Daemon) drainInspections(ctx context.Context, attempt string, emit bool) error {
	d.inspectionMu.Lock()
	if d.inspectionStopped == nil {
		d.inspectionStopped = map[string]bool{}
	}
	d.inspectionStopped[attempt] = true
	pending := []chan struct{}{}
	for _, active := range d.inspections {
		if active.attempt == attempt {
			active.cancel()
			pending = append(pending, active.done)
		}
	}
	d.inspectionMu.Unlock()
	for _, done := range pending {
		select {
		case <-done:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	ops, err := d.DB.Inspections(attempt)
	if err != nil {
		return err
	}
	for _, op := range ops {
		old, err := d.DB.Effect(op.OperationID)
		if err != nil {
			return err
		}
		if old != nil && old.Success {
			if emit {
				_ = d.Control.Send(ctx, protocol.Frame{Type: protocol.TypeOperationResult, OperationResult: old})
			}
			continue
		}
		result, err := d.cancelInspection(ctx, op)
		if err != nil {
			return err
		}
		settled := protocol.OperationResult{AttemptID: op.AttemptID, OperationID: op.OperationID, Success: true, Result: result}
		if err = d.DB.FinishEffect(settled); err != nil {
			return err
		}
		if emit {
			_ = d.Control.Send(ctx, protocol.Frame{Type: protocol.TypeOperationResult, OperationResult: &settled})
		}
		// Reconcile runs before Ready; the existing operation queue will replay
		// the retained result after readiness rather than sending early here.
	}
	return nil
}
