package host

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func reworkMetadata(h protocol.WorkspaceReworkHistory) protocol.WorkspaceMetadata {
	return h.Metadata
}

func validateReworkActivations(changes []protocol.NodeReworkActivation, from string, activation int64, target string, next int64) error {
	seen := map[string]bool{}
	requester, destination := false, false
	if len(changes) == 0 || len(changes) > 256 {
		return fmt.Errorf("invalid Rework activation map")
	}
	for _, change := range changes {
		if !ValidID(change.NodeID) || seen[change.NodeID] || change.FromActivation < 1 || change.ToActivation != change.FromActivation+1 {
			return fmt.Errorf("invalid Rework activation transition")
		}
		seen[change.NodeID] = true
		requester = requester || change.NodeID == from && change.FromActivation == activation
		destination = destination || change.NodeID == target && change.ToActivation == next
	}
	if !requester || !destination {
		return fmt.Errorf("Rework requester or target activation differs")
	}
	return nil
}

func historyTransfer(w *protocol.WorkspaceDescriptor, h protocol.WorkspaceReworkHistory) protocol.WorkspaceTransfer {
	return protocol.WorkspaceTransfer{Purpose: ptr(protocol.PurposeRework), Kind: "checkpoint",
		WorkspaceID: w.WorkspaceID, TaskID: w.TaskID, ResourceID: w.ResourceID, RunnerID: w.RunnerID,
		FromPlanID: h.PlanID, ToPlanID: h.PlanID, FromNodeID: h.FromNodeID, FromNodeActivation: h.FromNodeActivation,
		FromAttemptID: h.FromAttemptID, FromLeaseID: h.FromLeaseID, ToNodeID: w.NodeID, ToNodeActivation: w.NodeActivation,
		SettleOperationID: h.SettleOperationID, Metadata: reworkMetadata(h), ReworkRequestID: ptr(h.ReworkRequestID),
		ReworkCommandRequestID: ptr(h.ReworkCommandRequestID), ReworkActivations: h.ReworkActivations}
}

func validateWorkspaceHistory(w *protocol.WorkspaceDescriptor, plan string) error {
	seen := map[string]bool{}
	if len(w.ReworkHistory) > 64 {
		return fmt.Errorf("too many workspace histories")
	}
	for _, h := range w.ReworkHistory {
		raw, err := json.Marshal(h)
		if err != nil {
			return err
		}
		if err = wire.Validate("WorkspaceReworkHistory", raw); err != nil {
			return err
		}
		m := reworkMetadata(h)
		b := w.Basis
		if b == nil || b.StorageID != m.StorageID || b.RepositoryIdentity != m.RepositoryIdentity || b.BaseCommit != m.BaseCommit || b.TargetBranch != m.TargetBranch || !reflect.DeepEqual(b.ProviderMetadata, m.ProviderMetadata) {
			return fmt.Errorf("historical checkpoint fixed basis differs")
		}
		if seen[h.ReworkRequestID] || h.PlanID != plan || m.Generation != w.Generation || m.LeaseID != h.FromLeaseID || m.RepositoryIdentity != w.Resource.RepositoryIdentity || m.Checkpoint == nil || m.Checkpoint.OperationID != h.SettleOperationID || m.Checkpoint.CompletionOperationID != nil || m.Checkpoint.CompletionIdentityDigest != nil {
			return fmt.Errorf("historical checkpoint scope differs")
		}
		seen[h.ReworkRequestID] = true
		if err = validateReworkActivations(h.ReworkActivations, h.FromNodeID, h.FromNodeActivation, w.NodeID, w.NodeActivation); err != nil {
			return err
		}
	}
	if t := w.Transfer; t != nil && t.Purpose != nil && *t.Purpose == protocol.PurposeRework {
		found := false
		for _, h := range w.ReworkHistory {
			found = found || reflect.DeepEqual(historyTransfer(w, h), *t)
		}
		if !found {
			return fmt.Errorf("Rework transfer lacks matching historical checkpoint")
		}
	}
	return nil
}

func validateWorkspaceHistoryEvidence(op protocol.Operation) error {
	for _, h := range op.Workspace.ReworkHistory {
		m, err := readManifest(h.FromAttemptID)
		if err != nil {
			return err
		}
		proof, err := readOperation(operationPath(h.SettleOperationID))
		if err != nil {
			return err
		}
		metadata := reworkMetadata(h)
		cp := metadata.Checkpoint
		metadata.Checkpoint = nil
		previous := workspaceRecord{Operation: proof.Operation, Metadata: metadata, PrivateCheckpoint: cp, Released: true}
		copy := op
		w := *op.Workspace
		copy.Workspace = &w
		transfer := historyTransfer(&w, h)
		w.Transfer = &transfer
		if proof.Operation.Workspace == nil {
			return fmt.Errorf("historical Stop has no workspace")
		}
		if err = validateWorkspaceTransferProof(previous, copy, m, proof, nil); err != nil {
			return err
		}
	}
	return nil
}

func historyRef(h protocol.WorkspaceReworkHistory) string {
	return "refs/monos/history/" + h.ReworkRequestID
}

// Runs as the service identity: execution cannot read or mutate Root/results.
// Only exact protected exports seed the execution-readable repository cache.
func seedWorkspaceHistory(cache string, op protocol.Operation) error {
	if err := validateWorkspaceHistoryEvidence(op); err != nil {
		return err
	}
	if err := os.Mkdir(cache, 0750); err != nil && !os.IsExist(err) {
		return err
	}
	if err := serviceDirectory(cache, false); err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(cache, "HEAD")); os.IsNotExist(err) {
		if _, err = git(cache, "init", "--bare", cache); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	for _, h := range op.Workspace.ReworkHistory {
		m := reworkMetadata(h)
		dir, reason := trustedOperationExport(protocol.ResultReadIdentity{OperationID: h.SettleOperationID, StorageID: m.StorageID}, false)
		if reason != "" {
			return fmt.Errorf("storage_unavailable: protected checkpoint export %s", reason)
		}
		if err := seedCheckpointExport(cache, dir, h); err != nil {
			return err
		}
	}
	return nil
}

func seedCheckpointExport(cache, dir string, h protocol.WorkspaceReworkHistory) error {
	m := reworkMetadata(h)
	cp := m.Checkpoint
	if cp == nil {
		return fmt.Errorf("missing historical checkpoint")
	}
	commit, err := git(dir, "rev-parse", "refs/monos/result")
	if err != nil || commit != cp.CommitID {
		return fmt.Errorf("protected checkpoint commit differs")
	}
	tree, err := git(dir, "rev-parse", commit+"^{tree}")
	if err != nil || tree != cp.TreeID {
		return fmt.Errorf("protected checkpoint tree differs")
	}
	if err = requireAncestor(dir, m.FinalizedCommit, commit); err != nil {
		return err
	}
	_, err = gitScoped(cache, []string{dir}, nil, "fetch", "--no-tags", dir, commit+":"+historyRef(h))
	return err
}

func copyWorkspaceHistory(common, cache string, histories []protocol.WorkspaceReworkHistory) error {
	for _, h := range histories {
		ref := historyRef(h)
		if _, err := workspaceGit(common, cache, common, nil, "fetch", "--no-tags", cache, "+"+ref+":"+ref); err != nil {
			return err
		}
		m := reworkMetadata(h)
		commit, err := git(common, "rev-parse", ref)
		if err != nil || commit != m.Checkpoint.CommitID {
			return fmt.Errorf("historical checkpoint commit changed")
		}
		tree, err := git(common, "rev-parse", commit+"^{tree}")
		if err != nil || tree != m.Checkpoint.TreeID {
			return fmt.Errorf("historical checkpoint tree changed")
		}
	}
	return nil
}

func rebuildReworkWorkspace(workspace, common, cache string, m protocol.WorkspaceMetadata, histories []protocol.WorkspaceReworkHistory) error {
	if _, err := os.Stat(filepath.Join(common, "HEAD")); os.IsNotExist(err) {
		if _, err = workspaceGit(common, cache, common, nil, "clone", "--bare", "--no-local", cache, common); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	if _, err := os.Lstat(filepath.Join(common, "objects", "info", "alternates")); !os.IsNotExist(err) {
		return fmt.Errorf("rework clone has alternates")
	}
	origin, err := git(common, "config", "--get", "remote.origin.url")
	if err != nil || origin != cache {
		return fmt.Errorf("rework clone origin differs")
	}
	if err = copyWorkspaceHistory(common, cache, histories); err != nil {
		return err
	}
	return checkoutPinned(workspace, common, cache, m.FinalizedCommit)
}
