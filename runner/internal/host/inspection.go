package host

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/resources"
	"monos.local/runner/internal/wire"
)

type InspectionAccess func(context.Context, protocol.Operation) (protocol.InspectionRepositoryAccessResult, error)

type inspectionRecord struct {
	Retired      bool                          `json:"retired,omitempty"`
	Descriptor   protocol.InspectionDescriptor `json:"descriptor"`
	Digest       string                        `json:"digest"`
	StorageID    string                        `json:"storage_id"`
	Deadline     int64                         `json:"deadline"`
	Ref          string                        `json:"ref,omitempty"`
	Commit       string                        `json:"commit,omitempty"`
	Tree         string                        `json:"tree,omitempty"`
	WorkerActive bool                          `json:"worker_active"`
	Worker       *publicationRemoteWorker      `json:"worker,omitempty"`
	Result       *protocol.InspectionResult    `json:"result,omitempty"`
}

type inspectionSession struct {
	root         string
	operation    protocol.Operation
	record       inspectionRecord
	remoteGit    func(context.Context, string, []string, ...string) (string, error)
	resultExport func(protocol.ResultReadIdentity) (string, string)
}

func (s *inspectionSession) private() string {
	return filepath.Join(s.root, "service", "inspection-operations", s.operation.OperationID)
}
func (s *inspectionSession) snapshot() string {
	return filepath.Join(s.root, "inspection", s.operation.OperationID)
}
func (s *inspectionSession) save() error {
	return saveRecord(filepath.Join(s.private(), "record.json"), s.record)
}

func inspectionDirectory(path string, mode os.FileMode) error {
	if err := os.Mkdir(path, mode); err != nil && !os.IsExist(err) {
		return err
	}
	if err := serviceDirectory(path, mode == 0700); err != nil {
		return err
	}
	return nil
}

func InspectionUnavailable(op protocol.Operation, reason string) protocol.EffectResult {
	digest := ""
	if op.InspectionDigest != nil {
		digest = *op.InspectionDigest
	}
	r := protocol.InspectionUnavailableReason(reason)
	return protocol.EffectResult{Inspection: &protocol.InspectionResult{InspectionID: op.OperationID, DescriptorDigest: digest, Status: "unavailable", Reason: &r}}
}

// InspectRepository is a service effect. The daemon must first check retained
// origin journals; this layer verifies protected storage and actual Git objects.
func InspectRepository(ctx context.Context, op protocol.Operation, access InspectionAccess) (protocol.EffectResult, error) {
	if os.Geteuid() == 0 {
		return InspectionUnavailable(op, "access_denied"), nil
	}
	storage, err := inspectionStorage(Root)
	if err != nil {
		return inspectionStorageFailure(Root, op)
	}
	return inspectRepositoryAt(ctx, Root, storage, op, access, nil)
}

func inspectionStorageFailure(root string, op protocol.Operation) (protocol.EffectResult, error) {
	_, err := os.Lstat(filepath.Join(root, "service", "inspection-operations", op.OperationID, "record.json"))
	if !os.IsNotExist(err) {
		return protocol.EffectResult{}, ErrInspectionUnresolved
	}
	return InspectionUnavailable(op, "resource_unavailable"), nil
}

func inspectionStorage(root string) (string, error) {
	uid := uint32(os.Geteuid())
	if resultParents(filepath.Join(root, "service"), uid) != nil || trustedDir(filepath.Join(root, "launch"), 0) != nil {
		return "", errors.New("inspection storage unavailable")
	}
	return readStorageIdentity(filepath.Join(root, "launch", "storage-id"), filepath.Join(root, "service", "storage-id"), 0, uid)
}

// sourceOverride is only a local Git test seam; production always verifies the
// protected service export/cache and never accepts a caller-selected host path.
func inspectRepositoryAt(ctx context.Context, root, storage string, op protocol.Operation, access InspectionAccess, sourceOverride func(context.Context, *inspectionSession) (string, string, string, error)) (protocol.EffectResult, error) {
	if op.Inspection == nil || op.InspectionDigest == nil || !ValidID(op.OperationID) {
		return protocol.EffectResult{}, errors.New("inspection descriptor required")
	}
	raw, digest, err := wire.Canonical(op.Inspection)
	if err != nil || wire.Validate("InspectionDescriptor", raw) != nil || digest != *op.InspectionDigest || op.Inspection.InspectionID != op.OperationID || op.Inspection.AttemptID != op.AttemptID || op.Inspection.DispatchID != op.DispatchID || op.ResourceID == nil || op.Inspection.Resource.ResourceID != *op.ResourceID {
		return protocol.EffectResult{}, errors.New("inspection descriptor mismatch")
	}
	s := &inspectionSession{root: root, operation: op}
	for _, path := range []string{filepath.Join(root, "service"), filepath.Join(root, "inspection")} {
		if resultParents(path, uint32(os.Geteuid())) != nil || serviceDirectory(path, false) != nil {
			return inspectionStorageFailure(root, op)
		}
	}
	if err = inspectionDirectory(filepath.Join(root, "service", "inspection-operations"), 0700); err != nil {
		return inspectionStorageFailure(root, op)
	}
	if err = inspectionDirectory(s.private(), 0700); err != nil {
		return inspectionStorageFailure(root, op)
	}
	lock, err := acquireFileLock(ctx, filepath.Join(s.private(), "lock"))
	if err != nil {
		return protocol.EffectResult{}, ErrInspectionUnresolved
	}
	defer releaseFileLock(lock)
	file := filepath.Join(s.private(), "record.json")
	if raw, e := os.ReadFile(file); e == nil {
		if trustedFile(file, uint32(os.Geteuid())) != nil || json.Unmarshal(raw, &s.record) != nil || s.record.Digest != digest || s.record.StorageID != storage {
			return protocol.EffectResult{}, ErrInspectionUnresolved
		}
		_, retainedDigest, e := wire.Canonical(s.record.Descriptor)
		if e != nil || retainedDigest != digest {
			return protocol.EffectResult{}, ErrInspectionUnresolved
		}
		if s.record.WorkerActive {
			if !recoverInspectionWorker(s.record.Worker) {
				return protocol.EffectResult{}, ErrInspectionUnresolved
			}
			s.record.WorkerActive = false
			if s.save() != nil {
				return protocol.EffectResult{}, ErrInspectionUnresolved
			}
		}
		if s.record.Result != nil {
			if s.record.Retired {
				return protocol.EffectResult{}, ErrInspectionRetired
			}
			result := s.record.Result
			raw, _, err := wire.Canonical(result)
			if err != nil || wire.Validate("InspectionResult", raw) != nil || result.InspectionID != op.OperationID || result.DescriptorDigest != digest {
				return protocol.EffectResult{}, ErrInspectionUnresolved
			}
			if p := result.Snapshot; p != nil && (p.SnapshotID != op.OperationID || p.StorageID != storage || p.Path != s.snapshot() || p.RepositoryIdentity != op.Inspection.Resource.RepositoryIdentity || p.Commit != s.record.Commit || p.Tree != s.record.Tree) {
				return protocol.EffectResult{}, ErrInspectionUnresolved
			}
			return protocol.EffectResult{Inspection: s.record.Result}, nil
		}
	} else if !os.IsNotExist(e) {
		return protocol.EffectResult{}, ErrInspectionUnresolved
	} else {
		s.record = inspectionRecord{Descriptor: *op.Inspection, Digest: digest, StorageID: storage, Deadline: time.Now().Add(120 * time.Second).Unix()}
		if s.save() != nil {
			return protocol.EffectResult{}, ErrInspectionUnresolved
		}
	}
	finish := func(reason string) (protocol.EffectResult, error) {
		result := InspectionUnavailable(op, reason)
		s.record.Result = result.Inspection
		if s.save() != nil {
			return protocol.EffectResult{}, ErrInspectionUnresolved
		}
		return result, nil
	}
	if ctx.Err() != nil {
		return finish("cancelled")
	}
	if time.Now().Unix() >= s.record.Deadline {
		return finish("timeout")
	}
	if err := resources.GuardContext(ctx, "journal", "cache", "inspection"); err != nil {
		return finish("resource_unavailable")
	}
	var source, commit, tree string
	if sourceOverride != nil {
		source, commit, tree, err = sourceOverride(ctx, s)
	} else if string(op.Inspection.Origin.Kind) == "default_ref" {
		source, commit, tree, err = s.fetch(ctx, access)
	} else {
		source, commit, tree, err = s.origin(ctx)
	}
	if err == nil {
		s.record.Commit, s.record.Tree = commit, tree
		err = s.save()
	}
	if err == nil {
		err = s.materialize(ctx, source, commit, tree)
	}
	if err != nil {
		if errors.Is(err, ErrInspectionUnresolved) || s.record.WorkerActive {
			return protocol.EffectResult{}, ErrInspectionUnresolved
		}
		if ctx.Err() != nil {
			return finish("cancelled")
		}
		if errors.Is(err, context.DeadlineExceeded) || time.Now().Unix() >= s.record.Deadline {
			return finish("timeout")
		}
		reason := "inspection_failed"
		var failure *inspectionFailure
		if errors.As(err, &failure) {
			reason = failure.reason
		}
		return finish(reason)
	}
	files, err := instructionFiles(s.snapshot())
	if err != nil {
		return finish("inspection_failed")
	}
	instructions := []string{}
	for _, file := range files {
		instructions = append(instructions, string(file))
	}
	s.record.Result = &protocol.InspectionResult{InspectionID: op.OperationID, DescriptorDigest: digest, Status: "available", Snapshot: &protocol.InspectionSnapshot{SnapshotID: op.OperationID, StorageID: storage, Path: s.snapshot(), Commit: commit, Tree: tree, RepositoryIdentity: op.Inspection.Resource.RepositoryIdentity, InstructionFiles: instructions}}
	if s.save() != nil {
		return protocol.EffectResult{}, ErrInspectionUnresolved
	}
	return protocol.EffectResult{Inspection: s.record.Result}, nil
}

type inspectionFailure struct{ reason string }

func (e *inspectionFailure) Error() string { return "inspection unavailable: " + e.reason }
func inspectionFailed(reason string) error { return &inspectionFailure{reason: reason} }

func (s *inspectionSession) materialize(ctx context.Context, source, commit, tree string) error {
	if !objectID.MatchString(commit) || !objectID.MatchString(tree) {
		return inspectionFailed("revision_unavailable")
	}
	path := s.snapshot()
	if _, err := os.Lstat(path); err == nil {
		return s.verify(ctx, path, commit, tree)
	} else if !os.IsNotExist(err) {
		return err
	}
	stage := filepath.Join(s.private(), "snapshot")
	// A service-private unexposed clone can be reconstructed from the same pin.
	// No exposed snapshot or task materialization is ever removed or repaired.
	if _, err := os.Lstat(stage); err == nil {
		if err = writableInspectionTree(stage); err != nil {
			return err
		}
		if err = os.RemoveAll(stage); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if _, err := s.git(ctx, s.private(), nil, "-c", "safe.directory="+source, "clone", "--no-local", "--no-checkout", "--no-hardlinks", "--", source, stage); err != nil {
		return fmt.Errorf("inspection clone: %w", err)
	}
	if _, err := s.git(ctx, stage, nil, "-c", "safe.directory="+source, "fetch", "--no-tags", "--no-recurse-submodules", "--", source, commit+":refs/monos/inspection/"+s.operation.OperationID); err != nil {
		return fmt.Errorf("inspection pin import: %w", err)
	}
	if _, err := s.git(ctx, stage, nil, "checkout", "--detach", "--force", commit); err != nil {
		return fmt.Errorf("inspection checkout: %w", err)
	}
	if err := s.verify(ctx, stage, commit, tree); err != nil {
		return err
	}
	if err := readonlyInspectionTree(stage); err != nil {
		return err
	}
	// Some filesystems require owner write permission on the moved directory
	// itself. The execution group has only read/traversal throughout publication.
	if err := os.Chmod(stage, 0750); err != nil {
		return err
	}
	if err := os.Rename(stage, path); err != nil {
		return err
	}
	if err := os.Chmod(path, 0550); err != nil {
		return err
	}
	return syncDirectory(filepath.Dir(path))
}

func (s *inspectionSession) verify(ctx context.Context, path, commit, tree string) error {
	if serviceDirectory(path, false) != nil {
		return inspectionFailed("access_denied")
	}
	if _, err := os.Lstat(filepath.Join(path, ".git", "objects", "info", "alternates")); !os.IsNotExist(err) {
		return inspectionFailed("repository_mismatch")
	}
	for expression, want := range map[string]string{"HEAD": commit, "HEAD^{tree}": tree} {
		got, err := s.git(ctx, path, nil, "rev-parse", "--verify", expression)
		if err != nil {
			return err
		}
		if got != want {
			return inspectionFailed("revision_unavailable")
		}
	}
	index, err := s.git(ctx, path, nil, "write-tree")
	if err != nil {
		return err
	}
	if index != tree {
		return inspectionFailed("revision_unavailable")
	}
	dirty, err := s.git(ctx, path, nil, "status", "--porcelain", "--untracked-files=all")
	if err != nil {
		return err
	}
	if dirty != "" {
		return inspectionFailed("revision_unavailable")
	}
	return nil
}

func readonlyInspectionTree(path string) error { return inspectionTreeModes(path, false) }
func writableInspectionTree(path string) error { return inspectionTreeModes(path, true) }
func inspectionTreeModes(path string, writable bool) error {
	return filepath.Walk(path, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		st, ok := info.Sys().(*syscall.Stat_t)
		if !ok || st.Uid != uint32(os.Geteuid()) {
			return fmt.Errorf("inspection ownership mismatch")
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return nil
		}
		if !info.IsDir() && !info.Mode().IsRegular() {
			return fmt.Errorf("unsupported inspection entry")
		}
		mode := os.FileMode(0440)
		if info.IsDir() || info.Mode().Perm()&0111 != 0 {
			mode = 0550
		}
		if writable {
			mode |= 0200
		}
		return os.Chmod(path, mode)
	})
}

// Stop verifies/cancels retained service workers before the daemon releases the
// Planner. The caller serializes this against the operation's active goroutine.
func CancelInspection(ctx context.Context, op protocol.Operation) (protocol.EffectResult, error) {
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	return InspectRepository(cancelled, op, nil)
}

// Keep reason strings independent of Git stderr, URLs, or credential text.
func inspectionReason(err error) string {
	for _, reason := range []string{"cancelled", "source_stale", "resource_unavailable", "access_denied", "ref_unavailable", "revision_unavailable", "repository_mismatch", "timeout"} {
		if strings.Contains(err.Error(), reason) {
			return reason
		}
	}
	return "resource_unavailable"
}
