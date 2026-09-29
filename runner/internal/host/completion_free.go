package host

import (
	"context"
	"fmt"
	"os"

	protocol "monos.local/protocol"
)

func completeWithoutRepository(ctx context.Context, d protocol.Dispatch, op protocol.Operation) (Status, error) {
	if err := ValidateEffectScope(d, op); err != nil {
		return Status{}, err
	}
	if old, err := readOperation(operationPath(op.OperationID)); err == nil {
		if !sameOperation(old.Operation, op) {
			return Status{}, fmt.Errorf("repository-free completion identity changed")
		}
		if old.Settled && old.Status.Error == "" {
			return old.Status, nil
		}
	} else if !os.IsNotExist(err) {
		return Status{}, err
	}
	// Backend checks all same-activation retained private work; independently
	// reject any local reserved materialization needing settlement as well.
	for _, reservation := range d.WorkspaceReservations.Resources {
		r, err := readWorkspaceRecord(reservation.WorkspaceID)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return Status{}, err
		}
		if !r.Released || r.PrivateCheckpoint != nil {
			return Status{}, fmt.Errorf("retained workspace requires finalization")
		}
	}
	status, err := stop(ctx, op.AttemptID)
	if err != nil {
		return status, err
	}
	if !status.Known || status.Populated {
		return status, fmt.Errorf("repository-free completion lacks whole-tree absence")
	}
	status.Result = &protocol.EffectResult{WriterAbsent: ptr(true)}
	boot, err := BootID()
	if err != nil {
		return status, err
	}
	err = saveRecord(operationPath(op.OperationID), operationRecord{Operation: op, BootID: boot, Settled: true, Status: status})
	return status, err
}
