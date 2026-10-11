package host

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

type completionBatchFixture struct {
	record       operationRecord
	repositories []integrationFixture
	paths        []integrationWorkspacePaths
	journal      string
}

func newCompletionBatchFixture(t *testing.T, conflict bool) *completionBatchFixture {
	t.Helper()
	if os.Geteuid() == 0 {
		t.Skip("service export rejects root; run as unprivileged service identity")
	}
	_, parent, _ := completionOperations(t)
	template := parent.Workspaces[0].Workspace
	parent.Workspaces = nil
	fixture := &completionBatchFixture{record: operationRecord{Operation: parent, BootID: "boot", Completion: &completionProgress{}}, journal: filepath.Join(t.TempDir(), "parent.json")}
	for i := 0; i < 2; i++ {
		f := newIntegrationFixture(t)
		w := template
		w.ResourceID = fmt.Sprintf("resource-%d", i)
		w.Resource.ResourceID = w.ResourceID
		w.WorkspaceID, _ = TaskWorkspaceID(w.TaskID, w.ResourceID)
		w.OpenOperationID = fmt.Sprintf("open-%d", i)
		w.LeaseID = fmt.Sprintf("lease-%d", i)
		w.Isolation = &protocol.WorkspaceIsolation{AllocationID: fmt.Sprintf("allocation-%d", i)}
		_, digest, _ := wire.Canonical(w)
		input := protocol.WorkspaceCompletionInput{Workspace: w, WorkspaceDigest: digest, Integration: &protocol.WorkspaceIntegration{ExpectedTaskCommit: f.base}}
		metadata := protocol.WorkspaceMetadata{StorageID: "storage", BaseCommit: f.base, FinalizedCommit: f.base, Generation: w.Generation, LeaseID: w.LeaseID, RepositoryIdentity: w.Resource.RepositoryIdentity, TargetBranch: "master", TargetCommit: f.base, Isolation: &protocol.WorkspaceIsolationMetadata{AllocationID: w.Isolation.AllocationID, StartCommit: f.base}}
		paths := integrationWorkspacePaths{workspace: filepath.Join(f.root, "workspace"), common: filepath.Join(f.root, "common"), nodeResult: filepath.Join(f.root, "nodes", parent.OperationID, w.WorkspaceID), taskRepository: f.task, result: filepath.Join(f.root, "results", w.WorkspaceID), cache: f.seed}
		f.git(f.root, "clone", "--bare", "--no-local", f.seed, paths.common)
		f.git(paths.common, "worktree", "add", "--detach", paths.workspace, f.base)
		if err := os.WriteFile(filepath.Join(paths.workspace, "shared.txt"), []byte(fmt.Sprintf("node result %d\n", i)), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := ensureProtectedTaskRepositoryItemAt(context.Background(), &w, input.Integration, metadata, paths.taskRepository, paths.cache); err != nil {
			t.Fatal(err)
		}
		if conflict && i == 1 {
			other := f.input("preceding", map[string]string{"shared.txt": "other task result\n"})
			integrated := f.integrate(other)
			input.Integration.ExpectedTaskCommit = integrated.TaskCommit
		}
		fixture.record.Operation.Workspaces = append(fixture.record.Operation.Workspaces, input)
		fixture.record.Completion.Items = append(fixture.record.Completion.Items, completionItemProgress{WorkspaceID: w.WorkspaceID, Metadata: metadata})
		fixture.repositories = append(fixture.repositories, f)
		fixture.paths = append(fixture.paths, paths)
	}
	if err := saveRecord(fixture.journal, fixture.record); err != nil {
		t.Fatal(err)
	}
	return fixture
}

var errCompletionCrash = errors.New("injected process loss")

func (f *completionBatchFixture) advance(fault string, cancelled bool) (Status, error) {
	return advanceCompletionBatch(&f.record, func(index int, action string) (Status, error) {
		f.record.WorkspaceAction = action
		status, err := performCompletionItemAt(context.Background(), f.record, f.record.Operation.Workspaces[index], f.record.Completion.Items[index], f.paths[index])
		if err == nil && fault == fmt.Sprintf("%d:%s", index, action) {
			return status, errCompletionCrash
		}
		return status, err
	}, func() error { return saveRecord(f.journal, f.record) }, func(decision string) error {
		if cancelled {
			return fmt.Errorf("parent fenced before decision")
		}
		f.record.Completion.Decision = decision
		if err := saveRecord(f.journal, f.record); err != nil {
			return err
		}
		if fault == "decision" {
			return errCompletionCrash
		}
		return nil
	})
}

func (f *completionBatchFixture) reload(t *testing.T) {
	t.Helper()
	raw, err := os.ReadFile(f.journal)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(raw, &f.record); err != nil {
		t.Fatal(err)
	}
}

func TestCompletionBatchPreparesAllBeforePublishingAndRetainsEveryCapture(t *testing.T) {
	for _, conflict := range []bool{false, true} {
		t.Run(fmtBool(conflict), func(t *testing.T) {
			f := newCompletionBatchFixture(t, conflict)
			identity, _ := wire.OperationIdentity(f.record.Operation)
			result, err := f.advance("", false)
			if err != nil {
				t.Fatal(err)
			}
			if err = wire.ValidateCompletionResult(f.record.Operation, *result.Result); err != nil {
				t.Fatal(err)
			}
			if got, _ := wire.OperationIdentity(f.record.Operation); got != identity {
				t.Fatal("item stages changed true parent identity")
			}
			for i, item := range result.Result.WorkspaceResults {
				repo, p := f.repositories[i], f.paths[i]
				expected := f.record.Operation.Workspaces[i].Integration.ExpectedTaskCommit
				if conflict {
					if *result.Result.CompletionOutcome != "conflict" || item.GitCommit != nil || item.GitTree != nil || item.WorkspaceMetadata.FinalizedCommit != repo.base {
						t.Fatal("partial completion on conflict")
					}
					if i == 0 && item.Integration != nil {
						t.Fatal("clean unpublished sibling claimed integration")
					}
				} else {
					expected = *item.GitCommit
				}
				if repo.git(repo.task, "rev-parse", WorkspaceTaskFinalizedRef) != expected {
					t.Fatal("canonical ref differs from whole-parent decision")
				}
				if err = verifyProtectedWorkspaceResult(p.nodeResult, item.Capture.NodeCommit, item.Capture.NodeTree); err != nil {
					t.Fatal(err)
				}
				commit, tree := item.Capture.NodeCommit, item.Capture.NodeTree
				if !conflict {
					commit, tree = *item.GitCommit, *item.GitTree
				}
				if err = verifyProtectedWorkspaceResult(p.result, commit, tree); err != nil {
					t.Fatal(err)
				}
			}
			replay, err := f.advance("", false)
			if err != nil || !reflect.DeepEqual(replay.Result, result.Result) {
				t.Fatal("replay changed aggregate", err)
			}
		})
	}
}

func TestCompletionBatchRecoversEveryGitAndDecisionBoundary(t *testing.T) {
	for _, fault := range []string{"0:capture", "0:protect", "1:capture", "1:protect", "0:prepare", "1:prepare", "decision", "0:publish", "0:export", "1:publish", "1:export"} {
		t.Run(fault, func(t *testing.T) {
			f := newCompletionBatchFixture(t, false)
			if _, err := f.advance(fault, false); !errors.Is(err, errCompletionCrash) {
				t.Fatal("fault boundary not reached", err)
			}
			f.reload(t)
			if f.record.Settled {
				t.Fatal("individual worker marked parent settled")
			}
			published := f.record.Completion.Decision == "publish"
			if !published {
				for i, repo := range f.repositories {
					if repo.git(repo.task, "rev-parse", WorkspaceTaskFinalizedRef) != f.record.Operation.Workspaces[i].Integration.ExpectedTaskCommit {
						t.Fatal("preparation published a Task ref")
					}
				}
			}
			// Once the durable publish decision exists, a later cancellation cannot turn
			// a partially published parent into checkpoints, even before the first ref.
			result, err := f.advance("", published)
			if err != nil {
				t.Fatal(err)
			}
			if err = wire.ValidateCompletionResult(f.record.Operation, *result.Result); err != nil {
				t.Fatal(err)
			}
			for i, item := range result.Result.WorkspaceResults {
				if f.repositories[i].git(f.repositories[i].task, "rev-parse", WorkspaceTaskFinalizedRef) != *item.GitCommit {
					t.Fatal("recovery failed to roll every member forward")
				}
			}
		})
	}
}

func TestCompletionBatchCancellationBeforeDecisionCannotPublish(t *testing.T) {
	f := newCompletionBatchFixture(t, false)
	if _, err := f.advance("1:prepare", false); !errors.Is(err, errCompletionCrash) {
		t.Fatal(err)
	}
	f.reload(t)
	if _, err := f.advance("", true); err == nil {
		t.Fatal("fenced completion selected publish")
	}
	for i, repo := range f.repositories {
		if repo.git(repo.task, "rev-parse", WorkspaceTaskFinalizedRef) != f.record.Operation.Workspaces[i].Integration.ExpectedTaskCommit {
			t.Fatal("cancelled preparation advanced a Task")
		}
	}
}

func TestWorkspaceIntegrationEffectMissingInitializedTaskIsNotRecloned(t *testing.T) {
	f := newCompletionBatchFixture(t, false)
	input, p := f.record.Operation.Workspaces[0], f.paths[0]
	if err := os.Rename(p.taskRepository, p.taskRepository+"-lost"); err != nil {
		t.Fatal(err)
	}
	if _, err := ensureProtectedTaskRepositoryItemAt(context.Background(), &input.Workspace, input.Integration, f.record.Completion.Items[0].Metadata, p.taskRepository, p.cache); err == nil {
		t.Fatal("silently recreated lost canonical Task history")
	}
	if _, err := os.Stat(p.taskRepository); !os.IsNotExist(err) {
		t.Fatal("failed recovery changed retained storage")
	}
}

func TestCompletionConflictSourceUsesMatchingCleanSiblingCapture(t *testing.T) {
	f := newCompletionBatchFixture(t, true)
	status, err := f.advance("", false)
	if err != nil {
		t.Fatal(err)
	}
	parent := f.record.Operation
	input, item := parent.Workspaces[0], status.Result.WorkspaceResults[0]
	d, _ := canonicalWorkspace(t)
	target := protocol.Operation{AttemptID: "retry-attempt", DispatchID: "retry-dispatch", Kind: protocol.KindOpenWorkspace}
	w := input.Workspace
	w.Isolation = &protocol.WorkspaceIsolation{AllocationID: "retry-allocation"}
	target.Workspace = &w
	source := protocol.WorkspaceCanonicalSource{Kind: string(protocol.KindCompleteNode), OperationID: parent.OperationID, AttemptID: parent.AttemptID, Metadata: item.WorkspaceMetadata, Capture: item.Capture, CompletionOutcome: status.Result.CompletionOutcome}
	if item.Integration != nil {
		t.Fatal("fixture clean sibling must omit integration")
	}
	if err = validateWorkspaceSourceFacts(target, source, parent, status, *status.Result, Manifest{Dispatch: d}, true); err != nil {
		t.Fatal(err)
	}
	for _, edit := range []func(*protocol.WorkspaceCanonicalSource){func(s *protocol.WorkspaceCanonicalSource) { s.Capture = nil }, func(s *protocol.WorkspaceCanonicalSource) { s.Capture = status.Result.WorkspaceResults[1].Capture }, func(s *protocol.WorkspaceCanonicalSource) { s.CompletionOutcome = ptr("finalized") }} {
		changed := source
		edit(&changed)
		if validateWorkspaceSourceFacts(target, changed, parent, status, *status.Result, Manifest{Dispatch: d}, true) == nil {
			t.Fatal("crossed capture or parent outcome accepted")
		}
	}
}

func TestCompletionProgressRejectsChangedMembershipCaptureAndDecision(t *testing.T) {
	f := newCompletionBatchFixture(t, false)
	if _, err := f.advance("", false); err != nil {
		t.Fatal(err)
	}
	if err := validateCompletionProgress(f.record, "storage"); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(f.record)
	for _, edit := range []func(*operationRecord){
		func(r *operationRecord) { r.Completion.Items[0].WorkspaceID = r.Completion.Items[1].WorkspaceID },
		func(r *operationRecord) { r.Completion.Items[0].Capture = r.Completion.Items[1].Capture },
		func(r *operationRecord) { r.Completion.Decision = "conflict" },
		func(r *operationRecord) { r.Completion.Items[1].Prepared = nil },
		func(r *operationRecord) { r.Completion.Items[0].Metadata.StorageID = "other" },
	} {
		var changed operationRecord
		_ = json.Unmarshal(raw, &changed)
		edit(&changed)
		if validateCompletionProgress(changed, "storage") == nil {
			t.Fatal("corrupt completion progress accepted")
		}
	}
}
