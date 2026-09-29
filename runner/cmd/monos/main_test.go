package main

import (
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/local"
)

func TestPlannerCLIUsesNativeJournalChannel(t *testing.T) {
	// This socket fixture tests CLI argument/input transport. Kernel attribution
	// remains covered by local/host tests and the Linux integration trial.
	for _, command := range []struct{ name, payload string }{
		{"read_discussion", `{}`},
		{"update_working_requirement_state", `{"working_requirement_state":"state","resolved_watermark":0,"project_context_version":1,"project_context_digest":"` + strings.Repeat("a", 64) + `"}`},
		{"commit_discussion_turn", `{"reply":"reply","working_requirement_state":"state","source_message_id":"source","source_watermark":1}`},
		{"publish_execution_plan", `{"planning_intent_id":"intent","plan_id":"plan","nodes":[{"node_id":"node","role_id":"role","goal":"Complete the requested work","dependencies":[],"hard_requirements":["Keep compatibility"],"expected_outputs":["Verified result"]}]}`},
		{"raise_planning_issue", `{"planning_intent_id":"intent","reason":"The Specification needs Owner direction"}`},
	} {
		t.Run(command.name, func(t *testing.T) {
			// Short directory avoids the Unix socket path limit on macOS.
			dir, err := os.MkdirTemp("", "monos-cli-")
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { os.RemoveAll(dir) })
			socket := filepath.Join(dir, "s")
			listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: socket, Net: "unix"})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { listener.Close() })
			t.Setenv("MONOS_SOCKET", socket)
			observed := make(chan local.Request, 1)
			go func() {
				conn, err := listener.AcceptUnix()
				if err != nil {
					return
				}
				defer conn.Close()
				conn.SetDeadline(time.Now().Add(5 * time.Second))
				var request local.Request
				if json.NewDecoder(conn).Decode(&request) != nil {
					return
				}
				observed <- request
				_ = json.NewEncoder(conn).Encode(local.Response{Result: &protocol.CommandResult{SchemaVersion: 1, Status: "committed", RequestID: &request.RequestID}})
			}()
			input := filepath.Join(dir, "payload.json")
			if err = os.WriteFile(input, []byte(command.payload), 0600); err != nil {
				t.Fatal(err)
			}
			result, err := run([]string{command.name, "--input", input, "--request-id", "same-request", "--output", "json"})
			if err != nil || result.Status != "committed" {
				t.Fatal("native Planner command failed", err)
			}
			select {
			case request := <-observed:
				if request.Action != "prepare" || string(request.Name) != command.name || request.RequestID != "same-request" || string(request.Payload) != command.payload {
					t.Fatalf("CLI changed retained command: %+v", request)
				}
			case <-time.After(time.Second):
				t.Fatal("CLI bypassed the journal channel")
			}
		})
	}
}
