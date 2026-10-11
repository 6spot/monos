package host

import (
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
	if op.Kind != protocol.KindCompleteNode || op.Workspaces == nil {
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
