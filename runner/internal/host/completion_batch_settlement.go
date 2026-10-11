package host

import (
	"context"
	"fmt"
	"os"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func settleCompletionBatch(ctx context.Context, settle protocol.Operation, record *operationRecord) (Status, error) {
	if old, err := readOperation(operationPath(settle.OperationID)); err == nil {
		if !sameOperation(old.Operation, settle) {
			return Status{}, fmt.Errorf("completion settlement identity changed")
		}
		if old.Settled && old.Status.Error == "" {
			return persistCompletionBatchSettlement(settle, record, old.Status)
		}
	} else if !os.IsNotExist(err) {
		return Status{}, err
	}
	if _, err := stop(ctx, settle.AttemptID); err != nil {
		return Status{}, err
	}
	progress := record.Completion
	result := protocol.EffectResult{WriterAbsent: ptr(true)}
	pair := &protocol.CompletionSettlement{CompletionOperationID: record.Operation.OperationID, CompletionResult: protocol.CompletionOperationResult{AttemptID: settle.AttemptID, OperationID: record.Operation.OperationID}}
	status := Status{Known: true, Result: &result, CompletionSettlement: pair}
	if progress.Decision == "publish" || progress.Decision == "conflict" {
		physical := record.Status
		if !record.Settled {
			var err error
			physical, err = finishCompletionBatch(ctx, record)
			if err != nil {
				return physical, err
			}
		}
		if physical.Result == nil {
			return Status{}, fmt.Errorf("missing terminal aggregate")
		}
		pair.Disposition, pair.CompletionResult.Success, pair.CompletionResult.Result = protocol.AlreadyFinalized, true, *physical.Result
	} else {
		if err := persistCompletionDecision(ctx, record, "cancel"); err != nil {
			return Status{}, err
		}
		result.WorkspaceResults = make([]protocol.WorkspaceEffectResult, 0, len(progress.Items))
		for i, input := range record.Operation.Workspaces {
			item := &progress.Items[i]
			if item.Checkpoint == nil {
				s, err := runCompletionItem(ctx, record, item.WorkspaceID, "cancel_checkpoint")
				if err != nil {
					return s, err
				}
				if s.Result.WorkspaceMetadata == nil || s.Result.WorkspaceMetadata.Checkpoint == nil {
					return s, fmt.Errorf("missing cancelled completion checkpoint")
				}
				item.Checkpoint = s.Result
				if err = saveRecord(operationPath(record.Operation.OperationID), record); err != nil {
					return s, err
				}
			}
			result.WorkspaceResults = append(result.WorkspaceResults, protocol.WorkspaceEffectResult{ResourceID: input.Workspace.ResourceID, WorkspaceID: item.WorkspaceID, WorkspaceMetadata: *item.Checkpoint.WorkspaceMetadata})
		}
		pair.Disposition = protocol.DispositionCancelled
		pair.CompletionResult.CancelledByOperationID = &settle.OperationID
		pair.CompletionResult.Result.WriterAbsent = ptr(true)
	}
	return persistCompletionBatchSettlement(settle, record, status)
}

func persistCompletionBatchSettlement(settle protocol.Operation, record *operationRecord, status Status) (Status, error) {
	if status.Result == nil || status.CompletionSettlement == nil {
		return status, fmt.Errorf("missing completion pair")
	}
	pair := protocol.OperationResult{AttemptID: settle.AttemptID, OperationID: settle.OperationID, Success: true, Result: *status.Result, CompletionSettlement: status.CompletionSettlement}
	if err := wire.ValidateCompletionPair(settle, record.Operation, pair); err != nil {
		return status, err
	}
	if record.Completion.Released && record.Status.CancelledByOperationID != nil {
		return status, nil
	}
	// One durable pair precedes every release and the original parent tombstone.
	if err := saveRecord(operationPath(settle.OperationID), operationRecord{Operation: settle, BootID: record.BootID, Settled: true, Status: status}); err != nil {
		return status, err
	}
	c := status.CompletionSettlement.CompletionResult
	for i, input := range record.Operation.Workspaces {
		if record.Completion.Released {
			break
		}
		r, err := readWorkspaceAllocation(&input.Workspace)
		if err != nil {
			return status, err
		}
		if !sameCompletionLease(r.Operation, record.Operation, input) {
			return status, fmt.Errorf("completion settlement lease changed")
		}
		if c.Success {
			r.Metadata, r.PrivateCheckpoint = c.Result.WorkspaceResults[i].WorkspaceMetadata, nil
		} else {
			r.PrivateCheckpoint = status.Result.WorkspaceResults[i].WorkspaceMetadata.Checkpoint
		}
		r.Released = true
		if err = saveRecord(workspaceAllocationRecordPath(&input.Workspace), r); err != nil {
			return status, err
		}
	}
	record.Completion.Released = true
	record.Settled, record.Status = true, Status{Known: true, Result: &c.Result, CancelledByOperationID: c.CancelledByOperationID}
	return status, saveRecord(operationPath(record.Operation.OperationID), record)
}

func settleCompletionWorkers(ctx context.Context, op protocol.Operation) error {
	if op.CompletionOperationID == nil {
		return fmt.Errorf("missing completion target")
	}
	record, err := readOperation(operationPath(*op.CompletionOperationID))
	if err != nil {
		return err
	}
	return settleWorkspaceWorker(ctx, record)
}

func checkpointCompletionItem(settle, parent protocol.Operation, input protocol.WorkspaceCompletionInput, metadata protocol.WorkspaceMetadata, workspace, common string) (protocol.EffectResult, error) {
	if err := wire.ValidateCompletionTarget(settle, parent); err != nil {
		return protocol.EffectResult{}, err
	}
	matched := false
	for _, member := range parent.Workspaces {
		if member.Workspace.WorkspaceID == input.Workspace.WorkspaceID && member.WorkspaceDigest == input.WorkspaceDigest {
			matched = true
		}
	}
	if !matched {
		return protocol.EffectResult{}, fmt.Errorf("checkpoint member absent from completion")
	}
	cp, err := completionRecoveryCheckpoint(workspace, common, settle.OperationID, parent.OperationID, *settle.CompletionIdentityDigest, metadata.FinalizedCommit)
	if err != nil {
		return protocol.EffectResult{}, err
	}
	metadata.Checkpoint = &cp
	return protocol.EffectResult{WriterAbsent: ptr(true), WorkspaceID: &input.Workspace.WorkspaceID, WorkspaceMetadata: &metadata}, nil
}
