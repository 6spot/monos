package adapter

import (
	protocol "monos.local/protocol"
	"strings"
	"testing"
)

func TestSpecificationPromptSeparatesProposalAuthorizationAndTurnOutcome(t *testing.T) {
	text := fixedProtocol(conversationPlanner())
	for _, required := range []string{"monos prepare_specification_revision", "complete specification Markdown", "full impact", "source_input_ids", "unchanged sufficient graph", "not publication or a terminal outcome", "Unattached drafts cannot be confirmed", "monos apply_specification_revision", "existing exact Owner receipt", "never infer authorization", "not proof of publication or implementation", "still close this turn with commit_task_turn", "Do not remain alive waiting for settlement", "fresh proposal and authorization"} {
		if !strings.Contains(text, required) {
			t.Fatal("missing requirement boundary", required)
		}
	}
	for _, d := range []string{fixedProtocol(initialPlanner()), fixedProtocol(protocol.Dispatch{Kind: protocol.Node, NodeExecutionSource: &protocol.NodeExecutionSource{}})} {
		if strings.Contains(d, "monos prepare_specification_revision") || strings.Contains(d, "monos apply_specification_revision") {
			t.Fatal("another phase advertised requirement commands")
		}
	}
	d := conversationPlanner()
	d.TaskConversationSource.ReplyOnly = true
	if !strings.Contains(fixedProtocol(d), "no prepare_specification_revision, apply_specification_revision") {
		t.Fatal("terminal prompt advertised mutation")
	}
}
