package wire

import (
	"encoding/json"
	"fmt"
	"reflect"

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

func ValidateCompletionTarget(settle, original protocol.Operation) error {
	if settle.Kind != protocol.SettleCompletion || original.Kind != protocol.KindCompleteNode || original.Workspace == nil || original.RepositoryFree != nil || original.CompletionManifestDigest == nil || settle.CompletionOperationID == nil || *settle.CompletionOperationID != original.OperationID || settle.OperationID == original.OperationID || settle.CompletionIdentityDigest == nil || settle.AttemptID != original.AttemptID || settle.DispatchID != original.DispatchID || !SameResource(settle.ResourceID, original.ResourceID) || !reflect.DeepEqual(settle.Workspace, original.Workspace) || !reflect.DeepEqual(settle.WorkspaceDigest, original.WorkspaceDigest) {
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
		if !c.Success || c.CancelledByOperationID != nil || c.Result.GitCommit == nil || c.Result.GitTree == nil || r.Result.GitCommit != nil || r.Result.GitTree != nil || r.Result.WorkspaceMetadata != nil {
			return fmt.Errorf("invalid already-finalized pair")
		}
		if err := validateCompletionWorkspace(original, c.Result); err != nil {
			return err
		}
	} else if p.Disposition == protocol.DispositionCancelled {
		if c.Success || c.CancelledByOperationID == nil || *c.CancelledByOperationID != op.OperationID || c.Result.GitCommit != nil || c.Result.GitTree != nil || c.Result.WorkspaceMetadata != nil || c.Result.WorkspaceID != nil || r.Result.WorkspaceMetadata == nil || r.Result.WorkspaceMetadata.Checkpoint == nil {
			return fmt.Errorf("invalid cancelled completion pair")
		}
		cp := r.Result.WorkspaceMetadata.Checkpoint
		if err := validateCompletionWorkspace(original, r.Result); err != nil {
			return err
		}
		if cp.OperationID != op.OperationID || cp.CompletionOperationID == nil || *cp.CompletionOperationID != original.OperationID || cp.CompletionIdentityDigest == nil || *cp.CompletionIdentityDigest != *op.CompletionIdentityDigest {
			return fmt.Errorf("invalid completion recovery checkpoint provenance")
		}
	} else {
		return fmt.Errorf("unknown completion settlement disposition")
	}
	return nil
}

func validateCompletionWorkspace(original protocol.Operation, r protocol.EffectResult) error {
	w, m := original.Workspace, r.WorkspaceMetadata
	if w == nil || r.WorkspaceID == nil || *r.WorkspaceID != w.WorkspaceID || m == nil || m.LeaseID != w.LeaseID || m.Generation != w.Generation || m.RepositoryIdentity != w.Resource.RepositoryIdentity || r.Path != nil || r.InstructionFiles != nil {
		return fmt.Errorf("completion pair workspace evidence mismatch")
	}
	if r.GitCommit != nil && (m.FinalizedCommit != *r.GitCommit || m.Checkpoint != nil) {
		return fmt.Errorf("completion pair finalized metadata mismatch")
	}
	return nil
}
