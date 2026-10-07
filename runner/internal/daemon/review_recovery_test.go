package daemon

import (
	"context"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/control"
	"monos.local/runner/internal/host"
)

func reviewRecoveryFixture(t *testing.T) (protocol.Dispatch, protocol.Operation) {
	d, op := replanRecoveryFixture(t)
	d.TaskReplanSource = nil
	d.TaskReviewSource = &protocol.TaskReviewSource{FeedbackID: "feedback", OperationID: "review-operation", OperationVersion: 2, SourceID: "source", PlanID: "plan", SpecificationID: "spec", ControlVersion: d.ControlVersion, ContextDigest: strings.Repeat("a", 64), ReviewResultDigest: strings.Repeat("b", 64), Purpose: "route_feedback"}
	return d, op
}

func TestReviewStopRecoveryRequiresExactRetainedSourceAndReady(t *testing.T) {
	for _, mode := range []string{"same", "feedback", "operation", "version", "result", "purpose", "mutation", "released"} {
		t.Run(mode, func(t *testing.T) {
			db := testDB(t)
			dispatch, op := reviewRecoveryFixture(t)
			prior := recoveryFailure(op)
			retainRecovery(t, db, dispatch, op, prior)
			changed, _ := reviewRecoveryFixture(t)
			switch mode {
			case "feedback":
				changed.TaskReviewSource.FeedbackID = "other"
			case "operation":
				changed.TaskReviewSource.OperationID = "other"
			case "version":
				changed.TaskReviewSource.OperationVersion++
			case "result":
				changed.TaskReviewSource.ReviewResultDigest = strings.Repeat("c", 64)
			case "purpose":
				changed.TaskReviewSource.Purpose = "reconsider_input"
				input, id := "input", "reconsider"
				changed.TaskReviewSource.InputID = &input
				changed.TaskReviewSource.ReconsiderationID = &id
			case "mutation":
				changed.MutationAllowed = true
			case "released":
				changed.ProcessReleased = true
			}
			var effects atomic.Int32
			d := Daemon{DB: db, Control: &control.Client{}, Boot: "boot", Host: functionSupervisor(func(_ context.Context, r host.Request) (host.Status, error) {
				if r.Action == "effect" {
					effects.Add(1)
					if !reflect.DeepEqual(r.Operation, &op) {
						t.Error("replaced original Stop")
					}
				}
				return host.Status{Known: true, BootID: "boot"}, nil
			})}
			ctx, _ := recoveryContext(t, &d)
			err := d.Reconcile(ctx, recoveryInventory(changed, op))
			if mode != "same" {
				if err == nil {
					t.Fatal("changed review recovery accepted")
				}
				d.ConnectionReady(ctx)
				d.workers.Wait()
				if effects.Load() != 0 {
					t.Fatal("changed authority reached Host")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if effects.Load() != 0 {
				t.Fatal("Stop replay before Ready")
			}
			d.ConnectionReady(ctx)
			d.workers.Wait()
			after, err := db.Effect(op.OperationID)
			if err != nil || after == nil || !after.Success || effects.Load() != 1 {
				t.Fatal("original Stop not settled", after, err)
			}
			d.ConnectionReady(ctx)
			d.workers.Wait()
			if effects.Load() != 1 {
				t.Fatal("same connection repeated Stop")
			}
		})
	}
}
