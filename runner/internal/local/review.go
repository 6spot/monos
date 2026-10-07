package local

import (
	"encoding/json"
	"fmt"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

// Review authority belongs to one immutable source, never to an old Node or
// Conversation. Backend admission independently rechecks its live obligation.
func prepareReviewEnvelope(d protocol.Dispatch, r Request, scope string) ([]byte, error) {
	s := d.TaskReviewSource
	switch r.Name {
	case "read_task_context", "read_task_history", "prepare_specification_revision":
	case "request_replan":
		if s.Purpose != "route_feedback" {
			return nil, fmt.Errorf("input Replan requires resolve_review_input routing")
		}
	case "apply_review_rework", "commit_review_feedback", "resolve_review_input", "raise_planning_issue":
		var p struct {
			FeedbackID        string `json:"feedback_id"`
			OperationID       string `json:"operation_id"`
			SourceID          string `json:"source_id"`
			OperationVersion  int64  `json:"operation_version"`
			ReconsiderationID string `json:"reconsideration_id"`
		}
		if err := json.Unmarshal(r.Payload, &p); err != nil || p.FeedbackID != s.FeedbackID || p.OperationID != s.OperationID || p.SourceID != s.SourceID || p.OperationVersion != s.OperationVersion {
			return nil, fmt.Errorf("review operation/source does not match this Attempt")
		}
		if (r.Name == "apply_review_rework" || r.Name == "commit_review_feedback") && s.Purpose != "route_feedback" {
			return nil, fmt.Errorf("main feedback outcome unavailable to input reconsideration")
		}
		if r.Name == "resolve_review_input" && (s.Purpose != "reconsider_input" || s.ReconsiderationID == nil || p.ReconsiderationID != *s.ReconsiderationID) {
			return nil, fmt.Errorf("input outcome requires the exact reconsideration source")
		}
	default:
		return nil, fmt.Errorf("command unavailable to Task review")
	}
	env := map[string]any{"schema_version": 1, "request_id": r.RequestID, "scope_id": scope, "name": r.Name, "expected_control_version": d.ControlVersion, "payload": r.Payload}
	raw, _, err := wire.Canonical(env)
	if err != nil {
		return nil, err
	}
	if _, err = wire.Envelope(raw); err != nil {
		return nil, err
	}
	return raw, nil
}
