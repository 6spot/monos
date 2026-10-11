package control

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"testing/iotest"

	"github.com/coder/websocket"
	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func inspectionAccessOperation(t *testing.T) protocol.Operation {
	t.Helper()
	raw := []byte(`{"schema_version":1,"inspection_id":"inspect","attempt_id":"attempt","dispatch_id":"dispatch","scope_kind":"task","scope_id":"task","project_id":"project","runner_id":"runner","resource":{"resource_id":"repo","repository_identity":"github.com/owner/repo","remote_url":"https://github.com/owner/repo.git","provider_metadata":{"github":{"repository_id":"123"}}},"planner_source":{"kind":"task_initial_planning","source_id":"source","control_version":7,"source_watermark":0,"context_digest":"` + strings.Repeat("a", 64) + `"},"origin":{"kind":"default_ref"}}`)
	var descriptor protocol.InspectionDescriptor
	if err := wire.Decode("InspectionDescriptor", raw, &descriptor); err != nil {
		t.Fatal(err)
	}
	_, digest, err := wire.Canonical(descriptor)
	if err != nil {
		t.Fatal(err)
	}
	return protocol.Operation{SchemaVersion: 1, OperationID: "inspect", AttemptID: "attempt", DispatchID: "dispatch", RequestID: "request", Kind: "inspect_repository", State: "admitted", ResourceID: ptr("repo"), Inspection: &descriptor, InspectionDigest: &digest}
}

func inspectionAccessBody(op protocol.Operation) map[string]any {
	return map[string]any{
		"schema_version": 1, "operation_id": op.OperationID, "inspection_digest": *op.InspectionDigest,
		"remote_url": "https://github.com/owner/repo.git", "provider_metadata": map[string]any{"github": map[string]any{"repository_id": "123"}},
		"default_branch": "main", "authentication": map[string]any{"kind": "github_installation", "token": "must-not-leak", "expires_at": "2099-01-01T00:00:00Z"},
	}
}

func TestInspectionAccessBindsDigestAndAllowsConnectedRecovery(t *testing.T) {
	for _, kind := range []string{"anonymous", "github_installation"} {
		t.Run(kind, func(t *testing.T) {
			op := inspectionAccessOperation(t)
			client := inventoryClient(t, func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost || r.URL.Path != "/v1/runner/operations/inspect/inspection-access" || r.URL.RawQuery != "" {
					t.Error("wrong inspection exchange endpoint")
				}
				if r.Header.Get("Authorization") != "Bearer private-test" || r.Header.Get("Content-Type") != "application/json" || r.Header.Get("Cache-Control") != "no-store" {
					t.Error("missing service authentication or transient headers")
				}
				raw, err := io.ReadAll(r.Body)
				var request protocol.InspectionRepositoryAccessRequest
				if err != nil || wire.Decode("InspectionRepositoryAccessRequest", raw, &request) != nil || request.Incarnation != 7 || request.InspectionDigest != *op.InspectionDigest {
					t.Error("wrong inspection recovery identity", err)
				}
				body := inspectionAccessBody(op)
				if kind == "anonymous" {
					body["authentication"] = map[string]any{"kind": "anonymous"}
				}
				_ = json.NewEncoder(w).Encode(body)
			})
			client.conn, client.inc, client.ready = &websocket.Conn{}, 7, false
			access, err := client.InspectionRepositoryAccess(context.Background(), op)
			if err != nil || access.OperationID != op.OperationID || access.InspectionDigest != *op.InspectionDigest || string(access.Authentication.Kind) != kind {
				t.Fatal("connected inspection recovery failed", err)
			}
			if kind == "github_installation" && (access.Authentication.Token == nil || *access.Authentication.Token != "must-not-leak") {
				t.Fatal("transient credential missing")
			}
		})
	}
}

func TestInspectionAccessRejectsChangedDescriptorBeforeExchange(t *testing.T) {
	for _, mode := range []string{"missing-descriptor", "missing-digest", "digest", "kind", "operation", "attempt", "dispatch", "runner", "resource", "source", "origin", "disconnected"} {
		t.Run(mode, func(t *testing.T) {
			op := inspectionAccessOperation(t)
			var calls atomic.Int32
			client := inventoryClient(t, func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				_ = json.NewEncoder(w).Encode(inspectionAccessBody(op))
			})
			client.conn, client.inc = &websocket.Conn{}, 7
			switch mode {
			case "missing-descriptor":
				op.Inspection = nil
			case "missing-digest":
				op.InspectionDigest = nil
			case "digest":
				op.InspectionDigest = ptr(strings.Repeat("f", 64))
			case "kind":
				op.Kind = "open_workspace"
			case "operation":
				op.OperationID = "other"
			case "attempt":
				op.AttemptID = "other"
			case "dispatch":
				op.DispatchID = "other"
			case "runner":
				client.Config.RunnerID = "other"
			case "resource":
				op.ResourceID = ptr("other")
			case "source":
				op.Inspection.PlannerSource.SourceID = "other"
			case "origin":
				op.Inspection.Origin.Kind = "task_open"
			case "disconnected":
				client.conn = nil
			}
			if access, err := client.InspectionRepositoryAccess(context.Background(), op); err == nil || !reflect.DeepEqual(access, protocol.InspectionRepositoryAccessResult{}) || calls.Load() != 0 {
				t.Fatal("invalid identity reached credential exchange", err, calls.Load())
			}
		})
	}
}

func TestInspectionAccessAcceptsVerifiedGitHubRemoteAliases(t *testing.T) {
	for _, remote := range []string{"git@github.com:Owner/Repo.git", "ssh://git@github.com/Owner/Repo.git", "https://github.com/owner/repo", "https://github.com/OWNER/REPO.git"} {
		t.Run(remote, func(t *testing.T) {
			op := inspectionAccessOperation(t)
			op.Inspection.Resource.RemoteURL = remote
			_, digest, err := wire.Canonical(op.Inspection)
			if err != nil {
				t.Fatal(err)
			}
			op.InspectionDigest = &digest
			client := inventoryClient(t, func(w http.ResponseWriter, r *http.Request) {
				body := inspectionAccessBody(op)
				body["remote_url"] = "https://github.com/Owner/Repo.git"
				_ = json.NewEncoder(w).Encode(body)
			})
			client.conn, client.inc = &websocket.Conn{}, 7
			access, err := client.InspectionRepositoryAccess(context.Background(), op)
			if err != nil || access.RemoteURL != "https://github.com/Owner/Repo.git" {
				t.Fatal("verified repository alias rejected", err)
			}
		})
	}
}

func TestInspectionAccessDiscardsForeignMalformedAndOversizedCredentials(t *testing.T) {
	for _, mode := range []string{"operation", "digest", "remote", "repository", "malformed", "unknown-field", "oversized", "connection-incarnation", "connection-instance", "connection-lost"} {
		t.Run(mode, func(t *testing.T) {
			op := inspectionAccessOperation(t)
			var client *Client
			client = inventoryClient(t, func(w http.ResponseWriter, r *http.Request) {
				body := inspectionAccessBody(op)
				switch mode {
				case "operation":
					body["operation_id"] = "other"
				case "digest":
					body["inspection_digest"] = strings.Repeat("b", 64)
				case "remote":
					body["remote_url"] = "https://github.com/other/repo.git"
				case "repository":
					body["provider_metadata"] = map[string]any{"github": map[string]any{"repository_id": "456"}}
				case "malformed":
					_, _ = w.Write([]byte(`{"token":"must-not-leak"`))
					return
				case "unknown-field":
					body["unexpected"] = "must-not-leak"
				case "oversized":
					_, _ = w.Write([]byte(strings.Repeat("must-not-leak", 2000)))
					return
				case "connection-incarnation", "connection-instance", "connection-lost":
					client.mu.Lock()
					if mode == "connection-incarnation" {
						client.inc++
					} else if mode == "connection-instance" {
						client.conn = &websocket.Conn{}
					} else {
						client.conn = nil
					}
					client.mu.Unlock()
				}
				_ = json.NewEncoder(w).Encode(body)
			})
			client.conn, client.inc = &websocket.Conn{}, 7
			access, err := client.InspectionRepositoryAccess(context.Background(), op)
			if err == nil || strings.Contains(err.Error(), "must-not-leak") || !reflect.DeepEqual(access, protocol.InspectionRepositoryAccessResult{}) {
				t.Fatal("untrusted or stale credential response escaped", err)
			}
		})
	}
}

func TestInspectionAccessDenialIsTypedAndSanitized(t *testing.T) {
	for _, body := range []string{`{"schema_version":1,"reason":"access_denied"}`, `{"schema_version":1,"reason":"source_stale"}`, `{"schema_version":1,"reason":"must-not-leak"}`, `{"schema_version":1,"reason":"access_denied","token":"must-not-leak"}`} {
		t.Run(body, func(t *testing.T) {
			client := inventoryClient(t, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(body))
			})
			client.conn, client.inc = &websocket.Conn{}, 7
			access, err := client.InspectionRepositoryAccess(context.Background(), inspectionAccessOperation(t))
			var failure *InspectionAccessFailure
			if !errors.As(err, &failure) || !reflect.DeepEqual(access, protocol.InspectionRepositoryAccessResult{}) || strings.Contains(err.Error(), "must-not-leak") {
				t.Fatal("denial reason leaked or lost its type", err)
			}
			want := "resource_unavailable"
			if !strings.Contains(body, "must-not-leak") {
				if strings.Contains(body, "source_stale") {
					want = "source_stale"
				} else {
					want = "access_denied"
				}
			}
			if string(failure.Reason) != want {
				t.Fatal("wrong bounded unavailable reason", failure.Reason)
			}
		})
	}
}

type inspectionAccessTransport func(*http.Request) (*http.Response, error)

func (f inspectionAccessTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func TestInspectionAccessSanitizesTransportAndBodyErrors(t *testing.T) {
	for _, bodyFailure := range []bool{false, true} {
		t.Run(map[bool]string{false: "transport", true: "body"}[bodyFailure], func(t *testing.T) {
			client := &Client{Config: Config{Endpoint: "https://control.invalid", RunnerID: "runner"}, conn: &websocket.Conn{}, inc: 7}
			client.HTTP = &http.Client{Transport: inspectionAccessTransport(func(r *http.Request) (*http.Response, error) {
				if bodyFailure {
					return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(iotest.ErrReader(errors.New("must-not-leak"))), Header: http.Header{}}, nil
				}
				return nil, errors.New("must-not-leak")
			})}
			access, err := client.InspectionRepositoryAccess(context.Background(), inspectionAccessOperation(t))
			if err == nil || strings.Contains(err.Error(), "must-not-leak") || !reflect.DeepEqual(access, protocol.InspectionRepositoryAccessResult{}) {
				t.Fatal("transport credential text leaked", err)
			}
		})
	}
}
