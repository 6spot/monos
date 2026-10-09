package adapter

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
)

const catalogScratch = "/var/lib/monos-probe/execution/catalog-test/scratch"

const freeCost = `[{"input":0,"output":0,"cache":{"read":0,"write":0}}]`

func catalogEntry(model, cost string) string {
	provider, id, _ := strings.Cut(model, "/")
	entry := `{"id":"` + id + `","modelID":"` + id + `","providerID":"` + provider + `","status":"active","enabled":true,"capabilities":{"tools":true}`
	if cost != "" {
		entry += `,"cost":` + cost
	}
	return entry + "}"
}

func catalogEnvelope(directory string, entries ...string) string {
	location, _ := json.Marshal(map[string]string{"directory": directory})
	return `{"location":` + string(location) + `,"data":[` + strings.Join(entries, ",") + `]}`
}

func modelCatalogAt(directory, model, cost string) string {
	return catalogEnvelope(directory, catalogEntry(model, cost))
}

func modelCatalog(model, cost string) string {
	return modelCatalogAt(catalogScratch, model, cost)
}

func catalog(cost string) string { return modelCatalog(host.FreeModel, cost) }

func TestCatalogRequiresExactEnabledActiveToolModel(t *testing.T) {
	selected := host.FreeModel
	valid := modelCatalog(selected, freeCost)
	_, bareID, _ := strings.Cut(selected, "/")
	for name, output := range map[string]string{
		"valid":                     valid,
		"unrelated entry":           catalogEnvelope(catalogScratch, catalogEntry("other/model", ""), catalogEntry(selected, freeCost)),
		"upstream model ID differs": strings.Replace(valid, `"modelID":"`, `"modelID":"upstream-`, 1),
	} {
		t.Run(name, func(t *testing.T) {
			if err := validateCatalog(output, selected, catalogScratch); err != nil {
				t.Fatal(err)
			}
		})
	}
	for name, output := range map[string]string{
		"refresh message only": "Models cache refreshed\n",
		"missing model":        catalogEnvelope(catalogScratch),
		"missing data":         strings.Replace(valid, `"data":`, `"other":`, 1),
		"wrong exact ID":       strings.Replace(valid, `"id":"`+bareID+`"`, `"id":"`+bareID+`-other"`, 1),
		"qualified ID":         strings.Replace(valid, `"id":"`+bareID+`"`, `"id":"`+selected+`"`, 1),
		"wrong provider":       strings.Replace(valid, `"providerID":"`, `"providerID":"other-`, 1),
		"deprecated":           strings.Replace(valid, `"active"`, `"deprecated"`, 1),
		"missing status":       strings.Replace(valid, `"status":"active",`, "", 1),
		"disabled":             strings.Replace(valid, `"enabled":true`, `"enabled":false`, 1),
		"missing enabled":      strings.Replace(valid, `"enabled":true,`, "", 1),
		"no tools":             strings.Replace(valid, `"tools":true`, `"tools":false`, 1),
		"old tool capability":  strings.Replace(valid, `"tools":true`, `"toolcall":true`, 1),
		"duplicate entry":      catalogEnvelope(catalogScratch, catalogEntry(selected, freeCost), catalogEntry(selected, freeCost)),
		"missing location":     `{"data":[` + catalogEntry(selected, freeCost) + `]}`,
		"missing directory":    strings.Replace(valid, `"directory"`, `"other"`, 1),
		"wrong directory":      strings.Replace(valid, catalogScratch, catalogScratch+"-other", 1),
		"empty directory":      strings.Replace(valid, catalogScratch, "", 1),
		"invalid JSON":         `{"data":[`,
		"trailing JSON":        valid + `{}`,
	} {
		t.Run(name, func(t *testing.T) {
			if err := validateCatalog(output, selected, catalogScratch); err == nil {
				t.Fatal("unverified model accepted")
			}
		})
	}
}

func TestFreeCatalogRequiresExplicitZeroPricingInEveryTier(t *testing.T) {
	for _, cost := range []string{
		freeCost,
		`[{"input":0,"output":0,"cache":{"read":0,"write":0}},{"input":0,"output":0,"cache":{"read":0,"write":0},"tier":{"type":"context","size":200000}}]`,
	} {
		if err := validateCatalog(catalog(cost), host.FreeModel, catalogScratch); err != nil {
			t.Fatal(err)
		}
	}
	for name, cost := range map[string]string{
		"missing cost":       "",
		"null cost":          `null`,
		"empty tiers":        `[]`,
		"null tier":          `[null]`,
		"missing prices":     `[{}]`,
		"old object shape":   strings.Trim(freeCost, "[]"),
		"missing cache read": `[{"input":0,"output":0,"cache":{"write":0}}]`,
		"null price":         strings.Replace(freeCost, `"input":0`, `"input":null`, 1),
		"paid input":         strings.Replace(freeCost, `"input":0`, `"input":1`, 1),
		"paid output":        strings.Replace(freeCost, `"output":0`, `"output":1`, 1),
		"paid cache read":    strings.Replace(freeCost, `"read":0`, `"read":1`, 1),
		"paid cache write":   strings.Replace(freeCost, `"write":0`, `"write":1`, 1),
		"unknown price":      `[{"input":0,"output":0,"cache":{"read":0,"write":0},"new_fee":1}]`,
		"paid later tier":    `[{"input":0,"output":0,"cache":{"read":0,"write":0}},{"input":1,"output":0,"cache":{"read":0,"write":0},"tier":{"type":"context","size":200000}}]`,
	} {
		t.Run(name, func(t *testing.T) {
			if err := validateCatalog(catalog(cost), host.FreeModel, catalogScratch); err == nil {
				t.Fatal("unverified free pricing accepted")
			}
		})
	}
}

func TestCatalogRejectsUnapprovedModel(t *testing.T) {
	for _, model := range []string{"", "opencode/mimo-v2.6-flash-free", "volcengine/other", host.DeepSeekModel + "-other"} {
		if err := validateCatalog(modelCatalog(model, freeCost), model, catalogScratch); err == nil {
			t.Fatalf("unapproved model accepted: %q", model)
		}
	}
}

func successfulTestPreflight(protocol.Dispatch, []string) error { return nil }

func TestCatalogPendingRequiresWellFormedSnapshot(t *testing.T) {
	for _, raw := range []string{catalogEnvelope(catalogScratch), catalogEnvelope(catalogScratch, catalogEntry("other/model", ""))} {
		if err := validateCatalog(raw, host.FreeModel, catalogScratch); !errors.Is(err, errCatalogPending) {
			t.Fatal("missing selected entry was not pending", err)
		}
	}
	valid := catalog(freeCost)
	for _, raw := range []string{
		`{"location":{"directory":"` + catalogScratch + `"}}`,
		`{"location":{"directory":"` + catalogScratch + `"},"data":null}`,
		`{"location":{"directory":"` + catalogScratch + `"},"data":{}}`,
		catalogEnvelope(catalogScratch, "null"),
		catalogEnvelope(catalogScratch, "{}"),
		catalogEnvelope(catalogScratch, catalogEntry(host.FreeModel, freeCost), catalogEntry(host.FreeModel, freeCost)),
		strings.Replace(valid, `"input":0`, `"input":1`, 1),
		strings.Replace(valid, `"enabled":true`, `"enabled":false`, 1),
		modelCatalogAt(catalogScratch+"-other", host.FreeModel, freeCost),
	} {
		if err := validateCatalog(raw, host.FreeModel, catalogScratch); err == nil || errors.Is(err, errCatalogPending) {
			t.Fatalf("invalid snapshot treated as ready or pending: %v", err)
		}
	}
}
