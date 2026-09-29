package host

import (
	"slices"
	"strings"
	"testing"

	protocol "monos.local/protocol"
)

func initialPlanningDispatch() protocol.Dispatch {
	return protocol.Dispatch{AttemptID: "planning-attempt", DispatchID: "planning-dispatch", RunnerID: "runner", Kind: "planner", TaskID: ptr("task"), RuntimeID: protocol.Opencode, Model: FreeModel, MutationAllowed: true, TaskPlanningSource: &protocol.TaskPlanningSource{IntentID: "intent", SpecificationID: "spec", ContextDigest: strings.Repeat("a", 64)}, WorkspaceReservations: &protocol.WorkspaceReservations{ProjectID: "project", Resources: []protocol.WorkspaceReservation{}}}
}

func TestInitialPlannerLaunchAndEffectsNeverGrantRepositoryStorage(t *testing.T) {
	d := initialPlanningDispatch()
	if err := ValidateRequest(Request{Action: "start", AttemptID: d.AttemptID, Dispatch: &d}); err != nil {
		t.Fatal("source-bound initial Planner cannot launch", err)
	}
	for _, name := range []string{"workspace", "common", "inspection"} {
		if slices.Contains(executionDirectories(d), name) {
			t.Fatal("initial planning reserved repository storage", name)
		}
	}
	stop := protocol.Operation{AttemptID: d.AttemptID, DispatchID: d.DispatchID, Kind: protocol.Stop}
	if err := ValidateEffectScope(d, stop); err != nil {
		t.Fatal("initial Planner cannot settle through repository-free Stop", err)
	}
	for _, kind := range []protocol.OperationKind{protocol.KindOpenWorkspace, protocol.KindInspectRepository, protocol.KindCompleteNode} {
		op := stop
		op.Kind = kind
		op.ResourceID = ptr("fixture")
		if ValidateEffectScope(d, op) == nil {
			t.Fatal("initial planning reached a repository effect", kind)
		}
	}
	for _, mutate := range []func(*protocol.Operation){
		func(op *protocol.Operation) { op.ResourceID = ptr("fixture") },
		func(op *protocol.Operation) { op.Workspace = &protocol.WorkspaceDescriptor{} },
		func(op *protocol.Operation) { op.WorkspaceDigest = ptr(strings.Repeat("a", 64)) },
	} {
		bad := stop
		mutate(&bad)
		if ValidateEffectScope(d, bad) == nil {
			t.Fatal("repository-bearing initial Planner Stop accepted")
		}
	}
}

func TestInitialPlannerSourceCannotBeReboundOrMixedWithOtherOwners(t *testing.T) {
	for _, mutate := range []func(*protocol.Dispatch){
		func(d *protocol.Dispatch) { d.Kind = protocol.Node },
		func(d *protocol.Dispatch) { d.TodoID = ptr("todo") },
		func(d *protocol.Dispatch) { d.NodeID = ptr("node") },
		func(d *protocol.Dispatch) { d.NodeActivation = 1 },
		func(d *protocol.Dispatch) { d.SourceMessageID = ptr("todo-message") },
		func(d *protocol.Dispatch) { d.SourceWatermark = 1 },
		func(d *protocol.Dispatch) { d.ResourceID = ptr("fixture") },
		func(d *protocol.Dispatch) { d.WorkspaceReservations = nil },
		func(d *protocol.Dispatch) {
			d.WorkspaceReservations.Resources = []protocol.WorkspaceReservation{{ResourceID: "repo", WorkspaceID: "ws"}}
		},
		func(d *protocol.Dispatch) { d.TaskPlanningSource.IntentID = "" },
		func(d *protocol.Dispatch) { d.TaskPlanningSource.ContextDigest = "invalid" },
	} {
		d := initialPlanningDispatch()
		mutate(&d)
		if ValidateRequest(Request{Action: "start", AttemptID: d.AttemptID, Dispatch: &d}) == nil {
			t.Fatal("invalid initial planning source passed helper admission", d)
		}
		if ValidateEffectScope(d, protocol.Operation{AttemptID: d.AttemptID, DispatchID: d.DispatchID, Kind: protocol.Stop}) == nil {
			t.Fatal("invalid retained source authorized a host effect", d)
		}
	}
	original := initialPlanningDispatch()
	changed := initialPlanningDispatch()
	changed.TaskPlanningSource.IntentID = "different-intent"
	if validateRepeatedStart(Manifest{Dispatch: original}, changed) == nil {
		t.Fatal("same dispatch ID changed its planning source")
	}
}
