package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	protocol "monos.local/protocol"
	"monos.local/runner/internal/control"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/journal"
	"monos.local/runner/internal/wire"
)

func recoveryFixture(t *testing.T, suffix string, kind protocol.OperationKind) (protocol.Dispatch, protocol.Operation) {
	t.Helper()
	task, resource := "task-"+suffix, "resource-"+suffix
	id, err := host.TaskWorkspaceID(task, resource)
	if err != nil {
		t.Fatal(err)
	}
	dispatch := protocol.Dispatch{AttemptID: "attempt-" + suffix, DispatchID: "dispatch-" + suffix, RunnerID: "runner", TaskID: &task, Kind: protocol.Node, NodeID: ptr("node-" + suffix), NodeActivation: 1, RuntimeID: protocol.Opencode, Model: "opencode/longcat-2.5-preview-free", Prompt: "test", WorkspaceReservations: &protocol.WorkspaceReservations{ProjectID: "project", ConfigurationVersion: 1, Resources: []protocol.WorkspaceReservation{{ResourceID: resource, WorkspaceID: id}}}}
	w := protocol.WorkspaceDescriptor{SchemaVersion: 1, WorkspaceID: id, TaskID: task, ResourceID: resource, ProjectID: "project", RunnerID: "runner", NodeID: *dispatch.NodeID, NodeActivation: 1, LeaseID: "lease-" + suffix, Generation: 1, OpenOperationID: "open-" + suffix, Resource: protocol.WorkspaceResource{ResourceID: resource, RepositoryIdentity: "github.com/example/repository", RemoteURL: "https://github.com/example/repository.git"}}
	_, digest, err := wire.Canonical(w)
	if err != nil {
		t.Fatal(err)
	}
	id = "operation-" + suffix
	if kind == protocol.KindOpenWorkspace {
		id = w.OpenOperationID
	}
	op := protocol.Operation{SchemaVersion: 1, OperationID: id, RequestID: "request-" + suffix, AttemptID: dispatch.AttemptID, DispatchID: dispatch.DispatchID, Kind: kind, State: protocol.PurpleRecovery, Workspace: &w, WorkspaceDigest: &digest, ResourceID: &resource}
	return dispatch, op
}

func retainRecovery(t *testing.T, db *journal.DB, dispatch protocol.Dispatch, op protocol.Operation, result *protocol.OperationResult) {
	t.Helper()
	if err := db.SaveStart(journal.Start{Dispatch: dispatch, Phase: "absent", BootID: "boot"}); err != nil {
		t.Fatal(err)
	}
	admitted := op
	admitted.State = protocol.FluffyAdmitted
	if err := db.BeginEffect(admitted); err != nil {
		t.Fatal(err)
	}
	if result != nil {
		if err := db.FinishEffect(*result); err != nil {
			t.Fatal(err)
		}
	}
}

func recoveryFailure(op protocol.Operation) *protocol.OperationResult {
	kind := protocol.Recoverable
	return &protocol.OperationResult{OperationID: op.OperationID, AttemptID: op.AttemptID, FailureKind: &kind, Result: protocol.EffectResult{Message: ptr("retained failure")}}
}

func recoveryInventory(dispatch protocol.Dispatch, op protocol.Operation) protocol.RunnerInventory {
	return protocol.RunnerInventory{SchemaVersion: 1, SnapshotID: strings.Repeat("a", 32), Dispatches: []protocol.Dispatch{dispatch}, Operations: []protocol.Operation{op}}
}

func recoveryContext(t *testing.T, d *Daemon) (context.Context, context.CancelFunc) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(func() { cancel(); d.workers.Wait() })
	return ctx, cancel
}

func TestReconnectRecoveryWaitsForReadyAndPreservesOriginalOperation(t *testing.T) {
	db := testDB(t)
	dispatch, op := recoveryFixture(t, "ready", protocol.Stop)
	prior := recoveryFailure(op)
	retainRecovery(t, db, dispatch, op, prior)
	var calls atomic.Int32
	d := Daemon{DB: db, Control: &control.Client{}, Boot: "boot", Host: functionSupervisor(func(_ context.Context, r host.Request) (host.Status, error) {
		if r.Action == "effect" {
			calls.Add(1)
			if !reflect.DeepEqual(r.Operation, &op) {
				t.Error("recovery replaced the original operation", r.Operation)
			}
		}
		return host.Status{Known: true, BootID: "boot"}, nil
	})}
	ctx, _ := recoveryContext(t, &d)
	inventory := recoveryInventory(dispatch, op)
	inventory.Operations = append(inventory.Operations, op) // an exact duplicate is one job
	if err := d.Reconcile(ctx, inventory); err != nil {
		t.Fatal(err)
	}
	before, _ := db.Effect(op.OperationID)
	if calls.Load() != 0 || !reflect.DeepEqual(before, prior) {
		t.Fatal("reconciliation started work before Ready")
	}
	d.ConnectionReady(ctx)
	d.workers.Wait()
	result, err := db.Effect(op.OperationID)
	if err != nil || result == nil || !result.Success || calls.Load() != 1 {
		t.Fatal("original Stop did not settle once", result, calls.Load(), err)
	}
	d.ConnectionReady(ctx)
	d.workers.Wait()
	if calls.Load() != 1 {
		t.Fatal("same connection replayed physical recovery")
	}
}

func TestReconnectFailureIsFiniteAndRetriedOnlyByNewSnapshot(t *testing.T) {
	for _, kind := range []protocol.OperationKind{protocol.KindOpenWorkspace, protocol.KindCompleteNode} {
		t.Run(string(kind), func(t *testing.T) {
			db := testDB(t)
			dispatch, op := recoveryFixture(t, "failure", kind)
			prior := recoveryFailure(op)
			prior.FailureKind = nil // retained older untyped failures are recoverable
			retainRecovery(t, db, dispatch, op, prior)
			var calls atomic.Int32
			d := Daemon{DB: db, Control: &control.Client{}, Boot: "boot", Host: functionSupervisor(func(_ context.Context, r host.Request) (host.Status, error) {
				if r.Action == "effect" {
					calls.Add(1)
					return host.Status{}, errors.New("storage remains unavailable")
				}
				return host.Status{Known: true, BootID: "boot"}, nil
			})}
			for round := int32(1); round <= 2; round++ {
				ctx, cancel := recoveryContext(t, &d)
				if err := d.Reconcile(ctx, recoveryInventory(dispatch, op)); err != nil {
					t.Fatal(err)
				}
				d.ConnectionReady(ctx)
				d.workers.Wait()
				d.ConnectionReady(ctx)
				d.workers.Wait()
				result, err := db.Effect(op.OperationID)
				if err != nil || result == nil || result.Success || result.FailureKind == nil || *result.FailureKind != protocol.Recoverable || calls.Load() != round {
					t.Fatal("failure lost or retried within one snapshot", result, calls.Load(), err)
				}
				cancel()
			}
		})
	}
}

func TestReconnectSkipsUnadmittedTerminalHardAndMissingEvidence(t *testing.T) {
	for _, mode := range []string{"admitted", "succeeded", "cancelled", "legacy", "capture_hard_limit", "invalid_finalization", "missing-result", "missing-journal"} {
		t.Run(mode, func(t *testing.T) {
			db := testDB(t)
			dispatch, op := recoveryFixture(t, "excluded", protocol.KindCompleteNode)
			result := recoveryFailure(op)
			switch mode {
			case "admitted", "succeeded", "cancelled":
				op.State = protocol.OpenStateEnum(mode)
			case "legacy":
				op.Workspace, op.WorkspaceDigest = nil, nil
			case "capture_hard_limit", "invalid_finalization":
				kind := protocol.FailureKind(mode)
				result.FailureKind = &kind
			case "missing-result", "missing-journal":
				result = nil
			}
			if mode == "missing-journal" {
				if err := db.SaveStart(journal.Start{Dispatch: dispatch, Phase: "absent", BootID: "boot"}); err != nil {
					t.Fatal(err)
				}
			} else {
				retainRecovery(t, db, dispatch, op, result)
			}
			var effects atomic.Int32
			d := Daemon{DB: db, Control: &control.Client{}, Boot: "boot", Host: functionSupervisor(func(_ context.Context, r host.Request) (host.Status, error) {
				if r.Action == "effect" {
					effects.Add(1)
				}
				return host.Status{Known: true, BootID: "boot"}, nil
			})}
			ctx, _ := recoveryContext(t, &d)
			if err := d.Reconcile(ctx, recoveryInventory(dispatch, op)); err != nil {
				t.Fatal(err)
			}
			d.ConnectionReady(ctx)
			d.workers.Wait()
			after, _ := db.Effect(op.OperationID)
			if effects.Load() != 0 || !reflect.DeepEqual(after, result) {
				t.Fatal("excluded recovery was changed", effects.Load(), after)
			}
		})
	}
}

func TestReconnectRejectsPartialOrChangedRecoveryAuthority(t *testing.T) {
	for _, mode := range []string{"partial", "request", "lease", "dispatch", "reservation", "result-scope", "missing-dispatch", "conflicting-duplicate"} {
		t.Run(mode, func(t *testing.T) {
			db := testDB(t)
			dispatch, op := recoveryFixture(t, "scope", protocol.Stop)
			result := recoveryFailure(op)
			if mode == "result-scope" {
				if err := db.BeginEffect(op); err != nil {
					t.Fatal(err)
				}
				result.AttemptID = "other-attempt"
				if err := db.FinishEffect(*result); err == nil {
					t.Fatal("changed result scope entered journal")
				}
				return
			}
			retainRecovery(t, db, dispatch, op, result)
			inventory := recoveryInventory(dispatch, op)
			switch mode {
			case "partial":
				inventory.NextCursor = ptr("next")
			case "request":
				inventory.Operations[0].RequestID = "changed-request"
			case "lease":
				w := *op.Workspace
				w.LeaseID = "changed-lease"
				_, digest, _ := wire.Canonical(w)
				inventory.Operations[0].Workspace, inventory.Operations[0].WorkspaceDigest = &w, &digest
			case "dispatch":
				inventory.Operations[0].DispatchID = "changed-dispatch"
			case "reservation":
				inventory.Dispatches[0].WorkspaceReservations = &protocol.WorkspaceReservations{ProjectID: "project"}
			case "missing-dispatch":
				inventory.Dispatches = nil
			case "conflicting-duplicate":
				other := op
				other.RequestID = "changed-request"
				inventory.Operations = append(inventory.Operations, other)
			}
			var effects atomic.Int32
			d := Daemon{DB: db, Control: &control.Client{}, Boot: "boot", Host: functionSupervisor(func(_ context.Context, r host.Request) (host.Status, error) {
				if r.Action == "effect" {
					effects.Add(1)
				}
				return host.Status{Known: true, BootID: "boot"}, nil
			})}
			ctx, _ := recoveryContext(t, &d)
			if err := d.Reconcile(ctx, inventory); err == nil {
				t.Fatal("changed or incomplete recovery authority accepted")
			}
			d.ConnectionReady(ctx)
			d.workers.Wait()
			if effects.Load() != 0 {
				t.Fatal("rejected inventory reached physical recovery")
			}
		})
	}
}

func TestReconnectOverflowDrainsThroughExistingBoundedQueue(t *testing.T) {
	db := testDB(t)
	inventory := protocol.RunnerInventory{}
	const count = 70
	for i := 0; i < count; i++ {
		dispatch, op := recoveryFixture(t, fmt.Sprint(i), protocol.Stop)
		retainRecovery(t, db, dispatch, op, recoveryFailure(op))
		inventory.Dispatches = append(inventory.Dispatches, dispatch)
		inventory.Operations = append(inventory.Operations, op)
	}
	gate, entered := make(chan struct{}), make(chan string, count)
	d := Daemon{DB: db, Control: &control.Client{}, Boot: "boot", Host: functionSupervisor(func(ctx context.Context, r host.Request) (host.Status, error) {
		if r.Action == "effect" {
			entered <- r.Operation.OperationID
			select {
			case <-gate:
			case <-ctx.Done():
				return host.Status{}, ctx.Err()
			}
		}
		return host.Status{Known: true, BootID: "boot"}, nil
	})}
	ctx, _ := recoveryContext(t, &d)
	if err := d.Reconcile(ctx, inventory); err != nil {
		t.Fatal(err)
	}
	d.ConnectionReady(ctx)
	d.queueMu.Lock()
	active, pending := len(d.queued), len(d.recovery.operations)
	d.queueMu.Unlock()
	if active != 64 || pending != count-64 {
		t.Fatal("queue overflow was dropped or exceeded its bound", active, pending)
	}
	for _, op := range inventory.Operations[:64] {
		d.Frame(ctx, protocol.Frame{Type: protocol.Effect, Operation: &op})
	}
	close(gate)
	d.workers.Wait()
	close(entered)
	seen := map[string]bool{}
	for id := range entered {
		if seen[id] {
			t.Fatal("duplicate physical recovery", id)
		}
		seen[id] = true
	}
	if len(seen) != count {
		t.Fatal("overflow tail never executed", len(seen))
	}
}

func TestReconnectWaitsForOldKeyAndRechecksItsFinalOutcome(t *testing.T) {
	for _, outcome := range []string{"recoverable", "success", "hard"} {
		t.Run(outcome, func(t *testing.T) {
			db := testDB(t)
			kind := protocol.Stop
			if outcome == "hard" {
				kind = protocol.KindCompleteNode
			}
			dispatch, op := recoveryFixture(t, "old-key", kind)
			retainRecovery(t, db, dispatch, op, recoveryFailure(op))
			entered, release := make(chan struct{}), make(chan struct{})
			releaseGate := sync.OnceFunc(func() { close(release) })
			defer releaseGate()
			var effects atomic.Int32
			d := Daemon{DB: db, Control: &control.Client{}, Boot: "boot", Host: functionSupervisor(func(_ context.Context, r host.Request) (host.Status, error) {
				if r.Action == "effect" && effects.Add(1) == 1 {
					close(entered)
					<-release // simulates an export that finishes after connection cancellation
					if outcome == "recoverable" {
						return host.Status{}, errors.New("still unavailable")
					}
					if outcome == "hard" {
						return host.Status{}, &host.EffectError{Kind: protocol.InvalidFinalization, Cause: errors.New("retained identity changed")}
					}
				}
				return host.Status{Known: true, BootID: "boot"}, nil
			})}
			oldCtx, cancelOld := recoveryContext(t, &d)
			if err := d.Reconcile(oldCtx, recoveryInventory(dispatch, op)); err != nil {
				t.Fatal(err)
			}
			d.ConnectionReady(oldCtx)
			<-entered
			cancelOld()
			ctx, _ := recoveryContext(t, &d)
			if err := d.Reconcile(ctx, recoveryInventory(dispatch, op)); err != nil {
				t.Fatal(err)
			}
			d.ConnectionReady(oldCtx)
			d.ConnectionReady(ctx)
			d.queueMu.Lock()
			pending := len(d.recovery.operations)
			d.queueMu.Unlock()
			if pending != 1 {
				t.Fatal("old occupied key dropped the new recovery", pending)
			}
			releaseGate()
			d.workers.Wait()
			want := int32(1)
			if outcome == "recoverable" {
				want = 2
			}
			if effects.Load() != want {
				t.Fatal("waiting recovery failed to recheck the latest outcome", effects.Load(), want)
			}
		})
	}
}

func TestReconnectCancelledSnapshotCannotActivateOrEraseNextConnection(t *testing.T) {
	db := testDB(t)
	dispatch, op := recoveryFixture(t, "cancel", protocol.Stop)
	retainRecovery(t, db, dispatch, op, recoveryFailure(op))
	var effects atomic.Int32
	d := Daemon{DB: db, Control: &control.Client{}, Boot: "boot", Host: functionSupervisor(func(_ context.Context, r host.Request) (host.Status, error) {
		if r.Action == "effect" {
			effects.Add(1)
		}
		return host.Status{Known: true, BootID: "boot"}, nil
	})}
	oldCtx, cancelOld := recoveryContext(t, &d)
	if err := d.Reconcile(oldCtx, recoveryInventory(dispatch, op)); err != nil {
		t.Fatal(err)
	}
	ctx, _ := recoveryContext(t, &d)
	if err := d.Reconcile(ctx, recoveryInventory(dispatch, op)); err != nil {
		t.Fatal(err)
	}
	cancelOld()
	d.ConnectionReady(oldCtx)
	d.workers.Wait()
	if effects.Load() != 0 {
		t.Fatal("cancelled connection activated recovery")
	}
	d.ConnectionReady(ctx)
	d.workers.Wait()
	if effects.Load() != 1 {
		t.Fatal("old cancellation erased the next connection's authority")
	}
}

func TestReconnectRechecksStartScopeBeforeExecutingQueuedRecovery(t *testing.T) {
	db := testDB(t)
	dispatch, op := recoveryFixture(t, "changed-start", protocol.Stop)
	prior := recoveryFailure(op)
	retainRecovery(t, db, dispatch, op, prior)
	var effects atomic.Int32
	d := Daemon{DB: db, Control: &control.Client{}, Boot: "boot", Host: functionSupervisor(func(_ context.Context, r host.Request) (host.Status, error) {
		if r.Action == "effect" {
			effects.Add(1)
		}
		return host.Status{Known: true, BootID: "boot"}, nil
	})}
	ctx, _ := recoveryContext(t, &d)
	if err := d.Reconcile(ctx, recoveryInventory(dispatch, op)); err != nil {
		t.Fatal(err)
	}
	dispatch.NodeActivation++
	if err := db.SaveStart(journal.Start{Dispatch: dispatch, Phase: "absent", BootID: "boot"}); err != nil {
		t.Fatal(err)
	}
	d.ConnectionReady(ctx)
	d.workers.Wait()
	result, _ := db.Effect(op.OperationID)
	if effects.Load() != 0 || !reflect.DeepEqual(result, prior) {
		t.Fatal("queued recovery ignored changed Start scope")
	}
}

func TestReconnectStopStillReachesCoexistingUnexposedOpen(t *testing.T) {
	db := testDB(t)
	dispatch, open := recoveryFixture(t, "open-stop", protocol.KindOpenWorkspace)
	stop := open
	stop.OperationID, stop.RequestID, stop.Kind = "stop-open-stop", "stop-request", protocol.Stop
	retainRecovery(t, db, dispatch, open, recoveryFailure(open))
	retainRecovery(t, db, dispatch, stop, recoveryFailure(stop))
	stopped := make(chan struct{})
	d := Daemon{DB: db, Control: &control.Client{}, Boot: "boot", Host: functionSupervisor(func(ctx context.Context, r host.Request) (host.Status, error) {
		if r.Action != "effect" {
			return host.Status{Known: true, BootID: "boot"}, nil
		}
		absent := true
		if r.Operation.Kind == protocol.Stop {
			close(stopped)
			return host.Status{Known: true, Result: &protocol.EffectResult{WriterAbsent: &absent}}, nil
		}
		select {
		case <-stopped:
			return host.Status{Known: true, CancelledByOperationID: &stop.OperationID, Result: &protocol.EffectResult{WriterAbsent: &absent}}, nil
		case <-ctx.Done():
			return host.Status{}, ctx.Err()
		}
	})}
	ctx, _ := recoveryContext(t, &d)
	inventory := recoveryInventory(dispatch, open)
	inventory.Operations = append(inventory.Operations, stop)
	if err := d.Reconcile(ctx, inventory); err != nil {
		t.Fatal(err)
	}
	d.ConnectionReady(ctx)
	d.workers.Wait()
	opened, err := db.Effect(open.OperationID)
	if err != nil || opened == nil || opened.CancelledByOperationID == nil || *opened.CancelledByOperationID != stop.OperationID {
		t.Fatal("unexposed open did not reconcile through Stop", opened, err)
	}
	settled, err := db.Effect(stop.OperationID)
	if err != nil || settled == nil || !settled.Success {
		t.Fatal("coexisting open prevented Stop settlement", settled, err)
	}
}

func TestReconnectTerminalReplayFollowsReadyOnWireWithoutHostEffect(t *testing.T) {
	for _, outcome := range []string{"success", "cancelled", "initial-planning"} {
		t.Run(outcome, func(t *testing.T) {
			db := testDB(t)
			kind := protocol.KindOpenWorkspace
			if outcome == "success" {
				kind = protocol.KindCompleteNode
			}
			dispatch, op := recoveryFixture(t, "lost-result", kind)
			if outcome == "initial-planning" {
				dispatch, op = planningRecoveryFixture(t)
			}
			absent := true
			terminal := protocol.OperationResult{OperationID: op.OperationID, AttemptID: op.AttemptID, Success: outcome != "cancelled", Result: protocol.EffectResult{WriterAbsent: &absent}}
			if outcome == "cancelled" {
				terminal.CancelledByOperationID = ptr("admitted-stop")
			} else if outcome == "success" {
				terminal.Result.GitCommit, terminal.Result.GitTree = ptr(strings.Repeat("b", 40)), ptr(strings.Repeat("c", 40))
			}
			retainRecovery(t, db, dispatch, op, &terminal)
			var effects atomic.Int32
			d := Daemon{DB: db, Boot: "boot", Host: functionSupervisor(func(_ context.Context, r host.Request) (host.Status, error) {
				if r.Action == "effect" {
					effects.Add(1)
				}
				return host.Status{Known: true, BootID: "boot"}, nil
			})}
			ctx, _ := recoveryContext(t, &d)
			received := make(chan protocol.Frame, 2)
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/v1/runner/inventory" {
					_ = json.NewEncoder(w).Encode(recoveryInventory(dispatch, op))
					return
				}
				conn, err := websocket.Accept(w, r, nil)
				if err != nil {
					t.Error(err)
					return
				}
				defer conn.CloseNow()
				if _, _, err = conn.Read(ctx); err != nil {
					t.Error(err)
					return
				}
				runner, incarnation := "runner", int64(1)
				welcome, _ := json.Marshal(protocol.Frame{SchemaVersion: 1, Type: protocol.Welcome, RunnerID: &runner, Incarnation: &incarnation})
				if err = conn.Write(ctx, websocket.MessageText, welcome); err != nil {
					t.Error(err)
					return
				}
				for i := 0; i < 2; i++ {
					_, raw, err := conn.Read(ctx)
					if err != nil {
						t.Error(err)
						return
					}
					var frame protocol.Frame
					if err := json.Unmarshal(raw, &frame); err != nil {
						t.Error(err)
						return
					}
					received <- frame
				}
			}))
			defer server.Close()
			d.Control = &control.Client{Config: control.Config{Endpoint: server.URL, RunnerID: "runner"}, HTTP: server.Client()}
			_ = d.Control.Run(ctx, "boot", &d)
			d.workers.Wait()
			if len(received) != 2 {
				t.Fatal("lost terminal result was not resent after Ready")
			}
			ready, result := <-received, <-received
			if ready.Type != protocol.TypeReady || result.Type != protocol.TypeOperationResult || !reflect.DeepEqual(result.OperationResult, &terminal) || effects.Load() != 0 {
				t.Fatal("terminal replay changed bytes, preceded Ready, or repeated physical work", ready, result, effects.Load())
			}
		})
	}
}
