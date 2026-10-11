package host

import (
	"crypto/sha256"
	"encoding/hex"
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
	if op.Inspection != nil || op.InspectionDigest != nil {
		return validateInspectionScope(d, op)
	}
	if d.TaskReviewSource != nil || d.TaskConversationSource != nil || d.TaskReplanSource != nil {
		if _, err := wire.ScopeID(d); err != nil {
			return err
		}
		if op.Kind != protocol.Stop || op.ResourceID != nil || op.Workspace != nil || op.WorkspaceDigest != nil || op.RepositoryFree != nil || op.CompletionManifestDigest != nil || op.CompletionOperationID != nil || op.CompletionIdentityDigest != nil {
			return fmt.Errorf("Task review/conversation/Replan permits only repository-free Stop effects")
		}
		return nil
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

func validateInspectionScope(d protocol.Dispatch, op protocol.Operation) error {
	i := op.Inspection
	scope, err := wire.ScopeID(d)
	if err != nil {
		return err
	}
	if i == nil || op.InspectionDigest == nil || op.Kind != protocol.KindInspectRepository || d.Kind != "planner" || d.NodeExecutionSource != nil || op.Workspace != nil || op.WorkspaceDigest != nil || op.RepositoryFree != nil || op.CompletionManifestDigest != nil || op.CompletionOperationID != nil || op.CompletionIdentityDigest != nil || op.ResourceID == nil {
		return fmt.Errorf("invalid Planner inspection effect")
	}
	raw, digest, err := wire.Canonical(i)
	if err != nil || wire.Validate("InspectionDescriptor", raw) != nil || digest != *op.InspectionDigest || i.InspectionID != op.OperationID || i.AttemptID != d.AttemptID || i.DispatchID != d.DispatchID || i.RunnerID != d.RunnerID || i.ScopeID != scope || i.Resource.ResourceID != *op.ResourceID {
		return fmt.Errorf("inspection identity mismatch")
	}
	if d.WorkspaceReservations != nil && d.WorkspaceReservations.ProjectID != i.ProjectID {
		return fmt.Errorf("inspection Project mismatch")
	}
	kind, id, context := "", "", ""
	version, watermark := d.ControlVersion, d.SourceWatermark
	switch {
	case d.TodoID != nil:
		if string(i.ScopeKind) != "todo" || string(i.Origin.Kind) != "default_ref" {
			return fmt.Errorf("invalid Todo inspection origin")
		}
		kind, id = "todo_discussion", *d.SourceMessageID
		hash := sha256.Sum256([]byte(d.Prompt))
		context = hex.EncodeToString(hash[:])
	case d.TaskPlanningSource != nil:
		kind, id, context = "task_initial_planning", d.TaskPlanningSource.IntentID, d.TaskPlanningSource.ContextDigest
	case d.TaskConversationSource != nil:
		kind, id, context = "task_conversation", d.TaskConversationSource.SourceID, d.TaskConversationSource.ContextDigest
	case d.TaskReplanSource != nil:
		kind, id, context = "task_replan", d.TaskReplanSource.SourceID, d.TaskReplanSource.ContextDigest
	case d.TaskReviewSource != nil:
		kind, id, context = "task_review", d.TaskReviewSource.SourceID, d.TaskReviewSource.ContextDigest
	default:
		return fmt.Errorf("canonical Planner source required")
	}
	if d.TaskID != nil && string(i.ScopeKind) != "task" {
		return fmt.Errorf("inspection Task scope mismatch")
	}
	p := i.PlannerSource
	if string(p.Kind) != kind || p.SourceID != id || p.ContextDigest != context || p.ControlVersion != version || p.SourceWatermark != watermark {
		return fmt.Errorf("inspection Planner source mismatch")
	}
	return nil
}
