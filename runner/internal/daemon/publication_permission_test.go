package daemon

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	protocol "monos.local/protocol"
	"monos.local/runner/internal/control"
	"monos.local/runner/internal/wire"
)

type publicationPermissionHandler struct{ daemon *Daemon }

func (*publicationPermissionHandler) Reconcile(context.Context, protocol.RunnerInventory) error {
	return nil
}
func (*publicationPermissionHandler) Tick(context.Context) {}
func (h *publicationPermissionHandler) Frame(ctx context.Context, frame protocol.Frame) {
	h.daemon.Frame(ctx, frame)
	h.daemon.workers.Wait()
	// A second Ready is a test-only stream barrier after every worker send. It
	// lets the server assert no result for denied scopes without sleeping.
	_ = h.daemon.Control.Send(ctx, protocol.Frame{Type: protocol.TypeReady, LogModes: []protocol.LogModeElement{protocol.PurpleOrderedV1}})
}

func TestPublicationDaemonMissingPermissionStillRunsAnonymousLocalPreparation(t *testing.T) {
	for _, proofBound := range []bool{false, true} {
		name := "anonymous"
		if proofBound {
			name = "frozen_scope"
		}
		t.Run(name, func(t *testing.T) {
			db, request := publicationDaemonFixture(t, true, true)
			if proofBound {
				scope := strings.Repeat("a", 64)
				proof := protocol.PublicationPermissionProof{SchemaVersion: 1, Kind: "git_https_configuration", ObservationID: "permission-observation",
					ResourceID: request.Source.ResourceID, RepositoryIdentity: request.Source.RepositoryIdentity,
					RemoteURL: ptr(request.Construction.Parents[0].Workspace.Resource.RemoteURL), Username: ptr("service-user"),
					ConfigurationRequestID: ptr("credential-receipt"), ScopeDigest: &scope, ConfigurationFingerprint: strings.Repeat("b", 64),
					PermissionFingerprint: publicationDaemonDigest(t, map[string]any{"kind": "git_https_configuration", "scope_digest": scope}),
					ObservedAt:            time.Now().UTC().Format("2006-01-02T15:04:05.000Z"), ExpiresAt: time.Now().Add(5 * time.Minute).UTC().Format("2006-01-02T15:04:05.000Z")}
				request.PermissionProof, request.PermissionProofDigest = &proof, ptr(publicationDaemonDigest(t, proof))
				request.Configuration.PermissionFingerprint = proof.PermissionFingerprint
				request.ConfigurationDigest = publicationDaemonDigest(t, request.Configuration)
			}
			if err := retainedPublicationIdentity(db, request); err != nil {
				t.Fatal("fixture lacks valid retained publication authority", err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			var permissionRequests atomic.Int32
			results := make(chan []protocol.PublicationResultPage, 1)
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/v1/runner/inventory":
					_ = json.NewEncoder(w).Encode(protocol.RunnerInventory{SchemaVersion: 1, SnapshotID: strings.Repeat("c", 32), Dispatches: []protocol.Dispatch{}, Operations: []protocol.Operation{}})
					return
				case "/v1/runner/publication-operations/" + request.OperationID + "/permission":
					permissionRequests.Add(1)
					w.Header().Set("Cache-Control", "no-store")
					w.WriteHeader(http.StatusConflict)
					_, _ = w.Write([]byte(`{"schema_version":1,"status":"error","error":{"code":"unmet_precondition","message":"credentials_missing"}}`))
					return
				case "/v1/runner":
				default:
					t.Error("unexpected endpoint", r.URL.Path)
					w.WriteHeader(http.StatusNotFound)
					return
				}
				conn, err := websocket.Accept(w, r, nil)
				if err != nil {
					t.Error(err)
					return
				}
				defer conn.CloseNow()
				read := func() (protocol.Frame, error) {
					_, raw, err := conn.Read(ctx)
					var frame protocol.Frame
					if err == nil {
						err = wire.Decode("Frame", raw, &frame)
					}
					return frame, err
				}
				if _, err = read(); err != nil {
					t.Error(err)
					return
				}
				incarnation := int64(1)
				welcome, _ := json.Marshal(protocol.Frame{SchemaVersion: 1, Type: protocol.Welcome, RunnerID: ptr("runner"), Incarnation: &incarnation})
				if err = conn.Write(ctx, websocket.MessageText, welcome); err != nil {
					t.Error(err)
					return
				}
				if frame, err := read(); err != nil || frame.Type != protocol.TypeReady {
					t.Error("missing Ready", err)
					return
				}
				frame, _ := json.Marshal(protocol.Frame{SchemaVersion: 1, Type: "publication_prepare", Incarnation: &incarnation, PublicationPrepare: &request})
				if err = conn.Write(ctx, websocket.MessageText, frame); err != nil {
					t.Error(err)
					return
				}
				var pages []protocol.PublicationResultPage
				for {
					frame, err := read()
					if err != nil {
						t.Error(err)
						return
					}
					if frame.Type == protocol.TypeReady {
						results <- pages
						return
					}
					if frame.PublicationResult != nil {
						pages = append(pages, *frame.PublicationResult)
					}
				}
			}))
			defer server.Close()
			d := &Daemon{DB: db, Control: &control.Client{Config: control.Config{Endpoint: server.URL, RunnerID: "runner"}, HTTP: server.Client()}}
			runErr := d.Control.Run(ctx, "boot", &publicationPermissionHandler{daemon: d})
			d.workers.Wait()
			if permissionRequests.Load() != 1 {
				t.Fatal("permission endpoint was not reached exactly once", runErr)
			}
			select {
			case pages := <-results:
				if proofBound && len(pages) != 0 {
					t.Fatal("frozen permission scope was silently discarded")
				}
				if !proofBound && (len(pages) != 1 || pages[0].Result.Status != "unavailable" || pages[0].Result.Reason == nil || *pages[0].Result.Reason != "retained_unavailable") {
					t.Fatal("anonymous preparation did not reach the local source check", pages)
				}
			case <-ctx.Done():
				t.Fatal("daemon did not settle permission handling", ctx.Err())
			}
		})
	}
}
