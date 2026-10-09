package host

import (
	protocol "monos.local/protocol"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func TestHelperRejectsUnboundedOrUntrustedInput(t *testing.T) {
	for _, raw := range []string{`{"action":"status","attempt_id":"../escape"}`, `{"action":"shell","attempt_id":"a"}`, `{"action":"status","attempt_id":"a","command":"/bin/sh"}`, `{"action":"status","attempt_id":"a"} {}`, strings.Repeat("a", 1048577)} {
		if _, err := DecodeRequest(strings.NewReader(raw)); err == nil {
			t.Fatalf("accepted unsafe request %.100s", raw)
		}
	}
	if _, err := DecodeRequest(strings.NewReader(`{"action":"status","attempt_id":"a"}`)); err != nil {
		t.Fatal(err)
	}
}

func TestTraversalRootSurvivesRestrictiveUmask(t *testing.T) {
	path := filepath.Join(t.TempDir(), "attempt")
	previous := syscall.Umask(0027)
	defer syscall.Umask(previous)
	if err := createTraversalRoot(path, os.Getuid(), os.Getgid()); err != nil {
		t.Fatal(err)
	}
	if err := createTraversalRoot(path, os.Getuid(), os.Getgid()); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0750); err != nil {
		t.Fatal(err)
	}
	if createTraversalRoot(path, os.Getuid(), os.Getgid()) == nil {
		t.Fatal("reused a root with no execution-account traversal")
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0750 {
		t.Fatal("silently repaired an ambiguous existing root")
	}
}

func TestUnitOwnershipRejectsOtherServiceAndCgroup(t *testing.T) {
	valid := map[string]string{"Transient": "yes", "User": "me", "Group": "monos-probe-read", "Description": "monos probe attempt dispatch-a", "ControlGroup": "/system.slice/" + Unit("a")}
	if err := validateUnit(valid, Unit("a"), "monos probe attempt dispatch-a"); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"Transient", "User", "Group", "Description", "ControlGroup"} {
		bad := make(map[string]string)
		for k, v := range valid {
			bad[k] = v
		}
		bad[key] = "other"
		if validateUnit(bad, Unit("a"), "monos probe attempt dispatch-a") == nil {
			t.Fatalf("accepted changed %s", key)
		}
	}
}

func TestTrustedFileRejectsSymlinkAndWritableFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(path, []byte("owned"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := trustedFile(path, uint32(os.Getuid())); err != nil {
		t.Fatal(err)
	}
	link := path + ".link"
	if err := os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	if trustedFile(link, uint32(os.Getuid())) == nil {
		t.Fatal("accepted symlink")
	}
	if err := os.Chmod(path, 0666); err != nil {
		t.Fatal(err)
	}
	if trustedFile(path, uint32(os.Getuid())) == nil {
		t.Fatal("accepted writable file")
	}
}

func TestAtomicRecordIgnoresUnfinishedTemporaryFile(t *testing.T) {
	dir := t.TempDir()
	stale := filepath.Join(dir, ".record-crashed")
	if err := os.WriteFile(stale, []byte("partial"), 0600); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "record.json")
	if err := saveRecord(path, map[string]string{"stage": "started"}); err != nil {
		t.Fatal(err)
	}
	if err := saveRecord(path, map[string]string{"stage": "finished"}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil || string(raw) != `{"stage":"finished"}` {
		t.Fatalf("atomic record update failed: %s %v", raw, err)
	}
	if _, err := os.Stat(stale); err != nil {
		t.Fatal("crash evidence was removed")
	}
}

func TestOperationReplayBindsImmutableIdentity(t *testing.T) {
	a := protocol.Operation{OperationID: "op", AttemptID: "a", DispatchID: "d", ResourceID: ptr("r"), RequestID: "req", SchemaVersion: 1, Kind: protocol.KindCompleteNode}
	b := a
	b.State = "recovery"
	if !sameOperation(a, b) {
		t.Fatal("mutable control projection rejected")
	}
	b.ResourceID = ptr("other")
	if sameOperation(a, b) {
		t.Fatal("changed immutable resource accepted")
	}
}
func TestPrivilegeConfigurationIsNotCallerControlled(t *testing.T) {
	p := strings.Join(properties("a", false), "\n")
	for _, required := range []string{"User=me", "Group=monos-probe-read", "NoNewPrivileges=yes", "KillMode=control-group"} {
		if !strings.Contains(p, required) {
			t.Fatal(required)
		}
	}
	for _, forbidden := range []string{"User=root", "Delegate=yes", "ProtectSystem=strict", "PrivatePIDs"} {
		if strings.Contains(p, forbidden) {
			t.Fatal(forbidden)
		}
	}
}
func TestDispatchIdentityMustMatchHelperRequest(t *testing.T) {
	d := protocol.Dispatch{AttemptID: "other", RuntimeID: protocol.Opencode, Model: FreeModel}
	if ValidateRequest(Request{Action: "start", AttemptID: "a", Dispatch: &d}) == nil {
		t.Fatal("accepted cross-attempt start")
	}
}

func TestHelperLaunchRequiresExplicitApprovedModel(t *testing.T) {
	d := protocol.Dispatch{AttemptID: "a", DispatchID: "d", RunnerID: "runner", TaskID: ptr("task"), ResourceID: ptr("repo"), Kind: protocol.Node, RuntimeID: protocol.Opencode, MutationAllowed: true, Prompt: "probe"}
	for _, model := range []protocol.Model{FreeModel, DeepSeekModel} {
		d.Model = model
		if err := ValidateRequest(Request{Action: "start", AttemptID: "a", Dispatch: &d}); err != nil {
			t.Fatalf("approved model rejected: %s: %v", model, err)
		}
	}
	for _, model := range []protocol.Model{"", "opencode/mimo-v2.6-flash-free", "volcengine/other", DeepSeekModel + "-other"} {
		d.Model = model
		if err := ValidateRequest(Request{Action: "start", AttemptID: "a", Dispatch: &d}); err == nil {
			t.Fatalf("unapproved model launch accepted: %q", model)
		}
	}
}

func TestRevocationTombstoneRejectsLateStartAndOwnershipReplacement(t *testing.T) {
	d := protocol.Dispatch{AttemptID: "a", DispatchID: "d", RunnerID: "runner", TaskID: ptr("task"), ResourceID: ptr("repo"), Kind: protocol.Node, RuntimeID: protocol.Opencode, Model: FreeModel, Prompt: "probe"}
	if err := ValidateRequest(Request{Action: "tombstone", AttemptID: "a", Dispatch: &d}); err != nil {
		t.Fatal(err)
	}
	revoked, err := revokedManifest(nil, d, "boot")
	if err != nil || !revoked.Revoked || revoked.Launched {
		t.Fatalf("invalid tombstone: %+v %v", revoked, err)
	}
	if _, err = revokedManifest(&revoked, d, "boot"); err != nil {
		t.Fatal(err)
	}
	live := d
	live.MutationAllowed = true
	if err = ValidateRequest(Request{Action: "tombstone", AttemptID: "a", Dispatch: &live}); err == nil {
		t.Fatal("accepted live dispatch revocation")
	}
	if err = validateRepeatedStart(revoked, live); err == nil {
		t.Fatal("late start passed tombstone")
	}
	if err = validateRepeatedStart(revoked, d); err == nil {
		t.Fatal("revoked start passed tombstone")
	}
	if _, err = revokedManifest(&Manifest{Dispatch: d, Launched: true}, d, "boot"); err == nil {
		t.Fatal("replaced launched ownership with never-launched tombstone")
	}
	changed := d
	changed.ResourceID = ptr("other")
	if _, err = revokedManifest(&revoked, changed, "boot"); err == nil {
		t.Fatal("changed tombstone identity")
	}
}

func TestTraversalRootRejectsUnownedExistingPaths(t *testing.T) {
	for _, kind := range []string{"symlink", "file", "owner", "group"} {
		t.Run(kind, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "attempt")
			uid, gid := os.Getuid(), os.Getgid()
			switch kind {
			case "symlink":
				if err := os.Symlink(t.TempDir(), path); err != nil {
					t.Fatal(err)
				}
			case "file":
				if err := os.WriteFile(path, nil, 0755); err != nil {
					t.Fatal(err)
				}
			default:
				if err := createTraversalRoot(path, uid, gid); err != nil {
					t.Fatal(err)
				}
				if kind == "owner" {
					uid++
				} else {
					gid++
				}
			}
			before, err := os.Lstat(path)
			if err != nil {
				t.Fatal(err)
			}
			if err := createTraversalRoot(path, uid, gid); err == nil {
				t.Fatal("accepted existing path with incompatible ownership or type")
			}
			after, err := os.Lstat(path)
			if err != nil || !os.SameFile(before, after) || before.Mode() != after.Mode() {
				t.Fatal("changed rejected path")
			}
		})
	}
}

func TestCaptureExitStatusIsDistinctFromOrdinaryExit(t *testing.T) {
	for _, state := range []string{"active", "failed", "inactive", "deactivating"} {
		values := map[string]string{"ActiveState": state, "MainPID": "0", "Result": "exit-code", "ExecMainCode": "1", "ExecMainStatus": "74"}
		if !captureFailedExit(values) {
			t.Fatal("lost worker capture failure", state)
		}
		values["ExecMainStatus"] = "1"
		if captureFailedExit(values) {
			t.Fatal("ordinary exit treated as capture failure")
		}
		values["ExecMainStatus"] = "74"
		values["ExecMainCode"] = "2"
		if captureFailedExit(values) {
			t.Fatal("signal treated as worker exit")
		}
	}
}

func TestSystemdMainExitFactDoesNotRequireWholeTreeAbsence(t *testing.T) {
	// RemainAfterExit keeps the unit active while background descendants retain
	// its cgroup. ExecMainCode and MainPID describe the worker itself.
	values := map[string]string{"ActiveState": "active", "SubState": "exited", "MainPID": "0", "ExecMainCode": "1", "ExecMainStatus": "0", "Result": "success"}
	exited, code := mainExit(values)
	if !exited || code == nil || *code != 0 {
		t.Fatalf("lost active (exited) worker fact: %v %v", exited, code)
	}
	values["MainPID"] = "42"
	if exited, _ := mainExit(values); exited {
		t.Fatal("live main process treated as exited")
	}
	values["MainPID"] = "0"
	values["ExecMainCode"] = "0"
	if exited, _ := mainExit(values); exited {
		t.Fatal("missing wait result treated as exit")
	}
	values["ExecMainCode"] = "2"
	if exited, code := mainExit(values); !exited || code != nil {
		t.Fatal("signal exit lost or misreported as numeric exit code")
	}
}
