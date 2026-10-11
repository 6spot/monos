package daemon

import (
	"context"
	"errors"
	"fmt"
	protocol "monos.local/protocol"
	"monos.local/runner/internal/control"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/journal"
	"testing"
)

func revokedInventory() (protocol.Operation, protocol.RunnerInventory) {
	dispatch := protocol.Dispatch{AttemptID: "a", DispatchID: "d", RunnerID: "runner", TaskID: ptr("task"), ResourceID: ptr("repo"), Kind: protocol.Node, RuntimeID: protocol.Opencode, Model: "opencode/mimo-v2.6-flash-free", MutationAllowed: false}
	op := protocol.Operation{SchemaVersion: 1, OperationID: "stop-a", AttemptID: "a", DispatchID: "d", RequestID: "r", ResourceID: ptr("repo"), Kind: protocol.Stop, State: protocol.FluffyAdmitted}
	return op, protocol.RunnerInventory{SchemaVersion: 1, SnapshotID: "snapshot", Dispatches: []protocol.Dispatch{dispatch}, Operations: []protocol.Operation{op}}
}
func TestNeverDeliveredRevokeWritesTombstoneBeforeStopAndRejectsLateStart(t *testing.T) {
	db := testDB(t)
	supervisor := &fakeSupervisor{Status: host.Status{Known: true, BootID: "boot"}}
	d := Daemon{DB: db, Host: supervisor, Control: &control.Client{}, Boot: "boot"}
	op, inventory := revokedInventory()
	s, err := d.unstartedRevocation(context.Background(), op, inventory)
	if err != nil {
		t.Fatal(err)
	}
	if s.Phase != "revoked" || len(supervisor.Calls) != 1 || supervisor.Calls[0].Action != "tombstone" {
		t.Fatal("revocation not fenced")
	}
	_ = d.effect(context.Background(), op)
	result, err := db.Effect(op.OperationID)
	if err != nil || result == nil || !result.Success || result.Result.WriterAbsent == nil || !*result.Result.WriterAbsent {
		t.Fatalf("Stop did not settle: %+v %v", result, err)
	}
	calls := len(supervisor.Calls)
	late := inventory.Dispatches[0]
	late.MutationAllowed = true
	if d.start(context.Background(), late) == nil {
		t.Fatal("late Start accepted")
	}
	if len(supervisor.Calls) != calls {
		t.Fatal("late Start reached privileged launcher")
	}
	events, _ := db.PendingEvents()
	if len(events) != 0 {
		t.Fatal("never-launched attempt falsely emitted runtime lifecycle")
	}
}
func TestUnconfirmedNeverLaunchedRevocationRetainsClaim(t *testing.T) {
	db := testDB(t)
	d := Daemon{DB: db, Host: &fakeSupervisor{Err: errors.New("unit/job state unresolved")}, Boot: "boot"}
	op, inventory := revokedInventory()
	if _, err := d.unstartedRevocation(context.Background(), op, inventory); err == nil {
		t.Fatal("uncertain helper accepted")
	}
	s, err := db.Start("a")
	if err != nil || s.Phase != "cancel_intent" {
		t.Fatal("revocation intent lost")
	}
	events, _ := db.PendingEvents()
	if len(events) != 0 {
		t.Fatal("uncertain absence emitted")
	}
	d.Host = &fakeSupervisor{Status: host.Status{Known: true, BootID: "boot"}}
	if err = d.Reconcile(context.Background(), inventory); err != nil {
		t.Fatal(err)
	}
	s, _ = db.Start("a")
	if s.Phase != "revoked" {
		t.Fatal("retained revocation did not recover")
	}
}

type functionSupervisor func(context.Context, host.Request) (host.Status, error)

func (f functionSupervisor) Call(ctx context.Context, r host.Request) (host.Status, error) {
	return f(ctx, r)
}
func TestRevokedPrepareFailureCanReconcileOnlyAfterPhysicalTombstone(t *testing.T) {
	db := testDB(t)
	op, inventory := revokedInventory()
	initial := inventory.Dispatches[0]
	initial.MutationAllowed = true
	if err := db.SaveStart(journal.Start{Dispatch: initial, BootID: "boot", Phase: "intent"}); err != nil {
		t.Fatal(err)
	}
	tombstoned := false
	supervisor := functionSupervisor(func(_ context.Context, r host.Request) (host.Status, error) {
		if r.Action == "tombstone" {
			tombstoned = true
			return host.Status{Known: true, BootID: "boot"}, nil
		}
		return host.Status{Known: tombstoned, BootID: "boot"}, nil
	})
	d := Daemon{DB: db, Host: supervisor, Control: &control.Client{}, Boot: "boot"}
	if err := d.Reconcile(context.Background(), inventory); err != nil {
		t.Fatal(err)
	}
	if !tombstoned {
		t.Fatal("absence inferred without root proof")
	}
	_ = d.effect(context.Background(), op)
	result, _ := db.Effect(op.OperationID)
	if result == nil || !result.Success {
		t.Fatal("verified never-launched Stop not released")
	}
}
func TestLiveOrUnrevokedStartCannotUseNeverLaunchedPath(t *testing.T) {
	for _, state := range []string{"running", "unrevoked"} {
		t.Run(state, func(t *testing.T) {
			db := testDB(t)
			op, inventory := revokedInventory()
			if state == "running" {
				if err := db.SaveStart(journal.Start{Dispatch: inventory.Dispatches[0], Phase: "running"}); err != nil {
					t.Fatal(err)
				}
			} else {
				inventory.Dispatches[0].MutationAllowed = true
			}
			supervisor := &fakeSupervisor{}
			d := Daemon{DB: db, Host: supervisor, Boot: "boot"}
			if _, err := d.unstartedRevocation(context.Background(), op, inventory); err == nil {
				t.Fatal("invalid cancellation accepted")
			}
			if len(supervisor.Calls) != 0 {
				t.Fatal("invalid revocation reached helper")
			}
		})
	}
}
func TestRepeatedFramesHaveSingleFlightAndBoundedQueue(t *testing.T) {
	d := Daemon{}
	ctx, cancel := context.WithCancel(context.Background())
	d.mu.Lock()
	for n := 0; n < 1000; n++ {
		d.Frame(ctx, protocol.Frame{Type: protocol.Start, Dispatch: &protocol.Dispatch{DispatchID: "one"}})
	}
	d.queueMu.Lock()
	count := len(d.queued)
	d.queueMu.Unlock()
	if count != 1 {
		t.Fatalf("duplicate backlog %d", count)
	}
	for n := 0; n < 1000; n++ {
		d.Frame(ctx, protocol.Frame{Type: protocol.Effect, Operation: &protocol.Operation{OperationID: fmt.Sprint(n)}})
	}
	d.queueMu.Lock()
	count = len(d.queued)
	d.queueMu.Unlock()
	if count != 64 {
		t.Fatalf("queue escaped bound: %d", count)
	}
	cancel()
	d.mu.Unlock()
	d.workers.Wait()
}

func TestRevokedPrepareFailureRequiresMatchingAdmittedStop(t *testing.T) {
	for _, mismatch := range []string{"missing_stop", "other_dispatch", "changed_resource"} {
		t.Run(mismatch, func(t *testing.T) {
			db := testDB(t)
			_, inventory := revokedInventory()
			initial := inventory.Dispatches[0]
			initial.MutationAllowed = true
			if err := db.SaveStart(journal.Start{Dispatch: initial, BootID: "boot", Phase: "intent"}); err != nil {
				t.Fatal(err)
			}
			switch mismatch {
			case "missing_stop":
				inventory.Operations = nil
			case "other_dispatch":
				inventory.Operations[0].DispatchID = "another-dispatch"
			case "changed_resource":
				inventory.Dispatches[0].ResourceID = ptr("another-resource")
			}
			supervisor := &fakeSupervisor{}
			d := Daemon{DB: db, Host: supervisor, Boot: "boot"}
			if err := d.Reconcile(context.Background(), inventory); err == nil {
				t.Fatal("released ambiguous failed-prepare ownership")
			}
			for _, call := range supervisor.Calls {
				if call.Action != "status" {
					t.Fatal("invalid revocation reached a mutating helper action")
				}
			}
			retained, err := db.Start("a")
			if err != nil || retained.Phase != "intent" {
				t.Fatal("lost unresolved start intent")
			}
			events, err := db.PendingEvents()
			if err != nil || len(events) != 0 {
				t.Fatal("emitted absence without authoritative revocation")
			}
		})
	}
}
