package host

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"monos.local/runner/internal/resources"
)

func TestLogRetirementOnlyRemovesExactOwnedSpools(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "attempt.stdout")
	errs := filepath.Join(dir, "attempt.stderr")
	for path, body := range map[string]string{out: "abc", errs: "error", filepath.Join(dir, "unrelated"): "keep"} {
		if err := os.WriteFile(path, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	r := LogRetirement{DispatchID: "dispatch", StdoutBytes: 3, StderrBytes: 4}
	if err := retireLogFiles(dir, "attempt", r, uint32(os.Geteuid())); err == nil {
		t.Fatal("changed spool size allowed deletion")
	}
	if _, err := os.Stat(out); err != nil {
		t.Fatal("partial cleanup before validating second spool", err)
	}
	r.StderrBytes = 5
	if err := retireLogFiles(dir, "attempt", r, uint32(os.Geteuid())); err != nil {
		t.Fatal(err)
	}
	if err := retireLogFiles(dir, "attempt", r, uint32(os.Geteuid())); err != nil {
		t.Fatal("crash retry failed", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "unrelated")); err != nil {
		t.Fatal("unrelated file removed")
	}
	if err := os.Symlink(filepath.Join(dir, "unrelated"), out); err != nil {
		t.Fatal(err)
	}
	if err := retireLogFiles(dir, "attempt", r, uint32(os.Geteuid())); err == nil {
		t.Fatal("aliased spool accepted")
	}
}

func TestInspectionRetirementPreservesProofAndRefusesLiveWorker(t *testing.T) {
	root, op, f := inspectionFixture(t, "retire")
	out, err := inspectRepositoryAt(context.Background(), root, "storage", op, nil, localInspectionFetch(t, f, nil))
	if err != nil || out.Inspection.Status != "available" {
		t.Fatal(out, err)
	}
	op.Result = &out
	op.State = "succeeded"
	s := &inspectionSession{root: root, operation: op}
	path := filepath.Join(s.private(), "record.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(raw, &s.record); err != nil {
		t.Fatal(err)
	}
	s.record.WorkerActive = true
	if err = s.save(); err != nil {
		t.Fatal(err)
	}
	if err = retireInspectionAt(context.Background(), root, "storage", op); !errors.Is(err, ErrInspectionUnresolved) {
		t.Fatal("live worker snapshot retired", err)
	}
	s.record.WorkerActive = false
	if err = s.save(); err != nil {
		t.Fatal(err)
	}
	unknown := filepath.Join(s.private(), "unrelated")
	if err = os.WriteFile(unknown, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = retireInspectionAt(context.Background(), root, "storage", op); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(s.snapshot()); !os.IsNotExist(err) {
		t.Fatal("snapshot not cleaned", err)
	}
	if _, err = os.Stat(filepath.Join(s.private(), "repository.git")); !os.IsNotExist(err) {
		t.Fatal("private clone not cleaned", err)
	}
	for _, path := range []string{path, unknown} {
		if _, err = os.Stat(path); err != nil {
			t.Fatal("proof or unknown file deleted", err)
		}
	}
	if err = retireInspectionAt(context.Background(), root, "storage", op); err != nil {
		t.Fatal("retirement retry failed", err)
	}
	if _, err = inspectRepositoryAt(context.Background(), root, "storage", op, nil, nil); !errors.Is(err, ErrInspectionRetired) {
		t.Fatal("retired result replayed or rematerialized", err)
	}
}

func TestInspectionLowStorageReturnsUnavailableBeforeFetch(t *testing.T) {
	root, op, _ := inspectionFixture(t, "low-storage")
	m, err := resources.New(resources.Config{}, root, filepath.Join(root, "service", "db"))
	if err != nil {
		t.Fatal(err)
	}
	m.Stat = func(string) (int64, int64, error) { return 0, 100, nil }
	called := false
	out, err := inspectRepositoryAt(resources.WithMonitor(context.Background(), m), root, "storage", op, nil, func(context.Context, *inspectionSession) (string, string, string, error) {
		called = true
		return "", "", "", nil
	})
	if err != nil || called || out.Inspection == nil || out.Inspection.Reason == nil || string(*out.Inspection.Reason) != "resource_unavailable" {
		t.Fatal(out, called, err)
	}
	if out.WriterAbsent != nil {
		t.Fatal("storage attention fabricated process absence")
	}
}
