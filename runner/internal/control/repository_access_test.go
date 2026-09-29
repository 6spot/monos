package control

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/coder/websocket"
	protocol "monos.local/protocol"
)

func TestRepositoryAccessAllowsConnectedRecoveryAndSanitizesDenial(t *testing.T) {
	for _, body := range []string{`{"schema_version":1,"reason":"credentials_missing"}`, `{"schema_version":1,"reason":"repository_denied","token":"must-not-leak"}`, strings.Repeat("secret", 4000)} {
		t.Run(body[:20], func(t *testing.T) {
			client := inventoryClient(t, func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" || r.URL.Path != "/v1/runner/operations/open/repository-access" {
					t.Error("wrong exchange endpoint")
				}
				var request protocol.RepositoryAccessRequest
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.Incarnation != 7 || request.WorkspaceDigest != strings.Repeat("a", 64) {
					t.Error("wrong recovery identity", err)
				}
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(body))
			})
			client.conn = &websocket.Conn{}
			client.inc = 7
			client.ready = false
			digest := strings.Repeat("a", 64)
			_, err := client.RepositoryAccess(context.Background(), protocol.Operation{OperationID: "open", Workspace: &protocol.WorkspaceDescriptor{}, WorkspaceDigest: &digest})
			if err == nil || strings.Contains(err.Error(), "must-not-leak") || strings.Contains(err.Error(), "secret") {
				t.Fatal("untrusted provider body leaked", err)
			}
			if strings.Contains(body, `"credentials_missing"`) && !strings.Contains(err.Error(), "credentials_missing") {
				t.Fatal("actionable reason lost", err)
			}
		})
	}
}
