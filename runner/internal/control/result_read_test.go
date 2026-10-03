package control

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

type resultConnectionHandler struct {
	client *Client
	frames chan context.Context
	t      *testing.T
}

func (*resultConnectionHandler) Reconcile(context.Context, protocol.RunnerInventory) error {
	return nil
}
func (*resultConnectionHandler) Tick(context.Context) {}
func (*resultConnectionHandler) InstalledRuntimes(context.Context) []protocol.RuntimeInstallation {
	return nil
}
func (h *resultConnectionHandler) Frame(ctx context.Context, f protocol.Frame) {
	if f.Type != protocol.ResultRead || f.CorrelationID == nil || f.ResultRead == nil {
		h.t.Error("unexpected read frame", f)
		return
	}
	h.frames <- ctx
	out := protocol.ResultReadResponse{SchemaVersion: 1, Request: *f.ResultRead, Status: "busy"}
	if e := h.client.Send(ctx, protocol.Frame{Type: protocol.ResultReadResult, CorrelationID: f.CorrelationID, ResultReadResult: &out}); e != nil {
		h.t.Error(e)
	}
}
func TestResultReadConnectionCapabilityCorrelationAndCancellation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	h := &resultConnectionHandler{frames: make(chan context.Context, 1), t: t}
	i := protocol.ResultReadIdentity{TaskID: "task", OperationID: "completion", AttemptID: "attempt", DispatchID: "dispatch", NodeID: "node", SpecificationID: "spec", PlanID: "plan", WorkspaceID: "workspace", ResourceID: "repo", RunnerID: "runner", StorageID: "storage", LeaseID: "lease", NodeActivation: 1, Generation: 1, RepositoryIdentity: "repo", ManifestDigest: strings.Repeat("a", 64), OperationIdentityDigest: strings.Repeat("b", 64), BaseCommit: strings.Repeat("1", 40), GitCommit: strings.Repeat("2", 40), GitTree: strings.Repeat("3", 40)}
	_, digest, e := wire.Canonical(i)
	if e != nil {
		t.Fatal(e)
	}
	r := protocol.ResultReadRequest{Identity: i, IdentityDigest: digest, Mode: protocol.Changes}
	h.client = inventoryClient(t, func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/v1/runner/inventory" {
			_ = json.NewEncoder(w).Encode(protocol.RunnerInventory{SchemaVersion: 1, SnapshotID: snapshotA, Dispatches: []protocol.Dispatch{}, Operations: []protocol.Operation{}})
			return
		}
		if req.Header.Get("Authorization") != "Bearer private-test" {
			t.Error("missing test authentication")
		}
		c, e := websocket.Accept(w, req, nil)
		if e != nil {
			t.Error(e)
			return
		}
		defer c.CloseNow()
		if _, _, e = c.Read(ctx); e != nil {
			t.Error(e)
			return
		}
		runner := "runner"
		inc := int64(1)
		welcome, _ := json.Marshal(protocol.Frame{SchemaVersion: 1, Type: protocol.Welcome, RunnerID: &runner, Incarnation: &inc})
		if e = c.Write(ctx, websocket.MessageText, welcome); e != nil {
			t.Error(e)
			return
		}
		_, b, e := c.Read(ctx)
		if e != nil {
			t.Error(e)
			return
		}
		var ready protocol.Frame
		if e = wire.Decode("Frame", b, &ready); e != nil || ready.Type != protocol.TypeReady || len(ready.ResultReadModes) != 1 || ready.ResultReadModes[0] != protocol.GitObjectsV1 {
			t.Error("capability not advertised", ready, e)
			return
		}
		correlation := "read-correlation"
		b, _ = json.Marshal(protocol.Frame{SchemaVersion: 1, Type: protocol.ResultRead, Incarnation: &inc, CorrelationID: &correlation, ResultRead: &r})
		if e = c.Write(ctx, websocket.MessageText, b); e != nil {
			t.Error(e)
			return
		}
		_, b, e = c.Read(ctx)
		if e != nil {
			t.Error(e)
			return
		}
		var response protocol.Frame
		if e = wire.Decode("Frame", b, &response); e != nil || response.Type != protocol.ResultReadResult || response.Incarnation == nil || *response.Incarnation != inc || response.CorrelationID == nil || *response.CorrelationID != correlation || response.ResultReadResult == nil || response.ResultReadResult.Status != "busy" || response.ResultReadResult.Request.IdentityDigest != digest {
			t.Error("read correlation changed", response, e)
		}
	})
	if e := h.client.Run(ctx, "boot", h); e == nil {
		t.Fatal("closed connection falsely succeeded")
	}
	if ctx.Err() != nil {
		t.Fatal("read blocked receiver until timeout")
	}
	select {
	case readCtx := <-h.frames:
		if readCtx.Err() != context.Canceled {
			t.Fatal("disconnection did not cancel read scope")
		}
	default:
		t.Fatal("read never routed")
	}
}
