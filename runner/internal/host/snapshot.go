package host

import (
	"fmt"
	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
	"os"
	"path/filepath"
	"syscall"
)

func serviceDirectory(path string, private bool) error {
	s, err := os.Lstat(path)
	if err != nil {
		return err
	}
	stat, ok := s.Sys().(*syscall.Stat_t)
	if !ok || !s.IsDir() || stat.Uid != uint32(os.Geteuid()) || s.Mode().Perm()&0022 != 0 {
		return fmt.Errorf("unsafe service directory: %s", path)
	}
	if private && s.Mode().Perm()&0077 != 0 {
		return fmt.Errorf("service directory is not private")
	}
	return nil
}

// Git upload-pack versions differ in whether ownership is checked against the
// linked worktree or its administrative Git directory. Trust exactly those two
// paths in this fixture layout, never every repository beneath the common root.
func exportCloneArgs(workspace, common, destination string) []string {
	metadata := filepath.Join(common, "worktrees", filepath.Base(workspace))
	return []string{
		"-c", "safe.directory=" + workspace,
		"-c", "safe.directory=" + metadata,
		"clone", "--bare", "--no-local", workspace, destination,
	}
}

func exportFetchArgs(workspace, common, ref string) []string {
	metadata := filepath.Join(common, "worktrees", filepath.Base(workspace))
	// Git 2.47.3 rejects upload-pack through a cross-owner linked worktree's
	// .git indirection even with both exact paths trusted. Unlike clone, fetch
	// does not resolve that source first. Use its already-known administrative
	// directory directly; keep the same two protected safe-directory scopes.
	return []string{
		"-c", "safe.directory=" + workspace,
		"-c", "safe.directory=" + metadata,
		"fetch", "--no-tags", metadata, ref + ":refs/monos/result",
	}
}

// Inspect runs as the unprivileged service identity, never as the Agent account.
// The execution group can read the snapshot; only service ownership can modify it.
func Inspect(id string) (protocol.EffectResult, error) {
	if !ValidID(id) || os.Geteuid() == 0 {
		return protocol.EffectResult{}, fmt.Errorf("invalid service inspection")
	}
	path := filepath.Join(Root, "inspection", id)
	if err := serviceDirectory(filepath.Dir(path), false); err != nil {
		return protocol.EffectResult{}, err
	}
	if err := os.Mkdir(path, 0750); err != nil && !os.IsExist(err) {
		return protocol.EffectResult{}, err
	}
	if err := serviceDirectory(path, false); err != nil {
		return protocol.EffectResult{}, err
	}
	if _, err := os.Stat(filepath.Join(path, ".git")); os.IsNotExist(err) {
		if _, err = git(path, "clone", "--no-local", filepath.Join(Root, "cache", "fixture.git"), path); err != nil {
			return protocol.EffectResult{}, err
		}
	} else if err != nil {
		return protocol.EffectResult{}, err
	}
	// A retained .git alone does not establish that a crash-interrupted clone
	// finished its checkout. Keep incomplete state for recovery instead of exposing it.
	tree, err := git(path, "rev-parse", "HEAD^{tree}")
	if err != nil {
		return protocol.EffectResult{}, err
	}
	index, err := git(path, "write-tree")
	if err != nil {
		return protocol.EffectResult{}, err
	}
	dirty, err := git(path, "status", "--porcelain")
	if err != nil {
		return protocol.EffectResult{}, err
	}
	if index != tree || dirty != "" {
		return protocol.EffectResult{}, fmt.Errorf("inspection checkout incomplete or changed")
	}
	return protocol.EffectResult{WorkspaceID: ptr(WorkspaceID("inspection", id)), Path: &path}, nil
}

// Export retains the exact private result in service-owned storage without publication.
func Export(id, op, commit, tree string) error {
	if !ValidID(id) || !ValidID(op) || os.Geteuid() == 0 {
		return fmt.Errorf("invalid service export")
	}
	if !objectID.MatchString(commit) || !objectID.MatchString(tree) {
		return invalidFinalization(fmt.Errorf("invalid finalized object identity"))
	}
	return exportPaths(Path(id, "workspace"), Path(id, "common"), op, commit, tree, "")
}

func ExportWorkspace(op protocol.Operation, result protocol.EffectResult) error {
	if op.Kind == protocol.KindCompleteNode {
		if err := wire.ValidateCompletionResult(op, result); err != nil {
			return err
		}
		for _, item := range result.WorkspaceResults {
			path, err := completionResultPath(op.OperationID, item.WorkspaceID, false)
			if err != nil {
				return err
			}
			commit, tree := item.Capture.NodeCommit, item.Capture.NodeTree
			if result.CompletionOutcome != nil && *result.CompletionOutcome == "finalized" {
				commit, tree = *item.GitCommit, *item.GitTree
			}
			if err = verifyProtectedWorkspaceResult(path, commit, tree); err != nil {
				return err
			}
		}
		return nil
	}
	if op.Kind == protocol.SettleCompletion {
		if op.CompletionOperationID == nil {
			return fmt.Errorf("missing completion target")
		}
		parent, err := readOperation(operationPath(*op.CompletionOperationID))
		if err != nil {
			return err
		}
		if err = wire.ValidateCompletionTarget(op, parent.Operation); err != nil {
			return err
		}
		if len(result.WorkspaceResults) != len(parent.Operation.Workspaces) {
			return fmt.Errorf("settlement export coverage mismatch")
		}
		for i, input := range parent.Operation.Workspaces {
			item := result.WorkspaceResults[i]
			w, cp := &input.Workspace, item.WorkspaceMetadata.Checkpoint
			if item.ResourceID != w.ResourceID || item.WorkspaceID != w.WorkspaceID || cp == nil || cp.OperationID != op.OperationID {
				return fmt.Errorf("settlement export checkpoint mismatch")
			}
			path, err := completionResultPath(op.OperationID, w.WorkspaceID, false)
			if err != nil {
				return err
			}
			if err = privateServiceDirectory(filepath.Dir(path)); err != nil {
				return err
			}
			if err = exportPathsTo(WorkspacePath(w, "worktree"), WorkspacePath(w, "common"), op.OperationID, cp.CommitID, cp.TreeID, "refs/monos/checkpoints/"+op.OperationID, path); err != nil {
				return err
			}
		}
		return nil
	}
	if op.Workspace == nil {
		return fmt.Errorf("workspace descriptor required")
	}
	commit, tree, ref := "", "", ""
	if result.WorkspaceMetadata != nil && result.WorkspaceMetadata.Checkpoint != nil {
		cp := result.WorkspaceMetadata.Checkpoint
		commit, tree, ref = cp.CommitID, cp.TreeID, "refs/monos/checkpoints/"+op.OperationID
	} else if result.GitCommit != nil && result.GitTree != nil {
		commit, tree, ref = *result.GitCommit, *result.GitTree, "refs/monos/operations/"+op.OperationID
	} else {
		return nil
	}
	return exportPaths(WorkspacePath(op.Workspace, "worktree"), WorkspacePath(op.Workspace, "common"), op.OperationID, commit, tree, ref)
}

func exportPaths(workspace, common, op, commit, tree, ref string) error {
	return exportPathsTo(workspace, common, op, commit, tree, ref, filepath.Join(Root, "results", op))
}

func exportPathsTo(workspace, common, op, commit, tree, ref, destination string) error {
	if !ValidID(op) || !objectID.MatchString(commit) || !objectID.MatchString(tree) || os.Geteuid() == 0 {
		return fmt.Errorf("invalid service export identity")
	}
	if err := serviceDirectory(filepath.Dir(destination), true); err != nil {
		return err
	}
	if err := os.Mkdir(destination, 0700); err != nil && !os.IsExist(err) {
		return err
	}
	if err := serviceDirectory(destination, true); err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(destination, "HEAD")); os.IsNotExist(err) {
		if _, err = gitScoped(destination, nil, nil, exportCloneArgs(workspace, common, destination)...); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	if ref != "" {
		if _, err := gitScoped(destination, nil, nil, exportFetchArgs(workspace, common, ref)...); err != nil {
			return err
		}
	}
	if _, err := gitScoped(destination, nil, nil, "--git-dir="+destination, "fsck", "--connectivity-only", "--no-reflogs"); err != nil {
		return err
	}
	actual, err := gitScoped(destination, nil, nil, "--git-dir="+destination, "rev-parse", commit+"^{tree}")
	if err != nil {
		return err
	}
	if actual != tree {
		return invalidFinalization(fmt.Errorf("exported tree mismatch"))
	}
	_, err = gitScoped(destination, nil, nil, "--git-dir="+destination, "update-ref", "refs/monos/result", commit)
	return err
}
