package adapter

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
)

// A cold v2 catalog can be empty before configured plugins activate. Subscribe
// and read within one private lifetime, with the actual Attempt configuration.
func verifyModel(d protocol.Dispatch, env []string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return verifyCatalogServer(ctx, string(d.Model), host.Path(d.AttemptID, "scratch"), env, catalogServerCommand)
}

func catalogServerCommand(ctx context.Context) *exec.Cmd {
	return exec.CommandContext(ctx, host.Runtime, "serve", "--stdio", "--hostname", "127.0.0.1", "--port", "0")
}

var errCatalogPending = errors.New("approved OpenCode model unavailable in Attempt catalog")

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
		Data []*struct {
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
	if catalog.Data == nil {
		return fmt.Errorf("invalid OpenCode model catalog")
	}
	matches := 0
	for _, model := range catalog.Data {
		if model == nil || model.ID == "" || model.ProviderID == "" {
			return fmt.Errorf("invalid OpenCode model catalog entry")
		}
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
	if matches == 0 {
		return errCatalogPending
	}
	if matches != 1 {
		return fmt.Errorf("duplicate approved OpenCode model in Attempt catalog")
	}
	return nil
}
