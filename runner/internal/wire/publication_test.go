package wire

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func publicationFixture(t *testing.T) map[string]json.RawMessage {
	t.Helper()
	raw, err := os.ReadFile("../../../packages/protocol/fixtures/publication.json")
	if err != nil {
		t.Fatal(err)
	}
	var f map[string]json.RawMessage
	if err = json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	return f
}
func TestPublicationSharedCanonicalIdentity(t *testing.T) {
	f := publicationFixture(t)
	canonical, digest, err := CanonicalRaw(f["request"])
	if err != nil {
		t.Fatal(err)
	}
	var expected, expectedDigest string
	_ = json.Unmarshal(f["canonical_request"], &expected)
	_ = json.Unmarshal(f["request_digest"], &expectedDigest)
	if string(canonical) != expected || digest != expectedDigest {
		t.Fatal("cross-language publication identity differs")
	}
	if err = Validate("PublicationPrepareRequest", f["request"]); err != nil {
		t.Fatal(err)
	}
	if err = Validate("PublicationResultPage", f["page"]); err != nil {
		t.Fatal(err)
	}
}
func TestPublicationFrameBytesUnicodeAndPathBounds(t *testing.T) {
	f := publicationFixture(t)
	var page map[string]any
	_ = json.Unmarshal(f["page"], &page)
	finding := map[string]any{"finding_id": strings.Repeat("a", 64), "kind": "tracked_ignore", "rule_id": "tracked_ignore", "scope": "final_tree", "commit": strings.Repeat("b", 40), "path": "𠮷.txt", "path_redacted": false, "occurrence_ordinal": 0, "override_eligible": true, "message": "Tracked file matches ignore rules."}
	page["findings"] = []any{finding}
	raw, _ := json.Marshal(page)
	if err := Validate("PublicationResultPage", raw); err != nil {
		t.Fatal(err)
	}
	finding["path"] = strings.Repeat("界", 1400)
	raw, _ = json.Marshal(page)
	if Validate("PublicationResultPage", raw) == nil {
		t.Fatal("UTF8 path byte bound missing")
	}
	finding["path"] = "safe.txt"
	finding["baseline_path"] = strings.Repeat("界", 1400)
	finding["baseline_path_redacted"] = false
	raw, _ = json.Marshal(page)
	if Validate("PublicationResultPage", raw) == nil {
		t.Fatal("baseline path byte bound missing")
	}
	delete(finding, "baseline_path")
	delete(finding, "baseline_path_redacted")
	finding["path"] = strings.Repeat("\t", 3900)
	findings := make([]any, 64)
	for i := range findings {
		findings[i] = finding
	}
	page["findings"] = findings
	raw, _ = json.Marshal(page)
	if len(raw) > 512*1024 {
		t.Fatal("fixture is not standalone bounded")
	}
	if err := Validate("PublicationResultPage", raw); err != nil {
		t.Fatal(err)
	}
	frame := map[string]any{"schema_version": 1, "type": "publication_result", "incarnation": 1, "publication_result": page}
	frameRaw, _ := json.Marshal(frame)
	frameRaw = append(frameRaw[:len(frameRaw)-1], append([]byte(strings.Repeat(" ", 512*1024-len(frameRaw)+1)), byte('}'))...)
	if Validate("Frame", frameRaw) == nil {
		t.Fatal("whole publication frame byte bound missing")
	}
	malformed := []byte(strings.Replace(string(f["page"]), "\"findings\": []", "\"findings\": [], \"foreign\": \"\\ud800\"", 1))
	if Validate("PublicationResultPage", malformed) == nil {
		t.Fatal("malformed Unicode admitted")
	}
}
