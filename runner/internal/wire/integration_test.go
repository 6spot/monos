package wire

import (
	"encoding/json"
	"strings"
	"testing"

	protocol "monos.local/protocol"
)

func completionFixture(t *testing.T, conflict bool) (protocol.Operation, protocol.EffectResult) {
	t.Helper()
	str := func(s string) *string { return &s }
	absent := true
	outcome := "finalized"
	if conflict {
		outcome = "conflict"
	}
	op := protocol.Operation{SchemaVersion: 1, OperationID: "complete", AttemptID: "attempt", DispatchID: "dispatch", RequestID: "request", Kind: protocol.KindCompleteNode, State: protocol.FluffyAdmitted, CompletionManifestDigest: str(strings.Repeat("a", 64)), Workspaces: []protocol.WorkspaceCompletionInput{}}
	result := protocol.EffectResult{WriterAbsent: &absent, CompletionOutcome: &outcome, WorkspaceResults: []protocol.WorkspaceEffectResult{}}
	for _, name := range []string{"a", "b"} {
		w := protocol.WorkspaceDescriptor{SchemaVersion: 1, WorkspaceID: "workspace-" + name, TaskID: "task", ProjectID: "project", ResourceID: name, RunnerID: "runner", Generation: 1, LeaseID: "lease-" + name, NodeID: "node", NodeActivation: 1, OpenOperationID: "open-" + name, Resource: protocol.WorkspaceResource{ResourceID: name, RepositoryIdentity: "github.com/example/" + name, RemoteURL: "https://github.com/example/" + name + ".git"}, Isolation: &protocol.WorkspaceIsolation{AllocationID: "allocation-" + name}}
		_, wd, err := Canonical(w)
		if err != nil {
			t.Fatal(err)
		}
		start, node, tree, task, taskTree := strings.Repeat("a", 40), strings.Repeat("b", 40), strings.Repeat("c", 40), strings.Repeat("d", 40), strings.Repeat("e", 40)
		op.Workspaces = append(op.Workspaces, protocol.WorkspaceCompletionInput{Workspace: w, WorkspaceDigest: wd, Integration: &protocol.WorkspaceIntegration{ExpectedTaskCommit: start}})
		m := protocol.WorkspaceMetadata{StorageID: "storage", Generation: 1, LeaseID: w.LeaseID, RepositoryIdentity: w.Resource.RepositoryIdentity, BaseCommit: start, TargetBranch: "main", TargetCommit: start, FinalizedCommit: task, Isolation: &protocol.WorkspaceIsolationMetadata{AllocationID: w.Isolation.AllocationID, StartCommit: start}}
		i := &protocol.WorkspaceIntegrationResult{Outcome: protocol.Integrated, StartCommit: start, NodeCommit: node, NodeTree: tree, ExpectedTaskCommit: start, TaskCommit: task, TaskTree: taskTree}
		item := protocol.WorkspaceEffectResult{ResourceID: name, WorkspaceID: w.WorkspaceID, WorkspaceMetadata: m, Capture: &protocol.WorkspaceCaptureResult{StartCommit: start, NodeCommit: node, NodeTree: tree}, GitCommit: &task, GitTree: &taskTree, Integration: i}
		if conflict {
			item.GitCommit, item.GitTree = nil, nil
			item.WorkspaceMetadata.FinalizedCommit = start
			if name == "a" {
				item.Integration = nil
			} else {
				i.Outcome = protocol.Conflict
				i.TaskCommit = start
			}
		}
		result.WorkspaceResults = append(result.WorkspaceResults, item)
	}
	return op, result
}

func TestTerminalCompletionValidatesWholeCollection(t *testing.T) {
	for _, conflict := range []bool{false, true} {
		op, result := completionFixture(t, conflict)
		if err := ValidateCompletionResult(op, result); err != nil {
			t.Fatal(err)
		}
		digest, _ := OperationIdentity(op)
		settle := protocol.Operation{SchemaVersion: 1, OperationID: "settle", AttemptID: op.AttemptID, DispatchID: op.DispatchID, RequestID: "settle-request", Kind: protocol.SettleCompletion, State: protocol.FluffyAdmitted, CompletionOperationID: &op.OperationID, CompletionIdentityDigest: &digest}
		absent := true
		pair := protocol.OperationResult{OperationID: settle.OperationID, AttemptID: op.AttemptID, Success: true, Result: protocol.EffectResult{WriterAbsent: &absent}, CompletionSettlement: &protocol.CompletionSettlement{CompletionOperationID: op.OperationID, Disposition: protocol.AlreadyFinalized, CompletionResult: protocol.CompletionOperationResult{OperationID: op.OperationID, AttemptID: op.AttemptID, Success: true, Result: result}}}
		if err := ValidateCompletionPair(settle, op, pair); err != nil {
			t.Fatal(err)
		}
		for _, mutation := range []string{"missing", "duplicate", "reordered", "wrong-allocation", "wrong-start", "wrong-input", "no-capture", "false-publication"} {
			t.Run(outcomeName(conflict)+"/"+mutation, func(t *testing.T) {
				original, bad := completionFixture(t, conflict)
				switch mutation {
				case "missing":
					bad.WorkspaceResults = bad.WorkspaceResults[:1]
				case "duplicate":
					bad.WorkspaceResults[1] = bad.WorkspaceResults[0]
				case "reordered":
					bad.WorkspaceResults[0], bad.WorkspaceResults[1] = bad.WorkspaceResults[1], bad.WorkspaceResults[0]
				case "wrong-allocation":
					bad.WorkspaceResults[1].WorkspaceMetadata.Isolation.AllocationID = "other"
				case "wrong-start":
					bad.WorkspaceResults[1].Capture.StartCommit = strings.Repeat("f", 40)
				case "wrong-input":
					bad.WorkspaceResults[1].Integration.ExpectedTaskCommit = strings.Repeat("f", 40)
				case "no-capture":
					bad.WorkspaceResults[1].Capture = nil
				case "false-publication":
					if conflict {
						commit := strings.Repeat("f", 40)
						bad.WorkspaceResults[0].GitCommit = &commit
						bad.WorkspaceResults[0].GitTree = &commit
					} else {
						bad.WorkspaceResults[1].Integration = nil
					}
				}
				if err := ValidateCompletionResult(original, bad); err == nil {
					t.Fatal("accepted changed collection")
				}
			})
		}
	}
}
func outcomeName(conflict bool) string {
	if conflict {
		return "conflict"
	}
	return "finalized"
}

func TestCompletionEmptyCollectionsSurviveMarshal(t *testing.T) {
	op, result := completionFixture(t, false)
	op.Workspaces = op.Workspaces[:0]
	result.WorkspaceResults = result.WorkspaceResults[:0]
	for name, value := range map[string]any{"Operation": op, "EffectResult": result} {
		raw, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		if err = Validate(name, raw); err != nil {
			t.Fatal(err)
		}
		if name == "Operation" {
			var decoded protocol.Operation
			if err := Decode(name, raw, &decoded); err != nil || decoded.Workspaces == nil || len(decoded.Workspaces) != 0 {
				t.Fatal("explicit empty completion inputs were lost", err)
			}
		} else {
			var decoded protocol.EffectResult
			if err := Decode(name, raw, &decoded); err != nil || decoded.WorkspaceResults == nil || len(decoded.WorkspaceResults) != 0 {
				t.Fatal("explicit empty completion results were lost", err)
			}
		}
	}
	if err := ValidateCompletionResult(op, result); err != nil {
		t.Fatal(err)
	}
	missing := result
	missing.WorkspaceResults = nil
	if err := ValidateCompletionResult(op, missing); err == nil {
		t.Fatal("accepted missing empty result")
	}
}

func TestCompletionInputMembershipAndScope(t *testing.T) {
	for _, mutation := range []string{"missing", "duplicate-resource", "duplicate-workspace", "duplicate-lease", "reordered", "foreign-task", "foreign-node", "foreign-activation", "foreign-runner", "foreign-project", "wrong-digest", "missing-integration"} {
		t.Run(mutation, func(t *testing.T) {
			op, _ := completionFixture(t, false)
			member := &op.Workspaces[1]
			switch mutation {
			case "missing":
				op.Workspaces = nil
			case "duplicate-resource":
				member.Workspace.ResourceID = op.Workspaces[0].Workspace.ResourceID
				member.Workspace.Resource.ResourceID = member.Workspace.ResourceID
			case "duplicate-workspace":
				member.Workspace.WorkspaceID = op.Workspaces[0].Workspace.WorkspaceID
			case "duplicate-lease":
				member.Workspace.LeaseID = op.Workspaces[0].Workspace.LeaseID
			case "reordered":
				op.Workspaces[0], op.Workspaces[1] = op.Workspaces[1], op.Workspaces[0]
			case "foreign-task":
				member.Workspace.TaskID = "other-task"
			case "foreign-node":
				member.Workspace.NodeID = "other-node"
			case "foreign-activation":
				member.Workspace.NodeActivation++
			case "foreign-runner":
				member.Workspace.RunnerID = "other-runner"
			case "foreign-project":
				member.Workspace.ProjectID = "other-project"
			case "wrong-digest":
				member.WorkspaceDigest = strings.Repeat("0", 64)
			case "missing-integration":
				member.Integration = nil
			}
			// Rehash changed descriptors so scope/uniqueness assertions do not
			// accidentally pass merely because a digest went stale.
			if mutation != "wrong-digest" {
				for index := range op.Workspaces {
					_, hash, err := Canonical(op.Workspaces[index].Workspace)
					if err != nil {
						t.Fatal(err)
					}
					op.Workspaces[index].WorkspaceDigest = hash
				}
			}
			if err := ValidateCompletionInputs(op); err == nil {
				t.Fatal("accepted invalid completion membership")
			}
		})
	}
}

func TestCompletionSelectionValidatesSiblingsBeforeProjection(t *testing.T) {
	for _, conflict := range []bool{false, true} {
		op, result := completionFixture(t, conflict)
		selected, err := SelectWorkspaceResult(op, result, "b")
		if err != nil || selected.ResourceID != "b" || selected.WorkspaceID != "workspace-b" || selected.WorkspaceMetadata.LeaseID != "lease-b" {
			t.Fatal("did not select exact second repository", err)
		}
		if _, err := SelectWorkspaceResult(op, result, "outside"); err == nil {
			t.Fatal("selected resource outside retained completion")
		}
		result.WorkspaceResults[0].Capture = nil
		if _, err := SelectWorkspaceResult(op, result, "b"); err == nil {
			t.Fatal("selected a valid item from an invalid parent result")
		}
	}
}
