package adapter

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os/exec"
	"slices"
	"strings"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
)

func codexOverrides(t *testing.T, args []string) map[string]string {
	t.Helper()
	values := make(map[string]string)
	for i, arg := range args {
		if arg != "-c" {
			continue
		}
		if i+1 == len(args) {
			t.Fatal("missing config value")
		}
		key, value, ok := strings.Cut(args[i+1], "=")
		if !ok || values[key] != "" {
			t.Fatal("malformed or repeated override", key)
		}
		values[key] = value
	}
	return values
}

func TestCodexFreshExecutionKeepsExactTargetContextAndManagedEnvironment(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "not-inherited")
	t.Setenv("CODEX_HOME", "/untrusted/auth")
	t.Setenv("BASH_ENV", "/untrusted/shell")
	d := initialPlanner()
	d.RuntimeID, d.Model = protocol.Codex, "owner/model-1"
	d.Prompt = "frozen context with \"quotes\"\n第二行 $HOME `command`"
	nativeError := errors.New("native model unavailable")
	calls, checked := 0, 0
	err := runWithPreflight(d, func(cmd *exec.Cmd) error {
		calls++
		if cmd.Path != host.CodexRuntime || cmd.Args[1] != "exec" || cmd.Args[len(cmd.Args)-1] != "-" {
			t.Fatal("wrong Codex invocation", cmd.Args)
		}
		for _, flag := range []string{"--json", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config", "--skip-git-repo-check"} {
			if !slices.Contains(cmd.Args, flag) {
				t.Fatal("missing unattended boundary", flag)
			}
		}
		for _, arg := range []string{"resume", "fork", "--last", "--worktree", d.Prompt} {
			if slices.Contains(cmd.Args, arg) {
				t.Fatal("unexpected session/prompt/workspace argument", arg)
			}
		}
		model := slices.Index(cmd.Args, "--model")
		if model < 0 || cmd.Args[model+1] != d.Model || cmd.Dir != host.Path(d.AttemptID, "scratch") {
			t.Fatal("selected model or scratch changed")
		}
		sandbox := slices.Index(cmd.Args, "--sandbox")
		if sandbox < 0 || cmd.Args[sandbox+1] != "workspace-write" {
			t.Fatal("native writes are not limited to reserved roots")
		}
		prompt, err := io.ReadAll(cmd.Stdin)
		if err != nil || string(prompt) != d.Prompt {
			t.Fatal("stdin context changed", err)
		}
		cfg := codexOverrides(t, cmd.Args)
		var developer string
		if err := json.Unmarshal([]byte(cfg["developer_instructions"]), &developer); err != nil || developer != fixedProtocol(d) || !strings.Contains(developer, "monos publish_execution_plan") {
			t.Fatal("fixed phase protocol missing or changed", err)
		}
		for key, value := range map[string]string{"approval_policy": `"never"`, "project_doc_max_bytes": "0", "notify": "[]", "web_search": `"disabled"`, "shell_environment_policy.inherit": `"all"`, "sandbox_workspace_write.network_access": "true", "sandbox_workspace_write.exclude_slash_tmp": "true", "sandbox_workspace_write.writable_roots": "[]"} {
			if cfg[key] != value {
				t.Fatal("managed config drift", key)
			}
		}
		scratchJSON, _ := json.Marshal(cmd.Dir)
		if cfg["projects."+string(scratchJSON)+".trust_level"] != `"untrusted"` {
			t.Fatal("project config is not excluded")
		}
		for _, feature := range []string{"hooks", "plugins", "remote_plugin", "apps", "multi_agent", "multi_agent_v2", "memories", "skill_search", "skill_mcp_dependency_install", "shell_snapshot", "tool_suggest", "browser_use", "computer_use", "image_generation", "daemon_auto_start"} {
			i := slices.Index(cmd.Args, feature)
			if i < 1 || cmd.Args[i-1] != "--disable" {
				t.Fatal("inherited augmentation not disabled", feature)
			}
		}
		skill := slices.Index(cmd.Args, "skip_host_skill_discovery")
		if skill < 1 || cmd.Args[skill-1] != "--enable" {
			t.Fatal("host skill discovery remains enabled")
		}
		values := make(map[string]string)
		for _, entry := range cmd.Env {
			key, value, ok := strings.Cut(entry, "=")
			if !ok || values[key] != "" {
				t.Fatal("malformed or repeated environment key", key)
			}
			values[key] = value
		}
		for key, value := range map[string]string{"HOME": cmd.Dir, "PWD": cmd.Dir, "CODEX_HOME": "/home/me/.codex", "MONOS_SOCKET": host.Socket, "TMPDIR": host.Path(d.AttemptID, "tmp"), "XDG_CONFIG_HOME": host.Path(d.AttemptID, "config"), "XDG_DATA_HOME": host.Path(d.AttemptID, "data"), "XDG_CACHE_HOME": host.Path(d.AttemptID, "cache"), "XDG_STATE_HOME": host.Path(d.AttemptID, "state")} {
			if values[key] != value {
				t.Fatal("runtime environment drift", key)
			}
		}
		for _, key := range []string{"OPENAI_API_KEY", "BASH_ENV", "OPENCODE_CONFIG", "OPENCODE_CONFIG_CONTENT"} {
			if _, ok := values[key]; ok {
				t.Fatal("foreign runtime/credential environment inherited", key)
			}
		}
		return nativeError
	}, outputSink{stdout: io.Discard, stderr: io.Discard}, func(got protocol.Dispatch, env []string) error {
		checked++
		if got.RuntimeID != protocol.Codex || got.Model != d.Model || !slices.Contains(env, "CODEX_HOME=/home/me/.codex") {
			t.Fatal("Codex configuration check lost selected context")
		}
		return nil
	})
	if calls != 1 || checked != 1 || err != nativeError {
		t.Fatal("native outcome changed or invocation/check repeated", calls, checked, err)
	}
}

func TestCodexGrantsNodeReservedWorktreeAndGitCommonButNotPlannerRepositories(t *testing.T) {
	task, resource := "task-reserved", "repo-reserved"
	workspace, err := host.TaskWorkspaceID(task, resource)
	if err != nil {
		t.Fatal(err)
	}
	d := protocol.Dispatch{RuntimeID: protocol.Codex, Model: "owner-model", AttemptID: "reserved", TaskID: &task, Kind: protocol.Node, WorkspaceReservations: &protocol.WorkspaceReservations{ProjectID: "project", Resources: []protocol.WorkspaceReservation{{ResourceID: resource, WorkspaceID: workspace}}}}
	args, err := codexArguments(d)
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{host.TaskWorkspacePath(workspace, "worktree"), host.TaskWorkspacePath(workspace, "common"), host.Path(d.AttemptID, "state"), host.Path(d.AttemptID, "tmp")} {
		i := slices.Index(args, path)
		if i < 1 || args[i-1] != "--add-dir" {
			t.Fatal("reserved writable root missing", path)
		}
	}
	for _, path := range []string{host.Root, host.AttemptRoot(d.AttemptID), host.TaskWorkspacePath(workspace, ""), "/home/me/.codex", "/tmp"} {
		if slices.Contains(args, path) {
			t.Fatal("overbroad write grant", path)
		}
	}
	d.WorkspaceReservations.Resources[0].WorkspaceID = "unrelated"
	if _, err := codexArguments(d); err == nil {
		t.Fatal("mismatched workspace reserved")
	}
	planner := initialPlanner()
	planner.RuntimeID, planner.Model = protocol.Codex, "owner-model"
	args, err = codexArguments(planner)
	if err != nil {
		t.Fatal(err)
	}
	for _, arg := range args {
		if strings.HasPrefix(arg, host.Root+"/tasks/") || arg == host.Path(planner.AttemptID, "workspace") || arg == host.Path(planner.AttemptID, "common") {
			t.Fatal("Planner obtained repository write access")
		}
	}
}

func TestCodexThinkingIsExactAndOmissionKeepsRuntimeDefault(t *testing.T) {
	d := protocol.Dispatch{RuntimeID: protocol.Codex, Model: "owner-model", AttemptID: "codex-thinking", Kind: protocol.Node}
	args, err := codexArguments(d)
	if err != nil || codexOverrides(t, args)["model_reasoning_effort"] != "" {
		t.Fatal("unspecified thinking was overridden", err)
	}
	for _, level := range []protocol.ThinkingLevel{protocol.ThinkingLevelNone, protocol.Minimal, protocol.ThinkingLevelLow, protocol.Medium, protocol.High, protocol.Xhigh} {
		d.ThinkingLevel = &level
		args, err = codexArguments(d)
		if err != nil || codexOverrides(t, args)["model_reasoning_effort"] != `"`+string(level)+`"` {
			t.Fatal("thinking selection changed", level, err)
		}
	}
}

func TestInvalidCodexTargetOrScopeNeverExecutes(t *testing.T) {
	valid := protocol.Dispatch{RuntimeID: protocol.Codex, Model: "owner-model", AttemptID: "codex-invalid", Kind: protocol.Node}
	for _, model := range []string{"", "-model", "owner model", "owner/model\nconfig=true", strings.Repeat("x", 161)} {
		d := valid
		d.Model = model
		assertNoRuntime(t, d)
	}
	d := valid
	bad := protocol.ThinkingLevel("unrecognized")
	d.ThinkingLevel = &bad
	assertNoRuntime(t, d)
	d = initialPlanner()
	d.RuntimeID, d.Model, d.Kind = protocol.Codex, "owner-model", protocol.Node
	assertNoRuntime(t, d)
}

func assertNoRuntime(t *testing.T, d protocol.Dispatch) {
	t.Helper()
	err := runWithPreflight(d, func(*exec.Cmd) error { t.Fatal("invalid dispatch executed"); return nil }, outputSink{stdout: io.Discard, stderr: io.Discard}, func(protocol.Dispatch, []string) error { t.Fatal("invalid dispatch reached preflight"); return nil })
	if err == nil {
		t.Fatal("invalid dispatch accepted")
	}
}

func TestBothRuntimesRetainRawOutputAndCaptureFailure(t *testing.T) {
	for _, runtime := range []protocol.RuntimeID{protocol.Opencode, protocol.Codex} {
		t.Run(string(runtime), func(t *testing.T) {
			d := protocol.Dispatch{RuntimeID: runtime, Model: host.DeepSeekModel, AttemptID: "shared-capture", Kind: protocol.Node}
			if runtime == protocol.Codex {
				d.Model = "owner-model"
			}
			var stdout, stderr bytes.Buffer
			out := bytes.Repeat([]byte("{\"type\":\"output\",\"text\":\"未完成\"}\n"), 40000)
			diagnostic := []byte{'e', 0xff, '\n'}
			synced := 0
			err := runWithPreflight(d, func(cmd *exec.Cmd) error {
				if _, err := cmd.Stdout.Write(out); err != nil {
					return err
				}
				_, err := cmd.Stderr.Write(diagnostic)
				return err
			}, outputSink{stdout: &stdout, stderr: &stderr, syncOut: func() error { synced++; return nil }, syncErr: func() error { synced++; return nil }}, successfulTestPreflight)
			if err != nil || synced != 2 || !bytes.Equal(stdout.Bytes(), out) || !bytes.Equal(stderr.Bytes(), diagnostic) {
				t.Fatal("raw output truncated, decoded or not synced", err)
			}
			for _, stream := range []string{"stdout", "stderr"} {
				for _, failure := range []string{"write", "short", "sync"} {
					t.Run(stream+"/"+failure, func(t *testing.T) {
						marked := false
						sink := outputSink{stdout: io.Discard, stderr: io.Discard, mark: func(id string) { marked = id == d.AttemptID /* persistence may fail */ }}
						var writer io.Writer = failingOutput{}
						if failure == "short" {
							writer = shortOutput{}
						}
						if failure == "sync" {
							writer = io.Discard
						}
						if stream == "stdout" {
							sink.stdout = writer
						} else {
							sink.stderr = writer
						}
						if failure == "sync" {
							fail := func() error { return errors.New("fsync failed") }
							if stream == "stdout" {
								sink.syncOut = fail
							} else {
								sink.syncErr = fail
							}
						}
						err := runWithPreflight(d, func(cmd *exec.Cmd) error {
							w := cmd.Stdout
							if stream == "stderr" {
								w = cmd.Stderr
							}
							_, _ = w.Write([]byte("output"))
							return nil // A successful exit cannot erase a capture failure.
						}, sink, successfulTestPreflight)
						if !marked || !errors.Is(err, ErrCaptureFailure) {
							t.Fatal("capture failure lost", marked, err)
						}
					})
				}
			}
		})
	}
}
