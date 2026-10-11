package host

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	protocol "monos.local/protocol"
)

func resumeWorkspaceRework(ctx context.Context, r *workspaceRecord, op protocol.Operation) error {
	return resumeWorkspaceReworkUsing(r, op, func() error { return saveRecord(workspaceRecordPath(op.Workspace.WorkspaceID), *r) },
		func(action string) (Status, error) { return runWorkspaceWorker(ctx, op, action, nil) },
		func() error {
			return archiveWorkspaceAllocation(TaskWorkspacePath(op.Workspace.WorkspaceID, ""), *op.Workspace.Transfer.ReworkRequestID, op.Workspace.Transfer.FromLeaseID, 0)
		},
		func() error {
			uid, gid, err := workspaceAccounts()
			if err != nil {
				return err
			}
			for _, name := range []string{"common", "worktree"} {
				p := TaskWorkspacePath(op.Workspace.WorkspaceID, name)
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
				if err = trustedDir(p, uint32(uid)); err != nil {
					return err
				}
			}
			return syncDirectory(filepath.Dir(TaskWorkspacePath(op.Workspace.WorkspaceID, "common")))
		})
}

func resumeWorkspaceReworkUsing(r *workspaceRecord, op protocol.Operation, save func() error, run func(string) (Status, error), archive, prepare func() error) error {
	if r.Stage != "rework_intent" && r.Stage != "rework_archiving" && r.Stage != "rework_archived" {
		return nil
	}
	t := op.Workspace.Transfer
	if t == nil || t.Purpose == nil || *t.Purpose != protocol.PurposeRework || t.ReworkRequestID == nil || len(op.Workspace.ReworkHistory) == 0 {
		return fmt.Errorf("Rework stage lacks exact disposition")
	}
	if r.Stage == "rework_intent" {
		if _, err := run("history"); err != nil {
			return err
		}
		r.Stage = "rework_archiving"
		if err := save(); err != nil {
			return err
		}
	}
	if r.Stage == "rework_archiving" {
		if err := archive(); err != nil {
			return err
		}
		r.Stage = "rework_archived"
		if err := save(); err != nil {
			return err
		}
	}
	if err := prepare(); err != nil {
		return err
	}
	status, err := run("rework_rebuild")
	if err != nil {
		return err
	}
	if status.Result == nil || status.Result.Path == nil || status.Result.WorkspaceID == nil || *status.Result.WorkspaceID != op.Workspace.WorkspaceID {
		return fmt.Errorf("Rework rebuild omitted workspace evidence")
	}
	r.PrivateCheckpoint = nil
	r.Stage = "refresh_intent"
	return save()
}
