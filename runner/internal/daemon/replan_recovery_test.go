package daemon

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/control"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/journal"
)

func replanRecoveryFixture(t *testing.T) (protocol.Dispatch, protocol.Operation) {
	t.Helper()
	d, op := recoveryFixture(t, "planning-stop", protocol.Stop)
	d.Kind, d.NodeID, d.NodeActivation = "planner", nil, 0
	d.WorkspaceReservations.Resources = []protocol.WorkspaceReservation{}
	d.TaskReplanSource = &protocol.TaskReplanSource{RequestID: "intent", SourceID: "source", PlanID: "plan", ControlVersion: d.ControlVersion, SpecificationID: "spec", ContextDigest: strings.Repeat("a", 64)}
	op.ResourceID, op.Workspace, op.WorkspaceDigest = nil, nil, nil
	return d, op
}

func TestReplanReconnectSettlesOriginalStopAfterTransientFailure(t *testing.T) {
	db := testDB(t)
	dispatch, op := replanRecoveryFixture(t)
	retainRecovery(t, db, dispatch, op, nil)
	var effects, physicalStops atomic.Int32
	d := Daemon{DB: db, Control: &control.Client{}, Boot: "boot", Host: functionSupervisor(func(_ context.Context, r host.Request) (host.Status, error) {
		switch r.Action {
		case "effect":
			if !reflect.DeepEqual(r.Operation, &op) {
				t.Error("Replan recovery replaced its Stop", r.Operation)
			}
			if effects.Add(1) == 1 {
				return host.Status{}, errors.New("temporary systemctl status failure")
			}
		case "status":
			return host.Status{Known: true, BootID: "boot", Populated: physicalStops.Load() == 0}, nil
		case "stop":
			physicalStops.Add(1)
		}
		return host.Status{Known: true, BootID: "boot"}, nil
	})}
	ctx, _ := recoveryContext(t, &d)
	_ = d.effect(ctx, op) // No control connection: the failure is retained locally.
	failed, err := db.Effect(op.OperationID)
	if err != nil || failed == nil || failed.Success || failed.FailureKind == nil || *failed.FailureKind != protocol.Recoverable {
		t.Fatal("transient Stop failure was not retained", failed, err)
	}
	if err := d.Reconcile(ctx, recoveryInventory(dispatch, op)); err != nil {
		t.Fatal(err)
	}
	if physicalStops.Load() != 1 || effects.Load() != 1 {
		t.Fatal("reconnect did not clean up the revoked process before Ready")
	}
	d.ConnectionReady(ctx)
	d.workers.Wait()
	settled, err := db.Effect(op.OperationID)
	if err != nil || settled == nil || !settled.Success || settled.Result.WriterAbsent == nil || !*settled.Result.WriterAbsent || effects.Load() != 2 {
		t.Fatal("original repository-free Stop remained unresolved", settled, effects.Load(), err)
	}
	d.ConnectionReady(ctx)
	d.workers.Wait()
	if effects.Load() != 2 {
		t.Fatal("same reconnect repeated Stop recovery")
	}
}

func TestReplanRecoveryRejectsChangedSourceAndAuthorization(t *testing.T) {
	for _, mode := range []string{"intent", "source", "plan", "version", "watermark", "specification", "context", "task", "dispatch", "request", "mutation", "released", "resource", "queued-source"} {
		t.Run(mode, func(t *testing.T) {
			db := testDB(t)
			dispatch, op := replanRecoveryFixture(t)
			prior := recoveryFailure(op)
			retainRecovery(t, db, dispatch, op, prior)
			changed, _ := replanRecoveryFixture(t)
			switch mode {
			case "intent", "queued-source":
				changed.TaskReplanSource.RequestID = "another-intent"
			case "source":
				changed.TaskReplanSource.SourceID = "other"
			case "plan":
				changed.TaskReplanSource.PlanID = "other"
			case "watermark":
				changed.SourceWatermark = 37
			case "version":
				changed.TaskReplanSource.ControlVersion++
			case "specification":
				changed.TaskReplanSource.SpecificationID = "another-spec"
			case "context":
				changed.TaskReplanSource.ContextDigest = strings.Repeat("b", 64)
			case "task":
				changed.TaskID = ptr("another-task")
			case "dispatch":
				changed.DispatchID = "another-dispatch"
			case "request":
				op.RequestID = "another-request"
			case "mutation":
				changed.MutationAllowed = true
			case "released":
				changed.ProcessReleased = true
			case "resource":
				op.ResourceID = ptr("legacy-fixture")
			}
			var effects atomic.Int32
			d := Daemon{DB: db, Control: &control.Client{}, Boot: "boot", Host: functionSupervisor(func(_ context.Context, r host.Request) (host.Status, error) {
				if r.Action == "effect" {
					effects.Add(1)
				}
				return host.Status{Known: true, BootID: "boot"}, nil
			})}
			ctx, _ := recoveryContext(t, &d)
			if mode == "queued-source" {
				if err := d.Reconcile(ctx, recoveryInventory(dispatch, op)); err != nil {
					t.Fatal(err)
				}
				if err := db.SaveStart(journal.Start{Dispatch: changed, Phase: "absent", BootID: "boot"}); err != nil {
					t.Fatal(err)
				}
			} else if err := d.Reconcile(ctx, recoveryInventory(changed, op)); err == nil {
				t.Fatal("changed Replan recovery authority accepted")
			}
			d.ConnectionReady(ctx)
			d.workers.Wait()
			after, _ := db.Effect(op.OperationID)
			if effects.Load() != 0 || !reflect.DeepEqual(after, prior) {
				t.Fatal("changed planning source reached physical recovery")
			}
		})
	}
}

func TestReplanRecoveryKeepsNormalEffectKeyAndExcludesOtherPhases(t *testing.T) {
	for _, mode := range []string{"initial", "todo", "legacy", "other-task-phase", "missing-result", "hard-failure"} {
		t.Run(mode, func(t *testing.T) {
			db := testDB(t)
			dispatch, op := replanRecoveryFixture(t)
			prior := recoveryFailure(op)
			prior.FailureKind = nil // Historical untyped failures retain eligibility.
			switch mode {
			case "todo":
				dispatch.TaskID, dispatch.TaskReplanSource, dispatch.WorkspaceReservations = nil, nil, nil
				dispatch.TodoID, dispatch.SourceMessageID = ptr("todo"), ptr("message")
			case "legacy":
				dispatch.TaskReplanSource, dispatch.WorkspaceReservations = nil, nil
			case "other-task-phase":
				dispatch.TaskReplanSource = nil
			case "missing-result":
				prior = nil
			case "hard-failure":
				kind := protocol.InvalidFinalization
				prior.FailureKind = &kind
			}
			retainRecovery(t, db, dispatch, op, prior)
			var effects atomic.Int32
			d := Daemon{DB: db, Control: &control.Client{}, Boot: "boot", Host: functionSupervisor(func(_ context.Context, r host.Request) (host.Status, error) {
				if r.Action == "effect" {
					effects.Add(1)
					return host.Status{}, errors.New("still temporarily unavailable")
				}
				return host.Status{Known: true, BootID: "boot"}, nil
			})}
			for round := int32(1); round <= 2; round++ {
				ctx, cancel := recoveryContext(t, &d)
				inventory := recoveryInventory(dispatch, op)
				inventory.Operations = append(inventory.Operations, op)
				if err := d.Reconcile(ctx, inventory); err != nil {
					t.Fatal(err)
				}
				// An in-flight delivery retains the ordinary effect key even if
				// its old connection has ended; recovery must retain that tail.
				key := "effect:" + op.OperationID
				d.queueMu.Lock()
				d.queued = map[string]bool{key: true}
				d.queueMu.Unlock()
				d.ConnectionReady(ctx)
				d.workers.Wait()
				d.queueMu.Lock()
				pending := len(d.recovery.operations)
				delete(d.queued, key)
				d.drainRecoveryLocked()
				d.queueMu.Unlock()
				d.workers.Wait()
				d.ConnectionReady(ctx)
				d.workers.Wait()
				want := int32(0)
				if mode == "initial" {
					want = round
					if pending != 1 {
						t.Fatal("Replan Planner Stop used a different key or lost its pending tail", pending)
					}
				}
				if effects.Load() != want {
					t.Fatal("recovery expanded to another phase or repeated within a snapshot", effects.Load(), want)
				}
				cancel()
			}
		})
	}
}
