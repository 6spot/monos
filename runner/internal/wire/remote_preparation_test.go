package wire

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	protocol "monos.local/protocol"
)

func remoteFixture(t *testing.T) map[string]json.RawMessage {
	t.Helper()
	raw, err := os.ReadFile("../../../packages/protocol/fixtures/remote-preparation.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture map[string]json.RawMessage
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture
}

func TestRemotePreparationSharedFixtures(t *testing.T) {
	fixture := remoteFixture(t)
	var cases []struct {
		Schema string
		Valid  bool
		Name   string
		Value  json.RawMessage
	}
	if err := json.Unmarshal(fixture["cases"], &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			err := Validate(c.Schema, c.Value)
			if (err == nil) != c.Valid {
				t.Fatalf("expected accepted=%v; validation error=%v", c.Valid, err)
			}
		})
	}
	canonical, digest, err := CanonicalRaw(fixture["push"])
	if err != nil {
		t.Fatal(err)
	}
	var expected, expectedDigest string
	_ = json.Unmarshal(fixture["canonical_request"], &expected)
	_ = json.Unmarshal(fixture["request_digest"], &expectedDigest)
	if string(canonical) != expected || digest != expectedDigest {
		t.Fatal("cross-language push identity differs")
	}
	var push protocol.PublicationPushRequest
	if err = Decode("PublicationPushRequest", fixture["push"], &push); err != nil {
		t.Fatal(err)
	}
	for _, pair := range []struct {
		value  any
		digest string
	}{
		{push.Preparation, push.Prepared.RequestDigest},
		{push.Prepared, push.PreparationResultDigest},
		{push.PermissionProof, push.PermissionProofDigest},
		{push.Prepared.Candidate, *push.Prepared.CandidateManifestDigest},
		{push.Prepared.Scan, *push.Prepared.ScanDigest},
	} {
		_, got, e := Canonical(pair.value)
		if e != nil || got != pair.digest {
			t.Fatal("nested push digest graph changed", e)
		}
	}
	roundTrip, err := json.Marshal(push)
	if err != nil {
		t.Fatal(err)
	}
	_, typedDigest, err := CanonicalRaw(roundTrip)
	if err != nil || typedDigest != expectedDigest {
		t.Fatal("typed push round-trip lost absent versus null or immutable fields")
	}
	var mapped protocol.PublicationResult
	if err = Decode("PublicationResult", fixture["mapped"], &mapped); err != nil {
		t.Fatal(err)
	}
	if mapped.Scan == nil || mapped.Scan.WorkflowChanges == nil || *mapped.Scan.WorkflowChanges {
		t.Fatal("mapped explicit false workflow flag was lost")
	}
	roundTrip, err = json.Marshal(mapped)
	if err != nil {
		t.Fatal(err)
	}
	_, typedDigest, err = CanonicalRaw(roundTrip)
	_, mappedDigest, originalErr := CanonicalRaw(fixture["mapped"])
	if err != nil || originalErr != nil || typedDigest != mappedDigest {
		t.Fatal("mapped workflow flag changes canonical digest on typed round-trip")
	}
}

func TestRemotePreparationEncodedBounds(t *testing.T) {
	fixture := remoteFixture(t)
	// The push reserves room for the echo. Framing whitespace still counts
	// toward the complete frame's independent 512 KiB limit.
	var compact []byte
	compact = append(compact, fixture["push"]...)
	compact = append(compact[:len(compact)-1], []byte(strings.Repeat(" ", PublicationPushLimit-len(compact)-1))...)
	compact = append(compact, '}')
	if err := Validate("PublicationPushRequest", compact); err != nil {
		t.Fatal(err)
	}
	raw := []byte(`{"schema_version":1,"type":"publication_push","incarnation":1,"publication_push":`)
	raw = append(raw, compact...)
	raw = append(raw, '}')
	raw = append(raw, []byte(strings.Repeat(" ", 512*1024+1-len(raw)))...)
	if err := Validate("Frame", raw); err == nil {
		t.Fatal("whole wrapper limit missing")
	}
	var access map[string]any
	_ = json.Unmarshal(fixture["access"], &access)
	access["authentication"] = map[string]any{"kind": "github_installation", "token": strings.Repeat("x", 16384), "expires_at": "2026-10-04T13:00:00.000Z"}
	raw, _ = json.Marshal(access)
	if Validate("PublicationAccessResult", raw) == nil {
		t.Fatal("16 KiB ephemeral access limit missing")
	}
}
