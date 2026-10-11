package adapter

import (
	"io"
	"os/exec"
	"strings"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
)

func initialPlanner() protocol.Dispatch {
	task := "task"
	return protocol.Dispatch{AttemptID: "planning-attempt", TaskID: &task, Kind: "planner", RuntimeID: protocol.Opencode, Model: host.FreeModel, Prompt: "the exact frozen Task-only planning context", TaskPlanningSource: &protocol.TaskPlanningSource{IntentID: "intent", SpecificationID: "spec", ContextDigest: strings.Repeat("a", 64)}, WorkspaceReservations: &protocol.WorkspaceReservations{ProjectID: "project", Resources: []protocol.WorkspaceReservation{}}}
}

func TestInitialPlannerHasPhaseSpecificProtocolAndFreshScratchInvocation(t *testing.T) {
	d := initialPlanner()
	text := fixedProtocol(d)
	for _, required := range []string{"initial Execution Task Planner", `planning_intent_id "intent"`, "monos publish_execution_plan", "monos raise_planning_issue", "same acyclic graph", "hard_requirements", "expected_outputs", "1..256 Nodes", "execute serially", "Nonempty consumes is unsupported", "Never use commit_task_turn", "Todo Discussion", "monos inspect_repository", "same retained request ID", "do not execute the Node"} {
		if !strings.Contains(text, required) {
			t.Fatal("initial planning fixed protocol missing", required)
		}
	}
	config, err := Config(d)
	assertPlannerPermissions(t, config)
	if err != nil {
		t.Fatal("initial Planner lost scratch/CLI permissions", err)
	}
	calls := 0
	err = runWithPreflight(d, func(cmd *exec.Cmd) error {
		if cmd.Dir != host.Path(d.AttemptID, "scratch") {
			t.Error("initial Planner left its reserved scratch directory")
		}
		calls++
		raw, err := io.ReadAll(cmd.Stdin)
		if err != nil || string(raw) != d.Prompt {
			t.Error("frozen planning context was changed", err)
		}
		for _, forbidden := range []string{"--session", "--continue", "fixture.git", d.Prompt} {
			if strings.Contains(strings.Join(cmd.Args, " "), forbidden) {
				t.Error("session/repository/prompt leaked into invocation arguments", forbidden)
			}
		}
		return nil // A bare process exit must not synthesize another planning run.
	}, outputSink{stdout: io.Discard, stderr: io.Discard}, successfulTestPreflight)
	if err != nil || calls != 1 {
		t.Fatal("initial planning invocation changed", calls, err)
	}
	for _, other := range []protocol.Dispatch{{Kind: protocol.Node}, {Kind: "planner"}, {Kind: "planner", WorkspaceReservations: d.WorkspaceReservations}} {
		if strings.Contains(fixedProtocol(other), "monos publish_execution_plan") {
			t.Fatal("another phase inherited initial planning instructions")
		}
	}
}

func TestMalformedInitialPlannerDoesNotReachModelPreflight(t *testing.T) {
	d := initialPlanner()
	d.Kind = protocol.Node
	calls := 0
	err := runWithSink(d, func(*exec.Cmd) error { calls++; return nil }, outputSink{stdout: io.Discard, stderr: io.Discard})
	if err == nil || calls != 0 {
		t.Fatal("hybrid Node/initial Planner reached the Runtime", calls, err)
	}
}
