package host

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	protocol "monos.local/protocol"
)

var versionPattern = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$`)

func runtimeVersion(runtimeID, output string) (string, bool) {
	version := strings.TrimSpace(output)
	switch runtimeID {
	case "opencode":
		version = strings.TrimPrefix(version, "opencode v")
	case "codex":
		var ok bool
		version, ok = strings.CutPrefix(version, "codex-cli ")
		if !ok {
			return "", false
		}
	default:
		return "", false
	}
	return version, len(version) <= 128 && versionPattern.MatchString(version)
}

func supportedCodexVersion(version string) bool {
	core, _, _ := strings.Cut(version, "+")
	parts := strings.Split(core, ".")
	if len(parts) != 3 {
		return false
	}
	minimum := [3]uint64{0, 162, 1}
	var actual [3]uint64
	for i, part := range parts {
		value, err := strconv.ParseUint(part, 10, 32)
		if err != nil {
			return false
		}
		actual[i] = value
	}
	for i := range actual {
		if actual[i] != minimum[i] {
			return actual[i] > minimum[i]
		}
	}
	return true
}

type discoveryOutput struct {
	bytes.Buffer
	exceeded bool
}

func (w *discoveryOutput) Write(p []byte) (int, error) {
	if w.Len()+len(p) > 4096 {
		w.exceeded = true
		return 0, fmt.Errorf("version output limit")
	}
	return w.Buffer.Write(p)
}

// This fixed version-only command is independent of Attempts. It never receives
// service credentials or a caller-selected executable, identity, flag or cwd.
func discoveryCommand(ctx context.Context, runtimeID string, uid, gid uint32) (*exec.Cmd, error) {
	var executable string
	switch runtimeID {
	case "opencode":
		executable = Runtime
	case "codex":
		executable = CodexRuntime
	default:
		return nil, fmt.Errorf("unsupported discovery runtime")
	}
	cmd := exec.CommandContext(ctx, executable, "--version")
	cmd.Dir = "/home/me"
	cmd.Env = []string{"HOME=/home/me", "USER=me", "LOGNAME=me", "PATH=/usr/local/bin:/home/linuxbrew/.linuxbrew/bin:/usr/bin:/bin", "LANG=C.UTF-8"}
	if runtimeID == "opencode" {
		cmd.Env = append(cmd.Env, "OPENCODE_DISABLE_AUTOUPDATE=1", "OPENCODE_DISABLE_LSP_DOWNLOAD=1")
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true, Credential: &syscall.Credential{Uid: uid, Gid: gid, Groups: []uint32{gid}}}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return os.ErrProcessDone
		}
		err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		if errors.Is(err, syscall.ESRCH) {
			return os.ErrProcessDone
		}
		return err
	}
	cmd.WaitDelay = time.Second
	return cmd, nil
}

func runDiscoveryCommand(cmd *exec.Cmd) error {
	if err := cmd.Start(); err != nil {
		return err
	}
	err := cmd.Wait()
	// Successful output and pipe EOF do not prove that probe descendants left
	// the owned group. Reuse the bounded settlement even after cancellation;
	// only a started command supplies a group we are allowed to clean up.
	if absent, _ := settlePublicationRemoteGroup(cmd.Process.Pid); !absent {
		return errors.Join(err, fmt.Errorf("version probe process cleanup unresolved"))
	}
	return err
}

func discover(ctx context.Context) (Status, error) {
	u, err := user.Lookup("me")
	if err != nil {
		return Status{}, fmt.Errorf("execution account unavailable")
	}
	uid, err := strconv.ParseUint(u.Uid, 10, 32)
	if err != nil || uid == 0 {
		return Status{}, fmt.Errorf("non-root execution identity required")
	}
	gid, err := strconv.ParseUint(u.Gid, 10, 32)
	if err != nil {
		return Status{}, fmt.Errorf("execution group unavailable")
	}
	rows := UnavailableRuntimes()
	for i, row := range rows {
		// Each installation receives its own bounded probe; an unavailable CLI
		// cannot consume the other CLI's discovery deadline or suppress its fact.
		probeCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		cmd, commandErr := discoveryCommand(probeCtx, row.RuntimeID, uint32(uid), uint32(gid))
		if commandErr != nil {
			cancel()
			return Status{}, commandErr
		}
		rows[i] = inspectRuntime(row, cmd)
		cancel()
	}
	return Status{Runtimes: rows}, nil
}

func inspectRuntime(row protocol.RuntimeInstallation, cmd *exec.Cmd) protocol.RuntimeInstallation {
	var output discoveryOutput
	cmd.Stdout = &output
	// Discard stderr: CLI diagnostics can expose provider configuration.
	err := runDiscoveryCommand(cmd)
	if errors.Is(err, os.ErrNotExist) {
		row.Availability = "not_found"
	}
	version, valid := runtimeVersion(row.RuntimeID, output.String())
	if err == nil && !output.exceeded && valid {
		row.Version = &version
		if row.RuntimeID != "codex" || supportedCodexVersion(version) {
			row.Availability = "detected"
		}
	}
	return row
}
