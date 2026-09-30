package local

import (
	"encoding/json"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func TestSpecificationCommandsRequireMutableCanonicalConversation(t *testing.T) {
	for _, entry := range []struct {
		name    protocol.CommandEnvelopeName
		payload string
	}{
		{"prepare_specification_revision", `{"proposal_id":"proposal","specification":"# Requirements\nExact content","summary":"Clarify scope","basis":{"control_version":93,"specification_id":"spec","plan_id":null},"impact":{"graph_sufficient":true,"nodes":[],"guidance":[]},"source_input_ids":["input"]}`},
		{"apply_specification_revision", `{"proposal_id":"proposal","confirmation_id":"owner-receipt","basis":{"control_version":93,"specification_id":"spec","plan_id":null}}`},
		{"commit_task_turn", `{"source_id":"source","input_id":"input","source_watermark":9,"reply":"Review this exact proposal","routing":{"kind":"specification_proposal","proposal_id":"proposal","basis":{"control_version":93,"specification_id":"spec","plan_id":null}}}`},
	} {
		t.Run(string(entry.name), func(t *testing.T) {
			req := Request{Name: entry.name, RequestID: "request", Payload: json.RawMessage(entry.payload)}
			raw, err := prepareEnvelope(conversationDispatch(), req)
			if err != nil {
				t.Fatal(err)
			}
			env, err := wire.Envelope(raw)
			if err != nil {
				t.Fatal(err)
			}
			if env.ScopeID != "task" || env.ExpectedControlVersion != 7 {
				t.Fatal("execution basis replaced fixed conversation source")
			}
			var body struct {
				Payload json.RawMessage `json:"payload"`
			}
			if err = json.Unmarshal(raw, &body); err != nil {
				t.Fatal(err)
			}
			want, _, _ := wire.CanonicalRaw([]byte(entry.payload))
			if string(body.Payload) != string(want) {
				t.Fatal("proposal, receipt or basis changed")
			}
			for _, mode := range []string{"reply-only", "legacy", "initial-planning", "node", "todo", "source-version", "source-watermark"} {
				t.Run(mode, func(t *testing.T) {
					d := conversationDispatch()
					switch mode {
					case "reply-only":
						d.TaskConversationSource.ReplyOnly = true
					case "legacy":
						d.TaskConversationSource = nil
					case "initial-planning":
						d = planningDispatch()
					case "node":
						d.TaskConversationSource = nil
						d.Kind = protocol.Node
						node := "node"
						d.NodeID = &node
					case "todo":
						d.TaskConversationSource = nil
						d.TaskID = nil
						todo := "todo"
						d.TodoID = &todo
					case "source-version":
						d.ControlVersion++
					case "source-watermark":
						d.SourceWatermark++
					}
					if _, err := prepareEnvelope(d, req); err == nil {
						t.Fatal("wrong phase or source acquired requirement authority")
					}
				})
			}
		})
	}
}
