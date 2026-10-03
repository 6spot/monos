package host

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"unicode/utf8"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

const ResultTextLimit = 64 * 1024
const ResultResponseLimit = 512 * 1024
const resultScanLimit = 8 * 1024 * 1024

var errReadOverflow = errors.New("result read output limit")

type boundedOutput struct {
	buffer bytes.Buffer
	limit  int
	cancel context.CancelFunc
}

func (b *boundedOutput) Write(p []byte) (int, error) {
	if len(p) > b.limit-b.buffer.Len() {
		b.cancel()
		return 0, errReadOverflow
	}
	return b.buffer.Write(p)
}

// No worktree, user environment, lazy fetch, external diff or config side effects.
func resultGit(ctx context.Context, dir string, limit int, args ...string) ([]byte, error) {
	parentCtx := ctx
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	out := &boundedOutput{limit: limit, cancel: cancel}
	stderr := &boundedOutput{limit: 4096, cancel: cancel}
	fixed := []string{"--no-replace-objects", "--git-dir=" + dir, "-c", "safe.directory=" + dir, "-c", "core.hooksPath=/dev/null", "-c", "core.quotePath=true", "-c", "diff.external=", "-c", "core.attributesFile=/dev/null"}
	cmd := exec.CommandContext(ctx, "/usr/bin/git", append(fixed, args...)...)
	cmd.Env = []string{"PATH=/usr/bin:/bin", "HOME=/nonexistent", "LANG=C.UTF-8", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_TERMINAL_PROMPT=0", "GIT_NO_LAZY_FETCH=1", "GIT_LITERAL_PATHSPECS=1", "GIT_OPTIONAL_LOCKS=0"}
	cmd.Stdout = out
	cmd.Stderr = stderr
	if err := cmd.Run(); err != nil {
		if parentCtx.Err() != nil {
			return nil, parentCtx.Err()
		}
		if ctx.Err() != nil {
			return nil, errReadOverflow
		}
		return nil, fmt.Errorf("immutable Git object unavailable")
	}
	return out.buffer.Bytes(), nil
}
func validResultPath(p string) bool {
	if p == "" || !utf8.ValidString(p) || len(p) > 4096 || strings.ContainsAny(p, "\x00\\") || strings.HasPrefix(p, "/") || len(p) >= 2 && p[1] == ':' && (p[0] >= 'A' && p[0] <= 'Z' || p[0] >= 'a' && p[0] <= 'z') {
		return false
	}
	for _, s := range strings.Split(p, "/") {
		if s == "" || s == "." || s == ".." {
			return false
		}
	}
	return true
}
func resultOutcome(r protocol.ResultReadRequest, status string) protocol.ResultReadResponse {
	return protocol.ResultReadResponse{SchemaVersion: 1, Request: r, Status: protocol.ResultReadResponseStatus(status)}
}

// ResultRead checks initialized disk lineage without creating or repairing it.
func ResultRead(ctx context.Context, r protocol.ResultReadRequest) protocol.ResultReadResponse {
	uid := uint32(os.Geteuid())
	if uid == 0 {
		return resultOutcome(r, "unavailable")
	}
	rootCopy, serviceCopy := filepath.Join(Root, "launch", "storage-id"), filepath.Join(Root, "service", "storage-id")
	if trustedDir(filepath.Dir(rootCopy), 0) != nil || resultParents(filepath.Dir(serviceCopy), uid) != nil {
		return resultOutcome(r, "unavailable")
	}
	if s, e := os.Lstat(serviceCopy); e != nil || s.Mode().Perm()&0077 != 0 {
		return resultOutcome(r, "unavailable")
	}
	storage, err := readStorageIdentity(rootCopy, serviceCopy, 0, uid)
	if err != nil || storage != r.Identity.StorageID {
		return resultOutcome(r, "identity_mismatch")
	}
	dir := filepath.Join(Root, "results", r.Identity.OperationID)
	if !ValidID(r.Identity.OperationID) || resultParents(dir, uid) != nil || serviceDirectory(filepath.Dir(dir), true) != nil || serviceDirectory(dir, true) != nil {
		return resultOutcome(r, "unavailable")
	}
	// An export must own its objects; no borrowed object store or indirection.
	for _, p := range []string{"HEAD", "config"} {
		if trustedFile(filepath.Join(dir, p), uid) != nil {
			return resultOutcome(r, "unavailable")
		}
	}
	for _, p := range []string{"objects", "refs"} {
		if resultParents(filepath.Join(dir, p), uid) != nil || serviceDirectory(filepath.Join(dir, p), false) != nil {
			return resultOutcome(r, "unavailable")
		}
	}
	for _, p := range []string{"refs/monos", "objects/info", "objects/pack"} {
		target := filepath.Join(dir, p)
		if _, e := os.Lstat(target); e == nil {
			if resultParents(target, uid) != nil || serviceDirectory(target, false) != nil {
				return resultOutcome(r, "unavailable")
			}
		} else if !os.IsNotExist(e) {
			return resultOutcome(r, "unavailable")
		}
	}
	for _, p := range []string{"refs/monos/result", "packed-refs"} {
		target := filepath.Join(dir, p)
		if _, e := os.Lstat(target); e == nil {
			if trustedFile(target, uid) != nil {
				return resultOutcome(r, "unavailable")
			}
		} else if !os.IsNotExist(e) {
			return resultOutcome(r, "unavailable")
		}
	}
	if _, err := os.Lstat(filepath.Join(dir, "objects", "info", "alternates")); !os.IsNotExist(err) {
		return resultOutcome(r, "unavailable")
	}
	return readResultObjects(ctx, dir, r)
}
func resultParents(path string, uid uint32) error {
	path = filepath.Clean(path)
	if !filepath.IsAbs(path) {
		return fmt.Errorf("absolute lineage required")
	}
	current := "/"
	for _, part := range strings.Split(strings.TrimPrefix(path, "/"), "/") {
		current = filepath.Join(current, part)
		s, e := os.Lstat(current)
		if e != nil {
			return e
		}
		st, ok := s.Sys().(*syscall.Stat_t)
		if !ok || !s.IsDir() || s.Mode()&os.ModeSymlink != 0 || s.Mode().Perm()&0022 != 0 || st.Uid != 0 && st.Uid != uid {
			return fmt.Errorf("unsafe result lineage")
		}
	}
	return nil
}
func readResultObjects(ctx context.Context, dir string, r protocol.ResultReadRequest) protocol.ResultReadResponse {
	if ctx.Err() != nil {
		return resultOutcome(r, "timeout")
	}
	outcome := resultOutcome(r, "unavailable")
	raw, e := json.Marshal(r)
	if e != nil || wire.Validate("ResultReadRequest", raw) != nil {
		return outcome
	}
	_, digest, e := wire.Canonical(r.Identity)
	if e != nil || digest != r.IdentityDigest {
		return resultOutcome(r, "identity_mismatch")
	}
	i := r.Identity
	for expression, want := range map[string]string{"refs/monos/result": i.GitCommit, i.GitCommit + "^{tree}": i.GitTree, i.BaseCommit + "^{commit}": i.BaseCommit} {
		raw, e := resultGit(ctx, dir, 256, "rev-parse", "--verify", expression)
		if e != nil || strings.TrimSpace(string(raw)) != want {
			if ctx.Err() != nil {
				return resultOutcome(r, "timeout")
			}
			return resultOutcome(r, "identity_mismatch")
		}
	}
	switch r.Mode {
	case protocol.Changes:
		outcome = readResultChanges(ctx, dir, r)
	case protocol.File:
		outcome = readResultFile(ctx, dir, r)
	case protocol.Diff:
		outcome = readResultDiff(ctx, dir, r)
	}
	if ctx.Err() != nil {
		return resultOutcome(r, "timeout")
	}
	raw, e = json.Marshal(outcome)
	if e != nil || len(raw) > ResultResponseLimit || wire.Validate("ResultReadResponse", raw) != nil {
		return resultOutcome(r, "oversized")
	}
	return outcome
}

type resultCursor struct {
	Version  int    `json:"version"`
	Identity string `json:"identity"`
	After    int    `json:"after"`
}

func encodeResultCursor(identity string, after int) string {
	raw, _, _ := wire.Canonical(resultCursor{1, identity, after})
	return base64.RawURLEncoding.EncodeToString(raw)
}
func readResultChanges(ctx context.Context, dir string, r protocol.ResultReadRequest) protocol.ResultReadResponse {
	after := 0
	if r.Cursor != nil {
		raw, e := base64.RawURLEncoding.DecodeString(*r.Cursor)
		var c resultCursor
		if e != nil || json.Unmarshal(raw, &c) != nil || c.Version != 1 || c.After < 0 || encodeResultCursor(c.Identity, c.After) != *r.Cursor || c.Identity != r.IdentityDigest {
			return resultOutcome(r, "identity_mismatch")
		}
		after = c.After
	}
	raw, e := resultGit(ctx, dir, resultScanLimit, "diff-tree", "--no-commit-id", "--raw", "-r", "-z", "--no-renames", r.Identity.BaseCommit, r.Identity.GitCommit)
	if e != nil {
		if errors.Is(e, errReadOverflow) {
			return resultOutcome(r, "scan_limit")
		}
		return resultOutcome(r, "unavailable")
	}
	fields := bytes.Split(raw, []byte{0})
	changes := []protocol.ResultChange{}
	for at := 0; at < len(fields)-1; at += 2 {
		if at+1 >= len(fields) {
			return resultOutcome(r, "unavailable")
		}
		h := strings.Fields(string(fields[at]))
		p := string(fields[at+1])
		if len(h) != 5 || !strings.HasPrefix(h[0], ":") {
			return resultOutcome(r, "unavailable")
		}
		if !validResultPath(p) {
			return resultOutcome(r, "unsupported_path")
		}
		item := protocol.ResultChange{Path: p, Status: protocol.ResultChangeStatus(h[4])}
		if h[0] != ":000000" {
			item.Old = &protocol.ResultObject{Mode: protocol.ResultObjectMode(h[0][1:]), OID: h[2]}
		}
		if h[1] != "000000" {
			item.New = &protocol.ResultObject{Mode: protocol.ResultObjectMode(h[1]), OID: h[3]}
		}
		changes = append(changes, item)
		if len(changes) > 8192 {
			return resultOutcome(r, "scan_limit")
		}
	}
	sort.Slice(changes, func(a, b int) bool { return changes[a].Path < changes[b].Path })
	if after > len(changes) {
		return resultOutcome(r, "identity_mismatch")
	}
	out := resultOutcome(r, "available")
	out.Changes = []protocol.ResultChange{}
	total := int64(len(changes))
	out.TotalChanges = &total
	end := after
	for ; end < len(changes) && end < after+64; end++ {
		item := changes[end]
		for _, o := range []*protocol.ResultObject{item.Old, item.New} {
			if o != nil && string(o.Mode) != "160000" {
				n, e := resultObjectSize(ctx, dir, o.OID)
				if e != nil {
					return resultOutcome(r, "unavailable")
				}
				o.Size = &n
			}
		}
		candidate := append(out.Changes, item)
		out.Changes = candidate
		out.NextCursor = nil
		if end+1 < len(changes) {
			c := encodeResultCursor(r.IdentityDigest, end+1)
			out.NextCursor = &c
		}
		b, _ := json.Marshal(out)
		if len(b) > ResultResponseLimit {
			out.Changes = out.Changes[:len(out.Changes)-1]
			break
		}
	}
	if end < len(changes) {
		c := encodeResultCursor(r.IdentityDigest, end)
		out.NextCursor = &c
	} else {
		out.NextCursor = nil
	}
	return out
}
func resultObjectSize(ctx context.Context, dir, oid string) (int64, error) {
	raw, e := resultGit(ctx, dir, 128, "cat-file", "-s", oid)
	if e != nil {
		return 0, e
	}
	return strconv.ParseInt(strings.TrimSpace(string(raw)), 10, 64)
}
func resultTreeObject(ctx context.Context, dir, commit, path string) (*protocol.ResultObject, error) {
	raw, e := resultGit(ctx, dir, 8192, "ls-tree", "-z", commit, "--", path)
	if e != nil {
		return nil, e
	}
	if len(raw) == 0 {
		return nil, nil
	}
	entry := bytes.TrimSuffix(raw, []byte{0})
	head, name, ok := bytes.Cut(entry, []byte{'\t'})
	h := strings.Fields(string(head))
	if !ok || len(h) != 3 || string(name) != path {
		return nil, fmt.Errorf("path is not one exact object")
	}
	o := &protocol.ResultObject{Mode: protocol.ResultObjectMode(h[0]), OID: h[2]}
	if h[1] == "blob" {
		n, e := resultObjectSize(ctx, dir, o.OID)
		if e != nil {
			return nil, e
		}
		o.Size = &n
	} else if h[1] != "commit" {
		return nil, fmt.Errorf("not a file")
	}
	return o, nil
}
func readResultFile(ctx context.Context, dir string, r protocol.ResultReadRequest) protocol.ResultReadResponse {
	commit := r.Identity.GitCommit
	if *r.Side == protocol.Base {
		commit = r.Identity.BaseCommit
	}
	o, e := resultTreeObject(ctx, dir, commit, *r.Path)
	if e != nil {
		return resultOutcome(r, "unavailable")
	}
	if o == nil {
		return resultOutcome(r, "absent")
	}
	out := resultOutcome(r, "available")
	out.Object = o
	if string(o.Mode) == "160000" {
		return out
	}
	if o.Size == nil {
		return resultOutcome(r, "unavailable")
	}
	if *o.Size > ResultTextLimit {
		out.Status = "oversized"
		return out
	}
	raw, e := resultGit(ctx, dir, ResultTextLimit, "cat-file", "blob", o.OID)
	if e != nil {
		return resultOutcome(r, "unavailable")
	}
	if int64(len(raw)) != *o.Size {
		return resultOutcome(r, "identity_mismatch")
	}
	if !utf8.Valid(raw) || bytes.IndexByte(raw, 0) >= 0 {
		out.Status = "binary"
		return out
	}
	text := string(raw)
	out.Text = &text
	return out
}
func readResultDiff(ctx context.Context, dir string, r protocol.ResultReadRequest) protocol.ResultReadResponse {
	for _, side := range []protocol.Side{protocol.Base, protocol.Result} {
		q := r
		q.Mode = protocol.File
		q.Side = &side
		out := readResultFile(ctx, dir, q)
		if out.Status == "binary" || out.Status == "oversized" || out.Status == "unavailable" {
			return resultOutcome(r, string(out.Status))
		}
	}
	raw, e := resultGit(ctx, dir, ResultTextLimit, "diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--no-color", "--no-relative", "--src-prefix=a/", "--dst-prefix=b/", "--unified=3", r.Identity.BaseCommit, r.Identity.GitCommit, "--", *r.Path)
	if e != nil {
		if errors.Is(e, errReadOverflow) {
			return resultOutcome(r, "oversized")
		}
		return resultOutcome(r, "unavailable")
	}
	if !utf8.Valid(raw) || bytes.IndexByte(raw, 0) >= 0 {
		return resultOutcome(r, "binary")
	}
	out := resultOutcome(r, "available")
	text := string(raw)
	out.Text = &text
	return out
}
