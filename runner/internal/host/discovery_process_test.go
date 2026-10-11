package host

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// The fake CLI's child closes its inherited output before the CLI returns a
// valid version. Pipe EOF and parent success must not hide a live probe child.
func TestDiscoveryProcessHelper(t *testing.T) {
	role := os.Getenv("MONOS_DISCOVERY_HELPER")
	pidFile := os.Getenv("MONOS_DISCOVERY_CHILD_PID")
	switch role {
	case "parent", "codex-parent":
		child := exec.Command(os.Args[0], "-test.run=^TestDiscoveryProcessHelper$")
		child.Env = []string{"MONOS_DISCOVERY_HELPER=child", "MONOS_DISCOVERY_CHILD_PID=" + pidFile, "GORACE=atexit_sleep_ms=0"}
		child.Stdout, child.Stderr = os.Stdout, os.Stderr
		if child.Start() != nil {
			os.Exit(70)
		}
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			if raw, err := os.ReadFile(pidFile); err == nil && string(raw) == strconv.Itoa(child.Process.Pid) {
				group, groupErr := syscall.Getpgid(child.Process.Pid)
				if groupErr != nil || group != os.Getpid() || syscall.Kill(child.Process.Pid, 0) != nil {
					os.Exit(71)
				}
				if role == "codex-parent" {
					fmt.Fprintln(os.Stdout, "codex-cli 0.162.1")
				} else {
					fmt.Fprintln(os.Stdout, "opencode v2.0.20")
				}
				os.Exit(0)
			}
			time.Sleep(10 * time.Millisecond)
		}
		os.Exit(72)
	case "child":
		if os.Stdout.Close() != nil || os.Stderr.Close() != nil || os.WriteFile(pidFile, []byte(strconv.Itoa(os.Getpid())), 0600) != nil {
			os.Exit(73)
		}
		time.Sleep(120 * time.Second)
		os.Exit(0)
	case "normal":
		fmt.Fprintln(os.Stdout, "opencode v2.0.20")
		os.Exit(0)
	case "codex-normal":
		fmt.Fprintln(os.Stdout, "codex-cli 0.162.1")
		os.Exit(0)
	case "codex-old":
		fmt.Fprintln(os.Stdout, "codex-cli 0.162.0")
		os.Exit(0)
	case "codex-overflow":
		fmt.Fprintln(os.Stdout, "codex-cli 0.162.1")
		_, _ = os.Stdout.Write(make([]byte, 4096))
		os.Exit(0)
	case "timeout":
		time.Sleep(120 * time.Second)
		os.Exit(0)
	case "failed":
		os.Exit(7)
	}
}

func discoveryProcessFixtureCommand(ctx context.Context, role, pidFile string) *exec.Cmd {
	runtimeID := "opencode"
	if strings.HasPrefix(role, "codex-") {
		runtimeID = "codex"
	}
	cmd, err := discoveryCommand(ctx, runtimeID, uint32(os.Geteuid()), uint32(os.Getegid()))
	if err != nil {
		panic(err)
	}
	// Only the test substitutes an executable; retain discovery's group,
	// cancellation and pipe-wait policy, without requiring privileged setgroups.
	cmd.Path = os.Args[0]
	cmd.Args = []string{os.Args[0], "-test.run=^TestDiscoveryProcessHelper$"}
	cmd.Dir = filepath.Dir(pidFile)
	cmd.Env = []string{"MONOS_DISCOVERY_HELPER=" + role, "MONOS_DISCOVERY_CHILD_PID=" + pidFile, "GORACE=atexit_sleep_ms=0"}
	cmd.SysProcAttr.Credential = nil
	return cmd
}

func TestDiscoverySuccessfulProbeSettlesDescendants(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pidFile := filepath.Join(t.TempDir(), "child.pid")
	cmd := discoveryProcessFixtureCommand(ctx, "parent", pidFile)
	var output discoveryOutput
	cmd.Stdout = &output
	t.Cleanup(func() {
		if cmd.Process != nil {
			if absent, _ := settlePublicationRemoteGroup(cmd.Process.Pid); !absent {
				t.Error("test probe cleanup unresolved")
			}
		}
	})
	if err := runDiscoveryCommand(cmd); err != nil {
		t.Fatal(err)
	}
	if version, ok := runtimeVersion("opencode", output.String()); !ok || version != "2.0.20" || output.exceeded {
		t.Fatalf("successful probe lost its version: %q", output.String())
	}
	raw, err := os.ReadFile(pidFile)
	if err != nil {
		t.Fatal(err)
	}
	childPID, err := strconv.Atoi(string(raw))
	if err != nil || childPID <= 1 {
		t.Fatalf("invalid child identity: %q", raw)
	}
	if err := syscall.Kill(childPID, 0); !errors.Is(err, syscall.ESRCH) {
		t.Fatalf("successful version probe returned while child %d survived: %v", childPID, err)
	}
	if err := syscall.Kill(-cmd.Process.Pid, 0); !errors.Is(err, syscall.ESRCH) {
		t.Fatalf("successful version probe returned before its group settled: %v", err)
	}
}

func TestDiscoveryProbeStartAndExitResults(t *testing.T) {
	for _, role := range []string{"normal", "failed", "missing"} {
		t.Run(role, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			pidFile := filepath.Join(t.TempDir(), "child.pid")
			cmd := discoveryProcessFixtureCommand(ctx, role, pidFile)
			if role == "missing" {
				cmd.Path = filepath.Join(filepath.Dir(pidFile), "missing-cli")
			}
			var output discoveryOutput
			cmd.Stdout = &output
			err := runDiscoveryCommand(cmd)
			if role == "missing" {
				if !errors.Is(err, os.ErrNotExist) || cmd.Process != nil {
					t.Fatalf("missing executable result changed: %v", err)
				}
				return
			}
			if role == "failed" {
				var exit *exec.ExitError
				if !errors.As(err, &exit) || exit.ExitCode() != 7 {
					t.Fatalf("probe exit status lost: %v", err)
				}
			} else if version, ok := runtimeVersion("opencode", output.String()); err != nil || !ok || version != "2.0.20" {
				t.Fatalf("ordinary version probe changed: %q, %v", output.String(), err)
			}
			if err := syscall.Kill(-cmd.Process.Pid, 0); !errors.Is(err, syscall.ESRCH) {
				t.Fatalf("probe group survived: %v", err)
			}
		})
	}
}

func TestCodexDiscoveryReportsIndependentFacts(t *testing.T) {
	for _, tc := range []struct {
		role, availability, version string
	}{
		{"codex-normal", "detected", "0.162.1"},
		{"codex-parent", "detected", "0.162.1"},
		{"codex-old", "unavailable", "0.162.0"},
		{"codex-overflow", "unavailable", ""},
		{"failed", "unavailable", ""},
		{"timeout", "unavailable", ""},
	} {
		t.Run(tc.role, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if tc.role == "timeout" {
				var timeoutCancel context.CancelFunc
				ctx, timeoutCancel = context.WithTimeout(ctx, 50*time.Millisecond)
				defer timeoutCancel()
			}
			rows := UnavailableRuntimes()
			pidFile := filepath.Join(t.TempDir(), "child.pid")
			missing := discoveryProcessFixtureCommand(ctx, "missing", pidFile)
			missing.Path = filepath.Join(filepath.Dir(pidFile), "missing-cli")
			rows[0] = inspectRuntime(rows[0], missing)
			cmd := discoveryProcessFixtureCommand(ctx, tc.role, pidFile)
			rows[1] = inspectRuntime(rows[1], cmd)
			if rows[0].Availability != "not_found" || rows[1].RuntimeID != "codex" || string(rows[1].Availability) != tc.availability || !rows[1].SupportsThinking || !rows[1].SupportsModel {
				t.Fatalf("independent installation facts changed: %+v", rows)
			}
			if tc.version == "" {
				if rows[1].Version != nil {
					t.Fatal("failed probe retained an accepted version")
				}
			} else if rows[1].Version == nil || *rows[1].Version != tc.version {
				t.Fatal("observed version lost")
			}
			if cmd.Process != nil {
				if err := syscall.Kill(-cmd.Process.Pid, 0); !errors.Is(err, syscall.ESRCH) {
					t.Fatalf("Codex probe process group survived: %v", err)
				}
			}
		})
	}
}
