package host

import (
	"fmt"
)

func validateRepositoryFreeWorkspace(r workspaceRecord, attemptID string) error {
	if !r.Released || r.Operation.AttemptID == attemptID {
		return fmt.Errorf("retained workspace requires finalization")
	}
	return nil
}
