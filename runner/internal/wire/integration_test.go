package wire

import (
	"encoding/json"
	"strings"
	"testing"

	protocol "monos.local/protocol"
)

func TestTerminalIntegrationSettlementKeepsConflictDistinct(t *testing.T) {
	for _, outcome := range []protocol.WorkspaceIntegrationResultOutcome{protocol.Integrated, protocol.Conflict} {
		t.Run(string(outcome), func(t *testing.T) {
			str := func(v string) *string { return &v }
			w := &protocol.WorkspaceDescriptor{SchemaVersion: 1, WorkspaceID: "workspace", TaskID: "task", ProjectID: "project", ResourceID: "repo", RunnerID: "runner", Generation: 1, LeaseID: "lease", NodeID: "node", NodeActivation: 1, OpenOperationID: "open", Resource: protocol.WorkspaceResource{ResourceID: "repo", RepositoryIdentity: "github.com/example/repo", RemoteURL: "https://github.com/example/repo.git"}, Isolation: &protocol.WorkspaceIsolation{AllocationID: "allocation"}}
			_, wd, _ := Canonical(w)
			original := protocol.Operation{SchemaVersion: 1, OperationID: "complete", AttemptID: "attempt", DispatchID: "dispatch", RequestID: "request", Kind: protocol.KindCompleteNode, State: protocol.FluffyAdmitted, ResourceID: str("repo"), Workspace: w, WorkspaceDigest: &wd, CompletionManifestDigest: str(strings.Repeat("a", 64)), Integration: &protocol.WorkspaceIntegration{ExpectedTaskCommit: strings.Repeat("a", 40)}}
			digest, _ := OperationIdentity(original)
			settle := original
			settle.Kind, settle.OperationID, settle.RequestID = protocol.SettleCompletion, "settle", "correct"
			settle.Integration, settle.CompletionManifestDigest = nil, nil
			settle.CompletionOperationID, settle.CompletionIdentityDigest = str(original.OperationID), &digest
			i := &protocol.WorkspaceIntegrationResult{Outcome: outcome, StartCommit: strings.Repeat("a", 40), NodeCommit: strings.Repeat("b", 40), NodeTree: strings.Repeat("c", 40), ExpectedTaskCommit: strings.Repeat("a", 40), TaskCommit: strings.Repeat("d", 40), TaskTree: strings.Repeat("e", 40)}
			absent := true
			m := &protocol.WorkspaceMetadata{StorageID: "storage", Generation: 1, LeaseID: "lease", RepositoryIdentity: w.Resource.RepositoryIdentity, BaseCommit: i.StartCommit, TargetBranch: "main", TargetCommit: i.StartCommit, FinalizedCommit: i.TaskCommit, Isolation: &protocol.WorkspaceIsolationMetadata{AllocationID: "allocation", StartCommit: i.StartCommit}}
			r := protocol.EffectResult{WriterAbsent: &absent, WorkspaceID: str(w.WorkspaceID), WorkspaceMetadata: m, Integration: i, GitCommit: str(i.TaskCommit), GitTree: str(i.TaskTree)}
			if outcome == protocol.Conflict {
				i.TaskCommit, m.FinalizedCommit = i.ExpectedTaskCommit, i.StartCommit
				r.GitCommit, r.GitTree = nil, nil
			}
			pair := protocol.OperationResult{OperationID: settle.OperationID, AttemptID: settle.AttemptID, Success: true, Result: protocol.EffectResult{WriterAbsent: &absent}, CompletionSettlement: &protocol.CompletionSettlement{CompletionOperationID: original.OperationID, Disposition: protocol.AlreadyFinalized, CompletionResult: protocol.CompletionOperationResult{OperationID: original.OperationID, AttemptID: original.AttemptID, Success: true, Result: r}}}
			if err := ValidateCompletionPair(settle, original, pair); err != nil {
				t.Fatal(err)
			}
			for _, field := range []string{"expected", "allocation", "start", "missing", "false-git"} {
				raw, _ := json.Marshal(pair)
				var bad protocol.OperationResult
				_ = json.Unmarshal(raw, &bad)
				result := &bad.CompletionSettlement.CompletionResult.Result
				switch field {
				case "expected":
					result.Integration.ExpectedTaskCommit = strings.Repeat("f", 40)
				case "allocation":
					result.WorkspaceMetadata.Isolation.AllocationID = "another-allocation"
				case "start":
					result.Integration.StartCommit = strings.Repeat("f", 40)
				case "missing":
					result.Integration = nil
				case "false-git":
					result.GitCommit = str(strings.Repeat("f", 40))
				}
				if ValidateCompletionPair(settle, original, bad) == nil {
					t.Fatalf("accepted changed %s", field)
				}
			}
		})
	}
}
