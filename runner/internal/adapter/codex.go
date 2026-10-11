package adapter

import (
	"encoding/json"
	"fmt"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/wire"
)

// codexArguments targets the Owner-installed Codex CLI 0.162.1 profile.
// --ignore-user-config leaves authentication in CODEX_HOME. It does not
// suppress administrator requirements; those can still reject this launch.
// The profile uses documented config plus the installed feature list; there is
// no disable_skills config key. skip_host_skill_discovery is experimental.
func codexArguments(d protocol.Dispatch) ([]string, error) {
	if d.RuntimeID != protocol.Codex || !host.ApprovedTarget(d) {
		return nil, fmt.Errorf("unapproved Codex target")
	}
	if d.TaskReviewSource != nil || d.TaskReplanSource != nil || d.TaskPlanningSource != nil || d.NodeExecutionSource != nil || d.TaskConversationSource != nil {
		if _, err := wire.ScopeID(d); err != nil {
			return nil, err
		}
	}
	// JSON strings are valid TOML basic strings. Keep the fixed developer
	// protocol a single override value; the full frozen prompt stays on stdin.
	quote := func(s string) string { raw, _ := json.Marshal(s); return string(raw) }
	scratch := host.Path(d.AttemptID, "scratch")
	paths, err := host.RuntimePaths(d)
	if err != nil {
		return nil, err
	}
	args := []string{"exec", "--ignore-user-config", "--ignore-rules", "--strict-config", "--ephemeral", "--json", "--color", "never", "--skip-git-repo-check", "--sandbox", "workspace-write", "--model", d.Model,
		"-c", `approval_policy="never"`,
		"-c", "developer_instructions=" + quote(fixedProtocol(d)),
		"-c", "project_doc_max_bytes=0",
		"-c", "projects." + quote(scratch) + `.trust_level="untrusted"`,
		"-c", "notify=[]",
		"-c", `web_search="disabled"`,
		"-c", `shell_environment_policy.inherit="all"`,
		"-c", "shell_environment_policy.experimental_use_profile=false",
		"-c", "sandbox_workspace_write.network_access=true",
		"-c", "sandbox_workspace_write.exclude_slash_tmp=true",
		"-c", "sandbox_workspace_write.writable_roots=[]",
		"-c", "sqlite_home=" + quote(host.Path(d.AttemptID, "state")),
		"-c", "log_dir=" + quote(host.Path(d.AttemptID, "state")),
		"--enable", "skip_host_skill_discovery"}
	// Host preparation is the source of the exact writable roots, including
	// linked-worktree Git common directories. Planner snapshots stay read-only;
	// network access preserves native commands and the attributed monos socket.
	for _, path := range paths {
		if path != scratch {
			args = append(args, "--add-dir", path)
		}
	}
	// No subprocess inherits the Owner's shell environment/config. Keep native
	// shell and filesystem tools, while disabling independently supplied tools,
	// remembered context and background integration startup.
	for _, feature := range []string{"hooks", "plugins", "remote_plugin", "apps", "multi_agent", "multi_agent_v2", "memories", "skill_search", "skill_mcp_dependency_install", "shell_snapshot", "tool_suggest", "browser_use", "computer_use", "image_generation", "daemon_auto_start"} {
		args = append(args, "--disable", feature)
	}
	if d.ThinkingLevel != nil {
		args = append(args, "-c", "model_reasoning_effort="+quote(string(*d.ThinkingLevel)))
	}
	return append(args, "-"), nil
}
