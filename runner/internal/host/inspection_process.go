package host

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"syscall"
	"time"
)

// ErrInspectionUnresolved retains operation ownership. Every other inspection
// failure is a completed, typed unavailable result, not a workspace recovery.
var ErrInspectionUnresolved = errors.New("inspection process ownership unresolved")

func recoverInspectionWorker(worker *publicationRemoteWorker) bool {
	if worker == nil || worker.PID <= 1 || worker.Group != worker.PID || worker.UID != uint32(os.Geteuid()) || worker.Birth == "" || worker.BootID == "" || runtime.GOOS != "linux" {
		return false
	}
	boot, err := BootID()
	if err != nil {
		return false
	}
	if boot != worker.BootID {
		return true
	}
	probe := syscall.Kill(-worker.Group, 0)
	if errors.Is(probe, syscall.ESRCH) {
		return true
	}
	if probe != nil {
		return false
	}
	first, err := Identity(worker.PID)
	uid, uidErr := publicationRemoteProcUID(worker.PID)
	group, groupErr := syscall.Getpgid(worker.PID)
	second, secondErr := Identity(worker.PID)
	if err != nil || uidErr != nil || groupErr != nil || secondErr != nil || first != second || first.BootID != worker.BootID || first.Birth != worker.Birth || group != worker.Group || uid != worker.UID {
		return false
	}
	absent, _ := settlePublicationRemoteGroup(worker.Group)
	return absent
}

// Every command has durable spawn intent and boot/birth/group identity. No Git
// subprocess can outlive cancellation merely by leaving its parent process.
func (s *inspectionSession) git(ctx context.Context, directory string, env []string, args ...string) (string, error) {
	if s.record.WorkerActive {
		return "", ErrInspectionUnresolved
	}
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	s.record.WorkerActive, s.record.Worker = true, nil
	if err := s.save(); err != nil {
		return "", err
	}
	deadline := time.Unix(s.record.Deadline, 0)
	commandCtx, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	fixed := []string{"--no-replace-objects", "-c", "safe.directory=" + directory, "-c", "core.hooksPath=/dev/null", "-c", "core.attributesFile=/dev/null", "-c", "credential.helper=", "-c", "protocol.allow=never", "-c", "protocol.file.allow=always"}
	out, err := runPublicationRemoteProcess(commandCtx, func(ctx context.Context) *exec.Cmd {
		cmd := exec.CommandContext(ctx, "/usr/bin/git", append(fixed, args...)...)
		cmd.Dir = directory
		cmd.Env = append(publicationGitEnvironment(), env...)
		return cmd
	}, func(worker publicationRemoteWorker) error {
		s.record.Worker = &worker
		return s.save()
	})
	if !out.WorkerAbsent {
		return "", ErrInspectionUnresolved
	}
	s.record.WorkerActive = false
	if saveErr := s.save(); saveErr != nil {
		return "", ErrInspectionUnresolved
	}
	if commandCtx.Err() != nil {
		return "", commandCtx.Err()
	}
	return strings.TrimSpace(string(out.Output)), err
}
