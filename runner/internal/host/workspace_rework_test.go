package host

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func reworkTransferFixture(t *testing.T) (workspaceRecord, protocol.Operation, Manifest, operationRecord) {
	t.Helper()
	r, op, m, proof := transferFixture(t)
	tr := op.Workspace.Transfer
	tr.Purpose, tr.PublicationID, tr.ProposalID = ptr(protocol.PurposeRework), nil, nil
	tr.ToPlanID = tr.FromPlanID
	tr.ToNodeActivation, op.Workspace.NodeActivation = 2, 2
	tr.ReworkRequestID, tr.ReworkCommandRequestID = ptr("rework-request"), ptr("agent-request")
	tr.ReworkActivations = []protocol.NodeReworkActivation{{NodeID: tr.FromNodeID, FromActivation: 1, ToActivation: 2}, {NodeID: tr.ToNodeID, FromActivation: 1, ToActivation: 2}}
	m.Dispatch.TaskID, m.Dispatch.RunnerID = ptr(tr.TaskID), tr.RunnerID
	proof.Operation.RequestID = *tr.ReworkCommandRequestID
	proof.Status.Result.WorkspaceID = ptr(tr.WorkspaceID)
	op.Workspace.ReworkHistory = []protocol.WorkspaceReworkHistory{{ReworkRequestID: *tr.ReworkRequestID, ReworkCommandRequestID: *tr.ReworkCommandRequestID,
		PlanID: tr.FromPlanID, FromNodeID: tr.FromNodeID, FromNodeActivation: tr.FromNodeActivation, FromAttemptID: tr.FromAttemptID,
		FromLeaseID: tr.FromLeaseID, SettleOperationID: tr.SettleOperationID, Metadata: tr.Metadata, ReworkActivations: tr.ReworkActivations}}
	_, hash, _ := wire.Canonical(op.Workspace)
	op.WorkspaceDigest = &hash
	return r, op, m, proof
}

func TestReworkTransferRequiresExactRequesterStopAndAppliedMap(t *testing.T) {
	for name, edit := range map[string]func(*protocol.Operation, *operationRecord){
		"command":    func(_ *protocol.Operation, p *operationRecord) { p.Operation.RequestID = "other" },
		"not Stop":   func(_ *protocol.Operation, p *operationRecord) { p.Operation.Kind = protocol.KindCompleteNode },
		"unsettled":  func(_ *protocol.Operation, p *operationRecord) { p.Settled = false },
		"wrong Plan": func(o *protocol.Operation, _ *operationRecord) { o.Workspace.Transfer.ToPlanID = "other" },
		"target activation": func(o *protocol.Operation, _ *operationRecord) {
			o.Workspace.Transfer.ReworkActivations[1].ToActivation = 3
		},
		"requester omitted": func(o *protocol.Operation, _ *operationRecord) {
			o.Workspace.Transfer.ReworkActivations = o.Workspace.Transfer.ReworkActivations[1:]
		},
	} {
		t.Run(name, func(t *testing.T) {
			r, op, m, proof := reworkTransferFixture(t)
			if err := validateWorkspaceTransferProof(r, op, m, proof, nil); err != nil {
				t.Fatal(err)
			}
			if err := validateWorkspaceHistory(op.Workspace, op.Workspace.Transfer.ToPlanID); err != nil {
				t.Fatal(err)
			}
			edit(&op, &proof)
			if validateWorkspaceTransferProof(r, op, m, proof, nil) == nil {
				t.Fatal("forged Rework accepted")
			}
		})
	}
	_, op, _, _ := reworkTransferFixture(t)
	op.Workspace.ReworkHistory = nil
	if validateWorkspaceHistory(op.Workspace, op.Workspace.Transfer.ToPlanID) == nil {
		t.Fatal("Rework omitted durable history")
	}
}

func TestReworkArchiveRebuildPreservesRawWorkAndRecoversEveryBoundary(t *testing.T) {
	for _, failure := range []string{"export", "archive-intent", "archived", "rebuilt", "ready"} {
		t.Run(failure, func(t *testing.T) {
			cache, base := fixtureRepository(t)
			task := t.TempDir()
			common, workspace := filepath.Join(task, "common"), filepath.Join(task, "worktree")
			if _, err := git(task, "clone", "--bare", "--no-local", cache, common); err != nil {
				t.Fatal(err)
			}
			if _, err := git(common, "worktree", "add", "--detach", workspace, base); err != nil {
				t.Fatal(err)
			}
			write := func(name, value string) {
				t.Helper()
				if err := os.WriteFile(filepath.Join(workspace, name), []byte(value), 0600); err != nil {
					t.Fatal(err)
				}
			}
			write("file", "requester committed code")
			if _, err := git(workspace, "commit", "-am", "private requester commit"); err != nil {
				t.Fatal(err)
			}
			write("file", "requester staged version")
			if _, err := git(workspace, "add", "file"); err != nil {
				t.Fatal(err)
			}
			index, err := os.ReadFile(filepath.Join(common, "worktrees", "worktree", "index"))
			if err != nil {
				t.Fatal(err)
			}
			write("file", "requester unstaged version")
			write("untracked", "keep untracked")
			write(".gitignore", "ignored\n")
			write("ignored", "keep ignored bytes")
			cp, err := checkpoint(workspace, common, "old-stop", base)
			if err != nil {
				t.Fatal(err)
			}
			export := filepath.Join(t.TempDir(), "export")
			if err = os.Mkdir(export, 0700); err != nil {
				t.Fatal(err)
			}
			if _, err = gitScoped(export, nil, nil, exportCloneArgs(workspace, common, export)...); err != nil {
				t.Fatal(err)
			}
			if _, err = gitScoped(export, nil, nil, exportFetchArgs(workspace, common, "refs/monos/checkpoints/old-stop")...); err != nil {
				t.Fatal(err)
			}
			old, op, _, _ := reworkTransferFixture(t)
			old.Metadata.BaseCommit, old.Metadata.FinalizedCommit, old.Metadata.TargetCommit = base, base, base
			old.PrivateCheckpoint = &cp
			op.Workspace.Basis.BaseCommit, op.Workspace.Basis.FinalizedCommit = base, base
			op.Workspace.Transfer.Metadata = old.Metadata
			op.Workspace.Transfer.Metadata.Checkpoint = &cp
			op.Workspace.ReworkHistory[0].Metadata = op.Workspace.Transfer.Metadata
			_, hash, _ := wire.Canonical(op.Workspace)
			op.WorkspaceDigest = &hash
			r, err := reuseWorkspaceRecord(old, op, "storage")
			if err != nil {
				t.Fatal(err)
			}
			record := filepath.Join(task, "record.json")
			if err = saveRecord(record, r); err != nil {
				t.Fatal(err)
			}
			failed := false
			injected := errors.New("injected Rework interruption")
			save := func() error {
				if !failed && (failure == "archive-intent" && r.Stage == "rework_archiving" || failure == "archived" && r.Stage == "rework_archived" || failure == "ready" && r.Stage == "refresh_intent") {
					failed = true
					return injected
				}
				return saveRecord(record, r)
			}
			run := func(action string) (Status, error) {
				if action == "history" {
					if !failed && failure == "export" {
						failed = true
						return Status{}, injected
					}
					return Status{}, seedCheckpointExport(cache, export, op.Workspace.ReworkHistory[0])
				}
				if action != "rework_rebuild" {
					t.Fatal("unexpected action", action)
				}
				if err := rebuildReworkWorkspace(workspace, common, cache, r.Metadata, op.Workspace.ReworkHistory); err != nil {
					return Status{}, err
				}
				if !failed && failure == "rebuilt" {
					failed = true
					return Status{}, injected
				}
				return Status{Known: true, Result: &protocol.EffectResult{WorkspaceID: ptr(op.Workspace.WorkspaceID), Path: &workspace}}, nil
			}
			archive := func() error {
				return archiveWorkspaceAllocationAt(task, "rework-request", old.Metadata.LeaseID, uint32(os.Geteuid()))
			}
			prepare := func() error {
				for _, p := range []string{common, workspace} {
					if err := os.Mkdir(p, 0750); err != nil && !os.IsExist(err) {
						return err
					}
				}
				return nil
			}
			if err = resumeWorkspaceReworkUsing(&r, op, save, run, archive, prepare); !errors.Is(err, injected) {
				t.Fatal("failure boundary not exercised", err)
			}
			r, err = readWorkspaceRecordAt(record, op.Workspace.WorkspaceID, uint32(os.Geteuid()))
			if err != nil {
				t.Fatal(err)
			}
			// Stop must be able to finish the same offline rebuild after its open
			// is fenced, then retain the old verified target observation.
			stop := op
			stop.Kind = protocol.Stop
			stop.OperationID = "stop-new-open"
			if err = resumeWorkspaceReworkUsing(&r, stop, save, run, archive, prepare); err != nil {
				t.Fatal(err)
			}
			if err = prepareStopRecovery(&r, stop); err != nil {
				t.Fatal(err)
			}
			if err = verifyRetainedWorkspace(workspace, common, r); err != nil {
				t.Fatal(err)
			}
			archivePath := filepath.Join(task, "rework-archives", "rework-request")
			for name, want := range map[string]string{"file": "requester unstaged version", "untracked": "keep untracked", "ignored": "keep ignored bytes"} {
				got, err := os.ReadFile(filepath.Join(archivePath, "worktree", name))
				if err != nil || string(got) != want {
					t.Fatal("archive lost bytes", name, err)
				}
				if name != "file" {
					if _, err = os.Stat(filepath.Join(workspace, name)); !os.IsNotExist(err) {
						t.Fatal("stale private file replayed", name)
					}
				}
			}
			archivedIndex, err := os.ReadFile(filepath.Join(archivePath, "common", "worktrees", "worktree", "index"))
			if err != nil || !bytes.Equal(index, archivedIndex) {
				t.Fatal("archive changed original index", err)
			}
			if head, err := git(workspace, "rev-parse", "HEAD"); err != nil || head != base {
				t.Fatal("Rework did not start at finalized base", err)
			}
			if content, err := git(workspace, "show", cp.CommitID+":file"); err != nil || content != "requester unstaged version" {
				t.Fatal("historical content not inspectable", err)
			}
			write("file", "corrected upstream code")
			completed, err := finalize(workspace, common, "upstream-corrected", base)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = git(common, "update-ref", "-d", historyRef(op.Workspace.ReworkHistory[0])); err != nil {
				t.Fatal(err)
			}
			if _, err = git(cache, "update-ref", "-d", historyRef(op.Workspace.ReworkHistory[0])); err != nil {
				t.Fatal(err)
			}
			if err = seedCheckpointExport(cache, export, op.Workspace.ReworkHistory[0]); err != nil {
				t.Fatal(err)
			}
			if err = copyWorkspaceHistory(common, cache, op.Workspace.ReworkHistory); err != nil {
				t.Fatal(err)
			}
			if head, err := git(workspace, "rev-parse", "HEAD"); err != nil || head != *completed.GitCommit {
				t.Fatal("later historical import changed upstream HEAD", err)
			}
			if got, err := os.ReadFile(filepath.Join(workspace, "file")); err != nil || string(got) != "corrected upstream code" {
				t.Fatal("historical import replayed stale requester code", err)
			}
			before := r
			if err = resumeWorkspaceReworkUsing(&r, op, save, run, archive, prepare); err != nil || !reflect.DeepEqual(before, r) {
				t.Fatal("finished stage replayed archive", err)
			}
		})
	}
}

func TestReworkArchiveRecoversEachRenameAndRejectsCollisions(t *testing.T) {
	for _, moved := range []string{"common", "worktree"} {
		t.Run(moved, func(t *testing.T) {
			base := t.TempDir()
			archive := filepath.Join(base, "rework-archives", "request")
			if err := os.MkdirAll(archive, 0700); err != nil {
				t.Fatal(err)
			}
			if err := saveRecord(filepath.Join(archive, "identity.json"), map[string]string{"request_id": "request", "lease_id": "lease"}); err != nil {
				t.Fatal(err)
			}
			for _, name := range []string{"common", "worktree"} {
				p := filepath.Join(base, name)
				if name == moved {
					p = filepath.Join(archive, name)
				}
				if err := os.Mkdir(p, 0750); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(p, "bytes"), []byte(name), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if err := archiveWorkspaceAllocationAt(base, "request", "lease", uint32(os.Geteuid())); err != nil {
				t.Fatal(err)
			}
			if err := os.Mkdir(filepath.Join(base, "common"), 0750); err != nil {
				t.Fatal(err)
			}
			if archiveWorkspaceAllocationAt(base, "request", "lease", uint32(os.Geteuid())) == nil {
				t.Fatal("replacement allocation overwritten")
			}
		})
	}
}
