package host

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"syscall"
	"time"

	protocol "monos.local/protocol"
)

func workspaceStopPath(lease string) string {
	return filepath.Join(Root, "launch", "workspaces", "stop-"+lease+".json")
}

func validateWorkspaceUnit(values map[string]string, r operationRecord) error {
	expected := "me"
	if serviceWorkspaceAction(r.WorkspaceAction) {
		expected = "monos-probe"
	}
	unit := operationUnit(r.Operation.OperationID)
	if values["Transient"] != "yes" || values["User"] != expected || values["Group"] != "monos-probe-read" || values["Description"] != workspaceUnitDescription(r) {
		return fmt.Errorf("workspace unit ownership mismatch")
	}
	if group := values["ControlGroup"]; group != "" && group != "/system.slice/"+unit {
		return fmt.Errorf("workspace cgroup mismatch")
	}
	return nil
}

func serviceWorkspaceAction(action string) bool {
	return action == "fetch" || action == "history" || action == "export_node" || action == "integrate" || action == "protect" || action == "prepare" || action == "publish" || action == "export"
}

// Retained worker identity is checked even after a lost systemd-run response.
// Repeating stop while waiting for the coordinator also catches a delayed start
// submission. The coordinator cannot be handed off while its submitter is live.
func settleWorkspaceWorker(ctx context.Context, r operationRecord) error {
	unit := operationUnit(r.Operation.OperationID)
	v, err := unitProperties(ctx, unit)
	if err != nil {
		return err
	}
	if v["LoadState"] != "not-found" {
		if err = validateWorkspaceUnit(v, r); err != nil {
			return err
		}
		if _, err = command(ctx, "/usr/bin/systemctl", "stop", unit); err != nil {
			return err
		}
	}
	group := "/system.slice/" + unit
	if _, err = os.Stat("/sys/fs/cgroup" + group); err == nil {
		populated, e := Population(group)
		if e != nil {
			return e
		}
		if populated {
			return fmt.Errorf("workspace writer remains populated")
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	jobs, err := command(ctx, "/usr/bin/systemctl", "list-jobs", "--no-legend", "--plain", "--no-pager")
	if err != nil {
		return err
	}
	for _, line := range strings.Split(string(jobs), "\n") {
		fields := strings.Fields(line)
		if len(fields) > 1 && fields[1] == unit {
			return fmt.Errorf("workspace launch job remains pending")
		}
	}
	return nil
}

func settleLeaseWorkers(ctx context.Context, op protocol.Operation) error {
	paths, err := filepath.Glob(filepath.Join(Root, "launch", "*.operation.json"))
	if err != nil {
		return err
	}
	for _, p := range paths {
		r, err := readOperation(p)
		if err != nil {
			return err
		}
		if r.Operation.Workspace == nil || r.Operation.Workspace.LeaseID != op.Workspace.LeaseID || r.Settled {
			continue
		}
		if err = settleWorkspaceWorker(ctx, r); err != nil {
			return err
		}
	}
	return nil
}

func acquireWorkspaceCoordinator(ctx context.Context, op protocol.Operation) (*os.File, error) {
	p := filepath.Join(Root, "launch", "workspaces", workspaceAllocationKey(op.Workspace.WorkspaceID, op.Workspace.Isolation)+".coordinator.lock")
	if op.Kind != protocol.Stop && op.Kind != protocol.SettleCompletion {
		return acquireFileLock(ctx, p)
	}
	return acquireStoppingWorkspace(ctx, p, func() error { return settleLeaseWorkers(ctx, op) })
}

func acquireStoppingWorkspace(ctx context.Context, p string, settle func() error) (*os.File, error) {
	f, err := os.OpenFile(p, os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	for {
		// Stop need not wait for a slow fetch to finish before terminating it.
		if err = settle(); err != nil {
			f.Close()
			return nil, err
		}
		err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			return f, nil
		}
		if err != syscall.EWOULDBLOCK && err != syscall.EAGAIN {
			f.Close()
			return nil, err
		}
		select {
		case <-ctx.Done():
			f.Close()
			return nil, ctx.Err()
		case <-time.After(20 * time.Millisecond):
		}
	}
}

func workspaceAccounts() (uid, gid int, err error) {
	a, e := user.Lookup("me")
	if e != nil {
		return 0, 0, e
	}
	g, e := user.LookupGroup("monos-probe-read")
	if e != nil {
		return 0, 0, e
	}
	uid, err = strconv.Atoi(a.Uid)
	if err != nil || uid == 0 {
		return 0, 0, fmt.Errorf("invalid workspace execution uid")
	}
	gid, err = strconv.Atoi(g.Gid)
	return
}
func prepareWorkspaceWorkerPaths(op protocol.Operation) error {
	return prepareWorkspaceWriterPaths(op.Workspace)
}

func prepareWorkspaceWriterPaths(w *protocol.WorkspaceDescriptor) error {
	uid, gid, err := workspaceAccounts()
	if err != nil {
		return err
	}
	p := filepath.Join(Root, "launch", "workspaces", workspaceAllocationKey(w.WorkspaceID, w.Isolation)+".writer.lock")
	f, err := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err == nil {
		err = f.Chown(uid, gid)
		f.Close()
		if err != nil {
			return err
		}
	} else if !os.IsExist(err) {
		return err
	}
	return trustedFile(p, uint32(uid))
}

func runWorkspaceWorker(ctx context.Context, op protocol.Operation, action string, access *protocol.RepositoryAccessResult) (Status, error) {
	var empty Status
	boot, err := BootID()
	if err != nil {
		return empty, err
	}
	old, err := readOperation(operationPath(op.OperationID))
	if err == nil {
		if !sameOperation(old.Operation, op) {
			return empty, fmt.Errorf("workspace operation identity conflict")
		}
		if !old.Settled {
			if err = settleWorkspaceWorker(ctx, old); err != nil {
				return empty, err
			}
		}
	} else if !os.IsNotExist(err) {
		return empty, err
	}
	lock, err := acquireFileLock(ctx, filepath.Join(Root, "launch", "helper.lock"))
	if err != nil {
		return empty, err
	}
	if op.Kind == protocol.KindOpenWorkspace {
		if _, e := os.Stat(workspaceStopPath(op.Workspace.LeaseID)); e == nil {
			releaseFileLock(lock)
			return empty, fmt.Errorf("open fenced by admitted Stop")
		} else if !os.IsNotExist(e) {
			releaseFileLock(lock)
			return empty, e
		}
		// A Stop whose durable marker write failed still killed the Agent. Do
		// not let an older helper launch another writer afterwards. An absent
		// Agent's admitted open is settled by Stop, using retained ready data or
		// the explicit unexposed-cancellation/initialized-recovery paths.
		agent, e := status(ctx, op.AttemptID)
		if e != nil || !agent.Known || !agent.Populated {
			releaseFileLock(lock)
			return empty, fmt.Errorf("open Agent absent; admitted Stop must settle workspace")
		}
	}
	if err = requireUnfencedCompletion(op); err != nil {
		releaseFileLock(lock)
		return empty, err
	}
	record := operationRecord{Operation: op, BootID: boot, WorkspaceAction: action}
	if err = saveRecord(operationPath(op.OperationID), record); err != nil {
		releaseFileLock(lock)
		return empty, err
	}
	args := []string{"--quiet", "--wait", "--pipe", "--collect", "--service-type=exec", "--unit=" + operationUnit(op.OperationID), "--description=monos workspace operation " + op.OperationID}
	props := properties(op.AttemptID, true)
	if serviceWorkspaceAction(action) {
		props[0] = "User=monos-probe"
		for i, p := range props {
			if strings.HasPrefix(p, "WorkingDirectory=") {
				props[i] = "WorkingDirectory=" + filepath.Join(Root, "service")
			}
		}
	}
	for _, p := range props {
		args = append(args, "--property="+p)
	}
	args = append(args, Worker, "workspace", op.OperationID)
	cmd := exec.CommandContext(ctx, "/usr/bin/systemd-run", args...)
	cmd.Env = []string{"PATH=/usr/bin:/bin", "LANG=C.UTF-8"}
	if access != nil {
		raw, e := json.Marshal(access)
		if e != nil {
			releaseFileLock(lock)
			return empty, e
		}
		cmd.Stdin = bytes.NewReader(raw)
	}
	var output bytes.Buffer
	cmd.Stdout = &output
	// Never forward provider/Git/systemd stderr: it can contain credentials.
	if err = cmd.Start(); err != nil {
		releaseFileLock(lock)
		return empty, fmt.Errorf("workspace worker launch uncertain")
	}
	releaseFileLock(lock)
	if err = cmd.Wait(); err != nil {
		return empty, fmt.Errorf("workspace worker response uncertain; retained ownership")
	}
	var status Status
	if output.Len() > 65536 || json.Unmarshal(output.Bytes(), &status) != nil || !status.Known || status.Result == nil {
		return empty, fmt.Errorf("invalid workspace worker response")
	}
	record.Settled, record.Status = true, status
	if err = saveRecord(operationPath(op.OperationID), record); err != nil {
		return empty, err
	}
	return status, statusError(status)
}

func stopWorkspaceAgentFirst(stopAgent func() (Status, error), persistFence func() error) (Status, error) {
	stopped, err := stopAgent()
	if err != nil {
		return stopped, err
	}
	if !stopped.Known || stopped.Populated {
		return stopped, fmt.Errorf("Agent writer absence unresolved")
	}
	if err = persistFence(); err != nil {
		return stopped, fmt.Errorf("Stop fence persistence failed; lease retained: %w", err)
	}
	return stopped, nil
}

func loadWorkspaceForOpen(op protocol.Operation, storage string) (workspaceRecord, error) {
	w := op.Workspace
	r, err := readWorkspaceAllocation(w)
	if os.IsNotExist(err) {
		if w.Transfer != nil && w.Transfer.Kind == "checkpoint" || w.Isolation == nil && (w.Basis != nil || w.Transfer != nil) {
			return r, fmt.Errorf("storage_unavailable: initialized workspace marker missing")
		}
		if err = validateCanonicalWorkspaceSource(op); err != nil {
			return r, err
		}
		if err = validateWorkspaceHistoryEvidence(op); err != nil {
			return r, err
		}
		return workspaceRecord{Operation: op, Stage: "intent", Metadata: protocol.WorkspaceMetadata{StorageID: storage, Generation: w.Generation, LeaseID: w.LeaseID, RepositoryIdentity: w.Resource.RepositoryIdentity}}, nil
	}
	if err != nil {
		return r, err
	}
	if w.Transfer != nil && r.Operation.Workspace.LeaseID != w.LeaseID {
		if err = validateWorkspaceTransferEvidence(r, op); err != nil {
			return r, err
		}
	}
	if r.Operation.Workspace.LeaseID != w.LeaseID {
		if err = validateWorkspaceHistoryEvidence(op); err != nil {
			return r, err
		}
		if err = validateCanonicalWorkspaceSource(op); err != nil {
			return r, err
		}
	}
	return reuseWorkspaceRecord(r, op, storage)
}

func reuseWorkspaceRecord(r workspaceRecord, op protocol.Operation, storage string) (workspaceRecord, error) {
	w := op.Workspace
	old := r.Operation.Workspace
	if r.Metadata.StorageID != storage || old.TaskID != w.TaskID || old.ResourceID != w.ResourceID || old.Generation != w.Generation || old.RunnerID != w.RunnerID || old.ProjectID != w.ProjectID {
		return r, fmt.Errorf("storage_unavailable: workspace lineage mismatch")
	}
	if old.LeaseID == w.LeaseID {
		if !sameWorkspaceOperation(r.Operation, op) {
			return r, fmt.Errorf("workspace descriptor changed within lease")
		}
		return r, nil
	}
	if !r.Released {
		return r, fmt.Errorf("ownership_unresolved: prior lease has not settled")
	}
	if r.Stage == "cancelled" && r.OpenResult == nil && w.Basis == nil {
		if err := retireCancelledAllocation(w, old.LeaseID); err != nil {
			return r, err
		}
		return workspaceRecord{Operation: op, Stage: "intent", Metadata: protocol.WorkspaceMetadata{StorageID: storage, Generation: w.Generation, LeaseID: w.LeaseID, RepositoryIdentity: w.Resource.RepositoryIdentity}}, nil
	}
	b := w.Basis
	if !reflect.DeepEqual(old.Resource, w.Resource) {
		return r, fmt.Errorf("storage_unavailable: initialized resource settings changed")
	}
	if b == nil || b.StorageID != storage || b.RepositoryIdentity != r.Metadata.RepositoryIdentity || b.BaseCommit != r.Metadata.BaseCommit || b.TargetBranch != r.Metadata.TargetBranch || w.Isolation == nil && b.FinalizedCommit != r.Metadata.FinalizedCommit || !reflect.DeepEqual(b.ProviderMetadata, r.Metadata.ProviderMetadata) {
		return r, fmt.Errorf("storage_unavailable: fixed workspace basis changed")
	}
	if !reflect.DeepEqual(w.Isolation, old.Isolation) {
		return r, fmt.Errorf("storage_unavailable: retained workspace allocation changed")
	}
	if w.Transfer != nil || old.NodeID != w.NodeID || old.NodeActivation != w.NodeActivation {
		if err := validateWorkspaceTransfer(r, op); err != nil {
			return r, err
		}
	}
	r.Operation = op
	r.Stage = "refresh_intent"
	if w.Transfer != nil && w.Transfer.Purpose != nil && *w.Transfer.Purpose == protocol.PurposeRework {
		r.Stage = "rework_intent"
	}
	r.OpenResult = nil
	r.Released = false
	if r.TargetObservationLeaseID == "" {
		r.TargetObservationLeaseID = old.LeaseID
	}
	r.Metadata.LeaseID = w.LeaseID
	return r, nil
}

func prepareCloneStage(op protocol.Operation) error {
	uid, gid, err := workspaceAccounts()
	if err != nil {
		return err
	}
	p := WorkspacePath(op.Workspace, "staging-"+op.OperationID)
	if entries, e := os.ReadDir(p); e == nil && len(entries) > 0 {
		if _, e = os.Stat(filepath.Join(p, "HEAD")); os.IsNotExist(e) {
			// An interrupted unexposed clone is retained under its operation,
			// never mistaken for a complete repository or silently removed.
			if err = os.Rename(p, p+"-interrupted-"+strconv.FormatInt(time.Now().UnixNano(), 10)); err != nil {
				return err
			}
		}
	} else if e != nil && !os.IsNotExist(e) {
		return e
	}
	if err = os.Mkdir(p, 0750); err == nil {
		if err = os.Chown(p, uid, gid); err != nil {
			return err
		}
		return os.Chmod(p, os.ModeSetgid|0750)
	} else if !os.IsExist(err) {
		return err
	}
	return trustedDir(p, uint32(uid))
}

func runWorkspaceEffect(ctx context.Context, op protocol.Operation, access *protocol.RepositoryAccessResult) (Status, error) {
	var status Status
	if op.Kind == protocol.KindCompleteNode || op.Kind == protocol.SettleCompletion {
		return runCompletionEffect(ctx, op)
	}
	if op.Workspace == nil {
		return status, fmt.Errorf("workspace descriptor required")
	}
	if op.Kind == protocol.KindOpenWorkspace {
		if err := rejectRetiredTask(op.Workspace.TaskID); err != nil {
			return status, err
		}
	}
	lock, err := acquireWorkspaceCoordinator(ctx, op)
	if err != nil {
		return status, err
	}
	defer releaseFileLock(lock)
	if err = settleLeaseWorkers(ctx, op); err != nil {
		return status, err
	}
	storage, err := storageIdentity()
	if err != nil {
		return status, err
	}
	if err = prepareWorkspaceWorkerPaths(op); err != nil {
		return status, err
	}
	if op.Kind == protocol.Stop {
		return stopWorkspace(ctx, op, storage)
	}
	if op.Kind != protocol.KindOpenWorkspace {
		return status, fmt.Errorf("unsupported canonical workspace effect")
	}
	r, err := loadWorkspaceForOpen(op, storage)
	if err != nil {
		return status, err
	}
	if r.Stage == "cancelled" {
		return Status{Known: true, CancelledByOperationID: readCancellingID(op.Workspace.LeaseID), Result: &protocol.EffectResult{WriterAbsent: ptr(true)}}, nil
	}
	if r.Stage == "ready" && r.OpenResult != nil {
		return Status{Known: true, Result: r.OpenResult}, nil
	}
	if err = guardMaterialization(); err != nil {
		return status, err
	}
	if _, e := os.Stat(workspaceStopPath(op.Workspace.LeaseID)); e == nil {
		return status, fmt.Errorf("open fenced by admitted Stop")
	} else if !os.IsNotExist(e) {
		return status, e
	}
	if err = saveRecord(workspaceAllocationRecordPath(op.Workspace), r); err != nil {
		return status, err
	}
	if err = resumeWorkspaceRework(ctx, &r, op); err != nil {
		return status, err
	}
	if len(op.Workspace.ReworkHistory) > 0 {
		if _, err = runWorkspaceWorker(ctx, op, "history", nil); err != nil {
			return status, err
		}
	}
	if r.Stage == "intent" || r.Stage == "refresh_intent" {
		if access == nil {
			return Status{Known: true, NeedsRepositoryAccess: true}, nil
		}
		status, err = runWorkspaceWorker(ctx, op, "fetch", access)
		if err != nil {
			return status, err
		}
		m := status.Result.WorkspaceMetadata
		if m == nil {
			return status, fmt.Errorf("worker omitted pinned metadata")
		}
		m.StorageID = storage
		r.Metadata = *m
		r.TargetObservationLeaseID = op.Workspace.LeaseID
		if r.Stage == "refresh_intent" {
			r.Stage = "refresh_pinned"
		} else {
			r.Stage = "pinned"
		}
		if err = saveRecord(workspaceAllocationRecordPath(op.Workspace), r); err != nil {
			return status, err
		}
	}
	if r.Stage == "pinned" {
		common := WorkspacePath(op.Workspace, "common")
		if entries, e := os.ReadDir(common); e != nil || len(entries) != 0 {
			return status, fmt.Errorf("storage_unavailable: initial common directory is not empty")
		}
		if err = prepareCloneStage(op); err != nil {
			return status, err
		}
		status, err = runWorkspaceWorker(ctx, op, "clone", nil)
		if err != nil {
			return status, err
		}
		r.Stage = "promoting"
		if err = saveRecord(workspaceAllocationRecordPath(op.Workspace), r); err != nil {
			return status, err
		}
	}
	if r.Stage == "promoting" {
		common := WorkspacePath(op.Workspace, "common")
		staging := WorkspacePath(op.Workspace, "staging-"+op.OperationID)
		if err = promoteWorkspaceCommon(staging, common); err != nil {
			return status, err
		}
		r.Stage = "common_ready"
		if err = saveRecord(workspaceAllocationRecordPath(op.Workspace), r); err != nil {
			return status, err
		}
	}
	stage := "checkout"
	if r.Stage == "refresh_pinned" {
		stage = "refresh"
	}
	status, err = runWorkspaceWorker(ctx, op, stage, nil)
	if err != nil {
		return status, err
	}
	status.Result.WorkspaceMetadata = &r.Metadata
	if err = persistWorkspaceReady(workspaceAllocationRecordPath(op.Workspace), &r, status.Result); err != nil {
		return status, err
	}
	return status, nil
}

func promoteWorkspaceCommon(staging, common string) error {
	if s, e := os.Lstat(staging); e == nil {
		if !s.IsDir() {
			return fmt.Errorf("storage_unavailable: invalid clone staging allocation")
		}
		if e = os.Remove(common); e != nil && !os.IsNotExist(e) {
			return fmt.Errorf("storage_unavailable: reserved common directory changed")
		}
		if e = os.Rename(staging, common); e != nil {
			return e
		}
	} else if !os.IsNotExist(e) {
		return e
	}
	if s, e := os.Lstat(common); e != nil || !s.IsDir() {
		return fmt.Errorf("storage_unavailable: promoted common directory missing")
	}
	return syncDirectory(filepath.Dir(common))
}

func persistWorkspaceReady(path string, r *workspaceRecord, result *protocol.EffectResult) error {
	if result == nil || result.WorkspaceID == nil || result.Path == nil || result.WorkspaceMetadata == nil {
		return fmt.Errorf("incomplete workspace ready result")
	}
	r.Stage = "ready"
	r.OpenResult = result
	return saveRecord(path, *r)
}

func syncDirectory(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}

func retireCancelledAllocation(w *protocol.WorkspaceDescriptor, lease string) error {
	uid, gid, err := workspaceAccounts()
	if err != nil {
		return err
	}
	for _, name := range []string{"common", "worktree"} {
		p := WorkspacePath(w, name)
		retained := WorkspacePath(w, name+"-cancelled-"+lease)
		if _, e := os.Lstat(retained); os.IsNotExist(e) {
			if err = os.Rename(p, retained); err != nil {
				return err
			}
		} else if e != nil {
			return e
		}
		if err = os.Mkdir(p, 0750); err == nil {
			if err = os.Chown(p, uid, gid); err != nil {
				return err
			}
			if err = os.Chmod(p, os.ModeSetgid|0750); err != nil {
				return err
			}
		} else if !os.IsExist(err) {
			return err
		}
	}
	return syncDirectory(WorkspacePath(w, ""))
}

func readCancellingID(lease string) *string {
	raw, err := os.ReadFile(workspaceStopPath(lease))
	if err != nil {
		return nil
	}
	var op protocol.Operation
	if json.Unmarshal(raw, &op) != nil || op.Kind != protocol.Stop {
		return nil
	}
	return &op.OperationID
}

func stopWorkspace(ctx context.Context, op protocol.Operation, storage string) (Status, error) {
	if old, err := readOperation(operationPath(op.OperationID)); err == nil {
		if !sameOperation(old.Operation, op) {
			return Status{}, fmt.Errorf("Stop operation identity changed")
		}
		if old.Settled && old.Status.Error == "" && old.Status.Result != nil && old.Status.Result.WriterAbsent != nil && *old.Status.Result.WriterAbsent {
			return old.Status, nil
		}
	} else if !os.IsNotExist(err) {
		return Status{}, err
	}
	status, err := stop(ctx, op.AttemptID)
	if err != nil {
		return status, err
	}
	r, err := readWorkspaceAllocation(op.Workspace)
	if os.IsNotExist(err) {
		if op.Workspace.Transfer != nil && op.Workspace.Transfer.Kind == "checkpoint" || op.Workspace.Isolation == nil && op.Workspace.Basis != nil {
			return status, fmt.Errorf("storage_unavailable: initialized workspace marker missing")
		}
		r = workspaceRecord{Operation: op, Stage: "intent", Metadata: protocol.WorkspaceMetadata{StorageID: storage}}
	} else if err != nil {
		return status, err
	}
	if r.Operation.Workspace.LeaseID != op.Workspace.LeaseID {
		// Stop can arrive before the current lease's first local open intent.
		// The exact backend basis still has to match a released prior lease.
		r, err = loadWorkspaceForOpen(op, storage)
		if err != nil {
			return status, err
		}
	}
	if !sameWorkspaceOperation(r.Operation, op) {
		return status, fmt.Errorf("Stop workspace descriptor mismatch")
	}
	if r.Metadata.StorageID != storage {
		return status, fmt.Errorf("storage_unavailable: Stop storage identity mismatch")
	}
	if err = resumeWorkspaceRework(ctx, &r, op); err != nil {
		return status, err
	}
	if err = recoverWorkspaceForStop(&r, op,
		func() error { return saveRecord(workspaceAllocationRecordPath(op.Workspace), r) },
		func(action string) (Status, error) { return runWorkspaceWorker(ctx, op, action, nil) }); err != nil {
		return status, err
	}
	prior := protocol.OperationResult{AttemptID: op.AttemptID, OperationID: op.Workspace.OpenOperationID}
	if r.OpenResult == nil {
		prior.CancelledByOperationID = &op.OperationID
		prior.Result.WriterAbsent = ptr(true)
		r.Stage = "cancelled"
		r.Released = true
		status.Result = &protocol.EffectResult{WriterAbsent: ptr(true)}
	} else {
		prior.Success = true
		prior.Result = *r.OpenResult
		status, err = runWorkspaceWorker(ctx, op, "checkpoint", nil)
		if err != nil {
			return status, err
		}
		if status.Result == nil || status.Result.WorkspaceMetadata == nil || status.Result.WorkspaceMetadata.Checkpoint == nil {
			return status, fmt.Errorf("missing checkpoint evidence")
		}
		r.PrivateCheckpoint = status.Result.WorkspaceMetadata.Checkpoint
		r.Released = true
		status.Result.WriterAbsent = ptr(true)
	}
	status.Known = true
	status.PriorOperationResult = &prior
	if err = saveRecord(workspaceAllocationRecordPath(op.Workspace), r); err != nil {
		return status, err
	}
	boot, err := BootID()
	if err != nil {
		return status, err
	}
	if err = saveRecord(operationPath(op.OperationID), operationRecord{Operation: op, BootID: boot, Settled: true, Status: status}); err != nil {
		return status, err
	}
	return status, nil
}

func recoverWorkspaceForStop(r *workspaceRecord, op protocol.Operation, save func() error, run func(string) (Status, error)) error {
	if r.OpenResult != nil {
		return nil
	}
	if op.Workspace.Isolation != nil {
		switch r.Stage {
		case "intent", "pinned", "promoting", "common_ready", "cancelled":
			if op.Workspace.Transfer != nil && op.Workspace.Transfer.Kind == "checkpoint" {
				return fmt.Errorf("storage_unavailable: checkpoint allocation lacks initialized recovery state")
			}
			// This allocation has never exposed an open result. Its history is
			// already protected in the predecessor's export; cancelling needs
			// neither an import nor a worker that requires a local open record.
			return nil
		case "refresh_intent", "refresh_pinned":
		default:
			return fmt.Errorf("storage_unavailable: unrecognized isolated Stop recovery stage")
		}
	}
	if len(op.Workspace.ReworkHistory) > 0 {
		if _, err := run("history"); err != nil {
			return err
		}
	}
	if op.Workspace.Basis == nil {
		return nil
	}
	if err := prepareStopRecovery(r, op); err != nil {
		return err
	}
	if err := save(); err != nil {
		return err
	}
	recovered, err := run("recover")
	if err != nil {
		return err
	}
	if recovered.Result == nil || recovered.Result.Path == nil {
		return fmt.Errorf("missing retained workspace recovery result")
	}
	r.OpenResult = recovered.Result
	r.Stage = "ready"
	return save()
}

func prepareStopRecovery(r *workspaceRecord, op protocol.Operation) error {
	if op.Kind != protocol.Stop || op.Workspace == nil || op.Workspace.Basis == nil || r.Metadata.BaseCommit == "" || r.Metadata.TargetCommit == "" {
		return fmt.Errorf("initialized Stop recovery requires retained Git basis")
	}
	if r.Stage != "refresh_intent" && r.Stage != "refresh_pinned" {
		return fmt.Errorf("unrecognized initialized workspace recovery stage")
	}
	if r.Stage == "refresh_intent" {
		if r.TargetObservationLeaseID == "" || r.TargetObservationLeaseID == op.Workspace.LeaseID {
			return fmt.Errorf("missing prior target observation provenance")
		}
		r.Metadata.RecoveredByStopOperationID = &op.OperationID
		r.Metadata.TargetObservationLeaseID = ptr(r.TargetObservationLeaseID)
	} else {
		r.Metadata.RecoveredByStopOperationID = nil
		r.Metadata.TargetObservationLeaseID = nil
	}
	return nil
}

func workspaceUnitDescription(r operationRecord) string {
	description := "monos workspace operation " + r.Operation.OperationID
	if r.Completion != nil && r.Completion.Active != nil {
		description += " " + r.Completion.Active.IdentityDigest
	}
	return description
}
