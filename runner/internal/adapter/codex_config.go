package adapter

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"syscall"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
)

const codexConfigLimit = 1 << 20

var errCodexConfig = errors.New("Codex configuration preflight failed: require a bounded config-only MCP list with no enabled servers")

// CLI 0.162.1 merges maps, so mcp_servers={} does not remove inherited servers.
// mcp list has no --ignore-user-config: this deliberately checks the original
// Owner home too, conservatively refusing enabled user servers that exec would
// ignore. It never connects to those servers or changes installation/login.
func verifyCodexConfiguration(d protocol.Dispatch, env []string) error {
	if os.Geteuid() == 0 {
		return errCodexConfig
	}
	args, err := codexConfigArguments(d)
	if err != nil {
		return err
	}
	return runCodexConfigCommand(context.Background(), env, host.Path(d.AttemptID, "scratch"), func(ctx context.Context) *exec.Cmd {
		return exec.CommandContext(ctx, host.CodexRuntime, args...)
	})
}

func codexConfigArguments(d protocol.Dispatch) ([]string, error) {
	launch, err := codexArguments(d)
	if err != nil {
		return nil, err
	}
	args := []string{"mcp", "list", "--json"}
	for i := 0; i < len(launch); i++ {
		if launch[i] == "-c" || launch[i] == "--disable" || launch[i] == "--enable" {
			args = append(args, launch[i], launch[i+1])
			i++
		}
	}
	return args, nil
}

type codexConfigOutput struct {
	bytes.Buffer
	exceeded bool
	cancel   context.CancelFunc
}

func (w *codexConfigOutput) Write(p []byte) (int, error) {
	if w.Len()+len(p) > codexConfigLimit {
		w.exceeded = true
		w.cancel()
		return 0, errCodexConfig
	}
	return w.Buffer.Write(p)
}

// The private command factory permits fake local executables in tests only.
// Production always uses Codex's config-only list command. Bound both output
// retention and lifetime, then settle its process group even after a clean exit.
func runCodexConfigCommand(parent context.Context, env []string, scratch string, makeCommand func(context.Context) *exec.Cmd) error {
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	cmd := makeCommand(ctx)
	cmd.Env, cmd.Dir = env, scratch
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
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
	cmd.WaitDelay = 100 * time.Millisecond
	out := &codexConfigOutput{cancel: cancel}
	cmd.Stdout, cmd.Stderr = out, nil // Never retain or surface configuration diagnostics.
	if cmd.Start() != nil {
		return errCodexConfig
	}
	err := cmd.Wait()
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	deadline := time.Now().Add(time.Second)
	for !errors.Is(syscall.Kill(-cmd.Process.Pid, 0), syscall.ESRCH) {
		if time.Now().After(deadline) {
			return errCodexConfig
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err != nil || ctx.Err() != nil || out.exceeded {
		return errCodexConfig
	}
	return validateCodexMCPList(out.Bytes())
}

func validateCodexMCPList(raw []byte) error {
	var servers []struct {
		Name    string `json:"name"`
		Enabled *bool  `json:"enabled"`
	}
	if len(raw) > codexConfigLimit || json.Unmarshal(raw, &servers) != nil || servers == nil {
		return errCodexConfig
	}
	seen := make(map[string]bool)
	for _, server := range servers {
		if server.Name == "" || seen[server.Name] || server.Enabled == nil || *server.Enabled {
			return errCodexConfig
		}
		seen[server.Name] = true
	}
	return nil
}
