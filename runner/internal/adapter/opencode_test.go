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

func TestOnlyExplicitFreeModelsAndUnrestrictedShell(t *testing.T) {
	cfg, err := Config(protocol.Dispatch{Kind: protocol.Node, AttemptID: "a"})
	if err != nil {
		t.Fatal(err)
	}
	var v map[string]any
	if err = json.Unmarshal([]byte(cfg), &v); err != nil {
		t.Fatal(err)
	}
	if v["model"] != host.FreeModel || v["small_model"] != host.FreeModel {
		t.Fatal("model drift")
	}
	agents := v["agent"].(map[string]any)
	for _, name := range []string{"monos-probe", "title", "summary", "compaction"} {
		if agents[name].(map[string]any)["model"] != host.FreeModel {
			t.Fatal(name)
		}
	}
	if !strings.Contains(cfg, `"bash":"allow"`) || !strings.Contains(cfg, `"external_directory":"allow"`) {
		t.Fatal("shell/path restriction introduced")
	}
	args := strings.Join(Arguments(protocol.Dispatch{AttemptID: "a"}), " ")
	if !strings.Contains(args, "--auto") || !strings.Contains(args, "--model "+host.FreeModel) {
		t.Fatal("unattended/free model invocation missing")
	}
	planner, err := Config(protocol.Dispatch{Kind: "planner", AttemptID: "p"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(planner, `"edit":"deny"`) || !strings.Contains(planner, `"bash":"allow"`) {
		t.Fatal("Planner must retain shell while edit tool is denied")
	}
}

func TestWorkerRetainsCaptureFailureWhenMarkerCannotPersist(t *testing.T) {
	execute := func(cmd *exec.Cmd) error {
		if cmd.Args[1] == "models" {
			_, err := io.WriteString(cmd.Stdout, host.FreeModel+`
{"id":"longcat-2.5-preview-free","providerID":"opencode","status":"active","capabilities":{"toolcall":true},"cost":{"input":0,"output":0,"cache":{"read":0,"write":0}}}`)
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
		if cmd.Args[1] == "models" {
			preflightEnv = append([]string(nil), cmd.Env...)
			_, err := io.WriteString(cmd.Stdout, host.FreeModel+`
{"id":"longcat-2.5-preview-free","providerID":"opencode","status":"active","capabilities":{"toolcall":true},"cost":{"input":0,"output":0,"cache":{"read":0,"write":0}}}`)
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
	if err != nil || !strings.Contains(cfg, `"edit":"deny"`) || !strings.Contains(cfg, `"bash":"allow"`) {
		t.Fatal("Todo lost Planner filesystem or tool permissions", err)
	}
}
