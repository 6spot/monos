package wire

import (
	"fmt"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"unicode"

	protocol "monos.local/protocol"
)

// HTTPSRepositoryIdentity validates an exact transport endpoint. The returned
// identity may normalize host/suffix; callers must retain remote for Git I/O.
func HTTPSRepositoryIdentity(remote string) (string, error) {
	invalid := func() (string, error) { return "", fmt.Errorf("unsupported HTTPS repository endpoint") }
	if !strings.HasPrefix(remote, "https://") || strings.ContainsAny(remote, "\\%?#") {
		return invalid()
	}
	for _, r := range remote {
		if unicode.IsSpace(r) || r < 32 || r == 127 || r == '\ufeff' {
			return invalid()
		}
	}
	u, err := url.Parse(remote)
	if err != nil || u.Scheme != "https" || u.Opaque != "" || u.User != nil || u.Hostname() == "" || u.Path == "" || u.RawPath != "" || u.EscapedPath() != u.Path || u.RawQuery != "" || u.Fragment != "" {
		return invalid()
	}
	for _, segment := range strings.Split(strings.TrimPrefix(u.Path, "/"), "/") {
		if segment == "" || segment == "." || segment == ".." {
			return invalid()
		}
	}
	host := strings.ToLower(u.Hostname())
	if strings.Contains(host, ":") {
		address, e := netip.ParseAddr(host)
		if e != nil {
			return invalid()
		}
		host = "[" + address.String() + "]"
	}
	if port := u.Port(); port != "" {
		value, err := strconv.Atoi(port)
		if err != nil || value < 0 || value > 65535 {
			return invalid()
		}
		if value != 443 {
			host += ":" + strconv.Itoa(value)
		}
	}
	path := strings.TrimPrefix(u.Path, "/")
	if strings.HasSuffix(strings.ToLower(path), ".git") {
		path = path[:len(path)-4]
	}
	if path == "" {
		return invalid()
	}
	if host == "github.com" {
		if len(strings.Split(path, "/")) != 2 {
			return invalid()
		}
		for _, r := range path {
			if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("/_.-", r)) {
				return invalid()
			}
		}
		path = strings.ToLower(path)
	}
	return host + "/" + path, nil
}

func SameRepositoryProvider(a, b *protocol.RepositoryProviderMetadata) bool {
	if a == nil || a.Github == nil {
		return b == nil || b.Github == nil
	}
	return b != nil && b.Github != nil && a.Github.RepositoryID == b.Github.RepositoryID
}

// ValidateRepositoryEndpoint permits verified GitHub aliases and requires exact
// saved endpoints for plain Git. Empty metadata is a real provider-neutral value.
func ValidateRepositoryEndpoint(resource protocol.WorkspaceResource, remote string, provider protocol.RepositoryProviderMetadata) error {
	identity, err := HTTPSRepositoryIdentity(remote)
	if err != nil || identity != resource.RepositoryIdentity {
		return fmt.Errorf("repository endpoint identity mismatch")
	}
	if strings.HasPrefix(identity, "github.com/") {
		if provider.Github == nil || !strings.EqualFold(remote, "https://"+identity+".git") || resource.ProviderMetadata != nil && resource.ProviderMetadata.Github != nil && !SameRepositoryProvider(resource.ProviderMetadata, &provider) {
			return fmt.Errorf("GitHub repository provider mismatch")
		}
	} else if remote != resource.RemoteURL || provider.Github != nil || resource.ProviderMetadata != nil && resource.ProviderMetadata.Github != nil {
		return fmt.Errorf("plain repository endpoint mismatch")
	}
	return nil
}
