package daemon

import (
	"context"
	"encoding/json"
	"monos.local/runner/internal/control"
	"reflect"
	"strings"
	"testing"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/journal"
	"monos.local/runner/internal/wire"
)

func retainedReadFixture(t *testing.T) (*journal.DB, protocol.Dispatch, protocol.Operation, protocol.ResultReadIdentity, protocol.OperationResult) {
	t.Helper()
	db := testDB(t)
	d, op := recoveryFixture(t, "retained-read", protocol.KindCompleteNode)
	d.NodeExecutionSource = &protocol.NodeExecutionSource{SourceID: "source", NodeID: *d.NodeID, NodeActivation: d.NodeActivation, SpecificationID: "spec", PlanID: "plan", ContextDigest: strings.Repeat("a", 64), ControlVersion: d.ControlVersion}
	// Historical reads survive release, old boot and a later live workspace generation.
	d.ProcessReleased = true
	d.MutationAllowed = false
	op.CompletionManifestDigest = ptr(strings.Repeat("b", 64))
	op.State = protocol.FluffyAdmitted
	digest, e := wire.OperationIdentity(op)
	if e != nil {
		t.Fatal(e)
	}
	w := op.Workspace
	i := protocol.ResultReadIdentity{TaskID: *d.TaskID, OperationID: op.OperationID, AttemptID: op.AttemptID, DispatchID: op.DispatchID, NodeID: *d.NodeID, NodeActivation: d.NodeActivation, SpecificationID: "spec", PlanID: "plan", WorkspaceID: w.WorkspaceID, ResourceID: w.Resource.ResourceID, RunnerID: d.RunnerID, StorageID: "storage-old", Generation: w.Generation, LeaseID: w.LeaseID, RepositoryIdentity: w.Resource.RepositoryIdentity, ManifestDigest: *op.CompletionManifestDigest, OperationIdentityDigest: digest, BaseCommit: strings.Repeat("1", 40), GitCommit: strings.Repeat("2", 40), GitTree: strings.Repeat("3", 40)}
	r := protocol.OperationResult{OperationID: op.OperationID, AttemptID: op.AttemptID, Success: true, Result: protocol.EffectResult{WriterAbsent: nodeBool(true), WorkspaceID: &i.WorkspaceID, GitCommit: &i.GitCommit, GitTree: &i.GitTree, WorkspaceMetadata: &protocol.WorkspaceMetadata{StorageID: i.StorageID, Generation: i.Generation, LeaseID: i.LeaseID, RepositoryIdentity: i.RepositoryIdentity, BaseCommit: i.BaseCommit, FinalizedCommit: i.GitCommit, TargetBranch: "main", TargetCommit: i.BaseCommit}}}
	retainRecovery(t, db, d, op, &r)
	return db, d, op, i, r
}
func TestResultReadRetainedCompletionHistoricalAuthorityAndPreservation(t *testing.T) {
	db, _, op, i, r := retainedReadFixture(t)
	if e := retainedResultIdentity(db, i); e != nil {
		t.Fatal("released historical result rejected", e)
	}
	if e := retainedResultIdentity(db, i); e != nil {
		t.Fatal("replayed read changed authority", e)
	}
	after, e := db.Effect(op.OperationID)
	if e != nil || !reflect.DeepEqual(after, &r) {
		t.Fatal("read changed effect", after, e)
	}
	afterOp, e := db.Operation(op.OperationID)
	if e != nil || !reflect.DeepEqual(afterOp, op) {
		t.Fatal("read changed operation", e)
	}
}

func TestResultReadBindsPrivateAndIntegratedRevisions(t *testing.T) {
	db := testDB(t)
	_, d, op, identity, result := retainedReadFixture(t)
	isolation := &protocol.WorkspaceIsolation{AllocationID: "allocation"}
	d.WorkspaceReservations.Isolation, op.Workspace.Isolation = isolation, isolation
	op.Integration = &protocol.WorkspaceIntegration{ExpectedTaskCommit: identity.BaseCommit}
	result.Result.WorkspaceMetadata.Isolation = &protocol.WorkspaceIsolationMetadata{AllocationID: isolation.AllocationID, StartCommit: identity.BaseCommit}
	result.Result.Integration = &protocol.WorkspaceIntegrationResult{Outcome: protocol.Integrated, StartCommit: identity.BaseCommit, NodeCommit: strings.Repeat("4", 40), NodeTree: strings.Repeat("5", 40), ExpectedTaskCommit: identity.BaseCommit, TaskCommit: identity.GitCommit, TaskTree: identity.GitTree}
	identity.Integration = result.Result.Integration
	_, descriptorDigest, err := wire.Canonical(op.Workspace)
	if err != nil {
		t.Fatal(err)
	}
	op.WorkspaceDigest = &descriptorDigest
	identity.OperationIdentityDigest, err = wire.OperationIdentity(op)
	if err != nil {
		t.Fatal(err)
	}
	retainRecovery(t, db, d, op, &result)
	if err := retainedResultIdentity(db, identity); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"missing", "node", "start", "expected", "conflict"} {
		raw, _ := json.Marshal(identity)
		var bad protocol.ResultReadIdentity
		_ = json.Unmarshal(raw, &bad)
		switch field {
		case "missing":
			bad.Integration = nil
		case "node":
			bad.Integration.NodeCommit = strings.Repeat("6", 40)
		case "start":
			bad.Integration.StartCommit = strings.Repeat("6", 40)
		case "expected":
			bad.Integration.ExpectedTaskCommit = strings.Repeat("6", 40)
		case "conflict":
			bad.Integration.Outcome = protocol.Conflict
		}
		if retainedResultIdentity(db, bad) == nil {
			t.Fatalf("accepted changed integration %s", field)
		}
	}
}
func TestResultReadRetainedCompletionRejectsCrossedIdentity(t *testing.T) {
	fields := []string{"task_id", "operation_id", "attempt_id", "dispatch_id", "node_id", "specification_id", "plan_id", "workspace_id", "resource_id", "runner_id", "storage_id", "lease_id", "repository_identity", "manifest_digest", "operation_identity_digest", "base_commit", "git_commit", "git_tree", "generation", "node_activation"}
	for _, field := range fields {
		t.Run(field, func(t *testing.T) {
			db, _, _, i, _ := retainedReadFixture(t)
			raw, _ := json.Marshal(i)
			var m map[string]any
			_ = json.Unmarshal(raw, &m)
			if field == "generation" || field == "node_activation" {
				m[field] = float64(2)
			} else {
				m[field] = "foreign"
			}
			raw, _ = json.Marshal(m)
			_ = json.Unmarshal(raw, &i)
			if e := retainedResultIdentity(db, i); e == nil {
				t.Fatal("crossed identity accepted", field)
			}
		})
	}
}
func TestResultReadRetainedCompletionMissingEvidenceAndDescriptorDigest(t *testing.T) {
	for _, kind := range []string{"start", "operation", "effect", "descriptor-digest", "manifest", "physical", "checkpoint", "writer"} {
		t.Run(kind, func(t *testing.T) {
			db := testDB(t)
			_, d, op, i, r := retainedReadFixture(t)
			switch kind {
			case "descriptor-digest":
				op.WorkspaceDigest = ptr(strings.Repeat("c", 64))
			case "manifest":
				op.CompletionManifestDigest = nil
			case "physical":
				r.Result.GitTree = ptr(strings.Repeat("f", 40))
			case "checkpoint":
				r.Result.WorkspaceMetadata.Checkpoint = &protocol.WorkspaceCheckpoint{OperationID: "checkpoint", HeadCommit: i.GitCommit, TreeID: i.GitTree, CommitID: i.GitCommit}
			case "writer":
				r.Result.WriterAbsent = nodeBool(false)
			}
			if kind != "start" {
				if e := db.SaveStart(journal.Start{Dispatch: d, Phase: "absent", BootID: "old-boot"}); e != nil {
					t.Fatal(e)
				}
			}
			if kind != "operation" {
				if e := db.BeginEffect(op); e != nil {
					t.Fatal(e)
				}
				if kind != "effect" {
					if e := db.FinishEffect(r); e != nil {
						t.Fatal(e)
					}
				}
			}
			if e := retainedResultIdentity(db, i); e == nil {
				t.Fatal("incomplete/corrupt retained evidence accepted", kind)
			}
		})
	}
}
func TestResultReadCompletionRecoveryRetainsOriginalIdentity(t *testing.T) {
	db, _, original, i, originalResult := retainedReadFixture(t)
	settle := original
	settle.OperationID = "settlement-read"
	settle.RequestID = "settle-request"
	settle.Kind = protocol.SettleCompletion
	settle.CompletionManifestDigest = nil
	settle.CompletionOperationID = &original.OperationID
	settle.CompletionIdentityDigest = &i.OperationIdentityDigest
	if e := db.BeginEffect(settle); e != nil {
		t.Fatal(e)
	}
	pair := protocol.OperationResult{AttemptID: i.AttemptID, OperationID: settle.OperationID, Success: true, Result: protocol.EffectResult{WriterAbsent: nodeBool(true)}, CompletionSettlement: &protocol.CompletionSettlement{CompletionOperationID: original.OperationID, Disposition: protocol.AlreadyFinalized, CompletionResult: protocol.CompletionOperationResult{AttemptID: i.AttemptID, OperationID: original.OperationID, Success: true, Result: originalResult.Result}}}
	if e := db.FinishCompletionSettlement(pair); e != nil {
		t.Fatal(e)
	}
	if e := retainedResultIdentity(db, i); e != nil {
		t.Fatal("original recovered completion unreadable", e)
	}
	wrong := i
	wrong.OperationID = settle.OperationID
	if e := retainedResultIdentity(db, wrong); e == nil {
		t.Fatal("settlement used as original export authority")
	}
	if id, e := host.TaskWorkspaceID(i.TaskID, i.ResourceID); e != nil || id != i.WorkspaceID {
		t.Fatal("fixture lacks canonical workspace identity")
	}
}

func TestResultReadBusyAndReadLaneDoNotInvokeMutatingSupervisor(t *testing.T) {
	db, _, op, i, before := retainedReadFixture(t)
	_, digest, e := wire.Canonical(i)
	if e != nil {
		t.Fatal(e)
	}
	r := protocol.ResultReadRequest{Identity: i, IdentityDigest: digest, Mode: protocol.Changes}
	correlation := "bounded-read"
	// All four read slots are occupied; a fifth must return synchronously without
	// accessing the absent DB, admitting work or invoking the mutating supervisor.
	slots := make(chan struct{}, 4)
	for n := 0; n < 4; n++ {
		slots <- struct{}{}
	}
	d := Daemon{Control: &control.Client{}, readSlots: slots, Host: functionSupervisor(func(context.Context, host.Request) (host.Status, error) {
		t.Error("read called mutating supervisor")
		return host.Status{}, nil
	})}
	d.resultRead(context.Background(), protocol.Frame{Type: protocol.ResultRead, CorrelationID: &correlation, ResultRead: &r})
	d.workers.Wait()
	if len(slots) != 4 {
		t.Fatal("busy read stole occupied slot")
	}
	for n := 0; n < 4; n++ {
		<-slots
	}
	d.DB = db
	// A retained-identity failure is an independent read even while the mutation
	// mutex is held; it must settle and release its slot without journaling effects.
	r.Identity.StorageID = "foreign"
	_, r.IdentityDigest, e = wire.Canonical(r.Identity)
	if e != nil {
		t.Fatal(e)
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	d.resultRead(context.Background(), protocol.Frame{Type: protocol.ResultRead, CorrelationID: &correlation, ResultRead: &r})
	done := make(chan struct{})
	go func() { d.workers.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("read blocked behind mutation lane")
	}
	if len(slots) != 0 {
		t.Fatal("read slot leaked")
	}
	after, e := db.Effect(op.OperationID)
	if e != nil || !reflect.DeepEqual(after, &before) {
		t.Fatal("read lane changed original effect", e)
	}
}

func TestResultReadRejectsContradictoryRetainedDispatchScope(t *testing.T) {
	for _, kind := range []string{"todo", "planner", "node", "activation", "source", "reservations", "reservation-project", "reservation-resource"} {
		t.Run(kind, func(t *testing.T) {
			db, d, _, identity, _ := retainedReadFixture(t)
			switch kind {
			case "todo":
				d.TodoID = ptr("other-todo")
			case "planner":
				d.Kind = protocol.PurplePlanner
			case "node":
				d.NodeID = ptr("other-node")
			case "activation":
				d.NodeActivation++
			case "source":
				d.NodeExecutionSource = nil
			case "reservations":
				d.WorkspaceReservations = nil
			case "reservation-project":
				d.WorkspaceReservations.ProjectID = "other-project"
			case "reservation-resource":
				d.WorkspaceReservations.Resources = nil
			}
			if e := db.SaveStart(journal.Start{Dispatch: d, Phase: "absent", BootID: "old-boot"}); e != nil {
				t.Fatal(e)
			}
			if e := retainedResultIdentity(db, identity); e == nil {
				t.Fatal("contradictory retained Start accepted", kind)
			}
		})
	}
}
