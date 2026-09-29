package daemon

import (
	"context"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/control"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/journal"
)

func todoInventory() (protocol.Operation, protocol.RunnerInventory) {
	op, inventory := revokedInventory()
	d := &inventory.Dispatches[0]
	d.TaskID, d.ResourceID = nil, nil
	d.TodoID, d.SourceMessageID = ptr("todo"), ptr("source")
	d.Kind = "planner"
	op.ResourceID = nil
	inventory.Operations[0] = op
	return op, inventory
}

func TestTodoNeverLaunchedStopRetainsTombstoneAndExactReplay(t *testing.T) {
	db := testDB(t)
	op, inventory := todoInventory()
	supervisor := &fakeSupervisor{Status: host.Status{Known: true, BootID: "boot"}}
	d := Daemon{DB: db, Host: supervisor, Control: &control.Client{}, Boot: "boot"}
	if _, err := d.unstartedRevocation(context.Background(), op, inventory); err != nil {
		t.Fatal(err)
	}
	_ = d.effect(context.Background(), op)
	result, err := db.Effect(op.OperationID)
	if err != nil || result == nil || !result.Success || result.Result.WriterAbsent == nil || !*result.Result.WriterAbsent {
		t.Fatal("Todo Stop did not retain absence", err)
	}
	calls := len(supervisor.Calls)
	_ = d.effect(context.Background(), op)
	if len(supervisor.Calls) != calls {
		t.Fatal("lost result replayed physical Stop")
	}
	late := inventory.Dispatches[0]
	late.MutationAllowed = true
	if d.start(context.Background(), late) == nil || len(supervisor.Calls) != calls {
		t.Fatal("Todo late Start escaped cancellation tombstone")
	}
}

func TestTodoRepositoryEffectIsRejectedBeforeAnyHostAccess(t *testing.T) {
	for _, kind := range []protocol.OperationKind{protocol.KindInspectRepository, protocol.KindOpenWorkspace, protocol.KindCompleteNode} {
		db := testDB(t)
		op, inventory := todoInventory()
		op.Kind, op.ResourceID = kind, ptr("fixture")
		if err := db.SaveStart(journal.Start{Dispatch: inventory.Dispatches[0], Phase: "running", BootID: "boot"}); err != nil {
			t.Fatal(err)
		}
		supervisor := &fakeSupervisor{}
		d := Daemon{DB: db, Host: supervisor, Control: &control.Client{}, Boot: "boot"}
		if err := d.effect(context.Background(), op); err == nil || err.Error() != "Todo repository effects are unavailable" {
			t.Fatalf("repository request passed scope guard: %v", err)
		}
		if len(supervisor.Calls) != 0 {
			t.Fatal("Todo reached host repository execution")
		}
		result, err := db.Effect(op.OperationID)
		if err != nil || result != nil {
			t.Fatal("denied operation fabricated a result", err)
		}
	}
}

func TestTodoBootChangeReportsAbsenceWithoutReplyOrNewStart(t *testing.T) {
	db := testDB(t)
	_, inventory := todoInventory()
	dispatch := inventory.Dispatches[0]
	if err := db.SaveStart(journal.Start{Dispatch: dispatch, Phase: "running", BootID: "old", Cgroup: "/system.slice/monos-probe-a-a.service"}); err != nil {
		t.Fatal(err)
	}
	supervisor := &fakeSupervisor{Status: host.Status{Known: true, BootID: "new"}}
	d := Daemon{DB: db, Host: supervisor, Boot: "new"}
	if err := d.Reconcile(context.Background(), inventory); err != nil {
		t.Fatal(err)
	}
	events, err := db.PendingEvents()
	if err != nil || len(events) != 1 || events[0].Kind != protocol.ProcessAbsent {
		t.Fatal("Todo reboot emitted a false phase outcome", err)
	}
	retained, err := db.Start(dispatch.AttemptID)
	if err != nil || retained.Phase != "absent" || retained.Dispatch.TodoID == nil || *retained.Dispatch.TodoID != "todo" {
		t.Fatal("Todo ownership lost on reboot", err)
	}
	if len(supervisor.Calls) != 1 || supervisor.Calls[0].Action != "status" {
		t.Fatal("reboot started new Todo work")
	}
}
