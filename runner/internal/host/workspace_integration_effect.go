package host

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"

	protocol "monos.local/protocol"
)

func privateNodeResultPath(operation string) string {
	return filepath.Join(Root, "service", "node-results", operation)
}

func protectedTaskResultPath(workspace string) string {
	return filepath.Join(Root, "service", "task-results", workspace+".git")
}

func privateServiceDirectory(path string) error {
	if err := serviceDirectory(filepath.Dir(path), true); err != nil {
		return err
	}
	if err := os.Mkdir(path, 0700); err == nil {
		if err = syncDirectory(filepath.Dir(path)); err != nil {
			return err
		}
	} else if !os.IsExist(err) {
		return err
	}
	return serviceDirectory(path, true)
}

type canonicalTaskRepositoryIntent struct {
	WorkspaceID string `json:"workspace_id"`
	TaskID      string `json:"task_id"`
	ResourceID  string `json:"resource_id"`
	StorageID   string `json:"storage_id"`
	BaseCommit  string `json:"base_commit"`
	InitialHead string `json:"initial_head"`
	Initialized bool   `json:"initialized"`
}

// This repository is created only from a protected finalized input. Initialization
// has its own retained identity; missing initialized storage is never recloned.
func ensureProtectedTaskRepositoryAt(ctx context.Context, op protocol.Operation, metadata protocol.WorkspaceMetadata, repository, cache string) (string, error) {
	w := op.Workspace
	parent := filepath.Dir(repository)
	if err := privateServiceDirectory(parent); err != nil {
		return "", err
	}
	path := filepath.Join(parent, w.WorkspaceID+".json")
	intent := canonicalTaskRepositoryIntent{WorkspaceID: w.WorkspaceID, TaskID: w.TaskID, ResourceID: w.ResourceID, StorageID: metadata.StorageID, BaseCommit: metadata.BaseCommit, InitialHead: metadata.Isolation.StartCommit}
	if err := trustedFile(path, uint32(os.Geteuid())); err == nil {
		raw, err := os.ReadFile(path)
		if err != nil {
			return "", err
		}
		var retained canonicalTaskRepositoryIntent
		if json.Unmarshal(raw, &retained) != nil || retained.WorkspaceID != intent.WorkspaceID || retained.TaskID != intent.TaskID || retained.ResourceID != intent.ResourceID || retained.StorageID != intent.StorageID || retained.BaseCommit != intent.BaseCommit || !objectID.MatchString(retained.InitialHead) {
			return "", fmt.Errorf("storage_unavailable: canonical Task storage identity changed")
		}
		intent = retained
	} else if !os.IsNotExist(err) {
		return "", err
	} else {
		if op.Integration.ExpectedTaskCommit != intent.InitialHead {
			return "", fmt.Errorf("storage_unavailable: canonical Task history is missing")
		}
		if err = saveRecord(path, intent); err != nil {
			return "", err
		}
	}
	if intent.Initialized {
		return repository, integrationRepository(ctx, repository)
	}
	if err := privateServiceDirectory(repository); err != nil {
		return "", err
	}
	if _, err := integrationGit(ctx, repository, "", "", "init", "--bare"); err != nil {
		return "", err
	}
	if _, err := gitScoped(repository, []string{cache}, nil, "fetch", "--no-tags", "--no-write-fetch-head", cache, intent.InitialHead); err != nil {
		return "", err
	}
	if err := integrationCreateRef(ctx, repository, WorkspaceTaskFinalizedRef, intent.InitialHead); err != nil {
		return "", err
	}
	intent.Initialized = true
	if err := saveRecord(path, intent); err != nil {
		return "", err
	}
	return repository, nil
}

func validateIntegrationCapture(op protocol.Operation, metadata protocol.WorkspaceMetadata, capture *protocol.EffectResult) error {
	w := op.Workspace
	if w == nil || w.Isolation == nil || op.Integration == nil || !objectID.MatchString(op.Integration.ExpectedTaskCommit) || metadata.Isolation == nil || metadata.Isolation.AllocationID != w.Isolation.AllocationID || !objectID.MatchString(metadata.Isolation.StartCommit) || capture == nil || capture.GitCommit == nil || capture.GitTree == nil || capture.WorkspaceMetadata == nil || capture.WorkspaceID == nil || *capture.WorkspaceID != w.WorkspaceID || capture.WriterAbsent == nil || !*capture.WriterAbsent || capture.Integration != nil || capture.Path != nil || capture.InstructionFiles != nil {
		return fmt.Errorf("invalid protected integration capture")
	}
	expected := metadata
	expected.FinalizedCommit, expected.Checkpoint = *capture.GitCommit, nil
	if !reflect.DeepEqual(expected, *capture.WorkspaceMetadata) || !objectID.MatchString(*capture.GitCommit) || !objectID.MatchString(*capture.GitTree) {
		return fmt.Errorf("protected integration capture metadata changed")
	}
	return nil
}

// Invoked only as a service-account worker from an already-persisted root start
// barrier. Cancellation after that barrier reconciles this exact operation.
func integrateWorkspaceCapture(ctx context.Context, record operationRecord, metadata protocol.WorkspaceMetadata) (protocol.EffectResult, error) {
	if os.Geteuid() == 0 {
		return protocol.EffectResult{}, fmt.Errorf("integration requires service account")
	}
	op := record.Operation
	return integrateWorkspaceCaptureAt(ctx, record, metadata, integrationWorkspacePaths{
		workspace: WorkspacePath(op.Workspace, "worktree"), common: WorkspacePath(op.Workspace, "common"),
		nodeResult: privateNodeResultPath(op.OperationID), taskRepository: protectedTaskResultPath(op.Workspace.WorkspaceID),
		result: filepath.Join(Root, "results", op.OperationID), cache: resourceCache(op.Workspace.ResourceID),
	})
}

func exportWorkspaceCapture(record operationRecord, metadata protocol.WorkspaceMetadata) (protocol.EffectResult, error) {
	w := record.Operation.Workspace
	return exportWorkspaceCaptureAt(record, metadata, integrationWorkspacePaths{workspace: WorkspacePath(w, "worktree"), common: WorkspacePath(w, "common"), nodeResult: privateNodeResultPath(record.Operation.OperationID)})
}

func exportWorkspaceCaptureAt(record operationRecord, metadata protocol.WorkspaceMetadata, paths integrationWorkspacePaths) (protocol.EffectResult, error) {
	op, capture := record.Operation, record.FinalizationResult
	if err := validateIntegrationCapture(op, metadata, capture); err != nil {
		return protocol.EffectResult{}, err
	}
	if err := privateServiceDirectory(filepath.Dir(paths.nodeResult)); err != nil {
		return protocol.EffectResult{}, err
	}
	if err := exportPathsTo(paths.workspace, paths.common, op.OperationID, *capture.GitCommit, *capture.GitTree, "refs/monos/operations/"+op.OperationID, paths.nodeResult); err != nil {
		return protocol.EffectResult{}, err
	}
	return *capture, nil
}

type integrationWorkspacePaths struct {
	workspace, common, nodeResult, taskRepository, result, cache string
}

func integrateWorkspaceCaptureAt(ctx context.Context, record operationRecord, metadata protocol.WorkspaceMetadata, paths integrationWorkspacePaths) (protocol.EffectResult, error) {
	op := record.Operation
	var result protocol.EffectResult
	if !record.IntegrationStarted || record.WorkspaceAction != "integrate" {
		return result, fmt.Errorf("integration lacks protected service start authority")
	}
	if err := validateIntegrationCapture(op, metadata, record.FinalizationResult); err != nil {
		return result, err
	}
	capture, w := record.FinalizationResult, op.Workspace
	if err := verifyProtectedWorkspaceResult(paths.nodeResult, *capture.GitCommit, *capture.GitTree); err != nil {
		return result, err
	}
	repository, err := ensureProtectedTaskRepositoryAt(ctx, op, metadata, paths.taskRepository, paths.cache)
	if err != nil {
		return result, err
	}
	value, err := IntegrateWorkspace(ctx, WorkspaceIntegrationInput{OperationID: op.OperationID, TaskRepository: repository, ExpectedTaskCommit: op.Integration.ExpectedTaskCommit, NodeRepository: paths.nodeResult, NodeStartCommit: metadata.Isolation.StartCommit, NodeCommit: *capture.GitCommit, NodeTree: *capture.GitTree})
	if err != nil && !errors.Is(err, ErrWorkspaceIntegrationConflict) {
		return result, err
	}
	result = protocol.EffectResult{WorkspaceID: &w.WorkspaceID, WorkspaceMetadata: &metadata, WriterAbsent: ptr(true), Integration: &protocol.WorkspaceIntegrationResult{Outcome: protocol.WorkspaceIntegrationResultOutcome(value.Outcome), StartCommit: value.StartCommit, NodeCommit: value.NodeCommit, NodeTree: value.NodeTree, ExpectedTaskCommit: value.ExpectedTaskCommit, TaskCommit: value.TaskCommit, TaskTree: value.TaskTree}}
	metadata.Checkpoint = nil
	source, sourceRef, commit, tree := repository, value.OperationRef, value.TaskCommit, value.TaskTree
	if value.Outcome == "integrated" {
		metadata.FinalizedCommit = value.TaskCommit
		result.GitCommit, result.GitTree = &value.TaskCommit, &value.TaskTree
	} else {
		source, sourceRef, commit, tree = paths.nodeResult, "refs/monos/result", value.NodeCommit, value.NodeTree
	}
	if err = exportProtectedIntegration(ctx, source, sourceRef, paths.result, commit, tree); err != nil {
		return result, err
	}
	return result, nil
}

func exportProtectedIntegration(ctx context.Context, source, ref, destination, commit, tree string) error {
	if err := integrationRepository(ctx, source); err != nil {
		return err
	}
	actual, err := integrationRef(ctx, source, ref)
	if err != nil || actual != commit {
		return fmt.Errorf("storage_unavailable: protected integration source changed")
	}
	if err = privateServiceDirectory(destination); err != nil {
		return err
	}
	if _, err = os.Lstat(filepath.Join(destination, "HEAD")); os.IsNotExist(err) {
		if _, err = gitScoped(destination, []string{source}, nil, "clone", "--bare", "--no-local", source, destination); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	if _, err = gitScoped(destination, []string{source}, nil, "fetch", "--no-tags", "--no-write-fetch-head", source, commit); err != nil {
		return err
	}
	if err = integrationCreateRef(ctx, destination, "refs/monos/result", commit); err != nil {
		return err
	}
	return verifyProtectedWorkspaceResult(destination, commit, tree)
}
