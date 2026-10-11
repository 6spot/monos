package journal

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	protocol "monos.local/protocol"
)

func retentionFixture(t *testing.T, db *DB) (Start, protocol.RuntimeEvent, protocol.RuntimeEvent) {
	t.Helper()
	s := Start{Dispatch: protocol.Dispatch{AttemptID: "retention", DispatchID: "dispatch"}, Phase: "absent"}
	if err := db.SaveStart(s); err != nil {
		t.Fatal(err)
	}
	absent, err := db.Event(protocol.RuntimeEvent{AttemptID: "retention", DispatchID: "dispatch", StreamID: "runtime", Kind: protocol.ProcessAbsent})
	if err != nil {
		t.Fatal(err)
	}
	output, err := db.LogEvent(protocol.RuntimeEvent{AttemptID: "retention", DispatchID: "dispatch", StreamID: "stdout", Kind: protocol.Output, Text: "abc"}, 0, 3)
	if err != nil {
		t.Fatal(err)
	}
	return s, absent, output
}

func TestLogRetirementRequiresACKAndCompleteBytesPreservesEvidenceAndOrder(t *testing.T) {
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "journal.sqlite")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	s, absent, output := retentionFixture(t, db)
	if _, ready, err := db.RetentionSince("retention", "dispatch", 100); err != nil || ready {
		t.Fatal("unacknowledged output eligible", err)
	}
	for _, e := range []protocol.RuntimeEvent{absent, output} {
		if err := db.Ack(e.AttemptID, e.StreamID, e.Sequence); err != nil {
			t.Fatal(err)
		}
	}
	if _, ready, err := db.RetentionSince("retention", "dispatch", 100); err != nil || !ready {
		t.Fatal(ready, err)
	}
	for _, sizes := range [][3]int64{{3, 0, 99}, {2, 0, 101}, {4, 0, 101}, {3, 1, 101}} {
		if _, err := db.RetireLogs("retention", "dispatch", sizes[0], sizes[1], sizes[2]); !errors.Is(err, ErrConflict) {
			t.Fatal("premature or incomplete retirement", sizes, err)
		}
	}
	r, err := db.RetireLogs("retention", "dispatch", 3, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	// An interrupted filesystem cleanup retains a ticket before payload deletion.
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	retained, err := db.LogRetirement("retention")
	if err != nil || !reflect.DeepEqual(retained, r) || r.Cleaned {
		t.Fatal(retained, err)
	}
	if _, err = db.LogEvent(output, 3, 4); !errors.Is(err, ErrConflict) {
		t.Fatal("retired spool accepted new bytes", err)
	}
	if err = db.FinishLogRetirement(*r); err != nil {
		t.Fatal(err)
	}
	if _, found, err := db.TerminalEvent("retention", "dispatch", protocol.ProcessAbsent); err != nil || !found {
		t.Fatal("ACKed terminal evidence deleted", err)
	}
	if start, err := db.Start("retention"); err != nil || !reflect.DeepEqual(start, s) {
		t.Fatal("ownership deleted", err)
	}
	next, err := db.Event(protocol.RuntimeEvent{AttemptID: "retention", DispatchID: "dispatch", StreamID: "runtime", Kind: protocol.CaptureFailed})
	if err != nil || *next.OrderSequence <= *output.OrderSequence || next.Sequence <= absent.Sequence {
		t.Fatal("sequence reused after deleting highest event", next, err)
	}
	var count int
	if err = db.db.QueryRow("SELECT count(*) FROM events WHERE stream='stdout'").Scan(&count); err != nil || count != 0 {
		t.Fatal("acknowledged payload not retired", count, err)
	}
}

func TestRetentionRefusesUnresolvedEffectsAndInspectionNeedsExactBackendResult(t *testing.T) {
	db := openTest(t)
	_, absent, output := retentionFixture(t, db)
	for _, e := range []protocol.RuntimeEvent{absent, output} {
		if err := db.Ack(e.AttemptID, e.StreamID, e.Sequence); err != nil {
			t.Fatal(err)
		}
	}
	op := protocol.Operation{OperationID: "inspect", AttemptID: "retention", DispatchID: "dispatch", Kind: protocol.KindInspectRepository, Inspection: &protocol.InspectionDescriptor{InspectionID: "inspect"}}
	if err := db.BeginEffect(op); err != nil {
		t.Fatal(err)
	}
	if _, ready, err := db.RetentionSince("retention", "dispatch", 100); err != nil || ready {
		t.Fatal("unresolved operation eligible", err)
	}
	result := protocol.OperationResult{AttemptID: "retention", OperationID: "inspect", Success: true, Result: protocol.EffectResult{Inspection: &protocol.InspectionResult{InspectionID: "inspect", Status: "unavailable"}}}
	if err := db.FinishEffect(result); err != nil {
		t.Fatal(err)
	}
	if _, ready, err := db.RetentionSince("retention", "dispatch", 100); err != nil || !ready {
		t.Fatal(ready, err)
	}
	if err := db.RetireInspection(op, 101); !errors.Is(err, ErrConflict) {
		t.Fatal("unacknowledged inspection retired", err)
	}
	op.State = "succeeded"
	op.Result = &result.Result
	wrong := op
	wrong.Result = &protocol.EffectResult{}
	if err := db.RetireInspection(wrong, 101); !errors.Is(err, ErrConflict) {
		t.Fatal("different backend result retired snapshot", err)
	}
	if err := db.RetireInspection(op, 101); err != nil {
		t.Fatal(err)
	}
	if retired, err := db.InspectionRetired("inspect"); err != nil || !retired {
		t.Fatal(retired, err)
	}
	if retained, err := db.Effect("inspect"); err != nil || !reflect.DeepEqual(retained, &result) {
		t.Fatal("immutable result changed", err)
	}
}
