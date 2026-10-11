package host

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"testing"

	protocol "monos.local/protocol"
)

func TestTaskCleanupBindsExactFinalResultAndAllocationIdentity(t *testing.T) {
	f := resultTestNew(t)
	f.finish(t)
	i := f.request.Identity
	id, err := TaskWorkspaceID(i.TaskID, i.ResourceID)
	if err != nil {
		t.Fatal(err)
	}
	i.WorkspaceID = id
	r := protocol.TaskCleanupRequest{SchemaVersion: 1, CleanupID: "cleanup", TaskID: i.TaskID, RunnerID: i.RunnerID, CompletedAt: "2026-10-11T00:00:00.000Z", Attempts: []protocol.TaskCleanupAttempt{{AttemptID: i.AttemptID, DispatchID: i.DispatchID}}, Results: []protocol.ResultReadIdentity{i}, Workspaces: []protocol.TaskCleanupWorkspace{{WorkspaceID: id, ResourceID: i.ResourceID, Generation: i.Generation, StorageID: i.StorageID, Direct: true, AllocationIDS: []string{}, FinalizedCommit: i.GitCommit}}}
	if _, err = ValidateTaskCleanup(r); err != nil {
		t.Fatal(err)
	}
	wrong := r
	wrong.TaskID = "different"
	if _, err = ValidateTaskCleanup(wrong); err == nil {
		t.Fatal("foreign Task permitted filesystem cleanup")
	}
	wrong = r
	wrong.Results = nil
	if _, err = ValidateTaskCleanup(wrong); err == nil {
		t.Fatal("cleanup without final independent result")
	}
	wrong = r
	wrong.Attempts = []protocol.TaskCleanupAttempt{{AttemptID: i.AttemptID, DispatchID: "different"}}
	if _, err = ValidateTaskCleanup(wrong); err == nil {
		t.Fatal("result borrowed another Attempt dispatch")
	}
	wrong = r
	wrong.Workspaces = append([]protocol.TaskCleanupWorkspace(nil), r.Workspaces...)
	wrong.Workspaces[0].FinalizedCommit = i.BaseCommit
	if _, err = ValidateTaskCleanup(wrong); err == nil {
		t.Fatal("old result authorized current materialization cleanup")
	}
}

func TestTaskCleanupAllowsOnlyNewReplyOnlyConversation(t *testing.T) {
	request := protocol.TaskCleanupRequest{TaskID: "task", RunnerID: "runner", Attempts: []protocol.TaskCleanupAttempt{{AttemptID: "old-attempt", DispatchID: "old-dispatch"}}}
	for _, mode := range []string{"new", "old-attempt", "old-dispatch", "node", "mutable-conversation", "workspace", "source", "runner", "task"} {
		t.Run(mode, func(t *testing.T) {
			d := conversationSourceDispatch()
			d.TaskConversationSource.ReplyOnly = true
			switch mode {
			case "old-attempt":
				d.AttemptID = "old-attempt"
			case "old-dispatch":
				d.DispatchID = "old-dispatch"
			case "node":
				d.Kind = protocol.Node
			case "mutable-conversation":
				d.TaskConversationSource.ReplyOnly = false
			case "workspace":
				d.WorkspaceReservations.Resources = []protocol.WorkspaceReservation{{ResourceID: "repo", WorkspaceID: "workspace"}}
			case "source":
				d.TaskConversationSource.ContextDigest = "invalid"
			case "runner":
				d.RunnerID = "other"
			case "task":
				d.TaskID = ptr("other")
			}
			if CleanupAllowsConversation(request, d) != (mode == "new") {
				t.Fatal("retired Task conversation crossed frozen scope")
			}
			if mode == "new" {
				stop := protocol.Operation{AttemptID: d.AttemptID, DispatchID: d.DispatchID, Kind: protocol.Stop}
				if err := ValidateEffectScope(d, stop); err != nil {
					t.Fatal("post-cleanup conversation cannot Stop", err)
				}
				stop.Kind = protocol.KindOpenWorkspace
				if ValidateEffectScope(d, stop) == nil {
					t.Fatal("post-cleanup conversation reopened retired workspace")
				}
			}
		})
	}
}

func TestCleanupRemovesOnlyRetiredDirectoryAndKeepsIndependentGitResult(t *testing.T) {
	f := resultTestNew(t)
	f.finish(t)
	parent := filepath.Dir(f.work)
	archive := filepath.Join(parent, "rework-archives")
	unknown := filepath.Join(parent, "unknown")
	for _, path := range []string{archive, unknown} {
		if err := os.Mkdir(path, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(path, "keep"), []byte("private"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(unknown, filepath.Join(f.work, "external-link")); err != nil {
		t.Fatal(err)
	}
	target, err := observeCleanupTarget(f.work, uint32(os.Geteuid()))
	if err != nil {
		t.Fatal(err)
	}
	if err = removeCleanupTarget(context.Background(), target); err != nil {
		t.Fatal(err)
	}
	if err = removeCleanupTarget(context.Background(), target); err != nil {
		t.Fatal("interrupted reply cleanup not idempotent", err)
	}
	for _, path := range []string{archive, unknown} {
		if _, err = os.Stat(filepath.Join(path, "keep")); err != nil {
			t.Fatal("sibling recovery/unknown data deleted", err)
		}
	}
	if got := resultTestGit(t, f.export, nil, "rev-parse", "refs/monos/result^{tree}"); got != f.request.Identity.GitTree {
		t.Fatal("export depended on removed worktree")
	}
	resultTestGit(t, f.export, nil, "fsck", "--connectivity-only", "--no-reflogs")
}

func TestCleanupRefusesReplacementDirectoryAfterRetirement(t *testing.T) {
	parent := t.TempDir()
	path := filepath.Join(parent, "worktree")
	if err := os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	target, err := observeCleanupTarget(path, uint32(os.Geteuid()))
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(path, path+"-preserved"); err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(path, "new"), []byte("must remain"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = removeCleanupTarget(context.Background(), target); err == nil {
		t.Fatal("new inode mistaken for interrupted deletion")
	}
	if _, err = os.Stat(filepath.Join(path, "new")); err != nil {
		t.Fatal("replacement directory deleted", err)
	}
}

func TestCleanupStopsIfOpenDescendantMovesOutsideTarget(t *testing.T) {
	parent := t.TempDir()
	path := filepath.Join(parent, "worktree")
	nested := filepath.Join(path, "dependencies")
	if err := os.MkdirAll(nested, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nested, "keep"), []byte("dependency"), 0600); err != nil {
		t.Fatal(err)
	}
	target, err := observeCleanupTarget(path, uint32(os.Geteuid()))
	if err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(parent)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	checks := 0
	moved := filepath.Join(parent, "preserved")
	verify := func() error {
		checks++
		if checks == 3 {
			if err := os.Rename(nested, moved); err != nil {
				return err
			}
			return os.Mkdir(nested, 0700)
		}
		return nil
	}
	if err = removeCleanupEntry(context.Background(), root, "worktree", target.Device, verify); err == nil {
		t.Fatal("cleanup followed an open descendant outside its retired tree")
	}
	if _, err = os.Stat(filepath.Join(moved, "keep")); err != nil {
		t.Fatal("moved descendant was modified", err)
	}
}

type cleanupCancellationContext struct {
	context.Context
	cancel context.CancelFunc
	checks int
}

func (c *cleanupCancellationContext) Err() error {
	c.checks++
	if c.checks == 20 {
		c.cancel()
	}
	return c.Context.Err()
}

func TestCleanupCancellationStopsInsideTreeAndResumesSameInode(t *testing.T) {
	parent := t.TempDir()
	path := filepath.Join(parent, "worktree")
	if err := os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 64; i++ {
		if err := os.WriteFile(filepath.Join(path, fmt.Sprint(i)), []byte("dependency"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	target, err := observeCleanupTarget(path, uint32(os.Geteuid()))
	if err != nil {
		t.Fatal(err)
	}
	base, cancel := context.WithCancel(context.Background())
	defer cancel()
	ctx := &cleanupCancellationContext{Context: base, cancel: cancel}
	if err = removeCleanupTarget(ctx, target); !errors.Is(err, context.Canceled) {
		t.Fatal("tree deletion ignored cancellation", err)
	}
	remaining, err := os.ReadDir(path)
	if err != nil || len(remaining) == 0 || len(remaining) == 64 {
		t.Fatal("cancellation did not interrupt individual removals", len(remaining), err)
	}
	if err = removeCleanupTarget(context.Background(), target); err != nil {
		t.Fatal("cancelled cleanup could not resume", err)
	}
	if _, err = os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("resumed cleanup left materialization", err)
	}
}

func TestCleanupGitDropsRootAndSupplementaryGroups(t *testing.T) {
	credential := &syscall.Credential{Uid: 1001, Gid: 1002, Groups: []uint32{}}
	cmd, err := resultGitCommand(context.Background(), "/owned/export", credential, "fsck", "--connectivity-only")
	if err != nil {
		t.Fatal(err)
	}
	if cmd.Path != "/usr/bin/git" || cmd.SysProcAttr == nil || cmd.SysProcAttr.Credential == nil {
		t.Fatal("read-only Git omitted fixed command/identity")
	}
	got := cmd.SysProcAttr.Credential
	if got.Uid != 1001 || got.Gid != 1002 || got.NoSetGroups || len(got.Groups) != 0 {
		t.Fatal("read-only Git retained privileged groups", got)
	}
	for _, invalid := range []*syscall.Credential{{Uid: 0, Gid: 1002}, {Uid: 1001, Gid: 0}, {Uid: 1001, Gid: 1002, Groups: []uint32{0}}, {Uid: 1001, Gid: 1002, NoSetGroups: true}} {
		if _, err = resultGitCommand(context.Background(), "/owned/export", invalid, "fsck"); err == nil {
			t.Fatal("privileged Git identity accepted", invalid)
		}
	}
}
