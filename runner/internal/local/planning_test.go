package local

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/journal"
	"monos.local/runner/internal/wire"
)

func planningDispatch() protocol.Dispatch {
	task := "task"
	return protocol.Dispatch{AttemptID: "attempt", TaskID: &task, Kind: "planner", ControlVersion: 9, TaskPlanningSource: &protocol.TaskPlanningSource{IntentID: "intent", SpecificationID: "spec", ContextDigest: strings.Repeat("a", 64)}, WorkspaceReservations: &protocol.WorkspaceReservations{ProjectID: "project", Resources: []protocol.WorkspaceReservation{}}}
}

func TestInitialPlanningCommandsRetainExactTaskSourceAndPayload(t *testing.T) {
	d := planningDispatch()
	for _, test := range []struct {
		name    protocol.CommandEnvelopeName
		payload string
	}{
		{protocol.PublishExecutionPlan, `{"planning_intent_id":"intent","plan_id":"plan","nodes":[{"node_id":"node","role_id":"role","goal":"Keep the full objective","dependencies":[],"hard_requirements":["Preserve compatibility"],"expected_outputs":["Validated result"],"consumes":[]}]}`},
		// Structurally valid unsupported plans must reach the backend unchanged
		// so it can explain the one-Node and Artifact limits to this Planner.
		{protocol.PublishExecutionPlan, `{"planning_intent_id":"intent","plan_id":"plan","nodes":[{"node_id":"first","role_id":"role","goal":"Prepare","dependencies":[],"hard_requirements":[],"expected_outputs":[]},{"node_id":"second","role_id":"role","goal":"Finish","dependencies":["first"],"consumes":["artifact"]}]}`},
		{protocol.RaisePlanningIssue, `{"planning_intent_id":"intent","reason":"Which conflicting requirement takes precedence?"}`},
	} {
		t.Run(string(test.name), func(t *testing.T) {
			raw, err := prepareEnvelope(d, Request{RequestID: "request", Name: test.name, Payload: json.RawMessage(test.payload)})
			if err != nil {
				t.Fatal(err)
			}
			envelope, err := wire.Envelope(raw)
			if err != nil || envelope.ScopeID != *d.TaskID || envelope.ExpectedControlVersion != d.ControlVersion || envelope.Payload.PlanningIntentID == nil || *envelope.Payload.PlanningIntentID != d.TaskPlanningSource.IntentID {
				t.Fatal("planning source, scope or expected version changed", string(raw), err)
			}
			var members map[string]json.RawMessage
			if err := json.Unmarshal(raw, &members); err != nil {
				t.Fatal(err)
			}
			expected, _, _ := wire.CanonicalRaw([]byte(test.payload))
			if string(members["payload"]) != string(expected) {
				t.Fatal("planning requirements or empty arrays were rewritten")
			}
			dir := t.TempDir()
			if err := os.Chmod(dir, 0700); err != nil {
				t.Fatal(err)
			}
			db, err := journal.Open(filepath.Join(dir, "journal.sqlite"))
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			retained, err := db.PutRequest(d.AttemptID, raw)
			if err != nil {
				t.Fatal(err)
			}
			retry, err := db.Request(d.AttemptID, "request")
			if err != nil || string(retry.Raw) != string(raw) || retry.Digest != retained.Digest {
				t.Fatal("planning retry replaced the immutable request", err)
			}
		})
	}
}

func TestInitialPlanningAuthorityCannotComeFromAnotherPhaseOrIntent(t *testing.T) {
	for _, mode := range []string{"node", "todo", "legacy-planner", "other-task-phase", "wrong-intent", "missing-intent"} {
		t.Run(mode, func(t *testing.T) {
			d := planningDispatch()
			intent := "intent"
			switch mode {
			case "node":
				d.TaskPlanningSource, d.Kind = nil, protocol.Node
			case "todo":
				todo, message := "todo", "message"
				d.TaskID, d.TaskPlanningSource, d.WorkspaceReservations = nil, nil, nil
				d.TodoID, d.SourceMessageID = &todo, &message
			case "legacy-planner":
				d.TaskPlanningSource, d.WorkspaceReservations = nil, nil
			case "other-task-phase":
				d.TaskPlanningSource = nil
			case "wrong-intent":
				intent = "other-intent"
			case "missing-intent":
				intent = ""
			}
			for _, command := range []protocol.CommandEnvelopeName{protocol.PublishExecutionPlan, protocol.RaisePlanningIssue} {
				payload := map[string]any{"reason": "Need Owner direction"}
				if command == protocol.PublishExecutionPlan {
					payload = map[string]any{"plan_id": "plan", "nodes": []any{map[string]any{"node_id": "node", "role_id": "role", "goal": "Perform work", "dependencies": []string{}}}}
				}
				if intent != "" {
					payload["planning_intent_id"] = intent
				}
				raw, err := json.Marshal(payload)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := prepareEnvelope(d, Request{RequestID: "request", Name: command, Payload: raw}); err == nil {
					t.Fatal("unbound phase acquired initial planning authority", command)
				}
			}
		})
	}
	for _, command := range []protocol.CommandEnvelopeName{protocol.CommitTaskTurn, protocol.CommitDiscussionTurn, protocol.NameCompleteNode, protocol.NameOpenWorkspace, protocol.ReadDiscussion, protocol.UpdateWorkingRequirementState} {
		if _, err := prepareEnvelope(planningDispatch(), Request{RequestID: "request", Name: command, Payload: json.RawMessage(`{}`)}); err == nil {
			t.Fatal("initial Planner acquired another phase's tool", command)
		}
	}
	// The backend admits inspection against the canonical frozen source.
	if _, err := prepareEnvelope(planningDispatch(), Request{RequestID: "inspect", Name: protocol.NameInspectRepository, Payload: json.RawMessage(`{"resource_id":"repo"}`)}); err != nil {
		t.Fatal("inspection could not reach canonical admission", err)
	}
}
