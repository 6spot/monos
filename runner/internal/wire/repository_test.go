package wire

import (
	"testing"

	protocol "monos.local/protocol"
)

func TestHTTPSRepositoryEndpointIsExactAndProviderBound(t *testing.T) {
	resource := protocol.WorkspaceResource{RepositoryIdentity: "git.example:8443/Team/Repo", RemoteURL: "https://Git.Example:8443/Team/Repo.git"}
	if err := ValidateRepositoryEndpoint(resource, resource.RemoteURL, protocol.RepositoryProviderMetadata{}); err != nil {
		t.Fatal(err)
	}
	for _, remote := range []string{"https://git.example:8443/Team/Repo.git", "https://Git.Example:8443/team/Repo.git", "https://Git.Example:8443/Team/Repo", "https://Git.Example/Team/Repo.git"} {
		if ValidateRepositoryEndpoint(resource, remote, protocol.RepositoryProviderMetadata{}) == nil {
			t.Fatalf("accepted changed exact endpoint %q", remote)
		}
	}
	github := protocol.RepositoryProviderMetadata{Github: &protocol.GithubClass{RepositoryID: "42"}}
	if ValidateRepositoryEndpoint(resource, resource.RemoteURL, github) == nil {
		t.Fatal("accepted GitHub metadata for plain Git")
	}
	resource = protocol.WorkspaceResource{RepositoryIdentity: "github.com/team/repo", RemoteURL: "git@github.com:Team/Repo.git", ProviderMetadata: &github}
	if err := ValidateRepositoryEndpoint(resource, "https://github.com/Team/Repo.git", github); err != nil {
		t.Fatal(err)
	}
	if ValidateRepositoryEndpoint(resource, "https://github.com/Team/Repo.git", protocol.RepositoryProviderMetadata{}) == nil {
		t.Fatal("GitHub alias accepted without verified provider identity")
	}
}

func TestHTTPSRepositoryEndpointRejectsAmbiguousTransport(t *testing.T) {
	for _, remote := range []string{"http://example/repo", "ssh://git@example/repo", "/local/repo", "https://user:token@example/repo", "https://example/repo?", "https://example/repo#", "https://example/a%2frepo", "https://example/a\\repo", "https://example/a/../repo", "https://example/a/./repo", "https://example//repo", "https://example/repo/", "https://example/repo\n", "https://example/repo\u007f", "https://example/repo\ufeff", "https://example:65536/repo"} {
		if _, err := HTTPSRepositoryIdentity(remote); err == nil {
			t.Fatalf("accepted unsupported endpoint %q", remote)
		}
	}
}
