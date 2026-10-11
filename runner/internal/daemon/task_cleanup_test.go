package daemon

import (
	"context"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/control"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/journal"
)

func TestTaskCleanupRefusesUnreleasedAttemptAndReplaysDurableSuccess(t *testing.T) {
	db, dispatch, _, identity, _ := retainedReadFixture(t)
	r := protocol.TaskCleanupRequest{SchemaVersion: 1, CleanupID: "cleanup", TaskID: identity.TaskID, RunnerID: identity.RunnerID, CompletedAt: "2026-10-11T00:00:00.000Z", Attempts: []protocol.TaskCleanupAttempt{{AttemptID: identity.AttemptID, DispatchID: identity.DispatchID}}, Results: []protocol.ResultReadIdentity{identity}, Workspaces: []protocol.TaskCleanupWorkspace{{WorkspaceID: identity.WorkspaceID, ResourceID: identity.ResourceID, Generation: identity.Generation, StorageID: identity.StorageID, FinalizedCommit: identity.GitCommit, Direct: true, AllocationIDS: []string{}}}}
	digest, err := host.ValidateTaskCleanup(r)
	if err != nil {
		t.Fatal(err)
	}
	result := protocol.TaskCleanupResult{SchemaVersion: 1, CleanupID: r.CleanupID, RequestDigest: digest, Status: "completed"}
	supervisor := &fakeSupervisor{Status: host.Status{Known: true, CleanupResult: &result}}
	d := Daemon{DB: db, Host: supervisor, Control: &control.Client{Config: control.Config{RunnerID: r.RunnerID}}}
	if err = db.SaveStart(journal.Start{Dispatch: dispatch, Phase: "running"}); err != nil {
		t.Fatal(err)
	}
	_ = d.taskCleanup(context.Background(), r)
	if len(supervisor.Calls) != 0 {
		t.Fatal("unreleased Attempt allowed destructive helper call")
	}
	if err = db.SaveStart(journal.Start{Dispatch: dispatch, Phase: "absent"}); err != nil {
		t.Fatal(err)
	}
	conversation, _ := conversationRecoveryFixture(t)
	conversation.AttemptID, conversation.DispatchID = "new-conversation", "new-conversation-dispatch"
	conversation.TaskID, conversation.RunnerID = &r.TaskID, r.RunnerID
	conversation.TaskConversationSource.ReplyOnly = true
	if err = d.start(context.Background(), conversation); err == nil || err.Error() != "control unavailable" {
		t.Fatal("new conversation did not reach ordinary authorization", err)
	}
	if len(supervisor.Calls) != 0 {
		t.Fatal("new conversation bypassed dispatch authorization")
	}
	if err = db.SaveStart(journal.Start{Dispatch: conversation, Phase: "running"}); err != nil {
		t.Fatal(err)
	}
	_ = d.taskCleanup(context.Background(), r)
	if len(supervisor.Calls) != 1 || supervisor.Calls[0].Action != "cleanup_task" {
		t.Fatal("eligible cleanup not issued", supervisor.Calls)
	}
	pending, err := db.PendingTaskCleanupResults()
	if err != nil || len(pending) != 1 || pending[0].Status != "completed" {
		t.Fatal("result not durable before failed send", pending, err)
	}
	_ = d.taskCleanup(context.Background(), r)
	if len(supervisor.Calls) != 1 {
		t.Fatal("lost result reply repeated physical cleanup")
	}
	if err = retainedResultIdentity(db, identity); err != nil {
		t.Fatal("cleanup erased formal result identity", err)
	}
	conversation.TaskConversationSource.ReplyOnly = false
	if err = db.SaveStart(journal.Start{Dispatch: conversation, Phase: "running"}); err != nil {
		t.Fatal(err)
	}
	if d.validateTaskCleanup(r) == nil {
		t.Fatal("unlisted mutable conversation ignored during cleanup proof")
	}
}
