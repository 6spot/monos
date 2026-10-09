package adapter

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
	"os/exec"
	"reflect"
	"strings"
	"testing"
)

type failingOutput struct{}

func (failingOutput) Write([]byte) (int, error) { return 0, errors.New("spool full") }

type shortOutput struct{}

func (shortOutput) Write(p []byte) (int, error) { return len(p) - 1, nil }

func TestDurableOutputStopsOnSpoolFailureWithoutTruncating(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var output bytes.Buffer
	w := DurableWriter{W: &output, Stop: cancel}
	chunk := bytes.Repeat([]byte("x"), 1<<20)
	if n, err := w.Write(chunk); n != len(chunk) || err != nil || !bytes.Equal(output.Bytes(), chunk) {
		t.Fatal("execution output was truncated")
	}
	if ctx.Err() != nil {
		t.Fatal("healthy output stopped execution")
	}
	w = DurableWriter{W: failingOutput{}, Stop: cancel}
	if _, err := w.Write([]byte("lost")); err == nil || ctx.Err() == nil {
		t.Fatal("failed spool did not stop execution")
	}
	ctx3, cancel3 := context.WithCancel(context.Background())
	w = DurableWriter{W: shortOutput{}, Stop: cancel3}
	if _, err := w.Write([]byte("lost")); !errors.Is(err, io.ErrShortWrite) || ctx3.Err() == nil {
		t.Fatal("short spool write did not stop execution")
	}
	ctx2, cancel2 := context.WithCancel(context.Background())
	w = DurableWriter{W: io.Discard, Sync: func() error { return errors.New("fsync failed") }, Stop: cancel2}
	if _, err := w.Write([]byte("x")); err == nil || ctx2.Err() == nil {
		t.Fatal("failed sync did not stop execution")
	}
}

func TestLogTruncationIsVisibleExactlyOnce(t *testing.T) {
	for _, chunks := range [][]string{{"abcd", "ef", "gh"}, {"abcdef", "gh"}} {
		var output bytes.Buffer
		writer := BoundedWriter{W: &output, Remaining: 4}
		for _, chunk := range chunks {
			if n, err := writer.Write([]byte(chunk)); n != len(chunk) || err != nil {
				t.Fatalf("write: %d %v", n, err)
			}
		}
		if output.String() != "abcd"+TruncationMarker || !writer.Truncated {
			t.Fatalf("missing/duplicate truncation: %q", output.String())
		}
	}
	var exact bytes.Buffer
	writer := BoundedWriter{W: &exact, Remaining: 4}
	if _, err := writer.Write([]byte("abcd")); err != nil {
		t.Fatal(err)
	}
	if writer.Truncated || exact.String() != "abcd" {
		t.Fatal("reported truncation without dropped bytes")
	}
}

// Decode the public v2 permission shape independently of the production struct.
func permissionEffect(t *testing.T, config, action string) string {
	t.Helper()
	var cfg struct {
		Agents map[string]struct {
			Permissions []struct{ Action, Resource, Effect string }
		}
	}
	if err := json.Unmarshal([]byte(config), &cfg); err != nil {
		t.Fatal(err)
	}
	effect := ""
	for _, rule := range cfg.Agents["monos-probe"].Permissions {
		if (rule.Action == "*" || rule.Action == action) && rule.Resource == "*" {
			effect = rule.Effect
		}
	}
	return effect
}

func assertPlannerPermissions(t *testing.T, config string) {
	t.Helper()
	if permissionEffect(t, config, "edit") != "deny" || permissionEffect(t, config, "shell") != "allow" || permissionEffect(t, config, "read") != "allow" {
		t.Fatal("Planner must retain shell/read while edit tool is denied")
	}
}

func TestSelectedModelAppliesToPrimaryAndAuxiliaryAgents(t *testing.T) {
	for _, model := range []protocol.Model{host.FreeModel, host.DeepSeekModel} {
		t.Run(string(model), func(t *testing.T) {
			d := protocol.Dispatch{Kind: protocol.Node, AttemptID: "a", Model: model}
			cfg, err := Config(d)
			if err != nil {
				t.Fatal(err)
			}
			var v map[string]any
			if err = json.Unmarshal([]byte(cfg), &v); err != nil {
				t.Fatal(err)
			}
			if v["model"] != string(model) {
				t.Fatal("primary model drift")
			}
			agents := v["agents"].(map[string]any)
			for _, name := range []string{"monos-probe", "title", "summary", "compaction"} {
				if agents[name].(map[string]any)["model"] != string(model) {
					t.Fatal("agent model drift", name)
				}
			}
			primary := agents["monos-probe"].(map[string]any)
			if primary["mode"] != "primary" || primary["system"] != fixedProtocol(d) {
				t.Fatal("fixed native protocol missing")
			}
			for key, want := range map[string]any{"update": "disable", "snapshots": false, "lsp": false, "share": "disabled", "shell": "/bin/bash", "formatter": false} {
				if v[key] != want {
					t.Fatal("unexpected runtime setting", key, v[key])
				}
			}
			for _, old := range []string{"agent", "small_model", "autoupdate", "snapshot"} {
				if _, ok := v[old]; ok {
					t.Fatal("obsolete v1 config field", old)
				}
			}
			for _, action := range []string{"shell", "read", "edit"} {
				if permissionEffect(t, cfg, action) != "allow" {
					t.Fatal("Node lost native permission", action)
				}
			}
			for _, action := range []string{"question", "subagent", "skill"} {
				if permissionEffect(t, cfg, action) != "deny" {
					t.Fatal("unattended boundary lost", action)
				}
			}
			if strings.Contains(cfg, "plan_enter") || strings.Contains(cfg, "plan_exit") {
				t.Fatal("obsolete v1 permission")
			}
			args := Arguments(d)
			want := []string{"run", "--standalone", "--auto", "--format", "json", "--model", string(model), "--agent", "monos-probe"}
			if !reflect.DeepEqual(args, want) {
				t.Fatal("unexpected v2 invocation", args)
			}
			d.Kind = "planner"
			planner, err := Config(d)
			if err != nil {
				t.Fatal(err)
			}
			assertPlannerPermissions(t, planner)
		})
	}
}

func TestEnvironmentIsolatesHomeAndLoadsExplicitOwnerConfig(t *testing.T) {
	t.Setenv("OWNER_PRIVATE_TOKEN", "must-not-be-inherited")
	t.Setenv("OPENCODE_CONFIG", "/untrusted/inherited/config")
	d := protocol.Dispatch{Kind: protocol.Node, AttemptID: "isolated", Model: host.DeepSeekModel}
	env, err := Environment(d)
	if err != nil {
		t.Fatal(err)
	}
	values := make(map[string]string)
	for _, entry := range env {
		key, value, ok := strings.Cut(entry, "=")
		if !ok {
			t.Fatal("malformed environment entry")
		}
		if _, exists := values[key]; exists {
			t.Fatal("duplicate environment key", key)
		}
		values[key] = value
	}
	for key, want := range map[string]string{
		"HOME": host.Path(d.AttemptID, "scratch"), "PWD": host.Path(d.AttemptID, "scratch"),
		"TMPDIR": host.Path(d.AttemptID, "tmp"), "XDG_DATA_HOME": host.Path(d.AttemptID, "data"),
		"XDG_CONFIG_HOME": host.Path(d.AttemptID, "config"), "XDG_CACHE_HOME": host.Path(d.AttemptID, "cache"),
		"XDG_STATE_HOME": host.Path(d.AttemptID, "state"), "OPENCODE_CONFIG": "/home/me/.config/opencode/opencode.json",
		"OPENCODE_DISABLE_PROJECT_CONFIG": "1", "MONOS_SOCKET": host.Socket,
	} {
		if values[key] != want {
			t.Fatal("runtime environment drift", key)
		}
	}
	if _, present := values["OWNER_PRIVATE_TOKEN"]; present {
		t.Fatal("inherited credential environment")
	}
	cfg, err := Config(d)
	if err != nil || values["OPENCODE_CONFIG_CONTENT"] != cfg {
		t.Fatal("selected runtime config missing", err)
	}
}

func TestOwnerAuthorizedDeepSeekRunsNativelyWithoutCatalogOrFallback(t *testing.T) {
	d := protocol.Dispatch{RuntimeID: protocol.Opencode, Kind: protocol.Node, AttemptID: "paid", Model: host.DeepSeekModel, Prompt: "frozen native context"}
	for _, nativeError := range []error{nil, errors.New("native authentication required"), errors.New("native model unavailable")} {
		calls := 0
		err := runWithSink(d, func(cmd *exec.Cmd) error {
			calls++
			wantArgs := []string{"run", "--standalone", "--auto", "--format", "json", "--model", host.DeepSeekModel, "--agent", "monos-probe"}
			if cmd.Path != host.Runtime || !reflect.DeepEqual(cmd.Args[1:], wantArgs) {
				t.Fatal("authorized model did not go directly to native run", cmd.Args)
			}
			if cmd.Dir != host.Path(d.AttemptID, "scratch") {
				t.Fatal("native run left Attempt scratch")
			}
			prompt, err := io.ReadAll(cmd.Stdin)
			if err != nil || string(prompt) != d.Prompt {
				t.Fatal("native run lost authoritative context", err)
			}
			env, err := Environment(d)
			if err != nil || !reflect.DeepEqual(cmd.Env, env) {
				t.Fatal("native run lost managed configuration", err)
			}
			return nativeError
		}, outputSink{stdout: io.Discard, stderr: io.Discard})
		if calls != 1 || err != nativeError {
			t.Fatalf("native result changed or fallback executed: calls=%d err=%v want=%v", calls, err, nativeError)
		}
	}
}

func TestUnapprovedModelNeverReachesCatalogOrRun(t *testing.T) {
	for _, model := range []protocol.Model{"", "opencode/mimo-v2.6-flash-free", "volcengine/other", host.DeepSeekModel + "-other"} {
		d := protocol.Dispatch{RuntimeID: protocol.Opencode, Kind: protocol.Node, AttemptID: "invalid", Model: model}
		if _, err := Config(d); err == nil {
			t.Fatal("unapproved model configured", model)
		}
		calls := 0
		err := runWithSink(d, func(*exec.Cmd) error { calls++; return nil }, outputSink{stdout: io.Discard, stderr: io.Discard})
		if err == nil || calls != 0 {
			t.Fatal("unapproved model reached runtime", model, calls, err)
		}
	}
}

func TestWorkerRetainsCaptureFailureWhenMarkerCannotPersist(t *testing.T) {
	execute := func(cmd *exec.Cmd) error {
		if cmd.Args[1] == "api" {
			_, err := io.WriteString(cmd.Stdout, modelCatalogAt(cmd.Dir, host.FreeModel, freeCost))
			return err
		}
		_, err := cmd.Stdout.Write([]byte("output"))
		return err
	}
	err := runWithSink(protocol.Dispatch{RuntimeID: protocol.Opencode, Model: host.FreeModel, AttemptID: "a"}, execute, outputSink{stdout: failingOutput{}, stderr: io.Discard, mark: func(string) { /* failed marker persistence */ }})
	if !errors.Is(err, ErrCaptureFailure) {
		t.Fatalf("capture fact lost: %v", err)
	}
}

func TestTodoUsesFreshScratchContextAndOneFormalHandoffProtocol(t *testing.T) {
	todo, source := "todo-a", "source-a"
	d := protocol.Dispatch{AttemptID: "todo-attempt", TodoID: &todo, SourceMessageID: &source, Kind: "planner", RuntimeID: protocol.Opencode, Model: host.FreeModel, Prompt: "authoritative Todo-only context\nsource_message_id: source-a"}
	var calls int
	var preflightEnv []string
	err := runWithSink(d, func(cmd *exec.Cmd) error {
		if cmd.Dir != host.Path(d.AttemptID, "scratch") {
			t.Error("Todo left its reserved scratch directory")
		}
		if cmd.Args[1] == "api" {
			preflightEnv = append([]string(nil), cmd.Env...)
			_, err := io.WriteString(cmd.Stdout, modelCatalogAt(cmd.Dir, host.FreeModel, freeCost))
			return err
		}
		calls++
		if strings.Join(cmd.Env, "\n") != strings.Join(preflightEnv, "\n") {
			t.Error("catalog and invocation environments differ")
		}
		raw, err := io.ReadAll(cmd.Stdin)
		if err != nil || string(raw) != d.Prompt {
			t.Error("authoritative context was replaced", err)
		}
		args := strings.Join(cmd.Args, " ")
		for _, forbidden := range []string{"--session", "--continue", "fixture.git", "workspace", "authoritative Todo-only"} {
			if strings.Contains(args, forbidden) {
				t.Error("unexpected resume/repository/context argument", forbidden)
			}
		}
		return nil // Exit without a tool must not create another model invocation.
	}, outputSink{stdout: io.Discard, stderr: io.Discard})
	if err != nil || calls != 1 {
		t.Fatalf("unexpected model invocation count=%d: %v", calls, err)
	}
	protocolText := fixedProtocol(d)
	for _, name := range []string{"monos read_discussion", "monos update_working_requirement_state", "monos commit_discussion_turn", "source_message_id", "source_watermark", "same retained request ID"} {
		if !strings.Contains(protocolText, name) {
			t.Error("Todo protocol missing", name)
		}
	}
	if strings.Count(protocolText, "monos commit_discussion_turn") != 1 || strings.Contains(protocolText, "monos commit_task_turn") {
		t.Fatal("Todo protocol uses an incorrect or repeated terminal handoff")
	}
	if strings.Contains(fixedProtocol(protocol.Dispatch{Kind: "planner"}), "Todo Discussion") {
		t.Fatal("legacy Task protocol inherited Todo context")
	}
	cfg, err := Config(d)
	assertPlannerPermissions(t, cfg)
	if err != nil {
		t.Fatal("Todo lost Planner filesystem or tool permissions", err)
	}
}
