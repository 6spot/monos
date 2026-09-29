package host

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"

	protocol "monos.local/protocol"
)

func todoDispatch() protocol.Dispatch {
	return protocol.Dispatch{AttemptID: "todo-attempt", DispatchID: "todo-dispatch", RunnerID: "runner", Kind: "planner", TodoID: ptr("todo"), SourceMessageID: ptr("source"), ProjectContextVersion: ptr(int64(1)), ProjectContextDigest: ptr(strings.Repeat("a", 64)), RuntimeID: protocol.Opencode, Model: FreeModel, MutationAllowed: true}
}

func TestTodoLaunchRequiresNoTaskRepositoryDirectories(t *testing.T) {
	d := todoDispatch()
	raw, err := json.Marshal(Request{Action: "start", AttemptID: d.AttemptID, Dispatch: &d})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = DecodeRequest(strings.NewReader(string(raw))); err != nil {
		t.Fatal("repository-free Planner rejected", err)
	}
	dirs := executionDirectories(d)
	for _, directory := range []string{"workspace", "common", "inspection"} {
		if slices.Contains(dirs, directory) {
			t.Fatalf("Todo launch reserves repository directory %s", directory)
		}
	}
	for _, directory := range []string{"scratch", "data", "cache", "state", "tmp", "config"} {
		if !slices.Contains(dirs, directory) {
			t.Fatalf("Todo launch lacks native Runtime directory %s", directory)
		}
	}
	legacy := executionDirectories(protocol.Dispatch{TaskID: ptr("task")})
	if !slices.Contains(legacy, "workspace") || !slices.Contains(legacy, "common") {
		t.Fatal("legacy Task launch lost reserved workspace")
	}
}

func TestTodoEffectsCannotReachTaskFixtureAndStopNeedsNoResource(t *testing.T) {
	d := todoDispatch()
	stop := protocol.Operation{AttemptID: d.AttemptID, DispatchID: d.DispatchID, Kind: protocol.Stop}
	if err := ValidateEffectScope(d, stop); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []protocol.OperationKind{protocol.KindInspectRepository, protocol.KindOpenWorkspace, protocol.KindCompleteNode} {
		op := stop
		op.Kind = kind
		if ValidateEffectScope(d, op) == nil {
			t.Fatal("Todo repository effect accepted", kind)
		}
		op.ResourceID = ptr("fixture")
		if ValidateEffectScope(d, op) == nil {
			t.Fatal("Todo fixture resource accepted", kind)
		}
	}
	stop.ResourceID = ptr("fixture")
	if ValidateEffectScope(d, stop) == nil {
		t.Fatal("Todo Stop inherited a fake resource")
	}
	stop.ResourceID = nil
	stop.DispatchID = "another"
	if ValidateEffectScope(d, stop) == nil {
		t.Fatal("cross-dispatch Stop accepted")
	}
}

func TestLegacyEffectIdentityComparesDecodedResourcesAndOptionalStop(t *testing.T) {
	d := protocol.Dispatch{AttemptID: "a", DispatchID: "d", TaskID: ptr("task"), ResourceID: ptr("repo")}
	op := protocol.Operation{AttemptID: "a", DispatchID: "d", Kind: protocol.KindOpenWorkspace, ResourceID: ptr("repo")}
	if err := ValidateEffectScope(d, op); err != nil {
		t.Fatal("equal separately allocated resources conflicted", err)
	}
	raw, err := json.Marshal(op)
	if err != nil {
		t.Fatal(err)
	}
	var replay protocol.Operation
	if err = json.Unmarshal(raw, &replay); err != nil {
		t.Fatal(err)
	}
	if !sameOperation(op, replay) {
		t.Fatal("JSON round trip changed operation identity")
	}
	op.ResourceID = nil
	if ValidateEffectScope(d, op) == nil {
		t.Fatal("workspace accepted missing resource")
	}
	op.Kind = protocol.Stop
	if err = ValidateEffectScope(d, op); err != nil {
		t.Fatal("resource-free Stop rejected", err)
	}
	if !sameOperation(op, op) {
		t.Fatal("resource-free operation does not replay")
	}
	replay = op
	replay.ResourceID = ptr("repo")
	if sameOperation(op, replay) {
		t.Fatal("changed resource presence compared equal")
	}
}
