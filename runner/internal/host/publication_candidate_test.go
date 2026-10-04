package host

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func publicationTestDigest(t *testing.T, v any) string {
	t.Helper()
	_, d, e := wire.Canonical(v)
	if e != nil {
		t.Fatal(e)
	}
	return d
}
func publicationTestRoot(t *testing.T) string {
	t.Helper()
	p, e := os.MkdirTemp(".", ".publication-fixture-")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = os.RemoveAll(p) })
	p, e = filepath.Abs(p)
	if e != nil {
		t.Fatal(e)
	}
	return p
}
func publicationTestRequest(t *testing.T, f *resultGitFixture) protocol.PublicationPrepareRequest {
	t.Helper()
	s := f.request.Identity
	s.TaskID = "11111111-1111-4111-8111-111111111111"
	c := protocol.PublicationConstruction{SchemaVersion: 1, ConstructionID: "construction", CandidateID: "candidate", SourceDigest: publicationTestDigest(t, s), RepositoryIdentity: s.RepositoryIdentity, TargetBranch: "main", AuthorName: "monos", AuthorEmail: "monos@localhost", Timestamp: "1790999999 +0000", Message: "monos Task " + s.TaskID + " result v1", Parents: []protocol.PublicationParent{{Kind: "materialization", Commit: f.base}}}
	l := publicationDefaultLimits
	config := protocol.PublicationScanConfiguration{SchemaVersion: 1, PolicyVersion: "local_publication_v1", RuleVersion: "credential_rules_v1", TraversalVersion: "all_parents_final_tree_v1", LocalBlobLimit: l.PolicyBytes, ProviderBlobLimit: l.ProviderBytes, MaxCommits: int64(l.Commits), MaxPaths: int64(l.Paths), MaxVersions: int64(l.Occurrences), MaxBlobBytes: l.BlobBytes, MaxAggregateBytes: l.AggregateBytes, MaxFindings: int64(l.Findings), MaxEvidenceBytes: int64(l.EvidenceBytes), DeadlineSeconds: 120, WorkflowWrite: "unknown", PermissionFingerprint: strings.Repeat("e", 64)}
	b := protocol.PublicationEffectiveBasis{TaskID: s.TaskID, SpecificationID: s.SpecificationID, PlanID: s.PlanID, CompletionOperationID: s.OperationID, CompletionManifestDigest: s.ManifestDigest}
	return protocol.PublicationPrepareRequest{SchemaVersion: 1, OperationID: "prepare", ScanRunID: "scan", Source: s, SourceDigest: c.SourceDigest, Construction: c, ConstructionDigest: publicationTestDigest(t, c), Configuration: config, ConfigurationDigest: publicationTestDigest(t, config), EffectiveBasis: b, EffectiveBasisDigest: publicationTestDigest(t, b)}
}
func publicationPrepareFixture(t *testing.T) (*resultGitFixture, protocol.PublicationPrepareRequest, string) {
	t.Helper()
	f := resultTestNew(t)
	resultTestWrite(t, f.work, "private-token", []byte("ghp_"+strings.Repeat("K", 36)))
	resultTestGit(t, f.work, nil, "add", ".")
	resultTestGit(t, f.work, nil, "commit", "--quiet", "-m", "PRIVATE MESSAGE DO NOT EXPORT")
	if e := os.Remove(filepath.Join(f.work, "private-token")); e != nil {
		t.Fatal(e)
	}
	resultTestWrite(t, f.work, "tracked.txt", []byte("safe result\n"))
	f.finish(t)
	return f, publicationTestRequest(t, f), publicationTestRoot(t)
}
func TestPublicationCandidateExactTreePrivateExclusionAndReplay(t *testing.T) {
	f, r, root := publicationPrepareFixture(t)
	sourceRefs := resultTestGit(t, f.export, nil, "show-ref")
	head := resultTestGit(t, f.work, nil, "rev-parse", "HEAD")
	index := resultTestGit(t, f.work, nil, "write-tree")
	before, _ := os.ReadFile(filepath.Join(f.work, "tracked.txt"))
	pages, e := preparePublicationAt(context.Background(), r, f.export, root, nil)
	if e != nil {
		t.Fatal(e)
	}
	if len(pages) != 1 || pages[0].Result.Status != "prepared" || pages[0].Result.Scan.Status != "complete" {
		t.Fatalf("candidate failed %+v", pages)
	}
	c := pages[0].Result.Candidate
	if c.Tree != r.Source.GitTree || len(c.Parents) != 1 || c.Parents[0] != f.base || c.Head == r.Source.GitCommit {
		t.Fatal("candidate mapping incorrect", c)
	}
	reachable := strings.Fields(resultTestGit(t, f.export, nil, "rev-list", c.Head, "--not", f.base))
	if !reflect.DeepEqual(reachable, []string{c.Head}) {
		t.Fatal("private ancestry reachable")
	}
	for _, finding := range pages[0].Findings {
		if finding.Kind == "credential_pattern" {
			t.Fatal("private removed token leaked")
		}
	}
	message := resultTestGit(t, f.export, nil, "show", "-s", "--format=%B", c.Head)
	if message != r.Construction.Message || strings.Contains(message, "PRIVATE") {
		t.Fatal("private metadata exported")
	}
	replay, e := preparePublicationAt(context.Background(), r, f.export, root, nil)
	if e != nil || !reflect.DeepEqual(replay, pages) {
		t.Fatal("replay identity changed", e)
	}
	nowRefs := resultTestGit(t, f.export, nil, "show-ref")
	for _, line := range strings.Split(sourceRefs, "\n") {
		if !strings.Contains(nowRefs, line) {
			t.Fatal("source ref changed")
		}
	}

	if resultTestGit(t, f.work, nil, "rev-parse", "HEAD") != head || resultTestGit(t, f.work, nil, "write-tree") != index {
		t.Fatal("source refs/HEAD/index changed")
	}
	after, _ := os.ReadFile(filepath.Join(f.work, "tracked.txt"))
	if !reflect.DeepEqual(before, after) {
		t.Fatal("source bytes changed")
	}
	for _, path := range []string{filepath.Join(root, "operations", r.OperationID, "intent.json"), filepath.Join(root, "operations", r.OperationID, "pages.json"), filepath.Join(root, "constructions", r.Construction.ConstructionID, "intent.json")} {
		s, e := os.Stat(path)
		if e != nil || s.Mode().Perm() != 0600 {
			t.Fatal("journal not private", e)
		}
	}
}
func TestPublicationCandidateCrashStagesConcurrentCASAndRescan(t *testing.T) {
	for _, stage := range []string{"intent", "commit", "ref", "manifest", "scan", "result"} {
		t.Run(stage, func(t *testing.T) {
			f, r, root := publicationPrepareFixture(t)
			_, e := preparePublicationAt(context.Background(), r, f.export, root, func(at string) error {
				if at == stage {
					return errors.New("injected fault")
				}
				return nil
			})
			if e == nil {
				t.Fatal("fault did not occur")
			}
			pages, e := preparePublicationAt(context.Background(), r, f.export, root, nil)
			if e != nil || pages[0].Result.Candidate == nil {
				t.Fatal("fault recovery failed", e)
			}
			head := pages[0].Result.Candidate.Head
			var wg sync.WaitGroup
			for n := 0; n < 3; n++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					replay, e := preparePublicationAt(context.Background(), r, f.export, root, nil)
					if e != nil || replay[0].Result.Candidate.Head != head {
						t.Error("concurrent replay changed head", e)
					}
				}()
			}
			wg.Wait()
			rescan := r
			rescan.OperationID = "rescan"
			rescan.ScanRunID = "new-scan"
			rescan.Configuration.PermissionFingerprint = strings.Repeat("a", 64)
			rescan.ConfigurationDigest = publicationTestDigest(t, rescan.Configuration)
			replay, e := preparePublicationAt(context.Background(), rescan, f.export, root, nil)
			if e != nil || replay[0].Result.Candidate.Head != head || *replay[0].Result.ScanDigest == *pages[0].Result.ScanDigest {
				t.Fatal("rescan rebuilt head or reused scan", e)
			}
		})
	}
}
func TestPublicationCandidateConflictingRefSourceAndIntent(t *testing.T) {
	f, r, root := publicationPrepareFixture(t)
	ref := "refs/monos/candidates/" + r.Construction.ConstructionID
	resultTestGit(t, f.export, nil, "update-ref", ref, f.base)
	pages, e := preparePublicationAt(context.Background(), r, f.export, root, nil)
	if e != nil || pages[0].Result.Status != "reconciliation_required" {
		t.Fatal("foreign ref adopted", e)
	}
	if resultTestGit(t, f.export, nil, "rev-parse", ref) != f.base {
		t.Fatal("foreign ref rewritten")
	}
	f, r, root = publicationPrepareFixture(t)
	pages, e = preparePublicationAt(context.Background(), r, f.export, root, nil)
	if e != nil {
		t.Fatal(e)
	}
	changed := r
	changed.Configuration.MaxCommits = 2
	changed.ConfigurationDigest = publicationTestDigest(t, changed.Configuration)
	rejected, e := preparePublicationAt(context.Background(), changed, f.export, root, nil)
	if e != nil || rejected[0].Result.Status != "reconciliation_required" {
		t.Fatal("same operation different config accepted")
	}
	resultTestGit(t, f.export, nil, "update-ref", "refs/monos/result", f.base)
	rejected, e = preparePublicationAt(context.Background(), r, f.export, root, nil)
	if e != nil || rejected[0].Result.Status != "reconciliation_required" {
		t.Fatal("cached result adopted source drift")
	}
}
func TestPublicationNoChangeAndIncompleteRetryPreservesCandidate(t *testing.T) {
	f := resultTestNew(t)
	f.finish(t)
	r := publicationTestRequest(t, f)
	root := publicationTestRoot(t)
	pages, e := preparePublicationAt(context.Background(), r, f.export, root, nil)
	if e != nil || pages[0].Result.Status != "not_applicable" || pages[0].Result.Candidate != nil {
		t.Fatal("commit-only change created candidate", e)
	}
	f, r, root = publicationPrepareFixture(t)
	r.Configuration.MaxPaths = 1
	r.ConfigurationDigest = publicationTestDigest(t, r.Configuration)
	pages, e = preparePublicationAt(context.Background(), r, f.export, root, nil)
	if e != nil || pages[0].Result.Scan.Status != "incomplete" {
		t.Fatal("bound not incomplete", e)
	}
	prior := pages[0].Result.Candidate.Head
	replay, e := preparePublicationAt(context.Background(), r, f.export, root, nil)
	if e != nil || !reflect.DeepEqual(replay, pages) {
		t.Fatal("terminal incomplete mutated")
	}
	retry := r
	retry.OperationID = "explicit-retry"
	retry.ScanRunID = "retry-scan"
	retry.Configuration.MaxPaths = 8192
	retry.ConfigurationDigest = publicationTestDigest(t, retry.Configuration)
	retried, e := preparePublicationAt(context.Background(), retry, f.export, root, nil)
	if e != nil || retried[0].Result.Scan.Status != "complete" || retried[0].Result.Candidate.Head != prior {
		t.Fatal("retry rebuilt candidate or stayed incomplete", e)
	}
	// External cancellation keeps the same operation unfinished and resumable.
	f, r, root = publicationPrepareFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	_, e = preparePublicationAt(ctx, r, f.export, root, func(stage string) error {
		if stage == "manifest" {
			cancel()
		}
		return nil
	})
	if e == nil {
		t.Fatal("cancelled processing finished")
	}
	if _, e = os.Stat(filepath.Join(root, "operations", r.OperationID, "pages.json")); !os.IsNotExist(e) {
		t.Fatal("external cancellation committed terminal scan")
	}
	resumed, e := preparePublicationAt(context.Background(), r, f.export, root, nil)
	if e != nil || resumed[0].Result.Scan.Status != "complete" {
		t.Fatal("original interrupted operation not resumed", e)
	}
	// The processing deadline is distinct from external cancellation. Expire it
	// immediately after the candidate manifest has durably settled.
	f, r, root = publicationPrepareFixture(t)
	deadline := &publicationExpiredContext{Context: context.Background(), done: make(chan struct{})}
	incomplete, e := preparePublicationAt(deadline, r, f.export, root, func(stage string) error {
		if stage == "manifest" {
			close(deadline.done)
		}
		return nil
	})
	if e != nil || incomplete[0].Result.Scan.Status != "incomplete" || *incomplete[0].Result.Scan.Reason != "timeout" {
		t.Fatal("own deadline not terminal incomplete", e, incomplete)
	}
	replay, e = preparePublicationAt(context.Background(), r, f.export, root, nil)
	if e != nil || !reflect.DeepEqual(replay, incomplete) {
		t.Fatal("deadline result changed on replay", e)
	}

}
func TestPublicationPagesRedactionDigestsAnd64Bound(t *testing.T) {
	f, r, _ := publicationPrepareFixture(t)
	candidate := protocol.PublicationCandidateManifest{SchemaVersion: 1, CandidateID: "candidate", ConstructionID: "construction", ConstructionDigest: r.ConstructionDigest, SourceDigest: r.SourceDigest, Head: r.Source.GitCommit, Tree: r.Source.GitTree, Parents: []string{f.base}}
	findings := []publicationFinding{}
	for n := 1; n <= 130; n++ {
		findings = append(findings, publicationFinding{Rule: "github_classic_token", Commit: r.Source.GitCommit, Path: "[redacted credential path]", PathRedacted: true, Blob: r.Source.GitTree, ContentDigest: strings.Repeat("a", 64), Eligible: true, Ordinal: n})
	}
	pages, e := publicationPages(r, candidate, publicationCoverage{Complete: true, Findings: findings})
	if e != nil {
		t.Fatal(e)
	}
	if len(pages) != 3 || len(pages[0].Findings) != 64 || len(pages[1].Findings) != 64 || len(pages[2].Findings) != 2 {
		t.Fatal("unbounded pages")
	}
	ids := map[string]bool{}
	flatten := []protocol.PublicationFinding{}
	for _, p := range pages {
		raw, _ := json.Marshal(p)
		if wire.Validate("PublicationResultPage", raw) != nil {
			t.Fatal("generated consumer rejected page")
		}
		for _, f := range p.Findings {
			if ids[f.FindingID] {
				t.Fatal("ordinal identity collision")
			}
			ids[f.FindingID] = true
		}
		flatten = append(flatten, p.Findings...)
	}
	raw, digest, _ := wire.Canonical(flatten)
	summary := pages[0].Result.Scan
	if summary.FindingsDigest != digest || summary.FindingsBytes != int64(len(raw)) {
		t.Fatal("aggregate findings identity mismatch")
	}
}

type publicationExpiredContext struct {
	context.Context
	done chan struct{}
}

func (c *publicationExpiredContext) Done() <-chan struct{} { return c.done }
func (c *publicationExpiredContext) Err() error {
	select {
	case <-c.done:
		return context.DeadlineExceeded
	default:
		return nil
	}
}
func (c *publicationExpiredContext) Deadline() (time.Time, bool) { return time.Time{}, false }

func publicationPinFixture(t *testing.T) (protocol.PublicationParent, protocol.ResultReadIdentity, string, string) {
	t.Helper()
	f, r, _ := publicationPrepareFixture(t)
	root := publicationTestRoot(t)
	cache := filepath.Join(root, "cache.git")
	resultTestGit(t, f.export, nil, "clone", "--bare", "--no-local", f.export, cache)
	w := protocol.WorkspaceDescriptor{SchemaVersion: 1, WorkspaceID: r.Source.WorkspaceID, TaskID: r.Source.TaskID, ResourceID: r.Source.ResourceID, RunnerID: r.Source.RunnerID, ProjectID: "project", NodeID: r.Source.NodeID, NodeActivation: 1, Generation: r.Source.Generation, LeaseID: "original-lease", OpenOperationID: "original-open", Resource: protocol.WorkspaceResource{ResourceID: r.Source.ResourceID, RepositoryIdentity: r.Source.RepositoryIdentity, RemoteURL: "https://github.com/example/repository.git", ProviderMetadata: &protocol.RepositoryProviderMetadata{Github: &protocol.RepositoryProviderMetadataGithub{RepositoryID: "123"}}}}
	m := protocol.WorkspaceMetadata{BaseCommit: f.base, FinalizedCommit: f.base, TargetCommit: f.base, TargetBranch: "main", Generation: w.Generation, LeaseID: w.LeaseID, RepositoryIdentity: r.Source.RepositoryIdentity, StorageID: r.Source.StorageID, ProviderMetadata: w.Resource.ProviderMetadata}
	p := protocol.PublicationParent{Kind: "materialization", Commit: f.base, RepositoryIdentity: r.Source.RepositoryIdentity, ObservationOperationID: w.OpenOperationID, Workspace: w, Outcome: protocol.EffectResult{WorkspaceID: &w.WorkspaceID, WorkspaceMetadata: &m}}
	p.ObservationDigest = publicationTestDigest(t, map[string]any{"operation_id": p.ObservationOperationID, "workspace": w, "outcome": p.Outcome})
	// Existing fetch pin JSON was0644 under its0700 parent before this feature;
	// preserve that contract while new publication records require0600.
	path := filepath.Join(root, "original-open.json")
	_, wd, _ := wire.Canonical(w)
	pinMetadata := m
	pinMetadata.StorageID = ""
	pin := map[string]any{"digest": wd, "base_ref": "refs/heads/main", "target_branch": "main", "github_repository_id": "123", "complete": true, "metadata": pinMetadata}
	raw, _ := json.Marshal(pin)
	if e := os.WriteFile(path, raw, 0644); e != nil {
		t.Fatal(e)
	}
	resultTestGit(t, cache, nil, "update-ref", "refs/monos/pins/original-open/base", f.base)
	resultTestGit(t, cache, nil, "update-ref", "refs/monos/pins/original-open/target", f.base)
	return p, r.Source, path, cache
}
func TestPublicationPinOriginalCompletedCacheProofAndTamper(t *testing.T) {
	for _, kind := range []string{"valid", "digest", "repository", "incomplete", "cache-ref", "metadata", "pin-symlink", "object-symlink", "alternate", "writable-parent"} {
		t.Run(kind, func(t *testing.T) {
			p, s, path, cache := publicationPinFixture(t)
			raw, _ := os.ReadFile(path)
			var pin map[string]any
			_ = json.Unmarshal(raw, &pin)
			switch kind {
			case "digest":
				pin["digest"] = strings.Repeat("f", 64)
			case "repository":
				pin["github_repository_id"] = "foreign"
			case "incomplete":
				pin["complete"] = false
			case "cache-ref":
				resultTestGit(t, cache, nil, "update-ref", "refs/monos/pins/original-open/base", s.GitCommit)
			case "metadata":
				pin["metadata"].(map[string]any)["lease_id"] = "foreign"
			case "pin-symlink":
				if e := os.Rename(path, path+".real"); e != nil {
					t.Fatal(e)
				}
				if e := os.Symlink(path+".real", path); e != nil {
					t.Fatal(e)
				}
			case "object-symlink":
				if e := os.Symlink(path, filepath.Join(cache, "objects", "unexpected")); e != nil {
					t.Fatal(e)
				}
			case "alternate":
				if e := os.WriteFile(filepath.Join(cache, "objects", "info", "alternates"), []byte("/absent"), 0600); e != nil {
					t.Fatal(e)
				}
			case "writable-parent":
				if e := os.Chmod(filepath.Dir(path), 0770); e != nil {
					t.Fatal(e)
				}
			}
			if kind == "digest" || kind == "repository" || kind == "incomplete" || kind == "metadata" {
				raw, _ = json.Marshal(pin)
				if e := os.WriteFile(path, raw, 0644); e != nil {
					t.Fatal(e)
				}
			}
			e := verifyPublicationPinAt(context.Background(), p, s, "main", path, cache)
			if kind == "valid" {
				if e != nil {
					t.Fatal("completed original proof rejected", e)
				}
			} else if e == nil {
				t.Fatal("tampered public proof adopted", kind)
			}
		})
	}
}
func TestPublicationPublishedParentSeamRejectsPreparedOrUncertainEvidence(t *testing.T) {
	p, s, _, _ := publicationPinFixture(t)
	f := resultTestNew(t)
	f.finish(t)
	r := publicationTestRequest(t, f)
	r.Source = s
	r.SourceDigest = publicationTestDigest(t, s)
	r.Construction.SourceDigest = r.SourceDigest
	r.Construction.RepositoryIdentity = s.RepositoryIdentity
	r.Construction.Parents = []protocol.PublicationParent{p}
	r.ConstructionDigest = publicationTestDigest(t, r.Construction)
	r.EffectiveBasis = protocol.PublicationEffectiveBasis{TaskID: s.TaskID, SpecificationID: s.SpecificationID, PlanID: s.PlanID, CompletionOperationID: s.OperationID, CompletionManifestDigest: s.ManifestDigest}
	r.EffectiveBasisDigest = publicationTestDigest(t, r.EffectiveBasis)
	if e := ValidatePublicationRequest(r); e != nil {
		raw, _ := json.Marshal(r)
		t.Fatal("valid proof contract rejected", e, wire.Validate("PublicationPrepareRequest", raw))
	}
	r.Construction.Parents[0].Kind = "published"
	r.ConstructionDigest = publicationTestDigest(t, r.Construction)
	if ValidatePublicationRequest(r) == nil {
		t.Fatal("unreconciled prepared parent fabricated published authority")
	}
}
func TestPublicationReconnectReplayAckLossAndJournalPermissions(t *testing.T) {
	f, r, root := publicationPrepareFixture(t)
	pages, e := preparePublicationAt(context.Background(), r, f.export, root, nil)
	if e != nil {
		t.Fatal(e)
	}
	opRoot := filepath.Join(root, "operations")
	seen := []protocol.PublicationResultPage{}
	e = replayPublicationResultsAt(context.Background(), opRoot, func(p protocol.PublicationResultPage) error { seen = append(seen, p); return nil })
	if e != nil || !reflect.DeepEqual(seen, pages) {
		t.Fatal("committed unacked pages not replayed", e)
	}
	seen = nil
	e = replayPublicationResultsAt(context.Background(), opRoot, func(p protocol.PublicationResultPage) error { seen = append(seen, p); return nil })
	if e != nil || !reflect.DeepEqual(seen, pages) {
		t.Fatal("lost ack changed replay", e)
	}
	_, rd, _ := wire.Canonical(pages[0].Result)
	ack := protocol.PublicationACK{SchemaVersion: 1, OperationID: r.OperationID, RequestDigest: pages[0].Result.RequestDigest, ResultDigest: rd}
	if e = savePublicationFile(filepath.Join(opRoot, r.OperationID, "ack.json"), ack); e != nil {
		t.Fatal(e)
	}
	seen = nil
	e = replayPublicationResultsAt(context.Background(), opRoot, func(p protocol.PublicationResultPage) error { seen = append(seen, p); return nil })
	if e != nil || len(seen) != 0 {
		t.Fatal("settled acknowledged pages resent", e)
	}
	path := filepath.Join(opRoot, r.OperationID, "pages.json")
	if e = os.Chmod(path, 0644); e != nil {
		t.Fatal(e)
	}
	if _, e = readPublicationFile(path); e == nil {
		t.Fatal("public publication evidence accepted")
	}
	if e = savePublicationFile(path, pages); e == nil {
		t.Fatal("existing unsafe record silently replaced")
	}
}

// Explicitly enabled by the main agent on an isolated service-owned host path.
// This retains code-produced private evidence for a second OS account's access
// checks. Its synthetic baseline is not remote-origin or installed Root proof.
func TestPublicationNativeRetainedPermissionFixture(t *testing.T) {
	root := os.Getenv("MONOS_PUBLICATION_EVIDENCE_DIR")
	if root == "" {
		t.Skip("explicit isolated permissions evidence directory required")
	}
	if !filepath.IsAbs(root) || publicationDirectory(root) != nil {
		t.Fatal("fresh owned0700 evidence directory required")
	}
	entries, e := os.ReadDir(root)
	if e != nil || len(entries) != 0 {
		t.Fatal("evidence directory must be empty", e)
	}
	f, r, _ := publicationPrepareFixture(t)
	export := filepath.Join(root, "result.git")
	resultTestGit(t, f.export, nil, "clone", "--bare", "--no-local", f.export, export)
	if e = os.Chmod(export, 0700); e != nil {
		t.Fatal(e)
	}
	resultTestGit(t, export, nil, "update-ref", "refs/monos/result", r.Source.GitCommit)
	journalRoot := filepath.Join(root, "journal")
	pages, e := preparePublicationAt(context.Background(), r, export, journalRoot, nil)
	if e != nil || len(pages) != 1 || pages[0].Result.Candidate == nil {
		t.Fatal("retained factory fixture failed", e)
	}
	candidate := pages[0].Result.Candidate
	_, resultDigest, _ := wire.Canonical(pages[0].Result)
	proof := map[string]any{"scope": "isolated same-account actual Git factory; synthetic baseline; no production Root or remote proof", "export": export, "journal": journalRoot, "intent_path": filepath.Join(journalRoot, "operations", r.OperationID, "intent.json"), "pages_path": filepath.Join(journalRoot, "operations", r.OperationID, "pages.json"), "candidate_path": filepath.Join(journalRoot, "constructions", r.Construction.ConstructionID, "candidate.json"), "operation_id": r.OperationID, "construction_id": r.Construction.ConstructionID, "source_digest": r.SourceDigest, "head": candidate.Head, "tree": candidate.Tree, "parents": candidate.Parents, "result_digest": resultDigest}
	if e = savePublicationFile(filepath.Join(root, "proof.json"), proof); e != nil {
		t.Fatal(e)
	}
}

func TestPublicationCandidateIntegratedTargetModesAndUnintegratedRejection(t *testing.T) {
	f := resultTestNew(t)
	baseTree := resultTestGit(t, f.work, nil, "rev-parse", f.base+"^{tree}")
	target := resultTestGit(t, f.work, []byte("verified target fixture\n"), "commit-tree", baseTree, "-p", f.base)
	resultTestGit(t, f.work, nil, "merge", "--quiet", "--no-edit", target)
	resultTestWrite(t, f.work, "executable", []byte("#!/bin/sh\n"))
	if e := os.Chmod(filepath.Join(f.work, "executable"), 0755); e != nil {
		t.Fatal(e)
	}
	if e := os.Symlink("literal symlink target", filepath.Join(f.work, "link")); e != nil {
		t.Fatal(e)
	}
	resultTestGit(t, f.work, nil, "add", ".")
	resultTestGit(t, f.work, nil, "update-index", "--add", "--cacheinfo", "160000,"+f.base+",submodule")
	f.exportIndex(t)
	r := publicationTestRequest(t, f)
	r.Construction.Parents = append(r.Construction.Parents, protocol.PublicationParent{Kind: "target", Commit: target})
	r.ConstructionDigest = publicationTestDigest(t, r.Construction)
	pages, e := preparePublicationAt(context.Background(), r, f.export, publicationTestRoot(t), nil)
	if e != nil || pages[0].Result.Candidate == nil {
		t.Fatal("integrated target rejected", e)
	}
	c := pages[0].Result.Candidate
	if c.Tree != r.Source.GitTree || !reflect.DeepEqual(c.Parents, []string{f.base, target}) {
		t.Fatal("tree/modes/public parent order changed")
	}
	for _, name := range []string{"link", "submodule", "executable"} {
		original, e := resultTreeObject(context.Background(), f.export, r.Source.GitCommit, name)
		if e != nil {
			t.Fatal(e)
		}
		candidate, e := resultTreeObject(context.Background(), f.export, c.Head, name)
		if e != nil || !reflect.DeepEqual(candidate, original) {
			t.Fatal("literal mode/blob identity changed", name, e)
		}
	}
	unrelated := resultTestGit(t, f.export, []byte("unintegrated target fixture\n"), "commit-tree", baseTree, "-p", f.base)
	changed := r
	changed.OperationID = "unintegrated-op"
	changed.ScanRunID = "unintegrated-scan"
	changed.Construction.ConstructionID = "unintegrated-construction"
	changed.Construction.CandidateID = "unintegrated-candidate"
	changed.Construction.Parents = append([]protocol.PublicationParent{}, r.Construction.Parents...)
	changed.Construction.Parents[1].Commit = unrelated
	changed.ConstructionDigest = publicationTestDigest(t, changed.Construction)
	rejected, e := preparePublicationAt(context.Background(), changed, f.export, publicationTestRoot(t), nil)
	if e != nil || rejected[0].Result.Status != "reconciliation_required" || *rejected[0].Result.Reason != "unverified_parent" {
		t.Fatal("unintegrated remote target adopted", e)
	}
}
func TestPublicationEncodedFindingPagesAndEvidenceOverflow(t *testing.T) {
	f, r, _ := publicationPrepareFixture(t)
	c := protocol.PublicationCandidateManifest{SchemaVersion: 1, CandidateID: "candidate", ConstructionID: "construction", ConstructionDigest: r.ConstructionDigest, SourceDigest: r.SourceDigest, Head: r.Source.GitCommit, Tree: r.Source.GitTree, Parents: []string{f.base}}
	findings := []publicationFinding{}
	for n := 1; n <= 64; n++ {
		findings = append(findings, publicationFinding{Rule: "tracked_ignore", Commit: r.Source.GitCommit, Path: "long/" + strings.Repeat("\t", 4080), Blob: r.Source.GitTree, ContentDigest: strings.Repeat("a", 64), Eligible: true, Ordinal: n})
	}
	pages, e := publicationPages(r, c, publicationCoverage{Complete: true, Findings: findings})
	if e != nil || len(pages) < 2 {
		t.Fatal("escaped UTF8 byte pages not bounded", e, len(pages))
	}
	count := 0
	for _, page := range pages {
		raw, _ := json.Marshal(protocol.Frame{SchemaVersion: 1, Type: "publication_result", Incarnation: publicationPointer(int64(9007199254740991)), PublicationResult: &page})
		if len(raw) > 512<<10 {
			t.Fatal("encoded frame exceeds limit")
		}
		count += len(page.Findings)
	}
	if count != 64 {
		t.Fatal("byte paging lost findings")
	}
	r.Configuration.MaxEvidenceBytes = 1000
	r.ConfigurationDigest = publicationTestDigest(t, r.Configuration)
	pages, e = publicationPages(r, c, publicationCoverage{Complete: true, Findings: findings})
	if e != nil || pages[0].Result.Scan.Status != "incomplete" || *pages[0].Result.Scan.Reason != "evidence_limit" || pages[0].Result.Scan.FindingsBytes > 1000 {
		t.Fatal("evidence overflow reported complete or exceeded budget", e)
	}
}

func TestPublicationSHA256ObjectFormatCASReplay(t *testing.T) {
	root := t.TempDir()
	f := &resultGitFixture{work: filepath.Join(root, "work"), export: filepath.Join(root, "export.git")}
	if e := os.Mkdir(f.work, 0700); e != nil {
		t.Fatal(e)
	}
	resultTestGit(t, f.work, nil, "init", "--quiet", "--object-format=sha256")
	resultTestWrite(t, f.work, "tracked.txt", []byte("base"))
	resultTestGit(t, f.work, nil, "add", ".")
	resultTestGit(t, f.work, nil, "commit", "--quiet", "-m", "base")
	f.base = resultTestGit(t, f.work, nil, "rev-parse", "HEAD")
	if len(f.base) != 64 {
		t.Fatal("Git did not produce SHA256 fixture")
	}
	resultTestWrite(t, f.work, "tracked.txt", []byte("result"))
	f.finish(t)
	r := publicationTestRequest(t, f)
	journalRoot := publicationTestRoot(t)
	pages, e := preparePublicationAt(context.Background(), r, f.export, journalRoot, nil)
	if e != nil || pages[0].Result.Candidate == nil || len(pages[0].Result.Candidate.Head) != 64 {
		t.Fatal("SHA256 construction/CAS failed", e)
	}
	replay, e := preparePublicationAt(context.Background(), r, f.export, journalRoot, nil)
	if e != nil || !reflect.DeepEqual(replay, pages) {
		t.Fatal("SHA256 replay changed identity", e)
	}
}
