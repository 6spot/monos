package journal

import (
	"encoding/json"
	"strings"
	"testing"

	"monos.local/runner/internal/wire"
)

func TestTaskTurnRetryRetainsExactSourceWatermarkAndActionBasis(t *testing.T) {
	db := openTest(t)
	raw := []byte(`{"schema_version":1,"request_id":"turn","scope_id":"task","name":"commit_task_turn","expected_control_version":7,"payload":{"source_id":"source","input_id":"input","source_watermark":3,"reply":"Guidance recorded","routing":{"kind":"guidance","text":"Keep labels accessible","basis":{"control_version":93,"specification_id":"spec","plan_id":null}}}}`)
	original, err := db.PutRequest("attempt", raw)
	if err != nil {
		t.Fatal(err)
	}
	for _, edit := range []struct{ from, to string }{{`"source"`, `"other-source"`}, {`"input"`, `"other-input"`}, {`"source_watermark":3`, `"source_watermark":4`}, {`"control_version":93`, `"control_version":94`}, {`"expected_control_version":7`, `"expected_control_version":8`}} {
		if _, err = db.PutRequest("attempt", []byte(strings.Replace(string(raw), edit.from, edit.to, 1))); err != ErrConflict {
			t.Fatal("uncertain Task turn request was replaced", edit, err)
		}
	}
	replayed, err := db.Request("attempt", "turn")
	if err != nil || replayed.Digest != original.Digest || string(replayed.Raw) != string(original.Raw) {
		t.Fatal("retry lost original conversation identity", err)
	}
}

func TestGuidanceDeclarationsKeepAbsentEmptyAndAssignedIDsOnRetry(t *testing.T) {
	for _, value := range []string{"omitted", "[]", `["guidance-a","guidance-b"]`} {
		t.Run(value, func(t *testing.T) {
			db := openTest(t)
			payload := map[string]any{"summary": "Completed work"}
			if value != "omitted" {
				var ids []string
				if err := json.Unmarshal([]byte(value), &ids); err != nil {
					t.Fatal(err)
				}
				payload["handled_guidance_ids"] = ids
			}
			raw, _, err := wire.Canonical(map[string]any{"schema_version": 1, "request_id": "completion", "scope_id": "task", "name": "complete_node", "expected_control_version": 4, "payload": payload})
			if err != nil {
				t.Fatal(err)
			}
			original, err := db.PutRequest("attempt", raw)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = db.PutRequest("attempt", raw); err != nil {
				t.Fatal("exact declaration replay failed", err)
			}
			replayed, err := db.Request("attempt", "completion")
			if err != nil || replayed.Digest != original.Digest || string(replayed.Raw) != string(raw) {
				t.Fatal("guidance declaration changed", err)
			}
			payload["handled_guidance_ids"] = []string{"replacement"}
			changed, _, _ := wire.Canonical(map[string]any{"schema_version": 1, "request_id": "completion", "scope_id": "task", "name": "complete_node", "expected_control_version": 4, "payload": payload})
			if _, err = db.PutRequest("attempt", changed); err != ErrConflict {
				t.Fatal("completion retry silently replaced guidance", err)
			}
		})
	}
}
