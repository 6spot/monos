package host

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os/exec"
	"regexp"
	"sort"
	"strings"
)

// The scanner has no provider client and never reads an execution worktree.
// Every version comes from an immutable candidate and its verified exclusions.
type publicationLimits struct {
	Commits, Paths, Occurrences, Findings, EvidenceBytes  int
	BlobBytes, AggregateBytes, PolicyBytes, ProviderBytes int64
}

var publicationDefaultLimits = publicationLimits{256, 8192, 32768, 4096, 8 << 20, 128 << 20, 512 << 20, 50 << 20, 100 << 20}

type publicationVersion struct {
	Commit, Path, Mode, Blob string
	Final, Deleted           bool
}
type publicationFinding struct {
	Rule                 string `json:"rule"`
	Commit               string `json:"commit"`
	Path                 string `json:"path"`
	Blob                 string `json:"blob,omitempty"`
	ContentDigest        string `json:"content_digest,omitempty"`
	Size                 int64  `json:"size"`
	Limit                int64  `json:"limit,omitempty"`
	Eligible             bool   `json:"eligible"`
	Final                bool   `json:"final"`
	PublishedCommit      string `json:"published_commit,omitempty"`
	PublishedPath        string `json:"published_path,omitempty"`
	PathRedacted         bool   `json:"path_redacted"`
	BaselinePathRedacted bool   `json:"baseline_path_redacted"`
	Ordinal              int    `json:"ordinal"`
}
type publicationCoverage struct {
	WorkflowChanges bool
	Complete        bool
	Reason          string
	Commits         []string
	Occurrences     int
	Paths           int
	UniqueBytes     int64
	Findings        []publicationFinding
}
type publicationBlob struct {
	Digest string
	Size   int64
	Rules  []string
}
type credentialRule struct {
	id      string
	pattern *regexp.Regexp
}

// Finite byte rules, maximum match 266 bytes. Keeping 512 bytes between 64 KiB
// chunks detects split matches. Only rule IDs survive; neither match bytes nor
// matching-value hashes are retained. Binary data follows the same rules.
var publicationCredentialRules = []credentialRule{
	{"pem_private_key", regexp.MustCompile(`-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----`)},
	{"github_classic_token", regexp.MustCompile(`gh[pousr]_[A-Za-z0-9]{36}`)},
	{"github_fine_grained_token", regexp.MustCompile(`github_pat_[A-Za-z0-9_]{22,255}`)},
	{"aws_access_key", regexp.MustCompile(`(AKIA|ASIA)[A-Z0-9]{16}`)},
}

func publicationTree(ctx context.Context, dir, commit string, limit int) ([]publicationVersion, error) {
	raw, e := resultGit(ctx, dir, 40<<20, "ls-tree", "-r", "-z", "--full-tree", commit)
	if e != nil {
		return nil, e
	}
	versions := []publicationVersion{}
	for _, entry := range bytes.Split(raw, []byte{0}) {
		if len(entry) == 0 {
			continue
		}
		head, path, ok := bytes.Cut(entry, []byte{'\t'})
		fields := strings.Fields(string(head))
		if !ok || len(fields) != 3 || !validResultPath(string(path)) {
			return nil, errors.New("unsupported_path")
		}
		if fields[0] != "100644" && fields[0] != "100755" && fields[0] != "120000" && fields[0] != "160000" {
			return nil, errors.New("unsupported_mode")
		}
		versions = append(versions, publicationVersion{Commit: commit, Path: string(path), Mode: fields[0], Blob: fields[2]})
		if len(versions) > limit {
			return nil, errors.New("path_limit")
		}
	}
	return versions, nil
}
func publicationChanges(ctx context.Context, dir, commit, parent string, limit int) ([]publicationVersion, error) {
	args := []string{"diff-tree", "--no-commit-id", "--raw", "-r", "-z", "--no-renames", "--no-ext-diff", "--no-textconv"}
	if parent == "" {
		args = append(args, "--root", commit)
	} else {
		args = append(args, parent, commit)
	}
	raw, e := resultGit(ctx, dir, 40<<20, args...)
	if e != nil {
		return nil, e
	}
	fields := bytes.Split(raw, []byte{0})
	versions := []publicationVersion{}
	for at := 0; at < len(fields)-1; at += 2 {
		if at+1 >= len(fields) {
			return nil, errors.New("missing_object")
		}
		h := strings.Fields(string(fields[at]))
		p := string(fields[at+1])
		if len(h) != 5 || !strings.HasPrefix(h[0], ":") || !validResultPath(p) {
			return nil, errors.New("unsupported_path")
		}
		v := publicationVersion{Commit: commit, Path: p, Mode: h[1], Blob: h[3], Deleted: h[1] == "000000"}
		if v.Deleted {
			v.Mode = h[0][1:]
			v.Blob = h[2]
		}
		versions = append(versions, v)
		if len(versions) > limit {
			return nil, errors.New("path_limit")
		}
	}
	return versions, nil
}

func publicationStreamBlob(ctx context.Context, dir, oid string, size int64) (publicationBlob, error) {
	out := publicationBlob{Size: size}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	cmd := exec.CommandContext(ctx, "/usr/bin/git", "--no-replace-objects", "--git-dir="+dir, "-c", "safe.directory="+dir, "-c", "core.hooksPath=/dev/null", "cat-file", "blob", oid)
	cmd.Env = publicationGitEnvironment()
	// No raw stderr is retained or returned.
	cmd.Stderr = io.Discard
	stdout, e := cmd.StdoutPipe()
	if e != nil {
		return out, errors.New("missing_object")
	}
	if e = cmd.Start(); e != nil {
		return out, errors.New("missing_object")
	}
	h := sha256.New()
	buf := make([]byte, 64<<10)
	overlap := []byte{}
	seen := map[string]bool{}
	var total int64
	for {
		n, readErr := stdout.Read(buf)
		if n > 0 {
			total += int64(n)
			if total > size {
				cancel()
				_ = cmd.Wait()
				return out, errors.New("object_changed")
			}
			_, _ = h.Write(buf[:n])
			window := append(overlap, buf[:n]...)
			for _, r := range publicationCredentialRules {
				if !seen[r.id] && r.pattern.Match(window) {
					seen[r.id] = true
				}
			}
			tail := len(window) - 512
			if tail < 0 {
				tail = 0
			}
			overlap = append([]byte{}, window[tail:]...)
		}
		if readErr != nil {
			if readErr != io.EOF {
				cancel()
				_ = cmd.Wait()
				return out, errors.New("missing_object")
			}
			break
		}
	}
	if e = cmd.Wait(); e != nil || total != size {
		if ctx.Err() != nil {
			return out, ctx.Err()
		}
		return out, errors.New("missing_object")
	}
	out.Digest = hex.EncodeToString(h.Sum(nil))
	for _, r := range publicationCredentialRules {
		if seen[r.id] {
			out.Rules = append(out.Rules, r.id)
		}
	}
	return out, nil
}
func publicationGitEnvironment() []string {
	return []string{"PATH=/usr/bin:/bin", "HOME=/nonexistent", "LANG=C.UTF-8", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_TERMINAL_PROMPT=0", "GIT_NO_LAZY_FETCH=1", "GIT_LITERAL_PATHSPECS=1", "GIT_OPTIONAL_LOCKS=0"}
}
func scanPublication(ctx context.Context, dir, head string, parents []string, permission string, limits publicationLimits) publicationCoverage {
	out := publicationCoverage{Findings: []publicationFinding{}, Commits: []string{}}
	fail := func(reason string) publicationCoverage { out.Reason = reason; return out }
	if limits.Commits < 1 || limits.Paths < 1 || limits.Occurrences < 1 || limits.Findings < 1 || limits.EvidenceBytes < 2 || limits.BlobBytes < 1 || limits.AggregateBytes < 1 || limits.PolicyBytes < 1 || limits.ProviderBytes < 0 {
		return fail("invalid_configuration")
	}
	args := []string{"rev-list", "--topo-order", head, "--not"}
	args = append(args, parents...)
	raw, e := resultGit(ctx, dir, 256*1024, args...)
	if e != nil {
		return fail("missing_object")
	}
	out.Commits = strings.Fields(string(raw))
	if len(out.Commits) > limits.Commits {
		return fail("commit_limit")
	}
	published := map[string]publicationVersion{}
	for _, parent := range parents {
		baseline, e := publicationTree(ctx, dir, parent, limits.Paths)
		if e != nil {
			return fail(scanReason(e))
		}
		for _, v := range baseline {
			key := v.Blob
			if _, ok := published[key]; !ok {
				v.Commit = parent
				published[key] = v
			}
		}
	}
	cache := map[string]publicationBlob{}
	evidenceBytes := 0
	paths := map[string]bool{}
	add := func(v publicationVersion, rule string, b publicationBlob, limit int64, eligible bool) bool {
		// A version may yield several distinct policy and credential findings.
		// Keep their stable ordinals independent of visited-version coverage.
		f := publicationFinding{Rule: rule, Commit: v.Commit, Path: v.Path, Blob: v.Blob, ContentDigest: b.Digest, Size: b.Size, Limit: limit, Eligible: eligible, Final: v.Final, Ordinal: len(out.Findings) + 1}
		if strings.HasPrefix(rule, "credential:") {
			f.Rule = strings.TrimPrefix(rule, "credential:")
			baseline := published[v.Blob]
			f.PublishedCommit = baseline.Commit
			f.PublishedPath = baseline.Path
			if publicationSensitivePath(f.PublishedPath) {
				f.PublishedPath = "[redacted credential path]"
				f.BaselinePathRedacted = true
			}
		}
		if publicationSensitivePath(f.Path) {
			f.Path = "[redacted credential path]"
			f.PathRedacted = true
		}
		raw, _ := json.Marshal(f)
		if len(out.Findings) >= limits.Findings || evidenceBytes+len(raw) > limits.EvidenceBytes {
			return false
		}
		evidenceBytes += len(raw)
		out.Findings = append(out.Findings, f)
		return true
	}
	visit := func(commit string, versions []publicationVersion, final bool) string {
		tree, e := publicationTree(ctx, dir, commit, limits.Paths)
		if e != nil {
			return scanReason(e)
		}
		ignored, e := publicationIgnored(ctx, dir, tree, versions, limits)
		if e != nil {
			return scanReason(e)
		}
		for _, v := range versions {
			if ctx.Err() != nil {
				return "interrupted"
			}
			v.Final = final
			paths[v.Path] = true
			out.Paths = len(paths)
			out.Occurrences++
			if out.Occurrences > limits.Occurrences {
				return "occurrence_limit"
			}
			if !final && strings.HasPrefix(v.Path, ".github/workflows/") {
				out.WorkflowChanges = true
			}
			if !final && strings.HasPrefix(v.Path, ".github/workflows/") && permission != "allowed" && permission != "not_applicable" {
				if !add(v, "workflow_permission", publicationBlob{}, 0, false) {
					return "finding_limit"
				}
			}
			if v.Deleted {
				continue
			}
			if v.Mode == "160000" {
				continue
			}
			b, ok := cache[v.Blob]
			if !ok {
				size, e := resultObjectSize(ctx, dir, v.Blob)
				if e != nil {
					return "missing_object"
				}
				if limits.ProviderBytes > 0 && size > limits.ProviderBytes && size > limits.BlobBytes {
					if !add(v, "provider_blob_size", publicationBlob{Size: size}, limits.ProviderBytes, false) {
						return "finding_limit"
					}
				}
				if size > limits.BlobBytes {
					return "blob_limit"
				}
				if size > limits.AggregateBytes-out.UniqueBytes {
					return "aggregate_limit"
				}
				b, e = publicationStreamBlob(ctx, dir, v.Blob, size)
				if e != nil {
					return scanReason(e)
				}
				out.UniqueBytes += size
				cache[v.Blob] = b
			}
			if limits.ProviderBytes > 0 && b.Size > limits.ProviderBytes {
				if !add(v, "provider_blob_size", b, limits.ProviderBytes, false) {
					return "finding_limit"
				}
			}
			if b.Size > limits.PolicyBytes {
				if !add(v, "policy_blob_size", b, limits.PolicyBytes, true) {
					return "finding_limit"
				}
			}
			if ignored[v.Path] {
				if !add(v, "tracked_ignore", b, 0, true) {
					return "finding_limit"
				}
			}
			for _, rule := range b.Rules {
				eligible := true
				if published[v.Blob].Commit != "" {
					eligible = false
					rule = "credential:" + rule
				}
				if !add(v, rule, b, 0, eligible) {
					return "finding_limit"
				}
			}
		}
		return ""
	}
	for _, commit := range out.Commits {
		raw, e := resultGit(ctx, dir, 256*1024, "rev-list", "--parents", "-n", "1", commit)
		if e != nil {
			return fail("missing_object")
		}
		fields := strings.Fields(string(raw))
		if len(fields) < 1 || fields[0] != commit {
			return fail("missing_object")
		}
		commitParents := fields[1:]
		if len(commitParents) == 0 {
			commitParents = []string{""}
		}
		union := map[string]publicationVersion{}
		for _, p := range commitParents {
			versions, e := publicationChanges(ctx, dir, commit, p, limits.Paths)
			if e != nil {
				return fail(scanReason(e))
			}
			for _, v := range versions {
				key := v.Path + "\x00" + v.Mode + "\x00" + v.Blob
				union[key] = v
			}
		}
		keys := make([]string, 0, len(union))
		for key := range union {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		versions := make([]publicationVersion, 0, len(keys))
		for _, key := range keys {
			versions = append(versions, union[key])
		}
		if reason := visit(commit, versions, false); reason != "" {
			return fail(reason)
		}
	}
	final, e := publicationTree(ctx, dir, head, limits.Paths)
	if e != nil {
		return fail(scanReason(e))
	}
	if reason := visit(head, final, true); reason != "" {
		return fail(reason)
	}
	out.Complete = true
	return out
}
func scanReason(e error) string {
	if errors.Is(e, context.Canceled) || errors.Is(e, context.DeadlineExceeded) {
		return "interrupted"
	}
	for _, r := range []string{"unsupported_path", "unsupported_mode", "unsupported_ignore", "path_limit", "missing_object"} {
		if e.Error() == r {
			return r
		}
	}
	return "missing_object"
}

func publicationSensitivePath(path string) bool {
	for _, r := range publicationCredentialRules {
		if r.pattern.MatchString(path) {
			return true
		}
	}
	return false
}

// A nil provider ceiling is unknown; local traversal and policy limits still apply.
func publicationProviderLimit(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}
