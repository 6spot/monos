package daemon

import (
	"context"
	"errors"
	protocol "monos.local/protocol"
	"monos.local/runner/internal/control"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/journal"
	"os"
	"path/filepath"
	"testing"
)

type fakeSupervisor struct {
	Status host.Status
	Err    error
	Calls  []host.Request
}

func TestOnlyTypedCaptureFailureIsBlocking(t *testing.T) {
	for _, test := range []struct {
		name string
		err  error
		kind protocol.FailureKind
	}{{"transient", errors.New("permission or IO needs repair"), protocol.Recoverable}, {"capture", &host.EffectError{Kind: protocol.CaptureHardLimit, Cause: errors.New("storage limit")}, protocol.CaptureHardLimit}, {"invalid-result", &host.EffectError{Kind: protocol.InvalidFinalization, Cause: errors.New("recorded identity mismatch")}, protocol.InvalidFinalization}} {
		t.Run(test.name, func(t *testing.T) {
			db := testDB(t)
			dispatch := protocol.Dispatch{AttemptID: "a", DispatchID: "d"}
			if err := db.SaveStart(journal.Start{Dispatch: dispatch, Phase: "running"}); err != nil {
				t.Fatal(err)
			}
			daemon := Daemon{DB: db, Host: &fakeSupervisor{Err: test.err}, Control: &control.Client{}}
			_ = daemon.effect(context.Background(), protocol.Operation{SchemaVersion: 1, OperationID: "o", AttemptID: "a", DispatchID: "d", RequestID: "r", Kind: protocol.KindCompleteNode, ResourceID: "repo", State: protocol.StateAdmitted})
			result, err := db.Effect("o")
			if err != nil || result == nil || result.Success || result.FailureKind == nil || *result.FailureKind != test.kind {
				t.Fatalf("classification %+v %v", result, err)
			}
			start, _ := db.Start("a")
			if start.Phase != "running" {
				t.Fatal("failure released unresolved ownership")
			}
		})
	}
}

func (f *fakeSupervisor) Call(_ context.Context, r host.Request) (host.Status, error) {
	f.Calls = append(f.Calls, r)
	return f.Status, f.Err
}
func testDB(t *testing.T) *journal.DB {
	t.Helper()
	dir := t.TempDir()
	os.Chmod(dir, 0700)
	db, err := journal.Open(filepath.Join(dir, "journal.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}
func TestDuplicateStartNeverSpawnsAgain(t *testing.T) {
	db := testDB(t)
	dispatch := protocol.Dispatch{AttemptID: "a", DispatchID: "d"}
	if err := db.SaveStart(journal.Start{Dispatch: dispatch, Phase: "running", BootID: "boot", Cgroup: "/system.slice/monos-probe-a-a.service"}); err != nil {
		t.Fatal(err)
	}
	supervisor := &fakeSupervisor{}
	daemon := Daemon{DB: db, Host: supervisor, Control: &control.Client{}, Boot: "boot"}
	_ = daemon.start(context.Background(), dispatch)
	if len(supervisor.Calls) != 0 {
		t.Fatal("duplicate spawn")
	}
	events, err := db.PendingEvents()
	if err != nil || len(events) != 1 || events[0].Kind != protocol.Started {
		t.Fatal("lost acknowledgement not retained")
	}
}
func TestReconcileBootChangeDoesNotReviveOldOwnership(t *testing.T) {
	db := testDB(t)
	dispatch := protocol.Dispatch{AttemptID: "a", DispatchID: "d", MutationAllowed: true}
	if err := db.SaveStart(journal.Start{Dispatch: dispatch, Phase: "running", BootID: "old", Cgroup: "/system.slice/monos-probe-a-a.service"}); err != nil {
		t.Fatal(err)
	}
	supervisor := &fakeSupervisor{Status: host.Status{Known: true, BootID: "new", Populated: false}}
	daemon := Daemon{DB: db, Host: supervisor, Boot: "new"}
	if err := daemon.Reconcile(context.Background(), protocol.RunnerInventory{Dispatches: []protocol.Dispatch{dispatch}}); err != nil {
		t.Fatal(err)
	}
	s, err := db.Start("a")
	if err != nil || s.Phase != "absent" {
		t.Fatal("old ownership revived")
	}
	events, err := db.PendingEvents()
	if err != nil || len(events) != 1 || events[0].Kind != protocol.ProcessAbsent {
		t.Fatal("reconciled absence not queued before ready")
	}
}
func TestUnmatchedLiveOwnershipBlocksReady(t *testing.T) {
	db := testDB(t)
	if err := db.SaveStart(journal.Start{Dispatch: protocol.Dispatch{AttemptID: "a", DispatchID: "d"}, Phase: "running", BootID: "boot"}); err != nil {
		t.Fatal(err)
	}
	daemon := Daemon{DB: db, Host: &fakeSupervisor{Status: host.Status{Known: true, BootID: "boot", Populated: true, Cgroup: "/system.slice/monos-probe-a-a.service"}}}
	if err := daemon.Reconcile(context.Background(), protocol.RunnerInventory{}); err == nil {
		t.Fatal("unknown live writer released")
	}
	s, _ := db.Start("a")
	if s.Phase != "running" {
		t.Fatal("uncertain claim released")
	}
}

func TestReusedPIDCannotReviveOwnership(t *testing.T) {
	db := testDB(t)
	dispatch := protocol.Dispatch{AttemptID: "a", DispatchID: "d", MutationAllowed: true}
	s := journal.Start{Dispatch: dispatch, BootID: "boot", PID: 42, Birth: "old", Cgroup: "/system.slice/monos-probe-a-a.service", Phase: "running"}
	if err := db.SaveStart(s); err != nil {
		t.Fatal(err)
	}
	daemon := Daemon{DB: db, Host: &fakeSupervisor{Status: host.Status{Known: true, BootID: "boot", PID: 42, Birth: "new", Cgroup: s.Cgroup, Populated: true}}}
	if err := daemon.Reconcile(context.Background(), protocol.RunnerInventory{Dispatches: []protocol.Dispatch{dispatch}}); err == nil {
		t.Fatal("PID reuse accepted")
	}
}

func TestMissingManifestDoesNotReleaseClaim(t *testing.T) {
	db := testDB(t)
	dispatch := protocol.Dispatch{AttemptID: "a", DispatchID: "d", MutationAllowed: true}
	if err := db.SaveStart(journal.Start{Dispatch: dispatch, Phase: "running", BootID: "boot"}); err != nil {
		t.Fatal(err)
	}
	daemon := Daemon{DB: db, Host: &fakeSupervisor{Status: host.Status{Known: false}}}
	if err := daemon.Reconcile(context.Background(), protocol.RunnerInventory{Dispatches: []protocol.Dispatch{dispatch}}); err == nil {
		t.Fatal("missing manifest treated as absence")
	}
	s, _ := db.Start("a")
	if s.Phase != "running" {
		t.Fatal("unknown writer released")
	}
}

func TestReconcileCaptureExitPublishesFailureBeforeAbsenceWithoutMarker(t *testing.T) {
	db := testDB(t)
	dispatch := protocol.Dispatch{AttemptID: "no-marker", DispatchID: "d", MutationAllowed: true}
	if err := db.SaveStart(journal.Start{Dispatch: dispatch, Phase: "running", BootID: "boot"}); err != nil {
		t.Fatal(err)
	}
	code := int64(host.CaptureFailureExitCode)
	daemon := Daemon{DB: db, Host: &fakeSupervisor{Status: host.Status{Known: true, BootID: "boot", MainExited: true, ExitCode: &code, CaptureFailed: true}}, Control: &control.Client{}, Boot: "boot"}
	if err := daemon.Reconcile(context.Background(), protocol.RunnerInventory{Dispatches: []protocol.Dispatch{dispatch}}); err != nil {
		t.Fatal(err)
	}
	events, err := db.PendingEvents()
	if err != nil || len(events) != 3 || events[0].Kind != protocol.CaptureFailed || events[1].Kind != protocol.Exited || events[2].Kind != protocol.ProcessAbsent {
		t.Fatalf("capture failure missing before absence: %+v %v", events, err)
	}
}

func TestFastCaptureExitRetainsFailureWhenStartSendFails(t *testing.T) {
	db := testDB(t)
	supervisor := &fakeSupervisor{Status: host.Status{Known: true, BootID: "boot"}}
	daemon := Daemon{DB: db, Host: supervisor, Control: &control.Client{}, Boot: "boot"}
	dispatch := protocol.Dispatch{AttemptID: "fast-exit", DispatchID: "d"}
	code := int64(host.CaptureFailureExitCode)
	err := daemon.recordLaunch(context.Background(), journal.Start{Dispatch: dispatch, BootID: "boot", Phase: "intent"}, host.Status{Known: true, BootID: "boot", MainExited: true, ExitCode: &code, CaptureFailed: true})
	if err == nil {
		t.Fatal("expected interrupted Start delivery")
	}
	events, err := db.PendingEvents()
	if err != nil || len(events) != 3 || events[0].Kind != protocol.Started || events[1].Kind != protocol.CaptureFailed || events[2].Kind != protocol.Exited {
		t.Fatalf("fast output failure lost: %+v %v", events, err)
	}
	if len(supervisor.Calls) != 1 || supervisor.Calls[0].Action != "stop" {
		t.Fatalf("writer stop was not requested: %+v", supervisor.Calls)
	}
}

func TestMainExitWithLiveDescendantsIsObservedOnceWithoutReleasingOwnership(t *testing.T) {
	db := testDB(t)
	dispatch := protocol.Dispatch{AttemptID: "detached", DispatchID: "d", MutationAllowed: true}
	if err := db.SaveStart(journal.Start{Dispatch: dispatch, Phase: "running", BootID: "boot", Cgroup: "/system.slice/monos-probe-a-detached.service"}); err != nil {
		t.Fatal(err)
	}
	code := int64(0)
	supervisor := &fakeSupervisor{Status: host.Status{Known: true, BootID: "boot", Exists: true, MainExited: true, ExitCode: &code, Populated: true, Cgroup: "/system.slice/monos-probe-a-detached.service"}}
	daemon := Daemon{DB: db, Host: supervisor, Control: &control.Client{}, Boot: "boot"}
	inventory := protocol.RunnerInventory{Dispatches: []protocol.Dispatch{dispatch}}
	for range 2 {
		if err := daemon.Reconcile(context.Background(), inventory); err != nil {
			t.Fatal(err)
		}
	}
	events, err := db.PendingEvents()
	if err != nil || len(events) != 1 || events[0].Kind != protocol.Exited || events[0].ExitCode == nil || *events[0].ExitCode != 0 {
		t.Fatalf("main exit missing or repeated: %+v %v", events, err)
	}
	s, err := db.Start(dispatch.AttemptID)
	if err != nil || s.Phase != "running" {
		t.Fatalf("live descendants released: %+v %v", s, err)
	}
	dispatch.MutationAllowed = false // Backend revoked writes and admitted Stop.
	if err := daemon.Reconcile(context.Background(), protocol.RunnerInventory{Dispatches: []protocol.Dispatch{dispatch}}); err != nil {
		t.Fatal(err)
	}
	if len(supervisor.Calls) != 4 || supervisor.Calls[3].Action != "stop" {
		t.Fatalf("revoked live cgroup did not request Stop: %+v", supervisor.Calls)
	}
	s, err = db.Start(dispatch.AttemptID)
	if err != nil || s.Phase != "running" {
		t.Fatalf("unverified writer absence released: %+v %v", s, err)
	}
}

func TestCompleteUTF8PrefixPreservesFrameBoundaryAndMalformedBytes(t *testing.T) {
	cases := []struct {
		name  string
		input []byte
		want  int
	}{
		{"complete", []byte("before界after"), len([]byte("before界after"))},
		{"split rune", []byte{'a', 0xe7, 0x95}, 1},
		{"incomplete alone", []byte{0xf0, 0x9f}, 0},
		{"malformed byte", []byte{'a', 0xff, 'b'}, 3},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := completeUTF8Prefix(test.input); got != test.want {
				t.Fatalf("complete prefix = %d, want %d", got, test.want)
			}
		})
	}
}

func TestServiceCaptureMarkerSurvivesRetry(t *testing.T) {
	path := filepath.Join(t.TempDir(), "capture-attempt")
	if captureMarkerSet(path) {
		t.Fatal("missing marker reported failure")
	}
	if err := reserveCaptureMarker(path); err != nil {
		t.Fatal(err)
	}
	if err := reserveCaptureMarker(path); err != nil {
		t.Fatal("reserved marker was not retryable:", err)
	}
	if captureMarkerSet(path) {
		t.Fatal("clean reserved marker reported failure")
	}
	for range 2 {
		if err := persistCaptureMarker(path); err != nil {
			t.Fatal(err)
		}
		if !captureMarkerSet(path) {
			t.Fatal("capture failure marker was not retained")
		}
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm()&0077 != 0 {
		t.Fatalf("marker is not service-private: %v %v", info, err)
	}
	if err := reserveCaptureMarker(path); err == nil {
		t.Fatal("failed marker was accepted for a new launch")
	}
}
