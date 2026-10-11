package host

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func allocationCapture(t *testing.T, f integrationFixture, operation string, files map[string]string) (operationRecord, protocol.WorkspaceMetadata, integrationWorkspacePaths) {
	t.Helper()
	_, op := canonicalWorkspace(t)
	op.Kind, op.OperationID = protocol.KindCompleteNode, operation
	op.Integration = &protocol.WorkspaceIntegration{ExpectedTaskCommit: f.base}
	op.Workspace.Isolation = &protocol.WorkspaceIsolation{AllocationID: "allocation-" + operation}
	op.Workspace.LeaseID = "lease-" + operation
	metadata := protocol.WorkspaceMetadata{StorageID: "storage", BaseCommit: f.base, FinalizedCommit: f.base, Generation: 1, LeaseID: op.Workspace.LeaseID, RepositoryIdentity: op.Workspace.Resource.RepositoryIdentity, TargetBranch: "master", TargetCommit: f.base, Isolation: &protocol.WorkspaceIsolationMetadata{AllocationID: op.Workspace.Isolation.AllocationID, StartCommit: f.base}}
	paths := integrationWorkspacePaths{workspace: filepath.Join(f.root, "tree-"+operation), common: filepath.Join(f.root, "common-"+operation), cache: f.task, nodeResult: filepath.Join(f.root, "nodes", operation), taskRepository: filepath.Join(f.root, "canonical", "task.git"), result: filepath.Join(f.root, "results", operation)}
	for _, dir := range []string{paths.common, filepath.Dir(paths.result)} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	f.git(f.root, "clone", "--bare", "--no-local", f.seed, paths.common)
	f.git(paths.common, "worktree", "add", "--detach", paths.workspace, f.base)
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(paths.workspace, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	capture, err := finalize(paths.workspace, paths.common, operation, f.base)
	if err != nil {
		t.Fatal(err)
	}
	capturedMetadata := metadata
	capturedMetadata.FinalizedCommit = *capture.GitCommit
	capture.WorkspaceID, capture.WorkspaceMetadata = &op.Workspace.WorkspaceID, &capturedMetadata
	return operationRecord{Operation: op, IntegrationStarted: true, FinalizationResult: &capture, WorkspaceAction: "integrate"}, metadata, paths
}

func TestWorkspaceIntegrationEffectExportsTaskAndPrivateNodeSeparately(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("service export intentionally rejects root; run as unprivileged service identity")
	}
	f := newIntegrationFixture(t)
	a, am, ap := allocationCapture(t, f, "a", map[string]string{"a.txt": "a\n"})
	b, bm, bp := allocationCapture(t, f, "b", map[string]string{"b.txt": "b\n"})
	if _, err := exportWorkspaceCaptureAt(a, am, ap); err != nil {
		t.Fatal(err)
	}
	if _, err := exportWorkspaceCaptureAt(b, bm, bp); err != nil {
		t.Fatal(err)
	}
	// Once exported, the protected object is authoritative even if an execution
	// repository's convenient refs later differ. Integration never reexports it.
	f.git(ap.common, "update-ref", "refs/monos/operations/a", f.base)
	f.git(ap.workspace, "update-ref", "HEAD", f.base)
	one, err := integrateWorkspaceCaptureAt(context.Background(), a, am, ap)
	if err != nil {
		t.Fatal(err)
	}
	b.Operation.Integration.ExpectedTaskCommit = *one.GitCommit
	two, err := integrateWorkspaceCaptureAt(context.Background(), b, bm, bp)
	if err != nil {
		t.Fatal(err)
	}
	if two.Integration == nil || string(two.Integration.Outcome) != "integrated" || two.Integration.NodeCommit != *b.FinalizationResult.GitCommit || two.Integration.TaskCommit != *two.GitCommit || two.WorkspaceMetadata.FinalizedCommit != *two.GitCommit || two.WorkspaceMetadata.Isolation.StartCommit != f.base {
		t.Fatalf("integration lost input/private/Task distinction: %#v", two)
	}
	if err = verifyProtectedWorkspaceResult(bp.result, *two.GitCommit, *two.GitTree); err != nil {
		t.Fatal(err)
	}
	if err = verifyProtectedWorkspaceResult(bp.nodeResult, two.Integration.NodeCommit, two.Integration.NodeTree); err != nil {
		t.Fatal(err)
	}
	if f.git(bp.workspace, "rev-parse", "HEAD") != two.Integration.NodeCommit || f.git(bp.workspace, "rev-parse", "--git-common-dir") == f.git(ap.workspace, "rev-parse", "--git-common-dir") {
		t.Fatal("integration changed Node revision or shared writable Git state")
	}
	// A join's new independent clone checks out both integrated branch results.
	joinCommon, joinTree := filepath.Join(f.root, "join.git"), filepath.Join(f.root, "join")
	for _, dir := range []string{joinCommon, joinTree} {
		if err = os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	f.git(f.task, "fetch", bp.result, *two.GitCommit)
	for name, commit := range map[string]string{"base": f.base, "target": f.base, "finalized": *two.GitCommit} {
		f.git(f.task, "update-ref", "refs/monos/pins/join/"+name, commit)
	}
	joinMetadata := *two.WorkspaceMetadata
	joinMetadata.Isolation = &protocol.WorkspaceIsolationMetadata{AllocationID: "join", StartCommit: *two.GitCommit}
	if err = clonePinned(f.task, joinCommon, joinMetadata, "join"); err != nil {
		t.Fatal(err)
	}
	if err = checkoutPinned(joinTree, joinCommon, f.task, joinMetadata.FinalizedCommit); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"a.txt", "b.txt"} {
		if _, err = os.Stat(filepath.Join(joinTree, name)); err != nil {
			t.Fatalf("join did not receive %s: %v", name, err)
		}
	}
	replay, err := integrateWorkspaceCaptureAt(context.Background(), a, am, ap)
	if err != nil || !reflect.DeepEqual(replay, one) {
		t.Fatalf("earlier physical completion replay changed: %#v %v", replay, err)
	}
}

func TestWorkspaceIntegrationEffectConflictExportsOnlyPrivateResult(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("service export intentionally rejects root; run as unprivileged service identity")
	}
	f := newIntegrationFixture(t)
	a, am, ap := allocationCapture(t, f, "first", map[string]string{"shared.txt": "first\n"})
	b, bm, bp := allocationCapture(t, f, "conflict", map[string]string{"shared.txt": "second\n"})
	if _, err := exportWorkspaceCaptureAt(a, am, ap); err != nil {
		t.Fatal(err)
	}
	if _, err := exportWorkspaceCaptureAt(b, bm, bp); err != nil {
		t.Fatal(err)
	}
	one, err := integrateWorkspaceCaptureAt(context.Background(), a, am, ap)
	if err != nil {
		t.Fatal(err)
	}
	b.Operation.Integration.ExpectedTaskCommit = *one.GitCommit
	conflict, err := integrateWorkspaceCaptureAt(context.Background(), b, bm, bp)
	if err != nil || conflict.Integration == nil || string(conflict.Integration.Outcome) != "conflict" || conflict.GitCommit != nil || conflict.GitTree != nil || conflict.WorkspaceMetadata.FinalizedCommit != f.base || conflict.Integration.TaskCommit != *one.GitCommit {
		t.Fatalf("invalid terminal conflict: %#v %v", conflict, err)
	}
	if err = verifyProtectedWorkspaceResult(bp.result, conflict.Integration.NodeCommit, conflict.Integration.NodeTree); err != nil {
		t.Fatal(err)
	}
	if f.git(bp.taskRepository, "rev-parse", WorkspaceTaskFinalizedRef) != *one.GitCommit || f.git(bp.workspace, "rev-parse", "HEAD") != conflict.Integration.NodeCommit {
		t.Fatal("conflict changed canonical Task or private Node history")
	}
}

func TestWorkspaceIntegrationEffectRequiresExactCaptureAndStartBarrier(t *testing.T) {
	f := newIntegrationFixture(t)
	r, metadata, paths := allocationCapture(t, f, "authority", map[string]string{"new.txt": "new\n"})
	if err := validateIntegrationCapture(r.Operation, metadata, r.FinalizationResult); err != nil {
		t.Fatal(err)
	}
	r.IntegrationStarted = false
	if _, err := integrateWorkspaceCaptureAt(context.Background(), r, metadata, paths); err == nil {
		t.Fatal("integration started without root barrier")
	}
	if _, err := os.Stat(filepath.Dir(paths.nodeResult)); !os.IsNotExist(err) {
		t.Fatal("missing start barrier still caused export mutation")
	}
	changed := *r.FinalizationResult
	changedMetadata := *changed.WorkspaceMetadata
	changedMetadata.Isolation = &protocol.WorkspaceIsolationMetadata{AllocationID: "foreign", StartCommit: f.base}
	changed.WorkspaceMetadata = &changedMetadata
	if err := validateIntegrationCapture(r.Operation, metadata, &changed); err == nil {
		t.Fatal("foreign allocation capture accepted")
	}
	changed = *r.FinalizationResult
	changed.WriterAbsent = ptr(false)
	if err := validateIntegrationCapture(r.Operation, metadata, &changed); err == nil {
		t.Fatal("live capture accepted")
	}
}

func TestWorkspaceIntegrationEffectMissingInitializedTaskIsNotRecloned(t *testing.T) {
	f := newIntegrationFixture(t)
	r, metadata, paths := allocationCapture(t, f, "retained", nil)
	if _, err := ensureProtectedTaskRepositoryAt(context.Background(), r.Operation, metadata, paths.taskRepository, paths.cache); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(paths.taskRepository, paths.taskRepository+"-lost"); err != nil {
		t.Fatal(err)
	}
	if _, err := ensureProtectedTaskRepositoryAt(context.Background(), r.Operation, metadata, paths.taskRepository, paths.cache); err == nil {
		t.Fatal("silently recreated lost canonical Task history")
	}
	if _, err := os.Stat(paths.taskRepository); !os.IsNotExist(err) {
		t.Fatal("failed recovery changed retained storage")
	}
}

func TestIsolatedCompletionCancellationBeforeIntegrationPreservesPrivateFinalization(t *testing.T) {
	dir, common, base := completionGit(t)
	_, original, settle := completionOperations(t)
	original.Workspace.Isolation = &protocol.WorkspaceIsolation{AllocationID: "cancelled-allocation"}
	original.Integration = &protocol.WorkspaceIntegration{ExpectedTaskCommit: base}
	_, descriptorDigest, _ := wire.Canonical(original.Workspace)
	original.WorkspaceDigest = &descriptorDigest
	settle.Workspace, settle.WorkspaceDigest = original.Workspace, original.WorkspaceDigest
	identity, err := wire.OperationIdentity(original)
	if err != nil {
		t.Fatal(err)
	}
	settle.CompletionIdentityDigest = &identity
	writeCompletionFile(t, dir, "file", "private completed edits\n")
	writeCompletionFile(t, dir, "ignored", "untracked private data\n")
	finalized, err := finalize(dir, common, original.OperationID, base)
	if err != nil {
		t.Fatal(err)
	}
	index := readCompletionFile(t, filepath.Join(common, "index"))
	metadata := protocol.WorkspaceMetadata{StorageID: "storage", Generation: original.Workspace.Generation, LeaseID: original.Workspace.LeaseID, RepositoryIdentity: original.Workspace.Resource.RepositoryIdentity, BaseCommit: base, FinalizedCommit: base, TargetBranch: "main", TargetCommit: base, Isolation: &protocol.WorkspaceIsolationMetadata{AllocationID: original.Workspace.Isolation.AllocationID, StartCommit: base}}
	status, err := settlementWorker(settle, original, metadata, dir, common)
	if err != nil {
		t.Fatal(err)
	}
	if status.CompletionSettlement.Disposition != protocol.DispositionCancelled || status.CompletionSettlement.CompletionResult.Success || status.Result.WorkspaceMetadata.Checkpoint == nil || status.Result.WorkspaceMetadata.FinalizedCommit != base {
		t.Fatalf("private finalization granted integrated completion: %#v", status)
	}
	if gitOK(t, dir, "rev-parse", "HEAD") != *finalized.GitCommit || !reflect.DeepEqual(index, readCompletionFile(t, filepath.Join(common, "index"))) || string(readCompletionFile(t, filepath.Join(dir, "ignored"))) != "untracked private data\n" {
		t.Fatal("cancellation changed finalized history, index or ignored bytes")
	}
	pair := protocol.OperationResult{AttemptID: settle.AttemptID, OperationID: settle.OperationID, Success: true, Result: *status.Result, CompletionSettlement: status.CompletionSettlement}
	if err = wire.ValidateCompletionPair(settle, original, pair); err != nil {
		t.Fatal(err)
	}
}
