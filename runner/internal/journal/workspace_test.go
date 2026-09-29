package journal

import (
	"encoding/json"
	"testing"

	protocol "monos.local/protocol"
)

func TestWorkspaceDescriptorAndCancelledResultRemainExact(t *testing.T) {
	db := openTest(t)
	op := protocol.Operation{SchemaVersion: 1, OperationID: "open", AttemptID: "attempt", DispatchID: "dispatch", RequestID: "request", Kind: protocol.KindOpenWorkspace, Workspace: &protocol.WorkspaceDescriptor{WorkspaceID: "workspace", LeaseID: "lease"}, WorkspaceDigest: testString("digest")}
	if err := db.BeginEffect(op); err != nil {
		t.Fatal(err)
	}
	var changed protocol.Operation
	raw, _ := json.Marshal(op)
	_ = json.Unmarshal(raw, &changed)
	changed.Workspace.LeaseID = "replacement"
	if err := db.BeginEffect(changed); err != ErrConflict {
		t.Fatal("lease descriptor changed", err)
	}
	stop := "stop"
	absent := true
	result := protocol.OperationResult{OperationID: "open", AttemptID: "attempt", CancelledByOperationID: &stop, Result: protocol.EffectResult{WriterAbsent: &absent}}
	if err := db.FinishEffect(result); err != nil {
		t.Fatal(err)
	}
	if err := db.FinishEffect(result); err != nil {
		t.Fatal("exact terminal replay failed", err)
	}
	result.CancelledByOperationID = nil
	result.Success = true
	if err := db.FinishEffect(result); err != ErrConflict {
		t.Fatal("cancellation replaced by late open success", err)
	}
	retained, err := db.Effect("open")
	if err != nil || retained.CancelledByOperationID == nil || retained.Success {
		t.Fatal("terminal cancellation lost", err)
	}
}
