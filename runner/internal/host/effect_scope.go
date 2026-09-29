package host

import (
	"fmt"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

// ValidateEffectScope protects both service-owned inspection and the privileged
// helper. Todo inspection must never fall through to the Task probe repository.
func ValidateEffectScope(d protocol.Dispatch, op protocol.Operation) error {
	if d.AttemptID != op.AttemptID || d.DispatchID != op.DispatchID {
		return fmt.Errorf("effect dispatch conflict")
	}
	if d.NodeExecutionSource != nil {
		if _, err := wire.ScopeID(d); err != nil {
			return err
		}
	}
	if op.RepositoryFree != nil {
		if !*op.RepositoryFree || op.Kind != protocol.KindCompleteNode || d.NodeExecutionSource == nil || op.CompletionManifestDigest == nil || op.ResourceID != nil || op.Workspace != nil || op.WorkspaceDigest != nil {
			return fmt.Errorf("repository-free completion requires canonical Node source and no workspace")
		}
		return nil
	}
	if op.Kind == protocol.SettleCompletion && (d.NodeExecutionSource == nil || op.CompletionOperationID == nil || op.CompletionIdentityDigest == nil || op.Workspace == nil) {
		return fmt.Errorf("completion settlement requires source-bound canonical workspace")
	}
	if d.TaskPlanningSource != nil {
		if _, err := wire.ScopeID(d); err != nil {
			return err
		}
		if op.Kind != protocol.Stop || op.ResourceID != nil || op.Workspace != nil || op.WorkspaceDigest != nil {
			return fmt.Errorf("initial Task Planner permits only repository-free Stop effects")
		}
		return nil
	}
	if d.TodoID != nil {
		if _, err := wire.ScopeID(d); err != nil {
			return err
		}
		if op.Kind != protocol.Stop || op.ResourceID != nil {
			return fmt.Errorf("Todo repository effects are unavailable")
		}
		return nil
	}
	if d.WorkspaceReservations != nil {
		if op.Kind == protocol.Stop && op.Workspace == nil && op.ResourceID == nil {
			return nil
		}
		return validateWorkspaceScope(d, op)
	}
	if op.Workspace != nil || op.WorkspaceDigest != nil {
		return fmt.Errorf("workspace descriptor on legacy dispatch")
	}
	// Stop owns the process tree, not a repository. Retained legacy resource IDs
	// still have to match when present, while new resource-free Stop is valid.
	if op.Kind == protocol.Stop && op.ResourceID == nil {
		return nil
	}
	if op.ResourceID == nil || !wire.SameResource(d.ResourceID, op.ResourceID) {
		return fmt.Errorf("effect resource conflict")
	}
	return nil
}
