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
	// Backend authorizes checkpoint destinations. Root independently rejects live
	// allocations and any workspace opened by this Attempt; a released predecessor
	// checkpoint can belong to a later Node and must remain untouched here.
	for _, reservation := range d.WorkspaceReservations.Resources {
		r, err := readWorkspaceReservation(reservation.WorkspaceID, d.WorkspaceReservations.Isolation)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return Status{}, err
		}
		if err := validateRepositoryFreeWorkspace(r, op.AttemptID); err != nil {
			return Status{}, err
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

func validateRepositoryFreeWorkspace(r workspaceRecord, attemptID string) error {
	if !r.Released || r.Operation.AttemptID == attemptID {
		return fmt.Errorf("retained workspace requires finalization")
	}
	return nil
}
