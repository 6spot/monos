package host

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

type LogRetirement struct {
	DispatchID  string `json:"dispatch_id"`
	StdoutBytes int64  `json:"stdout_bytes"`
	StderrBytes int64  `json:"stderr_bytes"`
}

func retireLogFiles(directory, attempt string, r LogRetirement, owner uint32) error {
	if !ValidID(attempt) || !ValidID(r.DispatchID) || r.StdoutBytes < 0 || r.StderrBytes < 0 {
		return fmt.Errorf("invalid log retirement")
	}
	// The helper lock serializes these fixed root-owned names. Check both before
	// deleting either; missing members are an interrupted retirement retry only.
	for stream, size := range map[string]int64{"stdout": r.StdoutBytes, "stderr": r.StderrBytes} {
		path := filepath.Join(directory, attempt+"."+stream)
		info, err := os.Lstat(path)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		if err = trustedFile(path, owner); err != nil {
			return err
		}
		if info.Size() != size {
			return fmt.Errorf("log retirement byte count changed")
		}
	}
	for _, stream := range []string{"stdout", "stderr"} {
		if err := os.Remove(filepath.Join(directory, attempt+"."+stream)); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return syncDirectory(directory)
}

var ErrInspectionRetired = errors.New("inspection snapshot retired")

// Called only after the daemon retains backend acknowledgement plus its own
// terminal/ACK/retention evidence. This layer checks source identity, protected
// filesystem ownership and settled Git workers, then retires only fixed paths.
func RetireInspection(ctx context.Context, op protocol.Operation) error {
	storage, err := inspectionStorage(Root)
	if err != nil {
		return err
	}
	return retireInspectionAt(ctx, Root, storage, op)
}

func retireInspectionAt(ctx context.Context, root, storage string, op protocol.Operation) error {
	if op.Inspection == nil || op.InspectionDigest == nil || !ValidID(op.OperationID) {
		return ErrInspectionUnresolved
	}
	s := &inspectionSession{root: root, operation: op}
	if resultParents(s.private(), uint32(os.Geteuid())) != nil || serviceDirectory(s.private(), true) != nil {
		return ErrInspectionUnresolved
	}
	lock, err := acquireFileLock(ctx, filepath.Join(s.private(), "lock"))
	if err != nil {
		return err
	}
	defer releaseFileLock(lock)
	path := filepath.Join(s.private(), "record.json")
	if trustedFile(path, uint32(os.Geteuid())) != nil {
		return ErrInspectionUnresolved
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if json.Unmarshal(raw, &s.record) != nil || s.record.StorageID != storage || s.record.Digest != *op.InspectionDigest || s.record.WorkerActive || s.record.Result == nil {
		return ErrInspectionUnresolved
	}
	_, digest, err := wire.Canonical(s.record.Descriptor)
	if err != nil || digest != *op.InspectionDigest || !reflect.DeepEqual(s.record.Descriptor, *op.Inspection) {
		return ErrInspectionUnresolved
	}
	if op.Result == nil || !reflect.DeepEqual(op.Result.Inspection, s.record.Result) {
		return ErrInspectionUnresolved
	}
	s.record.Retired = true
	if err = s.save(); err != nil {
		return err
	}
	for _, path := range []string{s.snapshot(), filepath.Join(s.private(), "snapshot"), filepath.Join(s.private(), "repository.git")} {
		if _, err = os.Lstat(path); os.IsNotExist(err) {
			continue
		} else if err != nil {
			return err
		}
		if err = writableInspectionTree(path); err != nil {
			return err
		}
		if err = os.RemoveAll(path); err != nil {
			return err
		}
		if err = syncDirectory(filepath.Dir(path)); err != nil {
			return err
		}
	}
	return nil
}
