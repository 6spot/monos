package host

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func TestWorkspaceIsolationStopBeforeOpenSkipsReworkHistory(t *testing.T) {
	for _, stage := range []string{"missing", "intent", "pinned", "promoting", "common_ready", "cancelled"} {
		t.Run(stage, func(t *testing.T) {
			_, op, _, _ := reworkTransferFixture(t)
			op.Kind, op.OperationID = protocol.Stop, "new-stop"
			op.Workspace.Transfer = nil
			op.Workspace.Isolation = &protocol.WorkspaceIsolation{AllocationID: "fresh-rework"}
			_, digest, _ := wire.Canonical(op.Workspace)
			op.WorkspaceDigest = &digest
			r := workspaceRecord{Operation: op, Stage: stage, Metadata: protocol.WorkspaceMetadata{StorageID: "storage"}}
			path := filepath.Join(t.TempDir(), "allocation.json")
			if stage == "missing" {
				r.Stage = "intent"
			} else if err := saveRecord(path, r); err != nil {
				t.Fatal(err)
			}
			before := r
			if err := recoverWorkspaceForStop(&r, op, func() error {
				t.Fatal("unexposed Stop attempted recovery persistence")
				return nil
			}, func(action string) (Status, error) {
				// The old path attempted history before creating this record and
				// therefore failed forever when Stop overtook the open helper.
				_, err := readWorkspaceRecordAt(path, op.Workspace.WorkspaceID, uint32(os.Geteuid()))
				t.Errorf("unexposed Stop launched %s: %v", action, err)
				return Status{}, errors.New("unexpected worker")
			}); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(r, before) || r.OpenResult != nil || r.PrivateCheckpoint != nil {
				t.Fatal("unexposed cancellation manufactured initialized work")
			}
		})
	}
}

func TestWorkspaceIsolationStopRecoversInitializedRework(t *testing.T) {
	for _, isolated := range []bool{false, true} {
		t.Run(fmtBool(isolated), func(t *testing.T) {
			r, op, _, _ := reworkTransferFixture(t)
			op.Kind, op.OperationID = protocol.Stop, "new-stop"
			if isolated {
				op.Workspace.Isolation = &protocol.WorkspaceIsolation{AllocationID: "retained"}
			}
			_, digest, _ := wire.Canonical(op.Workspace)
			op.WorkspaceDigest = &digest
			r.Operation, r.Stage, r.OpenResult = op, "refresh_intent", nil
			r.TargetObservationLeaseID = "old-lease"
			path := filepath.Join(t.TempDir(), "allocation.json")
			var actions []string
			err := recoverWorkspaceForStop(&r, op, func() error { return saveRecord(path, r) }, func(action string) (Status, error) {
				actions = append(actions, action)
				if action == "recover" {
					retained, err := readWorkspaceRecordAt(path, op.Workspace.WorkspaceID, uint32(os.Geteuid()))
					if err != nil || retained.Metadata.RecoveredByStopOperationID == nil || *retained.Metadata.RecoveredByStopOperationID != op.OperationID {
						t.Fatalf("recovery lacks durable Stop intent: %#v, %v", retained, err)
					}
					return Status{Known: true, Result: &protocol.EffectResult{Path: ptr("/retained/worktree"), WorkspaceID: &op.Workspace.WorkspaceID, WorkspaceMetadata: &r.Metadata}}, nil
				}
				return Status{Known: true}, nil
			})
			if err != nil || !reflect.DeepEqual(actions, []string{"history", "recover"}) || r.Stage != "ready" || r.OpenResult == nil {
				t.Fatalf("initialized Stop lost recovery: %#v, %#v, %v", r, actions, err)
			}
		})
	}
}

func TestWorkspaceIsolationStopRejectsUnknownOrLostCheckpointState(t *testing.T) {
	for _, checkpoint := range []bool{false, true} {
		r, op, _, _ := reworkTransferFixture(t)
		op.Kind = protocol.Stop
		op.Workspace.Isolation = &protocol.WorkspaceIsolation{AllocationID: "retained"}
		r.OpenResult, r.Stage, r.Released = nil, "unknown", false
		if checkpoint {
			r.Stage = "intent"
		} else {
			op.Workspace.Transfer = nil
		}
		err := recoverWorkspaceForStop(&r, op, func() error { t.Fatal("uncertain Stop persisted state"); return nil }, func(string) (Status, error) {
			t.Fatal("uncertain Stop launched worker")
			return Status{}, nil
		})
		if err == nil || r.Released {
			t.Fatal("unknown or initialized checkpoint was treated as a fresh cancellation")
		}
	}
}

func TestWorkspaceIsolationReservationsSeparatePathsAndRecords(t *testing.T) {
	d, op := canonicalWorkspace(t)
	d.WorkspaceReservations.Resources[0].Isolation = &protocol.WorkspaceIsolation{AllocationID: "left"}
	op.Workspace.Isolation = &protocol.WorkspaceIsolation{AllocationID: "left"}
	_, digest, _ := wire.Canonical(op.Workspace)
	op.WorkspaceDigest = &digest
	if err := ValidateEffectScope(d, op); err != nil {
		t.Fatal(err)
	}
	left, err := RuntimePaths(d)
	if err != nil {
		t.Fatal(err)
	}
	d.WorkspaceReservations.Resources[0].Isolation = &protocol.WorkspaceIsolation{AllocationID: "right"}
	right, err := RuntimePaths(d)
	if err != nil {
		t.Fatal(err)
	}
	if reflect.DeepEqual(left, right) || left[len(left)-1] == right[len(right)-1] || left[len(left)-2] == right[len(right)-2] {
		t.Fatal("parallel reservations share writable common/worktree paths")
	}
	for _, p := range append(left, right...) {
		if p == TaskWorkspacePath(op.Workspace.WorkspaceID, "common") || p == TaskWorkspacePath(op.Workspace.WorkspaceID, "worktree") {
			t.Fatal("isolated Attempt received direct Task workspace writes")
		}
	}
	if err := ValidateEffectScope(d, op); err == nil {
		t.Fatal("Attempt opened a sibling allocation")
	}
	other := *op.Workspace
	other.Isolation = d.WorkspaceReservations.Resources[0].Isolation
	if workspaceAllocationRecordPath(&other) == workspaceAllocationRecordPath(op.Workspace) {
		t.Fatal("allocation records share mutable lease authority")
	}
	d.WorkspaceReservations.Resources[0].Isolation.AllocationID = "../outside"
	if _, err := RuntimePaths(d); err == nil {
		t.Fatal("invalid allocation escaped reserved path")
	}
}

func TestWorkspaceIsolationCompletionRequiresFrozenTaskRevision(t *testing.T) {
	d, op := canonicalWorkspace(t)
	d.WorkspaceReservations.Resources[0].Isolation = &protocol.WorkspaceIsolation{AllocationID: "isolated"}
	op.Workspace.Isolation = d.WorkspaceReservations.Resources[0].Isolation
	op.Kind = protocol.KindCompleteNode
	if err := validateWorkspaceIsolation(d, op); err == nil {
		t.Fatal("isolated completion lacks expected Task revision")
	}
	integration := &protocol.WorkspaceIntegration{ExpectedTaskCommit: strings.Repeat("a", 40)}
	if err := validateWorkspaceIsolationInput(d, op.Kind, op.Workspace, integration); err != nil {
		t.Fatal(err)
	}
	op.Kind = protocol.Stop
	if err := validateWorkspaceIsolationInput(d, op.Kind, op.Workspace, integration); err == nil {
		t.Fatal("Stop can initiate integration")
	}
}

func TestWorkspaceIsolationCheckpointResumeKeepsStartWhenTaskAdvanced(t *testing.T) {
	_, old := canonicalWorkspace(t)
	old.Workspace.Isolation = &protocol.WorkspaceIsolation{AllocationID: "retained"}
	base, later := strings.Repeat("a", 40), strings.Repeat("b", 40)
	metadata := protocol.WorkspaceMetadata{StorageID: "storage", Generation: 1, LeaseID: old.Workspace.LeaseID, RepositoryIdentity: old.Workspace.Resource.RepositoryIdentity, BaseCommit: base, FinalizedCommit: base, TargetBranch: "main", Isolation: &protocol.WorkspaceIsolationMetadata{AllocationID: "retained", StartCommit: base}}
	cp := &protocol.WorkspaceCheckpoint{OperationID: "stop", CommitID: strings.Repeat("c", 40), TreeID: strings.Repeat("d", 40), HeadCommit: base}
	r := workspaceRecord{Operation: old, Stage: "ready", Metadata: metadata, PrivateCheckpoint: cp, Released: true, OpenResult: &protocol.EffectResult{}}
	next := old
	w := *old.Workspace
	w.LeaseID, w.OpenOperationID = "new-lease", "new-open"
	w.Basis = &protocol.WorkspaceBasis{StorageID: "storage", RepositoryIdentity: metadata.RepositoryIdentity, BaseCommit: base, FinalizedCommit: later, TargetBranch: "main"}
	next.Workspace = &w
	result, err := reuseWorkspaceRecord(r, next, "storage")
	if err != nil {
		t.Fatal(err)
	}
	if result.Metadata.Isolation.StartCommit != base || result.Metadata.FinalizedCommit != base || result.PrivateCheckpoint != cp || result.Stage != "refresh_intent" || result.Released {
		t.Fatalf("resume lost old private allocation while Task advanced: %#v", result)
	}
	w.Isolation = &protocol.WorkspaceIsolation{AllocationID: "different"}
	if _, err = reuseWorkspaceRecord(r, next, "storage"); err == nil {
		t.Fatal("reused a different physical allocation")
	}
}

func TestWorkspaceIsolationCanonicalSourceProofBindsRetainedScope(t *testing.T) {
	d, old := canonicalWorkspace(t)
	base := strings.Repeat("a", 40)
	metadata := protocol.WorkspaceMetadata{StorageID: "storage", Generation: 1, LeaseID: old.Workspace.LeaseID, RepositoryIdentity: old.Workspace.Resource.RepositoryIdentity, BaseCommit: base, FinalizedCommit: base, TargetBranch: "main"}
	source := protocol.WorkspaceCanonicalSource{OperationID: old.OperationID, AttemptID: old.AttemptID, Kind: string(old.Kind), Metadata: metadata}
	proof := operationRecord{Operation: old, Settled: true, Status: Status{Known: true, Result: &protocol.EffectResult{WorkspaceID: &old.Workspace.WorkspaceID, WorkspaceMetadata: &metadata, Path: ptr(WorkspacePath(old.Workspace, "worktree"))}}}
	next := old
	w := *old.Workspace
	w.Isolation = &protocol.WorkspaceIsolation{AllocationID: "new"}
	w.Basis = &protocol.WorkspaceBasis{StorageID: "storage", BaseCommit: base, FinalizedCommit: base, RepositoryIdentity: metadata.RepositoryIdentity, TargetBranch: "main"}
	next.Workspace = &w
	if err := validateWorkspaceSourceProof(next, source, proof, Manifest{Dispatch: d}, false); err != nil {
		t.Fatal(err)
	}
	for _, mismatch := range []string{"manifest", "task", "metadata", "result"} {
		t.Run(mismatch, func(t *testing.T) {
			changed, current, claimed := proof, next, source
			manifest := Manifest{Dispatch: d}
			switch mismatch {
			case "manifest":
				manifest.Dispatch.NodeID = ptr("foreign-node")
			case "task":
				workspace := *next.Workspace
				workspace.TaskID = "another-task"
				current.Workspace = &workspace
			case "metadata":
				claimed.Metadata.FinalizedCommit = strings.Repeat("b", 40)
			case "result":
				changed.Settled = false
			}
			if err := validateWorkspaceSourceProof(current, claimed, changed, manifest, false); err == nil {
				t.Fatal("accepted changed canonical authority")
			}
		})
	}
}

func TestWorkspaceIsolationRecoveredOpenUsesExactStopPair(t *testing.T) {
	d, original := canonicalWorkspace(t)
	base := strings.Repeat("a", 40)
	metadata := protocol.WorkspaceMetadata{StorageID: "storage", Generation: 1, LeaseID: original.Workspace.LeaseID, RepositoryIdentity: original.Workspace.Resource.RepositoryIdentity, BaseCommit: base, FinalizedCommit: base, TargetBranch: "main"}
	source := protocol.WorkspaceCanonicalSource{OperationID: original.OperationID, AttemptID: original.AttemptID, Kind: string(original.Kind), Metadata: metadata, RecoveryOperationID: ptr("stop")}
	stop := original
	stop.Kind, stop.OperationID = protocol.Stop, "stop"
	result := protocol.EffectResult{WorkspaceID: &original.Workspace.WorkspaceID, WorkspaceMetadata: &metadata, Path: ptr(WorkspacePath(original.Workspace, "worktree"))}
	recovery := operationRecord{Operation: stop, Settled: true, Status: Status{Known: true, Result: &protocol.EffectResult{WriterAbsent: ptr(true)}, PriorOperationResult: &protocol.OperationResult{OperationID: original.OperationID, AttemptID: original.AttemptID, Success: true, Result: result}}}
	next := original
	w := *original.Workspace
	w.Isolation = &protocol.WorkspaceIsolation{AllocationID: "new"}
	w.Basis = &protocol.WorkspaceBasis{StorageID: "storage", BaseCommit: base, FinalizedCommit: base, RepositoryIdentity: metadata.RepositoryIdentity, TargetBranch: "main"}
	next.Workspace = &w
	// Stop can arrive before the original open helper retained any record.
	if err := validateRecoveredWorkspaceSource(next, source, operationRecord{}, recovery, Manifest{Dispatch: d}, false); err != nil {
		t.Fatal(err)
	}
	old := operationRecord{Operation: original, WorkspaceAction: "fetch"}
	if err := validateRecoveredWorkspaceSource(next, source, old, recovery, Manifest{Dispatch: d}, false); err != nil {
		t.Fatal(err)
	}
	changed := recovery
	prior := *recovery.Status.PriorOperationResult
	prior.OperationID = "unrelated-open"
	changed.Status.PriorOperationResult = &prior
	if err := validateRecoveredWorkspaceSource(next, source, old, changed, Manifest{Dispatch: d}, false); err == nil {
		t.Fatal("accepted a different recovered open")
	}
	claimed := source
	claimed.RecoveryOperationID = ptr("other-stop")
	if err := validateRecoveredWorkspaceSource(next, claimed, old, recovery, Manifest{Dispatch: d}, false); err == nil {
		t.Fatal("accepted a different recovery operation")
	}
	old.Settled, old.Status.Known = true, true
	different := result
	different.Path = ptr("/changed")
	old.Status.Result = &different
	if err := validateRecoveredWorkspaceSource(next, source, old, recovery, Manifest{Dispatch: d}, false); err == nil {
		t.Fatal("recovery replaced original ready evidence")
	}
}

func TestWorkspaceReservationsKeepDifferentResourceAllocations(t *testing.T) {
	d, op := canonicalWorkspace(t)
	first := d.WorkspaceReservations.Resources[0]
	first.Isolation = &protocol.WorkspaceIsolation{AllocationID: "checkpoint-first"}
	second := first
	second.ResourceID = "second"
	second.WorkspaceID, _ = TaskWorkspaceID(*d.TaskID, second.ResourceID)
	second.Isolation = &protocol.WorkspaceIsolation{AllocationID: "checkpoint-second"}
	d.WorkspaceReservations.Resources = []protocol.WorkspaceReservation{first, second}
	paths, err := RuntimePaths(d)
	if err != nil {
		t.Fatal(err)
	}
	for _, reservation := range d.WorkspaceReservations.Resources {
		want := reservedWorkspacePath(reservation.WorkspaceID, reservation.Isolation, "common")
		found := false
		for _, path := range paths {
			found = found || path == want
		}
		if !found {
			t.Fatal("resource lost inherited allocation", want)
		}
	}
	op.Workspace.Isolation = first.Isolation
	if err = validateWorkspaceIsolation(d, op); err != nil {
		t.Fatal(err)
	}
	op.Workspace.Isolation = second.Isolation
	if validateWorkspaceIsolation(d, op) == nil {
		t.Fatal("sibling resource allocation accepted")
	}
}
