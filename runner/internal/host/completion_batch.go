package host

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

// Completion progress belongs to the real parent Operation. Item stages never
// masquerade as Operations and never make the parent terminal on their own.
type completionProgress struct {
	Released bool                     `json:"released"`
	Decision string                   `json:"decision,omitempty"`
	Items    []completionItemProgress `json:"items"`
	Active   *completionInvocation    `json:"active,omitempty"`
}

type completionItemProgress struct {
	WorkspaceID string                               `json:"workspace_id"`
	Metadata    protocol.WorkspaceMetadata           `json:"metadata"`
	Capture     *protocol.EffectResult               `json:"capture,omitempty"`
	Protected   bool                                 `json:"protected"`
	Prepared    *protocol.WorkspaceIntegrationResult `json:"prepared,omitempty"`
	Published   bool                                 `json:"published"`
	Exported    bool                                 `json:"exported"`
	Checkpoint  *protocol.EffectResult               `json:"checkpoint,omitempty"`
}

type completionInvocation struct {
	WorkspaceID    string `json:"workspace_id"`
	Action         string `json:"action"`
	IdentityDigest string `json:"identity_digest"`
	Settled        bool   `json:"settled"`
	Status         Status `json:"status"`
}

func completionInvocationDigest(op protocol.Operation, workspace, action string) (string, error) {
	parent, err := wire.OperationIdentity(op)
	if err != nil {
		return "", err
	}
	_, digest, err := wire.Canonical([]string{parent, workspace, action})
	return digest, err
}

func completionItem(record *operationRecord, workspace string) (*protocol.WorkspaceCompletionInput, *completionItemProgress, error) {
	if record.Operation.Kind != protocol.KindCompleteNode || record.Operation.Workspaces == nil || record.Completion == nil || len(record.Operation.Workspaces) != len(record.Completion.Items) {
		return nil, nil, fmt.Errorf("missing parent completion membership")
	}
	for i := range record.Operation.Workspaces {
		input, progress := &record.Operation.Workspaces[i], &record.Completion.Items[i]
		if input.Workspace.WorkspaceID != progress.WorkspaceID {
			return nil, nil, fmt.Errorf("completion progress membership changed")
		}
		if progress.WorkspaceID == workspace {
			return input, progress, nil
		}
	}
	return nil, nil, fmt.Errorf("unknown completion workspace")
}

func sameCompletionLease(open protocol.Operation, parent protocol.Operation, input protocol.WorkspaceCompletionInput) bool {
	return open.Kind == protocol.KindOpenWorkspace && open.AttemptID == parent.AttemptID && open.DispatchID == parent.DispatchID && open.WorkspaceDigest != nil && *open.WorkspaceDigest == input.WorkspaceDigest && reflect.DeepEqual(open.Workspace, &input.Workspace)
}

// Result directories use only the validated logical workspace hash. Resource IDs
// are wire identities and must never become unchecked path components here.
func completionResultPath(operation, workspace string, node bool) (string, error) {
	if !ValidID(operation) || !strings.HasPrefix(workspace, "ws_") || len(workspace) != 67 || !validWorkspaceHash(workspace) {
		return "", fmt.Errorf("invalid completion export identity")
	}
	if node {
		return filepath.Join(Root, "service", "node-results", operation, workspace), nil
	}
	return filepath.Join(Root, "results", operation, workspace), nil
}

func persistCompletionDecision(ctx context.Context, record *operationRecord, decision string) error {
	lock, err := acquireFileLock(ctx, filepath.Join(Root, "launch", "helper.lock"))
	if err != nil {
		return err
	}
	defer releaseFileLock(lock)
	if record.Completion.Decision != "" {
		if record.Completion.Decision != decision {
			return fmt.Errorf("completion decision is immutable")
		}
		return nil
	}
	if decision != "cancel" {
		if err = requireUnfencedCompletion(record.Operation); err != nil {
			return err
		}
	}
	record.Completion.Decision = decision
	return saveRecord(operationPath(record.Operation.OperationID), record)
}

func runCompletionEffect(ctx context.Context, op protocol.Operation) (Status, error) {
	original := op
	if op.Kind == protocol.SettleCompletion {
		if op.CompletionOperationID == nil {
			return Status{}, fmt.Errorf("missing completion target")
		}
		r, err := readOperation(operationPath(*op.CompletionOperationID))
		if err != nil {
			return Status{}, err
		}
		original = r.Operation
		if err = wire.ValidateCompletionTarget(op, original); err != nil {
			return Status{}, err
		}
	}
	if original.Workspaces == nil {
		return Status{}, fmt.Errorf("completion membership required")
	}
	parentPath := filepath.Join(Root, "launch", "workspaces", "completion-"+original.OperationID+".coordinator.lock")
	var parentLock *os.File
	var parentErr error
	if op.Kind == protocol.SettleCompletion {
		parentLock, parentErr = acquireStoppingWorkspace(ctx, parentPath, func() error {
			r, e := readOperation(operationPath(original.OperationID))
			if e != nil {
				return e
			}
			return settleWorkspaceWorker(ctx, r)
		})
	} else {
		parentLock, parentErr = acquireFileLock(ctx, parentPath)
	}
	if parentErr != nil {
		return Status{}, parentErr
	}
	defer releaseFileLock(parentLock)
	// Admission freezes sorted resource order. Keep every allocation coordinator
	// until the entire aggregate has a durable terminal result.
	var locks []*os.File
	defer func() {
		for i := len(locks) - 1; i >= 0; i-- {
			releaseFileLock(locks[i])
		}
	}()
	for i, input := range original.Workspaces {
		if i > 0 && original.Workspaces[i-1].Workspace.ResourceID >= input.Workspace.ResourceID {
			return Status{}, fmt.Errorf("unsorted completion membership")
		}
		w := &input.Workspace
		path := filepath.Join(Root, "launch", "workspaces", workspaceAllocationKey(w.WorkspaceID, w.Isolation)+".coordinator.lock")
		var lock *os.File
		var err error
		if op.Kind == protocol.SettleCompletion {
			lock, err = acquireStoppingWorkspace(ctx, path, func() error {
				r, e := readOperation(operationPath(original.OperationID))
				if e != nil {
					return e
				}
				return settleWorkspaceWorker(ctx, r)
			})
		} else {
			lock, err = acquireFileLock(ctx, path)
		}
		if err != nil {
			return Status{}, err
		}
		locks = append(locks, lock)
		if err = prepareWorkspaceWriterPaths(w); err != nil {
			return Status{}, err
		}
	}
	manifest, err := readManifest(original.AttemptID)
	if err != nil {
		return Status{}, err
	}
	if err = validateCompletionMembership(manifest.Dispatch, original); err != nil {
		return Status{}, err
	}
	storage, err := storageIdentity()
	if err != nil {
		return Status{}, err
	}
	record, err := loadCompletionProgress(original, storage)
	if err != nil {
		return Status{}, err
	}
	if op.Kind == protocol.SettleCompletion {
		return settleCompletionBatch(ctx, op, &record)
	}
	if record.Settled {
		if record.Status.CancelledByOperationID != nil {
			return record.Status, nil
		}
		return releaseCompletionBatch(&record, record.Status)
	}
	if _, err = stop(ctx, op.AttemptID); err != nil {
		return Status{}, err
	}
	return finishCompletionBatch(ctx, &record)
}

func loadCompletionProgress(op protocol.Operation, storage string) (operationRecord, error) {
	record, err := readOperation(operationPath(op.OperationID))
	if err == nil {
		if !sameOperation(record.Operation, op) {
			return record, fmt.Errorf("completion identity changed")
		}
	} else if !os.IsNotExist(err) {
		return record, err
	} else {
		boot, e := BootID()
		if e != nil {
			return record, e
		}
		record = operationRecord{Operation: op, BootID: boot}
	}
	if record.Completion != nil {
		return record, validateCompletionProgress(record, storage)
	}
	progress := &completionProgress{Items: make([]completionItemProgress, len(op.Workspaces))}
	for i, input := range op.Workspaces {
		r, e := readWorkspaceAllocation(&input.Workspace)
		if e != nil {
			return record, e
		}
		if !sameCompletionLease(r.Operation, op, input) || r.Metadata.StorageID != storage || r.OpenResult == nil || r.Stage != "ready" || r.Released {
			return record, fmt.Errorf("completion requires every initialized held lease")
		}
		progress.Items[i] = completionItemProgress{WorkspaceID: input.Workspace.WorkspaceID, Metadata: r.Metadata}
	}
	record.Completion = progress
	return record, saveRecord(operationPath(op.OperationID), record)
}

func finishCompletionBatch(ctx context.Context, record *operationRecord) (Status, error) {
	status, err := advanceCompletionBatch(record, func(index int, action string) (Status, error) {
		return runCompletionItem(ctx, record, record.Completion.Items[index].WorkspaceID, action)
	}, func() error { return saveRecord(operationPath(record.Operation.OperationID), record) }, func(decision string) error { return persistCompletionDecision(ctx, record, decision) })
	if err != nil {
		return status, err
	}
	if err = settleWorkspaceWorker(ctx, *record); err != nil {
		return status, err
	}
	if err = wire.ValidateCompletionResult(record.Operation, *status.Result); err != nil {
		return status, err
	}
	record.Settled, record.Status = true, status
	if err = saveRecord(operationPath(record.Operation.OperationID), record); err != nil {
		return status, err
	}
	return releaseCompletionBatch(record, status)
}

// The same deterministic stage driver is used by the host and real Git crash
// tests. Persistence and process invocation remain explicit infrastructure edges.
func advanceCompletionBatch(record *operationRecord, run func(int, string) (Status, error), save func() error, decide func(string) error) (Status, error) {
	op, progress := record.Operation, record.Completion
	if progress.Decision == "cancel" {
		return Status{}, fmt.Errorf("completion awaits cancellation settlement")
	}
	if progress.Decision == "" {
		for i := range progress.Items {
			item := &progress.Items[i]
			if item.Capture == nil {
				s, err := run(i, "capture")
				if err != nil {
					return s, err
				}
				if err = validateCompletionCapture(op.Workspaces[i], item.Metadata, s.Result); err != nil {
					return s, err
				}
				item.Capture = s.Result
				if err = save(); err != nil {
					return s, err
				}
			}
			if !item.Protected {
				s, err := run(i, "protect")
				if err != nil {
					return s, err
				}
				item.Protected = true
				if err = save(); err != nil {
					return s, err
				}
			}
		}
		conflict := false
		for i, input := range op.Workspaces {
			item := &progress.Items[i]
			if input.Integration == nil {
				continue
			}
			if item.Prepared == nil {
				s, err := run(i, "prepare")
				if err != nil {
					return s, err
				}
				item.Prepared = s.PreparedIntegration
				if item.Prepared == nil {
					return s, fmt.Errorf("missing prepared integration")
				}
				if err = save(); err != nil {
					return s, err
				}
			}
			conflict = conflict || item.Prepared.Outcome == protocol.Conflict
		}
		decision := "publish"
		if conflict {
			decision = "conflict"
		}
		if err := decide(decision); err != nil {
			return Status{}, err
		}
	}
	for i, input := range op.Workspaces {
		item := &progress.Items[i]
		if progress.Decision == "publish" && !item.Published {
			if input.Integration != nil {
				if s, err := run(i, "publish"); err != nil {
					return s, err
				}
			}
			item.Published = true
			if err := save(); err != nil {
				return Status{}, err
			}
		}
		if !item.Exported {
			if s, err := run(i, "export"); err != nil {
				return s, err
			}
			item.Exported = true
			if err := save(); err != nil {
				return Status{}, err
			}
		}
	}
	result, err := completionAggregate(record)
	if err != nil {
		return Status{}, err
	}
	status := Status{Known: true, Result: &result}
	return status, nil
}

func completionAggregate(record *operationRecord) (protocol.EffectResult, error) {
	result := protocol.EffectResult{WriterAbsent: ptr(true), WorkspaceResults: make([]protocol.WorkspaceEffectResult, 0, len(record.Operation.Workspaces))}
	outcome := "finalized"
	if record.Completion.Decision == "conflict" {
		outcome = "conflict"
	}
	result.CompletionOutcome = &outcome
	for i, input := range record.Operation.Workspaces {
		p := &record.Completion.Items[i]
		if p.Capture == nil || p.Capture.GitCommit == nil || p.Capture.GitTree == nil || !p.Protected || !p.Exported {
			return result, fmt.Errorf("incomplete completion capture")
		}
		start := p.Metadata.FinalizedCommit
		if p.Metadata.Isolation != nil {
			start = p.Metadata.Isolation.StartCommit
		}
		item := protocol.WorkspaceEffectResult{ResourceID: input.Workspace.ResourceID, WorkspaceID: input.Workspace.WorkspaceID, WorkspaceMetadata: p.Metadata, Capture: &protocol.WorkspaceCaptureResult{StartCommit: start, NodeCommit: *p.Capture.GitCommit, NodeTree: *p.Capture.GitTree}}
		item.WorkspaceMetadata.Checkpoint = nil
		if outcome == "finalized" {
			if !p.Published {
				return result, fmt.Errorf("incomplete completion publication")
			}
			item.GitCommit, item.GitTree = p.Capture.GitCommit, p.Capture.GitTree
			if input.Integration != nil {
				if p.Prepared == nil || p.Prepared.Outcome != protocol.Integrated {
					return result, fmt.Errorf("missing integrated completion proof")
				}
				item.Integration = p.Prepared
				item.GitCommit, item.GitTree = &p.Prepared.TaskCommit, &p.Prepared.TaskTree
			}
			item.WorkspaceMetadata.FinalizedCommit = *item.GitCommit
		} else if p.Prepared != nil && p.Prepared.Outcome == protocol.Conflict {
			item.Integration = p.Prepared
		}
		result.WorkspaceResults = append(result.WorkspaceResults, item)
	}
	return result, nil
}

func releaseCompletionBatch(record *operationRecord, status Status) (Status, error) {
	if record.Completion.Released {
		return status, nil
	}
	if status.Result == nil || len(status.Result.WorkspaceResults) != len(record.Operation.Workspaces) {
		return status, fmt.Errorf("completion terminal coverage mismatch")
	}
	for i, input := range record.Operation.Workspaces {
		r, err := readWorkspaceAllocation(&input.Workspace)
		if err != nil {
			return status, err
		}
		if !sameCompletionLease(r.Operation, record.Operation, input) {
			return status, fmt.Errorf("completion lease changed before release")
		}
		r.Metadata = status.Result.WorkspaceResults[i].WorkspaceMetadata
		r.PrivateCheckpoint, r.Released = nil, true
		if err = saveRecord(workspaceAllocationRecordPath(&input.Workspace), r); err != nil {
			return status, err
		}
	}
	record.Completion.Released = true
	return status, saveRecord(operationPath(record.Operation.OperationID), record)
}

// A worker launch is persisted with its exact parent/item/action digest, and the
// previous transient unit is reconciled before that identity can be replaced.
func runCompletionItem(ctx context.Context, record *operationRecord, workspace, action string) (Status, error) {
	if _, _, err := completionItem(record, workspace); err != nil {
		return Status{}, err
	}
	if active := record.Completion.Active; active != nil {
		if err := settleWorkspaceWorker(ctx, *record); err != nil {
			return Status{}, err
		}
		if active.WorkspaceID == workspace && active.Action == action && active.Settled && active.Status.Error == "" {
			return active.Status, nil
		}
	}
	lock, err := acquireFileLock(ctx, filepath.Join(Root, "launch", "helper.lock"))
	if err != nil {
		return Status{}, err
	}
	if record.Completion.Decision == "" {
		if err = requireUnfencedCompletion(record.Operation); err != nil {
			releaseFileLock(lock)
			return Status{}, err
		}
	}
	digest, err := completionInvocationDigest(record.Operation, workspace, action)
	if err != nil {
		releaseFileLock(lock)
		return Status{}, err
	}
	record.WorkspaceAction = action
	record.Completion.Active = &completionInvocation{WorkspaceID: workspace, Action: action, IdentityDigest: digest}
	if err = saveRecord(operationPath(record.Operation.OperationID), record); err != nil {
		releaseFileLock(lock)
		return Status{}, err
	}
	args := []string{"--quiet", "--wait", "--pipe", "--collect", "--service-type=exec", "--unit=" + operationUnit(record.Operation.OperationID), "--description=monos workspace operation " + record.Operation.OperationID + " " + digest}
	props := properties(record.Operation.AttemptID, true)
	if serviceWorkspaceAction(action) {
		props[0] = "User=monos-probe"
		for i, property := range props {
			if strings.HasPrefix(property, "WorkingDirectory=") {
				props[i] = "WorkingDirectory=" + filepath.Join(Root, "service")
			}
		}
	}
	for _, property := range props {
		args = append(args, "--property="+property)
	}
	args = append(args, Worker, "workspace", record.Operation.OperationID)
	cmd := exec.CommandContext(ctx, "/usr/bin/systemd-run", args...)
	cmd.Env = []string{"PATH=/usr/bin:/bin", "LANG=C.UTF-8"}
	var output bytes.Buffer
	cmd.Stdout = &output
	if err = cmd.Start(); err != nil {
		releaseFileLock(lock)
		return Status{}, fmt.Errorf("completion worker launch uncertain")
	}
	releaseFileLock(lock)
	if err = cmd.Wait(); err != nil {
		return Status{}, fmt.Errorf("completion worker response uncertain; retained ownership")
	}
	var status Status
	if output.Len() > 65536 || json.Unmarshal(output.Bytes(), &status) != nil || !status.Known || status.Result == nil {
		return Status{}, fmt.Errorf("invalid completion worker response")
	}
	record.Completion.Active.Settled, record.Completion.Active.Status = true, status
	if err = saveRecord(operationPath(record.Operation.OperationID), record); err != nil {
		return status, err
	}
	return status, statusError(status)
}

func completionItemWorker(record operationRecord) (Status, error) {
	active := record.Completion.Active
	if active == nil || active.Settled || active.Action != record.WorkspaceAction {
		return Status{}, fmt.Errorf("missing active completion invocation")
	}
	digest, err := completionInvocationDigest(record.Operation, active.WorkspaceID, active.Action)
	if err != nil || digest != active.IdentityDigest {
		return Status{}, fmt.Errorf("completion invocation identity changed")
	}
	input, progress, err := completionItem(&record, active.WorkspaceID)
	if err != nil {
		return Status{}, err
	}
	w := &input.Workspace
	allocation, err := readWorkspaceAllocation(w)
	if err != nil {
		return Status{}, err
	}
	if !sameCompletionLease(allocation.Operation, record.Operation, *input) || !reflect.DeepEqual(allocation.Metadata, progress.Metadata) {
		return Status{}, fmt.Errorf("completion worker lease changed")
	}
	lockPath := filepath.Join(Root, "launch", "workspaces", workspaceAllocationKey(w.WorkspaceID, w.Isolation)+".writer.lock")
	if serviceWorkspaceAction(active.Action) {
		lockPath = filepath.Join(Root, "service", "workspace-locks", w.ResourceID+".lock")
	}
	lock, err := acquireFileLock(context.Background(), lockPath)
	if err != nil {
		return Status{}, err
	}
	defer releaseFileLock(lock)
	current, err := readOperation(operationPath(record.Operation.OperationID))
	if err != nil || !sameOperation(current.Operation, record.Operation) || current.Completion == nil || !reflect.DeepEqual(current.Completion.Active, active) {
		return Status{}, fmt.Errorf("completion invocation superseded")
	}
	if record.Completion.Decision == "" {
		if err = requireUnfencedCompletion(record.Operation); err != nil {
			return Status{}, err
		}
	}
	return performCompletionItem(context.Background(), record, *input, *progress)
}

func performCompletionItem(ctx context.Context, record operationRecord, input protocol.WorkspaceCompletionInput, progress completionItemProgress) (Status, error) {
	w, op := &input.Workspace, record.Operation
	node, err := completionResultPath(op.OperationID, w.WorkspaceID, true)
	if err != nil {
		return Status{}, err
	}
	destination, err := completionResultPath(op.OperationID, w.WorkspaceID, false)
	if err != nil {
		return Status{}, err
	}
	return performCompletionItemAt(ctx, record, input, progress, integrationWorkspacePaths{workspace: WorkspacePath(w, "worktree"), common: WorkspacePath(w, "common"), nodeResult: node, taskRepository: protectedTaskResultPath(w.WorkspaceID), result: destination, cache: resourceCache(w.ResourceID)})
}

func performCompletionItemAt(ctx context.Context, record operationRecord, input protocol.WorkspaceCompletionInput, progress completionItemProgress, paths integrationWorkspacePaths) (Status, error) {
	w, op, action := &input.Workspace, record.Operation, record.WorkspaceAction
	metadata := progress.Metadata
	result := protocol.EffectResult{WriterAbsent: ptr(true), WorkspaceID: &w.WorkspaceID, WorkspaceMetadata: &metadata}
	var prepared *protocol.WorkspaceIntegrationResult
	status := func(err error) (Status, error) {
		return Status{Known: true, Result: &result, PreparedIntegration: prepared}, err
	}
	workspace, common, node, destination := paths.workspace, paths.common, paths.nodeResult, paths.result
	var err error
	if action == "capture" {
		result, err = finalize(workspace, common, op.OperationID, metadata.FinalizedCommit)
		if err == nil {
			metadata.FinalizedCommit, metadata.Checkpoint = *result.GitCommit, nil
			result.WorkspaceID, result.WorkspaceMetadata = &w.WorkspaceID, &metadata
		}
		return status(err)
	}
	if action == "cancel_checkpoint" {
		fence, e := readCompletionFenceAt(completionFencePath(op.OperationID), op, 0)
		if e != nil || fence == nil || record.Completion.Decision != "cancel" {
			return status(fmt.Errorf("missing completion cancellation decision"))
		}
		result, err = checkpointCompletionItem(*fence, op, input, metadata, workspace, common)
		return status(err)
	}
	if err = validateCompletionCapture(input, metadata, progress.Capture); err != nil {
		return status(err)
	}
	capture := progress.Capture
	if action == "protect" {
		if err = prepareCompletionNodeExport(node); err != nil {
			return status(err)
		}
		err = exportPathsTo(workspace, common, op.OperationID, *capture.GitCommit, *capture.GitTree, "refs/monos/operations/"+op.OperationID, node)
		return status(err)
	}
	if err = verifyProtectedWorkspaceResult(node, *capture.GitCommit, *capture.GitTree); err != nil {
		return status(err)
	}
	if action == "prepare" || action == "publish" {
		if input.Integration == nil || metadata.Isolation == nil {
			return status(fmt.Errorf("direct item cannot integrate"))
		}
		if action == "publish" && record.Completion.Decision != "publish" || action == "prepare" && record.Completion.Decision != "" {
			return status(fmt.Errorf("integration action differs from parent decision"))
		}
		repository, e := ensureProtectedTaskRepositoryItemAt(ctx, w, input.Integration, metadata, paths.taskRepository, paths.cache)
		if e != nil {
			return status(e)
		}
		integration := WorkspaceIntegrationInput{OperationID: op.OperationID, TaskRepository: repository, ExpectedTaskCommit: input.Integration.ExpectedTaskCommit, NodeRepository: node, NodeStartCommit: metadata.Isolation.StartCommit, NodeCommit: *capture.GitCommit, NodeTree: *capture.GitTree}
		var value WorkspaceIntegrationResult
		if action == "prepare" {
			value, err = PrepareWorkspaceIntegration(ctx, integration)
		} else {
			value, err = PublishWorkspaceIntegration(ctx, integration)
		}
		if err != nil && !errors.Is(err, ErrWorkspaceIntegrationConflict) {
			return status(err)
		}
		prepared = &protocol.WorkspaceIntegrationResult{Outcome: protocol.WorkspaceIntegrationResultOutcome(value.Outcome), StartCommit: value.StartCommit, NodeCommit: value.NodeCommit, NodeTree: value.NodeTree, ExpectedTaskCommit: value.ExpectedTaskCommit, TaskCommit: value.TaskCommit, TaskTree: value.TaskTree}
		if action == "publish" && !reflect.DeepEqual(prepared, progress.Prepared) {
			return status(fmt.Errorf("published integration differs from prepared result"))
		}
		return status(nil)
	}
	if action == "export" {
		if record.Completion.Decision != "publish" && record.Completion.Decision != "conflict" {
			return status(fmt.Errorf("export requires parent decision"))
		}
		source, ref, commit, tree := node, "refs/monos/result", *capture.GitCommit, *capture.GitTree
		if record.Completion.Decision == "publish" && input.Integration != nil {
			if progress.Prepared == nil || !progress.Published {
				return status(fmt.Errorf("export precedes publication"))
			}
			source, ref, commit, tree = paths.taskRepository, "refs/monos/integrations/"+op.OperationID, progress.Prepared.TaskCommit, progress.Prepared.TaskTree
		}
		if err = privateServiceDirectory(filepath.Dir(destination)); err != nil {
			return status(err)
		}
		return status(exportProtectedIntegration(ctx, source, ref, destination, commit, tree))
	}
	return status(fmt.Errorf("unknown completion item action"))
}

func validWorkspaceHash(id string) bool {
	_, err := hex.DecodeString(strings.TrimPrefix(id, "ws_"))
	return err == nil && strings.ToLower(id) == id
}

func validateCompletionMembership(d protocol.Dispatch, op protocol.Operation) error {
	if err := ValidateEffectScope(d, op); err != nil {
		return err
	}
	for _, reservation := range d.WorkspaceReservations.Resources {
		r, err := readWorkspaceReservation(reservation.WorkspaceID, reservation.Isolation)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		if len(op.Workspaces) == 0 {
			if err = validateRepositoryFreeWorkspace(r, op.AttemptID); err != nil {
				return err
			}
			continue
		}
		if r.Operation.AttemptID != op.AttemptID || r.Released {
			continue
		}
		found := false
		for _, input := range op.Workspaces {
			if sameCompletionLease(r.Operation, op, input) {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("completion omitted retained Attempt workspace")
		}
	}
	return nil
}

func prepareCompletionNodeExport(path string) error {
	for _, directory := range []string{filepath.Dir(filepath.Dir(path)), filepath.Dir(path)} {
		if err := privateServiceDirectory(directory); err != nil {
			return err
		}
	}
	return nil
}
