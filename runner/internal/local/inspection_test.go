package local

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/journal"
	"monos.local/runner/internal/wire"
)

func inspectionDispatches() map[string]protocol.Dispatch {
	todo, message := "todo", "message"
	replyOnly := conversationDispatch()
	replyOnly.TaskConversationSource.ReplyOnly = true
	inputReview := reviewDispatch()
	input, reconsideration := "input", "reconsideration"
	inputReview.TaskReviewSource.Purpose = "reconsider_input"
	inputReview.TaskReviewSource.InputID = &input
	inputReview.TaskReviewSource.ReconsiderationID = &reconsideration
	return map[string]protocol.Dispatch{
		"todo_discussion":       {AttemptID: "attempt", TodoID: &todo, SourceMessageID: &message, SourceWatermark: 5, Kind: "planner", ControlVersion: 7},
		"task_initial_planning": planningDispatch(),
		"task_conversation":     conversationDispatch(),
		"terminal_conversation": replyOnly,
		"task_replan":           replanDispatch(),
		"task_review":           reviewDispatch(),
		"review_input":          inputReview,
	}
}

func TestInspectionRetainsPlannerSourceVersionAndImmutableRequest(t *testing.T) {
	for name, d := range inspectionDispatches() {
		t.Run(name, func(t *testing.T) {
			d.AttemptID = "attempt"
			request := Request{RequestID: "inspect", Name: protocol.NameInspectRepository, Payload: json.RawMessage(`{"resource_id":"repo"}`)}
			raw, err := prepareEnvelope(d, request)
			if err != nil {
				t.Fatal(err)
			}
			envelope, err := wire.Envelope(raw)
			if err != nil {
				t.Fatal(err)
			}
			scope := "task"
			if d.TodoID != nil {
				scope = *d.TodoID
			}
			if envelope.ScopeID != scope || envelope.ExpectedControlVersion != d.ControlVersion || envelope.Name != request.Name || envelope.Payload.ResourceID == nil || *envelope.Payload.ResourceID != "repo" {
				t.Fatal("inspection replaced frozen authority or payload")
			}
			dir := t.TempDir()
			if err = os.Chmod(dir, 0700); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(dir, "journal.sqlite")
			db, err := journal.Open(path)
			if err != nil {
				t.Fatal(err)
			}
			retained, err := db.PutRequest(d.AttemptID, raw)
			if err != nil {
				t.Fatal(err)
			}
			db.Close()
			db, err = journal.Open(path)
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			for _, changed := range [][]byte{
				bytes.Replace(raw, []byte(`"repo"`), []byte(`"other-repo"`), 1),
				bytes.Replace(raw, []byte(`"expected_control_version":`), []byte(`"expected_control_version":1`), 1),
			} {
				if _, err = db.PutRequest(d.AttemptID, changed); err != journal.ErrConflict {
					t.Fatal("inspection retry replaced immutable input", err)
				}
			}
			got, err := db.Request(d.AttemptID, request.RequestID)
			if err != nil || !bytes.Equal(got.Raw, raw) || got.Digest != retained.Digest {
				t.Fatal("inspection replay changed after journal restart", err)
			}
		})
	}
}

func TestInspectionRejectsNodeLegacyAndConflictingAuthority(t *testing.T) {
	for _, mode := range []string{"node", "legacy-planner", "missing-todo-source", "mixed-sources", "conversation-version", "conversation-watermark", "replan-version", "review-version", "wrong-kind"} {
		t.Run(mode, func(t *testing.T) {
			d := planningDispatch()
			switch mode {
			case "node":
				d = nodeDispatch()
			case "legacy-planner":
				d.TaskPlanningSource = nil
			case "missing-todo-source":
				d = inspectionDispatches()["todo_discussion"]
				d.SourceMessageID = nil
			case "mixed-sources":
				d.TaskReviewSource = reviewDispatch().TaskReviewSource
			case "conversation-version":
				d = conversationDispatch()
				d.ControlVersion++
			case "conversation-watermark":
				d = conversationDispatch()
				d.SourceWatermark++
			case "replan-version":
				d = replanDispatch()
				d.ControlVersion++
			case "review-version":
				d = reviewDispatch()
				d.ControlVersion++
			case "wrong-kind":
				d.Kind = protocol.Node
			}
			if _, err := prepareEnvelope(d, Request{RequestID: "inspect", Name: protocol.NameInspectRepository, Payload: json.RawMessage(`{"resource_id":"repo"}`)}); err == nil {
				t.Fatal("noncanonical inspection authority accepted")
			}
		})
	}
}

func TestInspectionRejectsPayloadAuthorityAndMissingResource(t *testing.T) {
	for name, d := range inspectionDispatches() {
		t.Run(name, func(t *testing.T) {
			for _, payload := range []string{`{}`, `{"resource_id":""}`, `{"resource_id":"repo","source_id":"other"}`, `{"resource_id":"repo","expected_control_version":99}`} {
				if _, err := prepareEnvelope(d, Request{RequestID: "inspect", Name: protocol.NameInspectRepository, Payload: json.RawMessage(payload)}); err == nil {
					t.Fatal("invalid inspection input accepted", payload)
				}
			}
		})
	}
}
