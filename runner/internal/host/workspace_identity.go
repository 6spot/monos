package host

import (
	"context"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"syscall"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

// TaskWorkspaceID is shared with the backend's canonical JSON hash fixture.
func TaskWorkspaceID(task, resource string) (string, error) {
	if !ValidID(task) || !ValidID(resource) {
		return "", fmt.Errorf("invalid workspace scope")
	}
	_, digest, err := wire.Canonical([]string{task, resource})
	return "ws_" + digest, err
}

func TaskWorkspacePath(id, name string) string { return filepath.Join(Root, "tasks", id, name) }
func workspaceRecordPath(id string) string {
	return filepath.Join(Root, "launch", "workspaces", id+".json")
}
func resourceCache(id string) string { return filepath.Join(Root, "cache", "resources", id+".git") }

func validateWorkspaceScope(d protocol.Dispatch, op protocol.Operation) error {
	w := op.Workspace
	if op.Kind != protocol.KindOpenWorkspace && op.Kind != protocol.KindCompleteNode && op.Kind != protocol.Stop && op.Kind != protocol.SettleCompletion {
		return fmt.Errorf("canonical repository inspection is unavailable")
	}
	if w == nil || op.WorkspaceDigest == nil || d.TaskID == nil || d.WorkspaceReservations == nil || d.Kind != protocol.Node {
		return fmt.Errorf("canonical workspace descriptor required")
	}
	_, digest, err := wire.Canonical(w)
	if err != nil || digest != *op.WorkspaceDigest {
		return fmt.Errorf("workspace digest mismatch")
	}
	if w.Basis != nil && w.Basis.RepositoryIdentity != w.Resource.RepositoryIdentity {
		return fmt.Errorf("workspace basis repository mismatch")
	}
	if op.Kind == protocol.KindOpenWorkspace && w.OpenOperationID != op.OperationID {
		return fmt.Errorf("workspace open operation mismatch")
	}
	id, err := TaskWorkspaceID(*d.TaskID, w.ResourceID)
	if err != nil || id != w.WorkspaceID || w.TaskID != *d.TaskID || w.RunnerID != d.RunnerID || w.ProjectID != d.WorkspaceReservations.ProjectID || op.ResourceID == nil || w.ResourceID != *op.ResourceID || w.Resource.ResourceID != w.ResourceID || d.NodeID == nil || w.NodeID != *d.NodeID || w.NodeActivation != d.NodeActivation {
		return fmt.Errorf("workspace ownership mismatch")
	}
	if t := w.Transfer; t != nil {
		if t.Purpose != nil && (*t.Purpose != protocol.Serial || t.FromPlanID != t.ToPlanID || t.Kind != "completed" || t.PublicationID != nil || t.ProposalID != nil) {
			return fmt.Errorf("workspace serial transfer scope mismatch")
		}
		if w.Basis == nil || d.NodeExecutionSource == nil || t.ToPlanID != d.NodeExecutionSource.PlanID || t.ToNodeID != w.NodeID || t.ToNodeActivation != w.NodeActivation || t.TaskID != w.TaskID || t.WorkspaceID != w.WorkspaceID || t.ResourceID != w.ResourceID || t.RunnerID != w.RunnerID || t.Metadata.Generation != w.Generation {
			return fmt.Errorf("workspace transfer target source mismatch")
		}
	}
	for _, r := range d.WorkspaceReservations.Resources {
		if r.ResourceID == w.ResourceID && r.WorkspaceID == w.WorkspaceID {
			return nil
		}
	}
	return fmt.Errorf("workspace was not reserved for this Attempt")
}

func reserveWorkspaces(d protocol.Dispatch, uid, gid int) error {
	if d.WorkspaceReservations == nil {
		return nil
	}
	if d.TaskID == nil {
		return fmt.Errorf("workspace reservation requires Task")
	}
	for _, r := range d.WorkspaceReservations.Resources {
		id, err := TaskWorkspaceID(*d.TaskID, r.ResourceID)
		if err != nil || r.WorkspaceID != id {
			return fmt.Errorf("invalid workspace reservation")
		}
		base := TaskWorkspacePath(id, "")
		if err = createTraversalRoot(base, 0, 0); err != nil {
			return err
		}
		for _, name := range []string{"worktree", "common"} {
			p := filepath.Join(base, name)
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
	}
	return nil
}

func storageIdentity() (string, error) {
	rootPath := filepath.Join(Root, "launch", "storage-id")
	service, err := user.Lookup("monos-probe")
	if err != nil {
		return "", err
	}
	uid, err := strconv.Atoi(service.Uid)
	if err != nil || uid == 0 {
		return "", fmt.Errorf("invalid service storage owner")
	}
	return readStorageIdentity(rootPath, filepath.Join(Root, "service", "storage-id"), 0, uint32(uid))
}

func readStorageIdentity(rootPath, servicePath string, rootUID, serviceUID uint32) (string, error) {
	if err := trustedFile(rootPath, rootUID); err != nil {
		return "", fmt.Errorf("storage_unavailable: root storage identity missing")
	}
	if err := trustedFile(servicePath, serviceUID); err != nil {
		return "", fmt.Errorf("storage_unavailable: service storage identity missing")
	}
	a, err := os.ReadFile(rootPath)
	if err != nil {
		return "", err
	}
	b, err := os.ReadFile(servicePath)
	if err != nil || string(a) != string(b) || !ValidID(strings.TrimSpace(string(a))) {
		return "", fmt.Errorf("storage_unavailable: storage identities disagree")
	}
	return strings.TrimSpace(string(a)), nil
}

// No expiry authorizes a new writer. Flocks serialize a single native workspace;
// durable operation records and cgroup reconciliation outlive their holders.
func acquireFileLock(ctx context.Context, path string) (*os.File, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	for {
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
func releaseFileLock(f *os.File) { _ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN); _ = f.Close() }

func sameWorkspaceOperation(a, b protocol.Operation) bool {
	return reflect.DeepEqual(a.Workspace, b.Workspace) && reflect.DeepEqual(a.WorkspaceDigest, b.WorkspaceDigest)
}
