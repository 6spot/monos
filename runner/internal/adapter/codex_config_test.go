package adapter

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	protocol "monos.local/protocol"
)

func TestCodexMCPListRequiresKnownDisabledEntries(t *testing.T) {
	for _, raw := range []string{`[]`, `[{"name":"one","enabled":false,"transport":{"type":"stdio"}}]`} {
		if err := validateCodexMCPList([]byte(raw)); err != nil {
			t.Fatal(raw, err)
		}
	}
	for _, raw := range []string{`null`, `{}`, ``, `[] []`, `[null]`, `[{"name":"one"}]`, `[{"name":"one","enabled":true}]`, `[{"name":"one","enabled":"false"}]`, `[{"name":"one","enabled":false},{"name":"one","enabled":false}]`, strings.Repeat(" ", codexConfigLimit+1)} {
		if err := validateCodexMCPList([]byte(raw)); !errors.Is(err, errCodexConfig) {
			t.Fatal("unsafe config accepted")
		}
	}
	d := protocol.Dispatch{RuntimeID: protocol.Codex, Model: "owner-model", AttemptID: "config", Kind: protocol.Node}
	args, err := codexConfigArguments(d)
	if err != nil || !slices.Equal(args[:3], []string{"mcp", "list", "--json"}) {
		t.Fatal("not a config-only command", err)
	}
	for _, flag := range []string{"exec", "--ignore-user-config", "--ignore-rules", "--strict-config", "--ephemeral", "--sandbox", "--model", "-"} {
		if slices.Contains(args, flag) {
			t.Fatal("unsupported or execution flag in MCP check", flag)
		}
	}
	err = runWithPreflight(d, func(*exec.Cmd) error { t.Fatal("configuration rejection still launched model"); return nil }, outputSink{stdout: io.Discard, stderr: io.Discard}, func(protocol.Dispatch, []string) error { return errCodexConfig })
	if !errors.Is(err, errCodexConfig) {
		t.Fatal("config refusal lost", err)
	}
}

// This child is the test binary, never Codex, a model or an MCP server.
func TestCodexConfigProcess(t *testing.T) {
	mode := os.Getenv("MONOS_CODEX_CONFIG_TEST")
	if mode == "" {
		return
	}
	switch mode {
	case "empty":
		fmt.Print("[]")
	case "enabled":
		fmt.Print(`[{"name":"synthetic","enabled":true}]`)
	case "large":
		fmt.Print(strings.Repeat("x", codexConfigLimit+1))
	case "sleep":
		time.Sleep(time.Hour)
	case "descendant":
		executable, err := os.Executable()
		if err != nil {
			os.Exit(2)
		}
		child := exec.Command(executable, "-test.run=^TestCodexConfigProcess$")
		child.Env = []string{"MONOS_CODEX_CONFIG_TEST=sleep"}
		if child.Start() != nil {
			os.Exit(2)
		}
		if os.WriteFile(os.Getenv("MONOS_CODEX_PID_FILE"), []byte(strconv.Itoa(child.Process.Pid)), 0600) != nil {
			os.Exit(2)
		}
		fmt.Print("[]")
	case "exit":
		fmt.Print("[]")
		os.Exit(1)
	}
	os.Exit(0)
}

func TestCodexConfigSettlesDescendantAfterSuccessfulParent(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	scratch := t.TempDir()
	pidFile := scratch + "/child.pid"
	err = runCodexConfigCommand(context.Background(), []string{"MONOS_CODEX_CONFIG_TEST=descendant", "MONOS_CODEX_PID_FILE=" + pidFile}, scratch, func(ctx context.Context) *exec.Cmd {
		return exec.CommandContext(ctx, executable, "-test.run=^TestCodexConfigProcess$")
	})
	raw, readErr := os.ReadFile(pidFile)
	if readErr != nil {
		t.Fatal(readErr)
	}
	pid, parseErr := strconv.Atoi(string(raw))
	if parseErr != nil {
		t.Fatal(parseErr)
	}
	alive := syscall.Kill(pid, 0)
	if err != nil || !errors.Is(alive, syscall.ESRCH) {
		if alive == nil {
			_ = syscall.Kill(pid, syscall.SIGKILL)
		}
		t.Fatal("config child cleanup not established", err)
	}
}

func TestCodexConfigProcessBoundsOutputAndLifetime(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"empty", "enabled", "large", "sleep", "exit"} {
		t.Run(mode, func(t *testing.T) {
			ctx := context.Background()
			if mode == "sleep" {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, 100*time.Millisecond)
				defer cancel()
			}
			err := runCodexConfigCommand(ctx, []string{"MONOS_CODEX_CONFIG_TEST=" + mode}, t.TempDir(), func(ctx context.Context) *exec.Cmd {
				return exec.CommandContext(ctx, executable, "-test.run=^TestCodexConfigProcess$")
			})
			if mode == "empty" {
				if err != nil {
					t.Fatal(err)
				}
			} else if !errors.Is(err, errCodexConfig) {
				t.Fatal("unsafe/incomplete config command accepted", err)
			}
		})
	}
}
