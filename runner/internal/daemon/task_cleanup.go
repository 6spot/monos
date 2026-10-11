package daemon

import (
	"context"
	"fmt"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
)

func (*Daemon) SupportsTaskCleanup() bool { return true }

func (d *Daemon) taskCleanup(ctx context.Context, request protocol.TaskCleanupRequest) error {
	if _, err := host.ValidateTaskCleanup(request); err != nil {
		return err
	}
	if request.RunnerID != d.Control.Config.RunnerID {
		return fmt.Errorf("Task cleanup Runner mismatch")
	}
	digest, old, err := d.DB.BeginTaskCleanup(request)
	if err != nil {
		return err
	}
	if old != nil && old.Status == "completed" {
		return d.Control.Send(ctx, protocol.Frame{Type: "task_cleanup_result", CleanupResult: old})
	}
	result := protocol.TaskCleanupResult{SchemaVersion: 1, CleanupID: request.CleanupID, RequestDigest: digest, Status: "blocked"}
	reason := protocol.TaskCleanupResultReason("ownership_unresolved")
	result.Reason = &reason
	bounded, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	if err = d.validateTaskCleanup(request); err == nil {
		status, callErr := d.Host.Call(bounded, host.Request{Action: "cleanup_task", CleanupRequest: &request})
		if callErr == nil && status.CleanupResult != nil && status.CleanupResult.CleanupID == request.CleanupID && status.CleanupResult.RequestDigest == digest {
			result = *status.CleanupResult
		} else {
			reason = "cleanup_failed"
		}
	}
	if err = d.DB.FinishTaskCleanup(result); err != nil {
		return err
	}
	return d.Control.Send(ctx, protocol.Frame{Type: "task_cleanup_result", CleanupResult: &result})
}

func (d *Daemon) validateTaskCleanup(request protocol.TaskCleanupRequest) error {
	expected := map[string]string{}
	for _, a := range request.Attempts {
		expected[a.AttemptID] = a.DispatchID
	}
	starts, err := d.DB.Starts()
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, s := range starts {
		if s.Dispatch.TaskID == nil || *s.Dispatch.TaskID != request.TaskID {
			continue
		}
		if host.CleanupAllowsConversation(request, s.Dispatch) {
			continue
		}
		if expected[s.Dispatch.AttemptID] != s.Dispatch.DispatchID || s.Dispatch.RunnerID != request.RunnerID || (s.Phase != "absent" && s.Phase != "revoked") {
			return fmt.Errorf("Task cleanup has unresolved local Attempt")
		}
		terminal, err := d.DB.AttemptEffectsTerminal(s.Dispatch.AttemptID)
		if err != nil {
			return err
		}
		if !terminal {
			return fmt.Errorf("Task cleanup has unresolved local operation")
		}
		seen[s.Dispatch.AttemptID] = true
	}
	if len(seen) != len(expected) {
		return fmt.Errorf("Task cleanup Attempt journal missing")
	}
	for _, identity := range request.Results {
		if err = retainedResultIdentity(d.DB, identity); err != nil {
			return err
		}
	}
	return nil
}
