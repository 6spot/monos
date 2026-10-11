package host

import (
	"encoding/json"
	"path/filepath"

	"monos.local/runner/internal/enrollment/storage"
	"monos.local/runner/internal/resources"
	"monos.local/runner/internal/wire"
)

const ResourceConfigPath = "/etc/monos-probe/runner.json"

// The privileged launcher takes policy only from the installed root-owned
// configuration. Neither Agent envelopes nor service helper requests carry
// executable properties, resource limits, or arbitrary filesystem paths.
func installedResources() (*resources.Monitor, error) {
	if err := trustedDir(filepath.Dir(ResourceConfigPath), 0); err != nil {
		return nil, err
	}
	if err := trustedFile(ResourceConfigPath, 0); err != nil {
		return nil, err
	}
	raw, err := storage.Read(ResourceConfigPath, 16384, false)
	if err != nil {
		return nil, err
	}
	if _, _, err = wire.CanonicalRaw(raw); err != nil {
		return nil, err
	}
	var c struct {
		resources.Config
		Journal string `json:"journal"`
	}
	if err = json.Unmarshal(raw, &c); err != nil {
		return nil, err
	}
	return resources.New(c.Config, Root, c.Journal)
}

func guardMaterialization() error {
	m, err := installedResources()
	if err != nil {
		return err
	}
	return m.Guard("journal", "cache", "workspaces")
}
