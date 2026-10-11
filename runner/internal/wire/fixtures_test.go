package wire

import (
	"encoding/json"
	"os"
	"testing"

	protocol "monos.local/protocol"
)

func TestSharedSchemaFixtures(t *testing.T) {
	raw, err := os.ReadFile("../../../packages/protocol/fixtures/validation.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name   string
		Schema string
		Valid  bool
		Value  json.RawMessage
	}
	if err = json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			err := Validate(c.Schema, c.Value)
			if (err == nil) != c.Valid {
				t.Fatalf("valid=%v error=%v", c.Valid, err)
			}
		})
	}
}

func TestSharedCompletionIdentityFixtures(t *testing.T) {
	raw, err := os.ReadFile("../../../packages/protocol/fixtures/completion-identities.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Operation      protocol.Operation `json:"operation"`
		IdentityDigest string             `json:"identity_digest"`
	}
	if err = json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		raw, err := json.Marshal(c.Operation)
		if err != nil {
			t.Fatal(err)
		}
		if err := Validate("Operation", raw); err != nil {
			t.Fatal(err)
		}
		if err := ValidateCompletionInputs(c.Operation); err != nil {
			t.Fatal(err)
		}
		digest, err := OperationIdentity(c.Operation)
		if err != nil || digest != c.IdentityDigest {
			t.Fatal("completion identity drift", digest, err)
		}
	}
}
func TestSharedCanonicalFixtures(t *testing.T) {
	raw, err := os.ReadFile("../../../packages/protocol/fixtures/canonicalization.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name      string
		Input     any
		Canonical string
	}
	if err = json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			raw, _, err := Canonical(c.Input)
			if err != nil || string(raw) != c.Canonical {
				t.Fatalf("got %s error=%v", raw, err)
			}
		})
	}
}
