package host

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	protocol "monos.local/protocol"
)

type publicationPushFixture struct {
	source                          *resultGitFixture
	preparation                     protocol.PublicationPrepareRequest
	request                         protocol.PublicationPushRequest
	root, store, remoteRoot, remote string
	pushes                          atomic.Int64
	io                              publicationRemoteIO
}

type publicationTestSchedulingWait struct{}

func (publicationTestSchedulingWait) Error() string {
	return "synthetic typed provider scheduling wait"
}
func (publicationTestSchedulingWait) PublicationRetryAfter() time.Duration { return time.Second }

func publicationPushTestFixture(t *testing.T) *publicationPushFixture {
	return publicationPushTestFixtureAt(t, "")
}
func publicationPushTestFixtureAt(t *testing.T, evidence string) *publicationPushFixture {
	t.Helper()
	f, r, _ := publicationPrepareFixture(t)
	r.Source.ResourceID = "22222222-2222-4222-8222-222222222222"
	r.Source.RepositoryIdentity = "github.com/example/repository"
	r.SourceDigest = publicationDigest(r.Source)
	r.Construction.SourceDigest = r.SourceDigest
	r.Construction.RepositoryIdentity = r.Source.RepositoryIdentity
	w := protocol.WorkspaceDescriptor{SchemaVersion: 1, WorkspaceID: r.Source.WorkspaceID, TaskID: r.Source.TaskID, ResourceID: r.Source.ResourceID, RunnerID: r.Source.RunnerID, ProjectID: "project", NodeID: r.Source.NodeID, NodeActivation: r.Source.NodeActivation, Generation: r.Source.Generation, LeaseID: "original-lease", OpenOperationID: "original-open", Resource: protocol.WorkspaceResource{ResourceID: r.Source.ResourceID, RepositoryIdentity: r.Source.RepositoryIdentity, RemoteURL: "https://" + r.Source.RepositoryIdentity + ".git", ProviderMetadata: &protocol.RepositoryProviderMetadata{Github: &protocol.RepositoryProviderMetadataGithub{RepositoryID: "123"}}}}
	m := protocol.WorkspaceMetadata{BaseCommit: f.base, TargetCommit: f.base, FinalizedCommit: f.base, TargetBranch: "main", Generation: w.Generation, LeaseID: w.LeaseID, StorageID: r.Source.StorageID, RepositoryIdentity: r.Source.RepositoryIdentity, ProviderMetadata: w.Resource.ProviderMetadata}
	p := protocol.PublicationParent{Kind: "materialization", Commit: f.base, RepositoryIdentity: r.Source.RepositoryIdentity, ObservationOperationID: publicationPointer(w.OpenOperationID), Workspace: &w, Outcome: &protocol.EffectResult{WorkspaceID: &w.WorkspaceID, WorkspaceMetadata: &m}}
	p.ObservationDigest = publicationPointer(publicationDigest(map[string]any{"operation_id": p.ObservationOperationID, "workspace": p.Workspace, "outcome": p.Outcome}))
	r.Construction.Parents = []protocol.PublicationParent{p}
	r.ConstructionDigest = publicationDigest(r.Construction)
	permission := protocol.PublicationPermissionProof{SchemaVersion: 1, ObservationID: "permission", ResourceID: r.Source.ResourceID, RepositoryIdentity: r.Source.RepositoryIdentity, RepositoryID: "123", AppID: "1", InstallationID: "2", KeyFingerprint: strings.Repeat("a", 64), ConfigurationFingerprint: strings.Repeat("b", 64), Permissions: protocol.PublicationPermissionGrants{Contents: "write", Metadata: "read"}, ObservedAt: time.Now().UTC().Format("2006-01-02T15:04:05.000Z"), ExpiresAt: time.Now().Add(time.Hour).UTC().Format("2006-01-02T15:04:05.000Z")}
	permission.PermissionFingerprint = publicationDigest(map[string]any{"configuration_fingerprint": permission.ConfigurationFingerprint, "repository_id": permission.RepositoryID, "permissions": permission.Permissions})
	r.PermissionProof = &permission
	r.PermissionProofDigest = publicationPointer(publicationDigest(permission))
	r.Configuration.WorkflowWrite = "denied"
	r.Configuration.PermissionFingerprint = permission.PermissionFingerprint
	r.ConfigurationDigest = publicationDigest(r.Configuration)
	if ValidatePublicationRequest(r) != nil {
		t.Fatal("valid physical fixture request rejected")
	}
	base := evidence
	if base == "" {
		base = publicationTestRoot(t)
	} else {
		export := filepath.Join(base, "source-export.git")
		if publicationDirectory(export) != nil {
			t.Fatal("retained source export directory unavailable")
		}
		resultTestGit(t, base, nil, "clone", "--bare", "--no-local", "--quiet", f.export, export)
		resultTestGit(t, export, nil, "update-ref", "refs/monos/result", r.Source.GitCommit)
		f.export = export
	}
	root := filepath.Join(base, "publication")
	store, e := preparePublicationStore(context.Background(), root, f.export, r)
	if e != nil {
		t.Fatal(e)
	}
	pages, e := preparePublicationStoredAt(context.Background(), r, f.export, store, root, nil)
	if e != nil || len(pages) == 0 || pages[0].Result.Scan == nil || pages[0].Result.Scan.Status != "complete" {
		t.Fatal("store candidate unavailable", e)
	}
	var prepared protocol.PublicationPushRequestPrepared
	raw, _ := json.Marshal(pages[0].Result)
	if json.Unmarshal(raw, &prepared) != nil {
		t.Fatal("prepared conversion")
	}
	request := protocol.PublicationPushRequest{SchemaVersion: 1, OperationID: "push", ItemID: "item", TaskID: r.Source.TaskID, ResourceID: r.Source.ResourceID, RunnerID: r.Source.RunnerID, StorageID: r.Source.StorageID, RepositoryIdentity: r.Source.RepositoryIdentity, RepositoryID: "123", RemoteURL: "https://" + r.Source.RepositoryIdentity + ".git", DeliveryRef: "refs/heads/monos/task/" + r.Source.TaskID + "/" + r.Source.ResourceID, TargetBranch: "main", Preparation: r, Prepared: prepared, PreparationResultDigest: publicationDigest(prepared), PermissionProof: permission, PermissionProofDigest: publicationDigest(permission), OverrideReceipts: []protocol.PublicationOverrideProof{}}
	if e = ValidatePublicationPushRequest(request); e != nil {
		t.Fatal(e)
	}
	fixture := &publicationPushFixture{source: f, preparation: r, request: request, root: root, store: store, remoteRoot: filepath.Join(filepath.Dir(root), "remote"), remote: filepath.Join(filepath.Dir(root), "remote.git")}
	resultTestGit(t, filepath.Dir(root), nil, "init", "--bare", "--quiet", fixture.remote)
	fixture.io = publicationRemoteIO{access: func(ctx context.Context, r protocol.PublicationPushRequest, purpose protocol.PublicationAccessRequestPurpose, attempt string) (protocol.PublicationAccessResult, error) {
		token := "synthetic-no-provider-token"
		a := protocol.PublicationAccessResult{SchemaVersion: 1, OperationID: r.OperationID, RequestDigest: publicationDigest(r), ItemID: r.ItemID, AttemptID: attempt, Purpose: purpose, RemoteURL: r.RemoteURL, RepositoryID: r.RepositoryID, DeliveryRef: r.DeliveryRef, CandidateHead: r.Prepared.Candidate.Head, ExpectedHead: r.ExpectedHead, Authentication: protocol.Authentication{Kind: "github_installation", Token: &token, ExpiresAt: &permission.ExpiresAt}}
		if purpose == "push" {
			a.ClaimID = publicationPointer("claim")
			a.ClaimExpiresAt = &permission.ExpiresAt
			a.PermissionProof = &permission
			a.PermissionProofDigest = publicationPointer(publicationDigest(permission))
		}
		return a, nil
	}, observe: func(ctx context.Context, store, op string, a protocol.PublicationAccessResult) (publicationRemoteExecution, error) {
		raw, e := resultGit(ctx, fixture.remote, 256, "rev-parse", "--verify", a.DeliveryRef)
		if e != nil {
			return publicationRemoteExecution{WorkerAbsent: true, Output: []byte{}}, nil
		}
		return publicationRemoteExecution{WorkerAbsent: true, Output: []byte(strings.TrimSpace(string(raw)) + "\t" + a.DeliveryRef + "\n")}, nil
	}, push: func(ctx context.Context, store, op string, a protocol.PublicationAccessResult, g publicationPushGuard, start func(publicationRemoteWorker) error) (publicationRemoteExecution, error) {
		fixture.pushes.Add(1)
		g.destination = fixture.remote
		return runPublicationGuardedPush(ctx, store, op, g, nil, start)
	}}
	return fixture
}

func (f *publicationPushFixture) run(ctx context.Context) (protocol.PublicationPushResult, error) {
	return publicationPushAt(ctx, f.request, f.root, f.store, f.remoteRoot, f.io)
}
func (f *publicationPushFixture) ack(t *testing.T, result protocol.PublicationPushResult) {
	t.Helper()
	ack := protocol.PublicationPushACK{SchemaVersion: 1, OperationID: f.request.OperationID, RequestDigest: publicationDigest(f.request), ItemID: f.request.ItemID, ResultDigest: publicationDigest(result)}
	if e := publicationPushAckAt(context.Background(), f.remoteRoot, ack); e != nil {
		t.Fatal(e)
	}
}
func (f *publicationPushFixture) proof(result protocol.PublicationPushResult) protocol.PublicationPublishedProof {
	r := f.request
	return protocol.PublicationPublishedProof{SchemaVersion: 1, OperationID: r.OperationID, RequestDigest: publicationDigest(r), ResultDigest: publicationDigest(result), ItemID: r.ItemID, TaskID: r.TaskID, ResourceID: r.ResourceID, RunnerID: r.RunnerID, StorageID: r.StorageID, RepositoryIdentity: r.RepositoryIdentity, RepositoryID: r.RepositoryID, DeliveryRef: r.DeliveryRef, Candidate: *r.Prepared.Candidate, CandidateManifestDigest: *r.Prepared.CandidateManifestDigest, Observation: result.Observation, ObservationDigest: result.ObservationDigest}
}

func TestRemotePreparationDurablePushEffectLossAndACKReplay(t *testing.T) {
	f := publicationPushTestFixture(t)
	if _, e := resultGit(context.Background(), f.store, 256, "cat-file", "-e", f.preparation.Source.GitCommit); e == nil {
		t.Fatal("private source commit entered public store")
	}
	f.io.fault = func(stage string) error {
		if stage == "effect" {
			return errors.New("simulated disconnect after remote effect")
		}
		return nil
	}
	if _, e := f.run(context.Background()); e == nil || f.pushes.Load() != 1 {
		t.Fatal("lost effect fixture did not interrupt")
	}
	f.io.fault = nil
	access := f.io.access
	f.io.access = func(context.Context, protocol.PublicationPushRequest, protocol.PublicationAccessRequestPurpose, string) (protocol.PublicationAccessResult, error) {
		return protocol.PublicationAccessResult{}, publicationTestSchedulingWait{}
	}
	if _, e := f.run(context.Background()); !publicationAccessSchedulingWait(e) || f.pushes.Load() != 1 {
		t.Fatal("started scheduling wait repeated physical effect or settled", e)
	}
	op := filepath.Join(f.remoteRoot, "items", "item", "operations", "push")
	if _, e := readPublicationFile(filepath.Join(op, "result.json")); !os.IsNotExist(e) {
		t.Fatal("started scheduling wait froze terminal result")
	}
	f.io.access = access
	result, e := f.run(context.Background())
	if e != nil || result.Status != "published" || !result.PushStarted || f.pushes.Load() != 1 {
		t.Fatal("reconnect repeated physical effect", e)
	}
	before, _ := readPublicationFile(filepath.Join(op, "result.json"))
	again, e := f.run(context.Background())
	after, _ := readPublicationFile(filepath.Join(op, "result.json"))
	if e != nil || publicationDigest(again) != publicationDigest(result) || string(before) != string(after) || f.pushes.Load() != 1 {
		t.Fatal("lost ACK replay changed result", e)
	}
	f.ack(t, result)
	proof := f.proof(result)
	next := f.preparation
	next.Published = &proof
	next.PublishedDigest = publicationPointer(publicationDigest(proof))
	if e = verifyPublicationPublishedAt(context.Background(), next, f.root, f.remoteRoot, f.io); e != nil {
		t.Fatal("own exact published proof refused", e)
	}
	if resultTestGit(t, f.source.export, nil, "rev-parse", "refs/monos/result") != f.preparation.Source.GitCommit {
		t.Fatal("source export changed")
	}
}

func TestRemotePreparationUnknownResolutionAppendAndNewSourceMapping(t *testing.T) {
	f := publicationPushTestFixture(t)
	observe := f.io.observe
	var observations int
	f.io.observe = func(ctx context.Context, store, op string, a protocol.PublicationAccessResult) (publicationRemoteExecution, error) {
		observations++
		if observations == 2 {
			return publicationRemoteExecution{WorkerAbsent: true}, errors.New("lost read")
		}
		return observe(ctx, store, op, a)
	}
	result, e := f.run(context.Background())
	if e != nil || result.Status != "reconciliation_required" || !result.PushStarted {
		t.Fatal("uncertain effect not retained", e)
	}
	f.ack(t, result)
	op := filepath.Join(f.remoteRoot, "items", "item", "operations", "push")
	original, _ := readPublicationFile(filepath.Join(op, "result.json"))
	ackBytes, _ := readPublicationFile(filepath.Join(op, "ack.json"))
	proof := f.proof(result)
	proof.Observation = remotePublicationObservation(f.request, "present", f.request.Prepared.Candidate.Head, "")
	proof.ObservationDigest = publicationDigest(proof.Observation)
	next := f.preparation
	next.OperationID = "map"
	next.ScanRunID = "map-scan"
	next.Source.OperationID = "new-original-result"
	next.Source.Generation++
	next.Source.NodeActivation++
	next.SourceDigest = publicationDigest(next.Source)
	next.EffectiveBasis.CompletionOperationID = next.Source.OperationID
	next.EffectiveBasisDigest = publicationDigest(next.EffectiveBasis)
	next.Published = &proof
	next.PublishedDigest = publicationPointer(publicationDigest(proof))
	next.Construction.ConstructionID = "unused-map-construction"
	next.Construction.CandidateID = "unused-map-candidate"
	next.Construction.SourceDigest = next.SourceDigest
	next.Construction.Parents = []protocol.PublicationParent{{Kind: "published", Commit: proof.Candidate.Head, RepositoryIdentity: proof.RepositoryIdentity, PublishedProof: &proof, PublishedProofDigest: next.PublishedDigest}}
	next.ConstructionDigest = publicationDigest(next.Construction)
	if ValidatePublicationRequest(next) != nil {
		t.Fatal("new generation published request invalid")
	}
	f.io.observe = observe
	if e = verifyPublicationPublishedAt(context.Background(), next, f.root, f.remoteRoot, f.io); e != nil {
		t.Fatal("original uncertain operation resolution failed", e)
	}
	store, e := preparePublicationStore(context.Background(), f.root, f.source.export, next)
	if e != nil {
		t.Fatal(e)
	}
	pages, e := preparePublicationStoredAt(context.Background(), next, f.source.export, store, f.root, nil)
	if e != nil || pages[0].Result.Status != "mapped" || pages[0].Result.Mapping.Source.OperationID != next.Source.OperationID || pages[0].Result.Candidate.SourceDigest != f.preparation.SourceDigest || pages[0].Result.Scan.Coverage.Commits != 0 || pages[0].Result.Scan.ScanID != next.ScanRunID || f.pushes.Load() != 1 {
		t.Fatal("new source relabeled old candidate or repeated effect", e)
	}
	if _, e = os.Lstat(filepath.Join(f.root, "constructions", next.Construction.ConstructionID, "candidate.json")); !os.IsNotExist(e) {
		t.Fatal("same-tree mapping constructed a fictional head")
	}
	after, _ := readPublicationFile(filepath.Join(op, "result.json"))
	afterACK, _ := readPublicationFile(filepath.Join(op, "ack.json"))
	if string(after) != string(original) || string(afterACK) != string(ackBytes) {
		t.Fatal("resolution replaced original terminal result/ACK")
	}
}

func TestRemotePreparationRetainedProofMissingACKAndResolutionMismatch(t *testing.T) {
	for _, kind := range []string{"missing-ack", "foreign-scope", "mismatched-ref", "missing-worker", "altered-worker"} {
		t.Run(kind, func(t *testing.T) {
			f := publicationPushTestFixture(t)
			result, e := f.run(context.Background())
			if e != nil {
				t.Fatal(e)
			}
			f.ack(t, result)
			p := f.proof(result)
			r := f.preparation
			r.Published = &p
			r.PublishedDigest = publicationPointer(publicationDigest(p))
			op := filepath.Join(f.remoteRoot, "items", "item", "operations", "push")
			switch kind {
			case "missing-ack":
				_ = os.Remove(filepath.Join(op, "ack.json"))
			case "foreign-scope":
				p.StorageID = "foreign"
				r.PublishedDigest = publicationPointer(publicationDigest(p))
			case "mismatched-ref":
				p.Observation.DeliveryRef += "foreign"
				p.ObservationDigest = publicationDigest(p.Observation)
				r.PublishedDigest = publicationPointer(publicationDigest(p))
			case "missing-worker":
				_ = os.Remove(filepath.Join(op, "worker.json"))
			case "altered-worker":
				_ = os.WriteFile(filepath.Join(op, "worker.json"), []byte(`{"PID":123,"Group":123,"UID":0,"Birth":"","BootID":""}`), 0600)
			}
			if verifyPublicationPublishedAt(context.Background(), r, f.root, f.remoteRoot, f.io) == nil {
				t.Fatal("untrusted original proof authorized parent")
			}
		})
	}
}

func TestRemotePreparationRevertToOriginalBaseIsRealFastForward(t *testing.T) {
	f := publicationPushTestFixture(t)
	first, e := f.run(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	f.ack(t, first)
	proof := f.proof(first)
	originalRefs := resultTestGit(t, f.source.export, nil, "show-ref")
	resultTestGit(t, f.source.work, nil, "checkout", "--quiet", f.source.base)
	resultTestGit(t, f.source.work, nil, "commit", "--allow-empty", "--quiet", "-m", "private correction source")
	commit := resultTestGit(t, f.source.work, nil, "rev-parse", "HEAD")
	tree := resultTestGit(t, f.source.work, nil, "rev-parse", "HEAD^{tree}")
	export := filepath.Join(filepath.Dir(f.root), "new-export.git")
	resultTestGit(t, filepath.Dir(f.root), nil, "clone", "--bare", "--no-local", "--quiet", f.source.work, export)
	resultTestGit(t, export, nil, "update-ref", "refs/monos/result", commit)
	r := f.preparation
	r.OperationID = "correction-prepare"
	r.ScanRunID = "correction-scan"
	r.Source.OperationID = "new-completion"
	r.Source.Generation++
	r.Source.NodeActivation++
	r.Source.GitCommit = commit
	r.Source.GitTree = tree
	r.SourceDigest = publicationDigest(r.Source)
	r.EffectiveBasis.CompletionOperationID = r.Source.OperationID
	r.EffectiveBasisDigest = publicationDigest(r.EffectiveBasis)
	r.Published = &proof
	r.PublishedDigest = publicationPointer(publicationDigest(proof))
	r.Construction.ConstructionID = "correction-construction"
	r.Construction.CandidateID = "correction-candidate"
	r.Construction.SourceDigest = r.SourceDigest
	r.Construction.Parents = []protocol.PublicationParent{{Kind: "published", Commit: proof.Candidate.Head, RepositoryIdentity: proof.RepositoryIdentity, PublishedProof: &proof, PublishedProofDigest: r.PublishedDigest}}
	r.ConstructionDigest = publicationDigest(r.Construction)
	if e = verifyPublicationPublishedAt(context.Background(), r, f.root, f.remoteRoot, f.io); e != nil {
		t.Fatal(e)
	}
	store, e := preparePublicationStore(context.Background(), f.root, export, r)
	if e != nil {
		t.Fatal(e)
	}
	pages, e := preparePublicationStoredAt(context.Background(), r, export, store, f.root, nil)
	if e != nil || pages[0].Result.Status != "prepared" || pages[0].Result.Candidate.Tree != tree || pages[0].Result.Candidate.Parents[0] != proof.Candidate.Head {
		t.Fatal("revert was collapsed to original-base no-change", e)
	}
	var prepared protocol.PublicationPushRequestPrepared
	raw, _ := json.Marshal(pages[0].Result)
	_ = json.Unmarshal(raw, &prepared)
	f.request.OperationID = "correction-push"
	f.request.Preparation = r
	f.request.Prepared = prepared
	f.request.PreparationResultDigest = publicationDigest(prepared)
	f.request.ExpectedHead = publicationPointer(proof.Candidate.Head)
	f.request.PriorPublished = &proof
	f.request.PriorPublishedDigest = r.PublishedDigest
	if e = ValidatePublicationPushRequest(f.request); e != nil {
		t.Fatal(e)
	}
	second, e := f.run(context.Background())
	if e != nil || second.Status != "published" || f.pushes.Load() != 2 {
		t.Fatal("corrective exact FF failed", e)
	}
	if resultTestGit(t, f.remote, nil, "rev-parse", f.request.DeliveryRef+"^{tree}") != tree || resultTestGit(t, f.source.export, nil, "show-ref") != originalRefs {
		t.Fatal("remote correction/source attribution differs")
	}
}

func TestRemotePreparationFreshScanMetadataAndCancellationFence(t *testing.T) {
	for _, phase := range []string{"observe", "push", "denial"} {
		t.Run("scheduling_"+phase, func(t *testing.T) {
			f := publicationPushTestFixture(t)
			access := f.io.access
			f.io.access = func(ctx context.Context, r protocol.PublicationPushRequest, purpose protocol.PublicationAccessRequestPurpose, attempt string) (protocol.PublicationAccessResult, error) {
				if string(purpose) == phase {
					return protocol.PublicationAccessResult{}, publicationTestSchedulingWait{}
				}
				if phase == "denial" && purpose == "push" {
					return protocol.PublicationAccessResult{}, errors.New("rate_limited prose without typed scheduling")
				}
				return access(ctx, r, purpose, attempt)
			}
			result, e := f.run(context.Background())
			op := filepath.Join(f.remoteRoot, "items", "item", "operations", "push")
			if phase == "denial" {
				if e != nil || result.Status != "blocked" || result.Reason == nil || *result.Reason != "access_denied" || f.pushes.Load() != 0 {
					t.Fatal("true denial did not retain blocking semantics", e)
				}
				return
			}
			if !publicationAccessSchedulingWait(e) || f.pushes.Load() != 0 {
				t.Fatal("pre-effect scheduling wait settled or pushed", e)
			}
			for _, name := range []string{"started.json", "worker.json", "absence.json", "result.json"} {
				if _, e := readPublicationFile(filepath.Join(op, name)); !os.IsNotExist(e) {
					t.Fatal("scheduling wait retained physical or terminal marker", name)
				}
			}
			intent, e := readPublicationFile(filepath.Join(op, "intent.json"))
			if e != nil || string(intent) != string(mustPublicationCanonical(f.request)) {
				t.Fatal("original pending intent changed", e)
			}
			f.io.access = access
			result, e = f.run(context.Background())
			if e != nil || result.Status != "published" || f.pushes.Load() != 1 {
				t.Fatal("original operation did not resume after wait", e)
			}
		})
	}
	f := publicationPushTestFixture(t)
	legacy := f.request
	scanCopy := *legacy.Prepared.Scan
	legacy.Prepared.Scan = &scanCopy
	legacy.Prepared.Scan.WorkflowChanges = nil
	legacy.Prepared.ScanDigest = publicationPointer(publicationDigest(legacy.Prepared.Scan))
	legacy.PreparationResultDigest = publicationDigest(legacy.Prepared)
	if ValidatePublicationPushRequest(legacy) == nil {
		t.Fatal("legacy missing workflow fact authorized new mutation")
	}
	unverified := f.request
	unverified.Preparation.PermissionProof = nil
	unverified.Preparation.PermissionProofDigest = nil
	if ValidatePublicationPushRequest(unverified) == nil {
		t.Fatal("missing immutable scan grant context authorized mutation")
	}
	ctx, cancel := context.WithCancel(context.Background())
	access := f.io.access
	f.io.access = func(ctx context.Context, r protocol.PublicationPushRequest, purpose protocol.PublicationAccessRequestPurpose, attempt string) (protocol.PublicationAccessResult, error) {
		cancel()
		return access(ctx, r, purpose, attempt)
	}
	if _, e := f.run(ctx); e == nil || f.pushes.Load() != 0 {
		t.Fatal("external cancellation started effect")
	}
	op := filepath.Join(f.remoteRoot, "items", f.request.ItemID, "operations", f.request.OperationID)
	if _, e := os.Lstat(filepath.Join(op, "result.json")); !os.IsNotExist(e) {
		t.Fatal("connection cancellation froze terminal result")
	}
}

func TestReviewRevokedPregrantPushRequiresOriginalACKBeforeSuccessor(t *testing.T) {
	f := publicationPushTestFixture(t)
	access := f.io.access
	f.io.access = func(ctx context.Context, r protocol.PublicationPushRequest, purpose protocol.PublicationAccessRequestPurpose, attempt string) (protocol.PublicationAccessResult, error) {
		if purpose == "push" {
			return protocol.PublicationAccessResult{}, errors.New("original write authority revoked")
		}
		return access(ctx, r, purpose, attempt)
	}
	original := f.request
	result, e := f.run(context.Background())
	if e != nil || result.PushStarted || !result.WorkerAbsent || result.Status != "blocked" || f.pushes.Load() != 0 {
		t.Fatal("revoked pregrant operation did not retain no-effect result", e)
	}
	f.request.OperationID = "successor"
	f.io.access = access
	if _, e = f.run(context.Background()); e == nil || f.pushes.Load() != 0 {
		t.Fatal("successor ran before original acknowledgement")
	}
	f.request = original
	replayed, e := f.run(context.Background())
	if e != nil || publicationDigest(replayed) != publicationDigest(result) {
		t.Fatal("original result could not replay beside waiting successor", e)
	}
	f.ack(t, result)
	f.request.OperationID = "successor"
	if next, e := f.run(context.Background()); e != nil || next.Status != "published" || f.pushes.Load() != 1 {
		t.Fatal("fresh operation did not proceed after immutable original ACK", e)
	}
}

func TestRemotePreparationWorkflowGrantRescanKeepsConstruction(t *testing.T) {
	f := publicationPushTestFixture(t)
	// New exact source has a changed workflow. A denied scan discovers the fact
	// and cannot authorize a push; a real fresh grant changes only scan identity.
	resultTestWrite(t, f.source.work, ".github/workflows/synthetic.yml", []byte("name: synthetic\non: workflow_dispatch\n"))
	commit := scanCommit(t, f.source.work)
	tree := resultTestGit(t, f.source.work, nil, "rev-parse", "HEAD^{tree}")
	export := filepath.Join(filepath.Dir(f.root), "workflow-source.git")
	resultTestGit(t, filepath.Dir(f.root), nil, "clone", "--bare", "--no-local", "--quiet", f.source.work, export)
	resultTestGit(t, export, nil, "update-ref", "refs/monos/result", commit)
	r := f.preparation
	r.OperationID = "workflow-denied"
	r.ScanRunID = "workflow-denied-scan"
	r.Source.GitCommit = commit
	r.Source.GitTree = tree
	r.SourceDigest = publicationDigest(r.Source)
	r.Construction.SourceDigest = r.SourceDigest
	r.Construction.CandidateID = "workflow-candidate"
	r.Construction.ConstructionID = "workflow-construction"
	r.ConstructionDigest = publicationDigest(r.Construction)
	store, e := preparePublicationStore(context.Background(), f.root, export, r)
	if e != nil {
		t.Fatal(e)
	}
	denied, e := preparePublicationStoredAt(context.Background(), r, export, store, f.root, nil)
	if e != nil || denied[0].Result.Scan.WorkflowChanges == nil || !*denied[0].Result.Scan.WorkflowChanges {
		t.Fatal("actual changed workflow fact missing", e)
	}
	found := false
	for _, page := range denied {
		for _, finding := range page.Findings {
			if finding.Kind == "workflow_permission" && !finding.OverrideEligible {
				found = true
			}
		}
	}
	if !found {
		t.Fatal("denied workflow was eligible")
	}
	head := denied[0].Result.Candidate.Head
	proof := *r.PermissionProof
	proof.ObservationID = "workflows-grant"
	proof.Permissions.Workflows = publicationPointer(protocol.Contents("write"))
	proof.PermissionFingerprint = publicationDigest(map[string]any{"configuration_fingerprint": proof.ConfigurationFingerprint, "repository_id": proof.RepositoryID, "permissions": proof.Permissions})
	r.OperationID = "workflow-allowed"
	r.ScanRunID = "workflow-allowed-scan"
	r.PermissionProof = &proof
	r.PermissionProofDigest = publicationPointer(publicationDigest(proof))
	r.Configuration.WorkflowWrite = "allowed"
	r.Configuration.PermissionFingerprint = proof.PermissionFingerprint
	r.ConfigurationDigest = publicationDigest(r.Configuration)
	if ValidatePublicationRequest(r) != nil {
		t.Fatal("exact workflow grant rejected")
	}
	allowed, e := preparePublicationStoredAt(context.Background(), r, export, store, f.root, nil)
	if e != nil || allowed[0].Result.Candidate.Head != head || allowed[0].Result.Scan.FindingsCount != 0 || !*allowed[0].Result.Scan.WorkflowChanges || allowed[0].Result.Scan.ScanID == denied[0].Result.Scan.ScanID {
		t.Fatal("grant refresh changed construction or lost workflow fact", e)
	}
}

func TestRemotePreparationImmutableScanAndStoreTamperBlocksClaim(t *testing.T) {
	for _, kind := range []string{"candidate-ref", "scan-pages", "url-rewrite"} {
		t.Run(kind, func(t *testing.T) {
			f := publicationPushTestFixture(t)
			claims := 0
			access := f.io.access
			f.io.access = func(ctx context.Context, r protocol.PublicationPushRequest, purpose protocol.PublicationAccessRequestPurpose, attempt string) (protocol.PublicationAccessResult, error) {
				if purpose == "push" {
					claims++
				}
				return access(ctx, r, purpose, attempt)
			}
			switch kind {
			case "candidate-ref":
				resultTestGit(t, f.store, nil, "update-ref", "refs/monos/candidates/"+f.preparation.Construction.ConstructionID, f.source.base)
			case "scan-pages":
				path := filepath.Join(f.root, "operations", f.preparation.OperationID, "pages.json")
				raw, _ := readPublicationFile(path)
				var pages []protocol.PublicationResultPage
				_ = json.Unmarshal(raw, &pages)
				pages[0].Result.Scan.Coverage.Versions++
				_ = os.WriteFile(path, mustPublicationCanonical(pages), 0600)
			case "url-rewrite":
				resultTestGit(t, f.store, nil, "config", "url.https://unexpected.invalid/.insteadOf", "https://github.com/")
			}
			result, e := f.run(context.Background())
			if e != nil || result.Status != "blocked" || result.PushStarted || claims != 0 || f.pushes.Load() != 0 {
				t.Fatal("tampered immutable physical input acquired write claim", e)
			}
		})
	}
}
