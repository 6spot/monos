package host

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

// Logical workspace identity is stable; writable files, administrative Git data,
// root records and worker locks belong to a single admitted allocation.
func reservedWorkspacePath(id string, isolation *protocol.WorkspaceIsolation, name string) string {
	if isolation == nil {
		return TaskWorkspacePath(id, name)
	}
	return TaskWorkspacePath(id, filepath.Join("allocations", isolation.AllocationID, name))
}

func validateCanonicalWorkspaceSource(op protocol.Operation) error {
	w := op.Workspace
	if w.Isolation == nil {
		return nil
	}
	if w.Basis != nil {
		if w.CanonicalSource == nil {
			return fmt.Errorf("storage_unavailable: canonical workspace proof missing")
		}
		if err := validateWorkspaceSource(op, *w.CanonicalSource, false); err != nil {
			return err
		}
	}
	if w.ConflictSource != nil {
		return validateWorkspaceSource(op, *w.ConflictSource, true)
	}
	return nil
}

func validateWorkspaceSource(op protocol.Operation, source protocol.WorkspaceCanonicalSource, conflict bool) error {
	prior, err := readOperation(operationPath(source.OperationID))
	if err != nil && !(os.IsNotExist(err) && source.RecoveryOperationID != nil) {
		return err
	}
	m, err := readManifest(source.AttemptID)
	if err != nil {
		return err
	}
	if source.RecoveryOperationID != nil {
		recovery, err := readOperation(operationPath(*source.RecoveryOperationID))
		if err != nil {
			return err
		}
		return validateRecoveredWorkspaceSource(op, source, prior, recovery, m, conflict)
	}
	return validateWorkspaceSourceProof(op, source, prior, m, conflict)
}

func validateWorkspaceSourceProof(op protocol.Operation, source protocol.WorkspaceCanonicalSource, prior operationRecord, m Manifest, conflict bool) error {
	if prior.Operation.OperationID != source.OperationID || string(prior.Operation.Kind) != source.Kind || !prior.Settled || !prior.Status.Known || prior.Status.Error != "" || prior.Status.Result == nil {
		return fmt.Errorf("storage_unavailable: retained canonical operation differs")
	}
	return validateWorkspaceSourceFacts(op, source, prior.Operation, prior.Status, *prior.Status.Result, m, conflict)
}

func validateRecoveredWorkspaceSource(op protocol.Operation, source protocol.WorkspaceCanonicalSource, original, recovery operationRecord, m Manifest, conflict bool) error {
	stop, status := recovery.Operation, recovery.Status
	prior := status.PriorOperationResult
	if conflict || source.RecoveryOperationID == nil || source.Kind != string(protocol.KindOpenWorkspace) || source.Integration != nil || stop.OperationID != *source.RecoveryOperationID || stop.Kind != protocol.Stop || stop.AttemptID != source.AttemptID || stop.Workspace == nil || stop.Workspace.OpenOperationID != source.OperationID || stop.Workspace.LeaseID != source.Metadata.LeaseID || !recovery.Settled || !status.Known || status.Populated || status.Error != "" || status.Result == nil || status.Result.WriterAbsent == nil || !*status.Result.WriterAbsent || prior == nil || !prior.Success || prior.CancelledByOperationID != nil || prior.OperationID != source.OperationID || prior.AttemptID != source.AttemptID {
		return fmt.Errorf("storage_unavailable: recovered open lacks exact settled Stop pair")
	}
	if original.Operation.OperationID != "" {
		if original.Operation.OperationID != source.OperationID || original.Operation.Kind != protocol.KindOpenWorkspace || original.Operation.AttemptID != source.AttemptID || original.Operation.DispatchID != stop.DispatchID || !sameWorkspaceOperation(original.Operation, stop) {
			return fmt.Errorf("storage_unavailable: recovered open attribution differs")
		}
		if original.Settled && original.Status.Error == "" && original.Status.Result != nil && original.Status.Result.Path != nil && !reflect.DeepEqual(*original.Status.Result, prior.Result) {
			return fmt.Errorf("storage_unavailable: recovered pair replaced an existing ready result")
		}
	}
	return validateWorkspaceSourceFacts(op, source, stop, status, prior.Result, m, false)
}

func validateWorkspaceSourceFacts(op protocol.Operation, source protocol.WorkspaceCanonicalSource, scope protocol.Operation, status Status, result protocol.EffectResult, m Manifest, conflict bool) error {
	w, old := op.Workspace, scope.Workspace
	if old == nil || scope.AttemptID != source.AttemptID || result.WorkspaceID == nil || *result.WorkspaceID != w.WorkspaceID || result.WorkspaceMetadata == nil || !reflect.DeepEqual(*result.WorkspaceMetadata, source.Metadata) || !reflect.DeepEqual(result.Integration, source.Integration) {
		return fmt.Errorf("storage_unavailable: retained canonical source differs")
	}
	if old.TaskID != w.TaskID || old.ResourceID != w.ResourceID || old.WorkspaceID != w.WorkspaceID || old.RunnerID != w.RunnerID || old.ProjectID != w.ProjectID || old.Generation != w.Generation || !reflect.DeepEqual(old.Resource, w.Resource) || m.Dispatch.AttemptID != source.AttemptID || m.Dispatch.DispatchID != scope.DispatchID || m.Dispatch.TaskID == nil || *m.Dispatch.TaskID != w.TaskID || m.Dispatch.RunnerID != w.RunnerID || m.Dispatch.NodeID == nil || *m.Dispatch.NodeID != old.NodeID || m.Dispatch.NodeActivation != old.NodeActivation {
		return fmt.Errorf("storage_unavailable: canonical source ownership differs")
	}
	if source.Kind == string(protocol.KindCompleteNode) {
		if err := wire.ValidateWorkspaceIntegration(scope, result); err != nil {
			return err
		}
	}
	if conflict {
		if source.Kind != string(protocol.KindCompleteNode) || source.Integration == nil || string(source.Integration.Outcome) != "conflict" || old.NodeID != w.NodeID || old.NodeActivation != w.NodeActivation || old.Isolation == nil || old.Isolation.AllocationID == w.Isolation.AllocationID || status.Populated || result.WriterAbsent == nil || !*result.WriterAbsent {
			return fmt.Errorf("storage_unavailable: conflict retry requires a fresh allocation for the same Node activation")
		}
		return nil
	}
	b := w.Basis
	if b == nil || b.StorageID != source.Metadata.StorageID || b.BaseCommit != source.Metadata.BaseCommit || b.FinalizedCommit != source.Metadata.FinalizedCommit || b.RepositoryIdentity != source.Metadata.RepositoryIdentity || b.TargetBranch != source.Metadata.TargetBranch || !reflect.DeepEqual(b.ProviderMetadata, source.Metadata.ProviderMetadata) {
		return fmt.Errorf("storage_unavailable: canonical source does not establish the frozen basis")
	}
	if source.Kind == string(protocol.KindCompleteNode) {
		if result.GitCommit == nil || *result.GitCommit != b.FinalizedCommit || result.GitTree == nil || status.Populated || result.WriterAbsent == nil || !*result.WriterAbsent || source.Integration != nil && string(source.Integration.Outcome) != "integrated" {
			return fmt.Errorf("storage_unavailable: canonical completion proof incomplete")
		}
	} else if source.Kind != string(protocol.KindOpenWorkspace) || source.Integration != nil || result.Path == nil || *result.Path != WorkspacePath(old, "worktree") {
		return fmt.Errorf("storage_unavailable: invalid canonical source kind")
	}
	return nil
}

// Fetch runs under the service account's resource lock. Pin the exact admitted
// Task result into that cache so a new private clone never reads mutable siblings.
func seedIsolatedWorkspace(cache string, op protocol.Operation, metadata *protocol.WorkspaceMetadata, previous protocol.WorkspaceMetadata) error {
	w := op.Workspace
	if w.Isolation == nil {
		return nil
	}
	if err := validateCanonicalWorkspaceSource(op); err != nil {
		return err
	}
	start := metadata.FinalizedCommit
	if previous.Isolation != nil {
		if previous.Isolation.AllocationID != w.Isolation.AllocationID || !objectID.MatchString(previous.Isolation.StartCommit) {
			return fmt.Errorf("storage_unavailable: retained allocation start changed")
		}
		start = previous.Isolation.StartCommit
		metadata.FinalizedCommit = previous.FinalizedCommit
	}
	metadata.Isolation = &protocol.WorkspaceIsolationMetadata{AllocationID: w.Isolation.AllocationID, StartCommit: start}
	if source := w.CanonicalSource; source != nil && source.Kind == string(protocol.KindCompleteNode) {
		repository := filepath.Join(Root, "results", source.OperationID)
		if err := verifyProtectedWorkspaceResult(repository, source.Metadata.FinalizedCommit, ""); err != nil {
			return err
		}
		if _, err := gitScoped(cache, []string{repository}, nil, "fetch", "--no-tags", "--no-write-fetch-head", repository, source.Metadata.FinalizedCommit); err != nil {
			return err
		}
	}
	if _, err := gitScoped(cache, nil, nil, "cat-file", "-e", start+"^{commit}"); err != nil {
		return fmt.Errorf("storage_unavailable: protected allocation start unavailable: %w", err)
	}
	if _, err := gitScoped(cache, nil, nil, "update-ref", "refs/monos/pins/"+op.OperationID+"/finalized", start); err != nil {
		return err
	}
	if source := w.ConflictSource; source != nil {
		value := source.Integration
		repository := privateNodeResultPath(source.OperationID)
		if err := verifyProtectedWorkspaceResult(repository, value.NodeCommit, value.NodeTree); err != nil {
			return err
		}
		_, err := gitScoped(cache, []string{repository}, nil, "fetch", "--no-tags", "--no-write-fetch-head", repository, value.NodeCommit+":refs/monos/conflicts/"+source.OperationID)
		return err
	}
	return nil
}

func verifyProtectedWorkspaceResult(repository, commit, tree string) error {
	if err := serviceDirectory(repository, true); err != nil {
		return err
	}
	if err := serviceDirectory(filepath.Dir(repository), true); err != nil {
		return err
	}
	if _, err := os.Lstat(filepath.Join(repository, "objects", "info", "alternates")); !os.IsNotExist(err) {
		return fmt.Errorf("storage_unavailable: protected export has alternate object storage")
	}
	actual, err := gitScoped(repository, nil, nil, "rev-parse", "refs/monos/result")
	if err != nil || actual != commit {
		return fmt.Errorf("storage_unavailable: protected result ref changed")
	}
	actual, err = gitScoped(repository, nil, nil, "rev-parse", commit+"^{tree}")
	if err != nil || tree != "" && actual != tree {
		return fmt.Errorf("storage_unavailable: protected result tree changed")
	}
	return nil
}

func WorkspacePath(w *protocol.WorkspaceDescriptor, name string) string {
	return reservedWorkspacePath(w.WorkspaceID, w.Isolation, name)
}

func workspaceAllocationKey(id string, isolation *protocol.WorkspaceIsolation) string {
	if isolation == nil {
		return id
	}
	return id + "-allocation-" + isolation.AllocationID
}

func workspaceAllocationRecordPath(w *protocol.WorkspaceDescriptor) string {
	return workspaceRecordPath(workspaceAllocationKey(w.WorkspaceID, w.Isolation))
}

func readWorkspaceAllocation(w *protocol.WorkspaceDescriptor) (workspaceRecord, error) {
	return readWorkspaceReservation(w.WorkspaceID, w.Isolation)
}

func readWorkspaceReservation(id string, isolation *protocol.WorkspaceIsolation) (workspaceRecord, error) {
	r, err := readWorkspaceRecordAt(workspaceRecordPath(workspaceAllocationKey(id, isolation)), id, 0)
	if err == nil && !reflect.DeepEqual(r.Operation.Workspace.Isolation, isolation) {
		err = fmt.Errorf("storage_unavailable: workspace allocation identity changed")
	}
	if err == nil && (isolation == nil && r.Metadata.Isolation != nil || isolation != nil && r.Metadata.BaseCommit != "" && (r.Metadata.Isolation == nil || r.Metadata.Isolation.AllocationID != isolation.AllocationID || !objectID.MatchString(r.Metadata.Isolation.StartCommit))) {
		err = fmt.Errorf("storage_unavailable: retained workspace allocation metadata changed")
	}
	return r, err
}

func validateWorkspaceIsolation(d protocol.Dispatch, op protocol.Operation) error {
	w := op.Workspace
	if !reflect.DeepEqual(d.WorkspaceReservations.Isolation, w.Isolation) {
		return fmt.Errorf("workspace allocation was not reserved by this Attempt")
	}
	if w.Isolation == nil {
		if op.Integration != nil || w.CanonicalSource != nil || w.ConflictSource != nil {
			return fmt.Errorf("direct workspace cannot claim isolated sources or integration")
		}
		return nil
	}
	if !ValidID(w.Isolation.AllocationID) {
		return fmt.Errorf("invalid workspace allocation identity")
	}
	if op.Integration != nil && (op.Kind != protocol.KindCompleteNode || !objectID.MatchString(op.Integration.ExpectedTaskCommit)) {
		return fmt.Errorf("invalid isolated completion integration")
	}
	if op.Kind == protocol.KindCompleteNode && op.Integration == nil {
		return fmt.Errorf("isolated completion requires frozen Task revision")
	}
	if w.Basis != nil && w.CanonicalSource == nil {
		return fmt.Errorf("isolated workspace requires protected canonical source")
	}
	if t := w.Transfer; t != nil && t.Kind == "checkpoint" {
		if t.Metadata.Isolation == nil || t.Metadata.Isolation.AllocationID != w.Isolation.AllocationID {
			return fmt.Errorf("checkpoint transfer must retain its private allocation")
		}
	}
	return nil
}
