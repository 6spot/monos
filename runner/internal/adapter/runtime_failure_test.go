package adapter

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os/exec"
	"strings"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
)

const terminalFailureFixture = `{"type":"turn.failed","error":{"message":"provider unavailable"}}` + "\n"

// OpenCode v2.0.20 upstream fixture, packages/cli/test/run/noninteractive.test.ts:379-397.
// Test source SHA-256: c49fe9d3b2b4cc98c04bdc939c20c773e8976436b742125aed360f0b2c06cde9.
const opencodeFailureFixture = `{"type":"error","timestamp":1,"sessionID":"ses_1","error":{"type":"provider.transport","message":"instructions unavailable"}}` + "\n"

func TestNativeTerminalFailureRequiresCompleteTopLevelEnvelopeAndFailedExit(t *testing.T) {
	failedExit := exec.Command("/bin/sh", "-c", "exit 1").Run()
	arbitrary75 := exec.Command("/bin/sh", "-c", "exit 75").Run()
	signaled := exec.Command("/bin/sh", "-c", "kill -TERM $$").Run()
	if failedExit == nil || arbitrary75 == nil || signaled == nil {
		t.Fatal("fixture did not fail")
	}
	for _, test := range []struct {
		name, output string
		exit         error
		want         bool
	}{
		{"terminal", terminalFailureFixture, failedExit, true},
		{"native sequence", "{\"type\":\"thread.started\",\"thread_id\":\"t\"}\n{\"type\":\"turn.started\"}\n" + terminalFailureFixture, failedExit, true},
		{"success", terminalFailureFixture, nil, false},
		{"unknown execution error", terminalFailureFixture, errors.New("exit status 1"), false},
		{"signal", terminalFailureFixture, signaled, false},
		{"cancelled", terminalFailureFixture, errors.Join(failedExit, context.Canceled), false},
		{"deadline", terminalFailureFixture, errors.Join(failedExit, context.DeadlineExceeded), false},
		{"arbitrary reserved status", "{\"type\":\"turn.started\"}\n", arbitrary75, false},
		{"nested object spoof", "{\"type\":\"item.completed\",\"item\":{\"type\":\"turn.failed\",\"error\":{\"message\":\"spoof\"}}}\n", failedExit, false},
		{"nested text spoof", "{\"type\":\"item.completed\",\"item\":{\"text\":\"{\\\"type\\\":\\\"turn.failed\\\",\\\"error\\\":{\\\"message\\\":\\\"spoof\\\"}}\\n\"}}\n", failedExit, false},
		{"free text", "runtime failed: permission denied\n", failedExit, false},
		{"nonterminal error", "{\"type\":\"error\",\"message\":\"retrying\"}\n", failedExit, false},
		{"truncated frame", strings.TrimSuffix(terminalFailureFixture, "\n"), failedExit, false},
		{"truncated suffix", terminalFailureFixture + "{", failedExit, false},
		{"malformed prefix", "malformed\n" + terminalFailureFixture, failedExit, false},
		{"duplicate discriminator", "{\"type\":\"item.completed\",\"type\":\"turn.failed\",\"error\":{\"message\":\"spoof\"}}\n", failedExit, false},
		{"duplicate message", "{\"type\":\"turn.failed\",\"error\":{\"message\":null,\"message\":\"spoof\"}}\n", failedExit, false},
		{"missing error", "{\"type\":\"turn.failed\"}\n", failedExit, false},
		{"string error", "{\"type\":\"turn.failed\",\"error\":\"failed\"}\n", failedExit, false},
		{"null message", "{\"type\":\"turn.failed\",\"error\":{\"message\":null}}\n", failedExit, false},
		{"invalid utf8", "{\"type\":\"turn.failed\",\"error\":{\"message\":\"\xff\"}}\n", failedExit, false},
		{"oversized prefix", "{\"type\":\"item.completed\",\"text\":\"" + strings.Repeat("x", nativeEventLimit) + "\"}\n" + terminalFailureFixture, failedExit, false},
		{"later success", terminalFailureFixture + "{\"type\":\"turn.completed\",\"usage\":{}}\n", failedExit, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			d := initialPlanner()
			d.RuntimeID, d.Model = protocol.Codex, "owner-model"
			var raw bytes.Buffer
			err := runWithPreflight(d, func(cmd *exec.Cmd) error {
				// Deliberately split framing across writes, as real pipe reads do.
				for offset := 0; offset < len(test.output); offset += 7 {
					end := min(offset+7, len(test.output))
					if _, err := io.WriteString(cmd.Stdout, test.output[offset:end]); err != nil {
						t.Fatal(err)
					}
				}
				return test.exit
			}, outputSink{stdout: &raw, stderr: io.Discard}, successfulTestPreflight)
			if errors.Is(err, ErrRuntimeFailure) != test.want || raw.String() != test.output {
				t.Fatalf("classification/raw output changed: want failure %v, got %v, raw equal %v", test.want, err, raw.String() == test.output)
			}
			if !test.want && err != test.exit {
				t.Fatal("unclassified exit was replaced", err)
			}
		})
	}
}

func TestOpenCodeTerminalErrorSurvivesLaterProjectionButNotCancellationOrInvalidFraming(t *testing.T) {
	failedExit := exec.Command("/bin/sh", "-c", "exit 1").Run()
	interruptedExit := exec.Command("/bin/sh", "-c", "exit 130").Run()
	const aborted = `{"type":"error","error":{"type":"aborted","message":"Session interrupted"}}` + "\n"
	const text = `{"type":"text","part":{"text":"projected output"}}` + "\n"
	const toolError = `{"type":"tool_use","part":{"state":{"status":"error","error":"command failed"}}}` + "\n"
	for _, test := range []struct {
		name, output string
		exit         error
		want         bool
	}{
		{"terminal transport", opencodeFailureFixture, failedExit, true},
		{"later text projection", opencodeFailureFixture + text, failedExit, true},
		{"later tool projection", opencodeFailureFixture + toolError, failedExit, true},
		{"startup unknown", "{\"type\":\"error\",\"timestamp\":1,\"sessionID\":\"\",\"error\":{\"type\":\"unknown\",\"message\":\"unavailable\"}}\n", failedExit, true},
		{"successful process", opencodeFailureFixture + text, nil, false},
		{"ordinary nonzero", text, failedExit, false},
		{"tool failure", toolError, failedExit, false},
		{"nested error spoof", "{\"type\":\"tool_use\",\"part\":{\"type\":\"error\",\"error\":{\"type\":\"provider.transport\",\"message\":\"spoof\"}}}\n", failedExit, false},
		{"interrupted", aborted, failedExit, false},
		{"error then interrupted", opencodeFailureFixture + aborted, failedExit, false},
		{"SIGINT exit convention", opencodeFailureFixture, interruptedExit, false},
		{"context cancelled", opencodeFailureFixture, errors.Join(failedExit, context.Canceled), false},
		{"unverified error type", "{\"type\":\"error\",\"error\":{\"type\":\"provider.other\",\"message\":\"unverified\"}}\n", failedExit, false},
		{"missing error type", "{\"type\":\"error\",\"error\":{\"message\":\"unverified\"}}\n", failedExit, false},
		{"missing message", "{\"type\":\"error\",\"error\":{\"type\":\"unknown\"}}\n", failedExit, false},
		{"duplicate error type", "{\"type\":\"error\",\"error\":{\"type\":\"aborted\",\"type\":\"unknown\",\"message\":\"ambiguous\"}}\n", failedExit, false},
		{"malformed later frame", opencodeFailureFixture + "not json\n", failedExit, false},
		{"truncated later frame", opencodeFailureFixture + "{", failedExit, false},
		{"missing newline", strings.TrimSuffix(opencodeFailureFixture, "\n"), failedExit, false},
		{"oversized later frame", opencodeFailureFixture + strings.Repeat("x", nativeEventLimit+1) + "\n", failedExit, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			d := initialPlanner()
			d.RuntimeID, d.Model = protocol.Opencode, host.DeepSeekModel
			var raw bytes.Buffer
			err := runWithPreflight(d, func(cmd *exec.Cmd) error {
				for offset := 0; offset < len(test.output); offset += 11 {
					if _, err := io.WriteString(cmd.Stdout, test.output[offset:min(offset+11, len(test.output))]); err != nil {
						t.Fatal(err)
					}
				}
				return test.exit
			}, outputSink{stdout: &raw, stderr: io.Discard}, successfulTestPreflight)
			if errors.Is(err, ErrRuntimeFailure) != test.want || raw.String() != test.output {
				t.Fatalf("OpenCode failure = %v, want %v; raw equal %v", err, test.want, raw.String() == test.output)
			}
		})
	}
}

func TestNativeFailureEnvelopesAreRuntimeSpecificAndStdoutOnly(t *testing.T) {
	failedExit := exec.Command("/bin/sh", "-c", "exit 1").Run()
	for _, test := range []struct {
		runtime protocol.RuntimeID
		output  string
		stderr  bool
	}{
		{protocol.Codex, terminalFailureFixture, true},
		{protocol.Opencode, opencodeFailureFixture, true},
		{protocol.Codex, opencodeFailureFixture, false},
		{protocol.Opencode, terminalFailureFixture, false},
	} {
		d := initialPlanner()
		d.RuntimeID, d.Model = test.runtime, host.DeepSeekModel
		err := runWithPreflight(d, func(cmd *exec.Cmd) error {
			out := cmd.Stdout
			if test.stderr {
				out = cmd.Stderr
			}
			_, _ = io.WriteString(out, test.output)
			return failedExit
		}, outputSink{stdout: io.Discard, stderr: io.Discard}, successfulTestPreflight)
		if errors.Is(err, ErrRuntimeFailure) || err != failedExit {
			t.Fatal("unsupported failure evidence classified", test.runtime, err)
		}
	}
}

func TestCaptureFailureOverridesPreviouslyObservedNativeTerminalError(t *testing.T) {
	failedExit := exec.Command("/bin/sh", "-c", "exit 1").Run()
	for _, runtime := range []protocol.RuntimeID{protocol.Codex, protocol.Opencode} {
		d := initialPlanner()
		d.RuntimeID, d.Model = runtime, host.DeepSeekModel
		output := terminalFailureFixture
		if runtime == protocol.Opencode {
			output = opencodeFailureFixture
		}
		marked := false
		err := runWithPreflight(d, func(cmd *exec.Cmd) error {
			_, _ = io.WriteString(cmd.Stdout, output)
			_, _ = io.WriteString(cmd.Stderr, "unretained diagnostic")
			return failedExit
		}, outputSink{stdout: io.Discard, stderr: io.Discard, syncErr: func() error { return errors.New("fsync failed") }, mark: func(string) { marked = true }}, successfulTestPreflight)
		if !marked || !errors.Is(err, ErrCaptureFailure) || errors.Is(err, ErrRuntimeFailure) {
			t.Fatal("capture failure lost precedence", runtime, err)
		}
	}
}
