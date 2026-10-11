package host

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func serialTransferFixture(t *testing.T) (workspaceRecord, protocol.Operation, Manifest, operationRecord) {
	t.Helper()
	r, op, m, proof := transferFixture(t)
	r.PrivateCheckpoint = nil
	tr := op.Workspace.Transfer
	tr.Purpose = ptr(protocol.Serial)
	tr.PublicationID, tr.ProposalID = nil, nil
	tr.ToPlanID = tr.FromPlanID
	tr.Kind = "completed"
	tr.Metadata = r.Metadata
	tr.SettleOperationID = "complete"
	tr.CompletionOperationID = ptr("complete")
	tr.CompletionManifestDigest = ptr(strings.Repeat("e", 64))
	tr.FinalizedTree = ptr(strings.Repeat("f", 40))
	m.Dispatch.TaskID, m.Dispatch.RunnerID = ptr(tr.TaskID), tr.RunnerID
	proof.Operation.OperationID = "complete"
	proof.Operation.Kind = protocol.KindCompleteNode
	proof.Operation.CompletionManifestDigest = tr.CompletionManifestDigest
	aggregateCompletionProof(t, &proof, r.Metadata, r.Metadata.FinalizedCommit, *tr.FinalizedTree)
	_, hash, _ := wire.Canonical(op.Workspace)
	op.WorkspaceDigest = &hash
	return r, op, m, proof
}

func TestSerialTransferRequiresReleasedExactSamePlanCompletion(t *testing.T) {
	for name, edit := range map[string]func(*workspaceRecord, *protocol.Operation, *Manifest, *operationRecord){
		"live lease": func(r *workspaceRecord, _ *protocol.Operation, _ *Manifest, _ *operationRecord) { r.Released = false },
		"cross Plan": func(_ *workspaceRecord, op *protocol.Operation, _ *Manifest, _ *operationRecord) {
			op.Workspace.Transfer.ToPlanID = "new-plan"
		},
		"Replan provenance": func(_ *workspaceRecord, op *protocol.Operation, _ *Manifest, _ *operationRecord) {
			op.Workspace.Transfer.PublicationID = ptr("publication")
		},
		"checkpoint": func(_ *workspaceRecord, op *protocol.Operation, _ *Manifest, _ *operationRecord) {
			op.Workspace.Transfer.Kind = "checkpoint"
		},
		"source Plan": func(_ *workspaceRecord, _ *protocol.Operation, m *Manifest, _ *operationRecord) {
			m.Dispatch.NodeExecutionSource.PlanID = "other"
		},
		"source Task": func(_ *workspaceRecord, _ *protocol.Operation, m *Manifest, _ *operationRecord) {
			m.Dispatch.TaskID = ptr("other")
		},
		"source Runner": func(_ *workspaceRecord, _ *protocol.Operation, m *Manifest, _ *operationRecord) {
			m.Dispatch.RunnerID = "other"
		},
		"unsettled effect": func(_ *workspaceRecord, _ *protocol.Operation, _ *Manifest, p *operationRecord) { p.Settled = false },
		"live worker": func(_ *workspaceRecord, _ *protocol.Operation, _ *Manifest, p *operationRecord) {
			p.Status.Populated = true
		},
		"writer absence": func(_ *workspaceRecord, _ *protocol.Operation, _ *Manifest, p *operationRecord) {
			p.Status.Result.WriterAbsent = ptr(false)
		},
		"wrong manifest": func(_ *workspaceRecord, _ *protocol.Operation, _ *Manifest, p *operationRecord) {
			p.Operation.CompletionManifestDigest = ptr(strings.Repeat("a", 64))
		},
		"wrong tree": func(_ *workspaceRecord, _ *protocol.Operation, _ *Manifest, p *operationRecord) {
			p.Status.Result.GitTree = ptr(strings.Repeat("a", 40))
		},
		"missing metadata": func(_ *workspaceRecord, _ *protocol.Operation, _ *Manifest, p *operationRecord) {
			p.Status.Result.WorkspaceResults[0].WorkspaceMetadata.LeaseID = "foreign"
		},
		"wrong workspace": func(_ *workspaceRecord, _ *protocol.Operation, _ *Manifest, p *operationRecord) {
			p.Status.Result.WorkspaceID = ptr("other")
		},
	} {
		t.Run(name, func(t *testing.T) {
			r, op, m, proof := serialTransferFixture(t)
			if err := validateWorkspaceTransferProof(r, op, m, proof, nil); err != nil {
				t.Fatal(err)
			}
			edit(&r, &op, &m, &proof)
			if validateWorkspaceTransferProof(r, op, m, proof, nil) == nil {
				t.Fatal("invalid serial predecessor accepted")
			}
		})
	}
}

func TestSerialTransferPreservesFinalizedGitAndExactLeaseReplay(t *testing.T) {
	for _, sameNode := range []bool{false, true} {
		t.Run(map[bool]string{false: "next Node", true: "reworked activation"}[sameNode], func(t *testing.T) {
			workspace, base := fixtureRepository(t)
			common := filepath.Join(workspace, ".git")
			if err := os.WriteFile(filepath.Join(workspace, "file"), []byte("completed upstream code"), 0600); err != nil {
				t.Fatal(err)
			}
			result, err := finalize(workspace, common, "complete", base)
			if err != nil {
				t.Fatal(err)
			}
			r, op, m, proof := serialTransferFixture(t)
			r.Metadata.BaseCommit, r.Metadata.FinalizedCommit = base, *result.GitCommit
			tr := op.Workspace.Transfer
			tr.Metadata, tr.FinalizedTree = r.Metadata, result.GitTree
			op.Workspace.Basis.BaseCommit, op.Workspace.Basis.FinalizedCommit = base, *result.GitCommit
			if sameNode {
				op.Workspace.NodeID, tr.ToNodeID = tr.FromNodeID, tr.FromNodeID
				op.Workspace.NodeActivation, tr.ToNodeActivation = tr.FromNodeActivation+1, tr.FromNodeActivation+1
			}
			result.WriterAbsent, result.WorkspaceID, result.WorkspaceMetadata = ptr(true), ptr(tr.WorkspaceID), &tr.Metadata
			aggregateCompletionProof(t, &proof, r.Metadata, *result.GitCommit, *result.GitTree)
			_, hash, _ := wire.Canonical(op.Workspace)
			op.WorkspaceDigest = &hash
			if err = validateWorkspaceTransferProof(r, op, m, proof, nil); err != nil {
				t.Fatal(err)
			}
			next, err := reuseWorkspaceRecord(r, op, "storage")
			if err != nil {
				t.Fatal(err)
			}
			replay, err := reuseWorkspaceRecord(next, op, "storage")
			if err != nil || !reflect.DeepEqual(next, replay) {
				t.Fatal("same lease replay changed ownership", err)
			}
			if err = verifyRetainedWorkspace(workspace, common, replay); err != nil {
				t.Fatal(err)
			}
			tree, err := git(workspace, "rev-parse", "HEAD^{tree}")
			data, readErr := os.ReadFile(filepath.Join(workspace, "file"))
			if err != nil || readErr != nil || tree != *result.GitTree || string(data) != "completed upstream code" {
				t.Fatal("serial transfer changed finalized code")
			}
			op.Workspace.Transfer = nil
			if _, err = reuseWorkspaceRecord(r, op, "storage"); err == nil {
				t.Fatal("changed activation adopted without proof")
			}
		})
	}
}

func TestSerialTransferTargetPlanUsesCanonicalDispatch(t *testing.T) {
	_, op, _, _ := serialTransferFixture(t)
	d, _ := canonicalWorkspace(t)
	d.AttemptID, d.DispatchID, d.NodeID = op.AttemptID, op.DispatchID, ptr(op.Workspace.NodeID)
	d.NodeExecutionSource = &protocol.NodeExecutionSource{SourceID: "source", NodeID: *d.NodeID, NodeActivation: 1, PlanID: "old-plan", SpecificationID: "spec", ContextDigest: strings.Repeat("a", 64)}
	if err := ValidateEffectScope(d, op); err != nil {
		t.Fatal(err)
	}
	d.NodeExecutionSource.PlanID = "third-plan"
	if ValidateEffectScope(d, op) == nil {
		t.Fatal("serial target adopted in another Plan")
	}
}
