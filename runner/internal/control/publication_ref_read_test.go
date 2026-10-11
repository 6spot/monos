package control

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/coder/websocket"
	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

type publicationRefConnectionHandler struct {
	client      *Client
	observation protocol.PublicationRefObservation
	contexts    chan context.Context
}

func (*publicationRefConnectionHandler) Reconcile(context.Context, protocol.RunnerInventory) error {
	return nil
}
func (*publicationRefConnectionHandler) Tick(context.Context) {}
func (*publicationRefConnectionHandler) InstalledRuntimes(context.Context) []protocol.RuntimeInstallation {
	return nil
}
func (h *publicationRefConnectionHandler) Frame(ctx context.Context, f protocol.Frame) {
	if f.PublicationRefRead == nil {
		return
	}
	h.contexts <- ctx
	result := protocol.PublicationRefReadResponse{SchemaVersion: 1, Request: *f.PublicationRefRead, WorkerAbsent: true, Observation: h.observation, ObservationDigest: publicationTestDigestControl(h.observation)}
	_ = h.client.Send(ctx, protocol.Frame{Type: "publication_ref_read_result", CorrelationID: f.CorrelationID, PublicationRefReadResult: &result})
}

func TestPublicationRefReadConnectionCorrelationIncarnationAndCancellation(t *testing.T) {
	raw, e := os.ReadFile("../../../packages/protocol/fixtures/remote-preparation.json")
	if e != nil {
		t.Fatal(e)
	}
	var fixture struct {
		Push   protocol.PublicationPushRequest `json:"push"`
		Result protocol.PublicationPushResult  `json:"push_result"`
	}
	if e = json.Unmarshal(raw, &fixture); e != nil {
		t.Fatal(e)
	}
	r := protocol.PublicationRefReadRequest{SchemaVersion: 1, RequestID: "fresh-ref", Push: fixture.Push, PushRequestDigest: publicationTestDigestControl(fixture.Push)}
	for _, stale := range []bool{false, true} {
		t.Run(map[bool]string{false: "current", true: "stale"}[stale], func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			h := &publicationRefConnectionHandler{observation: fixture.Result.Observation, contexts: make(chan context.Context, 1)}
			h.client = inventoryClient(t, func(w http.ResponseWriter, req *http.Request) {
				if req.URL.Path == "/v1/runner/inventory" {
					_ = json.NewEncoder(w).Encode(protocol.RunnerInventory{SchemaVersion: 1, SnapshotID: snapshotA, Dispatches: []protocol.Dispatch{}, Operations: []protocol.Operation{}})
					return
				}
				conn, e := websocket.Accept(w, req, nil)
				if e != nil {
					t.Error(e)
					return
				}
				defer conn.CloseNow()
				if _, _, e = conn.Read(ctx); e != nil {
					t.Error(e)
					return
				}
				inc, runner := int64(7), "runner"
				send := func(frame protocol.Frame) bool {
					raw, _ := json.Marshal(frame)
					return conn.Write(ctx, websocket.MessageText, raw) == nil
				}
				if !send(protocol.Frame{SchemaVersion: 1, Type: protocol.Welcome, RunnerID: &runner, Incarnation: &inc}) {
					return
				}
				_, raw, e := conn.Read(ctx)
				var ready protocol.Frame
				if e != nil || wire.Decode("Frame", raw, &ready) != nil || len(ready.PublicationRefReadModes) != 1 || ready.PublicationRefReadModes[0] != protocol.GitRefV1 {
					t.Error("ref read capability missing")
					return
				}
				requestInc, correlation := inc, "fresh-correlation"
				if stale {
					requestInc--
				}
				if !send(protocol.Frame{SchemaVersion: 1, Type: "publication_ref_read", Incarnation: &requestInc, CorrelationID: &correlation, PublicationRefRead: &r}) {
					return
				}
				_, raw, e = conn.Read(ctx)
				if stale {
					return
				}
				var response protocol.Frame
				if e != nil || wire.Decode("Frame", raw, &response) != nil || response.Incarnation == nil || *response.Incarnation != inc || response.CorrelationID == nil || *response.CorrelationID != correlation || response.PublicationRefReadResult == nil || publicationTestDigestControl(response.PublicationRefReadResult.Request) != publicationTestDigestControl(r) {
					t.Error("fresh response lost correlation or original request")
				}
			})
			if e := h.client.Run(ctx, "boot", h); e == nil || ctx.Err() != nil {
				t.Fatal("ref channel did not close promptly", e)
			}
			select {
			case scope := <-h.contexts:
				if stale || scope.Err() != context.Canceled {
					t.Fatal("stale read or surviving connection scope")
				}
			default:
				if !stale {
					t.Fatal("current ref read not routed")
				}
			}
		})
	}
}
