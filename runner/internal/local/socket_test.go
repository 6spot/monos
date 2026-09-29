package local

import (
	"encoding/json"
	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/journal"
	"monos.local/runner/internal/wire"
	"strings"
	"testing"
)

func TestSameUIDCannotSelectAnotherAttempt(t *testing.T) {
	one := journal.Start{BootID: "boot", Cgroup: "/system.slice/monos-probe-a-one.service", Phase: "running"}
	two := journal.Start{BootID: "boot", Cgroup: "/system.slice/monos-probe-a-two.service", Phase: "running"}
	peer := host.Peer{PID: 42, UID: 1000, Birth: "123", BootID: "boot", Cgroup: one.Cgroup}
	if !Match(peer, one) || Match(peer, two) {
		t.Fatal("UID confused ownership")
	}
	peer.BootID = "newboot"
	if Match(peer, one) {
		t.Fatal("boot reuse revived old ownership")
	}
	peer.BootID = "boot"
	one.Phase = "absent"
	if Match(peer, one) {
		t.Fatal("revoked ownership accepted")
	}
}

func TestNativeDiscussionCommandsUseAttributedTodoScope(t *testing.T) {
	todo, source := "todo-a", "source-a"
	dispatch := protocol.Dispatch{TodoID: &todo, Kind: "planner", SourceMessageID: &source, ControlVersion: 7}
	for _, command := range []struct {
		name    protocol.CommandEnvelopeName
		payload string
	}{
		{"read_discussion", `{}`},
		{"update_working_requirement_state", `{"working_requirement_state":"Current requirement","resolved_watermark":0,"project_context_version":1,"project_context_digest":"` + strings.Repeat("a", 64) + `"}`},
		{"commit_discussion_turn", `{"reply":"Reply","working_requirement_state":"Requirement","source_message_id":"source-a","source_watermark":1}`},
	} {
		raw, err := prepareEnvelope(dispatch, Request{Action: "prepare", RequestID: "request-a", Name: command.name, Payload: json.RawMessage(command.payload)})
		if err != nil {
			t.Fatal(err)
		}
		envelope, err := wire.Envelope(raw)
		if err != nil || envelope.ScopeID != todo || envelope.ExpectedControlVersion != 7 || envelope.Name != command.name {
			t.Fatalf("wrong envelope: %s %v", raw, err)
		}
	}
	task := "task-a"
	dispatch.TaskID = &task
	if _, err := prepareEnvelope(dispatch, Request{}); err == nil {
		t.Fatal("ambiguous owner accepted")
	}
}

func TestLegacyTaskEnvelopeCanonicalBytesAreUnchanged(t *testing.T) {
	task := "task-a"
	raw, err := prepareEnvelope(protocol.Dispatch{TaskID: &task, ControlVersion: 2}, Request{RequestID: "request-a", Name: "complete_node", Payload: json.RawMessage(`{"summary":"done"}`)})
	const original = `{"expected_control_version":2,"name":"complete_node","payload":{"summary":"done"},"request_id":"request-a","schema_version":1,"scope_id":"task-a"}`
	if err != nil || string(raw) != original {
		t.Fatalf("legacy envelope changed: %s %v", raw, err)
	}
}
