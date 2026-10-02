package host

import (
	"context"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"

	protocol "monos.local/protocol"
)

func exitedUnitFixture() (Manifest, map[string]string) {
	return Manifest{Dispatch: protocol.Dispatch{AttemptID: "attempt", DispatchID: "dispatch"}, Launched: true, Acknowledged: true}, map[string]string{
		"LoadState": "loaded", "ActiveState": "active", "SubState": "exited", "MainPID": "0", "ExecMainPID": "3724437", "ControlGroup": "", "Transient": "yes", "User": "me", "Group": "monos-probe-read", "Description": "monos probe attempt dispatch", "Result": "success", "ExecMainCode": "1", "ExecMainStatus": "0", "InvocationID": "26fba04be1a04974b39f4cb34e6eabf2", "RemainAfterExit": "yes", "Restart": "no",
	}
}
func copyUnitProperties(values map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range values {
		out[k] = v
	}
	return out
}
func TestExitedRemainAfterExitRequiresKernelAbsenceAndStableIdentity(t *testing.T) {
	for _, group := range []string{"", "/system.slice/" + Unit("attempt")} {
		t.Run(group, func(t *testing.T) {
			m, values := exitedUnitFixture()
			values["ControlGroup"] = group
			observations := 0
			checked := []string{}
			jobChecks := 0
			observe := func() (map[string]string, error) { observations++; return copyUnitProperties(values), nil }
			absent := func(path string) error { checked = append(checked, path); return nil }
			jobs := func() ([]byte, error) { jobChecks++; return []byte("33 unrelated.service start running\n"), nil }
			if err := verifyExitedUnitUsing("attempt", m, values, observe, absent, jobs); err != nil {
				t.Fatal(err)
			}
			if observations != 2 || jobChecks != 1 || !reflect.DeepEqual(checked, []string{"/sys/fs/cgroup/system.slice/" + Unit("attempt"), "/proc/3724437"}) {
				t.Fatal("missing absence proof", observations, jobChecks, checked)
			}
			exited, code := mainExit(values)
			if !exited || code == nil || *code != 0 {
				t.Fatal("lost original main exit")
			}
		})
	}
}
func TestExitedRemainAfterExitRejectsLiveUnknownAndForeignUnits(t *testing.T) {
	for name, edit := range map[string]func(*Manifest, map[string]string){
		"no-ack":               func(m *Manifest, v map[string]string) { m.Acknowledged = false },
		"never-launched":       func(m *Manifest, v map[string]string) { m.Launched = false },
		"revoked":              func(m *Manifest, v map[string]string) { m.Revoked = true },
		"other-attempt":        func(m *Manifest, v map[string]string) { m.Dispatch.AttemptID = "other" },
		"other-dispatch":       func(m *Manifest, v map[string]string) { m.Dispatch.DispatchID = "other" },
		"not-loaded":           func(m *Manifest, v map[string]string) { v["LoadState"] = "not-found" },
		"not-transient":        func(m *Manifest, v map[string]string) { v["Transient"] = "no" },
		"other-user":           func(m *Manifest, v map[string]string) { v["User"] = "root" },
		"other-group":          func(m *Manifest, v map[string]string) { v["Group"] = "root" },
		"other-cgroup":         func(m *Manifest, v map[string]string) { v["ControlGroup"] = "/system.slice/foreign.service" },
		"activating":           func(m *Manifest, v map[string]string) { v["ActiveState"] = "activating" },
		"running":              func(m *Manifest, v map[string]string) { v["SubState"] = "running" },
		"main-live":            func(m *Manifest, v map[string]string) { v["MainPID"] = "3724437" },
		"no-main-result":       func(m *Manifest, v map[string]string) { v["ExecMainCode"] = "0" },
		"invalid-exit-status":  func(m *Manifest, v map[string]string) { v["ExecMainStatus"] = "unknown" },
		"missing-original-pid": func(m *Manifest, v map[string]string) { delete(v, "ExecMainPID") },
		"zero-original-pid":    func(m *Manifest, v map[string]string) { v["ExecMainPID"] = "0" },
		"no-invocation":        func(m *Manifest, v map[string]string) { delete(v, "InvocationID") },
		"invalid-invocation":   func(m *Manifest, v map[string]string) { v["InvocationID"] = strings.Repeat("z", 32) },
		"restart-enabled":      func(m *Manifest, v map[string]string) { v["Restart"] = "always" },
		"no-remain":            func(m *Manifest, v map[string]string) { v["RemainAfterExit"] = "no" },
	} {
		t.Run(name, func(t *testing.T) {
			m, v := exitedUnitFixture()
			edit(&m, v)
			if verifyExitedUnitUsing("attempt", m, v, func() (map[string]string, error) { return copyUnitProperties(v), nil }, func(string) error { return nil }, func() ([]byte, error) { return nil, nil }) == nil {
				t.Fatal("unproven unit accepted")
			}
		})
	}
}
func TestExitedRemainAfterExitRejectsOwnershipRacesAndFailedObservations(t *testing.T) {
	for _, mode := range []string{"first-read", "last-read", "initial-state-changed", "invocation-changed", "last-state-changed", "cgroup-exists", "pid-exists", "kernel-read-error", "jobs-error", "pending-start", "pending-stop", "malformed-jobs"} {
		t.Run(mode, func(t *testing.T) {
			m, v := exitedUnitFixture()
			calls := 0
			observe := func() (map[string]string, error) {
				calls++
				out := copyUnitProperties(v)
				if mode == "first-read" && calls == 1 || mode == "last-read" && calls == 2 {
					return nil, errors.New("systemd unavailable")
				}
				if mode == "initial-state-changed" && calls == 1 || mode == "last-state-changed" && calls == 2 {
					out["MainPID"] = "99"
				}
				if mode == "invocation-changed" && calls == 2 {
					out["InvocationID"] = strings.Repeat("a", 32)
				}
				return out, nil
			}
			absent := func(path string) error {
				if mode == "kernel-read-error" || mode == "cgroup-exists" && strings.HasPrefix(path, "/sys/") || mode == "pid-exists" && strings.HasPrefix(path, "/proc/") {
					return errors.New("kernel absence not established")
				}
				return nil
			}
			jobs := func() ([]byte, error) {
				if mode == "jobs-error" {
					return nil, errors.New("jobs unavailable")
				}
				if mode == "pending-start" || mode == "pending-stop" {
					return []byte("1 " + Unit("attempt") + " " + strings.TrimPrefix(mode, "pending-") + " waiting\n"), nil
				}
				if mode == "malformed-jobs" {
					return []byte("incomplete\n"), nil
				}
				return nil, nil
			}
			if verifyExitedUnitUsing("attempt", m, v, observe, absent, jobs) == nil {
				t.Fatal("uncertain observation became absence")
			}
		})
	}
}
func TestProvenExitedUnitAllowsOriginalStopWithoutNewProcessControl(t *testing.T) {
	m, v := exitedUnitFixture()
	inspect := func(context.Context, string) (Status, error) {
		err := verifyExitedUnitUsing("attempt", m, v, func() (map[string]string, error) { return copyUnitProperties(v), nil }, func(string) error { return nil }, func() ([]byte, error) { return nil, nil })
		exited, code := mainExit(v)
		return Status{Known: true, Exists: true, MainExited: exited, ExitCode: code}, err
	}
	s, err := stopWith(context.Background(), "attempt", inspect, func(context.Context, string, ...string) ([]byte, error) {
		t.Fatal("proven absent process was controlled")
		return nil, nil
	})
	if err != nil || !s.Known || s.Populated || !s.MainExited {
		t.Fatal(s, err)
	}
}

func actualUnitStatusIO(t *testing.T, m *Manifest, v map[string]string) unitStatusIO {
	t.Helper()
	return unitStatusIO{
		properties: func(context.Context, string) (map[string]string, error) { return copyUnitProperties(v), nil },
		lstat:      func(string) (os.FileInfo, error) { return nil, os.ErrNotExist },
		population: func(string) (bool, error) { t.Fatal("missing group must bypass Population"); return false, nil },
		identity:   func(int) (Peer, error) { t.Fatal("exited unit has no current MainPID"); return Peer{}, nil },
		save:       func(next Manifest) error { *m = next; return nil },
		exited: func(_ context.Context, id string, retained Manifest, initial map[string]string) error {
			return verifyExitedUnitUsing(id, retained, initial, func() (map[string]string, error) { return copyUnitProperties(v), nil }, func(string) error { return nil }, func() ([]byte, error) { return nil, nil })
		},
	}
}

func TestStatusRoutesMissingNonemptyCgroupThroughExitProof(t *testing.T) {
	for _, mode := range []string{"already-missing", "disappears-during-Population", "proof-rejects"} {
		t.Run(mode, func(t *testing.T) {
			m, v := exitedUnitFixture()
			v["ControlGroup"] = "/system.slice/" + Unit("attempt")
			io := actualUnitStatusIO(t, &m, v)
			stats, populations, proofs := 0, 0, 0
			io.lstat = func(path string) (os.FileInfo, error) {
				stats++
				if path != "/sys/fs/cgroup"+v["ControlGroup"] {
					t.Fatal("wrong group", path)
				}
				if mode == "disappears-during-Population" && stats == 1 {
					return nil, nil
				}
				return nil, os.ErrNotExist
			}
			io.population = func(string) (bool, error) {
				populations++
				if mode != "disappears-during-Population" {
					t.Fatal("queried missing group")
				}
				return false, nil
			}
			verify := io.exited
			io.exited = func(ctx context.Context, id string, m Manifest, v map[string]string) error {
				proofs++
				if mode == "proof-rejects" {
					return errors.New("unresolved kernel proof")
				}
				return verify(ctx, id, m, v)
			}
			s, err := statusOfUnit(context.Background(), "attempt", m, "boot", io)
			if proofs != 1 {
				t.Fatal("production routing bypassed exit proof", proofs)
			}
			if mode == "proof-rejects" {
				if err == nil {
					t.Fatal("failed proof became absence")
				}
				return
			}
			if err != nil || !s.Known || !s.MainExited || s.Populated || s.ExitCode == nil || *s.ExitCode != 0 {
				t.Fatal(s, err)
			}
			if mode == "disappears-during-Population" && (stats != 2 || populations != 1) {
				t.Fatal("missing disappearance recheck", stats, populations)
			}
		})
	}
}

func TestStatusTwoUnacknowledgedExitedQueriesCannotPromoteAcknowledgement(t *testing.T) {
	for _, group := range []string{"", "/system.slice/" + Unit("attempt")} {
		t.Run(group, func(t *testing.T) {
			persisted, v := exitedUnitFixture()
			persisted.Acknowledged = false
			v["ControlGroup"] = group
			io := actualUnitStatusIO(t, &persisted, v)
			saves := 0
			io.save = func(next Manifest) error { saves++; persisted = next; return nil }
			for n := 0; n < 2; n++ {
				if _, err := statusOfUnit(context.Background(), "attempt", persisted, "boot", io); err == nil {
					t.Fatal("unacknowledged exit acquired authority", n)
				}
			}
			if saves != 0 || persisted.Acknowledged {
				t.Fatal("failed observation persisted a new acknowledgement", saves)
			}
		})
	}
}

func TestStatusLiveAcknowledgementWaitsForCompleteIdentityValidation(t *testing.T) {
	for _, mode := range []string{"live", "foreign-main-cgroup", "identity-error", "population-error", "stat-error"} {
		t.Run(mode, func(t *testing.T) {
			m, v := exitedUnitFixture()
			m.Acknowledged = false
			v["SubState"] = "running"
			v["MainPID"] = "123"
			v["ControlGroup"] = "/system.slice/" + Unit("attempt")
			io := actualUnitStatusIO(t, &m, v)
			saves := 0
			io.save = func(next Manifest) error { saves++; m = next; return nil }
			io.lstat = func(string) (os.FileInfo, error) {
				if mode == "stat-error" {
					return nil, os.ErrPermission
				}
				return nil, nil
			}
			io.population = func(string) (bool, error) {
				if mode == "population-error" {
					return true, errors.New("cannot inspect group")
				}
				return true, nil
			}
			io.identity = func(pid int) (Peer, error) {
				if mode == "identity-error" {
					return Peer{}, errors.New("cannot inspect process")
				}
				p := Peer{PID: pid, Birth: "1234", Cgroup: v["ControlGroup"]}
				if mode == "foreign-main-cgroup" {
					p.Cgroup = "/foreign"
				}
				return p, nil
			}
			io.exited = func(context.Context, string, Manifest, map[string]string) error {
				t.Fatal("live unit routed through exited proof")
				return nil
			}
			s, err := statusOfUnit(context.Background(), "attempt", m, "boot", io)
			if mode == "live" {
				if err != nil || !s.Populated || s.Birth != "1234" || s.MainExited || saves != 1 || !m.Acknowledged {
					t.Fatal(s, err, saves)
				}
			} else if err == nil || saves != 0 || m.Acknowledged {
				t.Fatal("failed live validation wrote acknowledgement", mode, err, saves)
			}
		})
	}
}
