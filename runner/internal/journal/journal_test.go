package journal

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	protocol "monos.local/protocol"
)

func openTest(t *testing.T) *DB {
	t.Helper()
	root := t.TempDir()
	if err := os.Chmod(root, 0700); err != nil {
		t.Fatal(err)
	}
	db, err := Open(filepath.Join(root, "journal.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}
func envelope(payload string) []byte {
	return []byte(`{"schema_version":1,"request_id":"request-a","scope_id":"task-a","name":"complete_node","expected_control_version":1,"payload":{"summary":"` + payload + `"}}`)
}
func TestImmutableRetryAndConflict(t *testing.T) {
	db := openTest(t)
	first, err := db.PutRequest("a", envelope("original"))
	if err != nil {
		t.Fatal(err)
	}
	original := append([]byte(nil), first.Raw...)
	if _, err = db.PutRequest("a", envelope("changed")); err != ErrConflict {
		t.Fatalf("want conflict: %v", err)
	}
	retry, err := db.Request("a", "request-a")
	if err != nil || !bytes.Equal(retry.Raw, original) || retry.Digest != first.Digest {
		t.Fatalf("retry changed: %v", err)
	}
	if _, err = db.Request("b", "request-a"); err != ErrUnknown {
		t.Fatalf("cross attempt access: %v", err)
	}
}
func TestJournalFailurePreventsAcknowledgement(t *testing.T) {
	db := openTest(t)
	if _, err := db.db.Exec("PRAGMA query_only=ON"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.PutRequest("a", envelope("no send permit")); err == nil {
		t.Fatal("failed journal issued envelope acknowledgement")
	}
	if _, err := db.Request("a", "request-a"); err != ErrUnknown {
		t.Fatalf("failure created request: %v", err)
	}
}
func TestEventAcknowledgesOnlyIndividualSequence(t *testing.T) {
	db := openTest(t)
	e := protocol.RuntimeEvent{AttemptID: "a", DispatchID: "d", StreamID: "s", Kind: protocol.Output, Text: "one"}
	one, err := db.Event(e)
	if err != nil {
		t.Fatal(err)
	}
	two, err := db.Event(e)
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Ack("a", "s", two.Sequence); err != nil {
		t.Fatal(err)
	}
	pending, err := db.PendingEvents()
	if err != nil || len(pending) != 1 || pending[0].Sequence != one.Sequence {
		t.Fatalf("gap lost: %+v %v", pending, err)
	}
}
func TestReopenPreservesUnresolvedRequest(t *testing.T) {
	root := t.TempDir()
	os.Chmod(root, 0700)
	path := filepath.Join(root, "journal.sqlite")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	first, err := db.PutRequest("a", envelope("retained"))
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	db, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	second, err := db.Request("a", "request-a")
	if err != nil || !bytes.Equal(first.Raw, second.Raw) {
		t.Fatalf("restart lost request %v", err)
	}
}

func TestLogCursorAndEventCommitTogether(t *testing.T) {
	db := openTest(t)
	event := protocol.RuntimeEvent{AttemptID: "a", DispatchID: "d", StreamID: "stdout", Kind: protocol.Output, Text: "chunk"}
	saved, err := db.LogEvent(event, 0, 5)
	if err != nil {
		t.Fatal(err)
	}
	offset, err := db.LogOffset("a", "stdout")
	if err != nil || offset != 5 {
		t.Fatalf("cursor %d %v", offset, err)
	}
	if _, err = db.LogEvent(event, 0, 5); err != ErrConflict {
		t.Fatal("duplicate source bytes changed event stream")
	}
	pending, err := db.PendingEvents()
	if err != nil || len(pending) != 1 || pending[0].Sequence != saved.Sequence {
		t.Fatal("retained log lost")
	}
}

func TestAttemptOrderSurvivesStreamsAndReopen(t *testing.T) {
	root := t.TempDir()
	if err := os.Chmod(root, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "journal.sqlite")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := db.LogEvent(protocol.RuntimeEvent{AttemptID: "a", DispatchID: "d", StreamID: "stdout", Kind: protocol.Output, Text: "first"}, 0, 5)
	if err != nil {
		t.Fatal(err)
	}
	stderr, err := db.LogEvent(protocol.RuntimeEvent{AttemptID: "a", DispatchID: "d", StreamID: "stderr", Kind: protocol.Output, Text: "second"}, 0, 6)
	if err != nil {
		t.Fatal(err)
	}
	if stdout.OrderSequence == nil || stderr.OrderSequence == nil || *stdout.OrderSequence != 1 || *stderr.OrderSequence != 2 {
		t.Fatal("streams have no stable Attempt order")
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	pending, err := db.PendingEvents()
	if err != nil || len(pending) != 2 || pending[0].Text != "first" || pending[1].Text != "second" {
		t.Fatalf("reconnect changed Attempt order: %+v %v", pending, err)
	}
}

func TestCaptureAttentionCanBeRecoveredWithoutDuplicateObservation(t *testing.T) {
	db := openTest(t)
	if found, err := db.HasCaptureAlert("a"); err != nil || found {
		t.Fatalf("unexpected alert: %v %v", found, err)
	}
	_, err := db.Event(protocol.RuntimeEvent{AttemptID: "a", DispatchID: "d", StreamID: "runtime", Kind: protocol.CaptureFailed, Text: CaptureAlertText})
	if err != nil {
		t.Fatal(err)
	}
	if found, err := db.HasCaptureAlert("a"); err != nil || !found {
		t.Fatalf("lost retained alert: %v %v", found, err)
	}
}
