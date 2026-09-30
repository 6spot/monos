package wire

import (
	"encoding/json"
	protocol "monos.local/protocol"
	"reflect"
	"strings"
	"testing"
)

func TestSpecificationWireRejectsWidenedOrAmbiguousPayloads(t *testing.T) {
	for _, entry := range []struct {
		name, payload string
		changes       [][2]string
	}{
		{"prepare_specification_revision", `{"proposal_id":"proposal","specification":"# Full requirements","summary":"Clarify","basis":{"control_version":93,"specification_id":"spec","plan_id":null},"impact":{"graph_sufficient":true,"nodes":[],"guidance":[]},"source_input_ids":["input"]}`, [][2]string{{`"specification":"# Full requirements"`, `"specification":null`}, {`"nodes":[]`, `"nodes":[],"invented_authority":true`}, {`"source_input_ids":["input"]`, `"source_input_ids":["input","input"]`}, {`"summary":"Clarify",`, ``}}},
		{"apply_specification_revision", `{"proposal_id":"proposal","confirmation_id":"owner-receipt","basis":{"control_version":93,"specification_id":"spec","plan_id":null}}`, [][2]string{{`"confirmation_id":"owner-receipt"`, `"confirmation_id":null`}, {`"confirmation_id":"owner-receipt",`, ``}, {`"confirmation_id":"owner-receipt"`, `"confirmation_id":"owner-receipt","specification":"changed"`}, {`"control_version":93`, `"control_version":93.5`}}},
	} {
		t.Run(entry.name, func(t *testing.T) {
			raw := `{"schema_version":1,"request_id":"request","scope_id":"task","name":"` + entry.name + `","expected_control_version":7,"payload":` + entry.payload + `}`
			if _, err := Envelope([]byte(raw)); err != nil {
				t.Fatal("valid command rejected", err)
			}
			for _, edit := range entry.changes {
				if _, err := Envelope([]byte(strings.Replace(raw, edit[0], edit[1], 1))); err == nil {
					t.Fatal("widened or missing requirement authority accepted", edit)
				}
			}
		})
	}
}

func TestSpecificationResultExposesAdmissionWithoutPhysicalOperation(t *testing.T) {
	for _, payload := range []string{
		`{"proposal_id":"proposal","content_digest":"` + strings.Repeat("a", 64) + `","obligation_id":"obligation"}`,
		`{"requirement_operation_id":"requirement-operation"}`,
	} {
		raw := []byte(`{"schema_version":1,"status":"committed","request_id":"request","result":` + payload + `}`)
		var result protocol.CommandResult
		if err := Decode("CommandResult", raw, &result); err != nil {
			t.Fatal(err)
		}
		encoded, err := json.Marshal(result)
		if err != nil {
			t.Fatal(err)
		}
		var before, after map[string]any
		if err = json.Unmarshal(raw, &before); err != nil {
			t.Fatal(err)
		}
		if err = json.Unmarshal(encoded, &after); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(before["result"], after["result"]) {
			t.Fatal("generated consumer lost proposal/operation receipt")
		}
		if result.OperationID != nil {
			t.Fatal("requirement admission became physical Runner operation")
		}
	}
}

func TestSpecificationImpactKeepsExactNullableCompletionProvenance(t *testing.T) {
	raw := `{"proposal_id":"proposal","specification":"# Full requirements","summary":"Clarify","basis":{"control_version":93,"specification_id":"spec","plan_id":"plan"},"impact":{"graph_sufficient":true,"nodes":[{"node_id":"node","node_activation":2,"source_id":"node-source","completion_operation_id":null,"completion_manifest_digest":null,"disposition":"refresh"}],"guidance":[{"guidance_id":"guidance","version":4,"disposition":"retain"}]},"source_input_ids":["input"]}`
	if err := Validate("PrepareSpecificationRevision", []byte(raw)); err != nil {
		t.Fatal(err)
	}
	for _, edit := range [][2]string{{`"completion_operation_id":null,`, ``}, {`"completion_manifest_digest":null`, `"completion_manifest_digest":"not-a-digest"`}, {`"disposition":"refresh"`, `"disposition":"replan"`}, {`"graph_sufficient":true`, `"graph_sufficient":false`}, {`"version":4`, `"version":4,"implicit_authorization":true`}} {
		if err := Validate("PrepareSpecificationRevision", []byte(strings.Replace(raw, edit[0], edit[1], 1))); err == nil {
			t.Fatal("incomplete or expanded impact accepted", edit)
		}
	}
	for _, disposition := range []string{"refresh", "invalidate", "carry"} {
		value := strings.Replace(raw, `"disposition":"refresh"`, `"disposition":"`+disposition+`"`, 1)
		var proposal protocol.PrepareSpecificationRevision
		if err := Decode("PrepareSpecificationRevision", []byte(value), &proposal); err != nil {
			t.Fatal(err)
		}
		encoded, err := json.Marshal(proposal.Impact)
		if err != nil {
			t.Fatal(err)
		}
		var envelope map[string]json.RawMessage
		if err = json.Unmarshal([]byte(value), &envelope); err != nil {
			t.Fatal(err)
		}
		expected, _, err := CanonicalRaw(envelope["impact"])
		if err != nil {
			t.Fatal(err)
		}
		actual, _, err := CanonicalRaw(encoded)
		if err != nil {
			t.Fatal(err)
		}
		if string(expected) != string(actual) {
			t.Fatal("generated impact changed source/evidence provenance")
		}
	}
}
