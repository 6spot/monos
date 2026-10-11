package daemon

import (
	"context"
	"encoding/json"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/journal"
	"monos.local/runner/internal/wire"
)

func retainedResultIdentity(db *journal.DB, i protocol.ResultReadIdentity) error {
	op, e := db.Operation(i.OperationID)
	if e != nil {
		return e
	}
	start, e := db.Start(i.AttemptID)
	if e != nil {
		return e
	}
	effect, e := db.Effect(i.OperationID)
	if e != nil {
		return e
	}
	return host.ValidateRetainedResultIdentity(start.Dispatch, op, effect, i)
}

func (d *Daemon) resultRead(ctx context.Context, frame protocol.Frame) {
	if frame.ResultRead == nil || frame.CorrelationID == nil {
		return
	}
	d.queueMu.Lock()
	if d.readSlots == nil {
		d.readSlots = make(chan struct{}, 4)
	}
	slots := d.readSlots
	d.queueMu.Unlock()
	r := *frame.ResultRead
	send := func(out protocol.ResultReadResponse) {
		_ = d.Control.Send(ctx, protocol.Frame{Type: protocol.ResultReadResult, CorrelationID: frame.CorrelationID, ResultReadResult: &out})
	}
	select {
	case slots <- struct{}{}:
	default:
		send(protocol.ResultReadResponse{SchemaVersion: 1, Request: r, Status: "busy"})
		return
	}
	d.workers.Add(1)
	go func() {
		defer d.workers.Done()
		defer func() { <-slots }()
		readCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		out := protocol.ResultReadResponse{SchemaVersion: 1, Request: r, Status: "identity_mismatch"}
		raw, e := json.Marshal(r)
		if e == nil && wire.Validate("ResultReadRequest", raw) == nil && retainedResultIdentity(d.DB, r.Identity) == nil {
			out = host.ResultRead(readCtx, r)
		}
		if ctx.Err() == nil {
			send(out)
		}
	}()
}
