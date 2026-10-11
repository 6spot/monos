package host

import (
	"errors"
	"path/filepath"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func publicationDigest(v any) string {
	_, d, e := wire.Canonical(v)
	if e != nil {
		return ""
	}
	return d
}

func publicationProofScope(p protocol.PublicationPublishedProof, s protocol.ResultReadIdentity) bool {
	return p.TaskID == s.TaskID && p.ResourceID == s.ResourceID && p.RunnerID == s.RunnerID && p.StorageID == s.StorageID && p.RepositoryIdentity == s.RepositoryIdentity && p.CandidateManifestDigest == publicationDigest(p.Candidate) && p.ObservationDigest == publicationDigest(p.Observation) && p.Observation.Head != nil && *p.Observation.Head == p.Candidate.Head && p.Observation.OperationID == p.OperationID && p.Observation.ItemID == p.ItemID && p.Observation.TaskID == p.TaskID && p.Observation.ResourceID == p.ResourceID && p.Observation.RunnerID == p.RunnerID && p.Observation.StorageID == p.StorageID && p.Observation.RepositoryIdentity == p.RepositoryIdentity && wire.SameRepositoryProvider(&p.Observation.ProviderMetadata, &p.ProviderMetadata) && p.Observation.DeliveryRef == p.DeliveryRef
}

func validatePublicationPermissionFacts(p protocol.PublicationPermissionProof, s protocol.ResultReadIdentity, fingerprint string) error {
	raw, _, e := wire.Canonical(p)
	if e != nil || wire.Validate("PublicationPermissionProof", raw) != nil || p.ResourceID != s.ResourceID || p.RepositoryIdentity != s.RepositoryIdentity || p.PermissionFingerprint != fingerprint || p.PermissionFingerprint != publicationPermissionFingerprint(p) {
		return errors.New("publication permission mismatch")
	}
	observed, oe := time.Parse(time.RFC3339Nano, p.ObservedAt)
	expires, ee := time.Parse(time.RFC3339Nano, p.ExpiresAt)
	now := time.Now()
	if oe != nil || ee != nil || observed.After(now.Add(time.Minute)) || !expires.After(observed) {
		return errors.New("publication permission expired")
	}
	return nil
}

func validatePublicationPermissionProof(p protocol.PublicationPermissionProof, s protocol.ResultReadIdentity, fingerprint string) error {
	if validatePublicationPermissionFacts(p, s, fingerprint) != nil {
		return errors.New("publication permission mismatch")
	}
	expires, e := time.Parse(time.RFC3339Nano, p.ExpiresAt)
	if e != nil || !expires.After(time.Now().Add(30*time.Second)) {
		return errors.New("publication permission expired")
	}
	return nil
}

func ValidatePublicationPermission(r protocol.PublicationPrepareRequest) error {
	if r.PermissionProof == nil || r.PermissionProofDigest == nil || *r.PermissionProofDigest != publicationDigest(*r.PermissionProof) || validatePublicationPermissionFacts(*r.PermissionProof, r.Source, r.Configuration.PermissionFingerprint) != nil {
		return errors.New("publication permission unavailable")
	}
	if r.PermissionProof.Kind == "git_https_configuration" {
		if r.Configuration.WorkflowWrite != "not_applicable" || r.Configuration.ProviderBlobLimit != nil {
			return errors.New("publication provider configuration mismatch")
		}
		return nil
	}
	if r.Configuration.WorkflowWrite == "not_applicable" || r.Configuration.ProviderBlobLimit == nil {
		return errors.New("publication provider configuration mismatch")
	}
	allowed := r.PermissionProof.Permissions != nil && r.PermissionProof.Permissions.Workflows != nil && *r.PermissionProof.Permissions.Workflows == "write"
	if (r.Configuration.WorkflowWrite == "allowed") != allowed {
		return errors.New("publication permission mismatch")
	}
	return nil
}

// Safe authenticated facts only. Tokens never enter this journal.
func RetainPublicationPermission(r protocol.PublicationPrepareRequest, response protocol.PublicationPermissionResult) error {
	if response.OperationID != r.OperationID || response.RequestDigest != publicationDigest(r) || response.ProofDigest != publicationDigest(response.Proof) || validatePublicationPermissionProof(response.Proof, r.Source, response.Proof.PermissionFingerprint) != nil {
		return errors.New("publication permission mismatch")
	}
	root := filepath.Join(Root, "service", "publication")
	if publicationDirectory(root) != nil || publicationDirectory(filepath.Join(root, "permissions")) != nil {
		return errors.New("publication permission unavailable")
	}
	if e := savePublicationFile(filepath.Join(root, "permissions", response.ProofDigest+".json"), response.Proof); e != nil {
		return e
	}
	if r.PermissionProof != nil {
		p := *r.PermissionProof
		fresh := response.Proof
		if r.PermissionProofDigest == nil || *r.PermissionProofDigest != publicationDigest(p) || !samePublicationPermissionScope(p, fresh) || ValidatePublicationPermission(r) != nil {
			return errors.New("publication permission mismatch")
		}
		return savePublicationFile(filepath.Join(root, "permissions", *r.PermissionProofDigest+".json"), p)
	}
	return nil
}

func VerifyRetainedPublicationPermission(r protocol.PublicationPrepareRequest) error {
	if ValidatePublicationPermission(r) != nil {
		return errors.New("publication permission unavailable")
	}
	raw, e := readPublicationFile(filepath.Join(Root, "service", "publication", "permissions", *r.PermissionProofDigest+".json"))
	if e != nil {
		return e
	}
	if string(raw) != string(mustPublicationCanonical(*r.PermissionProof)) {
		return errors.New("publication permission mismatch")
	}
	return nil
}

func mustPublicationCanonical(v any) []byte { raw, _, _ := wire.Canonical(v); return raw }

func publicationPermissionFingerprint(p protocol.PublicationPermissionProof) string {
	if p.Kind == "git_https_configuration" {
		return publicationDigest(map[string]any{"kind": p.Kind, "scope_digest": p.ScopeDigest})
	}
	return publicationDigest(map[string]any{"configuration_fingerprint": p.ConfigurationFingerprint, "repository_id": p.RepositoryID, "permissions": p.Permissions})
}

func samePublicationPermissionScope(a, b protocol.PublicationPermissionProof) bool {
	if a.Kind != b.Kind || a.ResourceID != b.ResourceID || a.RepositoryIdentity != b.RepositoryIdentity || a.PermissionFingerprint != b.PermissionFingerprint {
		return false
	}
	if a.Kind == "git_https_configuration" {
		return equalPublicationHead(a.ScopeDigest, b.ScopeDigest) && equalPublicationHead(a.RemoteURL, b.RemoteURL) && equalPublicationHead(a.Username, b.Username)
	}
	return a.ConfigurationFingerprint == b.ConfigurationFingerprint && equalPublicationHead(a.AppID, b.AppID) && equalPublicationHead(a.InstallationID, b.InstallationID) && equalPublicationHead(a.KeyFingerprint, b.KeyFingerprint) && equalPublicationHead(a.RepositoryID, b.RepositoryID)
}

func publicationPermissionProvider(p protocol.PublicationPermissionProof, provider *protocol.RepositoryProviderMetadata) bool {
	if p.Kind == "git_https_configuration" {
		return provider != nil && provider.Github == nil
	}
	return p.Kind == "github_installation" && p.RepositoryID != nil && provider != nil && provider.Github != nil && *p.RepositoryID == provider.Github.RepositoryID
}

func publicationPermissionEndpoint(p protocol.PublicationPermissionProof, remote string, provider protocol.RepositoryProviderMetadata) bool {
	if !publicationPermissionProvider(p, &provider) {
		return false
	}
	resource := protocol.WorkspaceResource{RepositoryIdentity: p.RepositoryIdentity, RemoteURL: remote, ProviderMetadata: &provider}
	if wire.ValidateRepositoryEndpoint(resource, remote, provider) != nil {
		return false
	}
	return p.Kind != "git_https_configuration" || p.RemoteURL != nil && *p.RemoteURL == remote
}
