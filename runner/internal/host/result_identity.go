package host

import (
	"fmt"
	"reflect"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

// ValidateRetainedResultIdentity is shared by immutable result reads and physical
// cleanup. It requires the complete original completion, source and result;
// matching object IDs alone cannot authorize retiring a workspace.
func ValidateRetainedResultIdentity(dispatch protocol.Dispatch, op protocol.Operation, effect *protocol.OperationResult, i protocol.ResultReadIdentity) error {
	digest, e := wire.OperationIdentity(op)
	if e != nil {
		return e
	}
	source := dispatch.NodeExecutionSource
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
	d := dispatch
	scope, scopeErr := wire.ScopeID(d)
	if scopeErr != nil || scope != i.TaskID || ValidateEffectScope(d, op) != nil {
		return fmt.Errorf("retained start scope mismatch")
	}
	expected, e := TaskWorkspaceID(i.TaskID, i.ResourceID)
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
