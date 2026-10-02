package host

import (
	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
	"strings"
	"testing"
)

func replanHostDispatch() protocol.Dispatch {
	d := initialPlanningDispatch()
	d.TaskPlanningSource = nil
	d.TaskReplanSource = &protocol.TaskReplanSource{RequestID: "replan", SourceID: "source", PlanID: "plan", SpecificationID: "spec", ContextDigest: strings.Repeat("a", 64)}
	return d
}
func TestReplanSourceAndStopOnlyHostScope(t *testing.T) {
	d := replanHostDispatch()
	op := protocol.Operation{AttemptID: d.AttemptID, DispatchID: d.DispatchID, Kind: protocol.Stop}
	if err := ValidateEffectScope(d, op); err != nil {
		t.Fatal(err)
	}
	for _, edit := range []func(*protocol.Dispatch){
		func(d *protocol.Dispatch) { d.SourceWatermark = 37 }, func(d *protocol.Dispatch) { d.ControlVersion++ }, func(d *protocol.Dispatch) { d.TaskReplanSource.SourceID = "" }, func(d *protocol.Dispatch) { d.TaskReplanSource.PlanID = "" }, func(d *protocol.Dispatch) { d.TaskReplanSource.ContextDigest = "bad" }, func(d *protocol.Dispatch) { d.TaskPlanningSource = &protocol.TaskPlanningSource{} }, func(d *protocol.Dispatch) { d.NodeExecutionSource = &protocol.NodeExecutionSource{} }, func(d *protocol.Dispatch) { d.TaskConversationSource = &protocol.TaskConversationSource{} }, func(d *protocol.Dispatch) { d.NodeID = ptr("node") }, func(d *protocol.Dispatch) {
			d.WorkspaceReservations.Resources = []protocol.WorkspaceReservation{{ResourceID: "resource"}}
		}, func(d *protocol.Dispatch) { d.TodoID = ptr("todo") }, func(d *protocol.Dispatch) { d.ResourceID = ptr("resource") },
	} {
		d := replanHostDispatch()
		edit(&d)
		if _, err := wire.ScopeID(d); err == nil {
			t.Fatal("invalid source accepted", d)
		}
	}
	for _, edit := range []func(*protocol.Operation){func(o *protocol.Operation) { o.Kind = protocol.KindOpenWorkspace }, func(o *protocol.Operation) { o.ResourceID = ptr("resource") }, func(o *protocol.Operation) { o.RepositoryFree = ptr(true) }, func(o *protocol.Operation) { o.CompletionManifestDigest = ptr(strings.Repeat("a", 64)) }} {
		o := op
		edit(&o)
		if ValidateEffectScope(d, o) == nil {
			t.Fatal("non Stop authority accepted")
		}
	}
}

// Replan has its own canonical source. Conversation input cutoff belongs in the
// frozen context and must not acquire Todo/Conversation dispatch semantics.
func TestReplanWithNonzeroConversationCutoffKeepsIndependentDispatchSource(t *testing.T) {
	d := replanHostDispatch()
	context := map[string]any{"source_id": "source", "replan_request_id": "replan", "input_cutoff": 37, "event_cutoff": 82, "reason": "Current graph cannot satisfy the new requirement"}
	raw, digest, err := wire.Canonical(context)
	if err != nil {
		t.Fatal(err)
	}
	d.Prompt = string(raw)
	d.TaskReplanSource.ContextDigest = digest
	if d.SourceWatermark != 0 {
		t.Fatal("fixture carried Conversation watermark")
	}
	op := protocol.Operation{AttemptID: d.AttemptID, DispatchID: d.DispatchID, Kind: protocol.Stop}
	if err = ValidateEffectScope(d, op); err != nil {
		t.Fatal("nonzero context cutoff cannot run dedicated Replan", err)
	}
	before := d.Prompt
	if _, err = wire.ScopeID(d); err != nil || d.Prompt != before {
		t.Fatal("context cutoff rewritten", err)
	}
	d.SourceWatermark = 37
	if ValidateEffectScope(d, op) == nil {
		t.Fatal("Conversation watermark leaked into Replan source")
	}
}
