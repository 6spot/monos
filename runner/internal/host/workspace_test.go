package host

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func canonicalWorkspace(t *testing.T) (protocol.Dispatch, protocol.Operation) {
	t.Helper()
	id, err := TaskWorkspaceID("task-a", "resource-a")
	if err != nil {
		t.Fatal(err)
	}
	w := protocol.WorkspaceDescriptor{SchemaVersion: 1, TaskID: "task-a", ResourceID: "resource-a", WorkspaceID: id, ProjectID: "project", RunnerID: "runner", Generation: 1, LeaseID: "lease", NodeID: "node", NodeActivation: 1, OpenOperationID: "open", Resource: protocol.WorkspaceResource{ResourceID: "resource-a", RepositoryIdentity: "github.com/example/repository", RemoteURL: "https://github.com/example/repository.git"}}
	_, digest, _ := wire.Canonical(w)
	d := protocol.Dispatch{AttemptID: "attempt", DispatchID: "dispatch", TaskID: ptr("task-a"), RunnerID: "runner", Kind: protocol.Node, NodeID: ptr("node"), NodeActivation: 1, WorkspaceReservations: &protocol.WorkspaceReservations{ProjectID: "project", ConfigurationVersion: 1, Resources: []protocol.WorkspaceReservation{{ResourceID: "resource-a", WorkspaceID: id}}}}
	op := protocol.Operation{SchemaVersion: 1, OperationID: "open", AttemptID: "attempt", DispatchID: "dispatch", ResourceID: ptr("resource-a"), RequestID: "request", Kind: protocol.KindOpenWorkspace, State: "admitted", Workspace: &w, WorkspaceDigest: &digest}
	return d, op
}

func TestCanonicalWorkspaceIdentityFixturesAndScope(t *testing.T) {
	raw, err := os.ReadFile("../../../packages/protocol/fixtures/workspace-identities.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Task      string `json:"task_id"`
		Resource  string `json:"resource_id"`
		Workspace string `json:"workspace_id"`
	}
	if err = json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, f := range fixtures {
		id, e := TaskWorkspaceID(f.Task, f.Resource)
		if e != nil || id != f.Workspace {
			t.Fatalf("identity fixture failed: %s %v", id, e)
		}
	}
	d, op := canonicalWorkspace(t)
	if err = ValidateEffectScope(d, op); err != nil {
		t.Fatal(err)
	}
	op.Workspace.LeaseID = "other"
	if ValidateEffectScope(d, op) == nil {
		t.Fatal("changed descriptor retained original digest")
	}
	_, digest, _ := wire.Canonical(op.Workspace)
	op.WorkspaceDigest = &digest
	d.WorkspaceReservations.Resources = []protocol.WorkspaceReservation{}
	if ValidateEffectScope(d, op) == nil {
		t.Fatal("unreserved resource passed")
	}
	if sameOperation(op, protocol.Operation{OperationID: op.OperationID}) {
		t.Fatal("workspace equality omitted descriptor")
	}
}

func TestPinnedFetchRecoveryAndCredentialNonPersistence(t *testing.T) {
	remote, base := fixtureRepository(t)
	branch, err := git(remote, "symbolic-ref", "--short", "HEAD")
	if err != nil {
		t.Fatal(err)
	}
	_, op := canonicalWorkspace(t)
	dir := t.TempDir()
	cache := filepath.Join(dir, "cache.git")
	record := filepath.Join(dir, "pinned.json")
	secret := "synthetic-installation-secret"
	exp := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	access := protocol.RepositoryAccessResult{SchemaVersion: 1, OperationID: op.OperationID, WorkspaceDigest: *op.WorkspaceDigest, RemoteURL: op.Workspace.Resource.RemoteURL, DefaultBranch: branch, Authentication: protocol.RepositoryAuthentication{Kind: "github_installation", Token: &secret, ExpiresAt: &exp}, ProviderMetadata: protocol.RepositoryProviderMetadata{Github: &protocol.GithubClass{RepositoryID: "123"}}}
	calls := 0
	failTarget := true
	sawAuth := false
	run := func(dir, cache, common string, env []string, args ...string) (string, error) {
		translated := append([]string(nil), args...)
		for i, a := range translated {
			if a == access.RemoteURL {
				translated[i] = remote
				calls++
				sawAuth = sawAuth || strings.Contains(strings.Join(env, "\n"), "GIT_CONFIG_KEY_4=http."+access.RemoteURL+".extraHeader")
			}
		}
		if failTarget && strings.Contains(strings.Join(args, " "), "/target") {
			return "", errors.New("injected target failure")
		}
		// Only the test replaces verified HTTPS transport by a local real Git
		// repository. Production receives no path/env override from the Agent.
		return workspaceGit(dir, cache, common, nil, translated...)
	}
	if _, err = fetchWorkspaceUsing(cache, record, op, access, run); err == nil {
		t.Fatal("fault did not stop fetch")
	}
	if _, err = git(remote, "commit", "--allow-empty", "-m", "moved remote"); err != nil {
		t.Fatal(err)
	}
	newHead, _ := git(remote, "rev-parse", "HEAD")
	// After the base pin succeeds, even an ambiguous original short name and a
	// changed provider default cannot change the retained base/target intent.
	if _, err = git(remote, "tag", branch); err != nil {
		t.Fatal(err)
	}
	access.DefaultBranch = "different-provider-default"
	failTarget = false
	m, err := fetchWorkspaceUsing(cache, record, op, access, run)
	if err != nil {
		t.Fatal(err)
	}
	if m.BaseCommit != base || m.TargetCommit != newHead || m.TargetBranch != branch {
		t.Fatalf("retry lost first pinned base: %+v", m)
	}
	before := calls
	again, err := fetchWorkspaceUsing(cache, record, op, access, run)
	if err != nil || !reflect.DeepEqual(m, again) || calls != before {
		t.Fatal("completed pin record refetched", err)
	}
	if !sawAuth {
		t.Fatal("scoped ephemeral Authorization absent")
	}
	_ = filepath.Walk(dir, func(p string, info os.FileInfo, e error) error {
		if e != nil {
			return e
		}
		if info.Mode().IsRegular() {
			b, e := os.ReadFile(p)
			if e != nil {
				t.Fatal(e)
			}
			if strings.Contains(string(b), secret) || strings.Contains(string(b), "AUTHORIZATION:") {
				t.Fatalf("credential persisted at %s", p)
			}
		}
		return nil
	})
	access.Authentication.ExpiresAt = ptr(time.Now().Add(-time.Hour).UTC().Format(time.RFC3339))
	if _, err = fetchWorkspaceUsing(cache, filepath.Join(dir, "expired.json"), op, access, run); err == nil {
		t.Fatal("expired token accepted")
	}
}

func TestAmbiguousShortRefFailsWithoutCreatingPins(t *testing.T) {
	remote, _ := fixtureRepository(t)
	branch, err := git(remote, "symbolic-ref", "--short", "HEAD")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = git(remote, "tag", branch); err != nil {
		t.Fatal(err)
	}
	_, op := canonicalWorkspace(t)
	dir := t.TempDir()
	cache, record := filepath.Join(dir, "cache.git"), filepath.Join(dir, "pins.json")
	access := protocol.RepositoryAccessResult{OperationID: op.OperationID, WorkspaceDigest: *op.WorkspaceDigest, RemoteURL: op.Workspace.Resource.RemoteURL, DefaultBranch: branch, ProviderMetadata: protocol.RepositoryProviderMetadata{Github: &protocol.GithubClass{RepositoryID: "123"}}, Authentication: protocol.RepositoryAuthentication{Kind: "anonymous"}}
	run := func(dir, cache, common string, _ []string, args ...string) (string, error) {
		translated := append([]string(nil), args...)
		for i, a := range translated {
			if a == access.RemoteURL {
				translated[i] = remote
			}
		}
		return workspaceGit(dir, cache, common, nil, translated...)
	}
	if _, err = fetchWorkspaceUsing(cache, record, op, access, run); err == nil || !strings.Contains(err.Error(), "ambiguous") {
		t.Fatal("ambiguous branch/tag silently selected", err)
	}
	raw, err := os.ReadFile(record)
	if err != nil {
		t.Fatal(err)
	}
	var progress struct {
		Complete bool `json:"complete"`
	}
	if json.Unmarshal(raw, &progress) != nil || progress.Complete {
		t.Fatal("failed ref resolution recorded completed pins")
	}
}

func TestPinnedBaseSurvivesDeletedConfiguredRef(t *testing.T) {
	remote, base := fixtureRepository(t)
	branch, _ := git(remote, "symbolic-ref", "--short", "HEAD")
	if _, err := git(remote, "branch", "initial-base"); err != nil {
		t.Fatal(err)
	}
	_, op := canonicalWorkspace(t)
	op.Workspace.Resource.DefaultRef = ptr("initial-base")
	_, digest, _ := wire.Canonical(op.Workspace)
	op.WorkspaceDigest = &digest
	dir := t.TempDir()
	cache, record := filepath.Join(dir, "cache.git"), filepath.Join(dir, "pins.json")
	access := protocol.RepositoryAccessResult{OperationID: op.OperationID, WorkspaceDigest: digest, RemoteURL: op.Workspace.Resource.RemoteURL, DefaultBranch: branch, ProviderMetadata: protocol.RepositoryProviderMetadata{Github: &protocol.GithubClass{RepositoryID: "123"}}, Authentication: protocol.RepositoryAuthentication{Kind: "anonymous"}}
	failTarget := true
	run := func(dir, cache, common string, _ []string, args ...string) (string, error) {
		if failTarget && strings.Contains(strings.Join(args, " "), "/target") {
			return "", errors.New("target unavailable")
		}
		translated := append([]string(nil), args...)
		for i, a := range translated {
			if a == access.RemoteURL {
				translated[i] = remote
			}
		}
		return workspaceGit(dir, cache, common, nil, translated...)
	}
	if _, err := fetchWorkspaceUsing(cache, record, op, access, run); err == nil {
		t.Fatal("target fault not reached")
	}
	if _, err := git(remote, "branch", "-D", "initial-base"); err != nil {
		t.Fatal(err)
	}
	failTarget = false
	access.DefaultBranch = "new-provider-default"
	m, err := fetchWorkspaceUsing(cache, record, op, access, run)
	if err != nil || m.BaseCommit != base || m.TargetBranch != branch {
		t.Fatal("retry re-resolved deleted base ref or target", m, err)
	}
}

func TestPinnedCloneCheckpointAndFreshLeaseKeepPrivateWork(t *testing.T) {
	cache, base := fixtureRepository(t)
	for _, name := range []string{"base", "target"} {
		if _, err := git(cache, "update-ref", "refs/monos/pins/open/"+name, base); err != nil {
			t.Fatal(err)
		}
	}
	dir := t.TempDir()
	common, workspace := filepath.Join(dir, "common"), filepath.Join(dir, "workspace")
	for _, p := range []string{common, workspace} {
		if err := os.Mkdir(p, 0750); err != nil {
			t.Fatal(err)
		}
	}
	m := protocol.WorkspaceMetadata{BaseCommit: base, FinalizedCommit: base, TargetCommit: base, Generation: 1, LeaseID: "lease"}
	for i := 0; i < 2; i++ {
		if err := clonePinned(cache, common, m, "open"); err != nil {
			t.Fatal(err)
		}
	}
	if err := checkoutPinned(workspace, common, cache, base); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(workspace, "file")); err != nil {
		t.Fatal(err)
	}
	if err := checkoutPinned(workspace, common, cache, base); err != nil {
		t.Fatal("interrupted missing checkout file not restored", err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "file"), []byte("staged"), 0640); err != nil {
		t.Fatal(err)
	}
	if _, err := git(workspace, "add", "file"); err != nil {
		t.Fatal(err)
	}
	indexBefore, _ := git(workspace, "write-tree")
	if err := os.WriteFile(filepath.Join(workspace, "file"), []byte("unstaged"), 0640); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "new"), []byte("new file"), 0640); err != nil {
		t.Fatal(err)
	}
	cp, err := checkpoint(workspace, common, "stop", base)
	if err != nil {
		t.Fatal(err)
	}
	indexAfter, _ := git(workspace, "write-tree")
	head, _ := git(workspace, "rev-parse", "HEAD")
	if indexAfter != indexBefore || head != base || cp.TreeID == indexBefore {
		t.Fatal("checkpoint changed real index/HEAD or dropped unstaged bytes")
	}
	again, err := checkpoint(workspace, common, "stop", base)
	if err != nil || again != cp {
		t.Fatal("checkpoint replay changed identity", err)
	}
	r := workspaceRecord{Metadata: m, PrivateCheckpoint: &cp}
	if err = verifyRetainedWorkspace(workspace, common, r); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(workspace, "file"), []byte("tampered"), 0640); err != nil {
		t.Fatal(err)
	}
	if verifyRetainedWorkspace(workspace, common, r) == nil {
		t.Fatal("changed private work silently adopted")
	}
	if checkoutPinned(workspace, common, cache, base) == nil {
		t.Fatal("unexpected user bytes reset during checkout recovery")
	}
}

func TestWorkspaceInstructionsRejectSymlinksAndKeepEmptyCollection(t *testing.T) {
	dir := t.TempDir()
	external := filepath.Join(t.TempDir(), "instructions")
	if err := os.WriteFile(external, []byte("outside"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(external, filepath.Join(dir, "AGENTS.md")); err != nil {
		t.Fatal(err)
	}
	files, err := instructionFiles(dir)
	if err != nil || len(files) != 0 {
		t.Fatal("symlink instruction exposed", err)
	}
	raw, err := json.Marshal(protocol.EffectResult{InstructionFiles: files})
	if err != nil || !strings.Contains(string(raw), `"instruction_files":[]`) {
		t.Fatal("empty instruction files lost on wire", string(raw), err)
	}
}

func TestWorkspaceLockDoesNotExpireOrAdmitConcurrentWriter(t *testing.T) {
	p := filepath.Join(t.TempDir(), "workspace.lock")
	one, err := acquireFileLock(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if _, err = acquireFileLock(ctx, p); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("lock timeout released another writer", err)
	}
	releaseFileLock(one)
	two, err := acquireFileLock(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	releaseFileLock(two)
}

func TestStopReachesSlowAndLateSubmittedWorkspaceWorker(t *testing.T) {
	for _, late := range []bool{false, true} {
		t.Run(fmtBool(late), func(t *testing.T) {
			p := filepath.Join(t.TempDir(), "coordinator.lock")
			active, err := acquireFileLock(context.Background(), p)
			if err != nil {
				t.Fatal(err)
			}
			var calls atomic.Int32
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			// The first observation can precede a delayed systemd submission. Stop
			// keeps reconciling while the submitter retains the coordinator lock.
			stop, err := acquireStoppingWorkspace(ctx, p, func() error {
				n := calls.Add(1)
				if n == 1 && late {
					return nil
				}
				releaseFileLock(active)
				return nil
			})
			if err != nil {
				t.Fatal("Stop waited for network completion", err)
			}
			releaseFileLock(stop)
			if late && calls.Load() < 2 {
				t.Fatal("lost submission acknowledgement was treated as writer absence")
			}
		})
	}
}

func fmtBool(v bool) string {
	if v {
		return "late-submission"
	}
	return "slow-fetch"
}
