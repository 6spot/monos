package host

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func inspectionSourceSession(t *testing.T, root string, op protocol.Operation) *inspectionSession {
	t.Helper()
	s := &inspectionSession{root: root, operation: op, record: inspectionRecord{Descriptor: *op.Inspection, Digest: *op.InspectionDigest, StorageID: "storage", Deadline: time.Now().Add(time.Minute).Unix()}}
	if e := os.MkdirAll(s.private(), 0700); e != nil {
		t.Fatal(e)
	}
	if e := s.save(); e != nil {
		t.Fatal(e)
	}
	return s
}

func TestInspectionCompletionRequiresExactProtectedExportRef(t *testing.T) {
	for _, mode := range []string{"valid", "ref", "tree", "storage", "repository", "missing-export"} {
		t.Run(mode, func(t *testing.T) {
			root, op, f := inspectionFixture(t, "completion-proof")
			id := f.request.Identity
			id.StorageID = "storage"
			_, digest, _ := wire.Canonical(id)
			op.Inspection.Origin = protocol.InspectionOrigin{Kind: "task_completion", Identity: &id, IdentityDigest: &digest}
			s := inspectionSourceSession(t, root, op)
			s.resultExport = func(protocol.ResultReadIdentity) (string, string) {
				if mode == "missing-export" {
					return "", "unavailable"
				}
				return f.export, ""
			}
			switch mode {
			case "ref":
				resultTestGit(t, f.export, nil, "update-ref", "refs/monos/result", f.base)
			case "tree":
				id.GitTree = strings.Repeat("f", 40)
			case "storage":
				id.StorageID = "foreign"
			case "repository":
				id.RepositoryIdentity = "foreign"
			}
			_, commit, _, e := s.origin(context.Background())
			if (e == nil) != (mode == "valid") {
				t.Fatal(mode, commit, e)
			}
		})
	}
}

func TestInspectionInitialOpenRequiresOriginalCachePin(t *testing.T) {
	for _, mode := range []string{"valid", "ref", "pin-digest", "missing-pin", "later-basis", "checkpoint", "finalized"} {
		t.Run(mode, func(t *testing.T) {
			root, op, f := inspectionFixture(t, "open-proof")
			cache := filepath.Join(root, "cache", "resources", "repo.git")
			if e := os.MkdirAll(filepath.Dir(cache), 0750); e != nil {
				t.Fatal(e)
			}
			resultTestGit(t, f.work, nil, "clone", "--bare", "--no-local", f.export, cache)
			resultTestGit(t, cache, nil, "update-ref", "refs/monos/pins/open/base", f.request.Identity.GitCommit)
			w := protocol.WorkspaceDescriptor{SchemaVersion: 1, WorkspaceID: "workspace", TaskID: "task", ProjectID: "project", RunnerID: "runner", ResourceID: "repo", Resource: op.Inspection.Resource, OpenOperationID: "open", LeaseID: "lease", Generation: 1}
			_, digest, _ := wire.Canonical(w)
			m := protocol.WorkspaceMetadata{BaseCommit: f.request.Identity.GitCommit, FinalizedCommit: f.request.Identity.GitCommit, StorageID: "storage", RepositoryIdentity: op.Inspection.Resource.RepositoryIdentity, LeaseID: "lease", Generation: 1}
			op.Inspection.Origin = protocol.InspectionOrigin{Kind: "task_open", OperationID: ptr("open"), Workspace: &w, WorkspaceDigest: &digest, Metadata: &m}
			pins := filepath.Join(root, "service", "workspace-operations")
			if e := os.Mkdir(pins, 0700); e != nil {
				t.Fatal(e)
			}
			pinDigest := digest
			if mode == "pin-digest" {
				pinDigest = strings.Repeat("f", 64)
			}
			if mode != "missing-pin" {
				if e := saveRecord(filepath.Join(pins, "open.json"), map[string]any{"digest": pinDigest, "complete": true, "metadata": m}); e != nil {
					t.Fatal(e)
				}
			}
			s := inspectionSourceSession(t, root, op)
			switch mode {
			case "ref":
				resultTestGit(t, cache, nil, "update-ref", "refs/monos/pins/open/base", f.base)
			case "later-basis":
				w.Basis = &protocol.WorkspaceBasis{}
			case "checkpoint":
				m.Checkpoint = &protocol.WorkspaceCheckpoint{}
			case "finalized":
				m.FinalizedCommit = f.base
			}
			_, commit, tree, e := s.origin(context.Background())
			if (e == nil) != (mode == "valid") {
				t.Fatal(mode, commit, tree, e)
			}
		})
	}
}

func TestInspectionAccessCanonicalizesConfiguredGitHubAliases(t *testing.T) {
	_, op, _ := inspectionFixture(t, "aliases")
	access := localInspectionAccess(op)
	for _, configured := range []string{"git@github.com:example/repo.git", "https://github.com/example/repo", "https://github.com/Example/Repo.git"} {
		op.Inspection.Resource.RemoteURL = configured
		if _, e := inspectionAccessEnvironment(op, access); e != nil {
			t.Fatal(configured, e)
		}
	}
	access.RemoteURL = "https://github.com/foreign/repo.git"
	if _, e := inspectionAccessEnvironment(op, access); e == nil {
		t.Fatal("foreign repository access accepted")
	}
}
