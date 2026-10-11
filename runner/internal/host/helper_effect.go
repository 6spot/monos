package host

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func unitProperties(ctx context.Context, unit string) (map[string]string, error) {
	out, err := command(ctx, "/usr/bin/systemctl", "show", unit, "--property=LoadState,ActiveState,MainPID,ControlGroup,Transient,User,Group,Description,Result,ExecMainCode,ExecMainStatus")
	if err != nil {
		return nil, err
	}
	values := map[string]string{}
	for _, line := range strings.Split(string(out), "\n") {
		if key, value, ok := strings.Cut(line, "="); ok {
			values[key] = value
		}
	}
	if values["LoadState"] == "" {
		return nil, fmt.Errorf("missing unit inventory")
	}
	return values, nil
}
func requireAbsentUnit(ctx context.Context, unit string) error {
	values, err := unitProperties(ctx, unit)
	if err != nil {
		return err
	}
	if values["LoadState"] != "not-found" {
		return fmt.Errorf("unit already exists; ownership requires reconciliation")
	}
	return nil
}

func confirmNeverLaunched(ctx context.Context, id string) error {
	if err := requireAbsentUnit(ctx, Unit(id)); err != nil {
		return err
	}
	path := "/sys/fs/cgroup/system.slice/" + Unit(id)
	if _, err := os.Lstat(path); err == nil {
		return fmt.Errorf("unclaimed Attempt cgroup exists")
	} else if !os.IsNotExist(err) {
		return err
	}
	jobs, err := command(ctx, "/usr/bin/systemctl", "list-jobs", "--no-legend", "--plain", "--no-pager")
	if err != nil {
		return err
	}
	for _, line := range strings.Split(strings.TrimSpace(string(jobs)), "\n") {
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 4 {
			return fmt.Errorf("unrecognized systemd job inventory")
		}
		if fields[1] == Unit(id) {
			return fmt.Errorf("Attempt launch job remains pending")
		}
	}
	paths, err := filepath.Glob(filepath.Join(Root, "launch", "*.operation.json"))
	if err != nil {
		return err
	}
	for _, path := range paths {
		record, err := readOperation(path)
		if err != nil {
			return err
		}
		if record.Operation.AttemptID == id {
			return fmt.Errorf("existing operation requires ownership reconciliation")
		}
	}
	return nil
}
func validateUnit(values map[string]string, unit, description string) error {
	if values["Transient"] != "yes" || values["User"] != "me" || values["Group"] != "monos-probe-read" || values["Description"] != description {
		return fmt.Errorf("unit ownership mismatch")
	}
	if group := values["ControlGroup"]; group != "" && group != "/system.slice/"+unit {
		return fmt.Errorf("unit cgroup mismatch")
	}
	return nil
}

type operationRecord struct {
	Completion      *completionProgress `json:"completion,omitempty"`
	Operation       protocol.Operation  `json:"operation"`
	BootID          string              `json:"boot_id"`
	Settled         bool                `json:"settled"`
	Status          Status              `json:"status"`
	WorkspaceAction string              `json:"workspace_action,omitempty"`
}

func operationPath(id string) string { return filepath.Join(Root, "launch", id+".operation.json") }
func operationUnit(id string) string { return "monos-probe-o-" + id + ".service" }
func readOperation(path string) (operationRecord, error) {
	var record operationRecord
	if err := trustedFile(path, 0); err != nil {
		return record, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return record, err
	}
	if err = json.Unmarshal(raw, &record); err != nil {
		return record, err
	}
	if !ValidID(record.Operation.AttemptID) || !ValidID(record.Operation.OperationID) || record.BootID == "" || operationPath(record.Operation.OperationID) != path {
		return record, fmt.Errorf("invalid operation ownership record")
	}
	return record, nil
}
func checkOperationWriters(ctx context.Context, attempt, boot string) error {
	paths, err := filepath.Glob(filepath.Join(Root, "launch", "*.operation.json"))
	if err != nil {
		return err
	}
	for _, path := range paths {
		record, err := readOperation(path)
		if err != nil {
			return err
		}
		if record.Operation.AttemptID != attempt || record.Settled || record.BootID != boot {
			continue
		}
		if record.Operation.Workspace != nil || record.Operation.Workspaces != nil || record.Operation.Kind == protocol.SettleCompletion {
			// Canonical effects have independent durable cgroup ownership. Agent
			// process inspection must remain usable so an admitted Stop can settle
			// an unavailable fetch; backend lease barriers still retain the effect.
			continue
		}
		values, err := unitProperties(ctx, operationUnit(record.Operation.OperationID))
		if err != nil {
			return err
		}
		if values["LoadState"] != "not-found" {
			if err = validateUnit(values, operationUnit(record.Operation.OperationID), "monos probe operation "+record.Operation.OperationID); err != nil {
				return err
			}
		}
		// A cancelled systemd-run may have submitted the job before losing its
		// acknowledgement. Absence alone must not turn that uncertainty into a
		// replacement writer. Preserve the record for explicit reconciliation.
		return fmt.Errorf("system operation ownership unresolved: %s", record.Operation.OperationID)
	}
	return nil
}
func sameOperation(a, b protocol.Operation) bool { return wire.SameOperation(a, b) }

func rootMaterializationBase(op protocol.Operation) (string, error) {
	paths, err := filepath.Glob(filepath.Join(Root, "launch", "*.operation.json"))
	if err != nil {
		return "", err
	}
	base := ""
	for _, path := range paths {
		record, err := readOperation(path)
		if err != nil {
			return "", err
		}
		if record.Operation.AttemptID != op.AttemptID || record.Operation.Kind != protocol.KindOpenWorkspace || !record.Settled || record.Status.Error != "" {
			continue
		}
		if record.Operation.DispatchID != op.DispatchID || !wire.SameResource(record.Operation.ResourceID, op.ResourceID) {
			return "", fmt.Errorf("materialization ownership mismatch")
		}
		value := record.Status.MaterializationBase
		if value == nil || !objectID.MatchString(*value) {
			return "", fmt.Errorf("system materialization base missing")
		}
		if base != "" && base != *value {
			return "", invalidFinalization(fmt.Errorf("conflicting system materialization bases"))
		}
		base = *value
	}
	return base, nil
}
func runEffect(ctx context.Context, op protocol.Operation) (Status, error) {
	boot, err := BootID()
	if err != nil {
		return Status{}, err
	}
	path := operationPath(op.OperationID)
	old, err := readOperation(path)
	if err == nil {
		if !sameOperation(old.Operation, op) {
			return Status{}, fmt.Errorf("operation identity conflict")
		}
		if old.Settled && old.Status.Error == "" {
			return old.Status, nil
		}
		if !old.Settled && old.BootID == boot {
			return Status{}, fmt.Errorf("prior system operation requires reconciliation")
		}
	} else if !os.IsNotExist(err) {
		return Status{}, err
	}
	base, err := rootMaterializationBase(op)
	if err != nil {
		return Status{}, err
	}
	if op.Kind == protocol.KindCompleteNode && base == "" {
		return Status{}, fmt.Errorf("finalization requires retained system materialization base")
	}
	if err = requireAbsentUnit(ctx, operationUnit(op.OperationID)); err != nil {
		return Status{}, err
	}
	record := operationRecord{Operation: op, BootID: boot}
	if err = saveRecord(path, record); err != nil {
		return Status{}, err
	}
	args := []string{"--quiet", "--wait", "--pipe", "--collect", "--service-type=exec", "--unit=" + operationUnit(op.OperationID), "--description=monos probe operation " + op.OperationID}
	for _, property := range properties(op.AttemptID, true) {
		args = append(args, "--property="+property)
	}
	args = append(args, Worker, "effect", op.AttemptID, string(op.Kind), op.OperationID)
	if op.Kind == protocol.KindCompleteNode {
		args = append(args, base)
	}
	out, err := command(ctx, "/usr/bin/systemd-run", args...)
	if err != nil {
		return Status{}, err
	}
	var status Status
	if err = json.Unmarshal(out, &status); err != nil {
		return Status{}, err
	}
	if !status.Known || status.Result == nil {
		return Status{}, fmt.Errorf("incomplete worker response")
	}
	if status.Error == "" && op.Kind == protocol.KindOpenWorkspace {
		if status.MaterializationBase == nil || !objectID.MatchString(*status.MaterializationBase) {
			return Status{}, fmt.Errorf("worker omitted materialization base")
		}
		if base != "" && base != *status.MaterializationBase {
			return Status{}, invalidFinalization(fmt.Errorf("worker attempted to replace original materialization base"))
		}
	}
	record.Settled, record.Status = true, status
	if err = saveRecord(path, record); err != nil {
		return Status{}, err
	}
	return status, statusError(status)
}
