package control

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func TestRemotePreparationAccessHTTPBoundScopeAndIncarnation(t *testing.T) {
	raw, e := os.ReadFile("../../../packages/protocol/fixtures/remote-preparation.json")
	if e != nil {
		t.Fatal(e)
	}
	var f struct {
		Push   protocol.PublicationPushRequest  `json:"push"`
		Access protocol.PublicationAccessResult `json:"access"`
	}
	if json.Unmarshal(raw, &f) != nil {
		t.Fatal("shared remote fixture unavailable")
	}
	for _, kind := range []string{"valid", "scope", "attempt", "cache", "oversize", "incarnation"} {
		t.Run(kind, func(t *testing.T) {
			var client *Client
			client = inventoryClient(t, func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" || r.URL.Path != "/v1/runner/remote-preparation/"+f.Push.OperationID+"/access" || r.Header.Get("Authorization") != "Bearer private-test" || r.Header.Get("Cache-Control") != "no-store" {
					t.Error("request-bound private access endpoint changed")
				}
				var input protocol.PublicationAccessRequest
				if json.NewDecoder(r.Body).Decode(&input) != nil || input.Incarnation != 7 || input.RequestDigest != publicationTestDigestControl(f.Push) || input.Purpose != "push" || input.AttemptID != "attempt" {
					t.Error("current request context not bound")
				}
				a := f.Access
				a.AttemptID = "attempt"
				a.RequestDigest = publicationTestDigestControl(f.Push)
				switch kind {
				case "scope":
					a.ItemID = "foreign"
				case "attempt":
					a.AttemptID = "foreign"
				case "incarnation":
					client.mu.Lock()
					client.inc++
					client.mu.Unlock()
				}
				if kind != "cache" {
					w.Header().Set("Cache-Control", "no-store")
				}
				if kind == "oversize" {
					_, _ = w.Write([]byte(strings.Repeat("x", 16385)))
					return
				}
				_ = json.NewEncoder(w).Encode(a)
			})
			client.inc = 7
			client.conn = &websocket.Conn{}
			client.ready = true
			result, e := client.PublicationAccess(context.Background(), f.Push, "push", "attempt")
			if kind == "valid" {
				if e != nil || result.Authentication.Token == nil {
					t.Fatal("valid bounded access failed", e)
				}
			} else if e == nil || result.Authentication.Token != nil {
				t.Fatal("invalid access exposed a credential/context")
			}
		})
	}
	for _, kind := range []string{"spacing", "budget", "denial"} {
		t.Run("scheduling_"+kind, func(t *testing.T) {
			var requests atomic.Int64
			var first atomic.Pointer[time.Time]
			client := inventoryClient(t, func(w http.ResponseWriter, r *http.Request) {
				count := requests.Add(1)
				var input protocol.PublicationAccessRequest
				if json.NewDecoder(r.Body).Decode(&input) != nil || input.Incarnation != 7 || input.RequestDigest != publicationTestDigestControl(f.Push) || input.AttemptID != "original-attempt" {
					t.Error("scheduling retry changed original request")
				}
				w.Header().Set("Cache-Control", "no-store")
				if count == 1 {
					started := time.Now()
					first.Store(&started)
					w.Header().Set("Retry-After", "1")
					if kind == "budget" {
						w.Header().Set("Retry-After", "60")
					}
					status, code := http.StatusTooManyRequests, "rate_limited"
					if kind == "denial" {
						status, code = http.StatusForbidden, "denied_scope"
					}
					w.WriteHeader(status)
					_ = json.NewEncoder(w).Encode(map[string]any{"schema_version": 1, "status": "error", "error": map[string]string{"code": code, "message": "rate_limited wording must never decide scheduling"}})
					return
				}
				if time.Since(*first.Load()) < time.Second {
					t.Error("provider spacing ignored")
				}
				a := f.Access
				a.AttemptID = "original-attempt"
				a.RequestDigest = publicationTestDigestControl(f.Push)
				_ = json.NewEncoder(w).Encode(a)
			})
			client.inc, client.conn, client.ready = 7, &websocket.Conn{}, true
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			if kind == "budget" {
				cancel()
				ctx, cancel = context.WithTimeout(context.Background(), 500*time.Millisecond)
			}
			defer cancel()
			result, e := client.PublicationAccess(ctx, f.Push, "push", "original-attempt")
			var wait *PublicationSchedulingWaitError
			switch kind {
			case "spacing":
				if e != nil || requests.Load() != 2 || result.Authentication.Token == nil {
					t.Fatal("typed provider spacing did not resume original request", e)
				}
			case "budget":
				if !errors.As(e, &wait) || wait.RetryAfter != 60*time.Second || requests.Load() != 1 || result.Authentication.Token != nil {
					t.Fatal("cooldown budget exposed grant or lost typed pending wait", e)
				}
			case "denial":
				if e == nil || errors.As(e, &wait) || requests.Load() != 1 || result.Authentication.Token != nil {
					t.Fatal("denial prose was treated as scheduling or grant", e)
				}
			}
		})
	}
}
func publicationTestDigestControl(v any) string { _, d, _ := wire.Canonical(v); return d }

type remoteConnectionHandler struct {
	client   *Client
	result   protocol.PublicationPushResult
	contexts chan context.Context
	ack      chan protocol.PublicationPushACK
}

func (*remoteConnectionHandler) Reconcile(context.Context, protocol.RunnerInventory) error {
	return nil
}
func (*remoteConnectionHandler) Tick(context.Context) {}
func (*remoteConnectionHandler) InstalledRuntimes(context.Context) []protocol.RuntimeInstallation {
	return []protocol.RuntimeInstallation{}
}
func (h *remoteConnectionHandler) Frame(ctx context.Context, f protocol.Frame) {
	if f.PublicationPush != nil {
		h.contexts <- ctx
		_ = h.client.Send(ctx, protocol.Frame{Type: "publication_push_result", PublicationPushResult: &h.result})
	} else if f.PublicationPushACK != nil {
		h.ack <- *f.PublicationPushACK
	}
}

func TestRemotePreparationWSSReadyCurrentIncarnationAndExactACK(t *testing.T) {
	raw, e := os.ReadFile("../../../packages/protocol/fixtures/remote-preparation.json")
	if e != nil {
		t.Fatal(e)
	}
	var fixture struct {
		Push   protocol.PublicationPushRequest `json:"push"`
		Result protocol.PublicationPushResult  `json:"push_result"`
	}
	if json.Unmarshal(raw, &fixture) != nil {
		t.Fatal("remote transport fixture unavailable")
	}
	fixture.Result.RequestDigest = publicationTestDigestControl(fixture.Push)
	for _, stale := range []bool{false, true} {
		t.Run(map[bool]string{false: "current", true: "stale"}[stale], func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			h := &remoteConnectionHandler{result: fixture.Result, contexts: make(chan context.Context, 1), ack: make(chan protocol.PublicationPushACK, 1)}
			h.client = inventoryClient(t, func(w http.ResponseWriter, req *http.Request) {
				if req.URL.Path == "/v1/runner/inventory" {
					_ = json.NewEncoder(w).Encode(protocol.RunnerInventory{SchemaVersion: 1, SnapshotID: snapshotA, Dispatches: []protocol.Dispatch{}, Operations: []protocol.Operation{}})
					return
				}
				if req.Header.Get("Authorization") != "Bearer private-test" {
					t.Error("remote WSS authentication missing")
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
				inc := int64(7)
				runner := "runner"
				raw, _ := json.Marshal(protocol.Frame{SchemaVersion: 1, Type: protocol.Welcome, RunnerID: &runner, Incarnation: &inc})
				if conn.Write(ctx, websocket.MessageText, raw) != nil {
					return
				}
				_, raw, e = conn.Read(ctx)
				var ready protocol.Frame
				if e != nil || wire.Decode("Frame", raw, &ready) != nil || len(ready.RemotePreparationModes) != 1 || ready.RemotePreparationModes[0] != "github_review_v1" {
					t.Error("remote Ready capability absent")
					return
				}
				sendInc := inc
				if stale {
					sendInc--
				}
				raw, _ = json.Marshal(protocol.Frame{SchemaVersion: 1, Type: "publication_push", Incarnation: &sendInc, PublicationPush: &fixture.Push})
				if conn.Write(ctx, websocket.MessageText, raw) != nil {
					return
				}
				if stale {
					_, _, _ = conn.Read(ctx)
					return
				}
				_, raw, e = conn.Read(ctx)
				var response protocol.Frame
				if e != nil || wire.Decode("Frame", raw, &response) != nil || response.PublicationPushResult == nil || response.Incarnation == nil || *response.Incarnation != inc || publicationTestDigestControl(*response.PublicationPushResult) != publicationTestDigestControl(fixture.Result) {
					t.Error("exact remote result/current incarnation changed")
					return
				}
				ack := protocol.PublicationPushACK{SchemaVersion: 1, OperationID: fixture.Push.OperationID, RequestDigest: fixture.Result.RequestDigest, ItemID: fixture.Push.ItemID, ResultDigest: publicationTestDigestControl(fixture.Result)}
				raw, _ = json.Marshal(protocol.Frame{SchemaVersion: 1, Type: "publication_push_ack", Incarnation: &inc, PublicationPushACK: &ack})
				if conn.Write(ctx, websocket.MessageText, raw) != nil {
					return
				}
				select {
				case got := <-h.ack:
					if got != ack {
						t.Error("remote ACK binding changed")
					}
				case <-ctx.Done():
					t.Error("remote ACK not routed")
				}
			})
			if h.client.Run(ctx, "boot", h) == nil || ctx.Err() != nil {
				t.Fatal("remote transport did not close promptly")
			}
			select {
			case scope := <-h.contexts:
				if stale || scope.Err() != context.Canceled {
					t.Fatal("stale frame dispatched or connection scope survived disconnect")
				}
			default:
				if !stale {
					t.Fatal("current remote request absent")
				}
			}
		})
	}
}
