package daemon

import (
	"context"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
)

// Dedicated durable service work: no Runtime mutex, slot or Attempt effect.
func (d *Daemon) enqueueRemotePublication(ctx context.Context, key string, work func()) bool {
	d.queueMu.Lock()
	if d.remoteSlots == nil {
		d.remoteSlots = make(chan struct{}, 2)
	}
	if d.remoteQueued == nil {
		d.remoteQueued = map[string]bool{}
	}
	if ctx.Err() != nil || d.remoteQueued[key] {
		d.queueMu.Unlock()
		return false
	}
	select {
	case d.remoteSlots <- struct{}{}:
	default:
		d.queueMu.Unlock()
		return false
	}
	d.remoteQueued[key] = true
	d.workers.Add(1)
	d.queueMu.Unlock()
	go func() {
		defer d.workers.Done()
		defer func() { d.queueMu.Lock(); delete(d.remoteQueued, key); <-d.remoteSlots; d.queueMu.Unlock() }()
		if ctx.Err() == nil {
			work()
		}
	}()
	return true
}

func (d *Daemon) publicationPush(ctx context.Context, frame protocol.Frame) {
	if frame.PublicationPush == nil {
		return
	}
	r := *frame.PublicationPush
	if host.ValidatePublicationPushRequest(r) != nil {
		return
	}
	d.enqueueRemotePublication(ctx, "push:"+r.OperationID, func() {
		if retainedPublicationIdentity(d.DB, r.Preparation) != nil {
			return
		}
		deadline, cancel := context.WithTimeout(ctx, 120*time.Second)
		defer cancel()
		result, e := host.PublicationPush(deadline, r, d.Control.PublicationAccess)
		if e != nil {
			return
		}
		_ = d.Control.Send(ctx, protocol.Frame{Type: "publication_push_result", PublicationPushResult: &result})
	})
}

func (d *Daemon) replayRemotePublication(ctx context.Context) {
	d.enqueueRemotePublication(ctx, "replay", func() {
		_ = host.ReplayPublicationPushResults(ctx, func(result protocol.PublicationPushResult) error {
			return d.Control.Send(ctx, protocol.Frame{Type: "publication_push_result", PublicationPushResult: &result})
		})
	})
}

func (d *Daemon) publicationRefRead(ctx context.Context, frame protocol.Frame) {
	if frame.PublicationRefRead == nil || frame.CorrelationID == nil || *frame.CorrelationID == "" {
		return
	}
	r := *frame.PublicationRefRead
	if host.ValidatePublicationRefReadRequest(r) != nil {
		return
	}
	d.enqueueRemotePublication(ctx, "ref:"+r.RequestID, func() {
		if retainedPublicationIdentity(d.DB, r.Push.Preparation) != nil {
			return
		}
		deadline, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		result, e := host.PublicationRefRead(deadline, r, d.Control.PublicationAccess)
		if e != nil {
			return
		}
		_ = d.Control.Send(ctx, protocol.Frame{Type: "publication_ref_read_result", CorrelationID: frame.CorrelationID, PublicationRefReadResult: &result})
	})
}
