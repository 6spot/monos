package adapter

import (
	"io"
	"os/exec"
	"strings"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
)

func conversationPlanner() protocol.Dispatch {
	d := initialPlanner()
	d.TaskPlanningSource = nil
	d.ControlVersion = 7
	d.SourceWatermark = 3
	d.TaskConversationSource = &protocol.TaskConversationSource{SourceID: "source", InputID: "input", ConversationVersion: 7, SourceWatermark: 3, ContextDigest: strings.Repeat("a", 64)}
	d.Prompt = "frozen Task input and guidance: 保留精确内容"
	return d
}

func TestConversationUsesFrozenOneShotPromptAndExplicitTaskTools(t *testing.T) {
	d := conversationPlanner()
	d.TaskConversationSource.ReplyOnly = true
	text := fixedProtocol(d)
	for _, required := range []string{`source_id "source"`, `input_id "input"`, "source_watermark 3", "monos read_task_context", "monos read_task_history", "monos commit_task_turn", "fixed conversation source version", "separate basis", "re-evaluate", "conversation-only", "Owner Stop", "not Retry/Continue", "original immutable request"} {
		if !strings.Contains(text, required) {
			t.Fatal("conversation protocol missing", required)
		}
	}
	config, err := Config(d)
	assertPlannerPermissions(t, config)
	if err != nil {
		t.Fatal("conversation scratch/CLI permission mismatch", err)
	}
	calls := 0
	err = runWithPreflight(d, func(cmd *exec.Cmd) error {
		if cmd.Dir != host.Path(d.AttemptID, "scratch") {
			t.Fatal("conversation left scratch")
		}
		calls++
		raw, err := io.ReadAll(cmd.Stdin)
		if err != nil || string(raw) != d.Prompt {
			t.Fatal("frozen conversation input changed", err)
		}
		for _, forbidden := range []string{"--session", "--continue", "fixture.git", d.Prompt} {
			if strings.Contains(strings.Join(cmd.Args, " "), forbidden) {
				t.Fatal("conversation gained provider resume/repository access", forbidden)
			}
		}
		return nil
	}, outputSink{stdout: io.Discard, stderr: io.Discard}, successfulTestPreflight)
	if err != nil || calls != 1 {
		t.Fatal("conversation synthesized follow-up run", calls, err)
	}
	d.ControlVersion++
	calls = 0
	if err = runWithSink(d, func(*exec.Cmd) error { calls++; return nil }, outputSink{stdout: io.Discard, stderr: io.Discard}); err == nil || calls != 0 {
		t.Fatal("invalid conversation source reached preflight")
	}
}

func TestNodeGuidanceProtocolRequiresExplicitDeclaration(t *testing.T) {
	d := protocol.Dispatch{Kind: protocol.Node, NodeExecutionSource: &protocol.NodeExecutionSource{}}
	text := fixedProtocol(d)
	for _, required := range []string{"handled_guidance_ids", "omission or [] declares none", "still-required launch instruction", "block_node", "original request and manifest", "Receiving guidance is not proof of handling"} {
		if !strings.Contains(text, required) {
			t.Fatal("missing guidance completion contract", required)
		}
	}
}
