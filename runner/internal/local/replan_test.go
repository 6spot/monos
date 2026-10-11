package local

import (
	"encoding/json"
	protocol "monos.local/protocol"
	"monos.local/runner/internal/journal"
	"monos.local/runner/internal/wire"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func replanDispatch() protocol.Dispatch {
	d := planningDispatch()
	d.TaskPlanningSource = nil
	d.TaskReplanSource = &protocol.TaskReplanSource{RequestID: "replan", SourceID: "source", SpecificationID: "spec", PlanID: "old-plan", ControlVersion: 9, ContextDigest: strings.Repeat("a", 64)}
	return d
}

const replanPayload = `{"replan_request_id":"replan","source_id":"source","proposal_id":"proposal","plan_id":"new-plan","basis":{"control_version":9,"specification_id":"spec","plan_id":"old-plan"},"nodes":[{"node_id":"new-node","role_id":"role","goal":"修复完整目标","dependencies":[],"expected_outputs":[]}],"summary":"Replace insufficient work","impact":{"nodes":[{"node_id":"old-node","node_activation":1,"source_id":null,"completion_operation_id":null,"completion_manifest_digest":null,"disposition":"remove","target_node_id":null,"target_node_activation":null}],"guidance":[],"holds":[],"workspaces":[]}}`

func TestReplanCommandsAndImmutableJournalRestart(t *testing.T) {
	for _, tc := range []struct {
		name    protocol.CommandEnvelopeName
		payload string
	}{
		{"prepare_replan", replanPayload}, {"raise_planning_issue", `{"replan_request_id":"replan","source_id":"source","reason":"Need Owner direction"}`},
	} {
		t.Run(string(tc.name), func(t *testing.T) {
			raw, err := prepareEnvelope(replanDispatch(), Request{RequestID: "request", Name: tc.name, Payload: json.RawMessage(tc.payload)})
			if err != nil {
				t.Fatal(err)
			}
			env, err := wire.Envelope(raw)
			if err != nil || env.ScopeID != "task" || env.ExpectedControlVersion != 9 {
				t.Fatal(env, err)
			}
			root := t.TempDir()
			if err = os.Chmod(root, 0700); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(root, "journal.sqlite")
			db, err := journal.Open(path)
			if err != nil {
				t.Fatal(err)
			}
			original, err := db.PutRequest("attempt", raw)
			if err != nil {
				t.Fatal(err)
			}
			db.Close()
			db, err = journal.Open(path)
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			for _, edit := range [][2]string{{`"replan"`, `"other-request"`}, {`"source"`, `"other-source"`}, {`"expected_control_version":9`, `"expected_control_version":10`}, {"修复完整目标", "Changed definition"}} {
				changed := strings.Replace(string(raw), edit[0], edit[1], 1)
				if changed == string(raw) {
					continue
				}
				if _, err = db.PutRequest("attempt", []byte(changed)); err != journal.ErrConflict {
					t.Fatal("uncertain Replan replaced", edit, err)
				}
			}
			got, err := db.Request("attempt", "request")
			if err != nil || string(got.Raw) != string(original.Raw) || got.Digest != original.Digest {
				t.Fatal("retry changed", err)
			}
		})
	}
}
func TestReplanPhaseAndSourceBoundaries(t *testing.T) {
	for _, name := range []protocol.CommandEnvelopeName{"request_replan", "publish_execution_plan", "commit_task_turn", "complete_node", "open_workspace", "prepare_specification_revision", "apply_specification_revision", "read_task_context"} {
		if _, err := prepareEnvelope(replanDispatch(), Request{RequestID: "request", Name: name, Payload: json.RawMessage(`{}`)}); err == nil {
			t.Fatal("foreign command accepted", name)
		}
	}
	for _, payload := range []string{strings.Replace(replanPayload, `"source"`, `"foreign"`, 1), strings.Replace(replanPayload, `"replan"`, `"foreign"`, 1)} {
		if _, err := prepareEnvelope(replanDispatch(), Request{RequestID: "request", Name: "prepare_replan", Payload: json.RawMessage(payload)}); err == nil {
			t.Fatal("foreign identity accepted")
		}
	}
	for _, d := range []protocol.Dispatch{planningDispatch(), nodeDispatch(), conversationDispatch()} {
		if _, err := prepareEnvelope(d, Request{RequestID: "request", Name: "prepare_replan", Payload: json.RawMessage(replanPayload)}); err == nil {
			t.Fatal("foreign phase prepared graph")
		}
	}
	raw, err := prepareEnvelope(nodeDispatch(), Request{RequestID: "request", Name: "request_replan", Payload: json.RawMessage(`{"reason":"Current graph cannot satisfy requirement"}`)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = wire.Envelope(raw); err != nil {
		t.Fatal(err)
	}
	for _, d := range []protocol.Dispatch{planningDispatch(), conversationDispatch(), replanDispatch()} {
		if _, err := prepareEnvelope(d, Request{RequestID: "request", Name: "request_replan", Payload: json.RawMessage(`{"reason":"insufficient"}`)}); err == nil {
			t.Fatal("non Node requested terminal Replan")
		}
	}
}

func nodeDispatch() protocol.Dispatch {
	task, node := "task", "node"
	return protocol.Dispatch{TaskID: &task, NodeID: &node, Kind: protocol.Node, NodeActivation: 1, ControlVersion: 4, WorkspaceReservations: &protocol.WorkspaceReservations{ProjectID: "project"}, NodeExecutionSource: &protocol.NodeExecutionSource{SourceID: "source", NodeID: node, NodeActivation: 1, ControlVersion: 4, SpecificationID: "spec", PlanID: "plan", ContextDigest: strings.Repeat("a", 64)}}
}

func TestReplanWireRejectsMixedIssueAndChangedGraphShape(t *testing.T) {
	for _, tc := range []struct {
		name    protocol.CommandEnvelopeName
		payload string
	}{
		{"raise_planning_issue", `{"replan_request_id":"replan","source_id":"source","planning_intent_id":"fake","reason":"Need direction"}`},
		{"raise_planning_issue", `{"replan_request_id":"replan","reason":"Need direction"}`},
		{"request_replan", `{"reason":""}`},
		{"request_replan", `{"reason":"Need direction","source_id":"source"}`},
		{"prepare_replan", strings.Replace(replanPayload, `"holds":[]`, `"holds":[],"hidden_authorization":true`, 1)},
		{"prepare_replan", strings.Replace(replanPayload, `"dependencies":[]`, `"dependencies":null`, 1)},
	} {
		raw := []byte(`{"schema_version":1,"request_id":"request","scope_id":"task","expected_control_version":9,"name":"` + string(tc.name) + `","payload":` + tc.payload + `}`)
		if _, err := wire.Envelope(raw); err == nil {
			t.Fatal("invalid Replan wire accepted", tc.name, tc.payload)
		}
	}
}

func TestReplanAfterConversationCutoffRetainsOwnSourceAndVersion(t *testing.T) {
	d := replanDispatch()
	context, digest, err := wire.Canonical(map[string]any{"source_id": "source", "replan_request_id": "replan", "input_cutoff": 37, "event_cutoff": 82})
	if err != nil {
		t.Fatal(err)
	}
	d.Prompt = string(context)
	d.TaskReplanSource.ContextDigest = digest
	raw, err := prepareEnvelope(d, Request{RequestID: "request", Name: "prepare_replan", Payload: json.RawMessage(replanPayload)})
	if err != nil {
		t.Fatal(err)
	}
	e, err := wire.Envelope(raw)
	if err != nil || e.ExpectedControlVersion != 9 || e.ScopeID != "task" {
		t.Fatal("Conversation cutoff changed command ownership", err)
	}
	if d.Prompt != string(context) || d.TaskReplanSource.ContextDigest != digest || d.SourceWatermark != 0 {
		t.Fatal("frozen context changed")
	}
	d.SourceWatermark = 37
	if _, err = prepareEnvelope(d, Request{RequestID: "request", Name: "prepare_replan", Payload: json.RawMessage(replanPayload)}); err == nil {
		t.Fatal("noncanonical Conversation watermark accepted")
	}
}
