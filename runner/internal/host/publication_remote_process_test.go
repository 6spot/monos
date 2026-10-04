package host

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// Test-only executable roles exercise real parent/descendant ownership. No
// executable, role or environment selection is exposed by a product protocol.
func TestPublicationRemoteProcessHelper(t *testing.T) {
	switch os.Getenv("MONOS_REMOTE_PROCESS_HELPER") {
	case "parent":
		child := exec.Command(os.Args[0], "-test.run=^TestPublicationRemoteProcessHelper$")
		child.Env = append(publicationGitEnvironment(), "MONOS_REMOTE_PROCESS_HELPER=child")
		child.Stdout, child.Stderr = os.Stdout, os.Stderr
		if child.Start() != nil || os.WriteFile(os.Getenv("MONOS_REMOTE_PROCESS_PID_FILE"), []byte(strconv.Itoa(child.Process.Pid)), 0600) != nil {
			os.Exit(70)
		}
		// Keep the leader alive until the test binds its Linux boot/birth/UID.
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			if _, e := os.Stat(os.Getenv("MONOS_REMOTE_PROCESS_PID_FILE") + ".release"); e == nil {
				os.Exit(0) // Deliberately leaves its child and pipes alive.
			}
			time.Sleep(10 * time.Millisecond)
		}
		os.Exit(71)
	case "child":
		time.Sleep(120 * time.Second)
		os.Exit(0)
	case "output":
		_, _ = os.Stdout.Write([]byte(strings.Repeat("x", publicationRemoteOutputLimit+1)))
		time.Sleep(120 * time.Second)
		os.Exit(0)
	case "normal":
		_, _ = os.Stdout.Write([]byte("safe fixture output"))
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			if _, e := os.Stat(os.Getenv("MONOS_REMOTE_PROCESS_PID_FILE") + ".release"); e == nil {
				os.Exit(0)
			}
			time.Sleep(10 * time.Millisecond)
		}
		os.Exit(71)
	}
}

func publicationProcessFixtureCommand(ctx context.Context, role, pidFile string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestPublicationRemoteProcessHelper$")
	cmd.Env = append(publicationGitEnvironment(), "MONOS_REMOTE_PROCESS_HELPER="+role, "MONOS_REMOTE_PROCESS_PID_FILE="+pidFile)
	return cmd
}

func TestRemotePreparationProcessGroupCancellationAndParentExit(t *testing.T) {
	for _, cancelConnection := range []bool{false, true} {
		t.Run(fmt.Sprint("cancel_connection_", cancelConnection), func(t *testing.T) {
			root := filepath.Join(publicationTestRoot(t), "remote")
			item, e := lockPublicationRemoteItem(context.Background(), root, "item")
			if e != nil {
				t.Fatal(e)
			}
			defer item.close()
			op, e := item.operationDirectory("operation")
			if e != nil {
				t.Fatal(e)
			}
			intentPath := filepath.Join(op, "intent.json")
			if savePublicationFile(intentPath, map[string]any{"started": true, "operation_id": "operation"}) != nil {
				t.Fatal("started intent unavailable")
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			pidFile := filepath.Join(op, "child.pid")
			childPID := 0
			observedLiveDescendant := false
			started := time.Now()
			out, e := runPublicationRemoteProcess(ctx, func(ctx context.Context) *exec.Cmd { return publicationProcessFixtureCommand(ctx, "parent", pidFile) }, func(worker publicationRemoteWorker) error {
				if runtime.GOOS == "linux" && (worker.UID != uint32(os.Geteuid()) || worker.Birth == "" || worker.BootID == "") {
					return fmt.Errorf("missing actual Linux UID identity binding")
				}
				if e := savePublicationFile(filepath.Join(op, "worker.json"), worker); e != nil {
					return e
				}
				deadline := time.Now().Add(2 * time.Second)
				for time.Now().Before(deadline) {
					raw, e := os.ReadFile(pidFile)
					if e == nil {
						childPID, e = strconv.Atoi(string(raw))
						group, groupErr := syscall.Getpgid(childPID)
						if e == nil && groupErr == nil && group == worker.Group && syscall.Kill(childPID, 0) == nil {
							observedLiveDescendant = true
							if e := os.WriteFile(pidFile+".release", nil, 0600); e != nil {
								return e
							}
							if cancelConnection {
								cancel()
							}
							return nil
						}
					}
					time.Sleep(10 * time.Millisecond)
				}
				return fmt.Errorf("controlled descendant not observed")
			})
			if !observedLiveDescendant || childPID <= 1 || e == nil || !out.Started || !out.Interrupted || !out.WorkerAbsent || len(out.Output) != 0 {
				t.Fatalf("parent exit/cancellation manufactured release: %+v error=%v", out, e)
			}
			if syscall.Kill(-out.Worker.Group, 0) != syscall.ESRCH || syscall.Kill(childPID, 0) != syscall.ESRCH {
				t.Fatal("controlled descendant/group survived reported absence")
			}
			if time.Since(started) > 6*time.Second {
				t.Fatal("physical cleanup exceeded bound")
			}
			if _, e := readPublicationFile(intentPath); e != nil {
				t.Fatal("uncertain started intent was lost", e)
			}
			if _, e := os.Lstat(filepath.Join(op, "result.json")); !os.IsNotExist(e) {
				t.Fatal("interruption created a terminal remote result")
			}
		})
	}
}

func TestRemotePreparationProcessOutputBoundAndNormalAbsence(t *testing.T) {
	for _, role := range []string{"normal", "output"} {
		t.Run(role, func(t *testing.T) {
			pidFile := filepath.Join(publicationTestRoot(t), "helper")
			out, e := runPublicationRemoteProcess(context.Background(), func(ctx context.Context) *exec.Cmd { return publicationProcessFixtureCommand(ctx, role, pidFile) }, func(worker publicationRemoteWorker) error {
				return os.WriteFile(pidFile+".release", nil, 0600)
			})
			if !out.Started || !out.WorkerAbsent || syscall.Kill(-out.Worker.Group, 0) != syscall.ESRCH {
				t.Fatal("missing actual group absence")
			}
			if role == "normal" && (e != nil || string(out.Output) != "safe fixture output" || out.Interrupted) {
				t.Fatal("normal fixed process failed", e)
			}
			if role == "output" && (e == nil || len(out.Output) != 0 || !out.Interrupted) {
				t.Fatal("output overflow did not stop ownership", e)
			}
		})
	}
}

func TestRemotePreparationProcessUIDStatusBounds(t *testing.T) {
	uid, e := publicationRemoteStatusUID([]byte("Name:\tgit\nUid:\t997\t997\t997\t997\n"))
	if e != nil || uid != 997 {
		t.Fatal("bounded service UID parse failed", e)
	}
	for _, raw := range []string{"", "Uid: 997 0 997 997\n", "Uid: 997 997 997\n", "Uid: 997 997 997 997\nUid: 997 997 997 997\n", "Uid: 4294967296 4294967296 4294967296 4294967296\n", "Uid: -1 -1 -1 -1\n", strings.Repeat("x", publicationRemoteStatusLimit+1)} {
		if _, e := publicationRemoteStatusUID([]byte(raw)); e == nil {
			t.Fatal("untrusted process status accepted")
		}
	}
}

func TestRemotePreparationProcessLinuxUIDBinding(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("actual Linux proc credential binding")
	}
	uid, e := publicationRemoteProcUID(os.Getpid())
	if e != nil || uid != uint32(os.Geteuid()) {
		t.Fatal("actual Linux service process UID was not verified", e)
	}
	pidFile := filepath.Join(publicationTestRoot(t), "helper")
	bound := false
	out, e := runPublicationRemoteProcess(context.Background(), func(ctx context.Context) *exec.Cmd { return publicationProcessFixtureCommand(ctx, "normal", pidFile) }, func(worker publicationRemoteWorker) error {
		actual, e := publicationRemoteProcUID(worker.PID)
		if e != nil || actual != worker.UID || actual != uint32(os.Geteuid()) || worker.Birth == "" || worker.BootID == "" {
			return fmt.Errorf("child actual UID/boot/birth binding unavailable")
		}
		bound = true
		return os.WriteFile(pidFile+".release", nil, 0600)
	})
	if e != nil || !bound || !out.WorkerAbsent || out.Interrupted {
		t.Fatal("Linux UID-bound process failed", e)
	}
}

func TestRemotePreparationGuardedPushRevalidatesFixedHook(t *testing.T) {
	work, head := scanFixture(t)
	root := publicationTestRoot(t)
	remote := filepath.Join(root, "remote.git")
	resultTestGit(t, root, nil, "init", "--bare", "--quiet", remote)
	guard := publicationPushGuard{head, strings.Repeat("0", len(head)), "refs/heads/delivery", remote}
	hooks, _, e := installPublicationPushGuard(context.Background(), root, guard)
	if e != nil {
		t.Fatal(e)
	}
	if e := os.Chmod(filepath.Join(hooks, "pre-push"), 0600); e != nil {
		t.Fatal(e)
	}
	out, e := runPublicationGuardedPush(context.Background(), scanDir(t, work), root, guard, nil, nil)
	if e == nil || out.Started || !out.WorkerAbsent {
		t.Fatal("Git could silently skip nonexecutable hook")
	}
	if e := os.Chmod(filepath.Join(hooks, "pre-push"), 0700); e != nil {
		t.Fatal(e)
	}
	out, e = runPublicationGuardedPush(context.Background(), scanDir(t, work), root, guard, nil, nil)
	if e != nil || !out.Started || !out.WorkerAbsent || resultTestGit(t, remote, nil, "rev-parse", guard.ref) != head {
		t.Fatal("guarded fixed Git push failed", e)
	}
}
