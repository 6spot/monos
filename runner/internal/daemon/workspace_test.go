package daemon

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/control"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/journal"
	"monos.local/runner/internal/wire"
)

type heldWorkspaceHost struct {
	opened, stopped chan struct{}
	calls           atomic.Int32
}

type gatedStopHost struct{ entered, release chan struct{} }

func (h *gatedStopHost) Call(ctx context.Context, r host.Request) (host.Status, error) {
	if r.Action == "status" {
		return host.Status{Known: true, Populated: true, BootID: "boot"}, nil
	}
	close(h.entered)
	select {
	case <-h.release:
	case <-ctx.Done():
		return host.Status{}, ctx.Err()
	}
	return host.Status{Known: true, Result: &protocol.EffectResult{}}, nil
}

func TestWorkspaceEffectPreservesNewerReconciledProcessIdentity(t *testing.T) {
	for _, phase := range []string{"running", "revoked"} {
		t.Run(phase, func(t *testing.T) {
			db := testDB(t)
			id, _ := host.TaskWorkspaceID("task", "resource")
			w := protocol.WorkspaceDescriptor{SchemaVersion: 1, WorkspaceID: id, TaskID: "task", ResourceID: "resource", ProjectID: "project", RunnerID: "runner", NodeID: "node", NodeActivation: 1, LeaseID: "lease", Generation: 1, OpenOperationID: "open", Resource: protocol.WorkspaceResource{ResourceID: "resource"}}
			_, digest, _ := wire.Canonical(w)
			dispatch := protocol.Dispatch{AttemptID: "attempt", DispatchID: "dispatch", Kind: protocol.Node, TaskID: ptr("task"), NodeID: ptr("node"), NodeActivation: 1, RunnerID: "runner", WorkspaceReservations: &protocol.WorkspaceReservations{ProjectID: "project", Resources: []protocol.WorkspaceReservation{{ResourceID: "resource", WorkspaceID: id}}}}
			op := protocol.Operation{SchemaVersion: 1, OperationID: "stop", RequestID: "stop-request", AttemptID: "attempt", DispatchID: "dispatch", Kind: protocol.Stop, Workspace: &w, WorkspaceDigest: &digest, ResourceID: ptr("resource")}
			if err := db.SaveStart(journal.Start{Dispatch: dispatch, Phase: "intent", BootID: "boot"}); err != nil {
				t.Fatal(err)
			}
			h := &gatedStopHost{entered: make(chan struct{}), release: make(chan struct{})}
			d := Daemon{DB: db, Host: h, Control: &control.Client{}, Boot: "boot"}
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			done := make(chan error, 1)
			go func() { done <- d.effect(ctx, op) }()
			select {
			case <-h.entered:
			case <-ctx.Done():
				t.Fatal("effect did not reach gate")
			}
			d.mu.Lock()
			err := db.SaveStart(journal.Start{Dispatch: dispatch, Phase: phase, BootID: "boot", PID: 321, Birth: "latest-birth", Cgroup: "/latest/group"})
			d.mu.Unlock()
			if err != nil {
				t.Fatal(err)
			}
			close(h.release)
			<-done
			latest, err := db.Start("attempt")
			if err != nil || latest.PID != 321 || latest.Birth != "latest-birth" || latest.Cgroup != "/latest/group" || phase == "revoked" && latest.Phase != "revoked" {
				t.Fatal("old effect overwrote new process identity", latest, err)
			}
		})
	}
}

func (h *heldWorkspaceHost) Call(ctx context.Context, r host.Request) (host.Status, error) {
	if r.Action == "status" {
		return host.Status{Known: true, Populated: true, BootID: "boot", Cgroup: "/owned"}, nil
	}
	h.calls.Add(1)
	if r.Operation.Kind == protocol.KindOpenWorkspace {
		close(h.opened)
		select {
		case <-h.stopped:
		case <-ctx.Done():
			return host.Status{}, ctx.Err()
		}
		absent := true
		id := "stop"
		return host.Status{Known: true, CancelledByOperationID: &id, Result: &protocol.EffectResult{WriterAbsent: &absent}}, nil
	}
	close(h.stopped)
	absent := true
	return host.Status{Known: true, Result: &protocol.EffectResult{WriterAbsent: &absent}}, nil
}

func TestWorkspaceStopAndReconcileReachBlockedOpenAndCancellationReplays(t *testing.T) {
	db := testDB(t)
	id, err := host.TaskWorkspaceID("task", "resource")
	if err != nil {
		t.Fatal(err)
	}
	w := protocol.WorkspaceDescriptor{SchemaVersion: 1, WorkspaceID: id, TaskID: "task", ResourceID: "resource", ProjectID: "project", RunnerID: "runner", NodeID: "node", NodeActivation: 1, LeaseID: "lease", Generation: 1, OpenOperationID: "open", Resource: protocol.WorkspaceResource{ResourceID: "resource"}}
	_, digest, _ := wire.Canonical(w)
	dispatch := protocol.Dispatch{AttemptID: "attempt", DispatchID: "dispatch", Kind: protocol.Node, TaskID: ptr("task"), NodeID: ptr("node"), NodeActivation: 1, RunnerID: "runner", MutationAllowed: true, WorkspaceReservations: &protocol.WorkspaceReservations{ProjectID: "project", Resources: []protocol.WorkspaceReservation{{ResourceID: "resource", WorkspaceID: id}}}}
	open := protocol.Operation{SchemaVersion: 1, OperationID: "open", RequestID: "open-request", AttemptID: "attempt", DispatchID: "dispatch", Kind: protocol.KindOpenWorkspace, Workspace: &w, WorkspaceDigest: &digest, ResourceID: ptr("resource")}
	stop := open
	stop.OperationID = "stop"
	stop.RequestID = "stop-request"
	stop.Kind = protocol.Stop
	if err = db.SaveStart(journal.Start{Dispatch: dispatch, Phase: "running", BootID: "boot", Cgroup: "/owned"}); err != nil {
		t.Fatal(err)
	}
	supervisor := &heldWorkspaceHost{opened: make(chan struct{}), stopped: make(chan struct{})}
	d := Daemon{DB: db, Host: supervisor, Control: &control.Client{}, Boot: "boot"}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	d.Frame(ctx, protocol.Frame{Type: protocol.Effect, Operation: &open})
	select {
	case <-supervisor.opened:
	case <-ctx.Done():
		t.Fatal("open did not reach host")
	}
	if err = d.Reconcile(ctx, protocol.RunnerInventory{Dispatches: []protocol.Dispatch{dispatch}, Operations: []protocol.Operation{open}}); err != nil {
		t.Fatal(err)
	}
	d.Frame(ctx, protocol.Frame{Type: protocol.Effect, Operation: &stop})
	select {
	case <-supervisor.stopped:
	case <-ctx.Done():
		t.Fatal("blocked fetch prevented Stop")
	}
	d.workers.Wait()
	result, err := db.Effect("open")
	if err != nil || result == nil || result.Success || result.CancelledByOperationID == nil {
		t.Fatal("cancelled open not terminal", err, result)
	}
	before := supervisor.calls.Load()
	_ = d.effect(ctx, open)
	if supervisor.calls.Load() != before {
		t.Fatal("cancelled open restarted physical effect")
	}
}
