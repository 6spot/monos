package host

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

type resultGitFixture struct {
	work, export, base string
	request            protocol.ResultReadRequest
}

func resultTestGit(t *testing.T, dir string, input []byte, args ...string) string {
	t.Helper()
	cmd := exec.Command("/usr/bin/git", args...)
	cmd.Dir = dir
	cmd.Env = []string{"PATH=/usr/bin:/bin", "HOME=/nonexistent", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_AUTHOR_NAME=Result test", "GIT_AUTHOR_EMAIL=result@monos.invalid", "GIT_COMMITTER_NAME=Result test", "GIT_COMMITTER_EMAIL=result@monos.invalid"}
	if input != nil {
		cmd.Stdin = strings.NewReader(string(input))
	}
	b, e := cmd.CombinedOutput()
	if e != nil {
		t.Fatalf("Git %v: %s: %v", args, b, e)
	}
	return strings.TrimSpace(string(b))
}
func resultTestWrite(t *testing.T, dir, path string, content []byte) {
	t.Helper()
	p := filepath.Join(dir, path)
	if e := os.MkdirAll(filepath.Dir(p), 0700); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(p, content, 0600); e != nil {
		t.Fatal(e)
	}
}
func resultTestNew(t *testing.T) *resultGitFixture {
	t.Helper()
	root := t.TempDir()
	f := &resultGitFixture{work: filepath.Join(root, "work"), export: filepath.Join(root, "export.git")}
	if e := os.Mkdir(f.work, 0700); e != nil {
		t.Fatal(e)
	}
	resultTestGit(t, f.work, nil, "init", "--quiet")
	resultTestWrite(t, f.work, "tracked.txt", []byte("base text\n"))
	resultTestWrite(t, f.work, "deleted.txt", []byte("deletion base\n"))
	resultTestGit(t, f.work, nil, "add", ".")
	resultTestGit(t, f.work, nil, "commit", "--quiet", "-m", "fixed base")
	f.base = resultTestGit(t, f.work, nil, "rev-parse", "HEAD")
	return f
}
func (f *resultGitFixture) finish(t *testing.T) {
	t.Helper()
	resultTestGit(t, f.work, nil, "add", ".")
	f.exportIndex(t)
}
func (f *resultGitFixture) exportIndex(t *testing.T) {
	t.Helper()
	resultTestGit(t, f.work, nil, "commit", "--quiet", "--allow-empty", "-m", "result")
	resultTestGit(t, f.work, nil, "clone", "--bare", "--no-local", f.work, f.export)
	commit := resultTestGit(t, f.work, nil, "rev-parse", "HEAD")
	tree := resultTestGit(t, f.work, nil, "rev-parse", "HEAD^{tree}")
	resultTestGit(t, f.export, nil, "update-ref", "refs/monos/result", commit)
	f.request = protocol.ResultReadRequest{Mode: protocol.Changes, Identity: protocol.ResultReadIdentity{TaskID: "task", OperationID: "completion", AttemptID: "attempt", DispatchID: "dispatch", NodeID: "node", SpecificationID: "spec", PlanID: "plan", WorkspaceID: "workspace", ResourceID: "repo", RunnerID: "runner", StorageID: "storage", LeaseID: "lease", NodeActivation: 1, Generation: 1, RepositoryIdentity: "github.com/example/repo", ManifestDigest: strings.Repeat("a", 64), OperationIdentityDigest: strings.Repeat("b", 64), BaseCommit: f.base, GitCommit: commit, GitTree: tree, Capture: protocol.WorkspaceCaptureResult{StartCommit: f.base, NodeCommit: commit, NodeTree: tree}}}
	f.request.IdentityDigest = resultTestDigest(t, f.request.Identity)
}
func resultTestDigest(t *testing.T, i protocol.ResultReadIdentity) string {
	t.Helper()
	_, d, e := wire.Canonical(i)
	if e != nil {
		t.Fatal(e)
	}
	return d
}
func (f *resultGitFixture) read(t *testing.T, mode protocol.ResultReadRequestMode, path string, side protocol.Side) protocol.ResultReadResponse {
	t.Helper()
	r := f.request
	r.Mode = mode
	if mode != protocol.Changes {
		r.Path = &path
	}
	if mode == protocol.File {
		r.Side = &side
	}
	out := readResultObjects(context.Background(), f.export, r)
	raw, e := json.Marshal(out)
	if e != nil || wire.Validate("ResultReadResponse", raw) != nil {
		t.Fatalf("invalid result response: %s, %v", raw, e)
	}
	return out
}
func TestResultReadImmutableExportFixedBaseAndPreservation(t *testing.T) {
	f := resultTestNew(t)
	resultTestWrite(t, f.work, "tracked.txt", []byte("intermediate text\n"))
	resultTestGit(t, f.work, nil, "add", ".")
	resultTestGit(t, f.work, nil, "commit", "--quiet", "-m", "private intermediate")
	wanted := "  final text\t \n\n"
	resultTestWrite(t, f.work, "tracked.txt", []byte(wanted))
	if e := os.Remove(filepath.Join(f.work, "deleted.txt")); e != nil {
		t.Fatal(e)
	}
	f.finish(t)
	before := resultTestGit(t, f.export, nil, "show-ref")
	resultTestWrite(t, f.work, "tracked.txt", []byte("mutable later worktree\n"))
	resultTestGit(t, f.work, nil, "add", ".")
	resultTestGit(t, f.work, nil, "commit", "--quiet", "-m", "later unrelated private work")
	out := f.read(t, protocol.File, "tracked.txt", protocol.Result)
	if out.Status != "available" || out.Text == nil || *out.Text != wanted {
		t.Fatalf("immutable text lost: %+v", out)
	}
	base := f.read(t, protocol.File, "tracked.txt", protocol.Base)
	if base.Text == nil || *base.Text != "base text\n" {
		t.Fatalf("fixed base substituted: %+v", base)
	}
	diff := f.read(t, protocol.Diff, "tracked.txt", "")
	if diff.Status != "available" || diff.Text == nil || !strings.Contains(*diff.Text, "-base text") || strings.Contains(*diff.Text, "intermediate text") || strings.Contains(*diff.Text, "mutable later") {
		t.Fatalf("wrong diff ancestry: %+v", diff)
	}
	deleted := f.read(t, protocol.File, "deleted.txt", protocol.Result)
	if deleted.Status != "absent" || deleted.Text != nil {
		t.Fatal("deleted file not absent", deleted)
	}
	old := f.read(t, protocol.File, "deleted.txt", protocol.Base)
	if old.Text == nil || *old.Text != "deletion base\n" {
		t.Fatal("deleted base unavailable", old)
	}
	if after := resultTestGit(t, f.export, nil, "show-ref"); after != before {
		t.Fatal("read changed export refs")
	}
	b, e := os.ReadFile(filepath.Join(f.work, "tracked.txt"))
	if e != nil || string(b) != "mutable later worktree\n" {
		t.Fatal("read changed worktree", e)
	}
}
func TestResultReadTextBinaryEmptySymlinkGitlinkAndLiteralPaths(t *testing.T) {
	f := resultTestNew(t)
	paths := []string{"empty", "unicodé/🙂.txt", "-option.txt", "colon:name", "space name", "tab\tname", "line\nname", "literal[*]?"}
	for _, p := range paths {
		b := []byte("你好🙂\n\t trailing  \n")
		if p == "empty" {
			b = []byte{}
		}
		resultTestWrite(t, f.work, p, b)
	}
	resultTestWrite(t, f.work, "nul", []byte{'a', 0, 'b'})
	resultTestWrite(t, f.work, "bad-utf8", []byte{0xff, 0xfe})
	resultTestWrite(t, f.work, "huge", []byte(strings.Repeat("x", ResultTextLimit+1)))
	resultTestWrite(t, f.work, "exact-limit", []byte(strings.Repeat("x", ResultTextLimit)))
	external := filepath.Join(t.TempDir(), "secret")
	resultTestWrite(t, filepath.Dir(external), "secret", []byte("PRIVATE TARGET CONTENT"))
	if e := os.Symlink(external, filepath.Join(f.work, "symlink")); e != nil {
		t.Fatal(e)
	}
	resultTestGit(t, f.work, nil, "add", ".")
	resultTestGit(t, f.work, nil, "update-index", "--add", "--cacheinfo", "160000,"+f.base+",submodule")
	f.exportIndex(t)
	for _, p := range paths {
		t.Run(p, func(t *testing.T) {
			out := f.read(t, protocol.File, p, protocol.Result)
			expected := "你好🙂\n\t trailing  \n"
			if p == "empty" {
				expected = ""
			}
			if out.Status != "available" || out.Text == nil || *out.Text != expected {
				t.Fatalf("literal path/text lost: %+v", out)
			}
		})
	}
	for _, p := range []string{"nul", "bad-utf8"} {
		out := f.read(t, protocol.File, p, protocol.Result)
		if out.Status != "binary" || out.Text != nil || out.Object == nil {
			t.Fatal("binary falsely decoded", out)
		}
	}
	out := f.read(t, protocol.File, "huge", protocol.Result)
	if out.Status != "oversized" || out.Text != nil || out.Object == nil || out.Object.Size == nil || *out.Object.Size != ResultTextLimit+1 {
		t.Fatal("oversized blob lost measurement", out)
	}
	out = f.read(t, protocol.File, "exact-limit", protocol.Result)
	if out.Status != "available" || out.Text == nil || len(*out.Text) != ResultTextLimit {
		t.Fatal("exact limit rejected", out)
	}
	out = f.read(t, protocol.File, "symlink", protocol.Result)
	if out.Status != "available" || out.Object == nil || out.Object.Mode != "120000" || out.Text == nil || *out.Text != external {
		t.Fatal("symlink followed or lost", out)
	}
	out = f.read(t, protocol.File, "submodule", protocol.Result)
	if out.Status != "available" || out.Object == nil || out.Object.Mode != "160000" || out.Object.OID != f.base || out.Text != nil || out.Object.Size != nil {
		t.Fatal("gitlink metadata incorrect", out)
	}
}
func TestResultReadChangePaginationAndIdentity(t *testing.T) {
	f := resultTestNew(t)
	for n := 0; n < 130; n++ {
		resultTestWrite(t, f.work, fmt.Sprintf("added/%03d", n), []byte("new\n"))
	}
	f.finish(t)
	r := f.request
	all := []protocol.ResultChange{}
	var cursors []string
	for {
		out := readResultObjects(context.Background(), f.export, r)
		if out.Status != "available" || len(out.Changes) > 64 || out.TotalChanges == nil || *out.TotalChanges != 130 {
			t.Fatalf("bad page: %+v", out)
		}
		replay := readResultObjects(context.Background(), f.export, r)
		if !reflect.DeepEqual(out, replay) {
			t.Fatal("same immutable page changed")
		}
		all = append(all, out.Changes...)
		if out.NextCursor == nil {
			break
		}
		cursors = append(cursors, *out.NextCursor)
		r.Cursor = out.NextCursor
		if len(cursors) > 3 {
			t.Fatal("cursor loop")
		}
	}
	if len(all) != 130 || len(cursors) != 2 {
		t.Fatal("incomplete pages", len(all), len(cursors))
	}
	for n, c := range all {
		if c.Path != fmt.Sprintf("added/%03d", n) || c.Status != "A" || c.Old != nil || c.New == nil || c.New.Size == nil || *c.New.Size != 4 {
			t.Fatal("wrong change", c)
		}
	}
	for _, c := range []string{"invalid", encodeResultCursor(strings.Repeat("f", 64), 64), encodeResultCursor(f.request.IdentityDigest, 131)} {
		r = f.request
		r.Cursor = &c
		if out := readResultObjects(context.Background(), f.export, r); out.Status != "identity_mismatch" {
			t.Fatal("wrong cursor accepted", out)
		}
	}
	r = f.request
	r.Identity.GitTree = strings.Repeat("f", 40)
	r.IdentityDigest = resultTestDigest(t, r.Identity)
	if out := readResultObjects(context.Background(), f.export, r); out.Status != "identity_mismatch" {
		t.Fatal("wrong tree accepted", out)
	}
	r = f.request
	r.Identity.BaseCommit = strings.Repeat("f", 40)
	r.IdentityDigest = resultTestDigest(t, r.Identity)
	if out := readResultObjects(context.Background(), f.export, r); out.Status != "identity_mismatch" {
		t.Fatal("missing base accepted", out)
	}
	r = f.request
	r.IdentityDigest = strings.Repeat("f", 64)
	if out := readResultObjects(context.Background(), f.export, r); out.Status != "identity_mismatch" {
		t.Fatal("wrong digest accepted", out)
	}
	resultTestGit(t, f.export, nil, "update-ref", "refs/monos/result", f.base)
	if out := readResultObjects(context.Background(), f.export, f.request); out.Status != "identity_mismatch" {
		t.Fatal("changed result ref accepted", out)
	}
}
func TestResultReadInvalidPathsAndUnsupportedGitNames(t *testing.T) {
	for _, p := range []string{"", "/absolute", "../x", "a/../b", "./x", "a//b", "a/", "a\\b", "C:drive", "a\x00b", string([]byte{0xff}), strings.Repeat("x", 4097)} {
		if validResultPath(p) {
			t.Errorf("accepted invalid path %q", p)
		}
	}
	f := resultTestNew(t)
	bad := string([]byte{'b', 'a', 'd', 0xff})
	blob := resultTestGit(t, f.work, []byte("content"), "hash-object", "-w", "--stdin")
	resultTestGit(t, f.work, []byte("100644 "+blob+"\t"+bad+"\x00"), "update-index", "-z", "--index-info")
	f.exportIndex(t)
	out := readResultObjects(context.Background(), f.export, f.request)
	if out.Status != "unsupported_path" || out.Changes != nil {
		t.Fatal("silently dropped invalid UTF-8 path", out)
	}
}
func TestResultReadScanRecordLimitAndRawOverflowCleanup(t *testing.T) {
	f := resultTestNew(t)
	blob := resultTestGit(t, f.work, []byte("x\n"), "hash-object", "-w", "--stdin")
	var input strings.Builder
	for n := 0; n < 8193; n++ {
		fmt.Fprintf(&input, "100644 %s\tbulk/%05d\n", blob, n)
	}
	resultTestGit(t, f.work, []byte(input.String()), "update-index", "--index-info")
	// Commit the index directly: these files need not be materialized for object reads.
	tree := resultTestGit(t, f.work, nil, "write-tree")
	commit := resultTestGit(t, f.work, []byte("scan budget\n"), "commit-tree", tree, "-p", f.base)
	resultTestGit(t, f.work, nil, "update-ref", "HEAD", commit)
	// finish stages the physical worktree, so export this indexed commit directly.
	resultTestGit(t, f.work, nil, "clone", "--bare", "--no-local", f.work, f.export)
	resultTestGit(t, f.export, nil, "update-ref", "refs/monos/result", commit)
	f.request = protocol.ResultReadRequest{Mode: protocol.Changes, Identity: protocol.ResultReadIdentity{TaskID: "task", OperationID: "completion", AttemptID: "attempt", DispatchID: "dispatch", NodeID: "node", SpecificationID: "spec", PlanID: "plan", WorkspaceID: "workspace", ResourceID: "repo", RunnerID: "runner", StorageID: "storage", LeaseID: "lease", NodeActivation: 1, Generation: 1, RepositoryIdentity: "repo", ManifestDigest: strings.Repeat("a", 64), OperationIdentityDigest: strings.Repeat("b", 64), BaseCommit: f.base, GitCommit: commit, GitTree: tree, Capture: protocol.WorkspaceCaptureResult{StartCommit: f.base, NodeCommit: commit, NodeTree: tree}}}
	f.request.IdentityDigest = resultTestDigest(t, f.request.Identity)
	if out := readResultObjects(context.Background(), f.export, f.request); out.Status != "scan_limit" || out.Changes != nil || out.TotalChanges != nil {
		t.Fatal("partial scan falsely complete", out)
	}
	start := time.Now()
	if _, e := resultGit(context.Background(), f.export, 16, "cat-file", "-p", commit); !errors.Is(e, errReadOverflow) {
		t.Fatal("raw overflow not classified", e)
	}
	if time.Since(start) > 5*time.Second {
		t.Fatal("overflow subprocess did not finish promptly")
	}
	if b, e := resultGit(context.Background(), f.export, 256, "rev-parse", "--verify", "refs/monos/result"); e != nil || strings.TrimSpace(string(b)) != commit {
		t.Fatal("overflow damaged following read", e)
	}
}
func TestResultReadCanceledContextIsTimeout(t *testing.T) {
	f := resultTestNew(t)
	f.finish(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	out := readResultObjects(ctx, f.export, f.request)
	if out.Status != "timeout" {
		t.Fatalf("canceled read must be timeout, got %s", out.Status)
	}
}

func resultTestIndexedPaths(t *testing.T, f *resultGitFixture, paths []string) {
	t.Helper()
	blob := resultTestGit(t, f.work, []byte("indexed content\n"), "hash-object", "-w", "--stdin")
	var input strings.Builder
	for _, p := range paths {
		fmt.Fprintf(&input, "100644 %s\t%s\x00", blob, p)
	}
	resultTestGit(t, f.work, []byte(input.String()), "update-index", "-z", "--index-info")
	f.exportIndex(t)
}
func TestResultReadChangeEncodedPageBoundAndRawScanBudget(t *testing.T) {
	t.Run("encoded pages", func(t *testing.T) {
		f := resultTestNew(t)
		paths := make([]string, 64)
		for n := range paths {
			paths[n] = fmt.Sprintf("long/%03d/", n) + strings.Repeat("\t", 4050)
		}
		resultTestIndexedPaths(t, f, paths)
		r := f.request
		seen := map[string]bool{}
		pages := 0
		for {
			out := readResultObjects(context.Background(), f.export, r)
			raw, e := json.Marshal(out)
			if e != nil || len(raw) > ResultResponseLimit || out.Status != "available" || out.TotalChanges == nil || *out.TotalChanges != 64 || len(out.Changes) == 0 {
				t.Fatalf("bad byte-bounded page status=%s len=%d: %v", out.Status, len(raw), e)
			}
			for _, c := range out.Changes {
				if seen[c.Path] {
					t.Fatal("duplicated page entry")
				}
				seen[c.Path] = true
			}
			pages++
			if out.NextCursor == nil {
				break
			}
			r.Cursor = out.NextCursor
			if pages > 3 {
				t.Fatal("byte cursor loop")
			}
		}
		if len(seen) != 64 || pages < 2 {
			t.Fatal("byte-bound paging lost changes or exceeded encoded limit", len(seen), pages)
		}
	})
	t.Run("raw scan", func(t *testing.T) {
		f := resultTestNew(t)
		paths := make([]string, 8192)
		for n := range paths {
			paths[n] = fmt.Sprintf("bulk/%05d/", n) + strings.Repeat(strings.Repeat("p", 200)+"/", 5) + "leaf"
		}
		resultTestIndexedPaths(t, f, paths)
		out := readResultObjects(context.Background(), f.export, f.request)
		if out.Status != "scan_limit" || out.Changes != nil || out.TotalChanges != nil || out.NextCursor != nil {
			t.Fatalf("raw scan limit presented partial collection: status=%s", out.Status)
		}
	})
}
func TestResultReadNoChangesModeTypeAndDeletedDiff(t *testing.T) {
	t.Run("empty changes", func(t *testing.T) {
		f := resultTestNew(t)
		f.finish(t)
		out := f.read(t, protocol.Changes, "", "")
		if out.Status != "available" || out.TotalChanges == nil || *out.TotalChanges != 0 || len(out.Changes) != 0 || out.NextCursor != nil {
			t.Fatal("no changes not explicit", out)
		}
		out = f.read(t, protocol.Diff, "tracked.txt", "")
		if out.Status != "available" || out.Text == nil || *out.Text != "" {
			t.Fatal("no-change diff not empty", out)
		}
	})
	t.Run("type mode and deletion", func(t *testing.T) {
		f := resultTestNew(t)
		if e := os.Remove(filepath.Join(f.work, "tracked.txt")); e != nil {
			t.Fatal(e)
		}
		if e := os.Symlink("literal target", filepath.Join(f.work, "tracked.txt")); e != nil {
			t.Fatal(e)
		}
		if e := os.Remove(filepath.Join(f.work, "deleted.txt")); e != nil {
			t.Fatal(e)
		}
		resultTestWrite(t, f.work, "executable", []byte("#!/bin/sh\n"))
		if e := os.Chmod(filepath.Join(f.work, "executable"), 0700); e != nil {
			t.Fatal(e)
		}
		f.finish(t)
		out := f.read(t, protocol.Changes, "", "")
		if out.Status != "available" || len(out.Changes) != 3 {
			t.Fatal("type/mode changes missing", out)
		}
		for _, c := range out.Changes {
			switch c.Path {
			case "tracked.txt":
				if c.Status != "T" || c.Old == nil || c.New == nil || c.Old.Mode != "100644" || c.New.Mode != "120000" {
					t.Fatal("wrong type change", c)
				}
			case "executable":
				if c.New == nil || c.New.Mode != "100755" {
					t.Fatal("executable mode lost", c)
				}
			case "deleted.txt":
				if c.Status != "D" || c.New != nil || c.Old == nil {
					t.Fatal("deletion shape wrong", c)
				}
			}
		}
		diff := f.read(t, protocol.Diff, "deleted.txt", "")
		if diff.Status != "available" || diff.Text == nil || !strings.Contains(*diff.Text, "-deletion base") || !strings.Contains(*diff.Text, "/dev/null") {
			t.Fatal("deleted diff unavailable", diff)
		}
	})
}
func TestResultReadDiffOverflowDoesNotReturnPartialPatch(t *testing.T) {
	f := resultTestNew(t)
	resultTestWrite(t, f.work, "tracked.txt", []byte(strings.Repeat("a\n", 16000)))
	resultTestGit(t, f.work, nil, "add", ".")
	resultTestGit(t, f.work, nil, "commit", "--quiet", "-m", "large fixed base")
	f.base = resultTestGit(t, f.work, nil, "rev-parse", "HEAD")
	resultTestWrite(t, f.work, "tracked.txt", []byte(strings.Repeat("b\n", 16000)))
	f.finish(t)
	out := f.read(t, protocol.Diff, "tracked.txt", "")
	if out.Status != "oversized" || out.Text != nil {
		t.Fatalf("overflow patch falsely complete: status=%s", out.Status)
	}
}
func TestResultReadDirectoryLineageRejectsSymlinkAndWritableParent(t *testing.T) {
	// Exercise the internal directory policy with the current UID; this is not a
	// production root/service dual-storage identity or installed Linux trial.
	root, e := filepath.EvalSymlinks(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	parent := filepath.Join(root, "trusted")
	leaf := filepath.Join(parent, "export")
	if e = os.MkdirAll(leaf, 0700); e != nil {
		t.Fatal(e)
	}
	uid := uint32(os.Geteuid())
	if e = resultParents(leaf, uid); e != nil {
		t.Fatalf("trusted lineage rejected: %v", e)
	}
	if e = os.Chmod(parent, 0770); e != nil {
		t.Fatal(e)
	}
	if e = resultParents(leaf, uid); e == nil {
		t.Fatal("group writable parent accepted")
	}
	if e = os.Chmod(parent, 0700); e != nil {
		t.Fatal(e)
	}
	alias := filepath.Join(root, "alias")
	if e = os.Symlink(parent, alias); e != nil {
		t.Fatal(e)
	}
	if e = resultParents(filepath.Join(alias, "export"), uid); e == nil {
		t.Fatal("symlink ancestor accepted")
	}
	if e = resultParents(filepath.Join(parent, "missing"), uid); e == nil {
		t.Fatal("missing initialized export accepted")
	}
}

func TestResultReadDisablesReplaceObjectsExternalDiffAndTextconv(t *testing.T) {
	f := resultTestNew(t)
	resultTestWrite(t, f.work, "tracked.txt", []byte("final text\n"))
	resultTestWrite(t, f.work, ".gitattributes", []byte("*.txt diff=unsafe\n"))
	f.finish(t)
	marker := filepath.Join(t.TempDir(), "invoked")
	helper := filepath.Join(filepath.Dir(marker), "filter")
	script := "#!/bin/sh\nprintf invoked > '" + marker + "'\nprintf transformed\\n\n"
	if e := os.WriteFile(helper, []byte(script), 0700); e != nil {
		t.Fatal(e)
	}
	resultTestGit(t, f.export, nil, "config", "diff.external", helper)
	resultTestGit(t, f.export, nil, "config", "diff.unsafe.textconv", helper)
	resultTestGit(t, f.export, nil, "replace", f.request.Identity.GitCommit, f.base)
	out := f.read(t, protocol.Diff, "tracked.txt", "")
	if out.Status != "available" || out.Text == nil || !strings.Contains(*out.Text, "+final text") || !strings.Contains(*out.Text, "-base text") {
		t.Fatal("filters or replace objects altered immutable diff", out)
	}
	out = f.read(t, protocol.File, "tracked.txt", protocol.Result)
	if out.Status != "available" || out.Text == nil || *out.Text != "final text\n" {
		t.Fatal("replace object altered result blob", out)
	}
	if _, e := os.Stat(marker); !os.IsNotExist(e) {
		t.Fatal("external filter executed", e)
	}
}

func TestResultReadServiceLineageRejectsAncestorSymlinkAndUnsafeModes(t *testing.T) {
	// This owned checkout directory avoids macOS's symlinked/writable temp parents.
	// It is a same-account validator fixture, never production Root evidence.
	path, e := os.MkdirTemp(".", ".result-read-lineage-")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = os.RemoveAll(path) })
	path, e = filepath.Abs(path)
	if e != nil {
		t.Fatal(e)
	}
	uid := uint32(os.Geteuid())
	if e = resultParents(path, uid); e != nil {
		t.Fatal("owned service lineage rejected", e)
	}
	real := filepath.Join(path, "real")
	if e = os.Mkdir(real, 0700); e != nil {
		t.Fatal(e)
	}
	alias := filepath.Join(path, "alias")
	if e = os.Symlink(real, alias); e != nil {
		t.Fatal(e)
	}
	if resultParents(alias, uid) == nil {
		t.Fatal("symlink ancestor accepted")
	}
	if e = os.Chmod(real, 0777); e != nil {
		t.Fatal(e)
	}
	if resultParents(real, uid) == nil {
		t.Fatal("writable ancestor accepted")
	}
	if e = os.Chmod(real, 0755); e != nil {
		t.Fatal(e)
	}
	if serviceDirectory(real, true) == nil {
		t.Fatal("public export accepted")
	}
	rootCopy, serviceCopy := filepath.Join(path, "root-storage"), filepath.Join(path, "service-storage")
	for _, p := range []string{rootCopy, serviceCopy} {
		if e = os.WriteFile(p, []byte("same-storage\n"), 0600); e != nil {
			t.Fatal(e)
		}
	}
	if got, e := readStorageIdentity(rootCopy, serviceCopy, uid, uid); e != nil || got != "same-storage" {
		t.Fatal("valid dual-copy algorithm rejected", got, e)
	}
	if uid != 0 {
		if _, e = readStorageIdentity(rootCopy, serviceCopy, 0, uid); e == nil {
			t.Fatal("service-owned root storage accepted as actual root")
		}
	}
	if e = os.WriteFile(serviceCopy, []byte("changed-storage\n"), 0600); e != nil {
		t.Fatal(e)
	}
	if _, e = readStorageIdentity(rootCopy, serviceCopy, uid, uid); e == nil {
		t.Fatal("changed storage copy accepted")
	}
}
