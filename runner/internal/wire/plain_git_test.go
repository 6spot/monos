package wire

import (
	"encoding/json"
	"os"
	"testing"

	protocol "monos.local/protocol"
)

func TestPlainGitSharedFixtures(t *testing.T) {
	raw, e := os.ReadFile("../../../packages/protocol/fixtures/plain-git.json")
	if e != nil {
		t.Fatal(e)
	}
	var fixture map[string]json.RawMessage
	if e = json.Unmarshal(raw, &fixture); e != nil {
		t.Fatal(e)
	}
	var cases []struct {
		Name, Schema string
		Valid        bool
		Value        json.RawMessage
	}
	if e = json.Unmarshal(fixture["cases"], &cases); e != nil {
		t.Fatal(e)
	}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			err := Validate(c.Schema, c.Value)
			if (err == nil) != c.Valid {
				t.Fatalf("expected accepted=%v: %v", c.Valid, err)
			}
		})
	}
	var expected, digest string
	_ = json.Unmarshal(fixture["canonical_request"], &expected)
	_ = json.Unmarshal(fixture["request_digest"], &digest)
	canonical, actual, e := CanonicalRaw(fixture["push"])
	if e != nil || string(canonical) != expected || actual != digest {
		t.Fatal("plain push canonical identity differs", e)
	}
	var push protocol.PublicationPushRequest
	var request protocol.PublicationRefReadRequest
	var response protocol.PublicationRefReadResponse
	for _, item := range []struct {
		key, schema string
		target      any
	}{{"push", "PublicationPushRequest", &push}, {"ref_request", "PublicationRefReadRequest", &request}, {"ref_response", "PublicationRefReadResponse", &response}} {
		if e = Decode(item.schema, fixture[item.key], item.target); e != nil {
			t.Fatal(e)
		}
		roundTrip, e := json.Marshal(item.target)
		if e != nil {
			t.Fatal(e)
		}
		_, got, e := CanonicalRaw(roundTrip)
		_, want, originalErr := CanonicalRaw(fixture[item.key])
		if e != nil || originalErr != nil || got != want {
			t.Fatal("typed round trip changed plain empty metadata/null limit or echoed fields", item.key, e)
		}
	}
	if push.ProviderMetadata.Github != nil || push.Preparation.Configuration.ProviderBlobLimit != nil || push.Preparation.Configuration.WorkflowWrite != "not_applicable" || request.PushRequestDigest != digest || response.Request.RequestID != request.RequestID || !response.WorkerAbsent {
		t.Fatal("plain provider/read semantics changed")
	}
	_, observationDigest, e := Canonical(response.Observation)
	if e != nil || observationDigest != response.ObservationDigest {
		t.Fatal("fresh observation digest changed")
	}
}
