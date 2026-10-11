package host

import (
	"encoding/json"
	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func transferFixture(t *testing.T) (workspaceRecord, protocol.Operation, Manifest, operationRecord) {
	t.Helper()
	r := workspaceFixtureRecord(t)
	r.PrivateCheckpoint = &protocol.WorkspaceCheckpoint{OperationID: "old-stop", HeadCommit: r.Metadata.BaseCommit, CommitID: strings.Repeat("c", 40), TreeID: strings.Repeat("d", 40)}
	_, op := canonicalWorkspace(t)
	op.OperationID = "new-open"
	op.AttemptID = "new-attempt"
	op.DispatchID = "new-dispatch"
	w := op.Workspace
	w.OpenOperationID = op.OperationID
	w.LeaseID = "new-lease"
	w.NodeID = "new-node"
	w.Basis = &protocol.WorkspaceBasis{StorageID: r.Metadata.StorageID, RepositoryIdentity: r.Metadata.RepositoryIdentity, BaseCommit: r.Metadata.BaseCommit, FinalizedCommit: r.Metadata.FinalizedCommit, TargetBranch: r.Metadata.TargetBranch}
	metadata := r.Metadata
	metadata.Checkpoint = r.PrivateCheckpoint
	old := r.Operation.Workspace
	w.Transfer = &protocol.WorkspaceTransfer{PublicationID: ptr("publication"), ProposalID: ptr("proposal"), WorkspaceID: w.WorkspaceID, TaskID: w.TaskID, ResourceID: w.ResourceID, RunnerID: w.RunnerID, FromPlanID: "old-plan", ToPlanID: "new-plan", FromNodeID: old.NodeID, FromNodeActivation: old.NodeActivation, FromAttemptID: r.Operation.AttemptID, FromLeaseID: old.LeaseID, ToNodeID: w.NodeID, ToNodeActivation: w.NodeActivation, SettleOperationID: "old-stop", Kind: "checkpoint", Metadata: metadata}
	_, digest, _ := wire.Canonical(w)
	op.WorkspaceDigest = &digest
	m := Manifest{Dispatch: protocol.Dispatch{AttemptID: r.Operation.AttemptID, DispatchID: r.Operation.DispatchID, NodeExecutionSource: &protocol.NodeExecutionSource{PlanID: "old-plan", NodeID: old.NodeID, NodeActivation: old.NodeActivation}}}
	proofOp := r.Operation
	proofOp.OperationID = "old-stop"
	proofOp.Kind = protocol.Stop
	proof := operationRecord{Operation: proofOp, Settled: true, Status: Status{Known: true, Result: &protocol.EffectResult{WriterAbsent: ptr(true), WorkspaceMetadata: &metadata}}}
	return r, op, m, proof
}
func TestTransferRejectsChangedPredecessorAndTarget(t *testing.T) {
	for name, edit := range map[string]func(*workspaceRecord, *protocol.Operation){
		"missing":           func(r *workspaceRecord, o *protocol.Operation) { o.Workspace.Transfer = nil },
		"live":              func(r *workspaceRecord, o *protocol.Operation) { r.Released = false },
		"storage":           func(r *workspaceRecord, o *protocol.Operation) { o.Workspace.Transfer.Metadata.StorageID = "other" },
		"generation":        func(r *workspaceRecord, o *protocol.Operation) { o.Workspace.Transfer.Metadata.Generation++ },
		"lease":             func(r *workspaceRecord, o *protocol.Operation) { o.Workspace.Transfer.FromLeaseID = "other" },
		"attempt":           func(r *workspaceRecord, o *protocol.Operation) { o.Workspace.Transfer.FromAttemptID = "other" },
		"old-node":          func(r *workspaceRecord, o *protocol.Operation) { o.Workspace.Transfer.FromNodeID = "other" },
		"old-activation":    func(r *workspaceRecord, o *protocol.Operation) { o.Workspace.Transfer.FromNodeActivation++ },
		"target-node":       func(r *workspaceRecord, o *protocol.Operation) { o.Workspace.NodeID = "third-node" },
		"target-activation": func(r *workspaceRecord, o *protocol.Operation) { o.Workspace.NodeActivation++ },
		"task":              func(r *workspaceRecord, o *protocol.Operation) { o.Workspace.Transfer.TaskID = "other" },
		"resource":          func(r *workspaceRecord, o *protocol.Operation) { o.Workspace.Transfer.ResourceID = "other" },
		"workspace":         func(r *workspaceRecord, o *protocol.Operation) { o.Workspace.Transfer.WorkspaceID = "other" },
		"runner":            func(r *workspaceRecord, o *protocol.Operation) { o.Workspace.Transfer.RunnerID = "other" },
		"base": func(r *workspaceRecord, o *protocol.Operation) {
			o.Workspace.Transfer.Metadata.BaseCommit = strings.Repeat("e", 40)
		},
		"head": func(r *workspaceRecord, o *protocol.Operation) {
			cp := *o.Workspace.Transfer.Metadata.Checkpoint
			cp.HeadCommit = strings.Repeat("e", 40)
			o.Workspace.Transfer.Metadata.Checkpoint = &cp
		},
		"tree": func(r *workspaceRecord, o *protocol.Operation) {
			cp := *o.Workspace.Transfer.Metadata.Checkpoint
			cp.TreeID = strings.Repeat("e", 40)
			o.Workspace.Transfer.Metadata.Checkpoint = &cp
		},
		"commit": func(r *workspaceRecord, o *protocol.Operation) {
			cp := *o.Workspace.Transfer.Metadata.Checkpoint
			cp.CommitID = strings.Repeat("e", 40)
			o.Workspace.Transfer.Metadata.Checkpoint = &cp
		},
		"settle": func(r *workspaceRecord, o *protocol.Operation) { o.Workspace.Transfer.SettleOperationID = "other" },
		"kind":   func(r *workspaceRecord, o *protocol.Operation) { o.Workspace.Transfer.Kind = "completed" },
	} {
		t.Run(name, func(t *testing.T) {
			r, op, _, _ := transferFixture(t)
			edit(&r, &op)
			if _, err := reuseWorkspaceRecord(r, op, "storage"); err == nil {
				t.Fatal("forged transfer accepted")
			}
		})
	}
	r, op, m, proof := transferFixture(t)
	if err := validateWorkspaceTransferProof(r, op, m, proof, nil); err != nil {
		t.Fatal(err)
	}
	for _, edit := range []func(*Manifest, *operationRecord){
		func(m *Manifest, p *operationRecord) { m.Dispatch.NodeExecutionSource.PlanID = "other" }, func(m *Manifest, p *operationRecord) { p.Settled = false }, func(m *Manifest, p *operationRecord) { p.Status.Populated = true }, func(m *Manifest, p *operationRecord) { p.Status.Result.WriterAbsent = ptr(false) }, func(m *Manifest, p *operationRecord) { p.Operation.OperationID = "other" }, func(m *Manifest, p *operationRecord) { p.Operation.Kind = protocol.KindCompleteNode }, func(m *Manifest, p *operationRecord) { p.Status.Result = nil },
	} {
		r, op, m, proof := transferFixture(t)
		edit(&m, &proof)
		if validateWorkspaceTransferProof(r, op, m, proof, nil) == nil {
			t.Fatal("invalid trusted settlement accepted")
		}
	}
}
func TestTransferTargetPlanCheckedAgainstCanonicalDispatch(t *testing.T) {
	_, op, _, _ := transferFixture(t)
	d, _ := canonicalWorkspace(t)
	d.AttemptID = op.AttemptID
	d.DispatchID = op.DispatchID
	d.NodeID = ptr(op.Workspace.NodeID)
	d.NodeExecutionSource = &protocol.NodeExecutionSource{SourceID: "source", NodeID: *d.NodeID, NodeActivation: 1, PlanID: "new-plan", SpecificationID: "spec", ContextDigest: strings.Repeat("a", 64)}
	if err := ValidateEffectScope(d, op); err != nil {
		t.Fatal(err)
	}
	d.NodeExecutionSource.PlanID = "third-plan"
	if ValidateEffectScope(d, op) == nil {
		t.Fatal("transfer acquired third Plan")
	}
}
func TestTransferKeepsRealGitAndNewLeaseRecovery(t *testing.T) {
	workspace, base := fixtureRepository(t)
	common := filepath.Join(workspace, ".git")
	if err := os.WriteFile(filepath.Join(workspace, "file"), []byte("staged"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := git(workspace, "add", "file"); err != nil {
		t.Fatal(err)
	}
	index, _ := git(workspace, "write-tree")
	if err := os.WriteFile(filepath.Join(workspace, "file"), []byte("unstaged"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "untracked"), []byte("private"), 0600); err != nil {
		t.Fatal(err)
	}
	cp, err := checkpoint(workspace, common, "old-stop", base)
	if err != nil {
		t.Fatal(err)
	}
	r, op, _, _ := transferFixture(t)
	r.PrivateCheckpoint = &cp
	r.Metadata.BaseCommit = base
	r.Metadata.FinalizedCommit = base
	op.Workspace.Basis.BaseCommit = base
	op.Workspace.Basis.FinalizedCommit = base
	op.Workspace.Transfer.Metadata = r.Metadata
	op.Workspace.Transfer.Metadata.Checkpoint = &cp
	_, digest, _ := wire.Canonical(op.Workspace)
	op.WorkspaceDigest = &digest
	next, err := reuseWorkspaceRecord(r, op, "storage")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(next.PrivateCheckpoint, &cp) || next.Released {
		t.Fatal("checkpoint cleared or ownership released")
	}
	// A lost open/fetch response reuses exactly the original new lease.
	raw, _ := json.Marshal(next)
	var retained workspaceRecord
	if err = json.Unmarshal(raw, &retained); err != nil {
		t.Fatal(err)
	}
	replay, err := reuseWorkspaceRecord(retained, op, "storage")
	if err != nil || !reflect.DeepEqual(next, replay) {
		t.Fatal("same lease recovery lost identity", err)
	}
	stop := op
	stop.OperationID = "new-stop"
	stop.Kind = protocol.Stop
	if err = prepareStopRecovery(&replay, stop); err != nil {
		t.Fatal(err)
	}
	if err = verifyRetainedWorkspace(workspace, common, replay); err != nil {
		t.Fatal(err)
	}
	gotIndex, _ := git(workspace, "write-tree")
	head, _ := git(workspace, "rev-parse", "HEAD")
	data, _ := os.ReadFile(filepath.Join(workspace, "file"))
	extra, _ := os.ReadFile(filepath.Join(workspace, "untracked"))
	if gotIndex != index || head != base || string(data) != "unstaged" || string(extra) != "private" {
		t.Fatal("transfer altered private Git")
	}
	newCP, err := checkpoint(workspace, common, "new-stop", base)
	if err != nil {
		t.Fatal(err)
	}
	replay.PrivateCheckpoint = &newCP
	replay.Released = true
	fresh := op
	fresh.OperationID = "retry-open"
	fresh.AttemptID = "retry-attempt"
	fresh.DispatchID = "retry-dispatch"
	w := *op.Workspace
	fresh.Workspace = &w
	w.LeaseID = "retry-lease"
	w.OpenOperationID = fresh.OperationID
	w.Transfer = nil
	_, digest, _ = wire.Canonical(w)
	fresh.WorkspaceDigest = &digest
	retried, err := reuseWorkspaceRecord(replay, fresh, "storage")
	if err != nil || !reflect.DeepEqual(retried.PrivateCheckpoint, &newCP) {
		t.Fatal("same target did not use new checkpoint", err)
	}
	w.NodeID = "third-node"
	if _, err = reuseWorkspaceRecord(replay, fresh, "storage"); err == nil {
		t.Fatal("third Node reused transfer")
	}
	w.Transfer = op.Workspace.Transfer
	if _, err = reuseWorkspaceRecord(replay, fresh, "storage"); err == nil {
		t.Fatal("stale transfer reused after new Stop")
	}
}
func TestCompletedTransferUsesFinalizedEvidence(t *testing.T) {
	r, op, m, proof := transferFixture(t)
	r.PrivateCheckpoint = nil
	tr := op.Workspace.Transfer
	tr.Kind = "completed"
	tr.Metadata.Checkpoint = nil
	tr.SettleOperationID = "complete"
	tr.CompletionOperationID = ptr("complete")
	tr.CompletionManifestDigest = ptr(strings.Repeat("e", 64))
	tr.FinalizedTree = ptr(strings.Repeat("f", 40))
	proof.Operation.OperationID = "complete"
	proof.Operation.Kind = protocol.KindCompleteNode
	proof.Operation.CompletionManifestDigest = tr.CompletionManifestDigest
	aggregateCompletionProof(t, &proof, r.Metadata, r.Metadata.FinalizedCommit, *tr.FinalizedTree)
	if err := validateWorkspaceTransferProof(r, op, m, proof, nil); err != nil {
		t.Fatal(err)
	}
	proof.Status.Result.GitTree = ptr(strings.Repeat("b", 40))
	if validateWorkspaceTransferProof(r, op, m, proof, nil) == nil {
		t.Fatal("wrong finalized tree accepted")
	}
}

func TestCompletedTransferPreservesActualFinalizedTree(t *testing.T) {
	workspace, base := fixtureRepository(t)
	common := filepath.Join(workspace, ".git")
	if err := os.WriteFile(filepath.Join(workspace, "file"), []byte("completed result"), 0600); err != nil {
		t.Fatal(err)
	}
	want, err := privateTree(workspace, common)
	if err != nil {
		t.Fatal(err)
	}
	result, err := finalize(workspace, common, "complete", base)
	if err != nil {
		t.Fatal(err)
	}
	r, op, m, proof := transferFixture(t)
	r.PrivateCheckpoint = nil
	r.Metadata.BaseCommit = base
	r.Metadata.FinalizedCommit = *result.GitCommit
	tr := op.Workspace.Transfer
	tr.Kind = "completed"
	tr.Metadata = r.Metadata
	tr.SettleOperationID = "complete"
	tr.CompletionOperationID = ptr("complete")
	tr.CompletionManifestDigest = ptr(strings.Repeat("e", 64))
	tr.FinalizedTree = result.GitTree
	op.Workspace.Basis.BaseCommit = base
	op.Workspace.Basis.FinalizedCommit = *result.GitCommit
	proof.Operation.OperationID = "complete"
	proof.Operation.Kind = protocol.KindCompleteNode
	proof.Operation.CompletionManifestDigest = tr.CompletionManifestDigest
	aggregateCompletionProof(t, &proof, r.Metadata, *result.GitCommit, *result.GitTree)
	if err = validateWorkspaceTransferProof(r, op, m, proof, nil); err != nil {
		t.Fatal(err)
	}
	next, err := reuseWorkspaceRecord(r, op, "storage")
	if err != nil {
		t.Fatal(err)
	}
	if err = verifyRetainedWorkspace(workspace, common, next); err != nil {
		t.Fatal(err)
	}
	head, _ := git(workspace, "rev-parse", "HEAD")
	tree, _ := git(workspace, "rev-parse", "HEAD^{tree}")
	if head == base || head != *result.GitCommit || tree != want || tree != *result.GitTree {
		t.Fatal("completion inheritance did not keep actual finalized tree")
	}
}

func TestTransferFromCorrectedCompletionRequiresExactCancelledPair(t *testing.T) {
	fixture := func() (workspaceRecord, protocol.Operation, Manifest, operationRecord, protocol.Operation) {
		r, op, m, proof := transferFixture(t)
		original := r.Operation
		original.Kind = protocol.KindCompleteNode
		original.OperationID = "interrupted-complete"
		original.CompletionManifestDigest = ptr(strings.Repeat("f", 64))
		original.Workspaces = []protocol.WorkspaceCompletionInput{{Workspace: *original.Workspace, WorkspaceDigest: *original.WorkspaceDigest}}
		original.Workspace, original.WorkspaceDigest, original.ResourceID = nil, nil, nil
		digest, err := wire.OperationIdentity(original)
		if err != nil {
			t.Fatal(err)
		}
		proof.Operation.Kind = protocol.SettleCompletion
		proof.Operation.Workspace, proof.Operation.WorkspaceDigest, proof.Operation.ResourceID = nil, nil, nil
		proof.Operation.CompletionOperationID = &original.OperationID
		proof.Operation.CompletionIdentityDigest = &digest
		r.PrivateCheckpoint.CompletionOperationID = &original.OperationID
		r.PrivateCheckpoint.CompletionIdentityDigest = &digest
		proof.Status.Result = &protocol.EffectResult{WriterAbsent: ptr(true), WorkspaceResults: []protocol.WorkspaceEffectResult{{ResourceID: op.Workspace.ResourceID, WorkspaceID: op.Workspace.WorkspaceID, WorkspaceMetadata: *proof.Status.Result.WorkspaceMetadata}}}
		proof.Status.CompletionSettlement = &protocol.CompletionSettlement{CompletionOperationID: original.OperationID, Disposition: protocol.DispositionCancelled, CompletionResult: protocol.CompletionOperationResult{AttemptID: original.AttemptID, OperationID: original.OperationID, CancelledByOperationID: &proof.Operation.OperationID, Result: protocol.EffectResult{WriterAbsent: ptr(true)}}}
		return r, op, m, proof, original
	}
	r, op, m, proof, original := fixture()
	if err := validateWorkspaceTransferProof(r, op, m, proof, &original); err != nil {
		t.Fatal(err)
	}
	for name, edit := range map[string]func(*operationRecord, *protocol.Operation){
		"wrong-target": func(p *operationRecord, o *protocol.Operation) { o.RequestID = "changed" },
		"wrong-canceller": func(p *operationRecord, o *protocol.Operation) {
			p.Status.CompletionSettlement.CompletionResult.CancelledByOperationID = ptr("another")
		},
		"already-finalized": func(p *operationRecord, o *protocol.Operation) {
			p.Status.CompletionSettlement.Disposition = protocol.AlreadyFinalized
		},
		"success": func(p *operationRecord, o *protocol.Operation) {
			p.Status.CompletionSettlement.CompletionResult.Success = true
		},
		"writer-live": func(p *operationRecord, o *protocol.Operation) {
			p.Status.CompletionSettlement.CompletionResult.Result.WriterAbsent = ptr(false)
		},
		"no-pair": func(p *operationRecord, o *protocol.Operation) { p.Status.CompletionSettlement = nil },
		"wrong-digest": func(p *operationRecord, o *protocol.Operation) {
			p.Operation.CompletionIdentityDigest = ptr(strings.Repeat("a", 64))
		},
		"fake-stop": func(p *operationRecord, o *protocol.Operation) { p.Operation.Kind = protocol.Stop },
	} {
		t.Run(name, func(t *testing.T) {
			r, op, m, proof, original := fixture()
			edit(&proof, &original)
			if validateWorkspaceTransferProof(r, op, m, proof, &original) == nil {
				t.Fatal("invalid corrected checkpoint admitted")
			}
		})
	}
	if validateWorkspaceTransferProof(r, op, m, proof, nil) == nil {
		t.Fatal("missing original completion accepted")
	}
}

func TestCompletedCrossNodeCannotOmitPublicationDisposition(t *testing.T) {
	r, op, _, _ := transferFixture(t)
	r.PrivateCheckpoint = nil
	op.Workspace.Transfer = nil
	if _, err := reuseWorkspaceRecord(r, op, "storage"); err == nil {
		t.Fatal("completed work crossed Nodes without disposition")
	}
}
