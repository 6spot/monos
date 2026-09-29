package host

import (
	"fmt"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

// ValidateEffectScope protects both service-owned inspection and the privileged
// helper. Todo inspection must never fall through to the Task probe repository.
func ValidateEffectScope(d protocol.Dispatch, op protocol.Operation) error {
	if d.AttemptID != op.AttemptID || d.DispatchID != op.DispatchID {
		return fmt.Errorf("effect dispatch conflict")
	}
	if d.TodoID != nil {
		if _, err := wire.ScopeID(d); err != nil {
			return err
		}
		if op.Kind != protocol.Stop || op.ResourceID != nil {
			return fmt.Errorf("Todo repository effects are unavailable")
		}
		return nil
	}
	// Stop owns the process tree, not a repository. Retained legacy resource IDs
	// still have to match when present, while new resource-free Stop is valid.
	if op.Kind == protocol.Stop && op.ResourceID == nil {
		return nil
	}
	if op.ResourceID == nil || !wire.SameResource(d.ResourceID, op.ResourceID) {
		return fmt.Errorf("effect resource conflict")
	}
	return nil
}
