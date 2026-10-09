package control

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coder/websocket"
	protocol "monos.local/protocol"
)

type connectionHandler struct {
	frames chan context.Context
}

func (*connectionHandler) Reconcile(context.Context, protocol.RunnerInventory) error { return nil }
func (h *connectionHandler) Frame(ctx context.Context, _ protocol.Frame)             { h.frames <- ctx }
func (*connectionHandler) Tick(context.Context)                                      {}

func TestDisconnectedChannelCancelsQueuedWorkWithoutStoppingRunner(t *testing.T) {
	for _, secure := range []bool{false, true} {
		name := "http_ws"
		if secure {
			name = "https_wss"
		}
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			handler := &connectionHandler{frames: make(chan context.Context, 1)}
			server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer private-runner-test-token" {
					t.Error("Runner connection or inventory lost its credential")
				}
				if r.URL.Path == "/v1/runner/inventory" {
					_ = json.NewEncoder(w).Encode(protocol.RunnerInventory{SchemaVersion: 1, SnapshotID: snapshotA, Dispatches: []protocol.Dispatch{}, Operations: []protocol.Operation{}})
					return
				}
				if r.URL.Path != "/v1/runner" {
					t.Error("wrong Runner WebSocket path")
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
				if _, _, err = conn.Read(ctx); err != nil {
					t.Error(err)
					return
				}
				dispatch := inventoryDispatch()
				start, _ := json.Marshal(protocol.Frame{SchemaVersion: 1, Type: protocol.Start, Dispatch: &dispatch, Incarnation: &incarnation})
				if err = conn.Write(ctx, websocket.MessageText, start); err != nil {
					t.Error(err)
				}
			}))
			var ca []byte
			if secure {
				server.StartTLS()
				ca = certificatePEM(server)
			} else {
				server.Start()
			}
			defer server.Close()
			client := configuredClient(t, server.URL, ca)
			if err := client.Run(ctx, "boot", handler); err == nil {
				t.Fatal("disconnected channel reported success")
			}
			if ctx.Err() != nil {
				t.Fatal("connection loss cancelled the Runner or timed out")
			}
			select {
			case frameCtx := <-handler.frames:
				if frameCtx.Err() != context.Canceled {
					t.Fatal("queued Start still has authority to run after its connection closed")
				}
			default:
				t.Fatal("Start was not delivered before channel closure")
			}
		})
	}
}
