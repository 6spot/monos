package host

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

type integrationFixture struct {
	t          *testing.T
	root, seed string
	task, base string
}

func newIntegrationFixture(t *testing.T) integrationFixture {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	f := integrationFixture{t: t, root: root, seed: filepath.Join(root, "seed"), task: filepath.Join(root, "task.git")}
	for _, dir := range []string{root, f.seed, f.task} {
		if err = os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		if err = os.Chmod(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	f.git(f.seed, "init")
	f.commit(f.seed, "base", map[string]string{"shared.txt": "original\n", "base.txt": "base\n"})
	f.base = f.git(f.seed, "rev-parse", "HEAD")
	f.git(root, "clone", "--bare", "--no-local", f.seed, f.task)
	f.git(f.task, "update-ref", WorkspaceTaskFinalizedRef, f.base)
	return f
}

func (f integrationFixture) git(dir string, args ...string) string {
	f.t.Helper()
	out, err := gitScoped(dir, nil, nil, args...)
	if err != nil {
		f.t.Fatalf("git %v: %v", args, err)
	}
	return out
}

func (f integrationFixture) commit(dir, message string, files map[string]string) string {
	f.t.Helper()
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0600); err != nil {
			f.t.Fatal(err)
		}
	}
	f.git(dir, "add", "--all")
	f.git(dir, "commit", "--allow-empty", "-m", message)
	return f.git(dir, "rev-parse", "HEAD")
}

func (f integrationFixture) input(operation string, files map[string]string) WorkspaceIntegrationInput {
	f.t.Helper()
	work := filepath.Join(f.root, "work-"+operation)
	export := filepath.Join(f.root, "export-"+operation)
	f.git(f.root, "clone", "--no-local", f.seed, work)
	f.git(work, "checkout", "--detach", f.base)
	commit := f.commit(work, operation, files)
	if err := os.Mkdir(export, 0700); err != nil {
		f.t.Fatal(err)
	}
	f.git(f.root, "clone", "--bare", "--no-local", work, export)
	f.git(export, "update-ref", "refs/monos/result", commit)
	return WorkspaceIntegrationInput{OperationID: operation, TaskRepository: f.task, ExpectedTaskCommit: f.git(f.task, "rev-parse", WorkspaceTaskFinalizedRef), NodeRepository: export, NodeStartCommit: f.base, NodeCommit: commit, NodeTree: f.git(export, "rev-parse", commit+"^{tree}")}
}

func (f integrationFixture) integrate(input WorkspaceIntegrationInput) WorkspaceIntegrationResult {
	f.t.Helper()
	result, err := IntegrateWorkspace(context.Background(), input)
	if err != nil {
		f.t.Fatal(err)
	}
	return result
}

func (f integrationFixture) intent(operation string) workspaceIntegrationIntent {
	f.t.Helper()
	raw, err := os.ReadFile(filepath.Join(f.task, "monos-integration-"+operation+".json"))
	if err != nil {
		f.t.Fatal(err)
	}
	var intent workspaceIntegrationIntent
	if err = json.Unmarshal(raw, &intent); err != nil {
		f.t.Fatal(err)
	}
	return intent
}

func TestWorkspaceIntegrationMergesAndReplaysPrivateResults(t *testing.T) {
	f := newIntegrationFixture(t)
	a := f.input("a", map[string]string{"a.txt": "branch A\n"})
	b := f.input("b", map[string]string{"b.txt": "branch B\n"})
	aRefs, bRefs := f.git(a.NodeRepository, "show-ref"), f.git(b.NodeRepository, "show-ref")
	one := f.integrate(a)
	b.ExpectedTaskCommit = one.TaskCommit
	two := f.integrate(b)
	if one.TaskCommit == a.NodeCommit || two.TaskCommit == b.NodeCommit || two.Outcome != "integrated" {
		t.Fatal("integration must create a controlled Task commit")
	}
	for path, want := range map[string]string{"a.txt": "branch A", "b.txt": "branch B", "base.txt": "base"} {
		if got := f.git(f.task, "show", two.TaskCommit+":"+path); got != want {
			t.Fatalf("integrated %s: %q != %q", path, got, want)
		}
	}
	if parents := f.git(f.task, "rev-list", "--parents", "-n", "1", two.TaskCommit); parents != two.TaskCommit+" "+one.TaskCommit+" "+b.NodeCommit {
		t.Fatalf("uncontrolled private parents: %s", parents)
	}
	if got := f.git(f.task, "rev-parse", two.TaskCommit+"^{tree}"); got != two.TaskTree {
		t.Fatal("result does not identify actual integrated tree")
	}
	if f.git(a.NodeRepository, "show-ref") != aRefs || f.git(b.NodeRepository, "show-ref") != bRefs {
		t.Fatal("integration changed protected Node history")
	}
	// Once pinned into Task storage, replay does not read a retained export path.
	if err := os.Rename(a.NodeRepository, a.NodeRepository+"-retained"); err != nil {
		t.Fatal(err)
	}
	if replay := f.integrate(a); replay != one {
		t.Fatalf("earlier operation changed after Task advanced: %#v", replay)
	}
	if head := f.git(f.task, "rev-parse", WorkspaceTaskFinalizedRef); head != two.TaskCommit {
		t.Fatal("replay rolled back Task head")
	}
	if _, err := os.Lstat(filepath.Join(f.task, "objects", "info", "alternates")); !os.IsNotExist(err) {
		t.Fatalf("import must not depend on an alternate object store: %v", err)
	}
}

func TestWorkspaceIntegrationCrashReplay(t *testing.T) {
	for _, boundary := range []string{"intent", "import", "result", "before_refs", "refs"} {
		t.Run(boundary, func(t *testing.T) {
			f := newIntegrationFixture(t)
			input := f.input("crash", map[string]string{"new.txt": "retained\n"})
			lost := errors.New("injected process loss")
			if _, err := integrateWorkspace(context.Background(), input, func(stage string) error {
				if stage == boundary {
					return lost
				}
				return nil
			}); !errors.Is(err, lost) {
				t.Fatalf("did not stop at %s: %v", boundary, err)
			}
			before := f.intent(input.OperationID)
			if boundary == "result" {
				f.git(f.task, "gc", "--prune=now")
			}
			result := f.integrate(input)
			if after := f.intent(input.OperationID); before.Date != after.Date || before.Input != after.Input {
				t.Fatal("recovery replaced fixed operation inputs")
			}
			if before.Result != nil && *before.Result != result {
				t.Fatal("recovery changed the previously computed result")
			}
			if replay := f.integrate(input); replay != result {
				t.Fatal("replay changed commit identity")
			}
			if got := f.git(f.task, "rev-list", "--count", WorkspaceTaskFinalizedRef); got != "3" {
				t.Fatalf("replay introduced extra reachable commits: %s", got)
			}
		})
	}
}

func TestWorkspaceIntegrationRecoversPartialRefInstall(t *testing.T) {
	for _, partial := range []string{"task_only", "operation_only", "task_advanced"} {
		t.Run(partial, func(t *testing.T) {
			f := newIntegrationFixture(t)
			input := f.input("partial", map[string]string{"one.txt": "one\n"})
			_, err := integrateWorkspace(context.Background(), input, func(stage string) error {
				if stage == "before_refs" {
					return errors.New("process lost before refs")
				}
				return nil
			})
			if err == nil {
				t.Fatal("expected interruption")
			}
			planned := *f.intent(input.OperationID).Result
			wantHead := planned.TaskCommit
			if partial == "operation_only" {
				f.git(f.task, "update-ref", planned.OperationRef, planned.TaskCommit)
			} else {
				f.git(f.task, "update-ref", WorkspaceTaskFinalizedRef, planned.TaskCommit, f.base)
			}
			if partial == "task_advanced" {
				next := f.input("later", map[string]string{"two.txt": "two\n"})
				wantHead = f.integrate(next).TaskCommit
			}
			if got := f.integrate(input); got != planned {
				t.Fatal("partial installation changed original result")
			}
			if f.git(f.task, "rev-parse", planned.OperationRef) != planned.TaskCommit || f.git(f.task, "rev-parse", WorkspaceTaskFinalizedRef) != wantHead {
				t.Fatal("failed to reconcile exact ref pair")
			}
		})
	}
}

func TestWorkspaceIntegrationConflictPreservesTaskAndNode(t *testing.T) {
	f := newIntegrationFixture(t)
	a := f.input("first", map[string]string{"shared.txt": "first\n"})
	b := f.input("conflicting", map[string]string{"shared.txt": "second\n"})
	one := f.integrate(a)
	b.ExpectedTaskCommit = one.TaskCommit
	sourceRefs := f.git(b.NodeRepository, "show-ref")
	result, err := IntegrateWorkspace(context.Background(), b)
	if !errors.Is(err, ErrWorkspaceIntegrationConflict) || result.Outcome != "conflict" || result.TaskCommit != one.TaskCommit || result.TaskTree != one.TaskTree {
		t.Fatalf("wrong conflict result: %#v %v", result, err)
	}
	if f.git(f.task, "rev-parse", WorkspaceTaskFinalizedRef) != one.TaskCommit || f.git(b.NodeRepository, "show-ref") != sourceRefs {
		t.Fatal("conflict changed Task or Node history")
	}
	if op, err := integrationRef(context.Background(), f.task, result.OperationRef); err != nil || op != "" {
		t.Fatalf("conflict installed successful operation ref: %s %v", op, err)
	}
	if got := f.git(f.task, "rev-parse", "refs/monos/integration-inputs/"+b.OperationID); got != b.NodeCommit {
		t.Fatal("conflict lost private result")
	}
	if got := f.git(f.task, "rev-parse", "refs/monos/integration-conflicts/"+b.OperationID); got != result.ConflictTree {
		t.Fatal("conflict tree was not retained")
	}
	next := f.input("unrelated", map[string]string{"later.txt": "later\n"})
	f.integrate(next)
	if replay, err := IntegrateWorkspace(context.Background(), b); !errors.Is(err, ErrWorkspaceIntegrationConflict) || replay != result {
		t.Fatalf("conflict replay changed its original facts: %#v %v", replay, err)
	}
}

func TestWorkspaceIntegrationUsesRecordedStartDespiteNodeMerge(t *testing.T) {
	f := newIntegrationFixture(t)
	a := f.input("task", map[string]string{"shared.txt": "task change\n"})
	one := f.integrate(a)
	b := f.input("node", nil)
	work := filepath.Join(f.root, "work-node")
	f.git(work, "fetch", f.task, one.TaskCommit)
	f.git(work, "merge", "--no-edit", one.TaskCommit)
	b.NodeCommit = f.commit(work, "node adapts", map[string]string{"shared.txt": "node change\n"})
	b.NodeTree = f.git(work, "rev-parse", b.NodeCommit+"^{tree}")
	f.git(b.NodeRepository, "fetch", work, b.NodeCommit)
	f.git(b.NodeRepository, "update-ref", "refs/monos/result", b.NodeCommit)
	// A normal merge would fast-forward through the private Node history. The
	// protected operation still applies the Node's change from its recorded start.
	if _, err := IntegrateWorkspace(context.Background(), b); !errors.Is(err, ErrWorkspaceIntegrationConflict) {
		t.Fatalf("Node history replaced the recorded merge base: %v", err)
	}
}

func TestWorkspaceIntegrationConcurrentExpectedRevisionCAS(t *testing.T) {
	f := newIntegrationFixture(t)
	inputs := []WorkspaceIntegrationInput{f.input("left", map[string]string{"left.txt": "left\n"}), f.input("right", map[string]string{"right.txt": "right\n"})}
	type outcome struct {
		result WorkspaceIntegrationResult
		err    error
	}
	start := make(chan struct{})
	outcomes := make(chan outcome, 2)
	for _, input := range inputs {
		go func() {
			<-start
			result, err := IntegrateWorkspace(context.Background(), input)
			outcomes <- outcome{result, err}
		}()
	}
	close(start)
	successes, stale := 0, 0
	for range inputs {
		o := <-outcomes
		if o.err == nil {
			successes++
			if f.git(f.task, "rev-parse", WorkspaceTaskFinalizedRef) != o.result.TaskCommit {
				t.Fatal("successful CAS did not retain Task result")
			}
		} else if errors.Is(o.err, ErrWorkspaceIntegrationRevision) {
			stale++
		} else {
			t.Fatal(o.err)
		}
	}
	if successes != 1 || stale != 1 {
		t.Fatalf("expected exactly one winner: successes=%d stale=%d", successes, stale)
	}
	if refs := strings.Fields(f.git(f.task, "for-each-ref", "--format=%(objectname)", "refs/monos/integrations/")); len(refs) != 1 {
		t.Fatalf("stale operation created a result ref: %v", refs)
	}
}

func TestWorkspaceIntegrationRejectsChangedAuthority(t *testing.T) {
	for _, mismatch := range []string{"node_tree", "node_ref", "unrelated_start", "symlink", "writable_repository", "alternates", "symbolic_task_ref"} {
		t.Run(mismatch, func(t *testing.T) {
			f := newIntegrationFixture(t)
			input := f.input("invalid", map[string]string{"new.txt": "new\n"})
			switch mismatch {
			case "node_tree":
				input.NodeTree = f.git(f.task, "rev-parse", f.base+"^{tree}")
			case "node_ref":
				f.git(input.NodeRepository, "update-ref", "refs/monos/result", f.base)
			case "unrelated_start":
				input.NodeStartCommit = f.git(f.task, "commit-tree", f.git(f.task, "rev-parse", f.base+"^{tree}"), "-m", "unrelated")
			case "symlink":
				link := filepath.Join(f.root, "export-link")
				if err := os.Symlink(input.NodeRepository, link); err != nil {
					t.Fatal(err)
				}
				input.NodeRepository = link
			case "writable_repository":
				if err := os.Chmod(input.NodeRepository, 0770); err != nil {
					t.Fatal(err)
				}
			case "alternates":
				if err := os.WriteFile(filepath.Join(input.NodeRepository, "objects", "info", "alternates"), []byte(filepath.Join(f.task, "objects")), 0600); err != nil {
					t.Fatal(err)
				}
			case "symbolic_task_ref":
				f.git(f.task, "symbolic-ref", WorkspaceTaskFinalizedRef, "refs/heads/master")
			}
			if _, err := IntegrateWorkspace(context.Background(), input); err == nil {
				t.Fatal("accepted changed authority")
			}
			if f.git(f.task, "rev-parse", WorkspaceTaskFinalizedRef) != f.base {
				t.Fatal("invalid authority changed Task revision")
			}
		})
	}
}

func TestWorkspaceIntegrationRejectsChangedReplayInputsAndRefs(t *testing.T) {
	f := newIntegrationFixture(t)
	input := f.input("immutable", map[string]string{"new.txt": "new\n"})
	result := f.integrate(input)
	changed := input
	changed.ExpectedTaskCommit = result.TaskCommit
	if _, err := IntegrateWorkspace(context.Background(), changed); !errors.Is(err, ErrWorkspaceIntegrationIdentity) {
		t.Fatalf("reused operation identity with changed input: %v", err)
	}
	f.git(f.task, "update-ref", result.OperationRef, f.base)
	if _, err := IntegrateWorkspace(context.Background(), input); !errors.Is(err, ErrWorkspaceIntegrationIdentity) {
		t.Fatalf("trusted replaced operation ref: %v", err)
	}
	f.git(f.task, "update-ref", result.OperationRef, result.TaskCommit)
	intent := f.intent(input.OperationID)
	intent.Result.TaskTree = input.NodeTree
	intent.Result.TaskCommit = input.NodeCommit
	if err := saveRecord(filepath.Join(f.task, "monos-integration-"+input.OperationID+".json"), intent); err != nil {
		t.Fatal(err)
	}
	if _, err := IntegrateWorkspace(context.Background(), input); !errors.Is(err, ErrWorkspaceIntegrationIdentity) {
		t.Fatalf("accepted changed controlled commit: %v", err)
	}
}

func TestWorkspaceIntegrationRevisionChangeAfterResultDoesNotPublish(t *testing.T) {
	f := newIntegrationFixture(t)
	input := f.input("stale", map[string]string{"new.txt": "new\n"})
	other := f.input("other", map[string]string{"other.txt": "other\n"})
	_, err := integrateWorkspace(context.Background(), input, func(stage string) error {
		if stage == "before_refs" {
			f.git(f.task, "fetch", other.NodeRepository, other.NodeCommit)
			f.git(f.task, "update-ref", WorkspaceTaskFinalizedRef, other.NodeCommit, f.base)
		}
		return nil
	})
	if !errors.Is(err, ErrWorkspaceIntegrationRevision) {
		t.Fatalf("expected stale revision: %v", err)
	}
	if op, err := integrationRef(context.Background(), f.task, "refs/monos/integrations/"+input.OperationID); err != nil || op != "" {
		t.Fatalf("failed CAS installed operation ref: %s %v", op, err)
	}
	before := f.intent(input.OperationID)
	if _, err := IntegrateWorkspace(context.Background(), input); !errors.Is(err, ErrWorkspaceIntegrationRevision) {
		t.Fatalf("stale retry unexpectedly succeeded: %v", err)
	}
	if after := f.intent(input.OperationID); !reflect.DeepEqual(before, after) {
		t.Fatal("stale retry silently changed frozen inputs")
	}
}
