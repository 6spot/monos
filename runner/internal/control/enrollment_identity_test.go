package control

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnrolledRunnerIdentityRequiresPrivateUnaliasedFile(t *testing.T) {
	for _, variant := range []string{"valid", "mode", "symlink", "hardlink", "directory", "missing-version", "invalid-token", "extra-field"} {
		t.Run(variant, func(t *testing.T) {
			dir, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			_ = os.Chmod(dir, 0700)
			path := filepath.Join(dir, "identity.json")
			identity := map[string]any{"schema_version": 1, "runner_id": "runner", "credential": strings.Repeat("a", 43)}
			switch variant {
			case "missing-version":
				delete(identity, "schema_version")
			case "invalid-token":
				identity["credential"] = "short"
			case "extra-field":
				identity["extra"] = true
			}
			raw, _ := json.Marshal(identity)
			_ = os.WriteFile(path, raw, 0600)
			switch variant {
			case "mode":
				_ = os.Chmod(path, 0640)
			case "symlink":
				_ = os.Rename(path, path+".actual")
				_ = os.Symlink(path+".actual", path)
			case "hardlink":
				_ = os.Link(path, path+".alias")
			case "directory":
				_ = os.Chmod(dir, 0750)
			}
			client, err := New(Config{Endpoint: "http://127.0.0.1", TokenFile: path})
			if (err == nil) != (variant == "valid") {
				t.Fatal("incorrect identity admission", err)
			}
			if err == nil && (client.Config.RunnerID != "runner" || client.token != strings.Repeat("a", 43)) {
				t.Fatal("identity was not resolved")
			}
		})
	}
}

func TestExplicitProbeIdentityRetainsRawCredential(t *testing.T) {
	path := filepath.Join(t.TempDir(), "token")
	token := strings.Repeat("z", 43)
	if err := os.WriteFile(path, []byte(token), 0600); err != nil {
		t.Fatal(err)
	}
	client, err := New(Config{Endpoint: "http://127.0.0.1", TokenFile: path, RunnerID: "probe"})
	if err != nil || client.Config.RunnerID != "probe" || client.token != token {
		t.Fatal("probe credential behavior changed", err)
	}
}
