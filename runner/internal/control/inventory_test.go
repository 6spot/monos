package control

import (
	"context"
	"encoding/json"
	protocol "monos.local/protocol"
	"net/http"
	"net/http/httptest"
	"testing"
)

const snapshotA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const snapshotB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

func inventoryDispatch() protocol.Dispatch {
	return protocol.Dispatch{AttemptID: "a", DispatchID: "d", RunnerID: "runner", TaskID: ptr("t"), Kind: protocol.Node, ResourceID: ptr("repo"), RuntimeID: protocol.Opencode, Model: "opencode/mimo-v2.6-flash-free", Prompt: "hello", MutationAllowed: true}
}
func inventoryClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	server := httptest.NewTLSServer(handler)
	t.Cleanup(server.Close)
	return &Client{Config: Config{Endpoint: server.URL, RunnerID: "runner"}, HTTP: server.Client(), token: "private-test"}
}
func TestInventoryCollectsAllPagesAndDeduplicates(t *testing.T) {
	cursor := "dispatch_a"
	dispatch := inventoryDispatch()
	client := inventoryClient(t, func(w http.ResponseWriter, r *http.Request) {
		page := protocol.RunnerInventory{SchemaVersion: 1, SnapshotID: snapshotA, Dispatches: []protocol.Dispatch{dispatch}, Operations: []protocol.Operation{}}
		if r.URL.Query().Get("after") == "" {
			page.NextCursor = &cursor
		} else {
			if r.URL.Query().Get("snapshot_id") != snapshotA {
				t.Error("snapshot query lost")
			}
			page.Operations = []protocol.Operation{{SchemaVersion: 1, OperationID: "o", AttemptID: "a", DispatchID: "d", RequestID: "r", Kind: protocol.Stop, ResourceID: ptr("repo"), State: protocol.FluffyAdmitted}}
		}
		json.NewEncoder(w).Encode(page)
	})
	result, err := client.Inventory(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Dispatches) != 1 || len(result.Operations) != 1 {
		t.Fatalf("incomplete/doubled %+v", result)
	}
}
func TestInventoryRestartsWholeSnapshotAfterConflict(t *testing.T) {
	cursor := "dispatch_a"
	round := 0
	client := inventoryClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("after") != "" {
			w.WriteHeader(http.StatusConflict)
			return
		}
		round++
		page := protocol.RunnerInventory{SchemaVersion: 1, SnapshotID: snapshotA, Dispatches: []protocol.Dispatch{inventoryDispatch()}, Operations: []protocol.Operation{}}
		if round == 1 {
			page.NextCursor = &cursor
		} else {
			page.SnapshotID = snapshotB
			page.Dispatches = []protocol.Dispatch{}
		}
		json.NewEncoder(w).Encode(page)
	})
	result, err := client.Inventory(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.SnapshotID != snapshotB || len(result.Dispatches) != 0 || round != 2 {
		t.Fatal("partial earlier snapshot leaked")
	}
}
func TestPartialInventoryAndCursorLoopNeverSucceed(t *testing.T) {
	for _, mode := range []string{"truncated", "cursor-loop", "unmapped-operation"} {
		t.Run(mode, func(t *testing.T) {
			cursor := "dispatch_a"
			client := inventoryClient(t, func(w http.ResponseWriter, r *http.Request) {
				page := protocol.RunnerInventory{SchemaVersion: 1, SnapshotID: snapshotA, Dispatches: []protocol.Dispatch{}, Operations: []protocol.Operation{}}
				if mode == "unmapped-operation" {
					page.Operations = []protocol.Operation{{SchemaVersion: 1, OperationID: "o", AttemptID: "missing", DispatchID: "d", RequestID: "r", Kind: protocol.Stop, ResourceID: ptr("repo"), State: protocol.FluffyAdmitted}}
				} else {
					page.NextCursor = &cursor
					if mode == "truncated" && r.URL.Query().Get("after") != "" {
						w.Write([]byte(`{"schema_version":1`))
						return
					}
				}
				json.NewEncoder(w).Encode(page)
			})
			if _, err := client.Inventory(context.Background()); err == nil {
				t.Fatal("partial inventory passed")
			}
		})
	}
}

func ptr(value string) *string { return &value }
