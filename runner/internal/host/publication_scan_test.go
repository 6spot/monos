package host

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	protocol "monos.local/protocol"
)

func scanFixture(t *testing.T) (string, string) {
	t.Helper()
	f := resultTestNew(t)
	return f.work, f.base
}
func scanCommit(t *testing.T, dir string) string {
	t.Helper()
	resultTestGit(t, dir, nil, "add", "-A")
	resultTestGit(t, dir, nil, "commit", "--quiet", "--allow-empty", "-m", "private fixture")
	return resultTestGit(t, dir, nil, "rev-parse", "HEAD")
}
func scanDir(t *testing.T, work string) string {
	t.Helper()
	return resultTestGit(t, work, nil, "rev-parse", "--absolute-git-dir")
}
func hasScanRule(out publicationCoverage, rule, path string) bool {
	for _, f := range out.Findings {
		if f.Rule == rule && f.Path == path {
			return true
		}
	}
	return false
}

func TestPublicationMultiRuleFindingOrdinals(t *testing.T) {
	f := resultTestNew(t)
	token := "ghp_" + strings.Repeat("M", 36)
	resultTestWrite(t, f.work, ".gitignore", []byte("multi-rule.bin\n"))
	resultTestWrite(t, f.work, "multi-rule.bin", []byte("-----BEGIN PRIVATE KEY-----\n"+token+"\nAKIA"+strings.Repeat("N", 16)))
	resultTestWrite(t, f.work, "other.bin", []byte(token))
	resultTestGit(t, f.work, nil, "add", "-f", "multi-rule.bin")
	f.finish(t)
	r := publicationTestRequest(t, f)
	pages, e := preparePublicationAt(context.Background(), r, f.export, publicationTestRoot(t), nil)
	if e != nil || len(pages) != 1 || pages[0].Result.Scan == nil || pages[0].Result.Scan.Status != "complete" {
		t.Fatal("physical multi-rule preparation failed", e)
	}
	// Three new paths plus five final-tree paths are eight visited versions.
	// Four rules for multi-rule.bin and one for other.bin yield ten findings.
	if pages[0].Result.Scan.Coverage.Versions != 8 || len(pages[0].Findings) != 10 {
		t.Fatal("finding count changed visited-version coverage", pages[0].Result.Scan)
	}
	rules := map[protocol.PublicationFindingScope]map[protocol.PublicationFindingRuleID]bool{}
	ids := map[string]bool{}
	for n, finding := range pages[0].Findings {
		if finding.OccurrenceOrdinal != int64(n+1) || ids[finding.FindingID] {
			t.Fatal("multi-rule findings share identity or ordinal")
		}
		ids[finding.FindingID] = true
		if finding.Path == "multi-rule.bin" {
			if rules[finding.Scope] == nil {
				rules[finding.Scope] = map[protocol.PublicationFindingRuleID]bool{}
			}
			rules[finding.Scope][finding.RuleID] = true
		}
	}
	for _, scope := range []protocol.PublicationFindingScope{"publication_commit", "final_tree"} {
		for _, rule := range []protocol.PublicationFindingRuleID{"tracked_ignore", "pem_private_key", "github_classic_token", "aws_access_key"} {
			if !rules[scope][rule] {
				t.Fatalf("missing physical %s rule in %s", rule, scope)
			}
		}
	}
	coverage := scanPublication(context.Background(), f.export, pages[0].Result.Candidate.Head, []string{f.base}, "unknown", publicationDefaultLimits)
	replay, e := publicationPages(r, *pages[0].Result.Candidate, coverage)
	if e != nil || !reflect.DeepEqual(replay, pages) {
		t.Fatal("same physical scan changed stable ordinals or pages", e)
	}
	raw, e := json.Marshal(pages)
	if e != nil || strings.Contains(string(raw), token) {
		t.Fatal("physical fixture leaked a matching value", e)
	}
}

func TestPublicationRangeDeletedCredentialAndAllParents(t *testing.T) {
	work, base := scanFixture(t)
	secret := "ghp_" + strings.Repeat("A", 36)
	resultTestWrite(t, work, "historical.bin", []byte("\x00"+secret+"\xff"))
	introducing := scanCommit(t, work)
	if e := os.Remove(filepath.Join(work, "historical.bin")); e != nil {
		t.Fatal(e)
	}
	head := scanCommit(t, work)
	out := scanPublication(context.Background(), scanDir(t, work), head, []string{base}, "unknown", publicationDefaultLimits)
	if !out.Complete || !hasScanRule(out, "github_classic_token", "historical.bin") {
		t.Fatalf("deleted content missed: %+v", out)
	}
	for _, f := range out.Findings {
		if f.Path == "historical.bin" && f.Commit != introducing {
			t.Fatal("wrong historical attribution")
		}
	}
	raw, _ := json.Marshal(out)
	if strings.Contains(string(raw), secret) {
		t.Fatal("matching value leaked")
	}
	limited := publicationDefaultLimits
	limited.Commits = 1
	overflow := scanPublication(context.Background(), scanDir(t, work), head, []string{base}, "unknown", limited)
	if overflow.Complete || overflow.Reason != "commit_limit" {
		t.Fatal("multi-commit range cap did not block coverage")
	}
	missing := scanPublication(context.Background(), scanDir(t, work), strings.Repeat("f", 40), []string{base}, "unknown", publicationDefaultLimits)
	if missing.Complete || missing.Reason != "missing_object" {
		t.Fatal("missing immutable head reported complete")
	}
	// Merge tree inherits token from first parent unchanged, but differs from second.
	resultTestGit(t, work, nil, "checkout", "--quiet", introducing)
	tree := resultTestGit(t, work, nil, "rev-parse", "HEAD^{tree}")
	merged := resultTestGit(t, work, []byte("merge\n"), "commit-tree", tree, "-p", introducing, "-p", head)
	out = scanPublication(context.Background(), scanDir(t, work), merged, []string{introducing, head}, "unknown", publicationDefaultLimits)
	found := false
	for _, f := range out.Findings {
		if f.Commit == merged && !f.Final && f.Path == "historical.bin" {
			found = true
		}
	}
	if !out.Complete || !found {
		t.Fatal("all-parent merge version missed", out.Reason)
	}
}
func TestPublicationIgnoreExactVersionNegationAndWorkflowDeletion(t *testing.T) {
	work, base := scanFixture(t)
	resultTestWrite(t, work, ".gitignore", []byte("nested/*\n!nested/keep\n"))
	resultTestWrite(t, work, "nested/keep", []byte("keep"))
	resultTestWrite(t, work, "nested/ignored", []byte("tracked"))
	resultTestWrite(t, work, ".github/workflows/run.yml", []byte("name: build\n"))
	resultTestGit(t, work, nil, "add", "-f", "nested/ignored")
	first := scanCommit(t, work)
	resultTestWrite(t, work, ".gitignore", []byte("nested/keep\n"))
	if e := os.Remove(filepath.Join(work, ".github/workflows/run.yml")); e != nil {
		t.Fatal(e)
	}
	head := scanCommit(t, work)
	out := scanPublication(context.Background(), scanDir(t, work), head, []string{base}, "unknown", publicationDefaultLimits)
	if !out.Complete {
		t.Fatal(out.Reason)
	}
	firstIgnored, lateKeep, deleted := false, false, false
	for _, f := range out.Findings {
		if f.Rule == "tracked_ignore" && f.Commit == first && f.Path == "nested/ignored" {
			firstIgnored = true
		}
		if f.Rule == "tracked_ignore" && f.Commit == first && f.Path == "nested/keep" {
			t.Fatal("negation lost")
		}
		if f.Rule == "tracked_ignore" && f.Final && f.Path == "nested/keep" {
			lateKeep = true
		}
		if f.Rule == "workflow_permission" && f.Commit == head {
			deleted = true
			if f.Eligible {
				t.Fatal("hard permission eligible")
			}
		}
	}
	if !firstIgnored || !lateKeep || !deleted {
		t.Fatalf("version ignore/workflow gap: %+v", out.Findings)
	}
	allowed := scanPublication(context.Background(), scanDir(t, work), head, []string{base}, "allowed", publicationDefaultLimits)
	if hasScanRule(allowed, "workflow_permission", ".github/workflows/run.yml") {
		t.Fatal("allowed permission blocked")
	}
}
func TestPublicationStreamBoundariesAndProcessingLimits(t *testing.T) {
	work, base := scanFixture(t)
	token := "github_pat_" + strings.Repeat("z", 82)
	resultTestWrite(t, work, "boundary", []byte(strings.Repeat("x", (64<<10)-8)+token))
	head := scanCommit(t, work)
	dir := scanDir(t, work)
	out := scanPublication(context.Background(), dir, head, []string{base}, "unknown", publicationDefaultLimits)
	if !out.Complete || !hasScanRule(out, "github_fine_grained_token", "boundary") {
		t.Fatal("boundary token missed", out.Reason)
	}
	for _, tc := range []struct {
		name   string
		change func(*publicationLimits)
		reason string
	}{
		{"paths", func(l *publicationLimits) { l.Paths = 1 }, "path_limit"},
		{"occurrences", func(l *publicationLimits) { l.Occurrences = 1 }, "occurrence_limit"},
		{"blob", func(l *publicationLimits) { l.BlobBytes = 100 }, "blob_limit"},
		{"aggregate", func(l *publicationLimits) { l.AggregateBytes = 100 }, "aggregate_limit"},
		{"findings", func(l *publicationLimits) { l.Findings = 1 }, "finding_limit"},
		{"evidence", func(l *publicationLimits) { l.EvidenceBytes = 2 }, "finding_limit"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			l := publicationDefaultLimits
			tc.change(&l)
			o := scanPublication(context.Background(), dir, head, []string{base}, "unknown", l)
			if o.Complete || o.Reason != tc.reason {
				t.Fatal("overflow falsely complete", o.Complete, o.Reason)
			}
		})
	}
	l := publicationDefaultLimits
	l.PolicyBytes = 100
	l.ProviderBytes = 200
	out = scanPublication(context.Background(), dir, head, []string{base}, "unknown", l)
	if !out.Complete || !hasScanRule(out, "provider_blob_size", "boundary") || !hasScanRule(out, "policy_blob_size", "boundary") {
		t.Fatal("separate size limits lost")
	}
	for _, f := range out.Findings {
		if f.Rule == "provider_blob_size" && f.Eligible {
			t.Fatal("hard size override eligible")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	out = scanPublication(ctx, dir, head, []string{base}, "unknown", publicationDefaultLimits)
	if out.Complete {
		t.Fatal("interrupted scan complete")
	}
}
func TestPublicationUnsupportedIgnoreAndInheritedFinalContent(t *testing.T) {
	work, base := scanFixture(t)
	resultTestWrite(t, work, "inherited", []byte("-----BEGIN OPENSSH PRIVATE KEY-----"))
	base = scanCommit(t, work)
	head := scanCommit(t, work)
	out := scanPublication(context.Background(), scanDir(t, work), head, []string{base}, "unknown", publicationDefaultLimits)
	if !out.Complete || !hasScanRule(out, "pem_private_key", "inherited") {
		t.Fatal("inherited final tree skipped")
	}
	if e := os.Symlink("inherited", filepath.Join(work, ".gitignore")); e != nil {
		t.Fatal(e)
	}
	head = scanCommit(t, work)
	out = scanPublication(context.Background(), scanDir(t, work), head, []string{base}, "unknown", publicationDefaultLimits)
	if out.Complete || out.Reason != "unsupported_ignore" {
		t.Fatal("symlink ignored silently", out)
	}
}

func TestPublicationKnownExposureCopyAndSensitiveFilenameRedaction(t *testing.T) {
	work, base := scanFixture(t)
	token := "ghp_" + strings.Repeat("Q", 36)
	original := token + ".txt"
	resultTestWrite(t, work, original, []byte(token))
	base = scanCommit(t, work)
	if e := os.Rename(filepath.Join(work, original), filepath.Join(work, "renamed.txt")); e != nil {
		t.Fatal(e)
	}
	resultTestWrite(t, work, token+"-copy", []byte(token))
	head := scanCommit(t, work)
	out := scanPublication(context.Background(), scanDir(t, work), head, []string{base}, "unknown", publicationDefaultLimits)
	if !out.Complete {
		t.Fatal(out.Reason)
	}
	known := 0
	for _, f := range out.Findings {
		if f.Final && f.PublishedCommit == base {
			known++
			if f.Eligible || !f.BaselinePathRedacted || f.PublishedPath == original {
				t.Fatal("public exposure waived or baseline path leaked")
			}
		}
	}
	if known != 2 {
		t.Fatal("copy or rename lost public exposure", known)
	}
	raw, _ := json.Marshal(out)
	if strings.Contains(string(raw), token) {
		t.Fatal("matching filename escaped redaction")
	}
}

func TestPublicationFiniteRuleCorpusStreamedWholeBlobDigest(t *testing.T) {
	work, _ := scanFixture(t)
	dir := scanDir(t, work)
	tokens := []struct{ token, rule string }{
		{"-----BEGIN PRIVATE KEY-----", "pem_private_key"}, {"-----BEGIN RSA PRIVATE KEY-----", "pem_private_key"}, {"-----BEGIN EC PRIVATE KEY-----", "pem_private_key"}, {"-----BEGIN OPENSSH PRIVATE KEY-----", "pem_private_key"},
		{"ghp_" + strings.Repeat("A", 36), "github_classic_token"}, {"gho_" + strings.Repeat("A", 36), "github_classic_token"}, {"ghr_" + strings.Repeat("A", 36), "github_classic_token"},
		{"github_pat_" + strings.Repeat("A", 255), "github_fine_grained_token"}, {"AKIA" + strings.Repeat("A", 16), "aws_access_key"}, {"ASIA" + strings.Repeat("A", 16), "aws_access_key"},
	}
	for _, tc := range tokens {
		t.Run(tc.rule+tc.token[:4], func(t *testing.T) {
			raw := []byte(strings.Repeat("x", (64<<10)-10) + tc.token + "\x00\xff-tail")
			blob := resultTestGit(t, work, raw, "hash-object", "-w", "--stdin")
			out, e := publicationStreamBlob(context.Background(), dir, blob, int64(len(raw)))
			if e != nil || !reflect.DeepEqual(out.Rules, []string{tc.rule}) {
				t.Fatal("finite rule corpus missed boundary", e, out.Rules)
			}
			digest := sha256.Sum256(raw)
			if out.Digest != hex.EncodeToString(digest[:]) {
				t.Fatal("content digest did not cover full binary blob")
			}
		})
	}
	raw := []byte("-----BEGIN PUBLIC KEY----- ghp_short github_pat_short AKIA0000")
	blob := resultTestGit(t, work, raw, "hash-object", "-w", "--stdin")
	out, e := publicationStreamBlob(context.Background(), dir, blob, int64(len(raw)))
	if e != nil || len(out.Rules) != 0 {
		t.Fatal("finite rule negative corpus falsely matched", e)
	}
}
func TestPublicationNonUTF8PathCoverageAndHistoricalPublicCopyDeletion(t *testing.T) {
	f := resultTestNew(t)
	bad := string([]byte{'b', 'a', 'd', 0xff})
	blob := resultTestGit(t, f.work, []byte("content"), "hash-object", "-w", "--stdin")
	resultTestGit(t, f.work, []byte("100644 "+blob+"\t"+bad+"\x00"), "update-index", "-z", "--index-info")
	f.exportIndex(t)
	out := scanPublication(context.Background(), f.export, f.request.Identity.GitCommit, []string{f.base}, "unknown", publicationDefaultLimits)
	if out.Complete || out.Reason != "unsupported_path" {
		t.Fatal("nonUTF8 path silently omitted")
	}
	work, base := scanFixture(t)
	token := "ghp_" + strings.Repeat("R", 36)
	resultTestWrite(t, work, "public-token", []byte(token))
	base = scanCommit(t, work)
	resultTestWrite(t, work, "copied-token", []byte(token))
	introduced := scanCommit(t, work)
	if e := os.Remove(filepath.Join(work, "copied-token")); e != nil {
		t.Fatal(e)
	}
	head := scanCommit(t, work)
	out = scanPublication(context.Background(), scanDir(t, work), head, []string{base}, "unknown", publicationDefaultLimits)
	found := false
	for _, f := range out.Findings {
		if f.Commit == introduced && f.Path == "copied-token" {
			found = true
			if f.Eligible || f.PublishedCommit != base || f.PublishedPath != "public-token" {
				t.Fatal("historical public exposure became eligible")
			}
		}
	}
	if !out.Complete || !found {
		t.Fatal("later-deleted public blob copy missed")
	}
}
