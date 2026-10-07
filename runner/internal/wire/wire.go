// Package wire validates the generated protocol before decoding typed values.
package wire

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/cyberphone/json-canonicalization/go/src/webpki.org/jsoncanonicalizer"
	"github.com/santhosh-tekuri/jsonschema/v6"
	protocol "monos.local/protocol"
)

const Limit = 1048576
const ItemLimit = Limit - 4096

var once sync.Once
var compiler *jsonschema.Compiler
var compileErr error
var mu sync.Mutex

func reviewContract(name string) bool {
	return strings.HasPrefix(name, "OwnerReview") || strings.HasPrefix(name, "Review") || strings.HasPrefix(name, "TaskReview")
}

func Validate(name string, raw []byte) error {
	if (name == "PublicationAccessRequest" || name == "PublicationAccessResult" || name == "PublicationPermissionRequest" || name == "PublicationPermissionResult") && len(raw) > 16*1024 {
		return fmt.Errorf("publication access exceeds limit")
	}
	if (reviewContract(name) || name == "ResultReadResponse" || strings.HasPrefix(name, "Publication") || strings.HasPrefix(name, "PublishedResult") || strings.HasPrefix(name, "RemotePreparation")) && len(raw) > 512*1024 {
		return fmt.Errorf("result response exceeds limit")
	}
	if len(raw) > Limit {
		return fmt.Errorf("payload exceeds limit")
	}
	if (name == "Dispatch" || name == "Operation" || name == "OperationResult") && len(raw) > ItemLimit {
		return fmt.Errorf("item exceeds reserved framing limit")
	}
	// encoding/json substitutes malformed Unicode. Reject before decoding so
	// the Go and JavaScript consumers cannot retain different request content.
	if _, _, err := CanonicalRaw(raw); err != nil {
		return err
	}
	once.Do(func() {
		compiler = jsonschema.NewCompiler()
		var doc any
		compileErr = json.Unmarshal(protocol.SchemaJSON, &doc)
		if compileErr == nil {
			compileErr = compiler.AddResource("https://monos.invalid/protocol/v1", doc)
		}
	})
	if compileErr != nil {
		return compileErr
	}
	mu.Lock()
	schema, err := compiler.Compile("https://monos.invalid/protocol/v1#/definitions/" + name)
	mu.Unlock()
	if err != nil {
		return err
	}
	var v any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err = decoder.Decode(&v); err != nil {
		return err
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return fmt.Errorf("trailing JSON")
	}
	if err := schema.Validate(v); err != nil {
		return err
	}
	if reviewContract(name) || strings.HasPrefix(name, "Result") || strings.HasPrefix(name, "Publication") || strings.HasPrefix(name, "PublishedResult") || strings.HasPrefix(name, "RemotePreparation") || name == "Frame" && (resultFrame(v) || publicationFrame(v)) {
		if name == "Frame" && publicationFrame(v) && len(raw) > 512*1024 {
			return fmt.Errorf("publication frame exceeds limit")
		}
		if err := resultByteBounds(v, ""); err != nil {
			return err
		}
		if m, ok := v.(map[string]any); ok && name == "Frame" {
			if reply, ok := m["result_read_result"]; ok {
				var fields map[string]json.RawMessage
				_ = json.Unmarshal(raw, &fields)
				_ = reply
				if len(fields["result_read_result"]) > 512*1024 {
					return fmt.Errorf("result response exceeds limit")
				}
			}
		}
	}
	return nil
}

func Decode(name string, raw []byte, out any) error {
	if err := Validate(name, raw); err != nil {
		return err
	}
	return json.Unmarshal(raw, out)
}

func Canonical(value any) ([]byte, string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, "", err
	}
	return CanonicalRaw(raw)
}

func CanonicalRaw(raw []byte) ([]byte, string, error) {
	if !utf8.Valid(raw) {
		return nil, "", fmt.Errorf("malformed UTF-8 JSON")
	}
	if err := validateSurrogates(raw); err != nil {
		return nil, "", err
	}
	raw, err := jsoncanonicalizer.Transform(raw)
	if err != nil {
		return nil, "", err
	}
	digest := sha256.Sum256(raw)
	return raw, hex.EncodeToString(digest[:]), nil
}

// The pinned JCS library detects missing pairs but utf16.DecodeRune silently
// replaces reversed/mismatched pairs. Validate each escape pair first.
func validateSurrogates(raw []byte) error {
	for i := 0; i < len(raw); i++ {
		if raw[i] != '\\' {
			continue
		}
		i++
		if i >= len(raw) {
			break
		}
		if raw[i] != 'u' {
			continue
		}
		if i+4 >= len(raw) {
			return fmt.Errorf("incomplete Unicode escape")
		}
		unit, err := strconv.ParseUint(string(raw[i+1:i+5]), 16, 16)
		if err != nil {
			return err
		}
		i += 4
		if unit >= 0xdc00 && unit <= 0xdfff {
			return fmt.Errorf("unpaired low surrogate")
		}
		if unit < 0xd800 || unit > 0xdbff {
			continue
		}
		if i+6 >= len(raw) || raw[i+1] != '\\' || raw[i+2] != 'u' {
			return fmt.Errorf("unpaired high surrogate")
		}
		low, err := strconv.ParseUint(string(raw[i+3:i+7]), 16, 16)
		if err != nil || low < 0xdc00 || low > 0xdfff {
			return fmt.Errorf("invalid surrogate pair")
		}
		i += 6
	}
	return nil
}

func Envelope(raw []byte) (protocol.CommandEnvelope, error) {
	var v protocol.CommandEnvelope
	if err := Decode("CommandEnvelope", raw, &v); err != nil {
		return v, err
	}
	var members map[string]json.RawMessage
	if err := json.Unmarshal(raw, &members); err != nil {
		return v, err
	}
	var payload map[string]json.RawMessage
	_ = json.Unmarshal(members["payload"], &payload)
	required := []string{}
	allowed := map[string]bool{}
	switch v.Name {
	case protocol.NameOpenWorkspace, protocol.NameInspectRepository:
		required = []string{"resource_id"}
	case protocol.NameCompleteNode:
		required = []string{"summary"}
		allowed["artifact_ids"] = true
		allowed["handled_guidance_ids"] = true
	case "publish_artifact":
		required = []string{"artifact_id", "title", "content"}
		allowed["references"], allowed["supersedes"] = true, true
	case "read_artifact":
		required = []string{"artifact_id"}
	case "block_node", "request_replan":
		required = []string{"reason"}
	case protocol.CommitTaskTurn:
		required = []string{"reply", "source_watermark", "routing"}
		allowed["source_id"], allowed["input_id"] = true, true
	case "prepare_specification_revision":
		required = []string{"proposal_id", "specification", "summary", "basis", "impact", "source_input_ids"}
		allowed["supersedes"] = true
	case "apply_specification_revision":
		required = []string{"proposal_id", "confirmation_id", "basis"}
	case "read_task_context":
	case "read_task_history":
		allowed["cursor"], allowed["query"] = true, true
	case "publish_execution_plan":
		required = []string{"planning_intent_id", "plan_id", "nodes"}
	case "apply_review_rework":
		required = []string{"feedback_id", "operation_id", "operation_version", "source_id", "basis", "node_ids", "reason"}
	case "commit_review_feedback":
		required = []string{"feedback_id", "operation_id", "operation_version", "source_id", "basis", "proposal_id"}
	case "resolve_review_input":
		required = []string{"feedback_id", "operation_id", "operation_version", "source_id", "basis", "reconsideration_id", "summary", "routing"}
	case "prepare_replan":
		required = []string{"replan_request_id", "source_id", "proposal_id", "plan_id", "basis", "nodes", "summary", "impact"}
		allowed["requirement"] = true
	case "raise_planning_issue":
		if _, review := payload["feedback_id"]; review {
			required = []string{"feedback_id", "operation_id", "operation_version", "source_id", "reason"}
		} else if _, replan := payload["replan_request_id"]; replan {
			required = []string{"replan_request_id", "source_id", "reason"}
		} else {
			required = []string{"planning_intent_id", "reason"}
		}
	case "commit_discussion_turn":
		required = []string{"reply", "working_requirement_state", "source_message_id", "source_watermark"}
		allowed["task_preview"] = true
	case "read_discussion":
		allowed["cursor"] = true
	case "update_working_requirement_state":
		required = []string{"working_requirement_state", "resolved_watermark", "project_context_version", "project_context_digest"}
	default:
		return v, fmt.Errorf("unsupported command")
	}
	for _, key := range required {
		allowed[key] = true
		if _, ok := payload[key]; !ok {
			return v, fmt.Errorf("missing %s", key)
		}
	}
	for key := range payload {
		if !allowed[key] {
			return v, fmt.Errorf("irrelevant payload member %s", key)
		}
	}
	return v, nil
}

func publicationFrame(v any) bool {
	m, ok := v.(map[string]any)
	return ok && (m["type"] == "publication_prepare" || m["type"] == "publication_result" || m["type"] == "publication_ack" || m["type"] == "publication_push" || m["type"] == "publication_push_result" || m["type"] == "publication_push_ack")
}

func resultFrame(v any) bool {
	m, ok := v.(map[string]any)
	return ok && (m["type"] == "result_read" || m["type"] == "result_read_result")
}
func resultByteBounds(v any, key string) error {
	switch value := v.(type) {
	case string:
		if key == "text" && (len(value) > 65536 || strings.ContainsRune(value, 0)) {
			return fmt.Errorf("result text exceeds raw byte bounds or is binary")
		}
		if (key == "path" || key == "baseline_path") && len(value) > 4096 {
			return fmt.Errorf("result path exceeds byte bounds")
		}
		if key == "body" && len(value) > 64*1024 {
			return fmt.Errorf("remote content exceeds raw byte bounds")
		}
	case []any:
		for _, item := range value {
			if err := resultByteBounds(item, key); err != nil {
				return err
			}
		}
	case map[string]any:
		for k, item := range value {
			if err := resultByteBounds(item, k); err != nil {
				return err
			}
		}
	}
	return nil
}
