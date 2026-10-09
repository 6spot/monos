//go:build linux

package adapter

import (
	"os"
	"strings"
	"testing"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
)

// Verification-only source added after product builds to the isolated archive.
// This calls the actual free preflight, never Run, a session or a prompt API.
func TestNativeFreeCatalogPreflightOnly(t *testing.T) {
	id := os.Getenv("MONOS_NATIVE_FREE_CATALOG_ATTEMPT")
	if id == "" {
		t.Skip("native no-model validation requires explicit isolated fixture")
	}
	if os.Geteuid() != 1000 || os.Getegid() != 1000 || !host.ValidID(id) || !strings.HasPrefix(id, "native-free-catalog-") {
		t.Fatal("invalid native validation identity")
	}
	groups, err := os.Getgroups()
	if err != nil || len(groups) != 1 || groups[0] != 1000 {
		t.Fatal("native validation supplementary groups differ")
	}
	marker, err := os.ReadFile(host.Path(id, "native-opt-in"))
	if err != nil || string(marker) != id {
		t.Fatal("isolated fixture marker missing")
	}
	d := protocol.Dispatch{AttemptID: id, Kind: "planner", RuntimeID: protocol.Opencode, Model: host.FreeModel}
	env, err := Environment(d)
	if err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	if err := verifyModel(d, env); err != nil {
		t.Fatal(err)
	}
	t.Logf("native no-model free catalog passed in %s", time.Since(started))
}
