package adapter

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
)

// Query the same isolated OpenCode v2 configuration used by the actual run.
// --standalone keeps the private server inside the supervised process tree.
func verifyModel(d protocol.Dispatch, env []string, execute func(*exec.Cmd) error) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, host.Runtime, "api", "--standalone", "model.list")
	cmd.Env = env
	cmd.Dir = host.Path(d.AttemptID, "scratch")
	cmd.WaitDelay = time.Second
	var output bytes.Buffer
	bounded := &BoundedWriter{W: &output, Remaining: 4 << 20}
	cmd.Stdout = bounded
	// Catalog/config diagnostics can contain provider details; never echo them.
	if err := execute(cmd); err != nil {
		return fmt.Errorf("OpenCode model catalog preflight failed")
	}
	if bounded.Truncated {
		return fmt.Errorf("OpenCode model catalog exceeds limit")
	}
	return validateCatalog(output.String(), string(d.Model), cmd.Dir)
}

type modelCost struct {
	Input  *float64 `json:"input"`
	Output *float64 `json:"output"`
	Cache  *struct {
		Read  *float64 `json:"read"`
		Write *float64 `json:"write"`
	} `json:"cache"`
	Tier json.RawMessage `json:"tier"`
}

func (c *modelCost) free() bool {
	zero := func(v *float64) bool { return v != nil && *v == 0 }
	return c != nil && zero(c.Input) && zero(c.Output) && c.Cache != nil && zero(c.Cache.Read) && zero(c.Cache.Write)
}

func validateCatalog(output, selected, scratch string) error {
	if !host.ApprovedModel(selected) {
		return fmt.Errorf("unapproved model")
	}
	var catalog struct {
		Location struct {
			Directory string `json:"directory"`
		} `json:"location"`
		Data []struct {
			ID           string `json:"id"`
			ModelID      string `json:"modelID"`
			ProviderID   string `json:"providerID"`
			Status       string `json:"status"`
			Enabled      bool   `json:"enabled"`
			Capabilities struct {
				Tools bool `json:"tools"`
			} `json:"capabilities"`
			Cost json.RawMessage `json:"cost"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(output), &catalog); err != nil {
		return fmt.Errorf("invalid OpenCode model catalog")
	}
	if catalog.Location.Directory != scratch {
		return fmt.Errorf("OpenCode catalog location differs from Attempt scratch")
	}
	matches := 0
	for _, model := range catalog.Data {
		if model.ProviderID+"/"+model.ID != selected {
			continue
		}
		matches++
		if model.Status != "active" || !model.Enabled || !model.Capabilities.Tools {
			return fmt.Errorf("approved OpenCode model is not enabled, active and tool capable")
		}
		if selected == host.FreeModel {
			var costs []*modelCost
			decoder := json.NewDecoder(strings.NewReader(string(model.Cost)))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&costs); err != nil || len(costs) == 0 {
				return fmt.Errorf("approved OpenCode model does not have verified zero pricing")
			}
			for _, cost := range costs {
				if !cost.free() {
					return fmt.Errorf("approved OpenCode model does not have verified zero pricing")
				}
			}
		}
	}
	if matches != 1 {
		return fmt.Errorf("approved OpenCode model unavailable in Attempt catalog")
	}
	return nil
}
