package host

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"syscall"
	"testing"
	"time"

	protocol "monos.local/protocol"
)

func TestPublicationRemoteCrashHelper(t *testing.T) {
	root := os.Getenv("MONOS_REMOTE_CRASH_ROOT")
	if root == "" {
		return
	}
	raw, e := readPublicationFile(filepath.Join(root, "request.json"))
	var request protocol.PublicationPushRequest
	if e != nil || json.Unmarshal(raw, &request) != nil {
		os.Exit(70)
	}
	item, e := lockPublicationRemoteItem(context.Background(), filepath.Join(root, "remote"), request.ItemID)
	if e != nil {
		os.Exit(70)
	}
	defer item.close()
	op, e := item.operationDirectory(request.OperationID)
	if e != nil {
		os.Exit(70)
	}
	if savePublicationFile(filepath.Join(op, "intent.json"), request) != nil || savePublicationFile(filepath.Join(op, "started.json"), map[string]any{"operation_id": request.OperationID, "request_digest": publicationDigest(request)}) != nil {
		os.Exit(70)
	}
	pidFile := filepath.Join(op, "child.pid")
	_, _ = runPublicationRemoteProcess(context.Background(), func(ctx context.Context) *exec.Cmd { return publicationProcessFixtureCommand(ctx, "parent", pidFile) }, func(worker publicationRemoteWorker) error {
		if e := savePublicationFile(filepath.Join(op, "worker.json"), worker); e != nil {
			return e
		}
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			raw, e := os.ReadFile(pidFile)
			pid, pe := strconv.Atoi(string(raw))
			group, ge := syscall.Getpgid(pid)
			if e == nil && pe == nil && ge == nil && group == worker.Group && syscall.Kill(pid, 0) == nil {
				if os.WriteFile(filepath.Join(root, "ready"), []byte("live-descendant"), 0600) != nil {
					os.Exit(70)
				}
				select {}
			}
			time.Sleep(10 * time.Millisecond)
		}
		return fmt.Errorf("crash fixture descendant missing")
	})
	os.Exit(71)
}

func TestRemotePreparationRunnerSIGKILLAndIdentitySafeRecovery(t *testing.T) {
	f := publicationPushTestFixture(t)
	root := filepath.Dir(f.root)
	if e := savePublicationFile(filepath.Join(root, "request.json"), f.request); e != nil {
		t.Fatal(e)
	}
	runner := exec.Command(os.Args[0], "-test.run=^TestPublicationRemoteCrashHelper$")
	runner.Env = append(publicationGitEnvironment(), "MONOS_REMOTE_CRASH_ROOT="+root)
	runner.Stdout, runner.Stderr = io.Discard, io.Discard
	if runner.Start() != nil {
		t.Fatal("controlled Runner process start failed")
	}
	op := filepath.Join(f.remoteRoot, "items", f.request.ItemID, "operations", f.request.OperationID)
	var worker publicationRemoteWorker
	t.Cleanup(func() {
		_ = runner.Process.Kill()
		if worker.Group > 1 {
			_ = syscall.Kill(-worker.Group, syscall.SIGKILL)
		}
	})
	deadline := time.Now().Add(5 * time.Second)
	ready := false
	for time.Now().Before(deadline) {
		if raw, e := os.ReadFile(filepath.Join(root, "ready")); e == nil && string(raw) == "live-descendant" {
			raw, e = readPublicationFile(filepath.Join(op, "worker.json"))
			if e == nil && json.Unmarshal(raw, &worker) == nil {
				ready = true
				break
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !ready {
		t.Fatal("actual Runner-owned lingering descendant not observed")
	}
	if runner.Process.Signal(syscall.SIGKILL) != nil {
		t.Fatal("Runner SIGKILL failed")
	}
	if runner.Wait() == nil {
		t.Fatal("Runner did not die from SIGKILL")
	}
	if syscall.Kill(-worker.Group, 0) != nil {
		t.Fatal("controlled Git/helper group did not survive Runner death")
	}
	// Parent death releases its flock while the separate Git group remains live.
	item, e := lockPublicationRemoteItem(context.Background(), f.remoteRoot, f.request.ItemID)
	if e != nil {
		t.Fatal(e)
	}
	item.close()
	if _, e := readPublicationFile(filepath.Join(op, "result.json")); !os.IsNotExist(e) {
		t.Fatal("Runner death manufactured terminal result")
	}
	if runtime.GOOS != "linux" {
		if recoverPublicationRemoteAbsence(op, f.request) {
			t.Fatal("missing Linux boot/birth manufactured absence")
		}
		return
	}
	// Tampered birth cannot authorize killing a current process with reused PID.
	original, _ := readPublicationFile(filepath.Join(op, "worker.json"))
	wrong := worker
	wrong.Birth = "different-process-birth"
	if os.WriteFile(filepath.Join(op, "worker.json"), mustPublicationCanonical(wrong), 0600) != nil {
		t.Fatal("tamper fixture failed")
	}
	if recoverPublicationRemoteAbsence(op, f.request) || syscall.Kill(-worker.Group, 0) != nil {
		t.Fatal("mismatched birth signaled reused/current group")
	}
	if os.WriteFile(filepath.Join(op, "worker.json"), original, 0600) != nil {
		t.Fatal("restore fixture failed")
	}
	result, e := f.run(context.Background())
	if e != nil || result.Status != "reconciliation_required" || !result.PushStarted || !result.WorkerAbsent || f.pushes.Load() != 0 || syscall.Kill(-worker.Group, 0) != syscall.ESRCH {
		t.Fatal("Runner loss repeated effect or released live writer", e)
	}
	if _, e := readPublicationFile(filepath.Join(op, "started.json")); e != nil {
		t.Fatal("original possible effect was lost")
	}
}

func TestRemotePreparationSpawnPersistenceGapKeepsOwnership(t *testing.T) {
	f := publicationPushTestFixture(t)
	f.io.fault = func(stage string) error {
		if stage == "started" {
			return fmt.Errorf("Runner lost before durable spawn identity")
		}
		return nil
	}
	if _, e := f.run(context.Background()); e == nil {
		t.Fatal("spawn gap fixture did not stop")
	}
	f.io.fault = nil
	if _, e := f.run(context.Background()); e == nil || f.pushes.Load() != 0 {
		t.Fatal("missing worker identity allowed an effect/release")
	}
	op := filepath.Join(f.remoteRoot, "items", f.request.ItemID, "operations", f.request.OperationID)
	if _, e := os.Lstat(filepath.Join(op, "result.json")); !os.IsNotExist(e) {
		t.Fatal("spawn gap created physical absence")
	}
}
