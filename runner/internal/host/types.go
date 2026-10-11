// Package host implements the task-confined privileged launch boundary.
package host

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	protocol "monos.local/protocol"
)

const Root = "/var/lib/monos-probe"
const Socket = "/run/monos-probe/command.sock"
const Helper = "/usr/local/libexec/monos-probe-launch"
const Worker = "/usr/local/libexec/monos-probe-exec"
const CLI = "/usr/local/bin/monos"
const Runtime = "/home/linuxbrew/.linuxbrew/bin/opencode"
const CodexRuntime = "/usr/local/bin/codex"
const FreeModel = "opencode/longcat-2.5-preview-free"
const DeepSeekModel = "volcengine/deepseek-v4-flash-ga-260731"

func ApprovedModel(model string) bool { return model == FreeModel || model == DeepSeekModel }

var modelPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$`)

func ApprovedTarget(d protocol.Dispatch) bool {
	switch d.RuntimeID {
	case "opencode":
		return ApprovedModel(string(d.Model)) && d.ThinkingLevel == nil
	case "codex":
		if !modelPattern.MatchString(string(d.Model)) {
			return false
		}
		if d.ThinkingLevel == nil {
			return true
		}
		switch string(*d.ThinkingLevel) {
		case "none", "minimal", "low", "medium", "high", "xhigh":
			return true
		}
	}
	return false
}

// These fixed installation identities also describe discovery failures. A
// failed helper must not turn an installed CLI into an omitted registry fact.
func UnavailableRuntimes() []protocol.RuntimeInstallation {
	return []protocol.RuntimeInstallation{
		{RuntimeID: "opencode", Executable: Runtime, Availability: "unavailable", SupportsModel: true, SupportsThinking: false, ModelIDS: []string{}},
		{RuntimeID: "codex", Executable: CodexRuntime, Availability: "unavailable", SupportsModel: true, SupportsThinking: true, ModelIDS: []string{}},
	}
}

// Reserved worker exit status for a checked stdout/stderr write or sync failure.
const CaptureFailureExitCode = 74

// Reserved for an adapter-validated native terminal error and failed CLI exit.
const RuntimeFailureExitCode = 75

var idPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func ValidID(id string) bool       { return idPattern.MatchString(id) }
func Unit(id string) string        { return "monos-probe-a-" + id + ".service" }
func AttemptRoot(id string) string { return filepath.Join(Root, "execution", id) }
func Path(id, name string) string  { return filepath.Join(AttemptRoot(id), name) }

// RuntimePaths lists prepared execution-owned directories for native CLI path
// grants. Runtime state is Attempt-local; only Node work receives repository
// writes. Root/service-owned manifests, caches and workspace parents stay out.
func RuntimePaths(d protocol.Dispatch) ([]string, error) {
	if !ValidID(d.AttemptID) || (d.Kind != protocol.Node && d.Kind != "planner") {
		return nil, fmt.Errorf("invalid runtime path scope")
	}
	paths := []string{}
	for _, name := range executionDirectories(d) {
		if d.Kind != protocol.Node && (name == "workspace" || name == "common") {
			continue
		}
		paths = append(paths, Path(d.AttemptID, name))
	}
	if d.Kind != protocol.Node || d.WorkspaceReservations == nil {
		return paths, nil
	}
	if d.TaskID == nil {
		return nil, fmt.Errorf("workspace reservation requires Task")
	}
	for _, reservation := range d.WorkspaceReservations.Resources {
		id, err := TaskWorkspaceID(*d.TaskID, reservation.ResourceID)
		if err != nil || id != reservation.WorkspaceID {
			return nil, fmt.Errorf("invalid workspace reservation")
		}
		isolation := reservation.Isolation
		if isolation != nil && !ValidID(isolation.AllocationID) {
			return nil, fmt.Errorf("invalid workspace allocation reservation")
		}
		paths = append(paths, reservedWorkspacePath(id, isolation, "worktree"), reservedWorkspacePath(id, isolation, "common"))
	}
	return paths, nil
}

type Request struct {
	CleanupRequest      *protocol.TaskCleanupRequest     `json:"cleanup_request,omitempty"`
	LogRetirement       *LogRetirement                   `json:"log_retirement,omitempty"`
	Action              string                           `json:"action"`
	AttemptID           string                           `json:"attempt_id"`
	Dispatch            *protocol.Dispatch               `json:"dispatch,omitempty"`
	Operation           *protocol.Operation              `json:"operation,omitempty"`
	CompletionOperation *protocol.Operation              `json:"completion_operation,omitempty"`
	RepositoryAccess    *protocol.RepositoryAccessResult `json:"repository_access,omitempty"`
}
type Status struct {
	CleanupResult          *protocol.TaskCleanupResult          `json:"cleanup_result,omitempty"`
	PreparedIntegration    *protocol.WorkspaceIntegrationResult `json:"prepared_integration,omitempty"`
	Known                  bool                                 `json:"known"`
	Exists                 bool                                 `json:"exists"`
	Populated              bool                                 `json:"populated"`
	MainExited             bool                                 `json:"main_exited,omitempty"`
	ExitCode               *int64                               `json:"exit_code,omitempty"`
	CaptureFailed          bool                                 `json:"capture_failed,omitempty"`
	RuntimeFailed          bool                                 `json:"runtime_failed,omitempty"`
	BootID                 string                               `json:"boot_id"`
	PID                    int                                  `json:"pid"`
	Birth                  string                               `json:"birth"`
	Cgroup                 string                               `json:"cgroup"`
	Error                  string                               `json:"error,omitempty"`
	FailureKind            *protocol.FailureKind                `json:"failure_kind,omitempty"`
	Result                 *protocol.EffectResult               `json:"result,omitempty"`
	MaterializationBase    *string                              `json:"materialization_base,omitempty"`
	Runtimes               []protocol.RuntimeInstallation       `json:"runtimes,omitempty"`
	CancelledByOperationID *string                              `json:"cancelled_by_operation_id,omitempty"`
	PriorOperationResult   *protocol.OperationResult            `json:"prior_operation_result,omitempty"`
	CompletionSettlement   *protocol.CompletionSettlement       `json:"completion_settlement,omitempty"`
	NeedsRepositoryAccess  bool                                 `json:"needs_repository_access,omitempty"`
}
type Supervisor interface {
	Call(context.Context, Request) (Status, error)
}
type Client struct{}

func (Client) Call(ctx context.Context, r Request) (Status, error) {
	raw, err := json.Marshal(r)
	if err != nil {
		return Status{}, err
	}
	cmd := exec.CommandContext(ctx, "/usr/bin/sudo", "-n", Helper)
	cmd.Stdin = bytes.NewReader(raw)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return Status{}, fmt.Errorf("constrained helper failed: %s", strings.TrimSpace(stderr.String()))
	}
	var status Status
	if err = json.Unmarshal(out, &status); err != nil {
		return status, err
	}
	if status.Error != "" {
		return status, statusError(status)
	}
	return status, nil
}
