package host

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func completionGit(t *testing.T) (string, string, string) {
	t.Helper()
	dir := t.TempDir()
	gitOK(t, dir, "init")
	writeCompletionFile(t, dir, "file", "base\n")
	writeCompletionFile(t, dir, ".gitignore", "ignored\n")
	gitOK(t, dir, "add", ".")
	gitOK(t, dir, "commit", "-m", "base")
	return dir, filepath.Join(dir, ".git"), gitOK(t, dir, "rev-parse", "HEAD")
}
func gitOK(t *testing.T, dir string, args ...string) string {
	t.Helper()
	out, err := git(dir, args...)
	if err != nil {
		t.Fatal(err)
	}
	return out
}
func writeCompletionFile(t *testing.T, dir, name, value string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(value), 0600); err != nil {
		t.Fatal(err)
	}
}
func readCompletionFile(t *testing.T, p string) []byte {
	t.Helper()
	raw, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestCompletionRecoveryCapturesBrokenAncestryWithoutMutatingPrivateWork(t *testing.T) {
	for _, badIntent := range []bool{false, true} {
		t.Run(fmtBool(badIntent), func(t *testing.T) {
			dir, common, base := completionGit(t)
			tree := gitOK(t, dir, "rev-parse", "HEAD^{tree}")
			unrelated := gitOK(t, dir, "commit-tree", tree, "-m", "unrelated Agent history")
			gitOK(t, dir, "update-ref", "HEAD", unrelated, base)
			writeCompletionFile(t, dir, "file", "staged\n")
			gitOK(t, dir, "add", "file")
			writeCompletionFile(t, dir, "file", "unstaged\n")
			writeCompletionFile(t, dir, "untracked", "keep\n")
			writeCompletionFile(t, dir, "ignored", "private\n")
			index := readCompletionFile(t, filepath.Join(common, "index"))
			if badIntent {
				writeCompletionFile(t, common, "monos-finalization-original.json", "{truncated")
			}
			if _, err := finalize(dir, common, "original", base); err == nil || ClassifyFailure(err) != protocol.InvalidFinalization {
				t.Fatal("normal completion relaxed ancestry", err)
			}
			if _, err := checkpoint(dir, common, "normal-stop", base); err == nil {
				t.Fatal("normal Stop relaxed ancestry")
			}
			if result, err := reconcileFinalization(dir, common, "original", base); err != nil || result != nil {
				t.Fatal("uncommitted failed completion became success", result, err)
			}
			cp, err := completionRecoveryCheckpoint(dir, common, "settlement", "original", strings.Repeat("a", 64), base)
			if err != nil {
				t.Fatal(err)
			}
			again, err := completionRecoveryCheckpoint(dir, common, "settlement", "original", strings.Repeat("a", 64), base)
			if err != nil || !reflect.DeepEqual(cp, again) {
				t.Fatal("checkpoint replay changed evidence", err)
			}
			if gitOK(t, dir, "rev-parse", "HEAD") != unrelated || string(readCompletionFile(t, filepath.Join(common, "index"))) != string(index) {
				t.Fatal("recovery changed HEAD/index")
			}
			for name, want := range map[string]string{"file": "unstaged\n", "untracked": "keep\n", "ignored": "private\n"} {
				if string(readCompletionFile(t, filepath.Join(dir, name))) != want {
					t.Fatal("recovery changed file", name)
				}
			}
			if badIntent && string(readCompletionFile(t, filepath.Join(common, "monos-finalization-original.json"))) != "{truncated" {
				t.Fatal("malformed intent rewritten")
			}
			if gitOK(t, dir, "show", cp.CommitID+":file") != "unstaged" || gitOK(t, dir, "show", cp.CommitID+":untracked") != "keep" {
				t.Fatal("checkpoint omitted private working tree")
			}
			if _, err := git(dir, "cat-file", "-e", cp.CommitID+":ignored"); err == nil {
				t.Fatal("ignored private data claimed as Git output")
			}
			// This is explicit Agent correction, not a Program reset. Original fixed
			// lineage becomes an actual parent while the captured output tree remains.
			repaired := gitOK(t, dir, "commit-tree", cp.TreeID, "-p", base, "-p", unrelated, "-m", "Agent repairs lineage")
			gitOK(t, dir, "update-ref", "HEAD", repaired, unrelated)
			result, err := finalize(dir, common, "corrected-completion", base)
			if err != nil || *result.GitTree != cp.TreeID {
				t.Fatal("corrected strict completion failed", err)
			}
		})
	}
}

func TestCompletionReconcilesOnlyFrozenIntegratedGitResult(t *testing.T) {
	for _, stage := range []string{"intent", "object", "ref", "head", "different-ref", "different-head"} {
		t.Run(stage, func(t *testing.T) {
			dir, common, base := completionGit(t)
			writeCompletionFile(t, dir, "file", "complete\n")
			finished, err := finalize(dir, common, "original", base)
			if err != nil {
				t.Fatal(err)
			}
			ref := "refs/monos/operations/original"
			if stage != "head" {
				gitOK(t, dir, "update-ref", "HEAD", base, *finished.GitCommit)
			}
			if stage == "intent" || stage == "object" {
				gitOK(t, dir, "update-ref", "-d", ref)
			}
			if stage == "different-ref" {
				gitOK(t, dir, "update-ref", ref, base)
			}
			if stage == "different-head" {
				other := gitOK(t, dir, "commit-tree", *finished.GitTree, "-p", base, "-m", "different")
				gitOK(t, dir, "update-ref", "HEAD", other, base)
			}
			before := readCompletionFile(t, filepath.Join(common, "monos-finalization-original.json"))
			result, err := reconcileFinalization(dir, common, "original", base)
			switch stage {
			case "intent", "object":
				if err != nil || result != nil {
					t.Fatal("intent/object alone granted completion", result, err)
				}
			case "ref", "head":
				if err != nil || !reflect.DeepEqual(result, &finished) || gitOK(t, dir, "rev-parse", "HEAD") != *finished.GitCommit {
					t.Fatal("lost exact partial result", result, err)
				}
			default:
				if err == nil {
					t.Fatal("ambiguous finalization abandoned or accepted")
				}
			}
			if string(before) != string(readCompletionFile(t, filepath.Join(common, "monos-finalization-original.json"))) {
				t.Fatal("retained intent changed")
			}
		})
	}
}

func TestCompletionRecoveryDoesNotHideMissingRequiredObjects(t *testing.T) {
	dir, common, base := completionGit(t)
	intent := finalizationIntent{Base: base, Parent: strings.Repeat("f", 40), Tree: gitOK(t, dir, "rev-parse", "HEAD^{tree}"), Date: "2026-09-30T00:00:00Z"}
	if err := saveRecord(filepath.Join(common, "monos-finalization-original.json"), intent); err != nil {
		t.Fatal(err)
	}
	if result, err := reconcileFinalization(dir, common, "original", base); err == nil || result != nil {
		t.Fatal("missing retained parent treated as cancellable ancestry", result, err)
	}
}

func completionOperations(t *testing.T) (protocol.Dispatch, protocol.Operation, protocol.Operation) {
	t.Helper()
	d, original := canonicalWorkspace(t)
	d.NodeExecutionSource = &protocol.NodeExecutionSource{SourceID: "source", NodeID: *d.NodeID, NodeActivation: d.NodeActivation, SpecificationID: "spec", PlanID: "plan", ControlVersion: d.ControlVersion, ContextDigest: strings.Repeat("a", 64)}
	original.Kind = protocol.KindCompleteNode
	original.OperationID = "completion"
	original.RequestID = "complete-request"
	original.CompletionManifestDigest = ptr(strings.Repeat("b", 64))
	digest, err := wire.OperationIdentity(original)
	if err != nil {
		t.Fatal(err)
	}
	settle := original
	settle.Kind = protocol.SettleCompletion
	settle.OperationID = "settlement"
	settle.RequestID = "settle-request"
	settle.CompletionManifestDigest = nil
	settle.CompletionOperationID = &original.OperationID
	settle.CompletionIdentityDigest = &digest
	return d, original, settle
}

func TestCompletionFenceBindsOriginalImmutableIdentity(t *testing.T) {
	_, original, settle := completionOperations(t)
	p := filepath.Join(t.TempDir(), "fence.json")
	if err := saveRecord(p, settle); err != nil {
		t.Fatal(err)
	}
	if _, err := readCompletionFenceAt(p, original, uint32(os.Geteuid())); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*protocol.Operation){func(op *protocol.Operation) { op.RequestID = "changed" }, func(op *protocol.Operation) { op.CompletionManifestDigest = ptr(strings.Repeat("c", 64)) }, func(op *protocol.Operation) { op.AttemptID = "another" }} {
		other := original
		change(&other)
		if _, err := readCompletionFenceAt(p, other, uint32(os.Geteuid())); err == nil {
			t.Fatal("delayed worker accepted changed target")
		}
	}
	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(p, link); err != nil {
		t.Fatal(err)
	}
	if _, err := readCompletionFenceAt(link, original, uint32(os.Geteuid())); err == nil {
		t.Fatal("untrusted fence accepted")
	}
}

func TestCanonicalRepositoryFreeScopeCannotBecomeFixtureGit(t *testing.T) {
	d, op, _ := completionOperations(t)
	op.RepositoryFree = ptr(true)
	op.ResourceID = nil
	op.Workspace = nil
	op.WorkspaceDigest = nil
	if err := ValidateEffectScope(d, op); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"no-source", "planner", "changed-source", "resource", "workspace", "no-manifest"} {
		t.Run(mode, func(t *testing.T) {
			var other protocol.Dispatch
			raw, _ := json.Marshal(d)
			_ = json.Unmarshal(raw, &other)
			bad := op
			switch mode {
			case "no-source":
				other.NodeExecutionSource = nil
			case "planner":
				other.Kind = "planner"
			case "changed-source":
				other.NodeExecutionSource.NodeActivation++
			case "resource":
				bad.ResourceID = ptr("fixture")
			case "workspace":
				_, with, _ := completionOperations(t)
				bad.Workspace = with.Workspace
			case "no-manifest":
				bad.CompletionManifestDigest = nil
			}
			if ValidateEffectScope(other, bad) == nil {
				t.Fatal("invalid no-repository source allowed")
			}
		})
	}
}

func TestSettlementWorkerProducesScopedPairAndPreservesCaptureOnFailedReplay(t *testing.T) {
	for _, completed := range []bool{false, true} {
		t.Run(fmtBool(completed), func(t *testing.T) {
			dir, common, base := completionGit(t)
			_, original, settle := completionOperations(t)
			writeCompletionFile(t, dir, "file", "result\n")
			if completed {
				if _, err := finalize(dir, common, original.OperationID, base); err != nil {
					t.Fatal(err)
				}
			}
			w := original.Workspace
			metadata := protocol.WorkspaceMetadata{StorageID: "storage", Generation: w.Generation, LeaseID: w.LeaseID, RepositoryIdentity: w.Resource.RepositoryIdentity, BaseCommit: base, FinalizedCommit: base, TargetBranch: "main", TargetCommit: base}
			status, err := settlementWorker(settle, original, metadata, dir, common)
			if err != nil {
				t.Fatal(err)
			}
			pair := protocol.OperationResult{AttemptID: settle.AttemptID, OperationID: settle.OperationID, Success: true, Result: *status.Result, CompletionSettlement: status.CompletionSettlement}
			if err = wire.ValidateCompletionPair(settle, original, pair); err != nil {
				t.Fatal(err)
			}
			if completed && pair.CompletionSettlement.Disposition != protocol.AlreadyFinalized || !completed && pair.CompletionSettlement.Disposition != protocol.DispositionCancelled {
				t.Fatal("wrong physical disposition")
			}
			if !completed {
				intent := filepath.Join(common, "monos-completion-recovery-"+settle.OperationID+".json")
				before := readCompletionFile(t, intent)
				writeCompletionFile(t, dir, "file", "unexpected later writer\n")
				if _, err = settlementWorker(settle, original, metadata, dir, common); err == nil {
					t.Fatal("changed capture replay accepted")
				}
				if string(readCompletionFile(t, intent)) != string(before) {
					t.Fatal("failed replay rewrote retained capture")
				}
			}
		})
	}
}
