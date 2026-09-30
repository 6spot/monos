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
	"monos.local/runner/internal/journal"
)

func conversationRecoveryFixture(t *testing.T) (protocol.Dispatch, protocol.Operation) {
	d, op := planningRecoveryFixture(t)
	d.TaskPlanningSource = nil
	d.ControlVersion = 7
	d.SourceWatermark = 3
	d.TaskConversationSource = &protocol.TaskConversationSource{SourceID: "source", InputID: "input", ConversationVersion: 7, SourceWatermark: 3, ContextDigest: strings.Repeat("a", 64)}
	return d, op
}

func TestTaskConversationStopRecoveryWaitsForReadyAndReplaysTerminalWithoutHost(t *testing.T) {
	db := testDB(t)
	dispatch, op := conversationRecoveryFixture(t)
	retainRecovery(t, db, dispatch, op, nil)
	var effects, stops atomic.Int32
	d := Daemon{DB: db, Control: &control.Client{}, Boot: "boot", Host: functionSupervisor(func(_ context.Context, r host.Request) (host.Status, error) {
		switch r.Action {
		case "effect":
			if !reflect.DeepEqual(r.Operation, &op) {
				t.Error("conversation recovery changed original Stop")
			}
			if effects.Add(1) == 1 {
				return host.Status{}, errors.New("temporary systemctl failure")
			}
		case "status":
			return host.Status{Known: true, BootID: "boot", Populated: stops.Load() == 0}, nil
		case "stop":
			stops.Add(1)
		}
		return host.Status{Known: true, BootID: "boot"}, nil
	})}
	ctx, _ := recoveryContext(t, &d)
	_ = d.effect(ctx, op)
	failed, err := db.Effect(op.OperationID)
	if err != nil || failed == nil || failed.Success || failed.FailureKind == nil || *failed.FailureKind != protocol.Recoverable {
		t.Fatal("Stop failure not retained", failed, err)
	}
	if err = d.Reconcile(ctx, recoveryInventory(dispatch, op)); err != nil {
		t.Fatal(err)
	}
	if stops.Load() != 1 || effects.Load() != 1 {
		t.Fatal("conversation Stop replayed before Ready or old process not stopped")
	}
	d.ConnectionReady(ctx)
	d.workers.Wait()
	settled, err := db.Effect(op.OperationID)
	if err != nil || settled == nil || !settled.Success || settled.Result.WriterAbsent == nil || !*settled.Result.WriterAbsent || effects.Load() != 2 {
		t.Fatal("conversation original Stop did not settle", settled, err)
	}
	d.ConnectionReady(ctx)
	d.workers.Wait()
	_ = d.effect(ctx, op)
	if effects.Load() != 2 {
		t.Fatal("terminal conversation Stop called Host again")
	}
}

func TestConversationRecoveryRejectsChangedSourceScopeAndQueueAuthority(t *testing.T) {
	for _, mode := range []string{"source", "input", "watermark", "epoch", "reply-only", "context", "task", "outer-watermark", "outer-version", "request", "resource", "mutable", "released", "queued-source"} {
		t.Run(mode, func(t *testing.T) {
			db := testDB(t)
			dispatch, op := conversationRecoveryFixture(t)
			prior := recoveryFailure(op)
			retainRecovery(t, db, dispatch, op, prior)
			var changed protocol.Dispatch
			raw, _ := json.Marshal(dispatch)
			_ = json.Unmarshal(raw, &changed)
			switch mode {
			case "source", "queued-source":
				changed.TaskConversationSource.SourceID = "other"
			case "input":
				changed.TaskConversationSource.InputID = "other"
			case "watermark":
				changed.TaskConversationSource.SourceWatermark++
			case "epoch":
				changed.TaskConversationSource.ConversationVersion++
			case "reply-only":
				changed.TaskConversationSource.ReplyOnly = true
			case "context":
				changed.TaskConversationSource.ContextDigest = strings.Repeat("b", 64)
			case "task":
				changed.TaskID = ptr("other-task")
			case "outer-watermark":
				changed.SourceWatermark++
			case "outer-version":
				changed.ControlVersion++
			case "request":
				op.RequestID = "other"
			case "resource":
				op.ResourceID = ptr("fixture")
			case "mutable":
				changed.MutationAllowed = true
			case "released":
				changed.ProcessReleased = true
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
				t.Fatal("changed conversation recovery authority accepted")
			}
			d.ConnectionReady(ctx)
			d.workers.Wait()
			after, _ := db.Effect(op.OperationID)
			if effects.Load() != 0 || !reflect.DeepEqual(after, prior) {
				t.Fatal("changed source reached physical recovery")
			}
		})
	}
}

func TestConversationRecoveryKeepsFiniteFlightKeyAndFailureEvidence(t *testing.T) {
	for _, mode := range []string{"recoverable", "untyped", "missing", "hard", "terminal"} {
		t.Run(mode, func(t *testing.T) {
			db := testDB(t)
			dispatch, op := conversationRecoveryFixture(t)
			prior := recoveryFailure(op)
			switch mode {
			case "untyped":
				prior.FailureKind = nil
			case "missing":
				prior = nil
			case "hard":
				kind := protocol.InvalidFinalization
				prior.FailureKind = &kind
			case "terminal":
				prior = &protocol.OperationResult{AttemptID: op.AttemptID, OperationID: op.OperationID, Success: true, Result: protocol.EffectResult{WriterAbsent: nodeBool(true)}}
			}
			retainRecovery(t, db, dispatch, op, prior)
			var effects atomic.Int32
			d := Daemon{DB: db, Control: &control.Client{}, Boot: "boot", Host: functionSupervisor(func(_ context.Context, r host.Request) (host.Status, error) {
				if r.Action == "effect" {
					effects.Add(1)
					return host.Status{}, errors.New("still unavailable")
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
				if mode == "recoverable" || mode == "untyped" {
					want = round
					if pending != 1 {
						t.Fatal("conversation Stop lost its occupied normal key", pending)
					}
				}
				if effects.Load() != want {
					t.Fatal("hard/missing/terminal recovery ran Host or snapshot repeated", effects.Load(), want)
				}
				cancel()
			}
		})
	}
}
