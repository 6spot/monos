package daemon

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/control"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/journal"
)

func TestRuntimeFailureExitAndAbsenceSurviveACKAndDaemonRecovery(t *testing.T) {
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "journal.sqlite")
	db, err := journal.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	dispatch := protocol.Dispatch{AttemptID: "a", DispatchID: "d", MutationAllowed: true}
	start := journal.Start{Dispatch: dispatch, Phase: "running", BootID: "boot", Cgroup: "/system.slice/" + host.Unit("a")}
	if err = db.SaveStart(start); err != nil {
		t.Fatal(err)
	}
	code := int64(host.RuntimeFailureExitCode)
	supervisor := &fakeSupervisor{Status: host.Status{Known: true, MainExited: true, RuntimeFailed: true, ExitCode: &code, Populated: true, BootID: "boot", Cgroup: start.Cgroup}}
	d := Daemon{DB: db, Host: supervisor, Control: &control.Client{}, Boot: "boot"}
	inventory := protocol.RunnerInventory{Dispatches: []protocol.Dispatch{dispatch}}
	for range 2 {
		if err = d.Reconcile(context.Background(), inventory); err != nil {
			t.Fatal(err)
		}
	}
	events, err := db.PendingEvents()
	if err != nil || len(events) != 1 || events[0].Kind != protocol.Exited || events[0].RuntimeFailure == nil || *events[0].RuntimeFailure != protocol.NativeTerminalError {
		t.Fatal("missing/repeated exit proof", events, err)
	}
	original := events[0]
	retained, err := db.Start("a")
	if err != nil || retained.Phase != "running" {
		t.Fatal("descendant ownership released", retained, err)
	}
	if err = db.Ack("a", "runtime", original.Sequence); err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = journal.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	// Reboot/unit removal no longer exposes the original systemd exit. Only
	// the service journal can carry its exact failure proof into absence.
	supervisor = &fakeSupervisor{Status: host.Status{Known: true, BootID: "new-boot"}}
	d = Daemon{DB: db, Host: supervisor, Control: &control.Client{}, Boot: "new-boot"}
	if err = d.Reconcile(context.Background(), inventory); err != nil {
		t.Fatal(err)
	}
	events, err = db.PendingEvents()
	if err != nil || len(events) != 1 || events[0].Kind != protocol.ProcessAbsent || events[0].RuntimeFailure == nil || *events[0].RuntimeFailure != protocol.NativeTerminalError {
		t.Fatal("ACKed exit proof did not reach later absence", events, err)
	}
	absence := events[0]
	if err = db.Ack("a", "runtime", absence.Sequence); err != nil {
		t.Fatal(err)
	}
	// Duplicate Start recovery must resend the immutable absence, not allocate
	// another formal event or overwrite the original exit/boot facts.
	_ = d.start(context.Background(), dispatch)
	events, err = db.PendingEvents()
	if err != nil || len(events) != 0 {
		t.Fatal("absence replay allocated another event", events, err)
	}
	stillOriginal, found, err := db.TerminalEvent("a", "d", protocol.Exited)
	if err != nil || !found || !reflect.DeepEqual(stillOriginal, original) {
		t.Fatal("original exit mutated", stillOriginal, err)
	}
	stillAbsent, found, err := db.TerminalEvent("a", "d", protocol.ProcessAbsent)
	if err != nil || !found || !reflect.DeepEqual(stillAbsent, absence) {
		t.Fatal("original absence mutated", stillAbsent, err)
	}
}

func TestFastRuntimeFailureRetainsBothTerminalEventsWhenStartSendFails(t *testing.T) {
	db := testDB(t)
	d := Daemon{DB: db, Host: &fakeSupervisor{}, Control: &control.Client{}, Boot: "boot"}
	dispatch := protocol.Dispatch{AttemptID: "fast", DispatchID: "dispatch"}
	code := int64(host.RuntimeFailureExitCode)
	err := d.recordLaunch(context.Background(), journal.Start{Dispatch: dispatch, BootID: "boot", Phase: "intent"}, host.Status{Known: true, BootID: "boot", MainExited: true, RuntimeFailed: true, ExitCode: &code})
	if err == nil {
		t.Fatal("lost interrupted Start send error")
	}
	events, err := db.PendingEvents()
	if err != nil || len(events) != 3 || events[0].Kind != protocol.KindStarted || events[1].Kind != protocol.Exited || events[2].Kind != protocol.ProcessAbsent {
		t.Fatal("fast terminal events not retained", events, err)
	}
	for _, event := range events[1:] {
		if event.RuntimeFailure == nil || *event.RuntimeFailure != protocol.NativeTerminalError {
			t.Fatal("fast terminal event lost trusted failure", event)
		}
	}
	start, err := db.Start(dispatch.AttemptID)
	if err != nil || start.Phase != "absent" {
		t.Fatal("verified absence not saved after terminal events", start, err)
	}
}

func TestAbsenceDoesNotInventRuntimeFailureAndCaptureTakesPriority(t *testing.T) {
	for _, mode := range []string{"ordinary", "capture", "unknown", "foreign-dispatch"} {
		t.Run(mode, func(t *testing.T) {
			db := testDB(t)
			d := Daemon{DB: db, Boot: "boot"}
			start := journal.Start{Dispatch: protocol.Dispatch{AttemptID: "a", DispatchID: "d"}}
			code := int64(host.RuntimeFailureExitCode)
			status := host.Status{Known: true, MainExited: true, ExitCode: &code}
			switch mode {
			case "capture":
				status.RuntimeFailed = true
				if _, err := db.Event(protocol.RuntimeEvent{AttemptID: "a", DispatchID: "d", StreamID: "runtime", Kind: protocol.CaptureFailed}); err != nil {
					t.Fatal(err)
				}
			case "unknown":
				status.Known, status.RuntimeFailed = false, true
			case "foreign-dispatch":
				failure := protocol.NativeTerminalError
				if _, err := db.Event(protocol.RuntimeEvent{AttemptID: "a", DispatchID: "other", StreamID: "runtime", Kind: protocol.Exited, RuntimeFailure: &failure}); err != nil {
					t.Fatal(err)
				}
			}
			if err := d.observeMainExit(start, status); err != nil {
				t.Fatal(err)
			}
			absent, err := d.retainAbsence(start, "verified absence")
			if err != nil || absent.RuntimeFailure != nil {
				t.Fatal("absence invented runtime proof", absent, err)
			}
			exit, _, err := db.TerminalEvent("a", "d", protocol.Exited)
			if err != nil || exit.RuntimeFailure != nil {
				t.Fatal("exit invented runtime proof", exit, err)
			}
		})
	}
}

func TestSuccessfulStopRetainsRuntimeFailureBeforeAbsenceAndResult(t *testing.T) {
	db := testDB(t)
	dispatch, op := recoveryFixture(t, "terminal-stop", protocol.Stop)
	if err := db.SaveStart(journal.Start{Dispatch: dispatch, Phase: "running", BootID: "boot"}); err != nil {
		t.Fatal(err)
	}
	code := int64(host.RuntimeFailureExitCode)
	supervisor := &fakeSupervisor{Status: host.Status{Known: true, MainExited: true, RuntimeFailed: true, ExitCode: &code, BootID: "boot", Result: &protocol.EffectResult{WriterAbsent: nodeBool(true)}}}
	d := Daemon{DB: db, Host: supervisor, Control: &control.Client{}, Boot: "boot"}
	_ = d.effect(context.Background(), op)
	result, err := db.Effect(op.OperationID)
	if err != nil || result == nil || !result.Success {
		t.Fatal("Stop result not retained", result, err)
	}
	events, err := db.PendingEvents()
	if err != nil || len(events) != 2 || events[0].Kind != protocol.Exited || events[1].Kind != protocol.ProcessAbsent {
		t.Fatal("Stop dropped terminal facts", events, err)
	}
	for _, event := range events {
		if event.RuntimeFailure == nil || *event.RuntimeFailure != protocol.NativeTerminalError {
			t.Fatal("Stop lost failure proof", event)
		}
	}
	start, err := db.Start(dispatch.AttemptID)
	if err != nil || start.Phase != "absent" {
		t.Fatal("Stop phase not saved", start, err)
	}
	_ = d.effect(context.Background(), op)
	events, err = db.PendingEvents()
	if err != nil || len(events) != 2 || len(supervisor.Calls) != 1 {
		t.Fatal("terminal Stop replay repeated effects or events", events, supervisor.Calls, err)
	}
}
