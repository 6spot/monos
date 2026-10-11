package journal

import (
	"os"
	"path/filepath"
	"testing"

	protocol "monos.local/protocol"
)

func TestTaskCleanupReceiptBindsRequestAndSurvivesLostReplyUntilExactACK(t *testing.T) {
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
	r := protocol.TaskCleanupRequest{SchemaVersion: 1, CleanupID: "cleanup", TaskID: "task", RunnerID: "runner", CompletedAt: "2026-10-11T00:00:00.000Z", Attempts: []protocol.TaskCleanupAttempt{}, Workspaces: []protocol.TaskCleanupWorkspace{}, Results: []protocol.ResultReadIdentity{}}
	digest, old, err := db.BeginTaskCleanup(r)
	if err != nil || old != nil {
		t.Fatal(old, err)
	}
	wrong := r
	wrong.CompletedAt = "2026-10-12T00:00:00.000Z"
	if _, _, err = db.BeginTaskCleanup(wrong); err == nil {
		t.Fatal("cleanup identity reused with new request")
	}
	if err = db.AckTaskCleanup(protocol.TaskCleanupACK{CleanupID: r.CleanupID, RequestDigest: digest}); err == nil {
		t.Fatal("ACK before physical result accepted")
	}
	result := protocol.TaskCleanupResult{SchemaVersion: 1, CleanupID: r.CleanupID, RequestDigest: digest, Status: "completed"}
	if err = db.FinishTaskCleanup(result); err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	pending, err := db.PendingTaskCleanupResults()
	if err != nil || len(pending) != 1 || pending[0] != result {
		t.Fatal("lost reply was not retained", pending, err)
	}
	if err = db.AckTaskCleanup(protocol.TaskCleanupACK{CleanupID: r.CleanupID, RequestDigest: "wrong"}); err == nil {
		t.Fatal("mismatched ACK cleared result")
	}
	if err = db.AckTaskCleanup(protocol.TaskCleanupACK{CleanupID: r.CleanupID, RequestDigest: digest}); err != nil {
		t.Fatal(err)
	}
	if pending, err = db.PendingTaskCleanupResults(); err != nil || len(pending) != 0 {
		t.Fatal(pending, err)
	}
	if retired, err := db.TaskRetired(r.TaskID); err != nil || !retired {
		t.Fatal("ACK erased Task retirement fence", err)
	}
	_, old, err = db.BeginTaskCleanup(r)
	if err != nil || old == nil || *old != result {
		t.Fatal("retry lost immutable completed result", old, err)
	}
}
