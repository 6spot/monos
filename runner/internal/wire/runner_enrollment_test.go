package wire

import (
	"encoding/json"
	"os"
	"testing"
)

func TestRunnerEnrollmentSharedContracts(t *testing.T) {
	raw, err := os.ReadFile("../../../packages/protocol/fixtures/runner-enrollment.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Name   string
			Schema string
			Valid  bool
			Value  json.RawMessage
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, example := range fixture.Cases {
		t.Run(example.Name, func(t *testing.T) {
			err := Validate(example.Schema, example.Value)
			if (err == nil) != example.Valid {
				t.Fatalf("valid=%t: %v", example.Valid, err)
			}
		})
	}
}

func TestRunnerEnrollmentRawByteLimit(t *testing.T) {
	raw := append([]byte(`{"schema_version":1,"request_id":"r","runner_id":"runner"}`), make([]byte, 4096)...)
	for i := len(raw) - 4096; i < len(raw); i++ {
		raw[i] = ' '
	}
	if err := Validate("RunnerEnrollmentResponse", raw); err == nil {
		t.Fatal("oversized enrollment accepted")
	}
}
