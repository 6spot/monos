package wire

import (
	"encoding/json"
	"fmt"

	protocol "monos.local/protocol"
)

// OperationIdentity excludes transport settlement state, never immutable input.
// The backend uses this identical canonical projection for completion targets.
func OperationIdentity(op protocol.Operation) (string, error) {
	op.State = ""
	op.Result = nil
	op.CancelledByOperationID = nil
	raw, err := json.Marshal(op)
	if err != nil {
		return "", err
	}
	var input map[string]any
	if err = json.Unmarshal(raw, &input); err != nil {
		return "", err
	}
	delete(input, "state")
	_, digest, err := Canonical(input)
	return digest, err
}

func SameOperation(a, b protocol.Operation) bool {
	x, err := OperationIdentity(a)
	if err != nil {
		return false
	}
	y, err := OperationIdentity(b)
	return err == nil && x == y
}

// ValidateCompletionInputs checks the immutable complete membership, including
// order and descriptor digests. Every item belongs to the same Node activation.
func ValidateCompletionInputs(op protocol.Operation) error {
	if op.Kind != protocol.KindCompleteNode || op.Workspaces == nil || len(op.Workspaces) > 64 || op.Workspace != nil || op.WorkspaceDigest != nil || op.ResourceID != nil {
		return fmt.Errorf("invalid completion workspace collection")
	}
	resources, workspaces, leases := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for index, item := range op.Workspaces {
		w := item.Workspace
		_, digest, err := Canonical(w)
		if err != nil || digest != item.WorkspaceDigest || w.ResourceID != w.Resource.ResourceID || resources[w.ResourceID] || workspaces[w.WorkspaceID] || leases[w.LeaseID] || (index > 0 && op.Workspaces[index-1].Workspace.ResourceID >= w.ResourceID) || (w.Isolation == nil) != (item.Integration == nil) {
			return fmt.Errorf("invalid completion member identity or ordering")
		}
		if index > 0 {
			first := op.Workspaces[0].Workspace
			if w.TaskID != first.TaskID || w.NodeID != first.NodeID || w.NodeActivation != first.NodeActivation || w.RunnerID != first.RunnerID || w.ProjectID != first.ProjectID {
				return fmt.Errorf("completion member scope differs")
			}
		}
		resources[w.ResourceID], workspaces[w.WorkspaceID], leases[w.LeaseID] = true, true, true
	}
	return nil
}

func ValidateCompletionTarget(settle, original protocol.Operation) error {
	if err := ValidateCompletionInputs(original); err != nil {
		return err
	}
	if settle.Kind != protocol.SettleCompletion || original.CompletionManifestDigest == nil || settle.CompletionOperationID == nil || *settle.CompletionOperationID != original.OperationID || settle.OperationID == original.OperationID || settle.CompletionIdentityDigest == nil || settle.AttemptID != original.AttemptID || settle.DispatchID != original.DispatchID || settle.ResourceID != nil || settle.Workspace != nil || settle.WorkspaceDigest != nil || settle.Workspaces != nil || settle.CompletionManifestDigest != nil {
		return fmt.Errorf("completion settlement target identity mismatch")
	}
	digest, err := OperationIdentity(original)
	if err != nil || digest != *settle.CompletionIdentityDigest {
		return fmt.Errorf("completion settlement target digest mismatch")
	}
	return nil
}

func CompletionResult(r protocol.CompletionOperationResult) protocol.OperationResult {
	return protocol.OperationResult{AttemptID: r.AttemptID, OperationID: r.OperationID, Success: r.Success, Result: r.Result, FailureKind: r.FailureKind, CancelledByOperationID: r.CancelledByOperationID}
}

func validateWorkspaceMember(input protocol.WorkspaceCompletionInput, item protocol.WorkspaceEffectResult) error {
	w, m := input.Workspace, item.WorkspaceMetadata
	if item.ResourceID != w.ResourceID || item.WorkspaceID != w.WorkspaceID || m.LeaseID != w.LeaseID || m.Generation != w.Generation || m.RepositoryIdentity != w.Resource.RepositoryIdentity || (w.Isolation == nil) != (m.Isolation == nil) || w.Isolation != nil && w.Isolation.AllocationID != m.Isolation.AllocationID {
		return fmt.Errorf("completion workspace member mismatch")
	}
	if b := w.Basis; b != nil && (m.StorageID != b.StorageID || m.RepositoryIdentity != b.RepositoryIdentity || m.BaseCommit != b.BaseCommit || m.TargetBranch != b.TargetBranch) {
		return fmt.Errorf("completion fixed basis mismatch")
	}
	return nil
}

// ValidateCompletionResult binds the whole physical outcome to the admitted
// collection. A conflict preserves every capture and grants no Node completion.
func ValidateCompletionResult(op protocol.Operation, result protocol.EffectResult) error {
	if err := ValidateCompletionInputs(op); err != nil {
		return err
	}
	raw, err := json.Marshal(result)
	if err != nil {
		return err
	}
	if err = Validate("EffectResult", raw); err != nil {
		return err
	}
	if result.CompletionOutcome == nil || result.WorkspaceResults == nil || len(result.WorkspaceResults) != len(op.Workspaces) || result.WriterAbsent == nil || !*result.WriterAbsent {
		return fmt.Errorf("incomplete completion outcome")
	}
	conflict := *result.CompletionOutcome == "conflict"
	if !conflict && *result.CompletionOutcome != "finalized" {
		return fmt.Errorf("unknown completion outcome")
	}
	hasConflict := false
	for index, item := range result.WorkspaceResults {
		input := op.Workspaces[index]
		if err := validateWorkspaceMember(input, item); err != nil {
			return err
		}
		m, c, i := item.WorkspaceMetadata, item.Capture, item.Integration
		if c == nil || m.Checkpoint != nil {
			return fmt.Errorf("completion capture missing or checkpointed")
		}
		if m.Isolation != nil && c.StartCommit != m.Isolation.StartCommit {
			return fmt.Errorf("capture start differs from allocation")
		}
		if i != nil {
			if input.Integration == nil || i.ExpectedTaskCommit != input.Integration.ExpectedTaskCommit || i.StartCommit != c.StartCommit || i.NodeCommit != c.NodeCommit || i.NodeTree != c.NodeTree {
				return fmt.Errorf("integration provenance mismatch")
			}
		}
		if conflict {
			if item.GitCommit != nil || item.GitTree != nil {
				return fmt.Errorf("conflict cannot publish any member")
			}
			if i != nil {
				if i.Outcome != protocol.Conflict || i.TaskCommit != i.ExpectedTaskCommit {
					return fmt.Errorf("conflict cannot advance Task")
				}
				hasConflict = true
			}
		} else {
			if item.GitCommit == nil || item.GitTree == nil || m.FinalizedCommit != *item.GitCommit {
				return fmt.Errorf("finalized member revision missing")
			}
			if input.Integration != nil {
				if i == nil || i.Outcome != protocol.Integrated || i.TaskCommit != *item.GitCommit || i.TaskTree != *item.GitTree {
					return fmt.Errorf("finalized integration mismatch")
				}
			} else if i != nil || c.NodeCommit != *item.GitCommit || c.NodeTree != *item.GitTree {
				return fmt.Errorf("direct capture differs from final result")
			}
		}
	}
	if conflict && !hasConflict {
		return fmt.Errorf("conflict outcome has no conflicting member")
	}
	return nil
}

func SelectWorkspaceResult(op protocol.Operation, result protocol.EffectResult, resourceID string) (protocol.WorkspaceEffectResult, error) {
	if err := ValidateCompletionResult(op, result); err != nil {
		return protocol.WorkspaceEffectResult{}, err
	}
	for _, item := range result.WorkspaceResults {
		if item.ResourceID == resourceID {
			return item, nil
		}
	}
	return protocol.WorkspaceEffectResult{}, fmt.Errorf("resource is outside completion")
}

func ValidateCompletionPair(op, original protocol.Operation, r protocol.OperationResult) error {
	if err := ValidateCompletionTarget(op, original); err != nil {
		return err
	}
	raw, err := json.Marshal(r)
	if err != nil {
		return err
	}
	if err = Validate("OperationResult", raw); err != nil {
		return err
	}
	p := r.CompletionSettlement
	if r.OperationID != op.OperationID || r.AttemptID != op.AttemptID || !r.Success || p == nil || p.CompletionOperationID != original.OperationID || p.CompletionResult.OperationID != original.OperationID || p.CompletionResult.AttemptID != original.AttemptID || r.Result.WriterAbsent == nil || !*r.Result.WriterAbsent || p.CompletionResult.Result.WriterAbsent == nil || !*p.CompletionResult.Result.WriterAbsent {
		return fmt.Errorf("invalid completion settlement result pair")
	}
	c := p.CompletionResult
	if p.Disposition == protocol.AlreadyFinalized {
		if !c.Success || c.CancelledByOperationID != nil || r.Result.WorkspaceResults != nil || r.Result.CompletionOutcome != nil || r.Result.WorkspaceMetadata != nil || r.Result.WorkspaceID != nil || r.Result.GitCommit != nil || r.Result.GitTree != nil {
			return fmt.Errorf("invalid already-finalized pair")
		}
		return ValidateCompletionResult(original, c.Result)
	}
	if p.Disposition != protocol.DispositionCancelled || c.Success || c.CancelledByOperationID == nil || *c.CancelledByOperationID != op.OperationID || r.Result.CompletionOutcome != nil || r.Result.WorkspaceResults == nil || len(r.Result.WorkspaceResults) != len(original.Workspaces) {
		return fmt.Errorf("invalid cancelled completion pair")
	}
	for index, item := range r.Result.WorkspaceResults {
		if err := validateWorkspaceMember(original.Workspaces[index], item); err != nil {
			return err
		}
		cp := item.WorkspaceMetadata.Checkpoint
		if cp == nil || cp.OperationID != op.OperationID || cp.CompletionOperationID == nil || *cp.CompletionOperationID != original.OperationID || cp.CompletionIdentityDigest == nil || *cp.CompletionIdentityDigest != *op.CompletionIdentityDigest {
			return fmt.Errorf("invalid completion recovery checkpoint provenance")
		}
	}
	return nil
}
