package host

import (
	"fmt"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

// Select only after checking the entire parent. Projection is result data, never
// a fabricated Operation with a different immutable identity.
func selectedCompletionEvidence(parent protocol.Operation, result protocol.EffectResult, resource, workspace string) (*protocol.WorkspaceCompletionInput, *protocol.WorkspaceEffectResult, error) {
	if err := wire.ValidateCompletionResult(parent, result); err != nil {
		return nil, nil, err
	}
	for i := range parent.Workspaces {
		input := &parent.Workspaces[i]
		if input.Workspace.ResourceID == resource && input.Workspace.WorkspaceID == workspace {
			return input, &result.WorkspaceResults[i], nil
		}
	}
	return nil, nil, fmt.Errorf("completion does not contain selected workspace")
}

func workspaceResultProjection(item protocol.WorkspaceEffectResult) protocol.EffectResult {
	return protocol.EffectResult{WriterAbsent: ptr(true), WorkspaceID: &item.WorkspaceID, WorkspaceMetadata: &item.WorkspaceMetadata, GitCommit: item.GitCommit, GitTree: item.GitTree}
}
