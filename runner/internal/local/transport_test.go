package local

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	protocol "monos.local/protocol"
	"monos.local/runner/internal/control"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/journal"
)

type socketConnectionHandler struct{ ready chan struct{} }

func (*socketConnectionHandler) Reconcile(context.Context, protocol.RunnerInventory) error {
	return nil
}
func (*socketConnectionHandler) Frame(context.Context, protocol.Frame) {}
func (*socketConnectionHandler) Tick(context.Context)                  {}
func (h *socketConnectionHandler) ConnectionReady(context.Context)     { close(h.ready) }

func TestAttributedSocketWithoutCAKeepsJournalAndAttemptCredential(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("kernel peer attribution requires Linux")
	}
	peer, err := host.Identity(os.Getpid())
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	db, err := journal.Open(filepath.Join(dir, "journal.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	task := "task"
	dispatch := protocol.Dispatch{AttemptID: "attempt", DispatchID: "dispatch", TaskID: &task, ControlVersion: 2}
	if err := db.SaveStart(journal.Start{Dispatch: dispatch, BootID: peer.BootID, Birth: peer.Birth, PID: peer.PID, Cgroup: peer.Cgroup, Phase: "running"}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer private-runner-token" {
			t.Error("Runner transport lost enrollment credential")
		}
		if r.URL.Path == "/v1/runner/inventory" {
			_ = json.NewEncoder(w).Encode(protocol.RunnerInventory{SchemaVersion: 1, SnapshotID: strings.Repeat("a", 32), Dispatches: []protocol.Dispatch{}, Operations: []protocol.Operation{}})
			return
		}
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.CloseNow()
		if _, _, err := conn.Read(ctx); err != nil {
			t.Error(err)
			return
		}
		runner, incarnation := "runner", int64(1)
		welcome, _ := json.Marshal(protocol.Frame{SchemaVersion: 1, Type: protocol.Welcome, RunnerID: &runner, Incarnation: &incarnation})
		if err := conn.Write(ctx, websocket.MessageText, welcome); err != nil {
			t.Error(err)
			return
		}
		if _, _, err := conn.Read(ctx); err != nil {
			t.Error(err)
			return
		}
		for {
			_, raw, err := conn.Read(ctx)
			if err != nil {
				return
			}
			var frame protocol.Frame
			if err := json.Unmarshal(raw, &frame); err != nil || frame.Type != protocol.AuthorizeDispatch || frame.DispatchID == nil || *frame.DispatchID != dispatch.DispatchID {
				t.Error("unexpected authorization frame", err)
				return
			}
			if _, err := db.Request(dispatch.AttemptID, "request"); err != nil {
				t.Error("authorization preceded durable request", err)
				return
			}
			allowed, credential, expires := true, "scoped-attempt-token", time.Now().Add(time.Minute).UTC().Format(time.RFC3339)
			reply, _ := json.Marshal(protocol.Frame{SchemaVersion: 1, Type: protocol.Authorization, CorrelationID: frame.CorrelationID, Incarnation: &incarnation, Allowed: &allowed, Credential: &credential, ExpiresAt: &expires})
			if err := conn.Write(ctx, websocket.MessageText, reply); err != nil {
				t.Error(err)
				return
			}
		}
	}))
	defer server.Close()
	token := filepath.Join(dir, "token")
	if err := os.WriteFile(token, []byte("private-runner-token"), 0600); err != nil {
		t.Fatal(err)
	}
	client, err := control.New(control.Config{Endpoint: server.URL, TokenFile: token, RunnerID: "runner"})
	if err != nil {
		t.Fatal(err)
	}
	defer client.HTTP.CloseIdleConnections()
	handler := &socketConnectionHandler{ready: make(chan struct{})}
	done := make(chan error, 1)
	go func() { done <- client.Run(ctx, peer.BootID, handler) }()
	defer func() { cancel(); <-done }()
	select {
	case <-handler.ready:
	case <-ctx.Done():
		t.Fatal("Runner did not become ready")
	}
	// A real Unix connection supplies SO_PEERCRED. This fixture binds the test
	// process's actual cgroup; native supervisor isolation is a separate gate.
	socket := filepath.Join(dir, "s")
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: socket, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	service := &Service{DB: db, Control: client, UID: uint32(os.Getuid())}
	go func() {
		conn, err := listener.AcceptUnix()
		if err != nil {
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
		decoder := json.NewDecoder(conn)
		for i := 0; i < 2; i++ {
			var request Request
			if err := decoder.Decode(&request); err != nil {
				return
			}
			response, err := service.Handle(ctx, conn, request)
			if err != nil {
				response = Response{Error: err.Error()}
			}
			_ = json.NewEncoder(conn).Encode(response)
		}
	}()
	conn, err := net.DialUnix("unix", nil, &net.UnixAddr{Name: socket, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	var prepared Response
	for _, action := range []string{"prepare", "retry"} {
		request := Request{Action: action, RequestID: "request"}
		if action == "prepare" {
			request.Name = "complete_node"
			request.Payload = json.RawMessage(`{"summary":"Exact result"}`)
		}
		if err := json.NewEncoder(conn).Encode(request); err != nil {
			t.Fatal(err)
		}
		var response Response
		if err := json.NewDecoder(conn).Decode(&response); err != nil {
			t.Fatal(err)
		}
		retained, err := db.Request(dispatch.AttemptID, "request")
		if err != nil || response.Error != "" || response.CA != nil || response.Endpoint != server.URL || response.Credential != "scoped-attempt-token" || response.EnvelopeJSON != string(retained.Raw) || response.Digest != retained.Digest {
			t.Fatalf("socket changed retained command or optional CA: %+v %v", response, err)
		}
		if strings.Contains(string(retained.Raw), "token") {
			t.Fatal("journal stored credentials")
		}
		if action == "prepare" {
			prepared = response
		} else if response.EnvelopeJSON != prepared.EnvelopeJSON || response.Digest != prepared.Digest {
			t.Fatal("retry changed the original envelope")
		}
	}
}
