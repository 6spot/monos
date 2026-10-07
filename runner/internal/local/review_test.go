package local

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/journal"
	"monos.local/runner/internal/wire"
)

func reviewDispatch() protocol.Dispatch {
	d := replanDispatch()
	d.TaskReplanSource = nil
	d.TaskReviewSource = &protocol.TaskReviewSource{FeedbackID: "feedback", OperationID: "operation", OperationVersion: 2, SourceID: "source", SpecificationID: "spec", PlanID: "old-plan", ControlVersion: 9, ReviewResultDigest: strings.Repeat("b", 64), ContextDigest: strings.Repeat("a", 64), Purpose: "route_feedback"}
	return d
}

const reviewRework = `{"feedback_id":"feedback","operation_id":"operation","operation_version":2,"source_id":"source","basis":{"control_version":9,"specification_id":"spec","plan_id":"old-plan"},"node_ids":["node"],"reason":"Fix reviewed result"}`

func TestTaskReviewImmutableOutcomeJournal(t *testing.T) {
	raw, err := prepareEnvelope(reviewDispatch(), Request{RequestID: "request", Name: "apply_review_rework", Payload: json.RawMessage(reviewRework)})
	if err != nil {
		t.Fatal(err)
	}
	env, err := wire.Envelope(raw)
	if err != nil || env.ScopeID != "task" || env.ExpectedControlVersion != 9 {
		t.Fatal(env, err)
	}
	root := t.TempDir()
	if err := os.Chmod(root, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "journal.sqlite")
	db, err := journal.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	retained, err := db.PutRequest("attempt", raw)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	db, err = journal.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, change := range [][2]string{{`"operation"`, `"other-operation"`}, {`"operation_version":2`, `"operation_version":3`}, {`"source"`, `"fresh-source"`}, {`Fix reviewed result`, `Different Owner direction`}} {
		if _, err = db.PutRequest("attempt", []byte(strings.Replace(string(raw), change[0], change[1], 1))); err != journal.ErrConflict {
			t.Fatal("uncertain review replaced", err)
		}
	}
	got, err := db.Request("attempt", "request")
	if err != nil || string(got.Raw) != string(retained.Raw) || got.Digest != retained.Digest {
		t.Fatal("review retry changed", err)
	}
}

func TestTaskReviewPhaseIdentityAndHostBoundaries(t *testing.T) {
	d := reviewDispatch()
	for _, name := range []protocol.CommandEnvelopeName{"commit_task_turn", "complete_node", "open_workspace", "publish_artifact", "apply_specification_revision", "prepare_replan", "publish_execution_plan"} {
		if _, err := prepareEnvelope(d, Request{RequestID: "request", Name: name, Payload: json.RawMessage(`{}`)}); err == nil {
			t.Fatal("foreign phase accepted", name)
		}
	}
	for _, change := range [][2]string{{`"operation"`, `"other"`}, {`"feedback"`, `"other"`}, {`"source"`, `"other"`}, {`"operation_version":2`, `"operation_version":3`}, {`"node_ids":["node"]`, `"node_ids":[]`}} {
		if _, err := prepareEnvelope(d, Request{RequestID: "request", Name: "apply_review_rework", Payload: json.RawMessage(strings.Replace(reviewRework, change[0], change[1], 1))}); err == nil {
			t.Fatal("wrong review identity accepted", change)
		}
	}
	for _, foreign := range []protocol.Dispatch{planningDispatch(), conversationDispatch(), nodeDispatch(), replanDispatch()} {
		if _, err := prepareEnvelope(foreign, Request{RequestID: "request", Name: "apply_review_rework", Payload: json.RawMessage(reviewRework)}); err == nil {
			t.Fatal("foreign source acquired review outcome")
		}
	}
	for _, change := range []func(*protocol.Dispatch){func(d *protocol.Dispatch) { d.ControlVersion++ }, func(d *protocol.Dispatch) { id := "node"; d.NodeID = &id }, func(d *protocol.Dispatch) { d.TaskReplanSource = replanDispatch().TaskReplanSource }, func(d *protocol.Dispatch) { d.WorkspaceReservations = nil }} {
		bad := d
		change(&bad)
		if _, err := wire.ScopeID(bad); err == nil {
			t.Fatal("review ownership accepted")
		}
	}
	op := protocol.Operation{AttemptID: d.AttemptID, DispatchID: d.DispatchID, Kind: protocol.Stop}
	if err := host.ValidateEffectScope(d, op); err != nil {
		t.Fatal(err)
	}
	op.Kind = protocol.KindOpenWorkspace
	if host.ValidateEffectScope(d, op) == nil {
		t.Fatal("review gained writable effect")
	}
}

func TestReviewInputOutcomeCannotResolveFeedback(t *testing.T) {
	d := reviewDispatch()
	d.TaskReviewSource.Purpose = "reconsider_input"
	input, id := "input", "reconsideration"
	d.TaskReviewSource.InputID = &input
	d.TaskReviewSource.ReconsiderationID = &id
	if _, err := prepareEnvelope(d, Request{RequestID: "request", Name: "request_replan", Payload: json.RawMessage(`{"reason":"Insufficient graph"}`)}); err == nil {
		t.Fatal("input bypassed canonical reconsideration routing")
	}
	if _, err := prepareEnvelope(reviewDispatch(), Request{RequestID: "request", Name: "request_replan", Payload: json.RawMessage(`{"reason":"Insufficient graph"}`)}); err != nil {
		t.Fatal("main feedback lost genuine Replan authority", err)
	}
	if _, err := prepareEnvelope(d, Request{RequestID: "request", Name: "apply_review_rework", Payload: json.RawMessage(reviewRework)}); err == nil {
		t.Fatal("input resolved main feedback")
	}
	p := `{"feedback_id":"feedback","operation_id":"operation","operation_version":2,"source_id":"source","basis":{"control_version":9,"specification_id":"spec","plan_id":"old-plan"},"reconsideration_id":"reconsideration","summary":"No implementation change","routing":{"kind":"reply"}}`
	if _, err := prepareEnvelope(d, Request{RequestID: "request", Name: "resolve_review_input", Payload: json.RawMessage(p)}); err != nil {
		t.Fatal(err)
	}
	replan := strings.Replace(p, `{"kind":"reply"}`, `{"kind":"replan","basis":{"control_version":9,"specification_id":"spec","plan_id":"old-plan"},"text":"Insufficient graph"}`, 1)
	if _, err := prepareEnvelope(d, Request{RequestID: "request", Name: "resolve_review_input", Payload: json.RawMessage(replan)}); err != nil {
		t.Fatal("canonical input Replan unavailable", err)
	}
	if _, err := prepareEnvelope(reviewDispatch(), Request{RequestID: "request", Name: "resolve_review_input", Payload: json.RawMessage(p)}); err == nil {
		t.Fatal("main feedback gained input authority")
	}
	if _, err := prepareEnvelope(d, Request{RequestID: "request", Name: "resolve_review_input", Payload: json.RawMessage(strings.Replace(p, `"reconsideration"`, `"other"`, 1))}); err == nil {
		t.Fatal("foreign reconsideration accepted")
	}
}
