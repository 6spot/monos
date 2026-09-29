package adapter

import (
	"context"
	"encoding/json"
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

// Policy order is significant to OpenCode; this struct keeps '*' first.
type permissions struct {
	All       string          `json:"*"`
	Read      string          `json:"read"`
	Glob      string          `json:"glob"`
	Grep      string          `json:"grep"`
	Bash      string          `json:"bash"`
	Edit      string          `json:"edit"`
	External  json.RawMessage `json:"external_directory"`
	Question  string          `json:"question"`
	Task      string          `json:"task"`
	Skill     string          `json:"skill"`
	LSP       string          `json:"lsp"`
	Webfetch  string          `json:"webfetch"`
	Websearch string          `json:"websearch"`
	PlanEnter string          `json:"plan_enter"`
	PlanExit  string          `json:"plan_exit"`
}

func fixedProtocol(d protocol.Dispatch) string {
	text := "Use native bash to invoke /usr/local/bin/monos for formal monos actions. Run monos --help to discover commands. Natural-language output is never a formal state transition. Do not start background services or subagents."
	if d.TodoID != nil {
		text += " You are the Todo Discussion Planner. Use only this Todo's supplied context and source message. No Execution Task or writable repository exists for this Attempt. Repository inspection is unavailable; never read the probe fixture or another Attempt's files. Older in-scope history is available through monos read_discussion. An explicit cache rebuild uses monos update_working_requirement_state with the supplied resolved watermark and Project context version/digest; rebuilding does not resolve the pending message. Before ending, call monos commit_discussion_turn with the exact source_message_id and source_watermark from your context, your final reply and working_requirement_state. Optional task_preview only proposes title/specification for later Owner confirmation; never create a Task. If a command response is uncertain, query monos command-status and retry the same retained request ID. Do not replace uncertain requests or treat printed prose as a committed reply."
	}
	return text
}

func Config(d protocol.Dispatch) (string, error) {
	edit := "deny"
	if d.Kind == protocol.Node {
		edit = "allow"
	}
	external := `"allow"`
	// Only interactive questions, unreviewed skill/subagent delegation and role
	// switching are excluded from this single-runtime, explicitly free probe.
	perms := permissions{"allow", "allow", "allow", "allow", "allow", edit, json.RawMessage(external), "deny", "deny", "deny", "allow", "allow", "allow", "deny", "deny"}
	fixed := map[string]any{"model": host.FreeModel}
	cfg := map[string]any{"model": host.FreeModel, "small_model": host.FreeModel, "share": "disabled", "snapshot": false, "autoupdate": false, "shell": "/bin/bash", "agent": map[string]any{
		"monos-probe": map[string]any{"mode": "primary", "model": host.FreeModel, "permission": perms, "prompt": fixedProtocol(d)}, "title": fixed, "summary": fixed, "compaction": fixed}}
	raw, err := json.Marshal(cfg)
	return string(raw), err
}
func Environment(d protocol.Dispatch) ([]string, error) {
	config, err := Config(d)
	if err != nil {
		return nil, err
	}
	base := host.AttemptRoot(d.AttemptID)
	return []string{"HOME=/home/me", "PWD=" + host.Path(d.AttemptID, "scratch"), "USER=me", "LOGNAME=me", "PATH=/usr/local/bin:/home/linuxbrew/.linuxbrew/bin:/usr/bin:/bin", "LANG=C.UTF-8", "SHELL=/bin/bash", "TMPDIR=" + filepath.Join(base, "tmp"), "XDG_DATA_HOME=" + filepath.Join(base, "data"), "XDG_CACHE_HOME=" + filepath.Join(base, "cache"), "XDG_CONFIG_HOME=" + filepath.Join(base, "config"), "XDG_STATE_HOME=" + filepath.Join(base, "state"), "MONOS_SOCKET=" + host.Socket, "OPENCODE_CONFIG_CONTENT=" + config, "OPENCODE_DISABLE_PROJECT_CONFIG=1", "OPENCODE_DISABLE_AUTOUPDATE=1", "OPENCODE_DISABLE_LSP_DOWNLOAD=1", "OPENCODE_DISABLE_EXTERNAL_SKILLS=1", "OPENCODE_DISABLE_CLAUDE_CODE=1"}, nil
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
// io.Writer wrapper prevents os/exec from handing the append fd to OpenCode,
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
	if d.RuntimeID != protocol.Opencode || string(d.Model) != host.FreeModel {
		return fmt.Errorf("unapproved runtime/model")
	}
	env, err := Environment(d)
	if err != nil {
		return err
	}
	if err = verifyModel(d, env, execute); err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cmd := exec.CommandContext(ctx, host.Runtime, Arguments(d)...)
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

func Arguments(d protocol.Dispatch) []string {
	return []string{"run", "--pure", "--auto", "--format", "json", "--model", host.FreeModel, "--agent", "monos-probe", "--dir", host.Path(d.AttemptID, "scratch")}
}
