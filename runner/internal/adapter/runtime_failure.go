package adapter

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os/exec"
	"unicode/utf8"

	protocol "monos.local/protocol"
)

var ErrRuntimeFailure = errors.New("native runtime terminal failure")

const nativeEventLimit = 64 << 10

// Observe stdout framing only; nested tool output and stderr are never evidence.
// Any incomplete, oversized or malformed frame invalidates this observation,
// without truncating or otherwise changing the separately retained raw output.
type nativeTerminalObserver struct {
	runtimeID   protocol.RuntimeID
	line        []byte
	invalid     bool
	failed      bool
	interrupted bool
}

func (o *nativeTerminalObserver) Write(p []byte) (int, error) {
	n := len(p)
	for len(p) > 0 && !o.invalid {
		end := bytes.IndexByte(p, '\n')
		part := p
		if end >= 0 {
			part = p[:end]
		}
		if len(o.line)+len(part) > nativeEventLimit {
			o.invalid = true
			break
		}
		o.line = append(o.line, part...)
		if end < 0 {
			break
		}
		o.frame(o.line)
		o.line = o.line[:0]
		p = p[end+1:]
	}
	if o.invalid {
		o.line = nil
	}
	return n, nil
}

// Reject ambiguous duplicate discriminator/error keys instead of accepting the
// last value as encoding/json's ordinary map decoding would do.
func nativeObject(raw []byte) (map[string]json.RawMessage, error) {
	if !utf8.Valid(raw) {
		return nil, errors.New("invalid UTF-8")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	token, err := d.Token()
	if err != nil || token != json.Delim('{') {
		return nil, errors.New("native event is not an object")
	}
	object := map[string]json.RawMessage{}
	for d.More() {
		token, err = d.Token()
		if err != nil {
			return nil, err
		}
		key, ok := token.(string)
		if !ok || object[key] != nil {
			return nil, errors.New("ambiguous native event key")
		}
		var value json.RawMessage
		if err = d.Decode(&value); err != nil {
			return nil, err
		}
		object[key] = value
	}
	if _, err = d.Token(); err != nil {
		return nil, err
	}
	if _, err = d.Token(); err != io.EOF {
		return nil, errors.New("extra native event content")
	}
	return object, nil
}

func (o *nativeTerminalObserver) frame(raw []byte) {
	// Codex turn.failed is the terminal event. OpenCode can still emit missing
	// text/tool projections after its error, so retain that observed failure.
	if o.runtimeID == protocol.Codex {
		o.failed = false
	}
	object, err := nativeObject(raw)
	var kind string
	if err != nil || json.Unmarshal(object["type"], &kind) != nil || kind == "" {
		o.invalid = true
		return
	}
	if o.runtimeID == protocol.Codex && kind != "turn.failed" ||
		o.runtimeID == protocol.Opencode && kind != "error" {
		return
	}
	detail, err := nativeObject(object["error"])
	var message string
	if err != nil || json.Unmarshal(detail["message"], &message) != nil || message == "" {
		o.invalid = true
		return
	}
	switch o.runtimeID {
	case protocol.Codex:
		// https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts
		o.failed = true
	case protocol.Opencode:
		// OpenCode v2.0.20: run.ts:248-257 emits unknown plus exitCode=1;
		// noninteractive.test.ts:379-397 verifies provider.transport plus 1.
		// noninteractive.ts:523-531 emits aborted for interruption; :752-755
		// projects missing output after termination. Native SIGINT uses 130.
		// https://github.com/anomalyco/opencode/blob/v2.0.20/packages/cli/src/run/run.ts#L248
		// https://github.com/anomalyco/opencode/blob/v2.0.20/packages/cli/test/run/noninteractive.test.ts#L379
		var errorType string
		if json.Unmarshal(detail["type"], &errorType) != nil || errorType == "" {
			o.invalid = true
			return
		}
		switch errorType {
		case "provider.transport", "unknown":
			o.failed = true
		case "aborted":
			o.interrupted = true
		}
	}
}

func (o *nativeTerminalObserver) runtimeFailed(err error) bool {
	var exited *exec.ExitError
	return !o.invalid && !o.interrupted && len(o.line) == 0 && o.failed &&
		!errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) &&
		errors.As(err, &exited) && exited.ProcessState != nil &&
		exited.ProcessState.Exited() && !exited.ProcessState.Success() &&
		!(o.runtimeID == protocol.Opencode && exited.ProcessState.ExitCode() == 130)
}
