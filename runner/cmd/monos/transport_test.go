package main

import (
	"encoding/json"
	"encoding/pem"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/local"
	"monos.local/runner/internal/wire"
)

func TestCLITransportsRetainedSocketEnvelope(t *testing.T) {
	for _, mode := range []string{"http_without_ca", "https_with_ca", "invalid_ca", "untrusted_https", "redirect"} {
		t.Run(mode, func(t *testing.T) {
			// This real Unix socket is the CLI boundary. Linux local-service tests
			// separately exercise kernel attribution and durable preparation.
			dir, err := os.MkdirTemp("", "monos-cli-")
			if err != nil {
				t.Fatal(err)
			}
			defer os.RemoveAll(dir)
			raw, digest, err := wire.CanonicalRaw([]byte(`{"schema_version":1,"request_id":"request","name":"complete_node","scope_id":"task","expected_control_version":2,"payload":{"summary":"Exact retained result"}}`))
			if err != nil {
				t.Fatal(err)
			}
			var submitted, redirected atomic.Int32
			target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { redirected.Add(1) }))
			defer target.Close()
			server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				submitted.Add(1)
				var submission protocol.CommandSubmission
				if err := json.NewDecoder(r.Body).Decode(&submission); err != nil || submission.EnvelopeJSON != string(raw) || submission.Sha256 != digest {
					t.Error("CLI changed the retained command bytes or digest", err)
				}
				if r.Method != "POST" || r.URL.Path != "/v1/commands" || r.Header.Get("Authorization") != "Bearer scoped-attempt-token" || r.Header.Get("Content-Type") != "application/json" {
					t.Error("CLI changed command endpoint or scoped credential")
				}
				if mode == "redirect" {
					http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
					return
				}
				id := "request"
				_ = json.NewEncoder(w).Encode(protocol.CommandResult{SchemaVersion: 1, Status: "committed", RequestID: &id})
			}))
			server.Config.ErrorLog = log.New(io.Discard, "", 0)
			var ca []byte
			if mode == "https_with_ca" || mode == "untrusted_https" {
				server.StartTLS()
				if mode == "https_with_ca" {
					ca = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw})
				}
			} else {
				server.Start()
				if mode == "invalid_ca" {
					ca = []byte("invalid CA")
				}
			}
			defer server.Close()
			socket := filepath.Join(dir, "s")
			listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: socket, Net: "unix"})
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			t.Setenv("MONOS_SOCKET", socket)
			observed := make(chan local.Request, 2)
			go func() {
				for {
					conn, err := listener.AcceptUnix()
					if err != nil {
						return
					}
					_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
					var request local.Request
					if json.NewDecoder(conn).Decode(&request) == nil {
						observed <- request
						_ = json.NewEncoder(conn).Encode(local.Response{EnvelopeJSON: string(raw), Digest: digest, Credential: "scoped-attempt-token", Endpoint: server.URL, CA: ca})
					}
					conn.Close()
				}
			}()
			input := filepath.Join(dir, "payload.json")
			if err := os.WriteFile(input, []byte(`{"summary":"Exact retained result"}`), 0600); err != nil {
				t.Fatal(err)
			}
			result, err := run([]string{"complete_node", "--input", input, "--request-id", "request"})
			request := <-observed
			if request.Action != "prepare" || request.RequestID != "request" || request.Name != "complete_node" {
				t.Fatalf("wrong socket request: %+v", request)
			}
			if mode == "invalid_ca" || mode == "untrusted_https" || mode == "redirect" {
				if err == nil || result.RequestID == nil || *result.RequestID != "request" || redirected.Load() != 0 {
					t.Fatalf("transport failure lost identity or followed redirect: %+v %v", result, err)
				}
				want := int32(0)
				if mode == "redirect" {
					want = 1
				}
				if submitted.Load() != want {
					t.Fatalf("unexpected submissions: %d", submitted.Load())
				}
				return
			}
			if err != nil || result.Status != "committed" {
				t.Fatalf("CLI submission failed: %+v %v", result, err)
			}
			if err := os.WriteFile(input, []byte(`{"summary":"Changed after preparation"}`), 0600); err != nil {
				t.Fatal(err)
			}
			result, err = run([]string{"retry", "--request-id", "request"})
			request = <-observed
			if err != nil || result.Status != "committed" || request.Action != "retry" || request.RequestID != "request" || len(request.Payload) != 0 || request.Name != "" || submitted.Load() != 2 {
				t.Fatalf("retry replaced original command or failed: %+v %v", request, err)
			}
		})
	}
}
