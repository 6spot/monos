package host

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"syscall"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

type Manifest struct {
	Dispatch     protocol.Dispatch `json:"dispatch"`
	BootID       string            `json:"boot_id"`
	Launched     bool              `json:"launched"`
	Acknowledged bool              `json:"acknowledged"`
	Revoked      bool              `json:"revoked"`
}

func manifestPath(id string) string { return filepath.Join(Root, "launch", id+".json") }
func ValidateRequest(r Request) error {
	if r.Action == "discover" {
		if r.AttemptID != "" || r.Dispatch != nil || r.Operation != nil {
			return fmt.Errorf("discovery accepts no execution fields")
		}
		return nil
	}
	if !ValidID(r.AttemptID) {
		return fmt.Errorf("invalid attempt ID")
	}
	switch r.Action {
	case "start", "tombstone":
		if r.Dispatch == nil || r.Operation != nil {
			return fmt.Errorf("start/tombstone requires only dispatch")
		}
		raw, _ := json.Marshal(r.Dispatch)
		if err := wire.Validate("Dispatch", raw); err != nil {
			return err
		}
		if r.Dispatch.AttemptID != r.AttemptID || r.Dispatch.RuntimeID != protocol.Opencode || string(r.Dispatch.Model) != FreeModel {
			return fmt.Errorf("dispatch mismatch")
		}
		if (r.Action == "start") != r.Dispatch.MutationAllowed {
			return fmt.Errorf("dispatch authority does not match action")
		}
	case "status", "stop":
		if r.Dispatch != nil || r.Operation != nil {
			return fmt.Errorf("unexpected fields")
		}
	case "effect":
		if r.Operation == nil || r.Dispatch != nil {
			return fmt.Errorf("effect requires operation")
		}
		raw, _ := json.Marshal(r.Operation)
		if err := wire.Validate("Operation", raw); err != nil {
			return err
		}
		if r.Operation.AttemptID != r.AttemptID {
			return fmt.Errorf("operation mismatch")
		}
	default:
		return fmt.Errorf("unsupported helper action")
	}
	return nil
}
func DecodeRequest(r io.Reader) (Request, error) {
	var req Request
	raw, err := io.ReadAll(io.LimitReader(r, wire.Limit+1))
	if err != nil {
		return req, err
	}
	if len(raw) > wire.Limit {
		return req, fmt.Errorf("helper input exceeds limit")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err = d.Decode(&req); err != nil {
		return req, err
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return req, fmt.Errorf("trailing input")
	}
	return req, ValidateRequest(req)
}

// trustedDir walks every component. Root never follows an execution-owned link.
func trustedDir(path string, owner uint32) error {
	if !filepath.IsAbs(path) {
		return fmt.Errorf("absolute directory required")
	}
	path = filepath.Clean(path)
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	current := "/"
	for i, part := range parts {
		current = filepath.Join(current, part)
		s, err := os.Lstat(current)
		if err != nil {
			return err
		}
		if !s.IsDir() || s.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("unsafe directory: %s", current)
		}
		stat, ok := s.Sys().(*syscall.Stat_t)
		if !ok {
			return fmt.Errorf("missing ownership")
		}
		expected := uint32(0)
		if i == len(parts)-1 {
			expected = owner
		}
		if stat.Uid != expected || s.Mode().Perm()&0022 != 0 {
			return fmt.Errorf("unsafe directory ownership/mode: %s", current)
		}
	}
	return nil
}
func trustedFile(path string, owner uint32) error {
	s, err := os.Lstat(path)
	if err != nil {
		return err
	}
	stat, ok := s.Sys().(*syscall.Stat_t)
	if !ok || !s.Mode().IsRegular() || stat.Uid != owner || s.Mode().Perm()&0022 != 0 {
		return fmt.Errorf("unsafe file ownership/mode: %s", path)
	}
	return nil
}
func readManifest(id string) (Manifest, error) {
	var m Manifest
	if !ValidID(id) {
		return m, fmt.Errorf("invalid id")
	}
	if err := trustedFile(manifestPath(id), 0); err != nil {
		return m, err
	}
	raw, err := os.ReadFile(manifestPath(id))
	if err != nil {
		return m, err
	}
	err = json.Unmarshal(raw, &m)
	if err == nil && (m.Dispatch.AttemptID != id || m.BootID == "") {
		err = fmt.Errorf("invalid retained manifest")
	}
	return m, err
}
func saveManifest(m Manifest) error {
	return saveRecord(manifestPath(m.Dispatch.AttemptID), m)
}
func saveRecord(p string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(p), ".record-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if err = f.Chmod(0644); err != nil {
		f.Close()
		return err
	}
	if _, err = f.Write(raw); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = os.Rename(tmp, p); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(p))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

// mkdir's requested mode is filtered by the invoking service's umask. Apply
// the fixed traversal mode explicitly only to a newly-created owned directory;
// an existing directory must already match, never silently take it over.
func createTraversalRoot(path string, uid, gid int) error {
	err := os.Mkdir(path, 0755)
	if err == nil {
		if err = os.Chown(path, uid, gid); err != nil {
			return err
		}
		if err = os.Chmod(path, 0755); err != nil {
			return err
		}
	} else if !os.IsExist(err) {
		return err
	}
	s, err := os.Lstat(path)
	if err != nil {
		return err
	}
	stat, ok := s.Sys().(*syscall.Stat_t)
	if !ok || !s.IsDir() || s.Mode().Perm() != 0755 || stat.Uid != uint32(uid) || stat.Gid != uint32(gid) {
		return fmt.Errorf("unsafe or non-traversable Attempt root")
	}
	return nil
}
func executionDirectories(d protocol.Dispatch) []string {
	if d.TodoID != nil {
		return []string{"scratch", "data", "cache", "state", "tmp", "config"}
	}
	return []string{"scratch", "workspace", "common", "data", "cache", "state", "tmp", "config"}
}

func prepare(d protocol.Dispatch) error {
	account, err := user.Lookup("me")
	if err != nil {
		return err
	}
	uid, err := strconv.Atoi(account.Uid)
	if err != nil || uid == 0 {
		return fmt.Errorf("invalid execution uid")
	}
	group, err := user.LookupGroup("monos-probe-read")
	if err != nil {
		return err
	}
	gid, err := strconv.Atoi(group.Gid)
	if err != nil {
		return err
	}
	base := AttemptRoot(d.AttemptID)
	if err = createTraversalRoot(base, 0, 0); err != nil {
		return err
	}
	if err = trustedDir(base, 0); err != nil {
		return err
	}
	for _, name := range executionDirectories(d) {
		p := Path(d.AttemptID, name)
		err = os.Mkdir(p, 0750)
		if err == nil {
			if err = os.Chown(p, uid, gid); err != nil {
				return err
			}
			if err = os.Chmod(p, os.ModeSetgid|0750); err != nil {
				return err
			}
		} else if !os.IsExist(err) {
			return err
		}
		if err = trustedDir(p, uint32(uid)); err != nil {
			return err
		}
		s, err := os.Lstat(p)
		if err != nil {
			return err
		}
		if s.Sys().(*syscall.Stat_t).Gid != uint32(gid) || s.Mode()&os.ModeSetgid == 0 || s.Mode().Perm()&0050 != 0050 {
			return fmt.Errorf("execution directory lacks inherited service read access")
		}
	}
	// Reserve one existing block for a capture failure marker before launch.
	// Overwriting it remains possible when the output filesystem is full.
	marker := Path(d.AttemptID, "scratch") + "/capture.failure"
	if _, err = os.Lstat(marker); os.IsNotExist(err) {
		f, e := os.OpenFile(marker, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0640)
		if e != nil {
			return e
		}
		if e = f.Chown(uid, gid); e == nil {
			_, e = f.Write([]byte{'0'})
		}
		if e == nil {
			e = f.Sync()
		}
		closeErr := f.Close()
		if e != nil {
			return e
		}
		if closeErr != nil {
			return closeErr
		}
	} else if err != nil {
		return err
	}
	if err = trustedFile(marker, uint32(uid)); err != nil {
		return err
	}
	for _, stream := range []string{"stdout", "stderr"} {
		p := filepath.Join(Root, "logs", d.AttemptID+"."+stream)
		f, e := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0640)
		if e == nil {
			if e = f.Chown(0, gid); e != nil {
				f.Close()
				return e
			}
			if e = f.Close(); e != nil {
				return e
			}
		} else if !os.IsExist(e) {
			return e
		}
		if err = trustedFile(p, 0); err != nil {
			return err
		}
	}
	return nil
}
func command(ctx context.Context, path string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LANG=C.UTF-8"}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("%s failed: %s", filepath.Base(path), strings.TrimSpace(stderr.String()))
	}
	return out, nil
}
func properties(id string, systemOp bool) []string {
	// Fixed service ownership is independent of any caller-controlled runtime flags.
	p := []string{"User=me", "Group=monos-probe-read", "NoNewPrivileges=yes", "CapabilityBoundingSet=", "AmbientCapabilities=", "KillMode=control-group", "SendSIGKILL=yes", "Restart=no", "UMask=0027", "WorkingDirectory=" + Path(id, "scratch")}
	if !systemOp {
		p = append(p, "RemainAfterExit=yes")
	}
	return p
}
func status(ctx context.Context, id string) (Status, error) {
	m, err := readManifest(id)
	if os.IsNotExist(err) {
		return Status{}, nil
	}
	if err != nil {
		return Status{}, err
	}
	boot, err := BootID()
	if err != nil {
		return Status{}, err
	}
	s := Status{Known: true, BootID: boot}
	if m.Revoked {
		if m.Launched {
			return s, fmt.Errorf("invalid revoked launch record")
		}
		return s, confirmNeverLaunched(ctx, id)
	}
	if err = checkOperationWriters(ctx, id, boot); err != nil {
		return s, err
	}
	if m.BootID != boot {
		return s, nil
	}
	values, err := unitProperties(ctx, Unit(id))
	if err != nil {
		return s, err
	}
	if values["LoadState"] == "not-found" {
		if !m.Acknowledged {
			return s, fmt.Errorf("launch submission unresolved")
		}
		return s, nil
	}
	if err = validateUnit(values, Unit(id), "monos probe attempt "+m.Dispatch.DispatchID); err != nil {
		return s, err
	}
	if !m.Acknowledged {
		m.Acknowledged = true
		if err = saveManifest(m); err != nil {
			return s, err
		}
	}
	s.Exists = true
	s.Cgroup = values["ControlGroup"]
	if s.Cgroup != "" {
		s.Populated, err = Population(s.Cgroup)
		if err != nil {
			return s, err
		}
	} else if values["ActiveState"] != "inactive" && values["ActiveState"] != "failed" {
		return s, fmt.Errorf("unit has unresolved cgroup")
	}
	s.PID, _ = strconv.Atoi(values["MainPID"])
	if s.PID > 0 {
		p, e := Identity(s.PID)
		if e != nil {
			return s, e
		}
		s.Birth = p.Birth
		if p.Cgroup != s.Cgroup {
			return s, fmt.Errorf("main process escaped owned cgroup")
		}
	}
	s.MainExited, s.ExitCode = mainExit(values)
	s.CaptureFailed = captureFailedExit(values)
	return s, nil
}

// ExecMainCode is systemd's retained wait result for this single-use unit.
// A zero MainPID distinguishes a finished worker from a still-running one;
// descendants may continue to populate its cgroup after that point.
func mainExit(values map[string]string) (bool, *int64) {
	if values["MainPID"] != "0" {
		return false, nil
	}
	switch values["ExecMainCode"] {
	case "1": // CLD_EXITED
		code, err := strconv.ParseInt(values["ExecMainStatus"], 10, 64)
		if err != nil || code < 0 || code > 255 {
			return false, nil
		}
		return true, &code
	case "2", "3": // CLD_KILLED, CLD_DUMPED
		return true, nil
	default:
		return false, nil
	}
}

// systemd owns this exit fact, unlike the execution-account marker. Only a
// retained, validated Attempt unit with a completed worker exit can assert it.
func captureFailedExit(values map[string]string) bool {
	exited, code := mainExit(values)
	return exited && code != nil && *code == CaptureFailureExitCode && values["Result"] == "exit-code"
}
func stop(ctx context.Context, id string) (Status, error) {
	return stopWith(ctx, id, status, command)
}

func stopWith(ctx context.Context, id string, inspect func(context.Context, string) (Status, error), run func(context.Context, string, ...string) ([]byte, error)) (Status, error) {
	s, err := inspect(ctx, id)
	if err != nil {
		return s, err
	}
	if !s.Known {
		return s, fmt.Errorf("stop ownership unresolved")
	}
	if !s.Populated {
		return s, nil
	}
	// Freeze establishes a writer barrier; stopping the unit thaws/kills as required.
	if _, err = run(ctx, "/usr/bin/systemctl", "freeze", Unit(id)); err != nil {
		return awaitWriterAbsence(ctx, id, inspect, err)
	}
	if _, err = run(ctx, "/usr/bin/systemctl", "kill", "--kill-whom=all", "--signal=KILL", Unit(id)); err != nil {
		return awaitWriterAbsence(ctx, id, inspect, err)
	}
	_, thawErr := run(ctx, "/usr/bin/systemctl", "thaw", Unit(id))
	_, stopErr := run(ctx, "/usr/bin/systemctl", "stop", Unit(id))
	return awaitWriterAbsence(ctx, id, inspect, errors.Join(thawErr, stopErr))
}

func awaitWriterAbsence(ctx context.Context, id string, inspect func(context.Context, string) (Status, error), controlErr error) (Status, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	var s Status
	var inspectErr error
	for {
		if err := ctx.Err(); err != nil {
			return s, errors.Join(fmt.Errorf("writer absence unresolved"), controlErr, inspectErr, err)
		}
		s, inspectErr = inspect(ctx, id)
		// systemd can reject thaw/stop while SIGKILL is settling a frozen unit.
		// Only a fresh, fully validated status may supersede that command error.
		// Missing manifests and transient PID/cgroup reads are not absence.
		if inspectErr == nil && ctx.Err() == nil {
			if !s.Known {
				inspectErr = fmt.Errorf("stop ownership unresolved")
			} else if !s.Populated {
				return s, nil
			}
		}
		select {
		case <-ctx.Done():
		case <-time.After(20 * time.Millisecond):
		}
	}
}
func Handle(ctx context.Context, r Request) (Status, error) {
	if os.Geteuid() != 0 {
		return Status{}, fmt.Errorf("helper requires root")
	}
	if err := ValidateRequest(r); err != nil {
		return Status{}, err
	}
	for _, p := range []string{Root, filepath.Join(Root, "launch"), filepath.Join(Root, "execution"), filepath.Join(Root, "logs"), "/usr/local/libexec", "/usr/local/bin"} {
		if err := trustedDir(p, 0); err != nil {
			return Status{}, err
		}
	}
	for _, p := range []string{Helper, Worker, CLI} {
		if err := trustedFile(p, 0); err != nil {
			return Status{}, err
		}
	}
	if r.Action == "discover" {
		return discover(ctx)
	}
	lock, err := os.OpenFile(filepath.Join(Root, "launch", "helper.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return Status{}, err
	}
	defer lock.Close()
	if err = trustedFile(lock.Name(), 0); err != nil {
		return Status{}, err
	}
	for {
		err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			break
		}
		if err != syscall.EWOULDBLOCK && err != syscall.EAGAIN {
			return Status{}, err
		}
		select {
		case <-ctx.Done():
			return Status{}, ctx.Err()
		case <-time.After(20 * time.Millisecond):
		}
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	switch r.Action {
	case "status":
		return status(ctx, r.AttemptID)
	case "stop":
		return stop(ctx, r.AttemptID)
	case "tombstone":
		old, e := readManifest(r.AttemptID)
		var existing *Manifest
		if e == nil {
			existing = &old
		} else if !os.IsNotExist(e) {
			return Status{}, e
		}
		boot, e := BootID()
		if e != nil {
			return Status{}, e
		}
		m, e := revokedManifest(existing, *r.Dispatch, boot)
		if e != nil {
			return Status{}, e
		}
		if e = confirmNeverLaunched(ctx, r.AttemptID); e != nil {
			return Status{}, e
		}
		if e = saveManifest(m); e != nil {
			return Status{}, e
		}
		return Status{Known: true, BootID: boot}, nil
	case "start":
		m, e := readManifest(r.AttemptID)
		if e == nil {
			if e = validateRepeatedStart(m, *r.Dispatch); e != nil {
				return Status{}, e
			}
			if m.Launched {
				return status(ctx, r.AttemptID)
			}
		} else if !os.IsNotExist(e) {
			return Status{}, e
		}
		if err = requireAbsentUnit(ctx, Unit(r.AttemptID)); err != nil {
			return Status{}, err
		}
		if err = prepare(*r.Dispatch); err != nil {
			return Status{}, err
		}
		boot, e := BootID()
		if e != nil {
			return Status{}, e
		}
		m = Manifest{Dispatch: *r.Dispatch, BootID: boot, Launched: true}
		// This durable intent fences all future starts, including a lost systemd reply.
		if err = saveManifest(m); err != nil {
			return Status{}, err
		}
		args := []string{"--quiet", "--unit=" + Unit(r.AttemptID), "--service-type=exec", "--description=monos probe attempt " + r.Dispatch.DispatchID}
		for _, p := range properties(r.AttemptID, false) {
			args = append(args, "--property="+p)
		}
		args = append(args, "--property=StandardOutput=append:"+filepath.Join(Root, "logs", r.AttemptID+".stdout"), "--property=StandardError=append:"+filepath.Join(Root, "logs", r.AttemptID+".stderr"), Worker, "attempt", r.AttemptID)
		if _, err = command(ctx, "/usr/bin/systemd-run", args...); err != nil {
			return Status{}, err
		}
		m.Acknowledged = true
		if err = saveManifest(m); err != nil {
			return Status{}, err
		}
		return status(ctx, r.AttemptID)
	case "effect":
		m, e := readManifest(r.AttemptID)
		if e != nil {
			return Status{}, e
		}
		op := r.Operation
		if err := ValidateEffectScope(m.Dispatch, *op); err != nil {
			return Status{}, err
		}
		if m.BootID == "" {
			return Status{}, fmt.Errorf("missing boot ownership")
		}
		if op.Kind == protocol.Stop {
			return stop(ctx, r.AttemptID)
		}
		if m.Revoked || !m.Launched {
			return Status{}, fmt.Errorf("no launched Attempt owns this effect")
		}
		boot, e := BootID()
		if e != nil {
			return Status{}, e
		}
		if e = checkOperationWriters(ctx, r.AttemptID, boot); e != nil {
			return Status{}, e
		}
		if op.Kind == protocol.KindCompleteNode {
			if _, err = stop(ctx, r.AttemptID); err != nil {
				return Status{}, err
			}
		}
		return runEffect(ctx, *op)
	}
	return Status{}, errors.New("unreachable action")
}

func validateRepeatedStart(m Manifest, dispatch protocol.Dispatch) error {
	if m.Revoked {
		return fmt.Errorf("dispatch permanently revoked")
	}
	if !reflect.DeepEqual(m.Dispatch, dispatch) {
		return fmt.Errorf("attempt dispatch conflict")
	}
	return nil
}

func revokedManifest(existing *Manifest, dispatch protocol.Dispatch, boot string) (Manifest, error) {
	if dispatch.MutationAllowed || boot == "" {
		return Manifest{}, fmt.Errorf("explicit revoked authority required")
	}
	if existing != nil {
		if !existing.Revoked || existing.Launched {
			return Manifest{}, fmt.Errorf("existing launch requires status/stop reconciliation")
		}
		if !reflect.DeepEqual(existing.Dispatch, dispatch) {
			return Manifest{}, fmt.Errorf("revocation identity conflict")
		}
		return *existing, nil
	}
	return Manifest{Dispatch: dispatch, BootID: boot, Acknowledged: true, Revoked: true}, nil
}
