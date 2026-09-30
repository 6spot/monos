package journal

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSpecificationRetryAfterReopenRetainsExactAuthorizationAndContent(t *testing.T) {
	for _, test := range []struct {
		name, payload string
		changes       [][2]string
	}{
		{"prepare_specification_revision", `{"proposal_id":"proposal","specification":"# Full requirement\n保留全部内容","summary":"Clarify","basis":{"control_version":93,"specification_id":"spec","plan_id":null},"impact":{"graph_sufficient":true,"nodes":[],"guidance":[]},"source_input_ids":["input"],"supersedes":"prior-proposal"}`, [][2]string{{"保留全部内容", "replacement"}, {`"input"`, `"later-input"`}, {`"prior-proposal"`, `"different-prior"`}}},
		{"apply_specification_revision", `{"proposal_id":"proposal","confirmation_id":"owner-receipt","basis":{"control_version":93,"specification_id":"spec","plan_id":null}}`, [][2]string{{`"owner-receipt"`, `"different-receipt"`}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			if err := os.Chmod(root, 0700); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(root, "journal.sqlite")
			db, err := Open(path)
			if err != nil {
				t.Fatal(err)
			}
			raw := []byte(`{"schema_version":1,"request_id":"revision","scope_id":"task","name":"` + test.name + `","expected_control_version":7,"payload":` + test.payload + `}`)
			original, err := db.PutRequest("attempt", raw)
			if err != nil {
				db.Close()
				t.Fatal(err)
			}
			if err = db.Close(); err != nil {
				t.Fatal(err)
			}
			db, err = Open(path)
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			for _, edit := range append(test.changes, [2]string{`"proposal"`, `"replacement-proposal"`}, [2]string{`"control_version":93`, `"control_version":94`}, [2]string{`"expected_control_version":7`, `"expected_control_version":8`}) {
				if _, err = db.PutRequest("attempt", []byte(strings.Replace(string(raw), edit[0], edit[1], 1))); err != ErrConflict {
					t.Fatal("uncertain request changed after restart", edit, err)
				}
			}
			retained, err := db.Request("attempt", "revision")
			if err != nil || string(retained.Raw) != string(original.Raw) || retained.Digest != original.Digest {
				t.Fatal("immutable revision request lost", err)
			}
			if _, err = db.Request("other-attempt", "revision"); err == nil {
				t.Fatal("another Attempt recovered this request")
			}
		})
	}
}
