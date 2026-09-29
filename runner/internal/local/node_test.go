package local

import (
	"encoding/json"
	"strings"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func TestNodeToolsKeepOutputSelectionAndScope(t *testing.T) {
	task, node := "task", "node"
	d := protocol.Dispatch{TaskID: &task, NodeID: &node, Kind: protocol.Node, NodeActivation: 1, ControlVersion: 4, WorkspaceReservations: &protocol.WorkspaceReservations{ProjectID: "project"}, NodeExecutionSource: &protocol.NodeExecutionSource{SourceID: "source", NodeID: node, NodeActivation: 1, ControlVersion: 4, SpecificationID: "spec", PlanID: "plan", ContextDigest: strings.Repeat("a", 64)}}
	for _, entry := range []struct {
		name    protocol.CommandEnvelopeName
		payload string
	}{
		{"publish_artifact", `{"artifact_id":"artifact","title":"Output","content":{"text":"","media_type":"text/plain"}}`},
		{"read_artifact", `{"artifact_id":"artifact"}`}, {"block_node", `{"reason":"Need Owner direction"}`},
		{"complete_node", `{"summary":"Done"}`}, {"complete_node", `{"summary":"Done","artifact_ids":[]}`}, {"complete_node", `{"summary":"Done","artifact_ids":["earlier-attempt-output"]}`},
	} {
		raw, err := prepareEnvelope(d, Request{Name: entry.name, RequestID: "request", Payload: json.RawMessage(entry.payload)})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = wire.Envelope(raw); err != nil {
			t.Fatal(err)
		}
		var e struct {
			Payload json.RawMessage `json:"payload"`
		}
		if err = json.Unmarshal(raw, &e); err != nil {
			t.Fatal(err)
		}
		want, _, _ := wire.CanonicalRaw([]byte(entry.payload))
		if string(e.Payload) != string(want) {
			t.Fatal("payload distinction lost", string(e.Payload))
		}
	}
	for _, name := range []protocol.CommandEnvelopeName{"publish_execution_plan", "raise_planning_issue", "commit_task_turn", "commit_discussion_turn", "read_discussion", "inspect_repository"} {
		if _, err := prepareEnvelope(d, Request{Name: name, RequestID: "request", Payload: json.RawMessage(`{}`)}); err == nil {
			t.Fatal("Node acquired unrelated command", name)
		}
	}
	d.NodeExecutionSource = nil
	if _, err := prepareEnvelope(d, Request{Name: "publish_artifact", RequestID: "request", Payload: json.RawMessage(`{}`)}); err == nil {
		t.Fatal("legacy dispatch acquired Node source authority")
	}
}
