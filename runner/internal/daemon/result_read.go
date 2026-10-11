package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/journal"
	"monos.local/runner/internal/wire"
)

func retainedResultIdentity(db *journal.DB, i protocol.ResultReadIdentity) error {
	op, e := db.Operation(i.OperationID)
	if e != nil {
		return e
	}
	start, e := db.Start(i.AttemptID)
	if e != nil {
		return e
	}
	effect, e := db.Effect(i.OperationID)
	if e != nil {
		return e
	}
	digest, e := wire.OperationIdentity(op)
	if e != nil {
		return e
	}
	source := start.Dispatch.NodeExecutionSource
	if op.Kind != protocol.KindCompleteNode || op.AttemptID != i.AttemptID || op.DispatchID != i.DispatchID || digest != i.OperationIdentityDigest || op.CompletionManifestDigest == nil || *op.CompletionManifestDigest != i.ManifestDigest || source == nil || effect == nil || !effect.Success || effect.AttemptID != i.AttemptID || effect.OperationID != i.OperationID || effect.Result.CompletionOutcome == nil || *effect.Result.CompletionOutcome != "finalized" {
		return fmt.Errorf("retained completion mismatch")
	}
	item, e := wire.SelectWorkspaceResult(op, effect.Result, i.ResourceID)
	if e != nil {
		return e
	}
	var w *protocol.WorkspaceDescriptor
	for index := range op.Workspaces {
		input := &op.Workspaces[index]
		if input.Workspace.ResourceID == i.ResourceID {
			w = &input.Workspace
			break
		}
	}
	if w == nil || w.TaskID != i.TaskID || w.WorkspaceID != i.WorkspaceID || w.Resource.ResourceID != i.ResourceID || w.RunnerID != i.RunnerID || w.NodeID != i.NodeID || w.NodeActivation != i.NodeActivation || w.LeaseID != i.LeaseID || w.Generation != i.Generation || w.Resource.RepositoryIdentity != i.RepositoryIdentity {
		return fmt.Errorf("retained descriptor mismatch")
	}
	d := start.Dispatch
	scope, scopeErr := wire.ScopeID(d)
	if scopeErr != nil || scope != i.TaskID || host.ValidateEffectScope(d, op) != nil {
		return fmt.Errorf("retained start scope mismatch")
	}
	expected, e := host.TaskWorkspaceID(i.TaskID, i.ResourceID)
	if e != nil || expected != i.WorkspaceID || d.DispatchID != i.DispatchID || d.AttemptID != i.AttemptID || d.RunnerID != i.RunnerID || d.TaskID == nil || *d.TaskID != i.TaskID || source.NodeID != i.NodeID || source.NodeActivation != i.NodeActivation || source.SpecificationID != i.SpecificationID || source.PlanID != i.PlanID {
		return fmt.Errorf("retained start mismatch")
	}
	m := item.WorkspaceMetadata
	if item.WorkspaceID != i.WorkspaceID || item.GitCommit == nil || *item.GitCommit != i.GitCommit || item.GitTree == nil || *item.GitTree != i.GitTree || m.Generation != i.Generation || m.LeaseID != i.LeaseID || m.StorageID != i.StorageID || m.RepositoryIdentity != i.RepositoryIdentity || m.BaseCommit != i.BaseCommit || m.FinalizedCommit != i.GitCommit || m.Checkpoint != nil {
		return fmt.Errorf("retained physical result mismatch")
	}
	if !reflect.DeepEqual(i.Integration, item.Integration) || item.Capture == nil || !reflect.DeepEqual(i.Capture, *item.Capture) {
		return fmt.Errorf("retained capture/integration provenance mismatch")
	}
	return nil
}
func (d *Daemon) resultRead(ctx context.Context, frame protocol.Frame) {
	if frame.ResultRead == nil || frame.CorrelationID == nil {
		return
	}
	d.queueMu.Lock()
	if d.readSlots == nil {
		d.readSlots = make(chan struct{}, 4)
	}
	slots := d.readSlots
	d.queueMu.Unlock()
	r := *frame.ResultRead
	send := func(out protocol.ResultReadResponse) {
		_ = d.Control.Send(ctx, protocol.Frame{Type: protocol.ResultReadResult, CorrelationID: frame.CorrelationID, ResultReadResult: &out})
	}
	select {
	case slots <- struct{}{}:
	default:
		send(protocol.ResultReadResponse{SchemaVersion: 1, Request: r, Status: "busy"})
		return
	}
	d.workers.Add(1)
	go func() {
		defer d.workers.Done()
		defer func() { <-slots }()
		readCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		out := protocol.ResultReadResponse{SchemaVersion: 1, Request: r, Status: "identity_mismatch"}
		raw, e := json.Marshal(r)
		if e == nil && wire.Validate("ResultReadRequest", raw) == nil && retainedResultIdentity(d.DB, r.Identity) == nil {
			out = host.ResultRead(readCtx, r)
		}
		if ctx.Err() == nil {
			send(out)
		}
	}()
}
