package host

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const publicationRemoteOutputLimit = 16 << 10

type publicationRemoteWorker struct {
	PID, Group int
	UID        uint32
	Birth      string
	BootID     string
}

type publicationRemoteExecution struct {
	Started, WorkerAbsent, Interrupted bool
	Worker                             publicationRemoteWorker
	Output                             []byte
}

type publicationRemoteOutput struct {
	mu       sync.Mutex
	buffer   bytes.Buffer
	exceeded bool
	cancel   context.CancelFunc
}

func (out *publicationRemoteOutput) Write(raw []byte) (int, error) {
	out.mu.Lock()
	defer out.mu.Unlock()
	if len(raw) > publicationRemoteOutputLimit-out.buffer.Len() {
		out.exceeded = true
		out.cancel()
		return 0, errors.New("publication remote output limit")
	}
	return out.buffer.Write(raw)
}

// The only production executable is fixed Git. The private factory seam below
// exists for actual descendant tests, not for a protocol-selected executable.
// Caller persists a started intent before entry and retains it on every error.
// onStart must durably retain Linux boot/birth/group identity before releasing
// admitted effect ownership. Missing spawn evidence remains unresolved on restart.
func runPublicationGuardedPush(ctx context.Context, store, operationDir string, guard publicationPushGuard, accessEnv []string, onStart func(publicationRemoteWorker) error) (publicationRemoteExecution, error) {
	hooks, guardEnv, e := installPublicationPushGuard(ctx, operationDir, guard)
	if e != nil {
		return publicationRemoteExecution{WorkerAbsent: true}, e
	}
	return runPublicationRemoteProcess(ctx, func(ctx context.Context) *exec.Cmd {
		args := []string{"--no-replace-objects", "--git-dir=" + store, "-c", "safe.directory=" + store, "-c", "core.hooksPath=" + hooks, "-c", "push.followTags=false", "push", "--porcelain", "--no-follow-tags", "--recurse-submodules=no", guard.destination, guard.head + ":" + guard.ref}
		cmd := exec.CommandContext(ctx, "/usr/bin/git", args...)
		cmd.Env = append(append(publicationGitEnvironment(), guardEnv...), accessEnv...)
		return cmd
	}, onStart)
}

func runPublicationRemoteProcess(parent context.Context, makeCommand func(context.Context) *exec.Cmd, onStart func(publicationRemoteWorker) error) (publicationRemoteExecution, error) {
	out := publicationRemoteExecution{}
	ctx, cancel := context.WithTimeout(parent, 120*time.Second)
	defer cancel()
	if ctx.Err() != nil {
		out.WorkerAbsent = true
		return out, ctx.Err()
	}
	cmd := makeCommand(ctx)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return os.ErrProcessDone
		}
		e := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		if errors.Is(e, syscall.ESRCH) {
			return os.ErrProcessDone
		}
		return e
	}
	cmd.WaitDelay = time.Second
	stdout := &publicationRemoteOutput{cancel: cancel}
	cmd.Stdout, cmd.Stderr = stdout, io.Discard
	if cmd.Start() != nil {
		out.WorkerAbsent = true
		return out, errors.New("publication remote worker start unavailable")
	}
	out.Started = true
	out.Worker = publicationRemoteWorker{PID: cmd.Process.Pid, Group: cmd.Process.Pid, UID: uint32(os.Geteuid())}
	identityFailed := false
	if group, e := syscall.Getpgid(cmd.Process.Pid); e != nil || group != cmd.Process.Pid {
		identityFailed = true
	}
	if runtime.GOOS == "linux" {
		peer, e := Identity(cmd.Process.Pid)
		uid, uidErr := publicationRemoteProcUID(cmd.Process.Pid)
		second, secondErr := Identity(cmd.Process.Pid)
		// Identity supplies boot/birth, not UID. Bind actual /proc credentials
		// between two identity reads rather than attributing the parent's UID.
		if e != nil || uidErr != nil || secondErr != nil || peer != second || uid != uint32(os.Geteuid()) || peer.Birth == "" || peer.BootID == "" {
			identityFailed = true
		} else {
			out.Worker.UID = uid
			out.Worker.Birth, out.Worker.BootID = peer.Birth, peer.BootID
		}
	}
	// Darwin same-account primitive tests lack durable Linux boot/birth proof.
	// Production recovery must reject an identity without those Linux fields.
	if identityFailed || onStart != nil && onStart(out.Worker) != nil {
		cancel()
		identityFailed = true
	}
	waitErr := cmd.Wait()
	// Parent exit is insufficient: a helper may survive or keep inherited pipes.
	// Cleanup is independently bounded after external context cancellation.
	absent, lingering := settlePublicationRemoteGroup(out.Worker.Group)
	out.WorkerAbsent = absent
	stdout.mu.Lock()
	exceeded := stdout.exceeded
	if absent && waitErr == nil && !lingering && !identityFailed && !exceeded && ctx.Err() == nil {
		out.Output = append([]byte{}, stdout.buffer.Bytes()...)
	}
	stdout.mu.Unlock()
	if !absent {
		return out, errors.New("publication remote worker ownership unresolved")
	}
	out.Interrupted = lingering || identityFailed || exceeded || ctx.Err() != nil || errors.Is(waitErr, exec.ErrWaitDelay)
	if parent.Err() != nil {
		return out, parent.Err()
	}
	if exceeded {
		return out, errors.New("publication remote output limit")
	}
	if out.Interrupted {
		return out, errors.New("publication remote worker interrupted")
	}
	if waitErr != nil {
		return out, errors.New("publication remote Git effect unavailable")
	}
	return out, nil
}

const publicationRemoteStatusLimit = 64 << 10

func publicationRemoteProcUID(pid int) (uint32, error) {
	if pid <= 1 {
		return 0, errors.New("publication remote process UID unavailable")
	}
	f, e := os.Open("/proc/" + strconv.Itoa(pid) + "/status")
	if e != nil {
		return 0, errors.New("publication remote process UID unavailable")
	}
	defer f.Close()
	raw, e := io.ReadAll(io.LimitReader(f, publicationRemoteStatusLimit+1))
	if e != nil {
		return 0, errors.New("publication remote process UID unavailable")
	}
	return publicationRemoteStatusUID(raw)
}

func publicationRemoteStatusUID(raw []byte) (uint32, error) {
	invalid := errors.New("publication remote process UID unavailable")
	if len(raw) > publicationRemoteStatusLimit {
		return 0, invalid
	}
	seen := false
	var uid uint32
	for _, line := range strings.Split(string(raw), "\n") {
		if !strings.HasPrefix(line, "Uid:") {
			continue
		}
		fields := strings.Fields(strings.TrimPrefix(line, "Uid:"))
		if seen || len(fields) != 4 {
			return 0, invalid
		}
		seen = true
		for i, field := range fields {
			v, e := strconv.ParseUint(field, 10, 32)
			if e != nil || strconv.FormatUint(v, 10) != field || i > 0 && uint32(v) != uid {
				return 0, invalid
			}
			uid = uint32(v)
		}
	}
	if !seen {
		return 0, invalid
	}
	return uid, nil
}

func settlePublicationRemoteGroup(group int) (absent, lingering bool) {
	if group <= 1 {
		return false, true
	}
	if e := syscall.Kill(-group, 0); errors.Is(e, syscall.ESRCH) {
		return true, false
	} else if e != nil && !errors.Is(e, syscall.EPERM) {
		return false, true
	}
	if e := syscall.Kill(-group, syscall.SIGKILL); e != nil && !errors.Is(e, syscall.ESRCH) && !errors.Is(e, syscall.EPERM) {
		return false, true
	}
	deadline := time.NewTimer(3 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(20 * time.Millisecond)
	defer tick.Stop()
	for {
		if e := syscall.Kill(-group, 0); errors.Is(e, syscall.ESRCH) {
			return true, true
		} else if e != nil && !errors.Is(e, syscall.EPERM) {
			return false, true
		}
		select {
		case <-deadline.C:
			return false, true
		case <-tick.C:
		}
	}
}
