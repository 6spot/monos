package host

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Git evaluates only the exact tree's regular ignore blobs, in a new private
// repository with no info/exclude, global patterns, worktree files or filters.
// Symlink ignore files are unsupported rather than followed or silently skipped.
func publicationIgnored(ctx context.Context, dir string, tree, versions []publicationVersion, limits publicationLimits) (map[string]bool, error) {
	ignored := map[string]bool{}
	tmp, e := os.MkdirTemp(filepath.Dir(dir), ".publication-ignore-")
	if e != nil {
		return nil, errors.New("unsupported_ignore")
	}
	defer os.RemoveAll(tmp)
	run := func(input []byte, args ...string) ([]byte, error) {
		boundedCtx, cancel := context.WithCancel(ctx)
		defer cancel()
		cmd := exec.CommandContext(boundedCtx, "/usr/bin/git", append([]string{"-C", tmp, "-c", "core.hooksPath=/dev/null", "-c", "core.excludesFile=/dev/null", "-c", "core.ignoreCase=false"}, args...)...)
		cmd.Env = publicationIgnoreEnvironment()
		cmd.Stdin = bytes.NewReader(input)
		cmd.Stderr = io.Discard
		output := &boundedOutput{limit: 40 << 20, cancel: cancel}
		cmd.Stdout = output
		e := cmd.Run()
		if e != nil {
			if exit, ok := e.(*exec.ExitError); ok && exit.ExitCode() == 1 && len(args) > 0 && args[0] == "check-ignore" {
				return output.buffer.Bytes(), nil
			}
			return nil, errors.New("unsupported_ignore")
		}
		return output.buffer.Bytes(), nil
	}
	if _, e = run(nil, "init", "--quiet"); e != nil {
		return nil, e
	}
	var materialized int64
	for _, v := range tree {
		if filepath.Base(v.Path) != ".gitignore" {
			continue
		}
		if v.Mode != "100644" && v.Mode != "100755" {
			return nil, errors.New("unsupported_ignore")
		}
		size, e := resultObjectSize(ctx, dir, v.Blob)
		if e != nil || size > limits.BlobBytes || size > limits.AggregateBytes-materialized {
			return nil, errors.New("unsupported_ignore")
		}

		// Git path components cannot select administrative storage on any host.
		for _, part := range strings.Split(v.Path, "/") {
			if strings.EqualFold(part, ".git") {
				return nil, errors.New("unsupported_path")
			}
		}
		path := filepath.Join(tmp, filepath.FromSlash(v.Path))
		if e = os.MkdirAll(filepath.Dir(path), 0700); e != nil {
			return nil, errors.New("unsupported_ignore")
		}
		file, e := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			return nil, errors.New("unsupported_ignore")
		}
		e = publicationCopyBlob(ctx, dir, v.Blob, size, file)
		closeErr := file.Close()
		if e != nil || closeErr != nil {
			return nil, errors.New("unsupported_ignore")
		}
		materialized += size

	}
	var input bytes.Buffer
	for _, v := range versions {
		if !v.Deleted {
			if publicationIgnorePathLineage(tmp, v.Path) != nil {
				return nil, errors.New("unsupported_ignore")
			}
			input.WriteString(v.Path)
			input.WriteByte(0)
		}
	}
	if input.Len() == 0 {
		return ignored, nil
	}
	raw, e := run(input.Bytes(), "check-ignore", "--no-index", "-z", "--stdin")
	if e != nil {
		return nil, e
	}
	for _, path := range bytes.Split(raw, []byte{0}) {
		if len(path) > 0 {
			ignored[string(path)] = true
		}
	}
	return ignored, nil
}

func publicationIgnoreEnvironment() []string {
	env := []string{}
	for _, value := range publicationGitEnvironment() {
		if value != "GIT_LITERAL_PATHSPECS=1" {
			env = append(env, value)
		}
	}
	return env
}

// Writes exact blob bytes without buffering a full ignore file in memory.
func publicationCopyBlob(ctx context.Context, dir, oid string, size int64, dst io.Writer) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	cmd := exec.CommandContext(ctx, "/usr/bin/git", "--no-replace-objects", "--git-dir="+dir, "-c", "safe.directory="+dir, "cat-file", "blob", oid)
	cmd.Env = publicationGitEnvironment()
	cmd.Stderr = io.Discard
	sink := &publicationCopySink{dst: dst, remaining: size, cancel: cancel}
	cmd.Stdout = sink
	if cmd.Run() != nil || sink.remaining != 0 {
		return errors.New("missing_object")
	}
	return nil
}

type publicationCopySink struct {
	dst       io.Writer
	remaining int64
	cancel    context.CancelFunc
}

func (s *publicationCopySink) Write(p []byte) (int, error) {
	if int64(len(p)) > s.remaining {
		s.cancel()
		return 0, errors.New("object_changed")
	}
	n, e := s.dst.Write(p)
	s.remaining -= int64(n)
	if e != nil {
		s.cancel()
	}
	return n, e
}

// A case-insensitive host must not let A/.gitignore accidentally govern a/.
// Reject a filesystem alias instead of claiming exact-tree ignore semantics.
func publicationIgnorePathLineage(root, path string) error {
	components := strings.Split(path, "/")
	current := root
	for _, part := range components[:len(components)-1] {
		entries, e := os.ReadDir(current)
		if os.IsNotExist(e) {
			return nil
		}
		if e != nil {
			return e
		}
		exact := false
		for _, entry := range entries {
			if entry.Name() == part {
				exact = true
				break
			}
		}
		next := filepath.Join(current, part)
		info, e := os.Lstat(next)
		if os.IsNotExist(e) {
			return nil
		}
		if e != nil || !exact || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return errors.New("unsupported_ignore")
		}
		current = next
	}
	return nil
}
