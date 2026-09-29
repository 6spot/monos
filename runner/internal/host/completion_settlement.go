package host

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func completionFencePath(original string) string {
	return filepath.Join(Root, "launch", "workspaces", "completion-"+original+".json")
}

func retainCompletionTarget(op, original protocol.Operation) error {
	if err := wire.ValidateCompletionTarget(op, original); err != nil {
		return err
	}
	old, err := readOperation(operationPath(original.OperationID))
	if err == nil {
		if !sameOperation(old.Operation, original) {
			return fmt.Errorf("original completion identity changed")
		}
		return nil
	}
	if !os.IsNotExist(err) {
		return err
	}
	boot, err := BootID()
	if err != nil {
		return err
	}
	return saveRecord(operationPath(original.OperationID), operationRecord{Operation: original, BootID: boot, WorkspaceAction: "finalize"})
}

func readCompletionFenceAt(path string, original protocol.Operation, uid uint32) (*protocol.Operation, error) {
	if err := trustedFile(path, uid); err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var op protocol.Operation
	if err = wire.Decode("Operation", raw, &op); err != nil {
		return nil, err
	}
	if err = wire.ValidateCompletionTarget(op, original); err != nil {
		return nil, err
	}
	return &op, nil
}

func fenceCompletion(op protocol.Operation) error {
	if op.CompletionOperationID == nil {
		return fmt.Errorf("missing completion target")
	}
	original, err := readOperation(operationPath(*op.CompletionOperationID))
	if err != nil {
		return err
	}
	if err = wire.ValidateCompletionTarget(op, original.Operation); err != nil {
		return err
	}
	p := completionFencePath(original.Operation.OperationID)
	old, err := readCompletionFenceAt(p, original.Operation, 0)
	if err != nil {
		return err
	}
	if old != nil {
		if !sameOperation(*old, op) {
			return fmt.Errorf("completion already fenced by another settlement")
		}
		return nil
	}
	return saveRecord(p, op)
}

func requireUnfencedCompletion(op protocol.Operation) error {
	if op.Kind != protocol.KindCompleteNode || op.Workspace == nil {
		return nil
	}
	fence, err := readCompletionFenceAt(completionFencePath(op.OperationID), op, 0)
	if err != nil {
		return err
	}
	if fence != nil {
		return fmt.Errorf("completion fenced for trusted settlement")
	}
	return nil
}

func completionTombstone(op protocol.Operation) (*Status, error) {
	fence, err := readCompletionFenceAt(completionFencePath(op.OperationID), op, 0)
	if err != nil || fence == nil {
		return nil, err
	}
	r, err := readOperation(operationPath(fence.OperationID))
	if err != nil {
		return nil, err
	}
	if !sameOperation(r.Operation, *fence) || !r.Settled || r.Status.Error != "" || r.Status.CompletionSettlement == nil || r.Status.Result == nil {
		return nil, fmt.Errorf("completion settlement is not durably terminal")
	}
	pair := protocol.OperationResult{AttemptID: fence.AttemptID, OperationID: fence.OperationID, Success: true, Result: *r.Status.Result, CompletionSettlement: r.Status.CompletionSettlement}
	if err = wire.ValidateCompletionPair(*fence, op, pair); err != nil {
		return nil, err
	}
	prior := pair.CompletionSettlement.CompletionResult
	return &Status{Known: true, Result: &prior.Result, CancelledByOperationID: prior.CancelledByOperationID}, nil
}

// The coordinator and writer fences retain physical exclusion through worker
// crashes. The terminal pair is one fsynced root record; replay reconstructs the
// original outcome from it even if the second convenience record write was lost.
func settleCompletion(ctx context.Context, op protocol.Operation, storage string) (Status, error) {
	original, err := readOperation(operationPath(*op.CompletionOperationID))
	if err != nil {
		return Status{}, err
	}
	if err = wire.ValidateCompletionTarget(op, original.Operation); err != nil {
		return Status{}, err
	}
	r, err := readWorkspaceRecord(op.Workspace.WorkspaceID)
	if err != nil {
		return Status{}, err
	}
	if !sameWorkspaceOperation(r.Operation, op) || r.Metadata.StorageID != storage || r.OpenResult == nil {
		return Status{}, fmt.Errorf("completion settlement requires matching initialized lease")
	}
	if old, e := readOperation(operationPath(op.OperationID)); e == nil {
		if !sameOperation(old.Operation, op) {
			return Status{}, fmt.Errorf("settlement operation identity changed")
		}
		if old.Settled && old.Status.Error == "" && old.Status.CompletionSettlement != nil {
			return persistCompletionSettlement(op, original.Operation, r, old.Status)
		}
	} else if !os.IsNotExist(e) {
		return Status{}, e
	}
	if _, err = stop(ctx, op.AttemptID); err != nil {
		return Status{}, err
	}
	var status Status
	if original.Settled && original.Status.Error == "" && original.Status.Result != nil && original.Status.Result.GitCommit != nil {
		status = Status{Known: true, Result: &protocol.EffectResult{WriterAbsent: ptr(true)}, CompletionSettlement: &protocol.CompletionSettlement{CompletionOperationID: original.Operation.OperationID, Disposition: protocol.AlreadyFinalized, CompletionResult: protocol.CompletionOperationResult{AttemptID: op.AttemptID, OperationID: original.Operation.OperationID, Success: true, Result: *original.Status.Result}}}
	} else {
		status, err = runWorkspaceWorker(ctx, op, "settle_completion", nil)
		if err != nil {
			return status, err
		}
	}
	return persistCompletionSettlement(op, original.Operation, r, status)
}

func persistCompletionSettlement(op, original protocol.Operation, r workspaceRecord, status Status) (Status, error) {
	if status.Result == nil {
		return status, fmt.Errorf("missing completion settlement evidence")
	}
	pair := protocol.OperationResult{AttemptID: op.AttemptID, OperationID: op.OperationID, Success: true, Result: *status.Result, CompletionSettlement: status.CompletionSettlement}
	if err := wire.ValidateCompletionPair(op, original, pair); err != nil {
		return status, err
	}
	boot, err := BootID()
	if err != nil {
		return status, err
	}
	// Pair precedes release and the original tombstone. Until export succeeds the
	// service/backend retains ownership even though these root writers are absent.
	if err = saveRecord(operationPath(op.OperationID), operationRecord{Operation: op, BootID: boot, Settled: true, Status: status}); err != nil {
		return status, err
	}
	c := status.CompletionSettlement.CompletionResult
	if c.Success {
		r.Metadata.FinalizedCommit = *c.Result.GitCommit
		r.PrivateCheckpoint = nil
	} else {
		r.PrivateCheckpoint = status.Result.WorkspaceMetadata.Checkpoint
	}
	r.Released = true
	if err = saveRecord(workspaceRecordPath(op.Workspace.WorkspaceID), r); err != nil {
		return status, err
	}
	prior := Status{Known: true, Result: &c.Result, CancelledByOperationID: c.CancelledByOperationID}
	err = saveRecord(operationPath(original.OperationID), operationRecord{Operation: original, BootID: boot, Settled: true, Status: prior})
	return status, err
}

// Run under the execution-account writer lock. Root supplies immutable target
// identity; no Agent path or reset/rebase instruction is accepted.
func settlementWorker(op protocol.Operation, original protocol.Operation, metadata protocol.WorkspaceMetadata, workspace, common string) (Status, error) {
	if err := wire.ValidateCompletionTarget(op, original); err != nil {
		return Status{}, err
	}
	finalized, err := reconcileFinalization(workspace, common, original.OperationID, metadata.FinalizedCommit)
	if err != nil {
		return Status{}, err
	}
	p := &protocol.CompletionSettlement{CompletionOperationID: original.OperationID}
	status := Status{Known: true, Result: &protocol.EffectResult{WriterAbsent: ptr(true)}, CompletionSettlement: p}
	p.CompletionResult = protocol.CompletionOperationResult{AttemptID: op.AttemptID, OperationID: original.OperationID}
	if finalized != nil {
		metadata.FinalizedCommit = *finalized.GitCommit
		metadata.Checkpoint = nil
		finalized.WorkspaceID = &op.Workspace.WorkspaceID
		finalized.WorkspaceMetadata = &metadata
		p.Disposition, p.CompletionResult.Success, p.CompletionResult.Result = protocol.AlreadyFinalized, true, *finalized
	} else {
		cp, e := completionRecoveryCheckpoint(workspace, common, op.OperationID, original.OperationID, *op.CompletionIdentityDigest, metadata.FinalizedCommit)
		if e != nil {
			return Status{}, e
		}
		metadata.Checkpoint = &cp
		status.Result.WorkspaceID, status.Result.WorkspaceMetadata = &op.Workspace.WorkspaceID, &metadata
		p.Disposition = protocol.DispositionCancelled
		p.CompletionResult.CancelledByOperationID = &op.OperationID
		p.CompletionResult.Result.WriterAbsent = ptr(true)
	}
	return status, nil
}
