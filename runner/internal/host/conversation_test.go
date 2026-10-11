package host

import (
	"slices"
	"strings"
	"testing"

	protocol "monos.local/protocol"
)

func conversationSourceDispatch() protocol.Dispatch {
	d := initialPlanningDispatch()
	d.TaskPlanningSource = nil
	d.ControlVersion = 7
	d.SourceWatermark = 3
	d.TaskConversationSource = &protocol.TaskConversationSource{SourceID: "source", InputID: "input", ConversationVersion: 7, SourceWatermark: 3, ContextDigest: strings.Repeat("a", 64)}
	return d
}

func TestConversationRootScopeGrantsOnlyScratchAndOriginalStop(t *testing.T) {
	d := conversationSourceDispatch()
	if err := ValidateRequest(Request{Action: "start", AttemptID: d.AttemptID, Dispatch: &d}); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"workspace", "common", "inspection"} {
		if slices.Contains(executionDirectories(d), name) {
			t.Fatal("conversation received repository storage", name)
		}
	}
	op := protocol.Operation{AttemptID: d.AttemptID, DispatchID: d.DispatchID, Kind: protocol.Stop}
	if err := ValidateEffectScope(d, op); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*protocol.Operation){
		func(o *protocol.Operation) { o.Kind = protocol.KindOpenWorkspace }, func(o *protocol.Operation) { o.Kind = protocol.KindInspectRepository }, func(o *protocol.Operation) { o.Kind = protocol.KindCompleteNode }, func(o *protocol.Operation) { o.Kind = protocol.SettleCompletion },
		func(o *protocol.Operation) { o.ResourceID = ptr("fixture") }, func(o *protocol.Operation) { o.Workspace = &protocol.WorkspaceDescriptor{} }, func(o *protocol.Operation) { o.WorkspaceDigest = ptr(strings.Repeat("a", 64)) }, func(o *protocol.Operation) { o.Workspaces = []protocol.WorkspaceCompletionInput{} }, func(o *protocol.Operation) { o.CompletionManifestDigest = ptr(strings.Repeat("a", 64)) },
	} {
		bad := op
		change(&bad)
		if ValidateEffectScope(d, bad) == nil {
			t.Fatal("conversation crossed physical scope")
		}
	}
}

func TestConversationSourceCannotMixOrChangeAuthority(t *testing.T) {
	for _, change := range []func(*protocol.Dispatch){
		func(d *protocol.Dispatch) { d.Kind = protocol.Node }, func(d *protocol.Dispatch) { d.NodeID = ptr("node") }, func(d *protocol.Dispatch) { d.NodeActivation = 1 }, func(d *protocol.Dispatch) { d.TodoID = ptr("todo") }, func(d *protocol.Dispatch) { d.ResourceID = ptr("fixture") }, func(d *protocol.Dispatch) { d.SourceMessageID = ptr("todo-message") }, func(d *protocol.Dispatch) { d.ControlVersion++ }, func(d *protocol.Dispatch) { d.SourceWatermark++ }, func(d *protocol.Dispatch) { d.WorkspaceReservations = nil }, func(d *protocol.Dispatch) {
			d.WorkspaceReservations.Resources = []protocol.WorkspaceReservation{{ResourceID: "repo", WorkspaceID: "workspace"}}
		}, func(d *protocol.Dispatch) { d.TaskPlanningSource = &protocol.TaskPlanningSource{} }, func(d *protocol.Dispatch) { d.NodeExecutionSource = &protocol.NodeExecutionSource{} }, func(d *protocol.Dispatch) { d.TaskConversationSource.InputID = "" }, func(d *protocol.Dispatch) { d.TaskConversationSource.ContextDigest = "invalid" },
	} {
		d := conversationSourceDispatch()
		change(&d)
		if ValidateRequest(Request{Action: "start", AttemptID: d.AttemptID, Dispatch: &d}) == nil {
			t.Fatal("mixed source launched")
		}
		if ValidateEffectScope(d, protocol.Operation{AttemptID: d.AttemptID, DispatchID: d.DispatchID, Kind: protocol.Stop}) == nil {
			t.Fatal("mixed source reached effect")
		}
	}
	original := conversationSourceDispatch()
	changed := conversationSourceDispatch()
	changed.TaskConversationSource.ReplyOnly = true
	if validateRepeatedStart(Manifest{Dispatch: original}, changed) == nil {
		t.Fatal("dispatch replay changed conversation authority")
	}
}
