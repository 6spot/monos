package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/control"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/wire"
)

func nodeFreeFixture(t *testing.T) (protocol.Dispatch, protocol.Operation) {
	t.Helper()
	d, op := recoveryFixture(t, "node-free", protocol.KindCompleteNode)
	d.NodeExecutionSource = &protocol.NodeExecutionSource{SourceID: "source", NodeID: *d.NodeID, NodeActivation: d.NodeActivation, ControlVersion: d.ControlVersion, SpecificationID: "spec", PlanID: "plan", ContextDigest: strings.Repeat("a", 64)}
	op.ResourceID, op.Workspace, op.WorkspaceDigest = nil, nil, nil
	op.RepositoryFree = nodeBool(true)
	op.CompletionManifestDigest = ptr(strings.Repeat("b", 64))
	return d, op
}

func TestNodeRepositoryFreeCompletionReconnectAndExactTerminalReplay(t *testing.T) {
	db := testDB(t)
	dispatch, op := nodeFreeFixture(t)
	retainRecovery(t, db, dispatch, op, nil)
	var effects atomic.Int32
	d := Daemon{DB: db, Control: &control.Client{}, Boot: "boot", Host: functionSupervisor(func(_ context.Context, r host.Request) (host.Status, error) {
		if r.Action == "effect" {
			if !reflect.DeepEqual(r.Operation, &op) {
				t.Error("completion identity changed")
			}
			if effects.Add(1) == 1 {
				return host.Status{}, errors.New("temporary absence check failure")
			}
			return host.Status{Known: true, Result: &protocol.EffectResult{WriterAbsent: nodeBool(true)}}, nil
		}
		return host.Status{Known: true, BootID: "boot"}, nil
	})}
	ctx, _ := recoveryContext(t, &d)
	_ = d.effect(ctx, op)
	failed, err := db.Effect(op.OperationID)
	if err != nil || failed == nil || failed.Success {
		t.Fatal("failure not retained", failed, err)
	}
	if err = d.Reconcile(ctx, recoveryInventory(dispatch, op)); err != nil {
		t.Fatal(err)
	}
	if effects.Load() != 1 {
		t.Fatal("recovery ran before Ready")
	}
	d.ConnectionReady(ctx)
	d.workers.Wait()
	result, err := db.Effect(op.OperationID)
	if err != nil || result == nil || !result.Success || result.Result.WriterAbsent == nil || !*result.Result.WriterAbsent || result.Result.GitCommit != nil || result.Result.GitTree != nil || result.Result.WorkspaceMetadata != nil || effects.Load() != 2 {
		t.Fatal("honest no-Git completion failed", result, err)
	}
	_ = d.effect(ctx, op)
	if effects.Load() != 2 {
		t.Fatal("terminal replay called Host")
	}
}

func TestNodeCompletionRejectsForeignSourceAndFabricatedGit(t *testing.T) {
	for _, mode := range []string{"source", "activation", "spec", "plan", "context", "released", "mutable", "git", "path", "populated", "unknown", "missing-absence"} {
		t.Run(mode, func(t *testing.T) {
			db := testDB(t)
			dispatch, op := nodeFreeFixture(t)
			prior := recoveryFailure(op)
			retainRecovery(t, db, dispatch, op, prior)
			var changed protocol.Dispatch
			raw, _ := json.Marshal(dispatch)
			_ = json.Unmarshal(raw, &changed)
			switch mode {
			case "source":
				changed.NodeExecutionSource.SourceID = "other"
			case "activation":
				changed.NodeExecutionSource.NodeActivation++
			case "spec":
				changed.NodeExecutionSource.SpecificationID = "other"
			case "plan":
				changed.NodeExecutionSource.PlanID = "other"
			case "context":
				changed.NodeExecutionSource.ContextDigest = strings.Repeat("c", 64)
			case "released":
				changed.ProcessReleased = true
			case "mutable":
				changed.MutationAllowed = true
			}
			var calls atomic.Int32
			d := Daemon{DB: db, Control: &control.Client{}, Boot: "boot", Host: functionSupervisor(func(_ context.Context, r host.Request) (host.Status, error) {
				status := host.Status{Known: true, BootID: "boot", Result: &protocol.EffectResult{WriterAbsent: nodeBool(true)}}
				if r.Action == "effect" {
					calls.Add(1)
					switch mode {
					case "git":
						status.Result.GitCommit = ptr(strings.Repeat("a", 40))
						status.Result.GitTree = ptr(strings.Repeat("a", 40))
					case "path":
						status.Result.Path = ptr("/fake")
					case "populated":
						status.Populated = true
					case "unknown":
						status.Known = false
					case "missing-absence":
						status.Result.WriterAbsent = nil
					}
				}
				return status, nil
			})}
			ctx, _ := recoveryContext(t, &d)
			if mode == "git" || mode == "path" || mode == "populated" || mode == "unknown" || mode == "missing-absence" {
				_ = d.effect(ctx, op)
				r, _ := db.Effect(op.OperationID)
				if r == nil || r.Success {
					t.Fatal("fabricated completion accepted", r)
				}
			} else {
				if err := d.Reconcile(ctx, recoveryInventory(changed, op)); err == nil {
					t.Fatal("changed source accepted")
				}
				d.ConnectionReady(ctx)
				d.workers.Wait()
				if calls.Load() != 0 {
					t.Fatal("changed source reached Host")
				}
			}
		})
	}
}

func nodeBool(v bool) *bool { return &v }

func TestCompletionCancellationReplaysWholeRetainedPairWithoutHost(t *testing.T) {
	db := testDB(t)
	dispatch, original := recoveryFixture(t, "completion-pair", protocol.KindCompleteNode)
	dispatch.NodeExecutionSource = &protocol.NodeExecutionSource{SourceID: "source", NodeID: *dispatch.NodeID, NodeActivation: 1, ControlVersion: dispatch.ControlVersion, SpecificationID: "spec", PlanID: "plan", ContextDigest: strings.Repeat("a", 64)}
	original.CompletionManifestDigest = ptr(strings.Repeat("b", 64))
	digest, _ := wire.OperationIdentity(original)
	settle := original
	settle.OperationID = "settlement"
	settle.RequestID = "settle-request"
	settle.Kind = protocol.SettleCompletion
	settle.CompletionManifestDigest = nil
	settle.CompletionOperationID = &original.OperationID
	settle.CompletionIdentityDigest = &digest
	retainRecovery(t, db, dispatch, original, recoveryFailure(original))
	if err := db.BeginEffect(settle); err != nil {
		t.Fatal(err)
	}
	w := settle.Workspace
	oid := strings.Repeat("a", 40)
	metadata := &protocol.WorkspaceMetadata{StorageID: "storage", Generation: w.Generation, LeaseID: w.LeaseID, RepositoryIdentity: w.Resource.RepositoryIdentity, BaseCommit: oid, FinalizedCommit: oid, TargetBranch: "main", TargetCommit: oid, Checkpoint: &protocol.WorkspaceCheckpoint{OperationID: settle.OperationID, HeadCommit: oid, TreeID: oid, CommitID: oid, CompletionOperationID: &original.OperationID, CompletionIdentityDigest: &digest}}
	pair := protocol.OperationResult{AttemptID: settle.AttemptID, OperationID: settle.OperationID, Success: true, Result: protocol.EffectResult{WriterAbsent: nodeBool(true), WorkspaceID: &w.WorkspaceID, WorkspaceMetadata: metadata}, CompletionSettlement: &protocol.CompletionSettlement{CompletionOperationID: original.OperationID, Disposition: protocol.DispositionCancelled, CompletionResult: protocol.CompletionOperationResult{AttemptID: original.AttemptID, OperationID: original.OperationID, CancelledByOperationID: &settle.OperationID, Result: protocol.EffectResult{WriterAbsent: nodeBool(true)}}}}
	if err := db.FinishCompletionSettlement(pair); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	d := Daemon{DB: db, Control: &control.Client{}, Boot: "boot", Host: functionSupervisor(func(context.Context, host.Request) (host.Status, error) {
		calls.Add(1)
		return host.Status{}, errors.New("should not be called")
	})}
	_ = d.effect(context.Background(), original)
	_ = d.effect(context.Background(), settle)
	if calls.Load() != 0 {
		t.Fatal("terminal pair replay executed Host")
	}
	got, _ := db.Effect(settle.OperationID)
	if !reflect.DeepEqual(got, &pair) {
		t.Fatal("terminal pair changed")
	}
}

func TestOriginalRedeliveryCannotAutomaticallyRetryHardSettlement(t *testing.T) {
	db := testDB(t)
	dispatch, original := recoveryFixture(t, "hard-settlement", protocol.KindCompleteNode)
	dispatch.NodeExecutionSource = &protocol.NodeExecutionSource{SourceID: "source", NodeID: *dispatch.NodeID, NodeActivation: 1, ControlVersion: dispatch.ControlVersion, SpecificationID: "spec", PlanID: "plan", ContextDigest: strings.Repeat("a", 64)}
	original.CompletionManifestDigest = ptr(strings.Repeat("b", 64))
	digest, _ := wire.OperationIdentity(original)
	settle := original
	settle.OperationID = "settlement"
	settle.Kind = protocol.SettleCompletion
	settle.CompletionManifestDigest = nil
	settle.CompletionOperationID = &original.OperationID
	settle.CompletionIdentityDigest = &digest
	retainRecovery(t, db, dispatch, original, recoveryFailure(original))
	if err := db.BeginEffect(settle); err != nil {
		t.Fatal(err)
	}
	kind := protocol.CaptureHardLimit
	if err := db.FinishEffect(protocol.OperationResult{AttemptID: settle.AttemptID, OperationID: settle.OperationID, FailureKind: &kind}); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	d := Daemon{DB: db, Control: &control.Client{}, Boot: "boot", Host: functionSupervisor(func(context.Context, host.Request) (host.Status, error) {
		calls.Add(1)
		return host.Status{}, &host.EffectError{Kind: kind, Cause: errors.New("disk full")}
	})}
	ctx, _ := recoveryContext(t, &d)
	if err := d.replayCompletionSettlement(ctx, original, settle.OperationID); err == nil {
		t.Fatal("original redelivery scheduled hard recovery")
	}
	d.workers.Wait()
	if calls.Load() != 0 {
		t.Fatal("hard settlement retried without explicit admission")
	}
	settle.State = protocol.FluffyAdmitted
	_ = d.effect(ctx, settle)
	if calls.Load() != 1 {
		t.Fatal("explicit same-ID settlement retry failed to reach Host")
	}
}
