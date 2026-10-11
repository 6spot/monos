package daemon

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/journal"
)

func (d *Daemon) scheduleMaintenance(ctx context.Context) {
	if d.Resources == nil || !d.maintenanceMu.TryLock() {
		return
	}
	if time.Since(d.lastMaintenance) < time.Minute {
		d.maintenanceMu.Unlock()
		return
	}
	d.lastMaintenance = time.Now()
	go func() {
		defer d.maintenanceMu.Unlock()
		bounded, cancel := context.WithTimeout(ctx, 20*time.Second)
		defer cancel()
		if err := d.maintain(bounded, time.Now()); err != nil && bounded.Err() == nil {
			log.Print("Runner retention deferred: ", err)
		}
	}()
}

// Maintenance has its own bounded lane. Network confirmation and inspection
// removal never hold the lifecycle mutex needed by Stop and reconciliation.
func (d *Daemon) maintain(ctx context.Context, now time.Time) error {
	starts, err := d.DB.Starts()
	if err != nil {
		return err
	}
	checked := 0
	for _, s := range starts {
		id := s.Dispatch.AttemptID
		if id <= d.maintenanceCursor {
			continue
		}
		d.maintenanceCursor = id
		if s.Phase != "absent" {
			continue
		}
		checked++
		since, ready, err := d.DB.RetentionSince(id, s.Dispatch.DispatchID, now.Unix())
		if err != nil {
			return err
		}
		if ready {
			if err = d.retireAttemptLogs(ctx, s, since, now); err != nil {
				return err
			}
			if since <= now.Add(-time.Duration(d.Resources.Config.InspectionRetentionHours)*time.Hour).Unix() {
				if err = d.retireAttemptInspections(ctx, s, now); err != nil {
					return err
				}
			}
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if checked >= 8 {
			return nil
		}
	}
	d.maintenanceCursor = ""
	return nil
}

func (d *Daemon) retireAttemptLogs(ctx context.Context, s journal.Start, since int64, now time.Time) error {
	cutoff := now.Add(-time.Duration(d.Resources.Config.LogRetentionHours) * time.Hour).Unix()
	if since > cutoff {
		return nil
	}
	// Tick and Start/effect bookkeeping use this same lock. Holding it only for
	// this local fixed-path operation prevents an old Tick reader from treating
	// the intentionally removed spool as a capture failure.
	if !d.mu.TryLock() {
		return nil
	}
	defer d.mu.Unlock()
	bounded, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	r, err := d.DB.LogRetirement(s.Dispatch.AttemptID)
	if err != nil {
		return err
	}
	if r != nil && r.Cleaned {
		return nil
	}
	status, err := d.Host.Call(bounded, host.Request{Action: "status", AttemptID: s.Dispatch.AttemptID})
	if err != nil {
		return err
	}
	if !status.Known || status.Populated {
		return fmt.Errorf("retained log writer absence unresolved")
	}
	if r == nil {
		sizes := map[string]int64{}
		for _, stream := range []string{"stdout", "stderr"} {
			info, e := os.Lstat(filepath.Join(host.Root, "logs", s.Dispatch.AttemptID+"."+stream))
			if e != nil {
				return e
			}
			if !info.Mode().IsRegular() {
				return fmt.Errorf("retained spool is not a regular file")
			}
			sizes[stream] = info.Size()
		}
		r, err = d.DB.RetireLogs(s.Dispatch.AttemptID, s.Dispatch.DispatchID, sizes["stdout"], sizes["stderr"], cutoff)
		if err != nil {
			return err
		}
	}
	retiredStatus, err := d.Host.Call(bounded, host.Request{Action: "retire_logs", AttemptID: s.Dispatch.AttemptID, LogRetirement: &host.LogRetirement{DispatchID: r.DispatchID, StdoutBytes: r.StdoutBytes, StderrBytes: r.StderrBytes}})
	if err != nil {
		return err
	}
	if !retiredStatus.Known || retiredStatus.Populated {
		return fmt.Errorf("log retirement outcome unresolved")
	}
	return d.DB.FinishLogRetirement(*r)
}

func (d *Daemon) retireAttemptInspections(ctx context.Context, s journal.Start, now time.Time) error {
	ops, err := d.DB.Inspections(s.Dispatch.AttemptID)
	if err != nil {
		return err
	}
	if len(ops) == 0 {
		return nil
	}
	status, err := d.Host.Call(ctx, host.Request{Action: "status", AttemptID: s.Dispatch.AttemptID})
	if err != nil {
		return err
	}
	if !status.Known || status.Populated {
		return fmt.Errorf("inspection reader absence unresolved")
	}
	processed := 0
	for _, op := range ops {
		complete, err := d.DB.InspectionRetirementComplete(op.OperationID)
		if err != nil {
			return err
		}
		if complete {
			continue
		}
		if processed >= 8 {
			break
		}
		processed++
		d.inspectionMu.Lock()
		active := d.inspections[op.OperationID] != nil
		d.inspectionMu.Unlock()
		if active {
			continue
		}
		var remote protocol.Operation
		if err = d.Control.Get(ctx, "/v1/recovery/operations/"+op.OperationID, "Operation", &remote); err != nil {
			return err
		}
		cutoff := now.Add(-time.Duration(d.Resources.Config.InspectionRetentionHours) * time.Hour).Unix()
		if err = d.DB.RetireInspection(remote, cutoff); err != nil {
			return err
		}
		if err = host.RetireInspection(ctx, remote); err != nil {
			return err
		}
		if err = d.DB.FinishInspectionRetirement(op.OperationID); err != nil {
			return err
		}
	}
	return nil
}
