package control

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	protocol "monos.local/protocol"
)

func TestReconnectReloadsCredentialWithoutChangingRunnerIdentity(t *testing.T) {
	for _, rawToken := range []bool{false, true} {
		t.Run(map[bool]string{false: "identity", true: "raw-token"}[rawToken], func(t *testing.T) {
			dir, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			_ = os.Chmod(dir, 0700)
			path := filepath.Join(dir, "credential")
			old, next := strings.Repeat("a", 43), strings.Repeat("b", 43)
			writeIdentity := func(runner, token string) {
				t.Helper()
				raw, _ := json.Marshal(protocol.RunnerCredential{SchemaVersion: 1, RunnerID: runner, Credential: token})
				if rawToken {
					raw = []byte(token + "\n")
				}
				if err := os.WriteFile(path+".replacement", raw, 0600); err != nil {
					t.Fatal(err)
				}
				if err := os.Rename(path+".replacement", path); err != nil {
					t.Fatal(err)
				}
			}
			var calls atomic.Int32
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Header.Get("Authorization") != "Bearer "+next {
					t.Error("reconnect or inventory used the old credential")
				}
				if r.URL.Path == "/v1/runner/inventory" {
					_ = json.NewEncoder(w).Encode(protocol.RunnerInventory{SchemaVersion: 1, SnapshotID: snapshotA, Dispatches: []protocol.Dispatch{}, Operations: []protocol.Operation{}})
					return
				}
				conn, err := websocket.Accept(w, r, nil)
				if err != nil {
					t.Error(err)
					return
				}
				defer conn.CloseNow()
				ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
				defer cancel()
				_, hello, err := conn.Read(ctx)
				var frame protocol.Frame
				if err != nil || json.Unmarshal(hello, &frame) != nil || frame.RunnerID == nil || *frame.RunnerID != "runner" {
					t.Error("reconnect changed Runner identity")
					return
				}
				runner, incarnation := "runner", int64(2)
				welcome, _ := json.Marshal(protocol.Frame{SchemaVersion: 1, Type: protocol.Welcome, RunnerID: &runner, Incarnation: &incarnation})
				if conn.Write(ctx, websocket.MessageText, welcome) != nil {
					t.Error("welcome failed")
					return
				}
				if _, _, err = conn.Read(ctx); err != nil {
					t.Error("Runner did not reconcile and become ready", err)
				}
			}))
			defer s.Close()
			writeIdentity("runner", old)
			config := Config{Endpoint: s.URL, TokenFile: path}
			if rawToken {
				config.RunnerID = "runner"
			}
			client, err := New(config)
			if err != nil {
				t.Fatal(err)
			}
			writeIdentity("runner", next)
			handler := &connectionHandler{frames: make(chan context.Context, 1)}
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			if err := client.Run(ctx, "same-boot", handler); err == nil || ctx.Err() != nil || calls.Load() != 2 {
				t.Fatal("reconnect did not use fresh credential and reconcile inventory", err)
			}
			if rawToken {
				writeIdentity("runner", "short")
			} else {
				writeIdentity("different-runner", strings.Repeat("c", 43))
			}
			if err := client.Run(ctx, "same-boot", handler); err == nil || strings.Contains(err.Error(), next) || calls.Load() != 2 {
				t.Fatal("invalid replacement was sent or exposed a credential")
			}
			if client.Config.RunnerID != "runner" || client.credential() != next {
				t.Fatal("rejected replacement changed retained connection identity")
			}
		})
	}
}
