package daemon

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func (d *Daemon) replayCompletionSettlement(ctx context.Context, original protocol.Operation, id string) error {
	op, err := d.DB.Operation(id)
	if errors.Is(err, sql.ErrNoRows) {
		err = d.Control.Get(ctx, "/v1/recovery/operations/"+id, "Operation", &op)
		if err == nil {
			err = d.DB.BeginEffect(op)
		}
	}
	if err != nil {
		return err
	}
	if err = wire.ValidateCompletionTarget(op, original); err != nil {
		return err
	}
	retained, err := d.DB.Effect(op.OperationID)
	if err != nil {
		return err
	}
	if retained != nil && retained.Success && retained.CompletionSettlement != nil {
		return d.Control.Send(ctx, protocol.Frame{Type: protocol.TypeOperationResult, OperationResult: retained})
	}
	if retained != nil && retained.FailureKind != nil && *retained.FailureKind != protocol.Recoverable {
		return fmt.Errorf("completion settlement needs explicit repair retry")
	}
	// Use the settlement's existing flight key. Original tombstone redelivery
	// must not start a second exporter beside an already queued settlement.
	if !d.enqueue(ctx, effectKey(op), func() error { return d.effect(ctx, op) }) {
		return fmt.Errorf("completion settlement is queued or awaiting effect capacity")
	}
	return nil
}
