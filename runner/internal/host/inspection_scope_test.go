package host

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func TestInspectionAllCanonicalPlannerSourcesAndNoNodeAuthority(t *testing.T) {
	review := initialPlanningDispatch()
	review.TaskPlanningSource = nil
	review.TaskReviewSource = &protocol.TaskReviewSource{SourceID: "source", OperationID: "review", OperationVersion: 1, FeedbackID: "feedback", Purpose: "route_feedback", PlanID: "plan", SpecificationID: "spec", ReviewResultDigest: strings.Repeat("b", 64), ContextDigest: strings.Repeat("a", 64)}
	for _, source := range []struct {
		name     string
		dispatch protocol.Dispatch
	}{
		{"todo", todoDispatch()}, {"initial", initialPlanningDispatch()}, {"conversation", conversationSourceDispatch()}, {"replan", replanHostDispatch()}, {"review", review},
	} {
		t.Run(source.name, func(t *testing.T) {
			dispatch := source.dispatch
			i := protocol.InspectionDescriptor{SchemaVersion: 1, InspectionID: "inspection", AttemptID: dispatch.AttemptID, DispatchID: dispatch.DispatchID, ProjectID: "project", RunnerID: dispatch.RunnerID, ScopeKind: "task", Resource: protocol.WorkspaceResource{ResourceID: "repo", RemoteURL: "https://github.com/example/repo.git", RepositoryIdentity: "github.com/example/repo"}, Origin: protocol.InspectionOrigin{Kind: "default_ref"}}
			p := protocol.InspectionPlannerSource{ControlVersion: dispatch.ControlVersion, SourceWatermark: dispatch.SourceWatermark}
			switch {
			case dispatch.TodoID != nil:
				i.ScopeKind = "todo"
				i.ScopeID = *dispatch.TodoID
				p.Kind = "todo_discussion"
				p.SourceID = *dispatch.SourceMessageID
				h := sha256.Sum256([]byte(dispatch.Prompt))
				p.ContextDigest = hex.EncodeToString(h[:])
			case dispatch.TaskPlanningSource != nil:
				p.Kind = "task_initial_planning"
				p.SourceID = dispatch.TaskPlanningSource.IntentID
				p.ContextDigest = dispatch.TaskPlanningSource.ContextDigest
			case dispatch.TaskConversationSource != nil:
				p.Kind = "task_conversation"
				p.SourceID = dispatch.TaskConversationSource.SourceID
				p.ContextDigest = dispatch.TaskConversationSource.ContextDigest
			case dispatch.TaskReplanSource != nil:
				p.Kind = "task_replan"
				p.SourceID = dispatch.TaskReplanSource.SourceID
				p.ContextDigest = dispatch.TaskReplanSource.ContextDigest
			case dispatch.TaskReviewSource != nil:
				p.Kind = "task_review"
				p.SourceID = dispatch.TaskReviewSource.SourceID
				p.ContextDigest = dispatch.TaskReviewSource.ContextDigest
			}
			if dispatch.TaskID != nil {
				i.ScopeID = *dispatch.TaskID
			}
			i.PlannerSource = p
			_, digest, _ := wire.Canonical(i)
			op := protocol.Operation{Kind: protocol.KindInspectRepository, AttemptID: dispatch.AttemptID, DispatchID: dispatch.DispatchID, OperationID: "inspection", ResourceID: ptr("repo"), Inspection: &i, InspectionDigest: &digest}
			if e := ValidateEffectScope(dispatch, op); e != nil {
				t.Fatal("canonical Planner denied", e)
			}
			for _, mutate := range []func(*protocol.Operation){func(op *protocol.Operation) { op.Workspace = &protocol.WorkspaceDescriptor{} }, func(op *protocol.Operation) { op.RepositoryFree = ptr(true) }, func(op *protocol.Operation) { op.InspectionDigest = ptr(strings.Repeat("f", 64)) }, func(op *protocol.Operation) { op.ResourceID = ptr("foreign") }} {
				bad := op
				mutate(&bad)
				if ValidateEffectScope(dispatch, bad) == nil {
					t.Fatal("mixed authority accepted")
				}
			}
			dispatch.Kind = protocol.Node
			if ValidateEffectScope(dispatch, op) == nil {
				t.Fatal("Node admitted inspection")
			}
		})
	}
}
