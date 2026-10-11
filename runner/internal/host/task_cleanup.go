package host

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"syscall"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

type taskCleanupRecord struct {
	Request protocol.TaskCleanupRequest `json:"request"`
	Digest  string                      `json:"digest"`
	Stage   string                      `json:"stage"`
	Targets []cleanupTarget             `json:"targets,omitempty"`
}

func taskCleanupPath(task string) string {
	return filepath.Join(Root, "launch", task+".task-cleanup.json")
}

func ValidateTaskCleanup(request protocol.TaskCleanupRequest) (string, error) {
	raw, digest, err := wire.Canonical(request)
	if err != nil {
		return "", err
	}
	if len(raw) > wire.ItemLimit {
		return "", fmt.Errorf("Task cleanup exceeds bounded transport")
	}
	if err = wire.Validate("TaskCleanupRequest", raw); err != nil {
		return "", err
	}
	attempts := map[string]string{}
	for _, a := range request.Attempts {
		if attempts[a.AttemptID] != "" {
			return "", fmt.Errorf("duplicate cleanup Attempt")
		}
		attempts[a.AttemptID] = a.DispatchID
	}
	workspaces := map[string]protocol.TaskCleanupWorkspace{}
	for _, w := range request.Workspaces {
		id, err := TaskWorkspaceID(request.TaskID, w.ResourceID)
		if err != nil || id != w.WorkspaceID || workspaces[id].WorkspaceID != "" {
			return "", fmt.Errorf("cleanup workspace identity mismatch")
		}
		seen := map[string]bool{}
		for _, a := range w.AllocationIDS {
			if seen[a] {
				return "", fmt.Errorf("duplicate cleanup allocation")
			}
			seen[a] = true
		}
		workspaces[id] = w
	}
	if len(request.Results) != len(workspaces) {
		return "", fmt.Errorf("cleanup final result coverage incomplete")
	}
	seen := map[string]bool{}
	for _, i := range request.Results {
		w, ok := workspaces[i.WorkspaceID]
		if !ok || seen[i.WorkspaceID] || i.TaskID != request.TaskID || i.RunnerID != request.RunnerID || i.ResourceID != w.ResourceID || i.Generation != w.Generation || i.StorageID != w.StorageID || i.GitCommit != w.FinalizedCommit || attempts[i.AttemptID] != i.DispatchID {
			return "", fmt.Errorf("cleanup final result identity mismatch")
		}
		seen[i.WorkspaceID] = true
	}
	return digest, nil
}

// Called under the existing helper lock. Persisting the exact completed-Task
// instruction fences delayed Start/open before releasing that lock to acquire
// allocation coordinators; Stop and immutable result reads remain available.
func beginTaskCleanup(request protocol.TaskCleanupRequest) (taskCleanupRecord, error) {
	digest, err := ValidateTaskCleanup(request)
	if err != nil {
		return taskCleanupRecord{}, err
	}
	r := taskCleanupRecord{Request: request, Digest: digest, Stage: "intent"}
	path := taskCleanupPath(request.TaskID)
	raw, err := os.ReadFile(path)
	if err == nil {
		if trustedFile(path, 0) != nil || json.Unmarshal(raw, &r) != nil || r.Digest != digest || !reflect.DeepEqual(r.Request, request) || (r.Stage != "intent" && r.Stage != "deleting" && r.Stage != "completed") {
			return r, fmt.Errorf("Task cleanup identity changed")
		}
		return r, nil
	}
	if !os.IsNotExist(err) {
		return r, err
	}
	return r, saveRecord(path, r)
}

func rejectRetiredTask(task string) error {
	if !ValidID(task) {
		return fmt.Errorf("invalid Task")
	}
	if _, err := os.Lstat(taskCleanupPath(task)); !os.IsNotExist(err) {
		return fmt.Errorf("completed Task is retired")
	}
	return nil
}

// Retirement owns a frozen set of physical Attempts. A later reply-only Task
// conversation has no repository reservation and uses only its own new scratch
// directories. This exception does not replace normal dispatch authorization.
func CleanupAllowsConversation(request protocol.TaskCleanupRequest, dispatch protocol.Dispatch) bool {
	if dispatch.TaskID == nil || *dispatch.TaskID != request.TaskID || dispatch.RunnerID != request.RunnerID || !ValidID(dispatch.AttemptID) || !ValidID(dispatch.DispatchID) || dispatch.TaskConversationSource == nil || !dispatch.TaskConversationSource.ReplyOnly {
		return false
	}
	if _, err := wire.ScopeID(dispatch); err != nil {
		return false
	}
	for _, old := range request.Attempts {
		if old.AttemptID == dispatch.AttemptID || old.DispatchID == dispatch.DispatchID {
			return false
		}
	}
	return true
}

func rejectRetiredStart(dispatch protocol.Dispatch) error {
	if dispatch.TaskID == nil {
		return nil
	}
	path := taskCleanupPath(*dispatch.TaskID)
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var record taskCleanupRecord
	if trustedFile(path, 0) != nil || json.Unmarshal(raw, &record) != nil || !CleanupAllowsConversation(record.Request, dispatch) {
		return fmt.Errorf("completed Task execution is retired")
	}
	digest, err := ValidateTaskCleanup(record.Request)
	if err != nil || digest != record.Digest {
		return fmt.Errorf("invalid Task retirement identity")
	}
	return nil
}

type cleanupFailure struct {
	reason protocol.TaskCleanupResultReason
}

func (e *cleanupFailure) Error() string { return "Task cleanup blocked: " + string(e.reason) }
func cleanupBlocked(reason string) error {
	return &cleanupFailure{protocol.TaskCleanupResultReason(reason)}
}

func runTaskCleanup(ctx context.Context, r taskCleanupRecord) protocol.TaskCleanupResult {
	result := protocol.TaskCleanupResult{SchemaVersion: 1, CleanupID: r.Request.CleanupID, RequestDigest: r.Digest, Status: "completed"}
	if r.Stage == "completed" {
		return result
	}
	if err := cleanTask(ctx, &r); err != nil {
		result.Status = "blocked"
		reason := protocol.TaskCleanupResultReason("cleanup_failed")
		var failure *cleanupFailure
		if errors.As(err, &failure) {
			reason = failure.reason
		}
		result.Reason = &reason
	}
	return result
}

type cleanupAllocation struct {
	workspace protocol.TaskCleanupWorkspace
	isolation *protocol.WorkspaceIsolation
	key       string
}

func cleanupAllocations(request protocol.TaskCleanupRequest) []cleanupAllocation {
	allocations := []cleanupAllocation{}
	for _, w := range request.Workspaces {
		if w.Direct {
			allocations = append(allocations, cleanupAllocation{w, nil, w.WorkspaceID})
		}
		for _, id := range w.AllocationIDS {
			isolation := &protocol.WorkspaceIsolation{AllocationID: id}
			allocations = append(allocations, cleanupAllocation{w, isolation, workspaceAllocationKey(w.WorkspaceID, isolation)})
		}
	}
	sort.Slice(allocations, func(i, j int) bool { return allocations[i].key < allocations[j].key })
	return allocations
}

func cleanTask(ctx context.Context, r *taskCleanupRecord) error {
	lock, err := acquireFileLock(ctx, taskCleanupPath(r.Request.TaskID)+".lock")
	if err != nil {
		return err
	}
	defer releaseFileLock(lock)
	// Reload after taking the Task lock: another helper may have completed the
	// same immutable request while this invocation waited.
	raw, err := os.ReadFile(taskCleanupPath(r.Request.TaskID))
	if err != nil {
		return err
	}
	var current taskCleanupRecord
	if json.Unmarshal(raw, &current) != nil || current.Digest != r.Digest || !reflect.DeepEqual(current.Request, r.Request) {
		return cleanupBlocked("ownership_unresolved")
	}
	*r = current
	if r.Stage == "completed" {
		return nil
	}
	allocations := cleanupAllocations(r.Request)
	locks := []*os.File{}
	defer func() {
		for i := len(locks) - 1; i >= 0; i-- {
			releaseFileLock(locks[i])
		}
	}()
	for _, a := range allocations {
		lock, err := acquireFileLock(ctx, filepath.Join(Root, "launch", "workspaces", a.key+".coordinator.lock"))
		if err != nil {
			return err
		}
		locks = append(locks, lock)
	}
	storage, err := storageIdentity()
	if err != nil {
		return cleanupBlocked("storage_identity_mismatch")
	}
	manifests, err := cleanupAttemptProof(ctx, r.Request)
	if err != nil {
		return cleanupBlocked("ownership_unresolved")
	}
	uid, _, err := workspaceAccounts()
	if err != nil {
		return err
	}
	service, err := user.Lookup("monos-probe")
	if err != nil {
		return err
	}
	serviceUID, err := strconv.ParseUint(service.Uid, 10, 32)
	if err != nil {
		return err
	}
	serviceGID, err := strconv.ParseUint(service.Gid, 10, 32)
	if err != nil || serviceUID == 0 || serviceGID == 0 {
		return cleanupBlocked("ownership_unresolved")
	}
	credential := &syscall.Credential{Uid: uint32(serviceUID), Gid: uint32(serviceGID), Groups: []uint32{}}
	for _, identity := range r.Request.Results {
		if identity.StorageID != storage {
			return cleanupBlocked("storage_identity_mismatch")
		}
		if err = cleanupResultProof(ctx, identity, manifests[identity.AttemptID], credential); err != nil {
			return cleanupBlocked("result_unavailable")
		}
	}
	paths := []string{}
	for _, a := range allocations {
		if a.workspace.StorageID != storage {
			return cleanupBlocked("storage_identity_mismatch")
		}
		base := reservedWorkspacePath(a.workspace.WorkspaceID, a.isolation, "")
		proof, err := readWorkspaceReservation(a.workspace.WorkspaceID, a.isolation)
		if err != nil && !os.IsNotExist(err) {
			return cleanupBlocked("ownership_unresolved")
		}
		if err == nil {
			w := proof.Operation.Workspace
			if w.TaskID != r.Request.TaskID || w.RunnerID != r.Request.RunnerID || w.ResourceID != a.workspace.ResourceID || w.Generation != a.workspace.Generation || !proof.Released || (proof.Stage != "ready" && proof.Stage != "cancelled") || proof.Metadata.StorageID != "" && proof.Metadata.StorageID != storage || proof.Stage == "ready" && (proof.Metadata.Generation != a.workspace.Generation || proof.Metadata.StorageID != storage) {
				return cleanupBlocked("ownership_unresolved")
			}
			if m, ok := manifests[proof.Operation.AttemptID]; !ok || m.Dispatch.DispatchID != proof.Operation.DispatchID || ValidateEffectScope(m.Dispatch, proof.Operation) != nil {
				return cleanupBlocked("ownership_unresolved")
			}
		} else if !cleanupReserved(manifests, a) {
			return cleanupBlocked("ownership_unresolved")
		}
		if e := trustedDir(base, 0); e != nil && !os.IsNotExist(e) {
			return cleanupBlocked("ownership_unresolved")
		}
		for _, name := range []string{"worktree", "common"} {
			path := filepath.Join(base, name)
			if err != nil && r.Stage == "intent" {
				entries, e := os.ReadDir(path)
				if e != nil && !os.IsNotExist(e) || len(entries) != 0 {
					return cleanupBlocked("ownership_unresolved")
				}
			}
			paths = append(paths, path)
		}
	}
	for _, a := range r.Request.Attempts {
		m := manifests[a.AttemptID]
		if m.Revoked && !m.Launched {
			continue
		}
		if err = trustedDir(AttemptRoot(a.AttemptID), 0); err != nil {
			return cleanupBlocked("ownership_unresolved")
		}
		// Canonical Attempt-private CLI state and dependency caches are disposable.
		// Legacy private worktrees are not inferred from a Task cleanup request.
		for _, name := range []string{"scratch", "data", "cache", "state", "tmp", "config"} {
			paths = append(paths, Path(a.AttemptID, name))
		}
	}
	if r.Stage == "intent" {
		r.Targets = nil
		for _, path := range paths {
			target, err := observeCleanupTarget(path, uint32(uid))
			if err != nil {
				return cleanupBlocked("ownership_unresolved")
			}
			r.Targets = append(r.Targets, target)
		}
		r.Stage = "deleting"
		if err = saveRecord(taskCleanupPath(r.Request.TaskID), r); err != nil {
			return err
		}
	} else if r.Stage != "deleting" {
		return cleanupBlocked("ownership_unresolved")
	}
	if len(paths) != len(r.Targets) {
		return cleanupBlocked("ownership_unresolved")
	}
	for index, target := range r.Targets {
		if target.Path != paths[index] || target.Owner != uint32(uid) {
			return cleanupBlocked("ownership_unresolved")
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err = removeCleanupTarget(ctx, target); err != nil {
			return err
		}
	}
	r.Stage = "completed"
	return saveRecord(taskCleanupPath(r.Request.TaskID), r)
}

func cleanupReserved(manifests map[string]Manifest, a cleanupAllocation) bool {
	for _, m := range manifests {
		if m.Dispatch.WorkspaceReservations == nil {
			continue
		}
		for _, reservation := range m.Dispatch.WorkspaceReservations.Resources {
			if reservation.WorkspaceID == a.workspace.WorkspaceID && reservation.ResourceID == a.workspace.ResourceID && reflect.DeepEqual(reservation.Isolation, a.isolation) {
				return true
			}
		}
	}
	return false
}

func cleanupAttemptProof(ctx context.Context, request protocol.TaskCleanupRequest) (map[string]Manifest, error) {
	manifests := map[string]Manifest{}
	for _, a := range request.Attempts {
		m, err := readManifest(a.AttemptID)
		if err != nil {
			return nil, err
		}
		if m.Dispatch.DispatchID != a.DispatchID || m.Dispatch.TaskID == nil || *m.Dispatch.TaskID != request.TaskID || m.Dispatch.RunnerID != request.RunnerID {
			return nil, fmt.Errorf("cleanup Attempt scope mismatch")
		}
		s, err := status(ctx, a.AttemptID)
		if err != nil || !s.Known || s.Populated {
			return nil, fmt.Errorf("cleanup Attempt is not physically absent")
		}
		manifests[a.AttemptID] = m
	}
	paths, err := filepath.Glob(filepath.Join(Root, "launch", "*.json"))
	if err != nil {
		return nil, err
	}
	for _, path := range paths {
		id := strings.TrimSuffix(filepath.Base(path), ".json")
		if !ValidID(id) {
			continue
		}
		m, err := readManifest(id)
		if err != nil {
			return nil, err
		}
		if m.Dispatch.TaskID != nil && *m.Dispatch.TaskID == request.TaskID {
			if _, ok := manifests[id]; !ok {
				if CleanupAllowsConversation(request, m.Dispatch) {
					continue
				}
				return nil, fmt.Errorf("unlisted Task Attempt")
			}
		}
	}
	paths, err = filepath.Glob(filepath.Join(Root, "launch", "*.operation.json"))
	if err != nil {
		return nil, err
	}
	units := map[string]bool{}
	for _, path := range paths {
		r, err := readOperation(path)
		if err != nil {
			return nil, err
		}
		if _, ok := manifests[r.Operation.AttemptID]; !ok {
			continue
		}
		if !r.Settled || r.Completion != nil && !r.Completion.Released {
			return nil, fmt.Errorf("cleanup operation unresolved")
		}
		unit := operationUnit(r.Operation.OperationID)
		if err = requireAbsentUnit(ctx, unit); err != nil {
			return nil, err
		}
		populated, err := Population("/system.slice/" + unit)
		if err != nil || populated {
			return nil, fmt.Errorf("cleanup operation cgroup unresolved")
		}
		units[unit] = true
	}
	jobs, err := command(ctx, "/usr/bin/systemctl", "list-jobs", "--no-legend", "--plain", "--no-pager")
	if err != nil {
		return nil, err
	}
	for _, line := range strings.Split(string(jobs), "\n") {
		fields := strings.Fields(line)
		if len(fields) > 1 && units[fields[1]] {
			return nil, fmt.Errorf("cleanup operation launch pending")
		}
	}
	return manifests, nil
}

func cleanupResultProof(ctx context.Context, i protocol.ResultReadIdentity, m Manifest, credential *syscall.Credential) error {
	owner := credential.Uid
	r, err := readOperation(operationPath(i.OperationID))
	if err != nil {
		return err
	}
	if !r.Settled || !r.Status.Known || r.Status.Populated || r.Status.Error != "" || r.Status.Result == nil {
		return fmt.Errorf("cleanup result not retained")
	}
	effect := &protocol.OperationResult{OperationID: i.OperationID, AttemptID: i.AttemptID, Success: true, Result: *r.Status.Result}
	if err = ValidateRetainedResultIdentity(m.Dispatch, r.Operation, effect, i); err != nil {
		return err
	}
	path, err := completionResultPath(i.OperationID, i.WorkspaceID, false)
	if err != nil {
		return err
	}
	if err = resultParents(path, owner); err != nil {
		return err
	}
	for _, name := range []string{"HEAD", "config"} {
		if err = trustedFile(filepath.Join(path, name), owner); err != nil {
			return err
		}
	}
	if _, err = os.Lstat(filepath.Join(path, "objects", "info", "alternates")); !os.IsNotExist(err) {
		return fmt.Errorf("cleanup result borrows objects")
	}
	if err = filepath.Walk(filepath.Join(path, "objects"), func(_ string, info os.FileInfo, err error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("cleanup result aliases objects")
		}
		return nil
	}); err != nil {
		return err
	}
	for expression, want := range map[string]string{"refs/monos/result": i.GitCommit, i.GitCommit + "^{tree}": i.GitTree} {
		raw, err := resultGitWithCredential(ctx, path, 256, credential, "rev-parse", "--verify", expression)
		if err != nil || strings.TrimSpace(string(raw)) != want {
			return fmt.Errorf("cleanup result object changed")
		}
	}
	_, err = resultGitWithCredential(ctx, path, 1<<20, credential, "fsck", "--connectivity-only", "--no-reflogs")
	return err
}
