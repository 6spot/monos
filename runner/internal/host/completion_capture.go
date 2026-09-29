package host

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	protocol "monos.local/protocol"
)

// Only a private ref or HEAD at the exact frozen result proves that completion
// passed its commit stage. An intent alone is not an integrated result and must
// not make a correction request silently run a fresh completion.
func reconcileFinalization(workspace, common, operation, base string) (*protocol.EffectResult, error) {
	ref := "refs/monos/operations/" + operation
	_, err := git(workspace, "show-ref", "--verify", "--quiet", ref)
	refAbsent := false
	commit := ""
	if err != nil {
		var exit *exec.ExitError
		if !errors.As(err, &exit) || exit.ExitCode() != 1 {
			return nil, err
		}
		refAbsent = true
	} else {
		commit, err = git(workspace, "show-ref", "--verify", "--hash", ref)
		if err != nil {
			return nil, err
		}
	}
	raw, readErr := os.ReadFile(filepath.Join(common, "monos-finalization-"+operation+".json"))
	if readErr != nil && !os.IsNotExist(readErr) {
		return nil, readErr
	}
	var intent finalizationIntent
	valid := readErr == nil && json.Unmarshal(raw, &intent) == nil && validateFinalizationIntent(intent) == nil && intent.Base == base
	if !valid {
		if !refAbsent {
			return nil, fmt.Errorf("completion ref exists without valid retained intent; reconciliation required")
		}
		return nil, nil // preserve malformed bytes; recovery writes a separate intent
	}
	if err = requireAncestor(workspace, base, intent.Parent); err != nil {
		if !refAbsent || ClassifyFailure(err) != protocol.InvalidFinalization {
			return nil, err
		}
		return nil, nil
	}
	expected, err := gitEnv(workspace, []string{"GIT_AUTHOR_DATE=" + intent.Date, "GIT_COMMITTER_DATE=" + intent.Date}, "commit-tree", intent.Tree, "-p", intent.Parent, "-m", "monos private probe finalization "+operation)
	if err != nil {
		return nil, err
	}
	head, err := git(workspace, "rev-parse", "HEAD")
	if err != nil {
		return nil, err
	}
	if refAbsent && head != expected {
		return nil, nil
	}
	if !refAbsent && commit != expected {
		return nil, fmt.Errorf("completion ref differs from frozen intent")
	}
	if head != expected && head != intent.Parent {
		return nil, fmt.Errorf("completion HEAD differs from frozen parent/result")
	}
	result, err := finalize(workspace, common, operation, base)
	if err != nil {
		return nil, err
	}
	return &result, nil
}

type completionRecoveryIntent struct {
	Finalization    finalizationIntent `json:"capture"`
	CompletionID    string             `json:"completion_operation_id"`
	IdentityDigest  string             `json:"completion_identity_digest"`
	OldIntentDigest *string            `json:"old_intent_digest"`
}

func retainedIntentDigest(common, operation string) (*string, error) {
	raw, err := os.ReadFile(filepath.Join(common, "monos-finalization-"+operation+".json"))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(raw)
	digest := hex.EncodeToString(sum[:])
	return &digest, nil
}

// Recovery alone may capture a readable unrelated HEAD. This never updates HEAD,
// the real index, finalized revision, old intent/ref, or ignored local files.
func completionRecoveryCheckpoint(workspace, common, operation, original, identity, base string) (protocol.WorkspaceCheckpoint, error) {
	var cp protocol.WorkspaceCheckpoint
	p := filepath.Join(common, "monos-completion-recovery-"+operation+".json")
	oldDigest, err := retainedIntentDigest(common, original)
	if err != nil {
		return cp, err
	}
	var intent completionRecoveryIntent
	raw, err := os.ReadFile(p)
	if err == nil {
		if json.Unmarshal(raw, &intent) != nil || validateFinalizationIntent(intent.Finalization) != nil || intent.Finalization.Base != base || intent.CompletionID != original || intent.IdentityDigest != identity || !sameOptionalString(intent.OldIntentDigest, oldDigest) {
			return cp, fmt.Errorf("completion recovery capture identity changed")
		}
	} else if !os.IsNotExist(err) {
		return cp, err
	} else {
		head, e := git(workspace, "rev-parse", "HEAD")
		if e != nil {
			return cp, e
		}
		tree, e := privateTree(workspace, common)
		if e != nil {
			return cp, e
		}
		intent = completionRecoveryIntent{Finalization: finalizationIntent{Base: base, Parent: head, Tree: tree, Date: time.Now().UTC().Format(time.RFC3339)}, CompletionID: original, IdentityDigest: identity, OldIntentDigest: oldDigest}
		if err = saveRecord(p, intent); err != nil {
			return cp, captureFailure(err)
		}
	}
	i := intent.Finalization
	head, err := git(workspace, "rev-parse", "HEAD")
	if err != nil || head != i.Parent {
		return cp, fmt.Errorf("recovery HEAD changed before capture replay")
	}
	tree, err := privateTree(workspace, common)
	if err != nil {
		return cp, err
	}
	if tree != i.Tree {
		return cp, fmt.Errorf("recovery private files changed before capture replay")
	}
	commit, err := gitEnv(workspace, []string{"GIT_AUTHOR_DATE=" + i.Date, "GIT_COMMITTER_DATE=" + i.Date}, "commit-tree", i.Tree, "-p", i.Parent, "-m", "monos private completion recovery "+operation)
	if err != nil {
		return cp, err
	}
	if _, err = git(workspace, "update-ref", "refs/monos/checkpoints/"+operation, commit); err != nil {
		return cp, err
	}
	return protocol.WorkspaceCheckpoint{OperationID: operation, HeadCommit: i.Parent, TreeID: i.Tree, CommitID: commit, CompletionOperationID: &original, CompletionIdentityDigest: &identity}, nil
}

func sameOptionalString(a, b *string) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}
