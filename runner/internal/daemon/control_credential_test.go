package daemon

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Real reconnects reload a private credential instead of retaining stale bytes.
func controlCredentialFixture(t *testing.T) string {
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "runner-credential")
	if err = os.WriteFile(path, []byte(strings.Repeat("r", 43)), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}
