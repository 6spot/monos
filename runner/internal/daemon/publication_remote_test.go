package daemon

import (
	"context"
	"testing"
	"time"
)

func TestPublicationRefReadsShareBoundedRemoteLane(t *testing.T) {
	d := &Daemon{}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := make(chan struct{}, 2)
	work := func() { started <- struct{}{}; <-ctx.Done() }
	if !d.enqueueRemotePublication(ctx, "push:original", work) || !d.enqueueRemotePublication(ctx, "ref:fresh", work) {
		t.Fatal("remote lanes unavailable")
	}
	for range 2 {
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatal("remote job not started")
		}
	}
	if d.enqueueRemotePublication(ctx, "ref:other", work) || d.enqueueRemotePublication(ctx, "ref:fresh", work) {
		t.Fatal("remote cap or single-flight bypassed")
	}
	cancel()
	done := make(chan struct{})
	go func() { d.workers.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("remote read cancellation blocked shutdown")
	}
	if d.enqueueRemotePublication(ctx, "ref:cancelled", work) {
		t.Fatal("cancelled connection queued work")
	}
}
