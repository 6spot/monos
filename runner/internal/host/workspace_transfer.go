package host

import (
	"encoding/json"
	"fmt"
	"reflect"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

// A transfer is system-owned publication input, never authority supplied by the
// execution account. Check the released predecessor before replacing its lease.
func validateWorkspaceTransfer(r workspaceRecord, op protocol.Operation) error {
	w, old := op.Workspace, r.Operation.Workspace
	t := w.Transfer
	if t == nil {
		return fmt.Errorf("ownership_unresolved: interrupted activation disposition required")
	}
	raw, err := json.Marshal(t)
	if err != nil {
		return err
	}
	if err = wire.Validate("WorkspaceTransfer", raw); err != nil {
		return err
	}
	if !r.Released || t.WorkspaceID != old.WorkspaceID || t.WorkspaceID != w.WorkspaceID || t.TaskID != old.TaskID || t.TaskID != w.TaskID || t.ResourceID != old.ResourceID || t.ResourceID != w.ResourceID || t.RunnerID != old.RunnerID || t.RunnerID != w.RunnerID || t.FromAttemptID != r.Operation.AttemptID || t.FromLeaseID != old.LeaseID || t.FromNodeID != old.NodeID || t.FromNodeActivation != old.NodeActivation || t.ToNodeID != w.NodeID || t.ToNodeActivation != w.NodeActivation || t.FromPlanID == t.ToPlanID {
		return fmt.Errorf("ownership_unresolved: workspace transfer ownership mismatch")
	}
	metadata := r.Metadata
	metadata.Checkpoint = r.PrivateCheckpoint
	if !reflect.DeepEqual(t.Metadata, metadata) {
		return fmt.Errorf("storage_unavailable: transfer predecessor metadata changed")
	}
	if r.PrivateCheckpoint != nil {
		if t.Kind != "checkpoint" || t.SettleOperationID != r.PrivateCheckpoint.OperationID {
			return fmt.Errorf("ownership_unresolved: transfer checkpoint mismatch")
		}
	} else if t.Kind != "completed" || t.CompletionOperationID == nil || t.SettleOperationID != *t.CompletionOperationID {
		return fmt.Errorf("ownership_unresolved: transfer completion mismatch")
	}
	return nil
}

// Read root-owned historical evidence only on the first adoption. Once adopted,
// the immutable new lease owns recovery; a later Stop produces its own checkpoint.
func validateWorkspaceTransferEvidence(r workspaceRecord, op protocol.Operation) error {
	if err := validateWorkspaceTransfer(r, op); err != nil {
		return err
	}
	t := op.Workspace.Transfer
	m, err := readManifest(t.FromAttemptID)
	if err != nil {
		return err
	}
	proof, err := readOperation(operationPath(t.SettleOperationID))
	if err != nil {
		return err
	}
	var original *protocol.Operation
	if proof.Operation.Kind == protocol.SettleCompletion {
		if proof.Operation.CompletionOperationID == nil {
			return fmt.Errorf("missing transfer completion target")
		}
		target, err := readOperation(operationPath(*proof.Operation.CompletionOperationID))
		if err != nil {
			return err
		}
		fence, err := readCompletionFenceAt(completionFencePath(target.Operation.OperationID), target.Operation, 0)
		if err != nil {
			return err
		}
		if fence == nil || !sameOperation(*fence, proof.Operation) {
			return fmt.Errorf("transfer completion fence mismatch")
		}
		original = &target.Operation
	}
	return validateWorkspaceTransferProof(r, op, m, proof, original)
}

func validateWorkspaceTransferProof(r workspaceRecord, op protocol.Operation, m Manifest, proof operationRecord, original *protocol.Operation) error {
	if err := validateWorkspaceTransfer(r, op); err != nil {
		return err
	}
	t := op.Workspace.Transfer
	s := m.Dispatch.NodeExecutionSource
	if s == nil || s.PlanID != t.FromPlanID || s.NodeID != t.FromNodeID || s.NodeActivation != t.FromNodeActivation || m.Dispatch.AttemptID != t.FromAttemptID || m.Dispatch.DispatchID != r.Operation.DispatchID {
		return fmt.Errorf("ownership_unresolved: transfer predecessor source mismatch")
	}
	if proof.Operation.OperationID != t.SettleOperationID || proof.Operation.DispatchID != r.Operation.DispatchID || !proof.Settled || !proof.Status.Known || proof.Status.Populated || proof.Status.Error != "" || proof.Status.Result == nil || proof.Operation.AttemptID != t.FromAttemptID || !sameWorkspaceOperation(proof.Operation, r.Operation) {
		return fmt.Errorf("ownership_unresolved: transfer settlement missing")
	}
	result := proof.Status.Result
	if t.Kind == "checkpoint" {
		if result.WriterAbsent == nil || !*result.WriterAbsent || result.WorkspaceMetadata == nil || !reflect.DeepEqual(*result.WorkspaceMetadata, t.Metadata) {
			return fmt.Errorf("ownership_unresolved: transfer Stop proof mismatch")
		}
		switch proof.Operation.Kind {
		case protocol.Stop:
			if result.WorkspaceMetadata.Checkpoint.CompletionOperationID != nil || result.WorkspaceMetadata.Checkpoint.CompletionIdentityDigest != nil {
				return fmt.Errorf("Stop cannot claim a completion recovery checkpoint")
			}
		case protocol.SettleCompletion:
			if original == nil || proof.Status.CompletionSettlement == nil || proof.Status.CompletionSettlement.Disposition != protocol.DispositionCancelled {
				return fmt.Errorf("transfer requires cancelled completion settlement")
			}
			pair := protocol.OperationResult{OperationID: proof.Operation.OperationID, AttemptID: proof.Operation.AttemptID, Success: true, Result: *result, CompletionSettlement: proof.Status.CompletionSettlement}
			if err := wire.ValidateCompletionPair(proof.Operation, *original, pair); err != nil {
				return err
			}
		default:
			return fmt.Errorf("transfer checkpoint requires trusted Stop or completion settlement")
		}
	} else if proof.Operation.Kind != protocol.KindCompleteNode || !reflect.DeepEqual(proof.Operation.CompletionManifestDigest, t.CompletionManifestDigest) || result.GitCommit == nil || *result.GitCommit != t.Metadata.FinalizedCommit || !reflect.DeepEqual(result.GitTree, t.FinalizedTree) {
		return fmt.Errorf("ownership_unresolved: transfer finalized proof mismatch")
	}
	return nil
}
