package host

import (
	"fmt"
	"reflect"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func validateCompletionCapture(input protocol.WorkspaceCompletionInput, metadata protocol.WorkspaceMetadata, capture *protocol.EffectResult) error {
	if capture == nil || capture.GitCommit == nil || capture.GitTree == nil || !objectID.MatchString(*capture.GitCommit) || !objectID.MatchString(*capture.GitTree) || capture.WorkspaceMetadata == nil || capture.WorkspaceID == nil || *capture.WorkspaceID != input.Workspace.WorkspaceID || capture.WriterAbsent == nil || !*capture.WriterAbsent || capture.Path != nil || capture.InstructionFiles != nil || capture.WorkspaceResults != nil || capture.CompletionOutcome != nil {
		return fmt.Errorf("invalid completion item capture")
	}
	expected := metadata
	expected.FinalizedCommit, expected.Checkpoint = *capture.GitCommit, nil
	if !reflect.DeepEqual(expected, *capture.WorkspaceMetadata) {
		return fmt.Errorf("completion capture changed initialized metadata")
	}
	return nil
}

func validateCompletionProgress(record operationRecord, storage string) error {
	if err := wire.ValidateCompletionInputs(record.Operation); err != nil {
		return err
	}
	p := record.Completion
	if p == nil || len(p.Items) != len(record.Operation.Workspaces) {
		return fmt.Errorf("completion progress lost membership")
	}
	if p.Decision != "" && p.Decision != "publish" && p.Decision != "conflict" && p.Decision != "cancel" {
		return fmt.Errorf("invalid completion decision")
	}
	hasConflict := false
	for i, input := range record.Operation.Workspaces {
		item, w := p.Items[i], input.Workspace
		m := item.Metadata
		if item.WorkspaceID != w.WorkspaceID || m.StorageID != storage || m.LeaseID != w.LeaseID || m.Generation != w.Generation || m.RepositoryIdentity != w.Resource.RepositoryIdentity || (w.Isolation == nil) != (m.Isolation == nil) || w.Isolation != nil && w.Isolation.AllocationID != m.Isolation.AllocationID {
			return fmt.Errorf("completion progress metadata changed")
		}
		if item.Capture != nil {
			if err := validateCompletionCapture(input, m, item.Capture); err != nil {
				return err
			}
		}
		if item.Protected && item.Capture == nil || item.Prepared != nil && (!item.Protected || input.Integration == nil) || item.Published && p.Decision != "publish" || item.Exported && p.Decision != "publish" && p.Decision != "conflict" {
			return fmt.Errorf("completion progress stage order changed")
		}
		if item.Prepared != nil {
			v := item.Prepared
			if m.Isolation == nil || v.StartCommit != m.Isolation.StartCommit || v.NodeCommit != *item.Capture.GitCommit || v.NodeTree != *item.Capture.GitTree || v.ExpectedTaskCommit != input.Integration.ExpectedTaskCommit || v.Outcome != protocol.Integrated && v.Outcome != protocol.Conflict || v.Outcome == protocol.Conflict && v.TaskCommit != v.ExpectedTaskCommit {
				return fmt.Errorf("completion prepared integration changed")
			}
			hasConflict = hasConflict || v.Outcome == protocol.Conflict
		}
		if p.Decision == "publish" || p.Decision == "conflict" {
			if !item.Protected || input.Integration != nil && item.Prepared == nil {
				return fmt.Errorf("completion decision precedes all preparation")
			}
		}
	}
	if p.Decision == "conflict" && !hasConflict || p.Decision == "publish" && hasConflict {
		return fmt.Errorf("completion decision differs from preparation")
	}
	if a := p.Active; a != nil {
		if _, _, err := completionItem(&record, a.WorkspaceID); err != nil {
			return err
		}
		digest, err := completionInvocationDigest(record.Operation, a.WorkspaceID, a.Action)
		if err != nil || digest != a.IdentityDigest || record.WorkspaceAction != a.Action {
			return fmt.Errorf("completion active invocation changed")
		}
		switch a.Action {
		case "capture", "protect", "prepare", "publish", "export", "cancel_checkpoint":
		default:
			return fmt.Errorf("unknown completion invocation action")
		}
		if a.Settled && (!a.Status.Known || a.Status.Result == nil) {
			return fmt.Errorf("completion invocation lost outcome")
		}
	}
	if record.Settled && record.Status.CancelledByOperationID == nil {
		if record.Status.Result == nil {
			return fmt.Errorf("completion lost terminal result")
		}
		if err := wire.ValidateCompletionResult(record.Operation, *record.Status.Result); err != nil {
			return err
		}
		result, err := completionAggregate(&record)
		if err != nil || !reflect.DeepEqual(result, *record.Status.Result) {
			return fmt.Errorf("completion terminal result differs from retained progress")
		}
	}
	return nil
}
