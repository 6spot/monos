package daemon

import (
	"context"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/control"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/journal"
	"monos.local/runner/internal/resources"
)

func TestLowStorageLeavesStartRetryableWithoutIntentOrNativeFailure(t *testing.T) {
	db := testDB(t)
	supervisor := &fakeSupervisor{}
	m, err := resources.New(resources.Config{}, "/root", "/journal/db")
	if err != nil {
		t.Fatal(err)
	}
	m.Stat = func(string) (int64, int64, error) { return 0, 100, nil }
	d := Daemon{DB: db, Host: supervisor, Resources: m}
	if err = d.start(context.Background(), protocol.Dispatch{AttemptID: "low", DispatchID: "dispatch"}); err == nil {
		t.Fatal("low storage admitted Start")
	}
	starts, err := db.Starts()
	if err != nil || len(starts) != 0 || len(supervisor.Calls) != 0 {
		t.Fatal("low storage retained uncertain launch", starts, err)
	}
	logs, err := db.PendingEvents()
	if err != nil || len(logs) != 0 {
		t.Fatal("low storage manufactured runtime failure", logs, err)
	}
}

func TestRetiredSpoolIsNotCaptureFailureAndTerminalReplayRemains(t *testing.T) {
	db := testDB(t)
	s := journal.Start{Dispatch: protocol.Dispatch{AttemptID: "already-cleaned", DispatchID: "dispatch"}, Phase: "absent"}
	if err := db.SaveStart(s); err != nil {
		t.Fatal(err)
	}
	e, err := db.Event(protocol.RuntimeEvent{AttemptID: s.Dispatch.AttemptID, DispatchID: "dispatch", StreamID: "runtime", Kind: protocol.ProcessAbsent})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Ack(e.AttemptID, e.StreamID, e.Sequence); err != nil {
		t.Fatal(err)
	}
	if _, _, err = db.RetentionSince(e.AttemptID, "dispatch", 1); err != nil {
		t.Fatal(err)
	}
	if _, err = db.RetireLogs(e.AttemptID, "dispatch", 0, 0, 2); err != nil {
		t.Fatal(err)
	}
	supervisor := &fakeSupervisor{Status: host.Status{Known: true}}
	d := Daemon{DB: db, Host: supervisor, Control: &control.Client{}}
	d.Tick(context.Background())
	if capture, err := db.HasCaptureAlert(e.AttemptID); err != nil || capture {
		t.Fatal("intentional spool removal classified as capture failure", err)
	}
	if len(supervisor.Calls) != 0 {
		t.Fatal("cleanup caused repeated physical Stop")
	}
	if _, found, err := db.TerminalEvent(e.AttemptID, "dispatch", protocol.ProcessAbsent); err != nil || !found {
		t.Fatal(found, err)
	}
}
