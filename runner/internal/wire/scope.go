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
