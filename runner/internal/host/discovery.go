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

func runtimeVersion(output string) (string, bool) {
	version := strings.TrimPrefix(strings.TrimSpace(output), "opencode v")
	return version, len(version) <= 128 && versionPattern.MatchString(version)
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
func discoveryCommand(ctx context.Context, uid, gid uint32) *exec.Cmd {
	cmd := exec.CommandContext(ctx, Runtime, "--version")
	cmd.Dir = "/home/me"
	cmd.Env = []string{"HOME=/home/me", "USER=me", "LOGNAME=me", "PATH=/home/linuxbrew/.linuxbrew/bin:/usr/bin:/bin", "LANG=C.UTF-8", "OPENCODE_DISABLE_AUTOUPDATE=1", "OPENCODE_DISABLE_LSP_DOWNLOAD=1"}
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
	return cmd
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
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	row := protocol.RuntimeInstallation{RuntimeID: "opencode", Executable: Runtime, Availability: "unavailable", SupportsModel: true, SupportsThinking: false, ModelIDS: []string{}}
	cmd := discoveryCommand(ctx, uint32(uid), uint32(gid))
	var output discoveryOutput
	cmd.Stdout = &output
	// Discard stderr: CLI diagnostics can expose provider configuration.
	err = runDiscoveryCommand(cmd)
	if errors.Is(err, os.ErrNotExist) {
		row.Availability = "not_found"
	}
	version, valid := runtimeVersion(output.String())
	if err == nil && !output.exceeded && valid {
		row.Availability = "detected"
		row.Version = &version
	}
	return Status{Runtimes: []protocol.RuntimeInstallation{row}}, nil
}
