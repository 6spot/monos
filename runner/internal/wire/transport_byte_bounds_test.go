package wire

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
)

func transportFixture(t *testing.T, key string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile("../../../packages/protocol/fixtures/plain-git.json")
	if err != nil {
		t.Fatal(err)
	}
	// Other fixture roots include arrays and strings; select the raw root first.
	var roots map[string]json.RawMessage
	if err = json.Unmarshal(raw, &roots); err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err = json.Unmarshal(roots[key], &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func transportJSON(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func transportOutcome(push map[string]any) map[string]any {
	return push["preparation"].(map[string]any)["construction"].(map[string]any)["parents"].([]any)[0].(map[string]any)["outcome"].(map[string]any)
}

func transportPush(t *testing.T, size int) map[string]any {
	t.Helper()
	push := transportFixture(t, "push")
	receipts := make([]any, 60)
	for i := range receipts {
		ids := make([]string, 64)
		for j := range ids {
			ids[j] = fmt.Sprintf("%064x", j)
		}
		receipts[i] = map[string]any{
			"receipt_id": strings.Repeat("r", 128), "confirmation_id": strings.Repeat("c", 128), "selection_digest": strings.Repeat("a", 64),
			"selection": map[string]any{
				"candidate_id": strings.Repeat("i", 128), "candidate_manifest_digest": strings.Repeat("b", 64),
				"effective_basis_digest": strings.Repeat("c", 64), "scan_digest": strings.Repeat("d", 64),
				"mapping_digest": strings.Repeat("e", 64), "finding_ids": ids,
			},
		}
	}
	push["override_receipts"] = receipts
	var grow func(any)
	grow = func(value any) {
		switch value := value.(type) {
		case []any:
			for _, item := range value {
				grow(item)
			}
		case map[string]any:
			for key, item := range value {
				switch key {
				case "repository_identity":
					value[key] = strings.Repeat("\x01", 2048)
				case "storage_id":
					value[key] = strings.Repeat("s", 128)
				case "remote_url":
					value[key] = "https://git.example/" + strings.Repeat("\x01", 2028)
				case "target_branch":
					value[key] = strings.Repeat("\x01", 1024)
				case "path":
					value[key] = "/"
				default:
					grow(item)
				}
			}
		}
	}
	grow(push)
	padding := size - len(transportJSON(t, push))
	if padding < 0 {
		t.Fatal("requested push is smaller than fixture")
	}
	path := "/" + strings.Repeat("\x01", padding/6) + strings.Repeat("x", padding%6)
	if len(path) > 4096 {
		t.Fatal("padding exceeds path byte limit")
	}
	transportOutcome(push)["path"] = path
	if actual := len(transportJSON(t, push)); actual != size {
		t.Fatalf("push bytes %d, want %d", actual, size)
	}
	return push
}

type transportEnvelope struct {
	schema string
	value  map[string]any
}

func transportEnvelopes(t *testing.T, push map[string]any) []transportEnvelope {
	t.Helper()
	request, response := transportFixture(t, "ref_request"), transportFixture(t, "ref_response")
	request["push"], response["request"] = push, request
	return []transportEnvelope{
		{"PublicationPushRequest", push}, {"PublicationRefReadRequest", request}, {"PublicationRefReadResponse", response},
		{"Frame", map[string]any{"schema_version": 1, "type": "publication_push", "incarnation": 7, "publication_push": push}},
		{"Frame", map[string]any{"schema_version": 1, "type": "publication_ref_read", "incarnation": 7, "correlation_id": "fresh-ref-correlation", "publication_ref_read": request}},
		{"Frame", map[string]any{"schema_version": 1, "type": "publication_ref_read_result", "incarnation": 7, "correlation_id": "fresh-ref-correlation", "publication_ref_read_result": response}},
	}
}

func TestAccessEncodedByteBounds(t *testing.T) {
	for key, schema := range map[string]string{"repository_access": "RepositoryAccessResult", "inspection_access": "InspectionRepositoryAccessResult"} {
		t.Run(schema, func(t *testing.T) {
			value := transportFixture(t, key)
			if err := Validate(schema, transportJSON(t, value)); err != nil {
				t.Fatal(err)
			}
			auth := value["authentication"].(map[string]any)
			auth["username"], auth["token"] = strings.Repeat("界", 256), strings.Repeat("界", 4096)
			value["default_branch"] = strings.Repeat("界", 1024)
			raw := transportJSON(t, value)
			if len(raw) <= 16*1024 || len([]rune(string(raw))) >= 16*1024 {
				t.Fatal("fixture does not distinguish encoded bytes from characters")
			}
			if err := Validate(schema, raw); err == nil || !strings.Contains(err.Error(), "service access exceeds") {
				t.Fatal("oversized access response accepted", err)
			}
		})
	}
}

func TestPublicationPushEchoReservation(t *testing.T) {
	for _, size := range []int{PublicationPushLimit, PublicationPushLimit + 1} {
		for i, envelope := range transportEnvelopes(t, transportPush(t, size)) {
			t.Run(fmt.Sprintf("%d/%d/%s", size, i, envelope.schema), func(t *testing.T) {
				raw := transportJSON(t, envelope.value)
				if len(raw) >= 512*1024 {
					t.Fatal("wrapper did not fit publication bound")
				}
				err := Validate(envelope.schema, raw)
				if size == PublicationPushLimit && err != nil {
					t.Fatal(err)
				}
				if size > PublicationPushLimit && (err == nil || !strings.Contains(err.Error(), "publication push exceeds")) {
					t.Fatal("push reservation bypassed", err)
				}
			})
		}
	}
}

func TestPublicationPushEscapedEchoReservation(t *testing.T) {
	push := transportPush(t, PublicationPushLimit+1)
	outcome := transportOutcome(push)
	outcome["path"] = strings.ReplaceAll(outcome["path"].(string), "\x01", "<")
	for _, envelope := range transportEnvelopes(t, push) {
		var compact bytes.Buffer
		encoder := json.NewEncoder(&compact)
		encoder.SetEscapeHTML(false)
		if err := encoder.Encode(envelope.value); err != nil {
			t.Fatal(err)
		}
		if compact.Len() >= PublicationPushLimit {
			t.Fatal("fixture does not expand on re-encoding")
		}
		if err := Validate(envelope.schema, compact.Bytes()); err == nil || !strings.Contains(err.Error(), "publication push exceeds") {
			t.Fatal("escaped echo reservation bypassed", err)
		}
	}
}

func TestPublicationRefFrameNestedUnicodeBounds(t *testing.T) {
	for _, index := range []int{4, 5} {
		for _, count := range []int{1365, 1366} {
			push := transportFixture(t, "push")
			transportOutcome(push)["path"] = strings.Repeat("界", count)
			frame := transportEnvelopes(t, push)[index]
			err := Validate("Frame", transportJSON(t, frame.value))
			if (err == nil) != (count == 1365) {
				t.Fatalf("frame %d path %d: %v", index, count, err)
			}
		}
		push := transportFixture(t, "push")
		transportOutcome(push)["path"] = "malformed-unicode"
		raw := transportJSON(t, transportEnvelopes(t, push)[index].value)
		raw = bytes.Replace(raw, []byte(`"malformed-unicode"`), []byte(`"\ud800"`), 1)
		if err := Validate("Frame", raw); err == nil {
			t.Fatal("nested unpaired surrogate accepted")
		}
	}
}

func TestPublicationRefWholeFrameByteBounds(t *testing.T) {
	for _, index := range []int{4, 5} {
		raw := transportJSON(t, transportEnvelopes(t, transportFixture(t, "push"))[index].value)
		// Raw framing whitespace must count even when the nested request is small.
		atLimit := append(bytes.Repeat([]byte(" "), 512*1024-len(raw)), raw...)
		if err := Validate("Frame", atLimit); err != nil {
			t.Fatal(err)
		}
		if err := Validate("Frame", append(atLimit, ' ')); err == nil || !strings.Contains(err.Error(), "publication frame exceeds") {
			t.Fatal("whole frame limit bypassed", err)
		}
	}
}

func TestPublicationRefMaximumEchoOverhead(t *testing.T) {
	push := transportPush(t, PublicationPushLimit)
	frame := transportEnvelopes(t, push)[5].value
	frame["incarnation"], frame["correlation_id"] = 9007199254740991, strings.Repeat("i", 128)
	response := frame["publication_ref_read_result"].(map[string]any)
	request := response["request"].(map[string]any)
	request["request_id"] = strings.Repeat("i", 128)
	observation := response["observation"].(map[string]any)
	for _, key := range []string{"observation_id", "operation_id", "item_id", "task_id", "resource_id", "runner_id"} {
		observation[key] = strings.Repeat("i", 128)
	}
	observation["storage_id"], observation["repository_identity"] = strings.Repeat("\x01", 512), strings.Repeat("\x01", 2048)
	observation["provider_metadata"] = map[string]any{"github": map[string]any{"repository_id": strings.Repeat("9", 16)}}
	observation["delivery_ref"] = "refs/heads/monos/task/" + strings.Repeat("a", 36) + "/" + strings.Repeat("i", 128)
	observation["head"], observation["observed_at"] = strings.Repeat("a", 64), "9999-12-31T23:59:59.999Z"
	raw := transportJSON(t, frame)
	if err := Validate("Frame", raw); err != nil {
		t.Fatal(err)
	}
	if overhead := len(raw) - len(transportJSON(t, push)); overhead != 17375 {
		t.Fatalf("maximum observation overhead changed: %d", overhead)
	}
	if len(raw) != 508895 || len(raw) >= 512*1024 {
		t.Fatal("echo reservation exhausted")
	}
}
