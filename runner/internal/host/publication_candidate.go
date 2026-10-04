package host

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

// PublicationPrepare is an unprivileged service effect, independent of Attempts.
// The daemon verifies journal authority before entering this disk/Git boundary.
func PublicationPrepare(ctx context.Context, r protocol.PublicationPrepareRequest) ([]protocol.PublicationResultPage, error) {
	if e := ValidatePublicationRequest(r); e != nil {
		return PublicationFailure(r, "reconciliation_required", "identity_mismatch"), nil
	}
	dir, status := trustedResultExport(r.Source)
	if status != "" {
		return PublicationFailure(r, "unavailable", "retained_unavailable"), nil
	}
	if e := verifyPublicationSource(ctx, dir, r.Source); e != nil {
		return PublicationFailure(r, "reconciliation_required", "identity_mismatch"), nil
	}
	for _, p := range r.Construction.Parents {
		if e := verifyPublicationPin(ctx, p, r.Source, r.Construction.TargetBranch); e != nil {
			return PublicationFailure(r, "reconciliation_required", "unverified_parent"), nil
		}
	}
	root := filepath.Join(Root, "service", "publication")
	if resultParents(filepath.Dir(root), uint32(os.Geteuid())) != nil || serviceDirectory(filepath.Dir(root), true) != nil {
		return PublicationFailure(r, "unavailable", "retained_unavailable"), nil
	}
	return preparePublicationAt(ctx, r, dir, root, nil)
}
func ValidatePublicationRequest(r protocol.PublicationPrepareRequest) error {
	raw, e := json.Marshal(r)
	if e != nil || len(raw) > 512<<10 || wire.Validate("PublicationPrepareRequest", raw) != nil {
		return errors.New("invalid publication request")
	}
	for _, pair := range []struct {
		value  any
		digest string
	}{{r.Source, r.SourceDigest}, {r.Construction, r.ConstructionDigest}, {r.Configuration, r.ConfigurationDigest}, {r.EffectiveBasis, r.EffectiveBasisDigest}} {
		_, digest, e := wire.Canonical(pair.value)
		if e != nil || digest != pair.digest {
			return errors.New("publication identity mismatch")
		}
	}
	c := r.Construction
	s := r.Source
	b := r.EffectiveBasis
	if c.SourceDigest != r.SourceDigest || c.RepositoryIdentity != s.RepositoryIdentity || c.Message != "monos Task "+s.TaskID+" result v1" || b.TaskID != s.TaskID || b.CompletionOperationID != s.OperationID || b.CompletionManifestDigest != s.ManifestDigest {
		return errors.New("publication identity mismatch")
	}
	if !ValidID(r.OperationID) || !ValidID(c.ConstructionID) || !ValidID(c.CandidateID) || len(c.Parents) < 1 || len(c.Parents) > 2 {
		return errors.New("publication identity mismatch")
	}
	seen := map[string]bool{}
	for n, p := range c.Parents {
		if p.Kind == "published" || n == 0 && p.Kind != "materialization" || n > 0 && p.Kind != "target" || seen[p.Commit] {
			return errors.New("unverified publication parent")
		}
		seen[p.Commit] = true
		m := p.Outcome.WorkspaceMetadata
		if m == nil || p.Outcome.WorkspaceID == nil || *p.Outcome.WorkspaceID != s.WorkspaceID || m.Generation != p.Workspace.Generation || m.LeaseID != p.Workspace.LeaseID || m.RepositoryIdentity != s.RepositoryIdentity {
			return errors.New("unverified publication parent")
		}
		if p.RepositoryIdentity != s.RepositoryIdentity || p.Workspace.TaskID != s.TaskID || p.Workspace.WorkspaceID != s.WorkspaceID || p.Workspace.ResourceID != s.ResourceID || p.Workspace.RunnerID != s.RunnerID || p.Workspace.Generation != s.Generation || p.Outcome.WorkspaceMetadata == nil || p.Outcome.WorkspaceMetadata.StorageID != s.StorageID || p.Outcome.WorkspaceMetadata.TargetBranch != c.TargetBranch {
			return errors.New("unverified publication parent")
		}
		_, digest, e := wire.Canonical(struct {
			OperationID string                       `json:"operation_id"`
			Workspace   protocol.WorkspaceDescriptor `json:"workspace"`
			Outcome     protocol.EffectResult        `json:"outcome"`
		}{p.ObservationOperationID, p.Workspace, p.Outcome})
		if e != nil || digest != p.ObservationDigest {
			return errors.New("unverified publication parent")
		}
		if p.Kind == "materialization" && (p.Workspace.Basis != nil || p.Commit != s.BaseCommit || p.Commit != p.Outcome.WorkspaceMetadata.BaseCommit) {
			return errors.New("unverified publication parent")
		}
		if p.Kind == "target" && p.Commit != p.Outcome.WorkspaceMetadata.TargetCommit {
			return errors.New("unverified publication parent")
		}
	}
	return nil
}
func verifyPublicationSource(ctx context.Context, dir string, s protocol.ResultReadIdentity) error {
	if e := publicationGitStorage(ctx, dir); e != nil {
		return e
	}
	for expression, want := range map[string]string{"refs/monos/result": s.GitCommit, s.GitCommit + "^{tree}": s.GitTree, s.BaseCommit + "^{commit}": s.BaseCommit} {
		raw, e := resultGit(ctx, dir, 256, "rev-parse", "--verify", expression)
		if e != nil || strings.TrimSpace(string(raw)) != want {
			return errors.New("publication source mismatch")
		}
	}
	return nil
}

// A public OID must retain the original completed service fetch intent and exact
// cache pin. Mere presence in the result export never establishes public origin.
func verifyPublicationPin(ctx context.Context, p protocol.PublicationParent, s protocol.ResultReadIdentity, target string) error {
	return verifyPublicationPinAt(ctx, p, s, target, filepath.Join(Root, "service", "workspace-operations", p.ObservationOperationID+".json"), resourceCache(s.ResourceID))
}
func verifyPublicationPinAt(ctx context.Context, p protocol.PublicationParent, s protocol.ResultReadIdentity, target, path, cache string) error {
	uid := uint32(os.Geteuid())
	if !ValidID(p.ObservationOperationID) || resultParents(filepath.Dir(path), uid) != nil || trustedFile(path, uid) != nil {
		return errors.New("unverified publication parent")
	}
	info, e := os.Lstat(path)
	if e != nil || info.Size() > 1<<20 || serviceDirectory(filepath.Dir(path), true) != nil {
		return errors.New("unverified publication parent")
	}
	raw, e := os.ReadFile(path)
	if e != nil {
		return errors.New("unverified publication parent")
	}
	var pin struct {
		Digest       string                     `json:"digest"`
		BaseRef      string                     `json:"base_ref"`
		TargetBranch string                     `json:"target_branch"`
		RepositoryID string                     `json:"github_repository_id"`
		Complete     bool                       `json:"complete"`
		Metadata     protocol.WorkspaceMetadata `json:"metadata"`
	}
	if json.Unmarshal(raw, &pin) != nil {
		return errors.New("unverified publication parent")
	}
	_, wd, e := wire.Canonical(p.Workspace)
	m := p.Outcome.WorkspaceMetadata
	if m == nil {
		return errors.New("unverified publication parent")
	}
	if e != nil || !pin.Complete || pin.Digest != wd || pin.BaseRef == "" || pin.TargetBranch != target || pin.Metadata.FinalizedCommit != m.FinalizedCommit || pin.Metadata.Checkpoint != nil || m.Checkpoint != nil || pin.Metadata.BaseCommit != m.BaseCommit || pin.Metadata.TargetCommit != m.TargetCommit || pin.Metadata.TargetBranch != target || pin.Metadata.Generation != m.Generation || pin.Metadata.LeaseID != m.LeaseID || pin.Metadata.RepositoryIdentity != s.RepositoryIdentity || m.ProviderMetadata == nil || m.ProviderMetadata.Github == nil || pin.RepositoryID != m.ProviderMetadata.Github.RepositoryID || pin.Metadata.ProviderMetadata == nil || pin.Metadata.ProviderMetadata.Github == nil || pin.Metadata.ProviderMetadata.Github.RepositoryID != pin.RepositoryID {
		return errors.New("unverified publication parent")
	}
	if p.Workspace.Resource.ProviderMetadata == nil || p.Workspace.Resource.ProviderMetadata.Github == nil || p.Workspace.Resource.ProviderMetadata.Github.RepositoryID != pin.RepositoryID {
		return errors.New("unverified publication parent")
	}
	if resultParents(cache, uid) != nil || serviceDirectory(cache, false) != nil || publicationGitStorage(ctx, cache) != nil {
		return errors.New("unverified publication parent")
	}
	name := "base"
	if p.Kind == "target" {
		name = "target"
	}
	value, e := resultGit(ctx, cache, 256, "rev-parse", "--verify", "refs/monos/pins/"+p.ObservationOperationID+"/"+name+"^{commit}")
	if e != nil || strings.TrimSpace(string(value)) != p.Commit {
		return errors.New("unverified publication parent")
	}
	return nil
}

// Reject filesystem indirection anywhere in administrative storage before Git
// reads or writes objects/refs. Same-account tests do not establish Linux account
// isolation; production checks still require actual initialized storage lineage.
func publicationGitStorage(ctx context.Context, dir string) error {
	uid := uint32(os.Geteuid())
	for _, name := range []string{"HEAD", "config"} {
		if trustedFile(filepath.Join(dir, name), uid) != nil {
			return errors.New("publication storage unavailable")
		}
	}
	for _, name := range []string{"objects", "refs"} {
		if e := filepath.WalkDir(filepath.Join(dir, name), func(path string, entry os.DirEntry, e error) error {
			if e != nil {
				return e
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			s, e := os.Lstat(path)
			if e != nil {
				return e
			}
			st, ok := s.Sys().(*syscall.Stat_t)
			if !ok || st.Uid != uid || s.Mode()&os.ModeSymlink != 0 || s.Mode().Perm()&0022 != 0 || (!s.IsDir() && !s.Mode().IsRegular()) {
				return errors.New("publication storage unavailable")
			}
			return nil
		}); e != nil {
			return errors.New("publication storage unavailable")
		}
	}
	if _, e := os.Lstat(filepath.Join(dir, "objects", "info", "alternates")); !os.IsNotExist(e) {
		return errors.New("publication storage unavailable")
	}
	if _, e := os.Lstat(filepath.Join(dir, "packed-refs")); e == nil && trustedFile(filepath.Join(dir, "packed-refs"), uid) != nil {
		return errors.New("publication storage unavailable")
	}
	return nil
}

type publicationConstructionIntent struct {
	Source             protocol.ResultReadIdentity      `json:"source"`
	Construction       protocol.PublicationConstruction `json:"construction"`
	ConstructionDigest string                           `json:"construction_digest"`
}

// The fault hook is local-test-only; production never exposes a filesystem or
// parent setter. Persisted construction survives every injected stage boundary.
func preparePublicationAt(ctx context.Context, r protocol.PublicationPrepareRequest, dir, root string, fault func(string) error) ([]protocol.PublicationResultPage, error) {
	if e := publicationDirectory(root); e != nil {
		return nil, e
	}
	for _, name := range []string{"operations", "constructions"} {
		if e := publicationDirectory(filepath.Join(root, name)); e != nil {
			return nil, e
		}
	}
	opDir := filepath.Join(root, "operations", r.OperationID)
	constructionDir := filepath.Join(root, "constructions", r.Construction.ConstructionID)
	for _, path := range []string{opDir, constructionDir} {
		if e := publicationDirectory(path); e != nil {
			return nil, e
		}
	}
	lock, e := acquireFileLock(ctx, filepath.Join(constructionDir, "lock"))
	if e != nil {
		return nil, e
	}
	defer releaseFileLock(lock)
	if trustedFile(filepath.Join(constructionDir, "lock"), uint32(os.Geteuid())) != nil {
		return nil, errors.New("publication storage unavailable")
	}
	if e = savePublicationFile(filepath.Join(opDir, "intent.json"), r); e != nil {
		return PublicationFailure(r, "reconciliation_required", "identity_mismatch"), nil
	}
	if raw, e := readPublicationFile(filepath.Join(opDir, "pages.json")); e == nil {
		var pages []protocol.PublicationResultPage
		if json.Unmarshal(raw, &pages) != nil || len(pages) == 0 {
			return nil, errors.New("publication journal unavailable")
		}
		if verifyPublicationSource(ctx, dir, r.Source) != nil {
			return PublicationFailure(r, "reconciliation_required", "identity_mismatch"), nil
		}
		if pages[0].Result.Candidate != nil && verifyPublicationManifest(ctx, dir, *pages[0].Result.Candidate) != nil {
			return PublicationFailure(r, "reconciliation_required", "conflicting_candidate"), nil
		}
		return pages, nil
	} else if !os.IsNotExist(e) {
		return nil, errors.New("publication journal unavailable")
	}
	intent := publicationConstructionIntent{r.Source, r.Construction, r.ConstructionDigest}
	if e = savePublicationFile(filepath.Join(constructionDir, "intent.json"), intent); e != nil {
		return PublicationFailure(r, "reconciliation_required", "conflicting_candidate"), nil
	}
	if fault != nil {
		if e = fault("intent"); e != nil {
			return nil, e
		}
	}
	if e = verifyPublicationSource(ctx, dir, r.Source); e != nil {
		return PublicationFailure(r, "reconciliation_required", "identity_mismatch"), nil
	}
	c := r.Construction
	parents := []string{}
	for _, p := range c.Parents {
		raw, e := resultGit(ctx, dir, 256, "rev-parse", "--verify", p.Commit+"^{commit}")
		if e != nil || strings.TrimSpace(string(raw)) != p.Commit {
			return PublicationFailure(r, "reconciliation_required", "unverified_parent"), nil
		}
		if p.Kind == "target" {
			if _, e = resultGit(ctx, dir, 256, "merge-base", "--is-ancestor", p.Commit, r.Source.GitCommit); e != nil {
				return PublicationFailure(r, "reconciliation_required", "unverified_parent"), nil
			}
		}
		parents = append(parents, p.Commit)
	}
	baseTree, e := resultGit(ctx, dir, 256, "rev-parse", r.Source.BaseCommit+"^{tree}")
	if e != nil {
		return nil, errors.New("publication source unavailable")
	}
	if strings.TrimSpace(string(baseTree)) == r.Source.GitTree {
		pages := PublicationFailure(r, "not_applicable", "no_change")
		if e = savePublicationFile(filepath.Join(opDir, "pages.json"), pages); e != nil {
			return nil, e
		}
		return pages, nil
	}
	head, e := constructPublicationCommit(ctx, dir, c, r.Source.GitTree, parents)
	if e != nil {
		return nil, e
	}
	if fault != nil {
		if e = fault("commit"); e != nil {
			return nil, e
		}
	}
	ref := "refs/monos/candidates/" + c.ConstructionID
	old, e := resultGit(ctx, dir, 256, "rev-parse", "--verify", ref)
	if e == nil && strings.TrimSpace(string(old)) != head {
		return PublicationFailure(r, "reconciliation_required", "conflicting_candidate"), nil
	}
	if e != nil {
		if _, e = publicationMutatingGit(ctx, dir, nil, nil, "update-ref", ref, head, strings.Repeat("0", len(head))); e != nil {
			return PublicationFailure(r, "reconciliation_required", "conflicting_candidate"), nil
		}
	}
	if fault != nil {
		if e = fault("ref"); e != nil {
			return nil, e
		}
	}
	raw, e := resultGit(ctx, dir, 512, "rev-list", "--parents", "-n", "1", head)
	if e != nil || !equalPublicationStrings(strings.Fields(string(raw)), append([]string{head}, parents...)) {
		return PublicationFailure(r, "reconciliation_required", "conflicting_candidate"), nil
	}
	raw, e = resultGit(ctx, dir, 256, "rev-parse", head+"^{tree}")
	if e != nil || strings.TrimSpace(string(raw)) != r.Source.GitTree {
		return PublicationFailure(r, "reconciliation_required", "conflicting_candidate"), nil
	}
	candidate := protocol.PublicationCandidateManifest{SchemaVersion: 1, CandidateID: c.CandidateID, ConstructionID: c.ConstructionID, ConstructionDigest: r.ConstructionDigest, SourceDigest: r.SourceDigest, Head: head, Tree: r.Source.GitTree, Parents: parents}
	if e = savePublicationFile(filepath.Join(constructionDir, "candidate.json"), candidate); e != nil {
		return PublicationFailure(r, "reconciliation_required", "conflicting_candidate"), nil
	}
	if fault != nil {
		if e = fault("manifest"); e != nil {
			return nil, e
		}
	}
	config := r.Configuration
	limits := publicationLimits{int(config.MaxCommits), int(config.MaxPaths), int(config.MaxVersions), int(config.MaxFindings), int(config.MaxEvidenceBytes), config.MaxBlobBytes, config.MaxAggregateBytes, config.LocalBlobLimit, config.ProviderBlobLimit}
	scan := scanPublication(ctx, dir, head, parents, string(config.WorkflowWrite), limits)
	// External cancellation leaves an unfinished intent. The independently
	// bounded processing deadline freezes an incomplete scan over this candidate.
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		scan.Complete = false
		scan.Reason = "interrupted"
	}
	// Interrupted processing remains unfinished: no immutable terminal scan record.
	if errors.Is(ctx.Err(), context.Canceled) {
		return nil, ctx.Err()
	}
	if fault != nil {
		if e = fault("scan"); e != nil {
			return nil, e
		}
	}
	pages, e := publicationPages(r, candidate, scan)
	if e != nil {
		return nil, e
	}
	if e = savePublicationFile(filepath.Join(opDir, "pages.json"), pages); e != nil {
		return nil, e
	}
	if fault != nil {
		if e = fault("result"); e != nil {
			return nil, e
		}
	}
	return pages, nil
}
func constructPublicationCommit(ctx context.Context, dir string, c protocol.PublicationConstruction, tree string, parents []string) (string, error) {
	args := []string{"commit-tree", tree}
	for _, p := range parents {
		args = append(args, "-p", p)
	}
	env := []string{"GIT_AUTHOR_NAME=monos", "GIT_AUTHOR_EMAIL=monos@localhost", "GIT_COMMITTER_NAME=monos", "GIT_COMMITTER_EMAIL=monos@localhost", "GIT_AUTHOR_DATE=" + c.Timestamp, "GIT_COMMITTER_DATE=" + c.Timestamp}
	raw, e := publicationMutatingGit(ctx, dir, env, append([]byte(c.Message), 10), args...)
	if e != nil {
		return "", e
	}
	head := strings.TrimSpace(string(raw))
	if !objectID.MatchString(head) {
		return "", errors.New("publication candidate unavailable")
	}
	return head, nil
}

func publicationMutatingGit(ctx context.Context, dir string, extra []string, input []byte, args ...string) ([]byte, error) {
	parent := ctx
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	fixed := []string{"--no-replace-objects", "--git-dir=" + dir, "-c", "safe.directory=" + dir, "-c", "core.hooksPath=/dev/null", "-c", "core.fsync=loose-object,reference", "-c", "core.fsyncMethod=fsync"}
	cmd := exec.CommandContext(ctx, "/usr/bin/git", append(fixed, args...)...)
	cmd.Env = append(publicationGitEnvironment(), extra...)
	cmd.Stdin = bytes.NewReader(input)
	cmd.Stderr = io.Discard
	out := &boundedOutput{limit: 1024, cancel: cancel}
	cmd.Stdout = out
	if cmd.Run() != nil {
		if parent.Err() != nil {
			return nil, parent.Err()
		}
		return nil, errors.New("publication Git effect unavailable")
	}
	return out.buffer.Bytes(), nil
}
func equalPublicationStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
func PublicationFailure(r protocol.PublicationPrepareRequest, status, reason string) []protocol.PublicationResultPage {
	_, digest, _ := wire.Canonical(r)
	why := protocol.PublicationResultReason(reason)
	result := protocol.PublicationResult{SchemaVersion: 1, OperationID: r.OperationID, RequestDigest: digest, Status: protocol.PublicationResultStatus(status), Reason: &why}
	findings := []protocol.PublicationFinding{}
	_, pd, _ := wire.Canonical(findings)
	return []protocol.PublicationResultPage{{SchemaVersion: 1, Result: result, PageIndex: 0, PageCount: 1, Findings: findings, PageDigest: pd}}
}

// Acknowledgements retain exact settled identity; they do not delete evidence.
func PublicationAck(ack protocol.PublicationACK) error {
	root := filepath.Join(Root, "service", "publication", "operations", ack.OperationID)
	if !ValidID(ack.OperationID) || resultParents(root, uint32(os.Geteuid())) != nil || serviceDirectory(root, true) != nil {
		return errors.New("publication acknowledgement unavailable")
	}
	raw, e := readPublicationFile(filepath.Join(root, "pages.json"))
	if e != nil {
		return errors.New("publication acknowledgement unavailable")
	}
	var pages []protocol.PublicationResultPage
	if json.Unmarshal(raw, &pages) != nil || len(pages) == 0 {
		return errors.New("publication acknowledgement unavailable")
	}
	result := pages[0].Result
	_, digest, e := wire.Canonical(result)
	if e != nil || ack.OperationID != result.OperationID || ack.RequestDigest != result.RequestDigest || ack.ResultDigest != digest {
		return errors.New("publication acknowledgement identity mismatch")
	}
	return savePublicationFile(filepath.Join(root, "ack.json"), ack)
}

func verifyPublicationManifest(ctx context.Context, dir string, c protocol.PublicationCandidateManifest) error {
	for expression, want := range map[string]string{"refs/monos/candidates/" + c.ConstructionID: c.Head, c.Head + "^{tree}": c.Tree} {
		raw, e := resultGit(ctx, dir, 256, "rev-parse", "--verify", expression)
		if e != nil || strings.TrimSpace(string(raw)) != want {
			return errors.New("publication candidate mismatch")
		}
	}
	raw, e := resultGit(ctx, dir, 512, "rev-list", "--parents", "-n", "1", c.Head)
	if e != nil || !equalPublicationStrings(strings.Fields(string(raw)), append([]string{c.Head}, c.Parents...)) {
		return errors.New("publication candidate mismatch")
	}
	return nil
}

// Replay only previously committed pages after Ready. No constructor/scanner or
// Attempt effect is invoked; backend checks exact terminal settlement before ack.
func ReplayPublicationResults(ctx context.Context, emit func(protocol.PublicationResultPage) error) error {
	root := filepath.Join(Root, "service", "publication", "operations")
	if _, e := os.Lstat(root); os.IsNotExist(e) {
		return nil
	}
	return replayPublicationResultsAt(ctx, root, emit)
}
func replayPublicationResultsAt(ctx context.Context, root string, emit func(protocol.PublicationResultPage) error) error {
	if resultParents(root, uint32(os.Geteuid())) != nil || serviceDirectory(root, true) != nil {
		return errors.New("publication replay unavailable")
	}
	directory, e := os.Open(root)
	if e != nil {
		return errors.New("publication replay unavailable")
	}
	defer directory.Close()
	for {
		entries, e := directory.ReadDir(64)
		if e != nil && e != io.EOF {
			return errors.New("publication replay unavailable")
		}
		for _, entry := range entries {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if !entry.IsDir() || !ValidID(entry.Name()) {
				continue
			}
			path := filepath.Join(root, entry.Name())
			if serviceDirectory(path, true) != nil {
				return errors.New("publication replay unavailable")
			}
			raw, e := readPublicationFile(filepath.Join(path, "pages.json"))
			if os.IsNotExist(e) {
				continue
			}
			if e != nil {
				return errors.New("publication replay unavailable")
			}
			var pages []protocol.PublicationResultPage
			if json.Unmarshal(raw, &pages) != nil || len(pages) == 0 {
				return errors.New("publication replay unavailable")
			}
			intentRaw, e := readPublicationFile(filepath.Join(path, "intent.json"))
			if e != nil {
				return errors.New("publication replay unavailable")
			}
			var intent protocol.PublicationPrepareRequest
			if json.Unmarshal(intentRaw, &intent) != nil {
				return errors.New("publication replay unavailable")
			}
			_, requestDigest, e := wire.Canonical(intent)
			if e != nil || pages[0].Result.OperationID != entry.Name() || pages[0].Result.RequestDigest != requestDigest {
				return errors.New("publication replay identity mismatch")
			}
			_, resultDigest, _ := wire.Canonical(pages[0].Result)
			if ackRaw, e := readPublicationFile(filepath.Join(path, "ack.json")); e == nil {
				var ack protocol.PublicationACK
				if json.Unmarshal(ackRaw, &ack) != nil || ack.OperationID != entry.Name() || ack.RequestDigest != requestDigest || ack.ResultDigest != resultDigest {
					return errors.New("publication replay acknowledgement mismatch")
				}
				continue
			} else if !os.IsNotExist(e) {
				return errors.New("publication replay unavailable")
			}
			for n, page := range pages {
				raw, _ := json.Marshal(page)
				_, rd, _ := wire.Canonical(page.Result)
				if wire.Validate("PublicationResultPage", raw) != nil || page.PageIndex != int64(n) || page.PageCount != int64(len(pages)) || rd != resultDigest {
					return errors.New("publication replay page mismatch")
				}
				if e = emit(page); e != nil {
					return e
				}
			}
		}
		if e == io.EOF {
			return nil
		}
	}
}
