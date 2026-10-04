package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/journal"
	"monos.local/runner/internal/wire"
)

func retainedPublicationIdentity(db *journal.DB, r protocol.PublicationPrepareRequest) error {
	if host.ValidatePublicationRequest(r) != nil || retainedResultIdentity(db, r.Source) != nil {
		return errors.New("publication source mismatch")
	}
	for _, p := range r.Construction.Parents {
		op, e := db.Operation(p.ObservationOperationID)
		if e != nil {
			return errors.New("publication parent unavailable")
		}
		outcome, e := db.Effect(p.ObservationOperationID)
		if e != nil || outcome == nil || !outcome.Success || outcome.OperationID != op.OperationID || outcome.AttemptID != op.AttemptID || op.Kind != protocol.KindOpenWorkspace || op.Workspace == nil || op.WorkspaceDigest == nil {
			return errors.New("publication parent mismatch")
		}
		start, e := db.Start(op.AttemptID)
		if e != nil || host.ValidateEffectScope(start.Dispatch, op) != nil {
			return errors.New("publication parent scope mismatch")
		}
		_, wd, e := wire.Canonical(op.Workspace)
		if e != nil || wd != *op.WorkspaceDigest {
			return errors.New("publication parent workspace mismatch")
		}
		_, provided, e := wire.Canonical(p.Workspace)
		if e != nil || provided != wd {
			return errors.New("publication parent workspace mismatch")
		}
		_, want, e := wire.Canonical(p.Outcome)
		if e != nil {
			return errors.New("publication parent result mismatch")
		}
		_, actual, e := wire.Canonical(outcome.Result)
		if e != nil || actual != want {
			return errors.New("publication parent result mismatch")
		}
		if op.OperationID != p.Workspace.OpenOperationID || op.Workspace.Resource.RepositoryIdentity != r.Source.RepositoryIdentity {
			return errors.New("publication parent scope mismatch")
		}
	}
	// No permission observer exists in this leaf. A backend configuration cannot
	// manufacture a verified workflow grant merely by setting an enum.
	if r.Configuration.WorkflowWrite == "allowed" {
		return errors.New("publication permission unavailable")
	}
	return nil
}

// Two bounded service workers. This queue never takes Daemon.mu, uses Runtime
// slots, manufactures Attempt effects, or owns semantic Task scheduling. Pending
// backend outbox requests are redelivered when busy or after connection recovery.
func (d *Daemon) enqueuePublication(ctx context.Context, key string, work func()) bool {
	d.queueMu.Lock()
	if d.publicationSlots == nil {
		d.publicationSlots = make(chan struct{}, 2)
	}
	if d.publicationQueued == nil {
		d.publicationQueued = map[string]bool{}
	}
	if ctx.Err() != nil || d.publicationQueued[key] {
		d.queueMu.Unlock()
		return false
	}
	select {
	case d.publicationSlots <- struct{}{}:
	default:
		d.queueMu.Unlock()
		return false
	}
	d.publicationQueued[key] = true
	d.workers.Add(1)
	d.queueMu.Unlock()
	go func() {
		defer d.workers.Done()
		defer func() { d.queueMu.Lock(); delete(d.publicationQueued, key); <-d.publicationSlots; d.queueMu.Unlock() }()
		if ctx.Err() == nil {
			work()
		}
	}()
	return true
}
func (d *Daemon) publicationPrepare(ctx context.Context, frame protocol.Frame) {
	if frame.PublicationPrepare == nil {
		return
	}
	r := *frame.PublicationPrepare
	raw, e := json.Marshal(r)
	if e != nil || len(raw) > 512<<10 || wire.Validate("PublicationPrepareRequest", raw) != nil {
		return
	}
	d.enqueuePublication(ctx, "prepare:"+r.OperationID, func() {
		pages := host.PublicationFailure(r, "reconciliation_required", "identity_mismatch")
		if retainedPublicationIdentity(d.DB, r) == nil {
			deadline, cancel := context.WithTimeout(ctx, time.Duration(r.Configuration.DeadlineSeconds)*time.Second)
			defer cancel()
			var e error
			pages, e = host.PublicationPrepare(deadline, r)
			if e != nil {
				return
			} // Unfinished local intent is resumed by original outbox request.
		}
		for _, page := range pages {
			if ctx.Err() != nil {
				return
			}
			copy := page
			if d.Control.Send(ctx, protocol.Frame{Type: "publication_result", PublicationResult: &copy}) != nil {
				return
			}
		}
	})
}
func (d *Daemon) publicationAck(ctx context.Context, ack protocol.PublicationACK) {
	d.enqueuePublication(ctx, "ack:"+ack.OperationID, func() { _ = host.PublicationAck(ack) })
}

func (d *Daemon) replayPublication(ctx context.Context) {
	d.enqueuePublication(ctx, "replay", func() {
		_ = host.ReplayPublicationResults(ctx, func(page protocol.PublicationResultPage) error {
			return d.Control.Send(ctx, protocol.Frame{Type: "publication_result", PublicationResult: &page})
		})
	})
}
