package wire

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestReviewCommandUTF8AndEncodedBounds(t *testing.T) {
	command := map[string]any{"schema_version": 1, "task_id": "task", "request_id": "request", "name": "request_changes", "payload": map[string]any{"feedback_id": "feedback", "text": strings.Repeat("修", 18000), "basis": map[string]any{"control_version": 4, "specification_id": "spec", "plan_id": "plan", "review_result_digest": strings.Repeat("a", 64)}}}
	raw, _ := json.Marshal(command)
	if err := Validate("OwnerReviewCommand", raw); err != nil {
		t.Fatal(err)
	}
	command["payload"].(map[string]any)["text"] = strings.Repeat("修", 22000)
	raw, _ = json.Marshal(command)
	if Validate("OwnerReviewCommand", raw) == nil {
		t.Fatal("feedback UTF8 bytes exceeded limit")
	}
	command["payload"].(map[string]any)["text"] = "Bounded feedback"
	raw, _ = json.Marshal(command)
	oversize := append(append(append([]byte{}, raw[:len(raw)-1]...), []byte(strings.Repeat(" ", 512*1024))...), '}')
	if Validate("OwnerReviewCommand", oversize) == nil {
		t.Fatal("review encoded limit ignored")
	}
	malformed := []byte(strings.Replace(string(raw), `"Bounded feedback"`, `"\ud800"`, 1))
	if Validate("OwnerReviewCommand", malformed) == nil {
		t.Fatal("review malformed Unicode substituted")
	}
}
