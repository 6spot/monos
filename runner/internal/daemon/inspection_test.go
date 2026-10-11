package daemon

import (
	"context"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/control"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/journal"
	"monos.local/runner/internal/wire"
)

func inspectionRecoveryFixture(t *testing.T) (protocol.Dispatch, protocol.Operation) {
	t.Helper()
	d, op := planningRecoveryFixture(t)
	d.MutationAllowed = true
	op.Kind = protocol.KindInspectRepository
	op.OperationID = "inspection"
	op.RequestID = "inspection-request"
	op.ResourceID = ptr("repo")
	i := protocol.InspectionDescriptor{SchemaVersion: 1, InspectionID: op.OperationID, AttemptID: d.AttemptID, DispatchID: d.DispatchID, ScopeKind: "task", ScopeID: *d.TaskID, ProjectID: "project", RunnerID: d.RunnerID, Resource: protocol.WorkspaceResource{ResourceID: "repo", RepositoryIdentity: "github.com/example/repository", RemoteURL: "https://github.com/example/repository.git"}, Origin: protocol.InspectionOrigin{Kind: "default_ref"}, PlannerSource: protocol.InspectionPlannerSource{Kind: "task_initial_planning", SourceID: d.TaskPlanningSource.IntentID, ControlVersion: d.ControlVersion, ContextDigest: d.TaskPlanningSource.ContextDigest}}
	op.Inspection = &i
	_, digest, _ := wire.Canonical(i)
	op.InspectionDigest = &digest
	return d, op
}

func TestInspectionStopDrainsWhileFetchDoesNotHoldLifecycleMutex(t *testing.T) {
	dispatch, op := inspectionRecoveryFixture(t)
	db := testDB(t)
	if e := db.SaveStart(journal.Start{Dispatch: dispatch, Phase: "running", BootID: "boot"}); e != nil {
		t.Fatal(e)
	}
	started := make(chan struct{})
	var calls atomic.Int32
	d := Daemon{DB: db, Control: &control.Client{}, Boot: "boot", Host: functionSupervisor(func(_ context.Context, r host.Request) (host.Status, error) {
		if r.Action == "effect" {
			calls.Add(1)
		}
		return host.Status{Known: true, BootID: "boot"}, nil
	})}
	d.inspectionRun = func(ctx context.Context, op protocol.Operation) (protocol.EffectResult, error) {
		close(started)
		<-ctx.Done()
		return host.InspectionUnavailable(op, "cancelled"), nil
	}
	d.inspectionCancel = func(_ context.Context, op protocol.Operation) (protocol.EffectResult, error) {
		return host.InspectionUnavailable(op, "cancelled"), nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	d.Frame(ctx, protocol.Frame{Type: protocol.Effect, Operation: &op})
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("inspection never started")
	}
	stop := protocol.Operation{SchemaVersion: 1, OperationID: "stop-inspection", RequestID: "stop-request", AttemptID: op.AttemptID, DispatchID: op.DispatchID, Kind: protocol.Stop, State: protocol.FluffyAdmitted}
	d.Frame(ctx, protocol.Frame{Type: protocol.Effect, Operation: &stop})
	done := make(chan struct{})
	go func() { d.workers.Wait(); close(done) }()
	select {
	case <-done:
	case <-ctx.Done():
		t.Fatal("Stop blocked behind inspection")
	}
	r, e := db.Effect(op.OperationID)
	if e != nil || r == nil || !r.Success || r.Result.Inspection.Reason == nil || *r.Result.Inspection.Reason != "cancelled" || r.Result.WriterAbsent != nil {
		t.Fatal("inspection not typed cancelled", r, e)
	}
	s, e := db.Effect(stop.OperationID)
	if e != nil || s == nil || !s.Success || s.Result.WriterAbsent == nil || !*s.Result.WriterAbsent || calls.Load() != 1 {
		t.Fatal("Stop did not release after drain", s, e)
	}
}

func TestInspectionUnknownChildPreventsStopRelease(t *testing.T) {
	dispatch, op := inspectionRecoveryFixture(t)
	db := testDB(t)
	retainRecovery(t, db, dispatch, op, recoveryFailure(op))
	var calls atomic.Int32
	d := Daemon{DB: db, Control: &control.Client{}, Boot: "boot", Host: functionSupervisor(func(context.Context, host.Request) (host.Status, error) {
		calls.Add(1)
		return host.Status{Known: true}, nil
	})}
	d.inspectionCancel = func(context.Context, protocol.Operation) (protocol.EffectResult, error) {
		return protocol.EffectResult{}, host.ErrInspectionUnresolved
	}
	stop := protocol.Operation{OperationID: "unknown-stop", AttemptID: op.AttemptID, DispatchID: op.DispatchID, Kind: protocol.Stop}
	_ = d.effect(context.Background(), stop)
	r, e := db.Effect(stop.OperationID)
	if e != nil || r == nil || r.Success || r.Result.WriterAbsent != nil || calls.Load() != 0 {
		t.Fatal("unknown inspection released Stop", r, e, calls.Load())
	}
}

func TestInspectionReconnectIncludesNoResultIntentAndReplaysTerminal(t *testing.T) {
	for _, terminal := range []bool{false, true} {
		t.Run(map[bool]string{false: "intent", true: "terminal"}[terminal], func(t *testing.T) {
			dispatch, op := inspectionRecoveryFixture(t)
			db := testDB(t)
			var prior *protocol.OperationResult
			if terminal {
				prior = &protocol.OperationResult{AttemptID: op.AttemptID, OperationID: op.OperationID, Success: true, Result: host.InspectionUnavailable(op, "ref_unavailable")}
			}
			retainRecovery(t, db, dispatch, op, prior)
			var runs atomic.Int32
			d := Daemon{DB: db, Control: &control.Client{}, Boot: "boot", Host: functionSupervisor(func(context.Context, host.Request) (host.Status, error) {
				return host.Status{Known: true, Populated: true, BootID: "boot", Cgroup: "scope"}, nil
			})}
			d.inspectionRun = func(_ context.Context, op protocol.Operation) (protocol.EffectResult, error) {
				runs.Add(1)
				return host.InspectionUnavailable(op, "ref_unavailable"), nil
			}
			ctx, _ := recoveryContext(t, &d)
			if e := d.Reconcile(ctx, recoveryInventory(dispatch, op)); e != nil {
				t.Fatal(e)
			}
			if runs.Load() != 0 {
				t.Fatal("inspection ran before Ready")
			}
			d.ConnectionReady(ctx)
			d.workers.Wait()
			want := int32(1)
			if terminal {
				want = 0
			}
			if runs.Load() != want {
				t.Fatal("wrong recovery calls", runs.Load())
			}
			r, e := db.Effect(op.OperationID)
			if e != nil || r == nil || !r.Success || r.Result.Inspection.Status != "unavailable" {
				t.Fatal(r, e)
			}
			if terminal && !reflect.DeepEqual(r, prior) {
				t.Fatal("terminal result replaced")
			}
		})
	}
}

func TestInspectionOriginRetainsFullCompletionProof(t *testing.T) {
	for _, mode := range []string{"valid", "digest", "tree", "scope", "project", "repository"} {
		t.Run(mode, func(t *testing.T) {
			db, _, op, id, _ := retainedReadFixture(t)
			_, digest, _ := wire.Canonical(id)
			i := protocol.InspectionDescriptor{ScopeKind: "task", ScopeID: id.TaskID, ProjectID: op.Workspace.ProjectID, RunnerID: id.RunnerID, Resource: op.Workspace.Resource, Origin: protocol.InspectionOrigin{Kind: "task_completion", Identity: &id, IdentityDigest: &digest}}
			switch mode {
			case "digest":
				digest = strings.Repeat("f", 64)
			case "tree":
				id.GitTree = strings.Repeat("4", 40)
				_, digest, _ = wire.Canonical(id)
			case "scope":
				i.ScopeID = "foreign"
			case "project":
				i.ProjectID = "foreign"
			case "repository":
				i.Resource.RepositoryIdentity = "foreign"
			}
			e := retainedInspectionOrigin(db, i)
			if (e == nil) != (mode == "valid") {
				t.Fatal(mode, e)
			}
		})
	}
}

func TestInspectionOriginOnlyAcceptsOriginalSuccessfulOpen(t *testing.T) {
	for _, mode := range []string{"valid", "later-basis", "checkpoint", "changed-result", "missing-result", "wrong-start"} {
		t.Run(mode, func(t *testing.T) {
			db := testDB(t)
			dispatch, op := recoveryFixture(t, "original-open", protocol.KindOpenWorkspace)
			dispatch.NodeExecutionSource = &protocol.NodeExecutionSource{SourceID: "source", NodeID: *dispatch.NodeID, NodeActivation: dispatch.NodeActivation, SpecificationID: "spec", PlanID: "plan", ContextDigest: strings.Repeat("a", 64), ControlVersion: dispatch.ControlVersion}
			w := op.Workspace
			m := protocol.WorkspaceMetadata{BaseCommit: strings.Repeat("1", 40), FinalizedCommit: strings.Repeat("1", 40), LeaseID: w.LeaseID, Generation: w.Generation, StorageID: "storage", RepositoryIdentity: w.Resource.RepositoryIdentity, TargetBranch: "main", TargetCommit: strings.Repeat("1", 40)}
			if mode == "later-basis" {
				w.Basis = &protocol.WorkspaceBasis{BaseCommit: m.BaseCommit, FinalizedCommit: m.BaseCommit, StorageID: m.StorageID, RepositoryIdentity: m.RepositoryIdentity, TargetBranch: "main"}
				_, dg, _ := wire.Canonical(w)
				op.WorkspaceDigest = &dg
			}
			if mode == "checkpoint" {
				m.Checkpoint = &protocol.WorkspaceCheckpoint{OperationID: "stop", CommitID: m.BaseCommit, TreeID: strings.Repeat("2", 40), HeadCommit: m.BaseCommit}
			}
			r := protocol.OperationResult{AttemptID: op.AttemptID, OperationID: op.OperationID, Success: true, Result: protocol.EffectResult{WorkspaceID: &w.WorkspaceID, WorkspaceMetadata: &m}}
			if mode == "wrong-start" {
				dispatch.NodeExecutionSource.ContextDigest = "bad"
			}
			var result *protocol.OperationResult = &r
			if mode == "missing-result" {
				result = nil
			}
			retainRecovery(t, db, dispatch, op, result)
			i := protocol.InspectionDescriptor{ScopeKind: "task", ScopeID: w.TaskID, ProjectID: w.ProjectID, RunnerID: w.RunnerID, Resource: w.Resource, Origin: protocol.InspectionOrigin{Kind: "task_open", OperationID: &op.OperationID, Workspace: w, WorkspaceDigest: op.WorkspaceDigest, Metadata: &m}}
			if mode == "changed-result" {
				m.FinalizedCommit = strings.Repeat("2", 40)
			}
			e := retainedInspectionOrigin(db, i)
			if (e == nil) != (mode == "valid") {
				t.Fatal(mode, e)
			}
		})
	}
}

func TestInspectionRecoveryRejectsSourceSubstitution(t *testing.T) {
	dispatch, op := inspectionRecoveryFixture(t)
	db := testDB(t)
	retainRecovery(t, db, dispatch, op, recoveryFailure(op))
	d := Daemon{DB: db}
	dispatch.TaskPlanningSource.ContextDigest = strings.Repeat("f", 64)
	if ok, e := d.retainedRecovery(op, dispatch); e == nil || ok {
		t.Fatal("changed source authorized inspection")
	}
}
