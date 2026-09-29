package host

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCrossOwnerCheckpointFetchFromDetachedWorktree(t *testing.T) {
	cache, base := fixtureRepository(t)
	root := t.TempDir()
	common, workspace, destination := filepath.Join(root, "common"), filepath.Join(root, "worktree"), filepath.Join(root, "result")
	if _, err := git(root, "clone", "--bare", "--no-local", cache, common); err != nil {
		t.Fatal(err)
	}
	if _, err := git(common, "worktree", "add", "--detach", workspace, base); err != nil {
		t.Fatal(err)
	}
	if _, err := git(workspace, "commit", "--allow-empty", "-m", "private Agent commit"); err != nil {
		t.Fatal(err)
	}
	headBefore, err := git(workspace, "rev-parse", "HEAD")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "file"), []byte("private staged work"), 0640); err != nil {
		t.Fatal(err)
	}
	if _, err := git(workspace, "add", "file"); err != nil {
		t.Fatal(err)
	}
	indexBefore, err := git(workspace, "write-tree")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "file"), []byte("private unstaged work"), 0640); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "untracked"), []byte("private untracked work"), 0640); err != nil {
		t.Fatal(err)
	}
	cp, err := checkpoint(workspace, common, "stop", base)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(destination, 0700); err != nil {
		t.Fatal(err)
	}
	env := []string{"GIT_TEST_ASSUME_DIFFERENT_OWNER=1"}
	if _, err := gitScoped(destination, nil, env, exportCloneArgs(workspace, common, destination)...); err != nil {
		t.Fatal(err)
	}
	// This is the retained native failure boundary: clone succeeded, but the
	// checkpoint lives only under a private ref and has not been imported.
	if _, err := git(destination, "cat-file", "-e", cp.CommitID); err == nil {
		t.Fatal("clone unexpectedly included the checkpoint; no partial export exercised")
	}
	for i := 0; i < 2; i++ {
		if _, err := gitScoped(destination, nil, env, exportFetchArgs(workspace, common, "refs/monos/checkpoints/stop")...); err != nil {
			t.Fatal(err)
		}
		if _, err := gitScoped(destination, nil, env, "fsck", "--connectivity-only", "--no-reflogs"); err != nil {
			t.Fatal(err)
		}
		commit, err := gitScoped(destination, nil, env, "rev-parse", "refs/monos/result")
		if err != nil || commit != cp.CommitID {
			t.Fatalf("checkpoint export changed commit: %s %v", commit, err)
		}
		actual, err := gitScoped(destination, nil, env, "rev-parse", "refs/monos/result^{tree}")
		if err != nil || actual != cp.TreeID {
			t.Fatalf("checkpoint export changed tree: %s %v", actual, err)
		}
	}
	for expression, want := range map[string]string{"HEAD": headBefore, "refs/monos/checkpoints/stop": cp.CommitID} {
		actual, err := git(workspace, "rev-parse", expression)
		if err != nil || actual != want {
			t.Fatalf("export changed source %s: %s %v", expression, actual, err)
		}
	}
	indexAfter, err := git(workspace, "write-tree")
	if err != nil || indexAfter != indexBefore {
		t.Fatalf("export changed real index: %s %v", indexAfter, err)
	}
	for name, want := range map[string]string{"file": "private unstaged work", "untracked": "private untracked work"} {
		actual, err := os.ReadFile(filepath.Join(workspace, name))
		if err != nil || string(actual) != want {
			t.Fatalf("export changed source file %s: %q %v", name, actual, err)
		}
	}
	if _, err := os.Stat(filepath.Join(destination, "objects", "info", "alternates")); !os.IsNotExist(err) {
		t.Fatalf("export must not share alternates: %v", err)
	}
}
