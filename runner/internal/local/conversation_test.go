package local

import (
	"encoding/json"
	"strings"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func conversationDispatch() protocol.Dispatch {
	task := "task"
	return protocol.Dispatch{TaskID: &task, Kind: "planner", ControlVersion: 7, SourceWatermark: 9, WorkspaceReservations: &protocol.WorkspaceReservations{ProjectID: "project", ConfigurationVersion: 3, Resources: []protocol.WorkspaceReservation{}}, TaskConversationSource: &protocol.TaskConversationSource{SourceID: "source", InputID: "input", SourceWatermark: 9, ConversationVersion: 7, ContextDigest: strings.Repeat("a", 64)}}
}

func TestConversationEnvelopeBindsSourceAndIndependentVersion(t *testing.T) {
	d := conversationDispatch()
	for _, entry := range []struct {
		name    protocol.CommandEnvelopeName
		payload string
	}{
		{"read_task_context", `{}`},
		{"read_task_history", `{"query":"earlier answer"}`},
		{"read_task_history", `{"cursor":"bounded-cursor"}`},
		{"commit_task_turn", `{"source_id":"source","input_id":"input","source_watermark":9,"reply":"Observed progress","routing":{"kind":"reply"}}`},
		{"commit_task_turn", `{"source_id":"source","input_id":"input","source_watermark":9,"reply":"Within-scope guidance recorded","routing":{"kind":"guidance","text":"Use accessible labels","basis":{"control_version":93,"specification_id":"spec","plan_id":null}}}`},
	} {
		raw, err := prepareEnvelope(d, Request{Name: entry.name, RequestID: "request", Payload: json.RawMessage(entry.payload)})
		if err != nil {
			t.Fatal(err)
		}
		env, err := wire.Envelope(raw)
		if err != nil {
			t.Fatal(err)
		}
		if env.ExpectedControlVersion != 7 || env.ScopeID != "task" {
			t.Fatal("execution basis replaced conversation authority")
		}
		var body struct {
			Payload json.RawMessage `json:"payload"`
		}
		if err = json.Unmarshal(raw, &body); err != nil {
			t.Fatal(err)
		}
		want, _, _ := wire.CanonicalRaw([]byte(entry.payload))
		if string(body.Payload) != string(want) {
			t.Fatal("source/action payload changed")
		}
	}
}

func TestConversationRejectsForeignSourceCommandsAndTerminalActions(t *testing.T) {
	for _, mode := range []string{"source", "input", "watermark", "source-version", "outer-watermark", "missing-source", "reply-only-action"} {
		t.Run(mode, func(t *testing.T) {
			d := conversationDispatch()
			payload := map[string]any{"source_id": "source", "input_id": "input", "source_watermark": 9, "reply": "reply", "routing": map[string]any{"kind": "reply"}}
			switch mode {
			case "source":
				payload["source_id"] = "other"
			case "input":
				payload["input_id"] = "other"
			case "watermark":
				payload["source_watermark"] = 10
			case "source-version":
				d.ControlVersion++
			case "outer-watermark":
				d.SourceWatermark++
			case "missing-source":
				d.TaskConversationSource = nil
			case "reply-only-action":
				d.TaskConversationSource.ReplyOnly = true
				payload["routing"] = map[string]any{"kind": "guidance"}
			}
			raw, _ := json.Marshal(payload)
			if _, err := prepareEnvelope(d, Request{Name: "commit_task_turn", RequestID: "request", Payload: raw}); err == nil {
				t.Fatal("foreign conversation authority accepted")
			}
		})
	}
	for _, name := range []protocol.CommandEnvelopeName{"publish_artifact", "read_artifact", "block_node", "complete_node", "open_workspace", "publish_execution_plan", "raise_planning_issue", "read_discussion", "update_working_requirement_state", "commit_discussion_turn"} {
		if _, err := prepareEnvelope(conversationDispatch(), Request{Name: name, RequestID: "request", Payload: json.RawMessage(`{}`)}); err == nil {
			t.Fatal("conversation acquired another phase's command", name)
		}
	}
	for _, name := range []protocol.CommandEnvelopeName{"read_task_context", "read_task_history"} {
		if _, err := prepareEnvelope(planningDispatch(), Request{Name: name, RequestID: "request", Payload: json.RawMessage(`{}`)}); err == nil {
			t.Fatal("initial Planner acquired conversation read")
		}
	}
	d := conversationDispatch()
	d.TaskConversationSource.ReplyOnly = true
	if _, err := prepareEnvelope(d, Request{Name: "commit_task_turn", RequestID: "request", Payload: json.RawMessage(`{"source_id":"source","input_id":"input","source_watermark":9,"reply":"Terminal reply","routing":{"kind":"reply"}}`)}); err != nil {
		t.Fatal("terminal reply unavailable", err)
	}
}
