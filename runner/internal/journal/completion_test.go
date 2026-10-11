package journal

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func completionPair(t *testing.T) (protocol.Operation, protocol.Operation, protocol.OperationResult) {
	t.Helper()
	hash := strings.Repeat("a", 64)
	oid := strings.Repeat("a", 40)
	w := &protocol.WorkspaceDescriptor{SchemaVersion: 1, TaskID: "task", NodeID: "node", NodeActivation: 1, WorkspaceID: "workspace", ResourceID: "resource", ProjectID: "project", RunnerID: "runner", Generation: 1, LeaseID: "lease", OpenOperationID: "open", Resource: protocol.WorkspaceResource{ResourceID: "resource", RepositoryIdentity: "github.com/owner/repo", RemoteURL: "https://github.com/owner/repo.git"}}
	_, descriptorDigest, _ := wire.Canonical(w)
	original := protocol.Operation{SchemaVersion: 1, OperationID: "original", AttemptID: "attempt", DispatchID: "dispatch", RequestID: "complete-request", Kind: protocol.KindCompleteNode, State: protocol.PurpleRecovery, Workspaces: []protocol.WorkspaceCompletionInput{{Workspace: *w, WorkspaceDigest: descriptorDigest}}, CompletionManifestDigest: &hash}
	second := *w
	second.ResourceID = "resource-b"
	second.Resource.ResourceID = second.ResourceID
	second.WorkspaceID = "workspace-b"
	second.LeaseID = "lease-b"
	second.OpenOperationID = "open-b"
	_, secondDigest, _ := wire.Canonical(second)
	original.Workspaces = append(original.Workspaces, protocol.WorkspaceCompletionInput{Workspace: second, WorkspaceDigest: secondDigest})
	digest, err := wire.OperationIdentity(original)
	if err != nil {
		t.Fatal(err)
	}
	settle := original
	settle.Kind = protocol.SettleCompletion
	settle.OperationID = "settlement"
	settle.RequestID = "settle-request"
	settle.CompletionManifestDigest = nil
	settle.Workspaces = nil
	settle.CompletionOperationID = &original.OperationID
	settle.CompletionIdentityDigest = &digest
	cp := &protocol.WorkspaceCheckpoint{OperationID: settle.OperationID, CommitID: oid, TreeID: oid, HeadCommit: oid, CompletionOperationID: &original.OperationID, CompletionIdentityDigest: &digest}
	metadata := &protocol.WorkspaceMetadata{StorageID: "storage", Generation: 1, LeaseID: w.LeaseID, RepositoryIdentity: w.Resource.RepositoryIdentity, BaseCommit: oid, FinalizedCommit: oid, TargetBranch: "main", TargetCommit: oid, Checkpoint: cp}
	absent := true
	result := protocol.OperationResult{OperationID: settle.OperationID, AttemptID: settle.AttemptID, Success: true, Result: protocol.EffectResult{WorkspaceResults: []protocol.WorkspaceEffectResult{{ResourceID: w.ResourceID, WorkspaceID: w.WorkspaceID, WorkspaceMetadata: *metadata}}, WriterAbsent: &absent}, CompletionSettlement: &protocol.CompletionSettlement{CompletionOperationID: original.OperationID, Disposition: protocol.DispositionCancelled, CompletionResult: protocol.CompletionOperationResult{AttemptID: original.AttemptID, OperationID: original.OperationID, CancelledByOperationID: &settle.OperationID, Result: protocol.EffectResult{WriterAbsent: &absent}}}}
	secondMetadata := *metadata
	secondMetadata.LeaseID = second.LeaseID
	result.Result.WorkspaceResults = append(result.Result.WorkspaceResults, protocol.WorkspaceEffectResult{ResourceID: second.ResourceID, WorkspaceID: second.WorkspaceID, WorkspaceMetadata: secondMetadata})
	return original, settle, result
}

func TestCompletionPairIsAtomicAndReplayableAfterRestart(t *testing.T) {
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "journal.db")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	original, settle, pair := completionPair(t)
	for _, op := range []protocol.Operation{original, settle} {
		if err = db.BeginEffect(op); err != nil {
			t.Fatal(err)
		}
	}
	failure := protocol.OperationResult{AttemptID: original.AttemptID, OperationID: original.OperationID, FailureKind: func() *protocol.FailureKind { v := protocol.InvalidFinalization; return &v }()}
	if err = db.FinishEffect(failure); err != nil {
		t.Fatal(err)
	}
	if _, err = db.db.Exec("CREATE TRIGGER fail_settlement BEFORE UPDATE OF result ON effects WHEN NEW.id='settlement' BEGIN SELECT RAISE(ABORT,'injected write failure'); END"); err != nil {
		t.Fatal(err)
	}
	if err = db.FinishCompletionSettlement(pair); err == nil {
		t.Fatal("injected second-write failure ignored")
	}
	prior, err := db.Effect(original.OperationID)
	if err != nil || !reflect.DeepEqual(prior, &failure) {
		t.Fatal("partial original terminalization escaped rollback", prior, err)
	}
	if _, err = db.db.Exec("DROP TRIGGER fail_settlement"); err != nil {
		t.Fatal(err)
	}
	if err = db.FinishCompletionSettlement(pair); err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = db.FinishCompletionSettlement(pair); err != nil {
		t.Fatal("restart replay rejected", err)
	}
	want := wire.CompletionResult(pair.CompletionSettlement.CompletionResult)
	prior, err = db.Effect(original.OperationID)
	if err != nil || !reflect.DeepEqual(prior, &want) {
		t.Fatal("original pair not durable", prior, err)
	}
	if err = db.FinishEffect(failure); !errors.Is(err, ErrConflict) {
		t.Fatal("stale worker failure overwrote terminal pair", err)
	}
	changed := original
	changed.State = protocol.FluffyAdmitted
	if err = db.BeginEffect(changed); err != nil {
		t.Fatal("same-ID retry changed identity", err)
	}
	changed.CompletionManifestDigest = testString(strings.Repeat("b", 64))
	if err = db.BeginEffect(changed); !errors.Is(err, ErrConflict) {
		t.Fatal("manifest replacement accepted", err)
	}
}

func TestCompletionPairRejectsAlteredNestedResultAndPreservesOriginalSuccess(t *testing.T) {
	for _, mode := range []string{"prior-success", "wrong-target", "wrong-lease", "wrong-checkpoint", "wrong-nested-attempt"} {
		t.Run(mode, func(t *testing.T) {
			db := openTest(t)
			original, settle, pair := completionPair(t)
			for _, op := range []protocol.Operation{original, settle} {
				if err := db.BeginEffect(op); err != nil {
					t.Fatal(err)
				}
			}
			var prior *protocol.OperationResult
			if mode == "prior-success" {
				oid := strings.Repeat("a", 40)
				r := protocol.OperationResult{AttemptID: original.AttemptID, OperationID: original.OperationID, Success: true, Result: journalFinalizedFixture(pair.Result, oid)}
				prior = &r
				if err := db.FinishEffect(r); err != nil {
					t.Fatal(err)
				}
			}
			switch mode {
			case "wrong-target":
				pair.CompletionSettlement.CompletionOperationID = "other"
			case "wrong-lease":
				settle.CompletionIdentityDigest = testString(strings.Repeat("f", 64))
				raw, _ := json.Marshal(settle)
				if _, err := db.db.Exec("UPDATE effects SET body=? WHERE id=?", raw, settle.OperationID); err != nil {
					t.Fatal(err)
				}
			case "wrong-checkpoint":
				pair.Result.WorkspaceResults[0].WorkspaceMetadata.Checkpoint.CompletionIdentityDigest = testString(strings.Repeat("b", 64))
			case "wrong-nested-attempt":
				pair.CompletionSettlement.CompletionResult.AttemptID = "other"
			}
			if err := db.FinishCompletionSettlement(pair); err == nil {
				t.Fatal("changed pair accepted")
			}
			after, _ := db.Effect(original.OperationID)
			if !reflect.DeepEqual(prior, after) {
				t.Fatal("failed pair changed original", after)
			}
		})
	}
}

func TestCompletionAlreadyFinalizedPairPreservesExactOriginalSuccess(t *testing.T) {
	db := openTest(t)
	original, settle, pair := completionPair(t)
	for _, op := range []protocol.Operation{original, settle} {
		if err := db.BeginEffect(op); err != nil {
			t.Fatal(err)
		}
	}
	gitResult := journalFinalizedFixture(pair.Result, strings.Repeat("b", 40))
	absent := true
	pair.Result = protocol.EffectResult{WriterAbsent: &absent}
	pair.CompletionSettlement.Disposition = protocol.AlreadyFinalized
	pair.CompletionSettlement.CompletionResult = protocol.CompletionOperationResult{AttemptID: original.AttemptID, OperationID: original.OperationID, Success: true, Result: gitResult}
	exact := wire.CompletionResult(pair.CompletionSettlement.CompletionResult)
	if err := db.FinishEffect(exact); err != nil {
		t.Fatal(err)
	}
	if err := db.FinishCompletionSettlement(pair); err != nil {
		t.Fatal(err)
	}
	if err := db.FinishCompletionSettlement(pair); err != nil {
		t.Fatal(err)
	}
	got, _ := db.Effect(original.OperationID)
	if !reflect.DeepEqual(got, &exact) {
		t.Fatal("settlement replaced exact original success")
	}
}

func journalFinalizedFixture(checkpoints protocol.EffectResult, tree string) protocol.EffectResult {
	items := append([]protocol.WorkspaceEffectResult(nil), checkpoints.WorkspaceResults...)
	for i := range items {
		m := items[i].WorkspaceMetadata
		m.Checkpoint = nil
		items[i].WorkspaceMetadata = m
		items[i].GitCommit = &m.FinalizedCommit
		items[i].GitTree = &tree
		items[i].Capture = &protocol.WorkspaceCaptureResult{StartCommit: m.BaseCommit, NodeCommit: m.FinalizedCommit, NodeTree: tree}
	}
	absent := true
	return protocol.EffectResult{WriterAbsent: &absent, CompletionOutcome: testString("finalized"), WorkspaceResults: items}
}
