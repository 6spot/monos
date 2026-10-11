package resources

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"monos.local/runner/internal/wire"
)

func TestStorageScopesFailClosedAndReportCurrentObservation(t *testing.T) {
	m, err := New(Config{}, "/owned", "/private/journal.sqlite")
	if err != nil {
		t.Fatal(err)
	}
	bad := "cache"
	m.Stat = func(path string) (int64, int64, error) {
		if filepath.Base(path) == bad {
			return 0, 0, errors.New("missing mount")
		}
		return 2 << 30, 10 << 30, nil
	}
	if err = m.Guard("logs"); err != nil {
		t.Fatal(err)
	}
	if err = m.Guard(); err == nil {
		t.Fatal("unknown storage admitted new execution")
	}
	r := m.Report()
	raw, _ := json.Marshal(r)
	if len(r.Storage) != 5 || wire.Validate("RunnerResources", raw) != nil {
		t.Fatalf("invalid report: %s", raw)
	}
	if string(r.Storage[2].Status) != "unknown" || r.Storage[2].FreeBytes != nil {
		t.Fatal("unknown observation invented free bytes")
	}
	bad = ""
	if err = m.Guard(); err != nil {
		t.Fatal("restored storage remained blocked", err)
	}
	m.Stat = func(string) (int64, int64, error) { return 1, 10 << 30, nil }
	if err = m.Guard("logs"); err == nil {
		t.Fatal("low storage admitted new work")
	}
	if string(m.Report().Storage[0].Status) != "low" {
		t.Fatal("report did not refresh")
	}
}

func TestDiskSpaceDoesNotMaskMissingMount(t *testing.T) {
	path := t.TempDir()
	free, total, err := DiskSpace(path)
	if err != nil || free < 0 || total < free {
		t.Fatal(free, total, err)
	}
	if _, _, err = DiskSpace(filepath.Join(path, "missing")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("missing mount used parent filesystem", err)
	}
}

func TestResourceConfigCannotDisableLimitsOrOverflowWire(t *testing.T) {
	for _, c := range []Config{{StorageMinFreeBytes: -1}, {ExecutionLimits: ExecutionLimits{CPUQuotaPercent: 100001}}, {ExecutionLimits: ExecutionLimits{MemoryMaxBytes: MaxSafeInteger + 1}}, {ExecutionLimits: ExecutionLimits{TasksMax: 15}}, {LogRetentionHours: 87601}} {
		if c.Normalize() == nil {
			t.Fatal("invalid resource config accepted", c)
		}
	}
	c := Config{}
	if err := c.Normalize(); err != nil {
		t.Fatal(err)
	}
	if c.ExecutionLimits.CPUQuotaPercent <= 0 || c.ExecutionLimits.MemoryMaxBytes <= 0 || c.ExecutionLimits.TasksMax <= 0 || c.LogRetentionHours <= 0 || c.InspectionRetentionHours <= 0 {
		t.Fatal("omission disabled protection")
	}
}
