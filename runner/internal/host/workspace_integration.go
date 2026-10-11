package host

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// WorkspaceTaskFinalizedRef belongs to the service-owned bare Task repository.
// Its initial value must be pinned by workspace materialization before integration.
const WorkspaceTaskFinalizedRef = "refs/monos/task-finalized"

var (
	ErrWorkspaceIntegrationConflict = errors.New("workspace integration conflict")
	ErrWorkspaceIntegrationRevision = errors.New("workspace integration revision changed")
	ErrWorkspaceIntegrationIdentity = errors.New("workspace integration identity mismatch")
)

type WorkspaceIntegrationInput struct {
	OperationID        string `json:"operation_id"`
	TaskRepository     string `json:"task_repository"`
	ExpectedTaskCommit string `json:"expected_task_commit"`
	NodeRepository     string `json:"node_repository"`
	NodeStartCommit    string `json:"node_start_commit"`
	NodeCommit         string `json:"node_commit"`
	NodeTree           string `json:"node_tree"`
}

type WorkspaceIntegrationResult struct {
	OperationID        string `json:"operation_id"`
	Outcome            string `json:"outcome"`
	StartCommit        string `json:"start_commit"`
	NodeCommit         string `json:"node_commit"`
	NodeTree           string `json:"node_tree"`
	ExpectedTaskCommit string `json:"expected_task_commit"`
	TaskCommit         string `json:"task_commit"`
	TaskTree           string `json:"task_tree"`
	OperationRef       string `json:"operation_ref"`
	ConflictTree       string `json:"conflict_tree,omitempty"`
}

type workspaceIntegrationIntent struct {
	Input          WorkspaceIntegrationInput   `json:"input"`
	Date           string                      `json:"date"`
	TaskBeforeTree string                      `json:"task_before_tree"`
	Result         *WorkspaceIntegrationResult `json:"result,omitempty"`
}

// IntegrateWorkspace consumes an admitted, fenced completion's protected export.
// The caller owns Attempt authorization, writer absence, cancellation settlement
// and retention. Once started, cancellation must reconcile this same operation;
// a cancelled context is not evidence that the physical integration did not run.
// Both repositories and their parents must already be private service storage.
func IntegrateWorkspace(ctx context.Context, input WorkspaceIntegrationInput) (WorkspaceIntegrationResult, error) {
	return integrateWorkspace(ctx, input, nil)
}

// afterStage injects process-loss boundaries in local Git tests without a global
// hook or an alternate implementation of the physical effect.
func integrateWorkspace(ctx context.Context, input WorkspaceIntegrationInput, afterStage func(string) error) (WorkspaceIntegrationResult, error) {
	return workspaceIntegrationPhase(ctx, input, true, true, afterStage)
}

// PrepareWorkspaceIntegration protects the complete integration result without
// advancing either canonical ref. A parent completion decides publication only
// after every repository has reached this boundary.
func PrepareWorkspaceIntegration(ctx context.Context, input WorkspaceIntegrationInput) (WorkspaceIntegrationResult, error) {
	return workspaceIntegrationPhase(ctx, input, false, true, nil)
}

// PublishWorkspaceIntegration revalidates the original prepared intent and
// reconciles both refs. The caller must own the durable parent publish decision.
func PublishWorkspaceIntegration(ctx context.Context, input WorkspaceIntegrationInput) (WorkspaceIntegrationResult, error) {
	return workspaceIntegrationPhase(ctx, input, true, false, nil)
}

func workspaceIntegrationPhase(ctx context.Context, input WorkspaceIntegrationInput, publish, allowPrepare bool, afterStage func(string) error) (WorkspaceIntegrationResult, error) {
	var empty WorkspaceIntegrationResult
	if !ValidID(input.OperationID) || !objectID.MatchString(input.ExpectedTaskCommit) || !objectID.MatchString(input.NodeStartCommit) || !objectID.MatchString(input.NodeCommit) || !objectID.MatchString(input.NodeTree) {
		return empty, fmt.Errorf("%w: invalid operation or object identity", ErrWorkspaceIntegrationIdentity)
	}
	for _, path := range []string{input.TaskRepository, input.NodeRepository} {
		if !filepath.IsAbs(path) || filepath.Clean(path) != path || strings.ContainsAny(path, "\x00\r\n") {
			return empty, fmt.Errorf("%w: absolute canonical repository required", ErrWorkspaceIntegrationIdentity)
		}
	}
	if input.TaskRepository == input.NodeRepository {
		return empty, fmt.Errorf("%w: distinct Task and Node repositories required", ErrWorkspaceIntegrationIdentity)
	}
	if err := integrationRepository(ctx, input.TaskRepository); err != nil {
		return empty, err
	}
	lock, err := acquireFileLock(ctx, filepath.Join(input.TaskRepository, "monos-integration.lock"))
	if err != nil {
		return empty, err
	}
	defer releaseFileLock(lock)
	stage := func(name string) error {
		if afterStage != nil {
			return afterStage(name)
		}
		return nil
	}
	path := filepath.Join(input.TaskRepository, "monos-integration-"+input.OperationID+".json")
	operationRef := "refs/monos/integrations/" + input.OperationID
	inputRef := "refs/monos/integration-inputs/" + input.OperationID
	intent := workspaceIntegrationIntent{Input: input}
	if err = trustedFile(path, uint32(os.Geteuid())); err == nil {
		raw, readErr := os.ReadFile(path)
		if readErr != nil {
			return empty, readErr
		}
		d := json.NewDecoder(bytes.NewReader(raw))
		d.DisallowUnknownFields()
		var trailing any
		if err = d.Decode(&intent); err != nil || d.Decode(&trailing) != io.EOF || intent.Input != input {
			return empty, fmt.Errorf("%w: retained intent changed", ErrWorkspaceIntegrationIdentity)
		}
		if _, err = time.Parse(time.RFC3339, intent.Date); err != nil || !objectID.MatchString(intent.TaskBeforeTree) {
			return empty, fmt.Errorf("%w: malformed retained intent", ErrWorkspaceIntegrationIdentity)
		}
	} else if os.IsNotExist(err) {
		if !allowPrepare {
			return empty, fmt.Errorf("%w: publication requires retained preparation", ErrWorkspaceIntegrationIdentity)
		}
		prior, err := integrationRef(ctx, input.TaskRepository, operationRef)
		if err != nil || prior != "" {
			return empty, fmt.Errorf("%w: operation ref without intent (%v)", ErrWorkspaceIntegrationIdentity, err)
		}
		current, err := integrationRef(ctx, input.TaskRepository, WorkspaceTaskFinalizedRef)
		if err != nil {
			return empty, err
		}
		if current != input.ExpectedTaskCommit {
			return empty, integrationRevision(input.ExpectedTaskCommit, current)
		}
		intent.TaskBeforeTree, err = integrationGit(ctx, input.TaskRepository, "", "", "rev-parse", input.ExpectedTaskCommit+"^{tree}")
		if err != nil {
			return empty, err
		}
		intent.Date = time.Now().UTC().Format(time.RFC3339)
		if err = saveRecord(path, intent); err != nil {
			return empty, err
		}
	} else {
		return empty, err
	}
	if !allowPrepare && intent.Result == nil {
		return empty, fmt.Errorf("%w: publication requires prepared outcome", ErrWorkspaceIntegrationIdentity)
	}
	if err = stage("intent"); err != nil {
		return empty, err
	}

	// Import exact objects, never a branch selected by an Agent or FETCH_HEAD.
	// A protected local pin makes later replay independent of export retention.
	imported, err := integrationRef(ctx, input.TaskRepository, inputRef)
	if err != nil {
		return empty, err
	}
	if imported == "" {
		if err = integrationRepository(ctx, input.NodeRepository); err != nil {
			return empty, err
		}
		ref, err := integrationRef(ctx, input.NodeRepository, "refs/monos/result")
		if err != nil || ref != input.NodeCommit {
			return empty, fmt.Errorf("%w: protected Node export ref (%v)", ErrWorkspaceIntegrationIdentity, err)
		}
		if _, err = integrationGit(ctx, input.TaskRepository, "", "", "fetch", "--no-tags", "--no-write-fetch-head", "--no-auto-maintenance", input.NodeRepository, input.NodeCommit); err != nil {
			return empty, err
		}
		if err = integrationCreateRef(ctx, input.TaskRepository, inputRef, input.NodeCommit); err != nil {
			return empty, err
		}
	} else if imported != input.NodeCommit {
		return empty, fmt.Errorf("%w: retained Node export changed", ErrWorkspaceIntegrationIdentity)
	}
	for _, expected := range [][2]string{{input.NodeCommit, input.NodeTree}, {input.ExpectedTaskCommit, intent.TaskBeforeTree}} {
		tree, err := integrationGit(ctx, input.TaskRepository, "", "", "rev-parse", expected[0]+"^{tree}")
		if err != nil || tree != expected[1] {
			return empty, fmt.Errorf("%w: retained commit/tree changed (%v)", ErrWorkspaceIntegrationIdentity, err)
		}
		if _, err = integrationGit(ctx, input.TaskRepository, "", "", "merge-base", "--is-ancestor", input.NodeStartCommit, expected[0]); err != nil {
			return empty, fmt.Errorf("%w: commit does not descend from Node start: %v", ErrWorkspaceIntegrationIdentity, err)
		}
	}
	if err = stage("import"); err != nil {
		return empty, err
	}

	if intent.Result == nil {
		current, err := integrationRef(ctx, input.TaskRepository, WorkspaceTaskFinalizedRef)
		if err != nil {
			return empty, err
		}
		if current != input.ExpectedTaskCommit {
			return empty, integrationRevision(input.ExpectedTaskCommit, current)
		}
		// A synthetic input with exactly the recorded start as its sole parent
		// fixes the merge base even if the Agent merged other private histories.
		// merge-tree --write-tree is supported by Git 2.39; --merge-base is newer.
		synthetic, err := integrationGit(ctx, input.TaskRepository, "", intent.Date, "commit-tree", input.NodeTree, "-p", input.NodeStartCommit, "-m", "monos integration input "+input.OperationID)
		if err != nil {
			return empty, err
		}
		output, mergeErr := integrationGit(ctx, input.TaskRepository, "", "", "merge-tree", "--write-tree", input.ExpectedTaskCommit, synthetic)
		tree, _, _ := strings.Cut(output, "\n")
		conflict := integrationExit(mergeErr, 1)
		if mergeErr != nil && !conflict {
			return empty, mergeErr
		}
		if !objectID.MatchString(tree) {
			return empty, fmt.Errorf("invalid integration merge tree")
		}
		result := WorkspaceIntegrationResult{OperationID: input.OperationID, Outcome: "integrated", StartCommit: input.NodeStartCommit, NodeCommit: input.NodeCommit, NodeTree: input.NodeTree, ExpectedTaskCommit: input.ExpectedTaskCommit, TaskCommit: input.ExpectedTaskCommit, TaskTree: intent.TaskBeforeTree, OperationRef: operationRef}
		if conflict {
			result.Outcome, result.ConflictTree = "conflict", tree
			if err = integrationCreateRef(ctx, input.TaskRepository, "refs/monos/integration-conflicts/"+input.OperationID, tree); err != nil {
				return empty, err
			}
		} else {
			result.TaskTree = tree
			result.TaskCommit, err = integrationCommit(ctx, intent, tree)
			if err != nil {
				return empty, err
			}
			// Keep newly merged trees reachable even if recovery runs after GC.
			// This preparation ref grants no canonical integration/completion fact.
			if err = integrationCreateRef(ctx, input.TaskRepository, "refs/monos/integration-prepared/"+input.OperationID, result.TaskCommit); err != nil {
				return empty, err
			}
		}
		intent.Result = &result
		if err = saveRecord(path, intent); err != nil {
			return empty, err
		}
	}
	if err = stage("result"); err != nil {
		return empty, err
	}
	result := *intent.Result
	if result.OperationID != input.OperationID || result.StartCommit != input.NodeStartCommit || result.NodeCommit != input.NodeCommit || result.NodeTree != input.NodeTree || result.ExpectedTaskCommit != input.ExpectedTaskCommit || result.OperationRef != operationRef {
		return empty, fmt.Errorf("%w: retained result changed", ErrWorkspaceIntegrationIdentity)
	}
	if result.Outcome == "conflict" {
		if result.TaskCommit != input.ExpectedTaskCommit || result.TaskTree != intent.TaskBeforeTree || !objectID.MatchString(result.ConflictTree) {
			return empty, fmt.Errorf("%w: invalid conflict result", ErrWorkspaceIntegrationIdentity)
		}
		if err = integrationCreateRef(ctx, input.TaskRepository, "refs/monos/integration-conflicts/"+input.OperationID, result.ConflictTree); err != nil {
			return empty, err
		}
		return result, ErrWorkspaceIntegrationConflict
	}
	if result.Outcome != "integrated" || !objectID.MatchString(result.TaskTree) || !objectID.MatchString(result.TaskCommit) || result.ConflictTree != "" {
		return empty, fmt.Errorf("%w: invalid integration result", ErrWorkspaceIntegrationIdentity)
	}
	commit, err := integrationCommit(ctx, intent, result.TaskTree)
	if err != nil || commit != result.TaskCommit {
		return empty, fmt.Errorf("%w: retained integration commit changed (%v)", ErrWorkspaceIntegrationIdentity, err)
	}
	if !publish {
		return result, nil
	}
	if err = stage("before_refs"); err != nil {
		return empty, err
	}
	if err = integrationPublish(ctx, input.TaskRepository, result); err != nil {
		return empty, err
	}
	if err = stage("refs"); err != nil {
		return empty, err
	}
	return result, nil
}

func integrationCommit(ctx context.Context, intent workspaceIntegrationIntent, tree string) (string, error) {
	return integrationGit(ctx, intent.Input.TaskRepository, "", intent.Date, "commit-tree", tree, "-p", intent.Input.ExpectedTaskCommit, "-p", intent.Input.NodeCommit, "-m", "monos private integration "+intent.Input.OperationID)
}

func integrationRevision(expected, actual string) error {
	return fmt.Errorf("%w: expected %s, observed %s", ErrWorkspaceIntegrationRevision, expected, actual)
}

// A Git ref transaction serializes CAS against concurrent writers. Files-backend
// ref installs can still be interrupted by process/host loss. The durable result
// identifies both sides, allowing replay to finish a partially installed pair.
func integrationPublish(ctx context.Context, repository string, result WorkspaceIntegrationResult) error {
	operation, err := integrationRef(ctx, repository, result.OperationRef)
	if err != nil {
		return err
	}
	if operation != "" && operation != result.TaskCommit {
		return fmt.Errorf("%w: integration operation ref changed", ErrWorkspaceIntegrationIdentity)
	}
	current, err := integrationRef(ctx, repository, WorkspaceTaskFinalizedRef)
	if err != nil {
		return err
	}
	if current == "" {
		return integrationRevision(result.ExpectedTaskCommit, current)
	}
	transaction := "start\noption no-deref\n"
	if current == result.ExpectedTaskCommit {
		transaction += "update " + WorkspaceTaskFinalizedRef + " " + result.TaskCommit + " " + current + "\n"
	} else {
		if _, err = integrationGit(ctx, repository, "", "", "merge-base", "--is-ancestor", result.TaskCommit, current); err != nil {
			return integrationRevision(result.ExpectedTaskCommit, current)
		}
		transaction += "verify " + WorkspaceTaskFinalizedRef + " " + current + "\n"
	}
	if operation == "" {
		transaction += "create " + result.OperationRef + " " + result.TaskCommit + "\n"
	} else {
		transaction += "verify " + result.OperationRef + " " + result.TaskCommit + "\n"
	}
	_, err = integrationGit(ctx, repository, transaction+"prepare\ncommit\n", "", "update-ref", "--stdin")
	return err
}

func integrationCreateRef(ctx context.Context, repository, ref, oid string) error {
	prior, err := integrationRef(ctx, repository, ref)
	if err != nil {
		return err
	}
	if prior == oid {
		return nil
	}
	if prior != "" {
		return fmt.Errorf("%w: retained ref changed", ErrWorkspaceIntegrationIdentity)
	}
	_, err = integrationGit(ctx, repository, "", "", "update-ref", "--no-deref", ref, oid, strings.Repeat("0", len(oid)))
	return err
}

func integrationRef(ctx context.Context, repository, ref string) (string, error) {
	if _, err := integrationGit(ctx, repository, "", "", "symbolic-ref", "--quiet", ref); !integrationExit(err, 1) {
		return "", fmt.Errorf("%w: ref must be direct (%v)", ErrWorkspaceIntegrationIdentity, err)
	}
	oid, err := integrationGit(ctx, repository, "", "", "rev-parse", "--verify", "--quiet", ref)
	if integrationExit(err, 1) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if !objectID.MatchString(oid) {
		return "", fmt.Errorf("%w: malformed ref", ErrWorkspaceIntegrationIdentity)
	}
	return oid, nil
}

func integrationRepository(ctx context.Context, path string) error {
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return err
	}
	if resolved != path {
		return fmt.Errorf("%w: repository must not traverse symlinks", ErrWorkspaceIntegrationIdentity)
	}
	for _, dir := range []string{filepath.Dir(path), path, filepath.Join(path, "objects"), filepath.Join(path, "refs")} {
		if err = serviceDirectory(dir, dir == path || dir == filepath.Dir(path)); err != nil {
			return err
		}
	}
	if err = trustedFile(filepath.Join(path, "config"), uint32(os.Geteuid())); err != nil {
		return err
	}
	for _, name := range []string{"commondir", "shallow", "objects/info/alternates", "objects/info/http-alternates"} {
		if _, err = os.Lstat(filepath.Join(path, name)); !os.IsNotExist(err) {
			return fmt.Errorf("%w: repository must be self-contained (%s)", ErrWorkspaceIntegrationIdentity, name)
		}
	}
	bare, err := integrationGit(ctx, path, "", "", "rev-parse", "--is-bare-repository")
	if err != nil || bare != "true" {
		return fmt.Errorf("%w: protected bare repository required (%v)", ErrWorkspaceIntegrationIdentity, err)
	}
	return nil
}

func integrationExit(err error, code int) bool {
	var exit *exec.ExitError
	return errors.As(err, &exit) && exit.ExitCode() == code
}

// This boundary needs stdin for the atomic ref transaction and stdout on merge
// conflicts. Reuse the normal Git wrapper's narrow trust and fixed environment.
func integrationGit(ctx context.Context, repository, stdin, date string, args ...string) (string, error) {
	config, err := scopedGitConfig([]string{repository})
	if err != nil {
		return "", err
	}
	defer os.Remove(config)
	fixed := []string{"--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c", "core.fsync=committed,reference", "-c", "core.fsyncMethod=fsync", "-c", "gc.auto=0", "-c", "maintenance.auto=false"}
	cmd := exec.CommandContext(ctx, "/usr/bin/git", append(fixed, args...)...)
	cmd.Dir = repository
	cmd.Env = []string{"PATH=/usr/bin:/bin", "HOME=/home/me", "LANG=C.UTF-8", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=" + config, "GIT_TERMINAL_PROMPT=0", "GIT_AUTHOR_NAME=monos", "GIT_AUTHOR_EMAIL=system@monos.invalid", "GIT_COMMITTER_NAME=monos", "GIT_COMMITTER_EMAIL=system@monos.invalid"}
	if date != "" {
		cmd.Env = append(cmd.Env, "GIT_AUTHOR_DATE="+date, "GIT_COMMITTER_DATE="+date)
	}
	cmd.Stdin = strings.NewReader(stdin)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	output, err := cmd.Output()
	if err != nil {
		return strings.TrimSpace(string(output)), fmt.Errorf("integration Git failed: %s: %w", strings.TrimSpace(stderr.String()), err)
	}
	return strings.TrimSpace(string(output)), nil
}
