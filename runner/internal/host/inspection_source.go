package host

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func (s *inspectionSession) origin(ctx context.Context) (string, string, string, error) {
	i := s.operation.Inspection
	o := i.Origin
	var source, commit, tree, ref string
	switch string(o.Kind) {
	case "task_completion":
		if o.Identity == nil || o.Identity.StorageID != s.record.StorageID || o.Identity.RepositoryIdentity != i.Resource.RepositoryIdentity || o.Identity.ResourceID != i.Resource.ResourceID || o.Identity.TaskID != i.ScopeID || o.Identity.RunnerID != i.RunnerID {
			return "", "", "", inspectionFailed("repository_mismatch")
		}
		var unavailable string
		export := s.resultExport
		if export == nil {
			export = trustedResultExport
		}
		source, unavailable = export(*o.Identity)
		if unavailable != "" {
			return "", "", "", inspectionFailed("revision_unavailable")
		}
		commit, tree, ref = o.Identity.GitCommit, o.Identity.GitTree, "refs/monos/result"
	case "task_open":
		if o.Workspace == nil || o.Metadata == nil || o.OperationID == nil || o.WorkspaceDigest == nil {
			return "", "", "", inspectionFailed("revision_unavailable")
		}
		w, m := o.Workspace, o.Metadata
		if w.Basis != nil || w.Transfer != nil || m.Checkpoint != nil || m.BaseCommit != m.FinalizedCommit || w.OpenOperationID != *o.OperationID || w.Resource.ResourceID != i.Resource.ResourceID || w.TaskID != i.ScopeID || w.ProjectID != i.ProjectID || w.RunnerID != i.RunnerID || m.StorageID != s.record.StorageID || m.RepositoryIdentity != i.Resource.RepositoryIdentity {
			return "", "", "", inspectionFailed("repository_mismatch")
		}
		source = filepath.Join(s.root, "cache", "resources", i.Resource.ResourceID+".git")
		if resultParents(source, uint32(os.Geteuid())) != nil || serviceDirectory(source, false) != nil {
			return "", "", "", inspectionFailed("revision_unavailable")
		}
		pinFile := filepath.Join(s.root, "service", "workspace-operations", *o.OperationID+".json")
		if resultParents(filepath.Dir(pinFile), uint32(os.Geteuid())) != nil {
			return "", "", "", inspectionFailed("revision_unavailable")
		}
		var pin struct {
			Digest   string                     `json:"digest"`
			Complete bool                       `json:"complete"`
			Metadata protocol.WorkspaceMetadata `json:"metadata"`
		}
		raw, err := os.ReadFile(pinFile)
		if err != nil || trustedFile(pinFile, uint32(os.Geteuid())) != nil || json.Unmarshal(raw, &pin) != nil || !pin.Complete || pin.Digest != *o.WorkspaceDigest || pin.Metadata.BaseCommit != m.BaseCommit || pin.Metadata.FinalizedCommit != m.BaseCommit || pin.Metadata.RepositoryIdentity != m.RepositoryIdentity {
			return "", "", "", inspectionFailed("revision_unavailable")
		}
		commit, ref = m.BaseCommit, "refs/monos/pins/"+*o.OperationID+"/base"
	default:
		return "", "", "", inspectionFailed("revision_unavailable")
	}
	actual, err := s.git(ctx, source, nil, "rev-parse", "--verify", ref+"^{commit}")
	if err != nil {
		return "", "", "", err
	}
	if actual != commit {
		return "", "", "", inspectionFailed("revision_unavailable")
	}
	actualTree, err := s.git(ctx, source, nil, "rev-parse", "--verify", commit+"^{tree}")
	if err != nil {
		return "", "", "", err
	}
	if tree != "" && actualTree != tree {
		return "", "", "", inspectionFailed("revision_unavailable")
	}
	return source, commit, actualTree, nil
}

func (s *inspectionSession) fetch(ctx context.Context, access InspectionAccess) (string, string, string, error) {
	repo := filepath.Join(s.private(), "repository.git")
	if err := inspectionDirectory(repo, 0700); err != nil {
		return "", "", "", err
	}
	if _, err := os.Lstat(filepath.Join(repo, "HEAD")); os.IsNotExist(err) {
		if _, err = s.git(ctx, repo, nil, "init", "--bare", "--quiet", repo); err != nil {
			return "", "", "", err
		}
	} else if err != nil {
		return "", "", "", err
	}
	ref := "refs/monos/inspection/" + s.operation.OperationID
	// The atomic Git ref is the first successful fetch's durable pin. Retrying
	// after that fetch but before record fsync cannot select the moved remote.
	if commit, err := s.git(ctx, repo, nil, "rev-parse", "--verify", ref+"^{commit}"); err == nil {
		if s.record.Commit != "" && s.record.Commit != commit {
			return "", "", "", inspectionFailed("revision_unavailable")
		}
		tree, err := s.git(ctx, repo, nil, "rev-parse", "--verify", commit+"^{tree}")
		return repo, commit, tree, err
	} else if s.record.WorkerActive || ctx.Err() != nil {
		return "", "", "", err
	}
	if s.record.Commit != "" {
		return "", "", "", inspectionFailed("revision_unavailable")
	}
	if access == nil {
		return "", "", "", inspectionFailed("access_denied")
	}
	a, err := access(ctx, s.operation)
	if err != nil {
		return "", "", "", inspectionFailed(inspectionReason(err))
	}
	env, err := inspectionAccessEnvironment(s.operation, a)
	if err != nil {
		return "", "", "", err
	}
	if s.record.Ref == "" {
		s.record.Ref = a.DefaultBranch
		if r := s.operation.Inspection.Resource; r.DefaultBranch != nil {
			s.record.Ref = *r.DefaultBranch
		}
		if r := s.operation.Inspection.Resource; r.DefaultRef != nil {
			s.record.Ref = *r.DefaultRef
		}
		if s.record.Ref == "" || strings.HasPrefix(s.record.Ref, "-") {
			return "", "", "", inspectionFailed("ref_unavailable")
		}
		if s.save() != nil {
			return "", "", "", ErrInspectionUnresolved
		}
	}
	remote := func(args ...string) (string, error) {
		if _, _, e := repositoryCredentials(a.RemoteURL, a.Authentication, 0); e != nil {
			return "", inspectionFailed("access_denied")
		}
		if s.remoteGit != nil {
			return s.remoteGit(ctx, repo, env, args...)
		}
		return s.git(ctx, repo, env, append([]string{"-c", "protocol.https.allow=always", "-c", "protocol.file.allow=never", "-c", "http.followRedirects=false", "-c", "http.sslVerify=true", "-c", "http.lowSpeedLimit=1", "-c", "http.lowSpeedTime=20"}, args...)...)
	}
	source := s.record.Ref
	if !strings.HasPrefix(source, "refs/") && !objectID.MatchString(source) {
		out, err := remote("ls-remote", "--refs", a.RemoteURL, "refs/heads/"+source, "refs/tags/"+source)
		if err != nil {
			return "", "", "", err
		}
		fields := strings.Fields(out)
		if len(fields) != 2 || !objectID.MatchString(fields[0]) {
			return "", "", "", inspectionFailed("ref_unavailable")
		}
		source = fields[1]
	}
	if _, err := remote("fetch", "--no-tags", "--no-recurse-submodules", "--", a.RemoteURL, source+":"+ref); err != nil {
		if s.record.WorkerActive || ctx.Err() != nil {
			return "", "", "", err
		}
		return "", "", "", inspectionFailed("ref_unavailable")
	}
	commit, err := s.git(ctx, repo, nil, "rev-parse", "--verify", ref+"^{commit}")
	if err != nil {
		return "", "", "", err
	}
	tree, err := s.git(ctx, repo, nil, "rev-parse", "--verify", commit+"^{tree}")
	return repo, commit, tree, err
}

func inspectionAccessEnvironment(op protocol.Operation, a protocol.InspectionRepositoryAccessResult) ([]string, error) {
	if op.Inspection == nil || op.InspectionDigest == nil || a.OperationID != op.OperationID || a.InspectionDigest != *op.InspectionDigest || wire.ValidateRepositoryEndpoint(op.Inspection.Resource, a.RemoteURL, a.ProviderMetadata) != nil {
		return nil, inspectionFailed("repository_mismatch")
	}
	env, err := repositoryAccessEnvironment(a.RemoteURL, a.Authentication)
	if err != nil {
		return nil, inspectionFailed("access_denied")
	}
	return env, nil
}
