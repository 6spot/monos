package host

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRemotePreparationPrivateItemLockAndRetainedIntent(t *testing.T) {
	root := filepath.Join(publicationTestRoot(t), "remote")
	item, e := lockPublicationRemoteItem(context.Background(), root, "item")
	if e != nil {
		t.Fatal(e)
	}
	op, e := item.operationDirectory("operation")
	if e != nil {
		t.Fatal(e)
	}
	intent := map[string]any{"operation_id": "operation", "started": true}
	if e := savePublicationFile(filepath.Join(op, "intent.json"), intent); e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()
	if blocked, e := lockPublicationRemoteItem(ctx, root, "item"); blocked != nil || !errors.Is(e, context.DeadlineExceeded) {
		t.Fatal("same item escaped physical exclusion", e)
	}
	other, e := lockPublicationRemoteItem(context.Background(), root, "other")
	if e != nil {
		t.Fatal("unrelated item blocked", e)
	}
	other.close()
	item.close()
	reopened, e := lockPublicationRemoteItem(context.Background(), root, "item")
	if e != nil {
		t.Fatal(e)
	}
	defer reopened.close()
	if _, e := readPublicationFile(filepath.Join(op, "intent.json")); e != nil {
		t.Fatal("lock release lost retained started intent", e)
	}
	if e := savePublicationFile(filepath.Join(op, "intent.json"), map[string]any{"operation_id": "replacement"}); e == nil {
		t.Fatal("conflicting intent replaced retained authority")
	}
	for path, mode := range map[string]os.FileMode{root: 0700, reopened.path: 0700, op: 0700, filepath.Join(reopened.path, "lock"): 0600, filepath.Join(op, "intent.json"): 0600} {
		info, e := os.Lstat(path)
		if e != nil || info.Mode().Perm() != mode {
			t.Fatal("remote primitive mode mismatch", path, e)
		}
	}
}

func TestRemotePreparationRejectsUnsafePrivateStorage(t *testing.T) {
	root := publicationTestRoot(t)
	unsafe := filepath.Join(root, "remote")
	if e := os.Mkdir(unsafe, 0755); e != nil {
		t.Fatal(e)
	}
	if item, e := lockPublicationRemoteItem(context.Background(), unsafe, "item"); e == nil || item != nil {
		t.Fatal("public remote journal admitted")
	}
	if item, e := lockPublicationRemoteItem(context.Background(), root, "../escape"); e == nil || item != nil {
		t.Fatal("item path traversal admitted")
	}
	itemPath := filepath.Join(root, "items", "symlink")
	if e := os.MkdirAll(itemPath, 0700); e != nil {
		t.Fatal(e)
	}
	target := filepath.Join(root, "target")
	if e := os.WriteFile(target, []byte("preserve"), 0600); e != nil {
		t.Fatal(e)
	}
	if e := os.Symlink(target, filepath.Join(itemPath, "lock")); e != nil {
		t.Fatal(e)
	}
	if item, e := lockPublicationRemoteItem(context.Background(), root, "symlink"); e == nil || item != nil {
		t.Fatal("symlink item lock admitted")
	}
	raw, _ := os.ReadFile(target)
	if string(raw) != "preserve" {
		t.Fatal("unsafe lock target changed")
	}
}

func remotePrimitivePush(t *testing.T, store, remote, hooks string, env []string, head, ref string) error {
	t.Helper()
	cmd := exec.Command("/usr/bin/git", "--no-replace-objects", "--git-dir="+store, "-c", "core.hooksPath="+hooks, "-c", "push.followTags=false", "push", "--porcelain", "--no-follow-tags", "--recurse-submodules=no", remote, head+":"+ref)
	cmd.Env = append(publicationGitEnvironment(), env...)
	raw, e := cmd.CombinedOutput()
	if e != nil {
		t.Logf("synthetic Git push rejected: %s", raw)
	}
	return e
}

func TestRemotePreparationFixedPrePushGuardInputAndTamper(t *testing.T) {
	root := publicationTestRoot(t)
	head, old := strings.Repeat("a", 40), strings.Repeat("b", 40)
	guard := publicationPushGuard{head, old, "refs/heads/delivery", "https://github.com/example/repo.git"}
	hooks, env, e := installPublicationPushGuard(context.Background(), root, guard)
	if e != nil {
		t.Fatal(e)
	}
	valid := head + " " + head + " " + guard.ref + " " + old + "\n"
	for _, tc := range []struct {
		name, input, destination string
		ok                       bool
	}{
		{"exact", valid, guard.destination, true},
		{"wrong_local", strings.Replace(valid, head, old, 1), guard.destination, false},
		{"wrong_new", strings.Replace(valid, head+" "+head, head+" "+old, 1), guard.destination, false},
		{"wrong_old", strings.Replace(valid, " "+old+"\n", " "+head+"\n", 1), guard.destination, false},
		{"wrong_ref", strings.Replace(valid, guard.ref, "refs/heads/other", 1), guard.destination, false},
		{"extra_update", valid + valid, guard.destination, false},
		{"extra_field", strings.TrimSuffix(valid, "\n") + " extra\n", guard.destination, false},
		{"no_newline", strings.TrimSuffix(valid, "\n"), guard.destination, false},
		{"nul", strings.Replace(valid, " ", "\x00 ", 1), guard.destination, false},
		{"bound", strings.Repeat("a", 4097) + "\n", guard.destination, false},
		{"wrong_destination", valid, "https://github.com/other/repo.git", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cmd := exec.Command(filepath.Join(hooks, "pre-push"), tc.destination, tc.destination)
			cmd.Env = append(publicationGitEnvironment(), env...)
			cmd.Stdin = strings.NewReader(tc.input)
			raw, e := cmd.CombinedOutput()
			if (e == nil) != tc.ok || len(raw) != 0 {
				t.Fatal("fixed guard input or output differs", e)
			}
		})
	}
	if e := os.WriteFile(filepath.Join(hooks, "pre-push"), []byte("#!/bin/sh\nexit 0\n"), 0700); e != nil {
		t.Fatal(e)
	}
	if _, _, e := installPublicationPushGuard(context.Background(), root, guard); e == nil {
		t.Fatal("tampered hook repaired or trusted")
	}
}

func TestRemotePreparationActualGitAdvertisedHeadAndReceiverCAS(t *testing.T) {
	work, base := scanFixture(t)
	resultTestWrite(t, work, "one", []byte("one"))
	middle := scanCommit(t, work)
	resultTestWrite(t, work, "two", []byte("two"))
	head := scanCommit(t, work)
	root := publicationTestRoot(t)
	remote := filepath.Join(root, "remote.git")
	resultTestGit(t, root, nil, "init", "--bare", "--quiet", remote)
	resultTestGit(t, remote, nil, "fetch", "--no-tags", work, base+":refs/heads/delivery", middle+":refs/monos/race")
	store := scanDir(t, work)
	guard := publicationPushGuard{head, base, "refs/heads/delivery", remote}
	hooks, env, e := installPublicationPushGuard(context.Background(), root, guard)
	if e != nil {
		t.Fatal(e)
	}
	// The unexpected middle is still an ancestor of head: ordinary FF alone
	// would accept it. The advertised expected-head guard must refuse it.
	resultTestGit(t, remote, nil, "update-ref", guard.ref, middle, base)
	if remotePrimitivePush(t, store, remote, hooks, env, head, guard.ref) == nil {
		t.Fatal("unexpected advertised ancestor accepted")
	}
	if resultTestGit(t, remote, nil, "rev-parse", guard.ref) != middle {
		t.Fatal("advertised mismatch mutated remote")
	}
	resultTestGit(t, remote, nil, "update-ref", guard.ref, base, middle)
	// A synthetic receiver-only hook moves the ref after advertisement. This
	// test hook is not used by production; receive-pack must reject old-OID CAS.
	receiverHook := filepath.Join(remote, "hooks", "pre-receive")
	script := "#!/bin/sh\nunset GIT_QUARANTINE_PATH GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES\n/usr/bin/git update-ref refs/heads/delivery " + middle + " " + base + "\n"
	if e := os.WriteFile(receiverHook, []byte(script), 0700); e != nil {
		t.Fatal(e)
	}
	if remotePrimitivePush(t, store, remote, hooks, env, head, guard.ref) == nil {
		t.Fatal("receiver CAS race accepted")
	}
	if resultTestGit(t, remote, nil, "rev-parse", guard.ref) != middle {
		t.Fatal("receiver race did not preserve foreign update")
	}
	if e := os.Remove(receiverHook); e != nil {
		t.Fatal(e)
	}
	guard.expected = middle
	_, env, e = installPublicationPushGuard(context.Background(), root, guard)
	if e != nil || remotePrimitivePush(t, store, remote, hooks, env, head, guard.ref) != nil {
		t.Fatal("exact nonforce FF push failed", e)
	}
	if resultTestGit(t, remote, nil, "rev-parse", guard.ref) != head {
		t.Fatal("successful push has wrong head")
	}
	guard.ref = "refs/heads/created"
	guard.expected = strings.Repeat("0", len(head))
	_, env, e = installPublicationPushGuard(context.Background(), root, guard)
	if e != nil || remotePrimitivePush(t, store, remote, hooks, env, head, guard.ref) != nil {
		t.Fatal("exact absent-head create failed", e)
	}
	resultTestGit(t, work, nil, "checkout", "--quiet", base)
	resultTestWrite(t, work, "sibling", []byte("sibling"))
	sibling := scanCommit(t, work)
	guard.head, guard.expected = sibling, head
	_, env, e = installPublicationPushGuard(context.Background(), root, guard)
	if e != nil || remotePrimitivePush(t, store, remote, hooks, env, sibling, guard.ref) == nil {
		t.Fatal("guard bypassed ordinary non-fast-forward refusal", e)
	}
	if resultTestGit(t, remote, nil, "rev-parse", guard.ref) != head {
		t.Fatal("non-fast-forward refusal changed remote")
	}
}

func TestRemotePreparationNativeRetainedPermissionFixture(t *testing.T) {
	root := os.Getenv("MONOS_REMOTE_PREPARATION_EVIDENCE_DIR")
	if root == "" {
		t.Skip("explicit retained evidence directory required")
	}
	if !filepath.IsAbs(root) || publicationDirectory(root) != nil {
		t.Fatal("safe private evidence directory required")
	}
	entries, e := os.ReadDir(root)
	if e != nil || len(entries) != 0 {
		t.Fatal("evidence directory must be initially empty")
	}
	f := publicationPushTestFixtureAt(t, root)
	originalRefs := resultTestGit(t, f.source.export, nil, "show-ref")
	result, e := f.run(context.Background())
	if e != nil || result.Status != "published" || !result.WorkerAbsent {
		t.Fatal("actual durable synthetic Git lane failed", e)
	}
	f.ack(t, result)
	published := f.proof(result)
	next := f.preparation
	next.Published = &published
	next.PublishedDigest = publicationPointer(publicationDigest(published))
	if verifyPublicationPublishedAt(context.Background(), next, f.root, f.remoteRoot, f.io) != nil {
		t.Fatal("own acknowledged public proof unavailable")
	}
	if resultTestGit(t, f.source.export, nil, "show-ref") != originalRefs {
		t.Fatal("source refs changed")
	}
	op := filepath.Join(f.remoteRoot, "items", f.request.ItemID, "operations", f.request.OperationID)
	type proofPath struct {
		Kind string `json:"kind"`
		Path string `json:"path"`
		Mode string `json:"mode"`
	}
	paths := []proofPath{}
	for _, p := range []struct{ kind, path string }{
		{"root", root}, {"journal", f.remoteRoot}, {"item", filepath.Dir(filepath.Dir(op))}, {"operation", op}, {"intent", filepath.Join(op, "intent.json")}, {"started", filepath.Join(op, "started.json")}, {"worker", filepath.Join(op, "worker.json")}, {"absence", filepath.Join(op, "absence.json")}, {"result", filepath.Join(op, "result.json")}, {"ack", filepath.Join(op, "ack.json")}, {"published", filepath.Join(op, "published.json")}, {"lock", filepath.Join(filepath.Dir(filepath.Dir(op)), "lock")}, {"hooks", filepath.Join(op, "hooks")}, {"pre_push", filepath.Join(op, "hooks", "pre-push")}, {"public_object_store", f.store}, {"original_source_export", f.source.export}, {"synthetic_remote", f.remote}, {"candidate_intent", filepath.Join(f.root, "constructions", f.preparation.Construction.ConstructionID, "intent.json")}, {"candidate_manifest", filepath.Join(f.root, "constructions", f.preparation.Construction.ConstructionID, "candidate.json")}, {"scan_pages", filepath.Join(f.root, "operations", f.preparation.OperationID, "pages.json")},
	} {
		info, e := os.Lstat(p.path)
		if e != nil || info.Mode()&os.ModeSymlink != 0 {
			t.Fatal("safe evidence path unavailable")
		}
		paths = append(paths, proofPath{p.kind, p.path, fmt.Sprintf("%04o", info.Mode().Perm())})
	}
	proof := map[string]any{"schema_version": 1, "fixture_scope": "full_lane_actual_git_synthetic_baseline", "service_uid": os.Geteuid(), "operation_id": f.request.OperationID, "item_id": f.request.ItemID, "request_digest": publicationDigest(f.request), "result_digest": publicationDigest(result), "candidate_manifest_digest": published.CandidateManifestDigest, "published_proof_digest": publicationDigest(published), "head": published.Candidate.Head, "tree": published.Candidate.Tree, "parents": published.Candidate.Parents, "remote_ref": f.request.DeliveryRef, "observed_head": *result.Observation.Head, "source_head": f.preparation.Source.GitCommit, "source_tree": f.preparation.Source.GitTree, "paths": paths}
	if savePublicationFile(filepath.Join(root, "proof.json"), proof) != nil {
		t.Fatal("safe proof unavailable")
	}
}
