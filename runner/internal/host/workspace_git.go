package host

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

type workspaceRecord struct {
	Operation                protocol.Operation            `json:"operation"`
	Stage                    string                        `json:"stage"`
	Metadata                 protocol.WorkspaceMetadata    `json:"metadata"`
	OpenResult               *protocol.EffectResult        `json:"open_result,omitempty"`
	Released                 bool                          `json:"released"`
	PrivateCheckpoint        *protocol.WorkspaceCheckpoint `json:"private_checkpoint,omitempty"`
	TargetObservationLeaseID string                        `json:"target_observation_lease_id,omitempty"`
}

func readWorkspaceRecord(id string) (workspaceRecord, error) {
	return readWorkspaceRecordAt(workspaceRecordPath(id), id, 0)
}
func readWorkspaceRecordAt(p, id string, owner uint32) (workspaceRecord, error) {
	var r workspaceRecord
	if err := trustedFile(p, owner); err != nil {
		return r, err
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return r, err
	}
	err = json.Unmarshal(b, &r)
	if err == nil && (r.Operation.Workspace == nil || r.Operation.Workspace.WorkspaceID != id || r.Operation.WorkspaceDigest == nil) {
		err = fmt.Errorf("invalid root workspace record")
	}
	if err == nil {
		_, digest, e := wire.Canonical(r.Operation.Workspace)
		if e != nil || digest != *r.Operation.WorkspaceDigest {
			err = fmt.Errorf("corrupt root workspace descriptor")
		}
	}
	if err == nil {
		switch r.Stage {
		case "intent", "pinned", "promoting", "common_ready", "ready", "refresh_intent", "refresh_pinned", "cancelled", "rework_intent", "rework_archiving", "rework_archived":
		default:
			err = fmt.Errorf("unknown workspace materialization stage")
		}
	}
	if err == nil && r.Stage == "ready" && r.OpenResult == nil {
		err = fmt.Errorf("ready workspace missing retained open result")
	}
	return r, err
}

func workspaceGit(dir, cache, common string, extra []string, args ...string) (string, error) {
	return gitScoped(dir, []string{cache, common}, extra, args...)
}

// fetchWorkspace runs only as the service identity. Neither returned metadata nor
// its durable pin record contains the access response, token, or raw Git errors.
func fetchWorkspace(cache, stagePath string, op protocol.Operation, access protocol.RepositoryAccessResult) (protocol.WorkspaceMetadata, error) {
	return fetchWorkspaceUsing(cache, stagePath, op, access, workspaceFetchGit)
}

// Network fetch runs inside the retained systemd workspace worker. Keep that
// worker's existing timeout/absence boundary and bound untrusted remote output.
func workspaceFetchGit(dir, cache, common string, env []string, args ...string) (string, error) {
	if len(env) == 0 {
		return workspaceGit(dir, cache, common, env, args...)
	}
	return gitScopedOutputLimit(dir, []string{cache, common}, env, 16<<10, args...)
}

func fetchWorkspaceUsing(cache, stagePath string, op protocol.Operation, access protocol.RepositoryAccessResult, run func(string, string, string, []string, ...string) (string, error)) (protocol.WorkspaceMetadata, error) {
	w := op.Workspace
	var metadata protocol.WorkspaceMetadata
	if w == nil || op.WorkspaceDigest == nil || access.OperationID != op.OperationID || access.WorkspaceDigest != *op.WorkspaceDigest {
		return metadata, fmt.Errorf("repository access ownership mismatch")
	}
	if wire.ValidateRepositoryEndpoint(w.Resource, access.RemoteURL, access.ProviderMetadata) != nil {
		return metadata, fmt.Errorf("repository_denied: endpoint identity mismatch")
	}
	var retained struct {
		Digest           string                              `json:"digest"`
		BaseRef          string                              `json:"base_ref"`
		TargetBranch     string                              `json:"target_branch"`
		ProviderMetadata protocol.RepositoryProviderMetadata `json:"provider_metadata"`
		RemoteURL        string                              `json:"remote_url"`
		Complete         bool                                `json:"complete"`
		Metadata         protocol.WorkspaceMetadata          `json:"metadata"`
	}
	loaded := false
	if raw, err := os.ReadFile(stagePath); err == nil {
		if json.Unmarshal(raw, &retained) != nil || retained.Digest != *op.WorkspaceDigest || retained.BaseRef == "" || retained.TargetBranch == "" || retained.RemoteURL != access.RemoteURL || !wire.SameRepositoryProvider(&retained.ProviderMetadata, &access.ProviderMetadata) {
			return metadata, fmt.Errorf("cache pin identity mismatch")
		}
		if retained.Complete {
			return retained.Metadata, nil
		}
		loaded = true
	} else if !os.IsNotExist(err) {
		return metadata, err
	}
	if err := os.Mkdir(cache, 0750); err != nil && !os.IsExist(err) {
		return metadata, err
	}
	if err := serviceDirectory(cache, false); err != nil {
		return metadata, err
	}
	if _, err := os.Stat(filepath.Join(cache, "HEAD")); os.IsNotExist(err) {
		if _, err = run(cache, cache, cache, nil, "init", "--bare", cache); err != nil {
			return metadata, fmt.Errorf("storage_unavailable: cache initialization failed")
		}
	} else if err != nil {
		return metadata, err
	}
	branch := access.DefaultBranch
	if w.Resource.DefaultBranch != nil {
		branch = *w.Resource.DefaultBranch
	}
	if w.Basis != nil {
		branch = w.Basis.TargetBranch
	}
	if loaded {
		branch = retained.TargetBranch
	}
	if _, err := run(cache, cache, cache, nil, "check-ref-format", "refs/heads/"+branch); err != nil {
		return metadata, fmt.Errorf("ref_unavailable: invalid target branch")
	}
	baseRef := branch
	if w.Resource.DefaultRef != nil {
		baseRef = *w.Resource.DefaultRef
	}
	if w.Basis != nil {
		baseRef = w.Basis.BaseCommit
	}
	if loaded {
		baseRef = retained.BaseRef
	} else {
		retained.Digest = *op.WorkspaceDigest
		retained.BaseRef = baseRef
		retained.TargetBranch = branch
		retained.ProviderMetadata = access.ProviderMetadata
		retained.RemoteURL = access.RemoteURL
		// Pin the first default-branch/ref intent before either network fetch.
		// Provider metadata observed by a retry cannot silently select a target.
		if err := saveRecord(stagePath, retained); err != nil {
			return metadata, err
		}
	}
	env, err := repositoryAccessEnvironment(access.RemoteURL, access.Authentication)
	if err != nil {
		return metadata, fmt.Errorf("credentials_missing: repository access unavailable")
	}
	remoteGit := func(args ...string) (string, error) {
		if _, _, e := repositoryCredentials(access.RemoteURL, access.Authentication, 0); e != nil {
			return "", fmt.Errorf("credentials_missing: repository access expired")
		}
		args = append([]string{"-c", "protocol.https.allow=always", "-c", "http.sslVerify=true", "-c", "http.lowSpeedLimit=1", "-c", "http.lowSpeedTime=20"}, args...)
		out, err := run(cache, cache, cache, env, args...)
		if err != nil {
			return "", fmt.Errorf("ref_unavailable: repository fetch failed")
		}
		return out, nil
	}
	// Resolve short names against both heads and tags; never let Git choose an
	// ambiguous ref. Retrying uses existing operation pins, not a moving HEAD.
	prefix := "refs/monos/pins/" + op.OperationID
	if pinned, e := run(cache, cache, cache, nil, "rev-parse", "--verify", prefix+"/base^{commit}"); e == nil {
		baseRef = pinned
	}
	if !strings.HasPrefix(baseRef, "refs/") && !objectID.MatchString(baseRef) {
		out, err := remoteGit("ls-remote", "--refs", access.RemoteURL, "refs/heads/"+baseRef, "refs/tags/"+baseRef)
		if err != nil {
			return metadata, err
		}
		lines := strings.Fields(out)
		if len(lines) != 2 {
			return metadata, fmt.Errorf("ref_unavailable: missing or ambiguous base ref")
		}
		baseRef = lines[1]
	}
	resolvePin := func(name, source string) (string, error) {
		if value, e := run(cache, cache, cache, nil, "rev-parse", "--verify", prefix+"/"+name+"^{commit}"); e == nil {
			return value, nil
		}
		if name == "base" && w.Basis != nil {
			if _, e := run(cache, cache, cache, nil, "cat-file", "-e", source+"^{commit}"); e == nil {
				if _, e = run(cache, cache, cache, nil, "update-ref", prefix+"/base", source); e != nil {
					return "", e
				}
				return source, nil
			}
		}
		if _, e := remoteGit("fetch", "--no-tags", "--no-recurse-submodules", access.RemoteURL, source+":"+prefix+"/"+name); e != nil {
			return "", e
		}
		return run(cache, cache, cache, nil, "rev-parse", "--verify", prefix+"/"+name+"^{commit}")
	}
	base, err := resolvePin("base", baseRef)
	if err != nil {
		return metadata, err
	}
	target, err := resolvePin("target", "refs/heads/"+branch)
	if err != nil {
		return metadata, err
	}
	metadata = protocol.WorkspaceMetadata{BaseCommit: base, FinalizedCommit: base, Generation: w.Generation, LeaseID: w.LeaseID, RepositoryIdentity: w.Resource.RepositoryIdentity, TargetBranch: branch, TargetCommit: target, ProviderMetadata: &access.ProviderMetadata}
	if w.Basis != nil {
		if base != w.Basis.BaseCommit {
			return metadata, fmt.Errorf("ref_unavailable: fixed base changed")
		}
		metadata.FinalizedCommit = w.Basis.FinalizedCommit
	}
	retained.Digest, retained.Metadata = *op.WorkspaceDigest, metadata
	retained.Complete = true
	if err = saveRecord(stagePath, retained); err != nil {
		return metadata, err
	}
	return metadata, nil
}

func clonePinned(cache, common string, metadata protocol.WorkspaceMetadata, operation string) error {
	if _, err := os.Stat(filepath.Join(common, "HEAD")); os.IsNotExist(err) {
		if _, err = workspaceGit(common, cache, common, nil, "clone", "--bare", "--no-local", cache, common); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	origin, err := workspaceGit(common, cache, common, nil, "config", "--get", "remote.origin.url")
	if err != nil || origin != cache {
		return fmt.Errorf("storage_unavailable: clone origin mismatch")
	}
	if _, err = os.Lstat(filepath.Join(common, "objects", "info", "alternates")); !os.IsNotExist(err) {
		return fmt.Errorf("storage_unavailable: clone has alternates")
	}
	prefix := "refs/monos/pins/" + operation
	if _, err = workspaceGit(common, cache, common, nil, "fetch", "--no-tags", cache, prefix+"/base:"+prefix+"/base", prefix+"/target:"+prefix+"/target"); err != nil {
		return err
	}
	if metadata.Isolation != nil {
		if _, err = workspaceGit(common, cache, common, nil, "fetch", "--no-tags", cache, prefix+"/finalized:"+prefix+"/finalized"); err != nil {
			return err
		}
	}
	for _, oid := range []string{metadata.BaseCommit, metadata.TargetCommit} {
		if _, err = workspaceGit(common, cache, common, nil, "cat-file", "-e", oid+"^{commit}"); err != nil {
			return err
		}
	}
	if metadata.TargetBranch != "" {
		if _, err = workspaceGit(common, cache, common, nil, "update-ref", "refs/remotes/origin/"+metadata.TargetBranch, metadata.TargetCommit); err != nil {
			return err
		}
	}
	return nil
}

func checkoutPinned(workspace, common, cache, base string) error {
	if _, err := os.Lstat(filepath.Join(workspace, ".git")); os.IsNotExist(err) {
		if _, err = workspaceGit(common, cache, common, nil, "worktree", "add", "--detach", workspace, base); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	head, err := workspaceGit(workspace, cache, common, nil, "rev-parse", "HEAD")
	if err != nil {
		return err
	}
	if head != base {
		return fmt.Errorf("storage_unavailable: unexposed checkout HEAD changed")
	}
	tree, err := workspaceGit(workspace, cache, common, nil, "rev-parse", base+"^{tree}")
	if err != nil {
		return err
	}
	index, err := workspaceGit(workspace, cache, common, nil, "write-tree")
	if err != nil {
		return err
	}
	dirty, err := workspaceGit(workspace, cache, common, nil, "status", "--porcelain")
	if err != nil {
		return err
	}
	if tree != index || dirty != "" {
		if err = repairUnexposedCheckout(workspace, common, cache, base); err != nil {
			return err
		}
	}
	return nil
}

// Only a root-owned common_ready stage calls this. Existing changed/extra files
// stop recovery; absent tracked files from an interrupted initial checkout can
// be filled from the exact pinned base without overwriting user bytes.
func repairUnexposedCheckout(workspace, common, cache, base string) error {
	idx, err := os.CreateTemp(common, "initial-index-*")
	if err != nil {
		return err
	}
	index := idx.Name()
	idx.Close()
	os.Remove(index)
	defer os.Remove(index)
	env := []string{"GIT_INDEX_FILE=" + index}
	if _, err = workspaceGit(workspace, cache, common, env, "read-tree", base); err != nil {
		return err
	}
	changed, err := workspaceGit(workspace, cache, common, env, "diff-files", "--name-only", "--diff-filter=ACMRTUXB", "-z")
	if err != nil {
		return err
	}
	extra, err := workspaceGit(workspace, cache, common, env, "ls-files", "--others", "-z")
	if err != nil {
		return err
	}
	if changed != "" || extra != "" {
		return fmt.Errorf("storage_unavailable: unexpected data in unexposed checkout")
	}
	missing, err := workspaceGit(workspace, cache, common, env, "diff-files", "--name-only", "--diff-filter=D", "-z")
	if err != nil {
		return err
	}
	for _, path := range strings.Split(strings.TrimSuffix(missing, "\x00"), "\x00") {
		if path == "" {
			continue
		}
		if _, err = workspaceGit(workspace, cache, common, env, "checkout-index", "--", path); err != nil {
			return err
		}
	}
	actualIndex, err := workspaceGit(workspace, cache, common, nil, "rev-parse", "--git-path", "index")
	if err != nil {
		return err
	}
	if !filepath.IsAbs(actualIndex) {
		actualIndex = filepath.Join(workspace, actualIndex)
	}
	if _, e := os.Stat(actualIndex); os.IsNotExist(e) {
		if err = os.Rename(index, actualIndex); err != nil {
			return err
		}
		return syncDirectory(filepath.Dir(actualIndex))
	} else if e != nil {
		return e
	}
	want, err := workspaceGit(workspace, cache, common, nil, "rev-parse", base+"^{tree}")
	if err != nil {
		return err
	}
	got, err := workspaceGit(workspace, cache, common, nil, "write-tree")
	if err != nil {
		return err
	}
	if got != want {
		return fmt.Errorf("storage_unavailable: initial index changed")
	}
	return nil
}

func privateTree(workspace, common string) (string, error) {
	idx, err := os.CreateTemp(common, "private-index-*")
	if err != nil {
		return "", err
	}
	index := idx.Name()
	idx.Close()
	os.Remove(index)
	defer os.Remove(index)
	env := []string{"GIT_INDEX_FILE=" + index}
	if _, err = gitEnv(workspace, env, "read-tree", "HEAD"); err != nil {
		return "", err
	}
	if _, err = gitEnv(workspace, env, "add", "--all"); err != nil {
		return "", err
	}
	return gitEnv(workspace, env, "write-tree")
}

func verifyRetainedWorkspace(workspace, common string, r workspaceRecord) error {
	head, err := git(workspace, "rev-parse", "HEAD")
	if err != nil {
		return err
	}
	if r.PrivateCheckpoint == nil {
		if head != r.Metadata.FinalizedCommit {
			return fmt.Errorf("storage_unavailable: finalized HEAD changed")
		}
		return nil
	}
	cp := r.PrivateCheckpoint
	ref, err := git(workspace, "rev-parse", "refs/monos/checkpoints/"+cp.OperationID)
	if err != nil || ref != cp.CommitID || head != cp.HeadCommit {
		return fmt.Errorf("storage_unavailable: retained checkpoint identity changed")
	}
	tree, err := privateTree(workspace, common)
	if err != nil {
		return err
	}
	if tree != cp.TreeID {
		return fmt.Errorf("storage_unavailable: retained private work changed")
	}
	return nil
}

func instructionFiles(path string) ([]protocol.InstructionFile, error) {
	files := []protocol.InstructionFile{}
	for _, name := range []protocol.InstructionFile{protocol.AGENTSMd, protocol.CLAUDEMd} {
		s, err := os.Lstat(filepath.Join(path, string(name)))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if s.Mode().IsRegular() {
			files = append(files, name)
		}
	}
	return files, nil
}

func checkpoint(workspace, common, operation, base string) (protocol.WorkspaceCheckpoint, error) {
	var result protocol.WorkspaceCheckpoint
	intentPath := filepath.Join(common, "monos-checkpoint-"+operation+".json")
	var intent finalizationIntent
	if raw, err := os.ReadFile(intentPath); err == nil {
		if json.Unmarshal(raw, &intent) != nil || validateFinalizationIntent(intent) != nil || intent.Base != base {
			return result, fmt.Errorf("checkpoint identity mismatch")
		}
	} else if !os.IsNotExist(err) {
		return result, err
	} else {
		head, err := git(workspace, "rev-parse", "HEAD")
		if err != nil {
			return result, err
		}
		if err = requireAncestor(workspace, base, head); err != nil {
			return result, err
		}
		idx, err := os.CreateTemp(common, "checkpoint-index-*")
		if err != nil {
			return result, err
		}
		index := idx.Name()
		idx.Close()
		os.Remove(index)
		defer os.Remove(index)
		env := []string{"GIT_INDEX_FILE=" + index}
		if _, err = gitEnv(workspace, env, "read-tree", "HEAD"); err != nil {
			return result, err
		}
		if _, err = gitEnv(workspace, env, "add", "--all"); err != nil {
			return result, err
		}
		tree, err := gitEnv(workspace, env, "write-tree")
		if err != nil {
			return result, err
		}
		intent = finalizationIntent{Base: base, Parent: head, Tree: tree, Date: time.Now().UTC().Format(time.RFC3339)}
		if err = saveRecord(intentPath, intent); err != nil {
			return result, err
		}
	}
	commit, err := gitEnv(workspace, []string{"GIT_AUTHOR_DATE=" + intent.Date, "GIT_COMMITTER_DATE=" + intent.Date}, "commit-tree", intent.Tree, "-p", intent.Parent, "-m", "monos private checkpoint "+operation)
	if err != nil {
		return result, err
	}
	if _, err = git(workspace, "update-ref", "refs/monos/checkpoints/"+operation, commit); err != nil {
		return result, err
	}
	return protocol.WorkspaceCheckpoint{OperationID: operation, HeadCommit: intent.Parent, TreeID: intent.Tree, CommitID: commit}, nil
}

// WorkspaceWorker reads a root-owned operation plan; argv selects no host path,
// repository or credential. Access arrives only on this process's stdin.
func WorkspaceWorker(operation string, input io.Reader) (Status, error) {
	var result protocol.EffectResult
	r, err := readOperation(operationPath(operation))
	if err != nil {
		return Status{Known: true, Result: &result}, err
	}
	op := r.Operation
	if r.Completion != nil {
		return completionItemWorker(r)
	}
	if op.Workspace == nil {
		return Status{Known: true, Result: &result}, fmt.Errorf("workspace operation required")
	}
	w := op.Workspace
	record, err := readWorkspaceAllocation(w)
	if err != nil {
		return Status{Known: true, Result: &result}, err
	}
	if !sameWorkspaceOperation(record.Operation, op) {
		return Status{Known: true, Result: &result}, fmt.Errorf("workspace worker identity mismatch")
	}
	cache, common, workspace := resourceCache(w.ResourceID), WorkspacePath(w, "common"), WorkspacePath(w, "worktree")
	metadata := record.Metadata
	lockPath := filepath.Join(Root, "launch", "workspaces", workspaceAllocationKey(w.WorkspaceID, w.Isolation)+".writer.lock")
	if serviceWorkspaceAction(r.WorkspaceAction) {
		lockPath = filepath.Join(Root, "service", "workspace-locks", w.ResourceID+".lock")
	}
	// Writer lock files are created with the appropriate account by the helper.
	lock, err := acquireFileLock(context.Background(), lockPath)
	if err != nil {
		return Status{Known: true, Result: &result}, err
	}
	defer releaseFileLock(lock)
	// A delayed systemd submission can reach this lock after Stop or a newer
	// lease. Revalidate after acquiring physical ownership, before any mutation.
	current, err := readWorkspaceAllocation(w)
	if err != nil || !sameWorkspaceOperation(current.Operation, op) {
		return Status{Known: true, Result: &result}, fmt.Errorf("workspace worker superseded before writer lock")
	}
	if op.Kind == protocol.KindOpenWorkspace {
		if _, e := os.Stat(workspaceStopPath(w.LeaseID)); e == nil {
			return Status{Known: true, Result: &result}, fmt.Errorf("open fenced by Stop")
		} else if !os.IsNotExist(e) {
			return Status{Known: true, Result: &result}, e
		}
	}
	if err = requireUnfencedCompletion(op); err != nil {
		return Status{Known: true, Result: &result}, err
	}
	switch r.WorkspaceAction {
	case "history":
		if err = seedWorkspaceHistory(cache, op); err != nil {
			return Status{Known: true, Result: &result}, err
		}
	case "rework_rebuild":
		if record.Stage != "rework_archived" || op.Workspace.Transfer == nil || op.Workspace.Transfer.Purpose == nil || *op.Workspace.Transfer.Purpose != protocol.PurposeRework {
			return Status{Known: true, Result: &result}, fmt.Errorf("Rework rebuild lacks archived disposition")
		}
		if err = rebuildReworkWorkspace(workspace, common, cache, metadata, w.ReworkHistory); err != nil {
			return Status{Known: true, Result: &result}, err
		}
	case "fetch":
		var access protocol.RepositoryAccessResult
		raw, err := io.ReadAll(io.LimitReader(input, 16385))
		if err != nil || len(raw) > 16384 {
			return Status{Known: true, Result: &result}, fmt.Errorf("invalid repository access input")
		}
		if err = json.Unmarshal(raw, &access); err != nil {
			return Status{Known: true, Result: &result}, fmt.Errorf("invalid repository access input")
		}
		metadata, err = fetchWorkspace(cache, filepath.Join(Root, "service", "workspace-operations", operation+".json"), op, access)
		if err != nil {
			return Status{Known: true, Result: &result}, err
		}
		if err = seedIsolatedWorkspace(cache, op, &metadata, record.Metadata); err != nil {
			return Status{Known: true, Result: &result}, err
		}
	case "clone":
		if err = clonePinned(cache, WorkspacePath(w, "staging-"+operation), metadata, operation); err != nil {
			return Status{Known: true, Result: &result}, err
		}
		if err = copyWorkspaceHistory(WorkspacePath(w, "staging-"+operation), cache, w.ReworkHistory); err != nil {
			return Status{Known: true, Result: &result}, err
		}
		if source := w.ConflictSource; source != nil {
			ref := "refs/monos/conflicts/" + source.OperationID
			staging := WorkspacePath(w, "staging-"+operation)
			if _, err = workspaceGit(staging, cache, staging, nil, "fetch", "--no-tags", cache, ref+":"+ref); err != nil {
				return Status{Known: true, Result: &result}, err
			}
		}
	case "checkout":
		if err = checkoutPinned(workspace, common, cache, metadata.FinalizedCommit); err != nil {
			return Status{Known: true, Result: &result}, err
		}
	case "recover":
		if op.Kind != protocol.Stop {
			return Status{Known: true, Result: &result}, fmt.Errorf("only Stop may recover existing workspace without fetch")
		}
		if err = verifyRetainedWorkspace(workspace, common, record); err != nil {
			return Status{Known: true, Result: &result}, err
		}
		if err = copyWorkspaceHistory(common, cache, w.ReworkHistory); err != nil {
			return Status{Known: true, Result: &result}, err
		}
	case "refresh":
		if err = verifyRetainedWorkspace(workspace, common, record); err != nil {
			return Status{Known: true, Result: &result}, err
		}
		if err = copyWorkspaceHistory(common, cache, w.ReworkHistory); err != nil {
			return Status{Known: true, Result: &result}, err
		}
		if _, err = workspaceGit(common, cache, common, nil, "fetch", "--no-tags", cache, "refs/monos/pins/"+operation+"/target:refs/monos/targets/"+operation); err != nil {
			return Status{Known: true, Result: &result}, err
		}
		if _, err = workspaceGit(common, cache, common, nil, "update-ref", "refs/remotes/origin/"+metadata.TargetBranch, metadata.TargetCommit); err != nil {
			return Status{Known: true, Result: &result}, err
		}
	case "checkpoint":
		cp, err := checkpoint(workspace, common, operation, metadata.FinalizedCommit)
		if err != nil {
			return Status{Known: true, Result: &result}, err
		}
		metadata.Checkpoint = &cp
	case "finalize":
		result, err = finalize(workspace, common, operation, metadata.FinalizedCommit)
		if err != nil {
			return Status{Known: true, Result: &result}, err
		}
		metadata.FinalizedCommit = *result.GitCommit
		metadata.Checkpoint = nil
	default:
		return Status{Known: true, Result: &result}, fmt.Errorf("unknown workspace worker stage")
	}
	result.WorkspaceID = &w.WorkspaceID
	result.WorkspaceMetadata = &metadata
	if r.WorkspaceAction == "checkout" || r.WorkspaceAction == "refresh" || r.WorkspaceAction == "recover" || r.WorkspaceAction == "rework_rebuild" {
		result.Path = &workspace
		result.InstructionFiles, err = instructionFiles(workspace)
	}
	return Status{Known: true, Result: &result}, err
}
