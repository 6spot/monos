package host

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
	"testing"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func inspectionFixture(t *testing.T, id string) (string, protocol.Operation, *resultGitFixture) {
	t.Helper()
	root := publicationTestRoot(t)
	for _, name := range []string{"service", "inspection"} {
		if err := os.Mkdir(filepath.Join(root, name), 0750); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _ = writableInspectionTree(root) })
	f := resultTestNew(t)
	resultTestWrite(t, f.work, "AGENTS.md", []byte("Read repository conventions.\n"))
	f.finish(t)
	resultTestGit(t, f.export, nil, "update-ref", "refs/heads/main", f.request.Identity.GitCommit)
	i := protocol.InspectionDescriptor{SchemaVersion: 1, InspectionID: id, AttemptID: "planner", DispatchID: "dispatch", ScopeKind: "task", ScopeID: "task", ProjectID: "project", RunnerID: "runner", Resource: protocol.WorkspaceResource{ResourceID: "repo", RemoteURL: "https://github.com/example/repo.git", RepositoryIdentity: "github.com/example/repo", DefaultBranch: ptr("main")}, PlannerSource: protocol.InspectionPlannerSource{Kind: "task_initial_planning", SourceID: "intent", ControlVersion: 1, ContextDigest: strings.Repeat("a", 64)}, Origin: protocol.InspectionOrigin{Kind: "default_ref"}}
	_, digest, err := wire.Canonical(i)
	if err != nil {
		t.Fatal(err)
	}
	op := protocol.Operation{OperationID: id, AttemptID: "planner", DispatchID: "dispatch", ResourceID: ptr("repo"), Kind: protocol.KindInspectRepository, Inspection: &i, InspectionDigest: &digest}
	return root, op, f
}

func localInspectionAccess(op protocol.Operation) protocol.InspectionRepositoryAccessResult {
	return protocol.InspectionRepositoryAccessResult{SchemaVersion: 1, OperationID: op.OperationID, InspectionDigest: *op.InspectionDigest, RemoteURL: op.Inspection.Resource.RemoteURL, DefaultBranch: "main", Authentication: protocol.RepositoryAuthentication{Kind: "anonymous"}, ProviderMetadata: protocol.RepositoryProviderMetadata{Github: &protocol.GithubClass{RepositoryID: "123"}}}
}

func localInspectionFetch(t *testing.T, f *resultGitFixture, after func() error) func(context.Context, *inspectionSession) (string, string, string, error) {
	t.Helper()
	return func(ctx context.Context, s *inspectionSession) (string, string, string, error) {
		s.remoteGit = func(ctx context.Context, repo string, env []string, args ...string) (string, error) {
			for n, arg := range args {
				if arg == s.operation.Inspection.Resource.RemoteURL {
					args[n] = f.export
				}
			}
			return s.git(ctx, repo, env, append([]string{"-c", "protocol.file.allow=always"}, args...)...)
		}
		path, commit, tree, err := s.fetch(ctx, func(_ context.Context, op protocol.Operation) (protocol.InspectionRepositoryAccessResult, error) {
			return localInspectionAccess(op), nil
		})
		if err == nil && after != nil {
			err = after()
		}
		return path, commit, tree, err
	}
}

func TestInspectionPinsFirstFetchAcrossMovedRemoteAndRetry(t *testing.T) {
	root, op, f := inspectionFixture(t, "pinned")
	resultTestGit(t, f.export, nil, "update-ref", "refs/heads/main", f.request.Identity.GitCommit)
	want := f.request.Identity.GitCommit
	_, err := inspectRepositoryAt(context.Background(), root, "storage", op, nil, localInspectionFetch(t, f, func() error { return ErrInspectionUnresolved }))
	if !errors.Is(err, ErrInspectionUnresolved) {
		t.Fatal("crash seam not retained", err)
	}
	resultTestWrite(t, f.work, "tracked.txt", []byte("remote moved\n"))
	resultTestGit(t, f.work, nil, "add", ".")
	resultTestGit(t, f.work, nil, "commit", "--quiet", "-m", "later")
	newHead := resultTestGit(t, f.work, nil, "rev-parse", "HEAD")
	resultTestGit(t, f.export, nil, "fetch", f.work, newHead+":refs/heads/main")
	out, err := inspectRepositoryAt(context.Background(), root, "storage", op, nil, localInspectionFetch(t, f, nil))
	if err != nil || out.Inspection == nil || out.Inspection.Status != "available" || out.Inspection.Snapshot.Commit != want {
		t.Fatalf("pin moved: %+v %v", out.Inspection, err)
	}
	if out.WorkspaceID != nil || out.WorkspaceMetadata != nil || out.WriterAbsent != nil {
		t.Fatal("inspection acquired workspace authority")
	}
	snapshot := out.Inspection.Snapshot
	if !reflect.DeepEqual(snapshot.InstructionFiles, []string{"AGENTS.md"}) {
		t.Fatal(snapshot.InstructionFiles)
	}
	if head := resultTestGit(t, snapshot.Path, nil, "-c", "safe.directory="+snapshot.Path, "rev-parse", "HEAD"); head != want {
		t.Fatal(head)
	}
	if err = filepath.Walk(snapshot.Path, func(p string, i os.FileInfo, e error) error {
		if e != nil {
			return e
		}
		st, ok := i.Sys().(*syscall.Stat_t)
		if !ok || st.Uid != uint32(os.Geteuid()) || i.Mode()&os.ModeSymlink == 0 && i.Mode().Perm()&0222 != 0 {
			return errors.New("snapshot is writable or foreign")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	replayed, err := inspectRepositoryAt(context.Background(), root, "storage", op, nil, nil)
	if err != nil || !reflect.DeepEqual(out, replayed) {
		t.Fatal("retained result changed", err)
	}
}

func TestInspectionOperationsAndResourcesHaveSeparateSnapshots(t *testing.T) {
	root, op, f := inspectionFixture(t, "first")
	source := func(_ context.Context, _ *inspectionSession) (string, string, string, error) {
		return f.export, f.request.Identity.GitCommit, f.request.Identity.GitTree, nil
	}
	a, e := inspectRepositoryAt(context.Background(), root, "storage", op, nil, source)
	if e != nil || a.Inspection.Status != "available" {
		t.Fatal(a, e)
	}
	op.OperationID = "second"
	op.Inspection.InspectionID = "second"
	op.Inspection.Resource.ResourceID = "other"
	op.ResourceID = ptr("other")
	_, digest, _ := wire.Canonical(op.Inspection)
	op.InspectionDigest = &digest
	b, e := inspectRepositoryAt(context.Background(), root, "storage", op, nil, source)
	if e != nil || b.Inspection.Status != "available" || a.Inspection.Snapshot.Path == b.Inspection.Snapshot.Path {
		t.Fatal(b, e)
	}
	if _, e = os.Lstat(filepath.Join(root, "tasks")); !os.IsNotExist(e) {
		t.Fatal("inspection created task workspace")
	}
}

func TestInspectionRejectsChangedRetainedDescriptorAndUnknownWorker(t *testing.T) {
	for _, mode := range []string{"descriptor", "unknown-worker", "storage"} {
		t.Run(mode, func(t *testing.T) {
			root, op, f := inspectionFixture(t, "uncertain")
			_, e := inspectRepositoryAt(context.Background(), root, "storage", op, nil, localInspectionFetch(t, f, func() error { return ErrInspectionUnresolved }))
			if e == nil {
				t.Fatal("expected retained failure")
			}
			p := filepath.Join(root, "service", "inspection-operations", op.OperationID, "record.json")
			raw, e := os.ReadFile(p)
			if e != nil {
				t.Fatal(e)
			}
			var record inspectionRecord
			if json.Unmarshal(raw, &record) != nil {
				t.Fatal("record")
			}
			switch mode {
			case "descriptor":
				record.Descriptor.ProjectID = "foreign"
			case "unknown-worker":
				record.WorkerActive = true
				record.Worker = nil
			case "storage":
				record.StorageID = "foreign"
			}
			if e = saveRecord(p, record); e != nil {
				t.Fatal(e)
			}
			out, e := inspectRepositoryAt(context.Background(), root, "storage", op, nil, nil)
			if !errors.Is(e, ErrInspectionUnresolved) || out.Inspection != nil {
				t.Fatal("unknown state exposed", out, e)
			}
		})
	}
}

func TestInspectionSlowFetchCancellationSettlesProcessGroup(t *testing.T) {
	root, op, f := inspectionFixture(t, "slow")
	dir := filepath.Join(root, "service", "inspection-operations", op.OperationID)
	if e := os.MkdirAll(dir, 0700); e != nil {
		t.Fatal(e)
	}
	s := &inspectionSession{root: root, operation: op, record: inspectionRecord{Descriptor: *op.Inspection, Digest: *op.InspectionDigest, StorageID: "storage", Deadline: time.Now().Add(time.Minute).Unix()}}
	if e := s.save(); e != nil {
		t.Fatal(e)
	}
	script := filepath.Join(dir, "slow-upload")
	// A real Git fetch owns the blocking upload-pack child in the same group.
	if e := os.WriteFile(script, []byte("#!/bin/sh\nsleep 30\n"), 0700); e != nil {
		t.Fatal(e)
	}
	repo := filepath.Join(dir, "bare.git")
	resultTestGit(t, dir, nil, "init", "--bare", "--quiet", repo)
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(200*time.Millisecond, cancel)
	started := time.Now()
	_, e := s.git(ctx, repo, nil, "fetch", "--upload-pack="+script, f.export, "HEAD")
	if e == nil || time.Since(started) > 5*time.Second || s.record.WorkerActive || s.record.Worker == nil {
		t.Fatal("slow fetch not drained", e, s.record)
	}
	if e = syscall.Kill(-s.record.Worker.Group, 0); !errors.Is(e, syscall.ESRCH) {
		t.Fatal("Git child group remains", e)
	}
	stopped, cancelStop := context.WithCancel(context.Background())
	cancelStop()
	out, e := inspectRepositoryAt(stopped, root, "storage", op, nil, nil)
	if e != nil || out.Inspection.Status != "unavailable" || out.Inspection.Reason == nil || *out.Inspection.Reason != "cancelled" {
		t.Fatal(out, e)
	}
}
