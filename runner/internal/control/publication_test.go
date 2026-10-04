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
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/wire"
)

type publicationConnectionHandler struct {
	client *Client
	ctx    chan context.Context
	ack    chan protocol.PublicationACK
	t      *testing.T
}

func (*publicationConnectionHandler) Reconcile(context.Context, protocol.RunnerInventory) error {
	return nil
}
func (*publicationConnectionHandler) Tick(context.Context) {}
func (*publicationConnectionHandler) InstalledRuntimes(context.Context) []protocol.RuntimeInstallation {
	return nil
}
func (h *publicationConnectionHandler) Frame(ctx context.Context, f protocol.Frame) {
	if f.PublicationPrepare != nil {
		h.ctx <- ctx
		pages := host.PublicationFailure(*f.PublicationPrepare, "unavailable", "retained_unavailable")
		for _, page := range pages {
			copy := page
			if e := h.client.Send(ctx, protocol.Frame{Type: "publication_result", PublicationResult: &copy}); e != nil {
				h.t.Error(e)
			}
		}
	} else if f.PublicationACK != nil {
		h.ack <- *f.PublicationACK
	} else {
		h.t.Error("unexpected publication frame")
	}
}
func TestPublicationConnectionCapabilityStableDigestAckAndIncarnation(t *testing.T) {
	raw, e := os.ReadFile("../../../packages/protocol/fixtures/publication.json")
	if e != nil {
		t.Fatal(e)
	}
	var fixture struct {
		Request protocol.PublicationPrepareRequest `json:"request"`
	}
	if json.Unmarshal(raw, &fixture) != nil {
		t.Fatal("publication fixture unavailable")
	}
	_, requestDigest, e := wire.Canonical(fixture.Request)
	if e != nil {
		t.Fatal(e)
	}
	for _, stale := range []bool{false, true} {
		t.Run(map[bool]string{false: "current", true: "stale"}[stale], func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			h := &publicationConnectionHandler{ctx: make(chan context.Context, 1), ack: make(chan protocol.PublicationACK, 1), t: t}
			h.client = inventoryClient(t, func(w http.ResponseWriter, req *http.Request) {
				if req.URL.Path == "/v1/runner/inventory" {
					_ = json.NewEncoder(w).Encode(protocol.RunnerInventory{SchemaVersion: 1, SnapshotID: snapshotA, Dispatches: []protocol.Dispatch{}, Operations: []protocol.Operation{}})
					return
				}
				if req.Header.Get("Authorization") != "Bearer private-test" {
					t.Error("missing fixture authentication")
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
				inc := int64(7)
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
				if wire.Decode("Frame", b, &ready) != nil || len(ready.PublicationModes) != 1 || ready.PublicationModes[0] != protocol.LocalCandidateV1 {
					t.Error("publication capability not negotiated")
					return
				}
				sendInc := inc
				if stale {
					sendInc--
				}
				b, _ = json.Marshal(protocol.Frame{SchemaVersion: 1, Type: "publication_prepare", Incarnation: &sendInc, PublicationPrepare: &fixture.Request})
				if e = c.Write(ctx, websocket.MessageText, b); e != nil {
					t.Error(e)
					return
				}
				if stale {
					_, _, _ = c.Read(ctx)
					return
				}
				_, b, e = c.Read(ctx)
				if e != nil {
					t.Error(e)
					return
				}
				var result protocol.Frame
				if wire.Decode("Frame", b, &result) != nil || result.PublicationResult == nil || result.Incarnation == nil || *result.Incarnation != inc || result.PublicationResult.Result.RequestDigest != requestDigest {
					t.Error("stable operation digest/incarnation changed")
					return
				}
				_, rd, _ := wire.Canonical(result.PublicationResult.Result)
				ack := protocol.PublicationACK{SchemaVersion: 1, OperationID: fixture.Request.OperationID, RequestDigest: requestDigest, ResultDigest: rd}
				b, _ = json.Marshal(protocol.Frame{SchemaVersion: 1, Type: "publication_ack", Incarnation: &inc, PublicationACK: &ack})
				if e = c.Write(ctx, websocket.MessageText, b); e != nil {
					t.Error(e)
					return
				}
				select {
				case got := <-h.ack:
					if got != ack {
						t.Error("ack identity changed")
					}
				case <-ctx.Done():
					t.Error("publication ack not routed")
				}
			})
			if e = h.client.Run(ctx, "boot", h); e == nil {
				t.Fatal("closed connection succeeded")
			}
			if ctx.Err() != nil {
				t.Fatal("publication blocked transport")
			}
			select {
			case workCtx := <-h.ctx:
				if stale {
					t.Fatal("old incarnation dispatched")
				}
				if workCtx.Err() != context.Canceled {
					t.Fatal("disconnect did not cancel publication scope")
				}
			default:
				if !stale {
					t.Fatal("current publication was not dispatched")
				}
			}
		})
	}
}
