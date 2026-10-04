package daemon

import (
	"context"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/journal"
	"monos.local/runner/internal/wire"
)

func publicationDaemonDigest(t *testing.T, v any) string {
	t.Helper()
	_, d, e := wire.Canonical(v)
	if e != nil {
		t.Fatal(e)
	}
	return d
}
func publicationDaemonFixture(t *testing.T, retainOpen bool) (*journal.DB, protocol.PublicationPrepareRequest) {
	t.Helper()
	db := testDB(t)
	dispatch, completion := recoveryFixture(t, "publication", protocol.KindCompleteNode)
	task := "11111111-1111-4111-8111-111111111111"
	dispatch.TaskID = &task
	w := completion.Workspace
	id, e := host.TaskWorkspaceID(task, w.ResourceID)
	if e != nil {
		t.Fatal(e)
	}
	w.TaskID = task
	w.WorkspaceID = id
	w.OpenOperationID = "later-open"
	dispatch.WorkspaceReservations.Resources[0].WorkspaceID = id
	w.Resource.ProviderMetadata = &protocol.RepositoryProviderMetadata{Github: &protocol.RepositoryProviderMetadataGithub{RepositoryID: "123"}}
	dispatch.NodeExecutionSource = &protocol.NodeExecutionSource{SourceID: "source", NodeID: *dispatch.NodeID, NodeActivation: 1, SpecificationID: "original-spec", PlanID: "original-plan", ContextDigest: strings.Repeat("a", 64)}
	dispatch.ProcessReleased = true
	dispatch.MutationAllowed = false
	completion.WorkspaceDigest = ptr(publicationDaemonDigest(t, w))
	completion.CompletionManifestDigest = ptr(strings.Repeat("c", 64))
	completion.State = protocol.FluffyAdmitted
	source := protocol.ResultReadIdentity{TaskID: task, OperationID: completion.OperationID, AttemptID: completion.AttemptID, DispatchID: completion.DispatchID, NodeID: *dispatch.NodeID, NodeActivation: 1, SpecificationID: "original-spec", PlanID: "original-plan", WorkspaceID: id, ResourceID: w.ResourceID, RunnerID: w.RunnerID, StorageID: "storage", Generation: 1, LeaseID: w.LeaseID, RepositoryIdentity: w.Resource.RepositoryIdentity, ManifestDigest: *completion.CompletionManifestDigest, BaseCommit: strings.Repeat("1", 40), GitCommit: strings.Repeat("2", 40), GitTree: strings.Repeat("3", 40)}
	source.OperationIdentityDigest, e = wire.OperationIdentity(completion)
	if e != nil {
		t.Fatal(e)
	}
	metadata := protocol.WorkspaceMetadata{StorageID: source.StorageID, BaseCommit: source.BaseCommit, FinalizedCommit: source.GitCommit, TargetCommit: source.BaseCommit, TargetBranch: "main", Generation: 1, LeaseID: source.LeaseID, RepositoryIdentity: source.RepositoryIdentity, ProviderMetadata: w.Resource.ProviderMetadata}
	outcome := protocol.OperationResult{OperationID: completion.OperationID, AttemptID: completion.AttemptID, Success: true, Result: protocol.EffectResult{WorkspaceID: &source.WorkspaceID, GitCommit: &source.GitCommit, GitTree: &source.GitTree, WriterAbsent: nodeBool(true), WorkspaceMetadata: &metadata}}
	retainRecovery(t, db, dispatch, completion, &outcome)
	original := *w
	original.OpenOperationID = "original-materialization"
	original.LeaseID = "original-lease"
	open := protocol.Operation{SchemaVersion: 1, OperationID: original.OpenOperationID, AttemptID: completion.AttemptID, DispatchID: completion.DispatchID, RequestID: "original-open-request", Kind: protocol.KindOpenWorkspace, State: protocol.FluffyAdmitted, ResourceID: &source.ResourceID, Workspace: &original, WorkspaceDigest: ptr(publicationDaemonDigest(t, original))}
	originalMeta := metadata
	originalMeta.LeaseID = original.LeaseID
	originalMeta.FinalizedCommit = source.BaseCommit
	originalOutcome := protocol.OperationResult{OperationID: open.OperationID, AttemptID: open.AttemptID, Success: true, Result: protocol.EffectResult{WorkspaceID: &source.WorkspaceID, WorkspaceMetadata: &originalMeta}}
	if retainOpen {
		retainRecovery(t, db, dispatch, open, &originalOutcome)
	}
	parent := protocol.PublicationParent{Kind: "materialization", Commit: source.BaseCommit, RepositoryIdentity: source.RepositoryIdentity, ObservationOperationID: open.OperationID, Workspace: original, Outcome: originalOutcome.Result}
	parent.ObservationDigest = publicationDaemonDigest(t, map[string]any{"operation_id": parent.ObservationOperationID, "workspace": parent.Workspace, "outcome": parent.Outcome})
	sd := publicationDaemonDigest(t, source)
	construction := protocol.PublicationConstruction{SchemaVersion: 1, CandidateID: "candidate", ConstructionID: "construction", SourceDigest: sd, RepositoryIdentity: source.RepositoryIdentity, TargetBranch: "main", Parents: []protocol.PublicationParent{parent}, AuthorName: "monos", AuthorEmail: "monos@localhost", Timestamp: "1790999999 +0000", Message: "monos Task " + task + " result v1"}
	config := protocol.PublicationScanConfiguration{SchemaVersion: 1, PolicyVersion: "local_publication_v1", RuleVersion: "credential_rules_v1", TraversalVersion: "all_parents_final_tree_v1", LocalBlobLimit: 50 << 20, ProviderBlobLimit: 100 << 20, MaxCommits: 256, MaxPaths: 8192, MaxVersions: 32768, MaxBlobBytes: 128 << 20, MaxAggregateBytes: 512 << 20, MaxFindings: 4096, MaxEvidenceBytes: 8 << 20, DeadlineSeconds: 120, WorkflowWrite: "unknown", PermissionFingerprint: strings.Repeat("e", 64)}
	basis := protocol.PublicationEffectiveBasis{TaskID: task, SpecificationID: "effective-carried-spec", PlanID: "effective-carried-plan", CompletionOperationID: source.OperationID, CompletionManifestDigest: source.ManifestDigest}
	return db, protocol.PublicationPrepareRequest{SchemaVersion: 1, OperationID: "publication-op", ScanRunID: "scan", Source: source, SourceDigest: sd, Construction: construction, ConstructionDigest: publicationDaemonDigest(t, construction), Configuration: config, ConfigurationDigest: publicationDaemonDigest(t, config), EffectiveBasis: basis, EffectiveBasisDigest: publicationDaemonDigest(t, basis)}
}
func TestPublicationRetainedOriginalOpenAndReleasedCompletion(t *testing.T) {
	db, r := publicationDaemonFixture(t, true)
	before, e := db.Effect(r.Source.OperationID)
	if e != nil {
		t.Fatal(e)
	}
	if e = retainedPublicationIdentity(db, r); e != nil {
		t.Fatal("original public open/released source rejected", e)
	}
	if r.Construction.Parents[0].ObservationOperationID == "later-open" {
		t.Fatal("fixture did not distinguish original public origin")
	}
	after, e := db.Effect(r.Source.OperationID)
	if e != nil || !reflect.DeepEqual(before, after) {
		t.Fatal("publication rewrote completion journal", e)
	}
}
func TestPublicationRetainedRejectsMissingForeignAndPrivateParents(t *testing.T) {
	for _, kind := range []string{"missing-open", "different-outcome", "different-observation", "private-basis", "published", "storage", "source", "permission"} {
		t.Run(kind, func(t *testing.T) {
			db, r := publicationDaemonFixture(t, kind != "missing-open")
			p := &r.Construction.Parents[0]
			switch kind {
			case "different-outcome":
				p.Outcome.WorkspaceMetadata.TargetCommit = strings.Repeat("4", 40)
			case "different-observation":
				p.ObservationOperationID = "later-open"
			case "private-basis":
				p.Workspace.Basis = &protocol.WorkspaceBasis{StorageID: r.Source.StorageID, RepositoryIdentity: r.Source.RepositoryIdentity, BaseCommit: r.Source.GitCommit, FinalizedCommit: r.Source.GitCommit, TargetBranch: "main"}
			case "published":
				p.Kind = "published"
			case "storage":
				p.Outcome.WorkspaceMetadata.StorageID = "foreign"
			case "source":
				r.Source.GitTree = strings.Repeat("8", 40)
				r.SourceDigest = publicationDaemonDigest(t, r.Source)
				r.Construction.SourceDigest = r.SourceDigest
			case "permission":
				r.Configuration.WorkflowWrite = "allowed"
				r.ConfigurationDigest = publicationDaemonDigest(t, r.Configuration)
			}
			p.ObservationDigest = publicationDaemonDigest(t, map[string]any{"operation_id": p.ObservationOperationID, "workspace": p.Workspace, "outcome": p.Outcome})
			r.ConstructionDigest = publicationDaemonDigest(t, r.Construction)
			if retainedPublicationIdentity(db, r) == nil {
				t.Fatal("untrusted publication proof accepted", kind)
			}
		})
	}
}
func TestPublicationLaneTwoWorkersDedupCancellationAndRuntimeResponsiveness(t *testing.T) {
	d := Daemon{}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	entered := make(chan struct{}, 2)
	var calls atomic.Int32
	work := func() { calls.Add(1); entered <- struct{}{}; <-ctx.Done() }
	d.mu.Lock()
	if !d.enqueuePublication(ctx, "one", work) || !d.enqueuePublication(ctx, "two", work) {
		t.Fatal("two independent workers not admitted")
	}
	for n := 0; n < 2; n++ {
		select {
		case <-entered:
		case <-time.After(time.Second):
			t.Fatal("publication blocked on Runtime mutex")
		}
	}
	if d.enqueuePublication(ctx, "three", work) || d.enqueuePublication(ctx, "one", work) {
		t.Fatal("capacity or duplicate guard bypassed")
	}
	d.mu.Unlock()
	cancel()
	d.workers.Wait()
	if calls.Load() != 2 || len(d.publicationQueued) != 0 || len(d.publicationSlots) != 0 {
		t.Fatal("cancelled lane retained capacity")
	}
	fresh, cancelFresh := context.WithCancel(context.Background())
	defer cancelFresh()
	done := make(chan struct{})
	if !d.enqueuePublication(fresh, "one", func() { close(done) }) {
		t.Fatal("reconnect could not resume original key")
	}
	<-done
	d.workers.Wait()
	if d.enqueuePublication(ctx, "old-cancelled", func() { t.Error("cancelled context executed") }) {
		t.Fatal("obsolete connection admitted work")
	}
}
