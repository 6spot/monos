package adapter

import (
	protocol "monos.local/protocol"
	"strings"
	"testing"
)

func TestReplanPromptAndReadOnlyConfiguration(t *testing.T) {
	d := initialPlanner()
	d.TaskPlanningSource = nil
	d.TaskReplanSource = &protocol.TaskReplanSource{RequestID: "replan", SourceID: "source", PlanID: "plan", SpecificationID: "spec", ContextDigest: strings.Repeat("a", 64)}
	text := fixedProtocol(d)
	for _, term := range []string{`replan_request_id "replan"`, `source_id "source"`, "monos prepare_replan", "monos raise_planning_issue", "Preparation is terminal", "Do not remain alive waiting for confirmation", "new node_id", "checkpoint", "same retained request ID", "Repository inspection is unavailable"} {
		if !strings.Contains(text, term) {
			t.Fatal("missing protocol", term)
		}
	}
	config, err := Config(d)
	assertPlannerPermissions(t, config)
	if err != nil {
		t.Fatal(config, err)
	}
	d.ControlVersion++
	if _, err = Config(d); err == nil {
		t.Fatal("mismatched source version accepted")
	}
}
