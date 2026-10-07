package wire

import (
	"encoding/json"
	"fmt"

	protocol "monos.local/protocol"
)

// ScopeID uses authenticated dispatch ownership, never a caller's scope hint.
// Legacy Task dispatches keep their original scope and envelope bytes.
func ScopeID(d protocol.Dispatch) (string, error) {
	if (d.TaskID == nil) == (d.TodoID == nil) {
		return "", fmt.Errorf("dispatch must have exactly one Todo or Task scope")
	}
	sources := 0
	if d.NodeExecutionSource != nil {
		sources++
	}
	if d.TaskPlanningSource != nil {
		sources++
	}
	if d.TaskConversationSource != nil {
		sources++
	}
	if d.TaskReplanSource != nil {
		sources++
	}
	if d.TaskReviewSource != nil {
		sources++
	}
	if sources > 1 {
		return "", fmt.Errorf("dispatch has conflicting canonical sources")
	}
	if d.TaskReviewSource != nil {
		s := d.TaskReviewSource
		if d.TaskID == nil || d.Kind != "planner" || d.NodeID != nil || d.NodeActivation != 0 || d.ResourceID != nil || d.SourceMessageID != nil || d.SourceWatermark != 0 || d.ControlVersion != s.ControlVersion || d.WorkspaceReservations == nil || len(d.WorkspaceReservations.Resources) != 0 {
			return "", fmt.Errorf("invalid Task review source ownership")
		}
		raw, err := json.Marshal(s)
		if err != nil {
			return "", err
		}
		if err = Validate("TaskReviewSource", raw); err != nil {
			return "", err
		}
	}
	if d.TaskReplanSource != nil {
		s := d.TaskReplanSource
		if d.TaskID == nil || d.Kind != "planner" || d.NodeID != nil || d.NodeActivation != 0 || d.ResourceID != nil || d.SourceMessageID != nil || d.SourceWatermark != 0 || d.ControlVersion != s.ControlVersion || d.WorkspaceReservations == nil || len(d.WorkspaceReservations.Resources) != 0 {
			return "", fmt.Errorf("invalid Task Replan source ownership")
		}
		raw, err := json.Marshal(s)
		if err != nil {
			return "", err
		}
		if err = Validate("TaskReplanSource", raw); err != nil {
			return "", err
		}
	}
	if d.TaskConversationSource != nil {
		s := d.TaskConversationSource
		if d.TaskID == nil || d.Kind != "planner" || d.NodeID != nil || d.NodeActivation != 0 || d.ResourceID != nil || d.SourceMessageID != nil || d.SourceWatermark != s.SourceWatermark || d.ControlVersion != s.ConversationVersion || d.WorkspaceReservations == nil || len(d.WorkspaceReservations.Resources) != 0 {
			return "", fmt.Errorf("invalid Task conversation source ownership")
		}
		raw, err := json.Marshal(s)
		if err != nil {
			return "", err
		}
		if err = Validate("TaskConversationSource", raw); err != nil {
			return "", err
		}
	}
	if d.NodeExecutionSource != nil {
		s := d.NodeExecutionSource
		if d.TaskID == nil || d.Kind != protocol.Node || d.NodeID == nil || *d.NodeID != s.NodeID || d.NodeActivation != s.NodeActivation || d.ControlVersion != s.ControlVersion || d.TaskPlanningSource != nil || d.ResourceID != nil || d.SourceMessageID != nil || d.SourceWatermark != 0 || d.WorkspaceReservations == nil {
			return "", fmt.Errorf("invalid canonical Node source ownership")
		}
		raw, err := json.Marshal(s)
		if err != nil {
			return "", err
		}
		if err = Validate("NodeExecutionSource", raw); err != nil {
			return "", err
		}
	}
	if d.TaskPlanningSource != nil {
		if d.TaskID == nil || d.Kind != "planner" || d.NodeID != nil || d.NodeActivation != 0 || d.ResourceID != nil || d.SourceMessageID != nil || d.SourceWatermark != 0 || d.WorkspaceReservations == nil || len(d.WorkspaceReservations.Resources) != 0 {
			return "", fmt.Errorf("invalid initial Task Planner ownership")
		}
		raw, err := json.Marshal(d.TaskPlanningSource)
		if err != nil {
			return "", err
		}
		if err = Validate("TaskPlanningSource", raw); err != nil {
			return "", err
		}
	}
	if d.TodoID != nil {
		if *d.TodoID == "" || d.Kind != "planner" || d.NodeID != nil || d.NodeActivation != 0 || d.ResourceID != nil || d.SourceMessageID == nil || *d.SourceMessageID == "" {
			return "", fmt.Errorf("invalid Todo Planner ownership")
		}
		return *d.TodoID, nil
	}
	if *d.TaskID == "" {
		return "", fmt.Errorf("missing Task scope")
	}
	return *d.TaskID, nil
}

// SameResource compares the retained resource identity, including its absence.
// JSON round trips allocate fresh pointers; pointer identity is not wire identity.
func SameResource(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
