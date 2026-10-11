package host

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	protocol "monos.local/protocol"
)

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
func ensureProtectedTaskRepositoryItemAt(ctx context.Context, w *protocol.WorkspaceDescriptor, integration *protocol.WorkspaceIntegration, metadata protocol.WorkspaceMetadata, repository, cache string) (string, error) {
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
		if integration.ExpectedTaskCommit != intent.InitialHead {
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

type integrationWorkspacePaths struct{ workspace, common, nodeResult, taskRepository, result, cache string }

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
