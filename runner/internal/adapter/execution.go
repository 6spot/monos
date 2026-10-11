package adapter

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
)

func isolatedEnvironment(d protocol.Dispatch) []string {
	base := host.AttemptRoot(d.AttemptID)
	return []string{"HOME=" + host.Path(d.AttemptID, "scratch"), "PWD=" + host.Path(d.AttemptID, "scratch"), "USER=me", "LOGNAME=me", "PATH=/usr/local/bin:/home/linuxbrew/.linuxbrew/bin:/usr/bin:/bin", "LANG=C.UTF-8", "SHELL=/bin/bash", "TMPDIR=" + filepath.Join(base, "tmp"), "XDG_DATA_HOME=" + filepath.Join(base, "data"), "XDG_CACHE_HOME=" + filepath.Join(base, "cache"), "XDG_CONFIG_HOME=" + filepath.Join(base, "config"), "XDG_STATE_HOME=" + filepath.Join(base, "state"), "MONOS_SOCKET=" + host.Socket}
}

// BoundedWriter preserves partial output but bounds retained logs per Attempt.
type BoundedWriter struct {
	W         io.Writer
	Remaining int64
	Truncated bool
}

const TruncationMarker = "\n[monos log truncated: retention limit reached]\n"

func (w *BoundedWriter) truncate() error {
	if w.Truncated {
		return nil
	}
	w.Truncated = true
	n, err := io.WriteString(w.W, TruncationMarker)
	if err == nil && n != len(TruncationMarker) {
		err = io.ErrShortWrite
	}
	return err
}

func (w *BoundedWriter) Write(p []byte) (int, error) {
	n := len(p)
	if n == 0 {
		return 0, nil
	}
	if w.Remaining <= 0 {
		return n, w.truncate()
	}
	slice := p
	if int64(len(slice)) > w.Remaining {
		slice = slice[:w.Remaining]
	}
	written, err := w.W.Write(slice)
	w.Remaining -= int64(written)
	if err != nil {
		return written, err
	}
	if written != len(slice) {
		return written, io.ErrShortWrite
	}
	if written < n {
		if err := w.truncate(); err != nil {
			return written, err
		}
	}
	return n, nil
}

// DurableWriter keeps the Runtime's output in the supervised spool. The
// io.Writer wrapper prevents os/exec from handing the append fd to the Runtime,
// so a short write, ENOSPC or fsync error cancels the child immediately.
type DurableWriter struct {
	W    io.Writer
	Sync func() error
	Mark func()
	Stop context.CancelFunc
}

var ErrCaptureFailure = errors.New("execution output capture failed")

type outputSink struct {
	stdout, stderr   io.Writer
	syncOut, syncErr func() error
	mark             func(string)
}

func (w DurableWriter) Write(p []byte) (int, error) {
	n, err := w.W.Write(p)
	if err == nil && n != len(p) {
		err = io.ErrShortWrite
	}
	if err == nil && w.Sync != nil {
		err = w.Sync()
	}
	if err != nil {
		if w.Mark != nil {
			w.Mark()
		}
		if w.Stop != nil {
			w.Stop()
		}
	}
	return n, err
}

func markCaptureFailure(attemptID string) {
	marker := host.Path(attemptID, "scratch") + "/capture.failure"
	f, err := os.OpenFile(marker, os.O_WRONLY, 0)
	if err != nil {
		return
	}
	_, _ = f.WriteAt([]byte{'1'}, 0)
	_ = f.Sync()
	_ = f.Close()
}

func Run(d protocol.Dispatch) error {
	return run(d, func(cmd *exec.Cmd) error { return cmd.Run() })
}

func run(d protocol.Dispatch, execute func(*exec.Cmd) error) error {
	return runWithSink(d, execute, outputSink{stdout: os.Stdout, stderr: os.Stderr, syncOut: os.Stdout.Sync, syncErr: os.Stderr.Sync, mark: markCaptureFailure})
}

func runWithSink(d protocol.Dispatch, execute func(*exec.Cmd) error, sink outputSink) error {
	preflight := verifyModel
	if d.RuntimeID == protocol.Codex {
		preflight = verifyCodexConfiguration
	}
	return runWithPreflight(d, execute, sink, preflight)
}

func runWithPreflight(d protocol.Dispatch, execute func(*exec.Cmd) error, sink outputSink, preflight func(protocol.Dispatch, []string) error) error {
	if !host.ApprovedTarget(d) {
		return fmt.Errorf("unapproved runtime/model/thinking")
	}
	executable, args := host.Runtime, Arguments(d)
	var env []string
	var err error
	if d.RuntimeID == protocol.Codex {
		executable = host.CodexRuntime
		args, err = codexArguments(d)
		env = append(isolatedEnvironment(d), "CODEX_HOME=/home/me/.codex")
	} else {
		env, err = Environment(d)
	}
	if err != nil {
		return err
	}
	// OpenCode v2 model.list is an initialization snapshot. The native prompt
	// path waits for plugin activation before resolving an explicit model.
	// The Owner-authorized paid model therefore uses native startup errors;
	// the free target retains its separate fail-closed pricing requirement.
	if d.RuntimeID == protocol.Codex || d.Model == host.FreeModel {
		if err = preflight(d, env); err != nil {
			return err
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cmd := exec.CommandContext(ctx, executable, args...)
	cmd.Env = env
	cmd.Dir = host.Path(d.AttemptID, "scratch")
	cmd.Stdin = strings.NewReader(d.Prompt)
	var failed atomic.Bool
	mark := func() {
		failed.Store(true)
		if sink.mark != nil {
			sink.mark(d.AttemptID)
		}
	}
	cmd.Stdout = DurableWriter{W: sink.stdout, Sync: sink.syncOut, Mark: mark, Stop: cancel}
	cmd.Stderr = DurableWriter{W: sink.stderr, Sync: sink.syncErr, Mark: mark, Stop: cancel}
	err = execute(cmd)
	if failed.Load() {
		return fmt.Errorf("%w: %v", ErrCaptureFailure, err)
	}
	return err
}
