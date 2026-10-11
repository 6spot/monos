// Package resources owns local admission policy, never execution scheduling.
package resources

import (
	"context"
	"fmt"
	protocol "monos.local/protocol"
	"path/filepath"
)

const MaxSafeInteger int64 = 9007199254740991

type ExecutionLimits struct {
	CPUQuotaPercent int64 `json:"cpu_quota_percent"`
	MemoryMaxBytes  int64 `json:"memory_max_bytes"`
	TasksMax        int64 `json:"tasks_max"`
}

type Config struct {
	ExecutionLimits          ExecutionLimits `json:"execution_limits"`
	StorageMinFreeBytes      int64           `json:"storage_min_free_bytes"`
	LogRetentionHours        int64           `json:"log_retention_hours"`
	InspectionRetentionHours int64           `json:"inspection_retention_hours"`
}

// Defaults are deliberately finite. An omitted value uses the default; negative
// and excessive values are errors, never an unlimited-resource escape hatch.
func (c *Config) Normalize() error {
	if c.ExecutionLimits.CPUQuotaPercent == 0 {
		c.ExecutionLimits.CPUQuotaPercent = 200
	}
	if c.ExecutionLimits.MemoryMaxBytes == 0 {
		c.ExecutionLimits.MemoryMaxBytes = 4 << 30
	}
	if c.ExecutionLimits.TasksMax == 0 {
		c.ExecutionLimits.TasksMax = 512
	}
	if c.StorageMinFreeBytes == 0 {
		c.StorageMinFreeBytes = 1 << 30
	}
	if c.LogRetentionHours == 0 {
		c.LogRetentionHours = 168
	}
	if c.InspectionRetentionHours == 0 {
		c.InspectionRetentionHours = 24
	}
	l := c.ExecutionLimits
	if l.CPUQuotaPercent < 1 || l.CPUQuotaPercent > 100000 || l.MemoryMaxBytes < 64<<20 || l.MemoryMaxBytes > MaxSafeInteger || l.TasksMax < 16 || l.TasksMax > 1048576 || c.StorageMinFreeBytes < 1 || c.StorageMinFreeBytes > MaxSafeInteger || c.LogRetentionHours < 1 || c.LogRetentionHours > 87600 || c.InspectionRetentionHours < 1 || c.InspectionRetentionHours > 87600 {
		return fmt.Errorf("invalid Runner resource configuration")
	}
	return nil
}

func (l ExecutionLimits) Properties() []string {
	return []string{fmt.Sprintf("CPUQuota=%d%%", l.CPUQuotaPercent), fmt.Sprintf("MemoryMax=%d", l.MemoryMaxBytes), fmt.Sprintf("TasksMax=%d", l.TasksMax)}
}

type StorageHealth struct {
	Scope        string `json:"scope"`
	Status       string `json:"status"`
	MinFreeBytes int64  `json:"min_free_bytes"`
	FreeBytes    *int64 `json:"free_bytes,omitempty"`
	TotalBytes   *int64 `json:"total_bytes,omitempty"`
}

type Path struct {
	Scope       string
	Directories []string
}
type Stat func(string) (free, total int64, err error)
type Monitor struct {
	Config Config
	Paths  []Path
	Stat   Stat
}

func New(c Config, root, journal string) (*Monitor, error) {
	if !filepath.IsAbs(root) || !filepath.IsAbs(journal) {
		return nil, fmt.Errorf("absolute Runner storage paths required")
	}
	if err := c.Normalize(); err != nil {
		return nil, err
	}
	return &Monitor{Config: c, Paths: []Path{
		{"journal", []string{filepath.Dir(journal), filepath.Join(root, "service")}},
		{"logs", []string{filepath.Join(root, "logs")}},
		{"cache", []string{filepath.Join(root, "cache")}},
		{"workspaces", []string{filepath.Join(root, "tasks"), filepath.Join(root, "execution")}},
		{"inspection", []string{filepath.Join(root, "inspection"), filepath.Join(root, "service", "inspection-operations")}},
	}}, nil
}

func (m *Monitor) Observe() []StorageHealth {
	stat := m.Stat
	if stat == nil {
		stat = DiskSpace
	}
	out := make([]StorageHealth, 0, len(m.Paths))
	for _, p := range m.Paths {
		h := StorageHealth{Scope: p.Scope, Status: "unknown", MinFreeBytes: m.Config.StorageMinFreeBytes}
		// One scope can span mounts (for example a service-private clone and its
		// published inspection). Report the least free member, or unknown if any
		// required location cannot be observed; never assume the common root is
		// the filesystem that actually receives the writes.
		for _, directory := range p.Directories {
			free, total, err := stat(directory)
			if err != nil || free < 0 || total < free || total > MaxSafeInteger {
				h.Status = "unknown"
				h.FreeBytes = nil
				h.TotalBytes = nil
				break
			}
			if h.FreeBytes == nil || free < *h.FreeBytes {
				h.FreeBytes = &free
				h.TotalBytes = &total
			}
			h.Status = "ok"
			if *h.FreeBytes < h.MinFreeBytes {
				h.Status = "low"
			}
		}
		out = append(out, h)
	}
	return out
}

func (m *Monitor) Guard(scopes ...string) error {
	if m == nil {
		return nil
	}
	wanted := map[string]bool{}
	for _, scope := range scopes {
		wanted[scope] = true
	}
	for _, h := range m.Observe() {
		if (len(wanted) == 0 || wanted[h.Scope]) && h.Status != "ok" {
			return fmt.Errorf("Runner storage %s: %s; restore free space before new work", h.Scope, h.Status)
		}
	}
	return nil
}

func (m *Monitor) Report() *protocol.RunnerResources {
	if m == nil {
		return nil
	}
	l := m.Config.ExecutionLimits
	r := &protocol.RunnerResources{ExecutionLimits: protocol.ExecutionResourceLimits{CPUQuotaPercent: l.CPUQuotaPercent, MemoryMaxBytes: l.MemoryMaxBytes, TasksMax: l.TasksMax}, LogRetentionHours: m.Config.LogRetentionHours, InspectionRetentionHours: m.Config.InspectionRetentionHours, Storage: []protocol.StorageHealth{}}
	for _, h := range m.Observe() {
		r.Storage = append(r.Storage, protocol.StorageHealth{Scope: protocol.StorageHealthScope(h.Scope), Status: protocol.StorageHealthStatus(h.Status), MinFreeBytes: h.MinFreeBytes, FreeBytes: h.FreeBytes, TotalBytes: h.TotalBytes})
	}
	return r
}

type monitorKey struct{}

func WithMonitor(ctx context.Context, m *Monitor) context.Context {
	return context.WithValue(ctx, monitorKey{}, m)
}
func GuardContext(ctx context.Context, scopes ...string) error {
	m, _ := ctx.Value(monitorKey{}).(*Monitor)
	return m.Guard(scopes...)
}
