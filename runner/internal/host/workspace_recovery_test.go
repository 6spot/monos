package host

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func workspaceFixtureRecord(t *testing.T) workspaceRecord {
	_, op := canonicalWorkspace(t)
	m := protocol.WorkspaceMetadata{StorageID: "storage", Generation: 1, LeaseID: op.Workspace.LeaseID, RepositoryIdentity: op.Workspace.Resource.RepositoryIdentity, BaseCommit: strings.Repeat("a", 40), FinalizedCommit: strings.Repeat("a", 40), TargetBranch: "main", TargetCommit: strings.Repeat("b", 40)}
	r := protocol.EffectResult{WorkspaceID: &op.Workspace.WorkspaceID, Path: ptr("/reserved/worktree"), InstructionFiles: []protocol.InstructionFile{}, WorkspaceMetadata: &m}
	return workspaceRecord{Operation: op, Metadata: m, OpenResult: &r, Stage: "ready", Released: true, TargetObservationLeaseID: op.Workspace.LeaseID}
}

func TestStorageAndRootMetadataLossNeverRegeneratesIdentity(t *testing.T) {
	dir := t.TempDir()
	root, service := filepath.Join(dir, "root-id"), filepath.Join(dir, "service-id")
	uid := uint32(os.Geteuid())
	if _, err := readStorageIdentity(root, service, uid, uid); err == nil {
		t.Fatal("missing identity accepted")
	}
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Fatal("missing root identity was regenerated")
	}
	for _, p := range []string{root, service} {
		if err := os.WriteFile(p, []byte("storage\n"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if id, err := readStorageIdentity(root, service, uid, uid); err != nil || id != "storage" {
		t.Fatal(id, err)
	}
	if err := os.WriteFile(service, []byte("replacement\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := readStorageIdentity(root, service, uid, uid); err == nil {
		t.Fatal("changed storage identity accepted")
	}
	if err := os.Remove(service); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(root, service); err != nil {
		t.Fatal(err)
	}
	if _, err := readStorageIdentity(root, service, uid, uid); err == nil {
		t.Fatal("symlink storage identity accepted")
	}
	r := workspaceFixtureRecord(t)
	path := filepath.Join(dir, "workspace.json")
	if err := saveRecord(path, r); err != nil {
		t.Fatal(err)
	}
	if _, err := readWorkspaceRecordAt(path, r.Operation.Workspace.WorkspaceID, uid); err != nil {
		t.Fatal(err)
	}
	r.Operation.Workspace.Resource.RepositoryIdentity = "github.com/unrelated/repository"
	if err := saveRecord(path, r); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(path)
	if _, err := readWorkspaceRecordAt(path, r.Operation.Workspace.WorkspaceID, uid); err == nil {
		t.Fatal("corrupt descriptor retained old digest")
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Fatal("corrupt metadata overwritten")
	}
}

func TestStopKillsAgentBeforeMarkerAndStorageFailures(t *testing.T) {
	for _, failure := range []string{"fence-save", "missing-storage"} {
		t.Run(failure, func(t *testing.T) {
			alive := true
			settled := false
			status, err := stopWorkspaceAgentFirst(func() (Status, error) { alive = false; return Status{Known: true}, nil }, func() error {
				if alive {
					t.Fatal("durable work ran before physical Stop")
				}
				if failure == "fence-save" {
					return errors.New("injected durable write failure")
				}
				return nil
			})
			if err == nil {
				// This is the next storage gate used by canonical settlement. The
				// already-stopped Agent stays absent while the lease needs recovery.
				_, err = readStorageIdentity(filepath.Join(t.TempDir(), "missing-root"), filepath.Join(t.TempDir(), "missing-service"), uint32(os.Geteuid()), uint32(os.Geteuid()))
				if err == nil {
					settled = true
				}
			}
			if alive || err == nil || settled || status.Result != nil {
				t.Fatal("storage failure prevented kill or fabricated successful lease release", status, err)
			}
		})
	}
}

func TestCommonPromotionRecoversBothRenameWindowsWithoutReplacingData(t *testing.T) {
	for _, window := range []string{"before-remove", "after-remove", "after-rename", "unexpected-common"} {
		t.Run(window, func(t *testing.T) {
			dir := t.TempDir()
			staging, common := filepath.Join(dir, "staging"), filepath.Join(dir, "common")
			for _, p := range []string{staging, common} {
				if err := os.Mkdir(p, 0750); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.WriteFile(filepath.Join(staging, "HEAD"), []byte("pinned clone"), 0640); err != nil {
				t.Fatal(err)
			}
			if window == "after-remove" || window == "after-rename" {
				if err := os.Remove(common); err != nil {
					t.Fatal(err)
				}
			}
			if window == "after-rename" {
				if err := os.Rename(staging, common); err != nil {
					t.Fatal(err)
				}
			}
			if window == "unexpected-common" {
				if err := os.WriteFile(filepath.Join(common, "user-data"), []byte("keep"), 0600); err != nil {
					t.Fatal(err)
				}
				if promoteWorkspaceCommon(staging, common) == nil {
					t.Fatal("nonempty common overwritten")
				}
				return
			}
			if err := promoteWorkspaceCommon(staging, common); err != nil {
				t.Fatal(err)
			}
			if err := promoteWorkspaceCommon(staging, common); err != nil {
				t.Fatal("promotion replay failed", err)
			}
			data, err := os.ReadFile(filepath.Join(common, "HEAD"))
			if err != nil || string(data) != "pinned clone" {
				t.Fatal("promoted data lost", err)
			}
		})
	}
}

func TestDurableReadyReplayAndFailedReadyPersistence(t *testing.T) {
	r := workspaceFixtureRecord(t)
	result := r.OpenResult
	r.OpenResult = nil
	r.Stage = "common_ready"
	r.Released = false
	dir := t.TempDir()
	path := filepath.Join(dir, "workspace.json")
	if err := persistWorkspaceReady(path, &r, result); err != nil {
		t.Fatal(err)
	}
	// Root ready is the exposure boundary. An acknowledgement can be lost;
	// restoring it uses the retained bytes without running checkout again.
	loaded, err := readWorkspaceRecordAt(path, r.Operation.Workspace.WorkspaceID, uint32(os.Geteuid()))
	if err != nil {
		t.Fatal(err)
	}
	again, err := reuseWorkspaceRecord(loaded, r.Operation, "storage")
	if err != nil || !reflect.DeepEqual(again.OpenResult, result) {
		t.Fatal("lost acknowledgement changed open result", err)
	}
	if err = os.WriteFile(filepath.Join(dir, "not-a-directory"), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = persistWorkspaceReady(filepath.Join(dir, "not-a-directory", "workspace.json"), &r, result); err == nil {
		t.Fatal("ready returned success after durable save failure")
	}
	retained, err := readWorkspaceRecordAt(path, r.Operation.Workspace.WorkspaceID, uint32(os.Geteuid()))
	if err != nil || !reflect.DeepEqual(retained.OpenResult, result) {
		t.Fatal("failed ready write damaged retained result", err)
	}
}

func TestInitializedRefreshFailureAndStopBeforeLocalOpenRecoverOldObservation(t *testing.T) {
	for _, localIntent := range []bool{false, true} {
		t.Run(fmtBool(localIntent), func(t *testing.T) {
			r := workspaceFixtureRecord(t)
			oldLease := r.Metadata.LeaseID
			var open protocol.Operation
			raw, _ := json.Marshal(r.Operation)
			_ = json.Unmarshal(raw, &open)
			open.OperationID = "next-open"
			open.RequestID = "next-request"
			open.Workspace.LeaseID = "next-lease"
			open.Workspace.OpenOperationID = open.OperationID
			open.Workspace.Basis = &protocol.WorkspaceBasis{StorageID: r.Metadata.StorageID, RepositoryIdentity: r.Metadata.RepositoryIdentity, BaseCommit: r.Metadata.BaseCommit, FinalizedCommit: r.Metadata.FinalizedCommit, TargetBranch: r.Metadata.TargetBranch}
			_, digest, _ := wire.Canonical(open.Workspace)
			open.WorkspaceDigest = &digest
			stop := open
			stop.Kind = protocol.Stop
			stop.OperationID = "next-stop"
			stop.RequestID = "stop-request"
			var err error
			if localIntent {
				r, err = reuseWorkspaceRecord(r, open, "storage")
				if err != nil {
					t.Fatal(err)
				}
			}
			r, err = reuseWorkspaceRecord(r, stop, "storage")
			if err != nil {
				t.Fatal(err)
			}
			if err = prepareStopRecovery(&r, stop); err != nil {
				t.Fatal(err)
			}
			if r.Stage == "cancelled" || r.Metadata.FinalizedCommit != open.Workspace.Basis.FinalizedCommit || r.Metadata.TargetObservationLeaseID == nil || *r.Metadata.TargetObservationLeaseID != oldLease || r.Metadata.RecoveredByStopOperationID == nil || *r.Metadata.RecoveredByStopOperationID != stop.OperationID {
				t.Fatalf("initialized Stop lost fixed basis/provenance: %+v", r)
			}
			// Another failed refresh must still cite the original fresh lease,
			// never promote this Stop-only recovery into a new remote observation.
			r.Released = true
			r.Stage = "ready"
			r.OpenResult = &protocol.EffectResult{WorkspaceMetadata: &r.Metadata}
			var next protocol.Operation
			raw, _ = json.Marshal(stop)
			_ = json.Unmarshal(raw, &next)
			next.OperationID = "third-stop"
			next.Workspace.LeaseID = "third-lease"
			next.Workspace.OpenOperationID = "third-open"
			_, nextDigest, _ := wire.Canonical(next.Workspace)
			next.WorkspaceDigest = &nextDigest
			r, err = reuseWorkspaceRecord(r, next, "storage")
			if err != nil {
				t.Fatal(err)
			}
			if err = prepareStopRecovery(&r, next); err != nil || r.Metadata.TargetObservationLeaseID == nil || *r.Metadata.TargetObservationLeaseID != oldLease {
				t.Fatal("recovery chain promoted stale target observation", err)
			}
			r.Stage = "refresh_pinned"
			if err = prepareStopRecovery(&r, next); err != nil || r.Metadata.TargetObservationLeaseID != nil || r.Metadata.RecoveredByStopOperationID != nil {
				t.Fatal("fresh target retained stale recovery provenance", err)
			}
		})
	}
}
