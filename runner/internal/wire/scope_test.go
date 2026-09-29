package wire

import (
	"testing"

	protocol "monos.local/protocol"
)

func TestDispatchScopeIsExclusiveAndTodoHasNoExecutionNodeOrResource(t *testing.T) {
	task := protocol.Dispatch{TaskID: ptr("task"), Kind: protocol.Node, ResourceID: ptr("repo")}
	todo := protocol.Dispatch{TodoID: ptr("todo"), Kind: "planner", SourceMessageID: ptr("source")}
	for _, test := range []struct {
		dispatch protocol.Dispatch
		want     string
	}{{task, "task"}, {todo, "todo"}} {
		got, err := ScopeID(test.dispatch)
		if err != nil || got != test.want {
			t.Fatalf("scope=%q error=%v", got, err)
		}
	}
	for _, change := range []func(*protocol.Dispatch){
		func(d *protocol.Dispatch) { d.TaskID = ptr("other") },
		func(d *protocol.Dispatch) { d.TodoID = nil },
		func(d *protocol.Dispatch) { d.TodoID = ptr("") },
		func(d *protocol.Dispatch) { d.Kind = protocol.Node },
		func(d *protocol.Dispatch) { d.NodeID = ptr("node") },
		func(d *protocol.Dispatch) { d.NodeActivation = 1 },
		func(d *protocol.Dispatch) { d.ResourceID = ptr("fixture") },
		func(d *protocol.Dispatch) { d.SourceMessageID = nil },
	} {
		invalid := todo
		change(&invalid)
		if _, err := ScopeID(invalid); err == nil {
			t.Fatalf("accepted invalid Todo ownership: %+v", invalid)
		}
	}
}

func TestOptionalResourceIdentitySurvivesJSONAllocation(t *testing.T) {
	if !SameResource(ptr("repo"), ptr("repo")) || !SameResource(nil, nil) {
		t.Fatal("equal resource values or absence did not compare equally")
	}
	for _, pair := range [][2]*string{{nil, ptr("repo")}, {ptr("repo"), nil}, {ptr("one"), ptr("two")}, {ptr(""), nil}} {
		if SameResource(pair[0], pair[1]) {
			t.Fatal("different resource identities compared equally")
		}
	}
}
