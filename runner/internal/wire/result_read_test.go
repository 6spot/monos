package wire

import (
	"encoding/json"
	"strings"
	"testing"

	protocol "monos.local/protocol"
)

func readWireRequest(t *testing.T, mode string) map[string]any {
	t.Helper()
	i := protocol.ResultReadIdentity{TaskID: "task", OperationID: "completion", AttemptID: "attempt", DispatchID: "dispatch", NodeID: "node", SpecificationID: "spec", PlanID: "plan", WorkspaceID: "workspace", ResourceID: "repo", RunnerID: "runner", StorageID: "storage", LeaseID: "lease", NodeActivation: 1, Generation: 1, RepositoryIdentity: "repo", ManifestDigest: strings.Repeat("a", 64), OperationIdentityDigest: strings.Repeat("b", 64), BaseCommit: strings.Repeat("1", 40), GitCommit: strings.Repeat("2", 40), GitTree: strings.Repeat("3", 40)}
	i.Capture = protocol.WorkspaceCaptureResult{StartCommit: i.BaseCommit, NodeCommit: i.GitCommit, NodeTree: i.GitTree}
	_, d, e := Canonical(i)
	if e != nil {
		t.Fatal(e)
	}
	r := map[string]any{"identity": i, "identity_digest": d, "mode": mode}
	if mode != "changes" {
		r["path"] = "unicodé/🙂\t\n name"
	}
	if mode == "file" {
		r["side"] = "result"
	}
	return r
}
func readWireAssert(t *testing.T, name string, v any, want bool) {
	t.Helper()
	raw, e := json.Marshal(v)
	if e != nil {
		t.Fatal(e)
	}
	e = Validate(name, raw)
	if (e == nil) != want {
		t.Fatalf("%s valid=%v want=%v: %v", name, e == nil, want, e)
	}
}
func readWireObject(mode string) map[string]any {
	o := map[string]any{"mode": mode, "oid": strings.Repeat("a", 40)}
	if mode != "160000" {
		o["size"] = 4
	}
	return o
}
func TestResultReadWireModeSpecificRequiredAndForbiddenFields(t *testing.T) {
	for _, mode := range []string{"changes", "file", "diff"} {
		t.Run(mode, func(t *testing.T) {
			r := readWireRequest(t, mode)
			readWireAssert(t, "ResultReadRequest", r, true)
			for _, field := range []string{"path", "side", "cursor"} {
				q := readWireRequest(t, mode)
				allowed := field == "cursor" && mode == "changes" || field == "path" && mode != "changes" || field == "side" && mode == "file"
				if !allowed {
					q[field] = "irrelevant"
					readWireAssert(t, "ResultReadRequest", q, false)
				}
			}
			for _, field := range []string{"identity", "identity_digest", "mode"} {
				q := readWireRequest(t, mode)
				delete(q, field)
				readWireAssert(t, "ResultReadRequest", q, false)
			}
			if mode != "changes" {
				q := readWireRequest(t, mode)
				delete(q, "path")
				readWireAssert(t, "ResultReadRequest", q, false)
			}
			if mode == "file" {
				q := readWireRequest(t, mode)
				delete(q, "side")
				readWireAssert(t, "ResultReadRequest", q, false)
			}
			q := readWireRequest(t, mode)
			q["unknown"] = true
			readWireAssert(t, "ResultReadRequest", q, false)
			q = readWireRequest(t, mode)
			q["path"] = nil
			readWireAssert(t, "ResultReadRequest", q, false)
		})
	}
	for _, p := range []string{"../escape", "x/../escape", "/absolute", "a\\b", "C:drive", "a\x00b", "a//b", "a/"} {
		r := readWireRequest(t, "file")
		r["path"] = p
		readWireAssert(t, "ResultReadRequest", r, false)
	}
}
func TestResultReadWireResponseShapeAndChangeFacts(t *testing.T) {
	r := readWireRequest(t, "file")
	file := map[string]any{"schema_version": 1, "request": r, "status": "available", "object": readWireObject("100644"), "text": "text"}
	readWireAssert(t, "ResultReadResponse", file, true)
	delete(file, "text")
	readWireAssert(t, "ResultReadResponse", file, false)
	file["object"] = readWireObject("160000")
	readWireAssert(t, "ResultReadResponse", file, true)
	file["text"] = "not fetched"
	readWireAssert(t, "ResultReadResponse", file, false)
	for _, mode := range []string{"changes", "diff"} {
		out := map[string]any{"schema_version": 1, "request": readWireRequest(t, mode), "status": "available"}
		readWireAssert(t, "ResultReadResponse", out, false)
		if mode == "changes" {
			out["changes"] = []any{}
			out["total_changes"] = 0
		} else {
			out["text"] = ""
		}
		readWireAssert(t, "ResultReadResponse", out, true)
	}
	for _, status := range []string{"A", "D", "M", "T"} {
		c := map[string]any{"path": "file", "status": status}
		readWireAssert(t, "ResultChange", c, false)
		if status != "A" {
			c["old"] = readWireObject("100644")
		}
		if status != "D" {
			c["new"] = readWireObject("100755")
		}
		readWireAssert(t, "ResultChange", c, true)
		if status == "A" {
			c["old"] = readWireObject("100644")
			readWireAssert(t, "ResultChange", c, false)
		}
		if status == "D" {
			c["new"] = readWireObject("100644")
			readWireAssert(t, "ResultChange", c, false)
		}
	}
	o := readWireObject("100644")
	delete(o, "size")
	readWireAssert(t, "ResultObject", o, false)
	o = readWireObject("160000")
	o["size"] = 0
	readWireAssert(t, "ResultObject", o, false)
}
func TestResultReadWireUnicodeRawAndEncodedByteBounds(t *testing.T) {
	out := map[string]any{"schema_version": 1, "request": readWireRequest(t, "file"), "status": "available", "object": readWireObject("100644"), "text": strings.Repeat("🙂", 65536/4)}
	readWireAssert(t, "ResultReadResponse", out, true)
	out["text"] = strings.Repeat("🙂", 65536/4+1)
	readWireAssert(t, "ResultReadResponse", out, false)
	out["text"] = strings.Repeat("\x01", 65536)
	readWireAssert(t, "ResultReadResponse", out, true)
	out["text"] = strings.Repeat("\x01", 90000)
	readWireAssert(t, "ResultReadResponse", out, false)
	r := readWireRequest(t, "file")
	r["path"] = strings.Repeat("🙂", 1025)
	readWireAssert(t, "ResultReadRequest", r, false)
	raw, _ := json.Marshal(readWireRequest(t, "file"))
	raw = []byte(strings.Replace(string(raw), "unicodé", `\ud800`, 1))
	if Validate("ResultReadRequest", raw) == nil {
		t.Fatal("unpaired surrogate accepted")
	}
}

func TestResultReadCaptureAndIntegrationSurviveTypedRoundTrip(t *testing.T) {
	fixture := readWireRequest(t, "file")
	i := fixture["identity"].(protocol.ResultReadIdentity)
	i.Integration = &protocol.WorkspaceIntegrationResult{Outcome: protocol.Integrated, StartCommit: i.Capture.StartCommit, NodeCommit: i.Capture.NodeCommit, NodeTree: i.Capture.NodeTree, ExpectedTaskCommit: strings.Repeat("4", 40), TaskCommit: strings.Repeat("5", 40), TaskTree: strings.Repeat("6", 40)}
	i.GitCommit, i.GitTree = i.Integration.TaskCommit, i.Integration.TaskTree
	_, expected, err := Canonical(i)
	if err != nil {
		t.Fatal(err)
	}
	fixture["identity"], fixture["identity_digest"] = i, expected
	raw, err := json.Marshal(fixture)
	if err != nil {
		t.Fatal(err)
	}
	var request protocol.ResultReadRequest
	if err := Decode("ResultReadRequest", raw, &request); err != nil {
		t.Fatal(err)
	}
	if request.Identity.Capture != i.Capture || request.Identity.Integration == nil || *request.Identity.Integration != *i.Integration {
		t.Fatal("typed read lost captured or integrated provenance")
	}
	_, actual, err := Canonical(request.Identity)
	if err != nil || actual != expected {
		t.Fatal("typed read changed its immutable identity", err)
	}
	for _, field := range []string{"capture", "integration", "resource"} {
		t.Run(field, func(t *testing.T) {
			changed := request.Identity
			proof := *changed.Integration
			changed.Integration = &proof
			switch field {
			case "capture":
				changed.Capture.NodeTree = strings.Repeat("7", 40)
			case "integration":
				changed.Integration.TaskTree = strings.Repeat("8", 40)
			case "resource":
				changed.ResourceID = "other-repository"
			}
			_, digest, err := Canonical(changed)
			if err != nil || digest == expected {
				t.Fatal("changed nested provenance retained read identity", err)
			}
		})
	}
}
