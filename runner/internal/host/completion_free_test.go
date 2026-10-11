package host

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	protocol "monos.local/protocol"
)

func TestRepositoryFreeCompletionPreservesReleasedPredecessorCheckpoint(t *testing.T) {
	for _, tc := range []struct {
		name       string
		released   bool
		checkpoint bool
		owned      bool
		allowed    bool
	}{
		{"released predecessor checkpoint", true, true, false, true},
		{"released predecessor completion", true, false, false, true},
		{"live predecessor checkpoint", false, true, false, false},
		{"live predecessor allocation", false, false, false, false},
		{"released current checkpoint", true, true, true, false},
		{"released current allocation", true, false, true, false},
		{"live current allocation", false, false, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := workspaceFixtureRecord(t)
			r.Released = tc.released
			if tc.checkpoint {
				r.PrivateCheckpoint = &protocol.WorkspaceCheckpoint{OperationID: "predecessor-stop", HeadCommit: r.Metadata.BaseCommit,
					CommitID: strings.Repeat("c", 40), TreeID: strings.Repeat("d", 40)}
			}
			attemptID := "repository-free-attempt"
			if tc.owned {
				attemptID = r.Operation.AttemptID
			}
			path := filepath.Join(t.TempDir(), "workspace.json")
			if err := saveRecord(path, r); err != nil {
				t.Fatal(err)
			}
			before := readCompletionFile(t, path)
			retained, err := readWorkspaceRecordAt(path, r.Operation.Workspace.WorkspaceID, uint32(os.Geteuid()))
			if err != nil {
				t.Fatal(err)
			}
			if err := validateRepositoryFreeWorkspace(retained, attemptID); (err == nil) != tc.allowed {
				t.Fatalf("repository-free completion allowed=%v, want %v: %v", err == nil, tc.allowed, err)
			}
			if !reflect.DeepEqual(retained, r) || !bytes.Equal(before, readCompletionFile(t, path)) {
				t.Fatal("repository-free completion changed retained ownership or checkpoint")
			}
		})
	}
}
