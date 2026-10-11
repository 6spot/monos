package host

import (
	"encoding/base64"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

// Access is transient service state. The expiry bounds local use even when the
// upstream password itself has no expiry.
func repositoryCredentials(remote string, a protocol.RepositoryAuthentication, remaining time.Duration) (string, string, error) {
	fail := func() (string, string, error) { return "", "", errors.New("repository credentials unavailable") }
	identity, e := wire.HTTPSRepositoryIdentity(remote)
	raw, _, ce := wire.Canonical(a)
	if e != nil || ce != nil || wire.Validate("RepositoryAuthentication", raw) != nil {
		return fail()
	}
	if a.Kind == "anonymous" {
		return "", "", nil
	}
	if a.Token == nil || a.ExpiresAt == nil || !utf8.ValidString(*a.Token) {
		return fail()
	}
	expires, e := time.Parse(time.RFC3339Nano, *a.ExpiresAt)
	if e != nil || !expires.After(time.Now().Add(remaining)) || strings.ContainsAny(*a.Token, "\x00\r\n") {
		return fail()
	}
	if a.Kind == "github_installation" && strings.HasPrefix(identity, "github.com/") && len(*a.Token) >= 16 && len(*a.Token) <= 16384 {
		return "x-access-token", *a.Token, nil
	}
	if a.Kind == "https_basic" && !strings.HasPrefix(identity, "github.com/") && a.Username != nil && utf8.ValidString(*a.Username) && len(*a.Username) > 0 && utf8.RuneCountInString(*a.Username) <= 256 && len(*a.Token) > 0 && len(*a.Token) <= 4096 && !strings.ContainsAny(*a.Username, ":\x00\r\n") {
		return *a.Username, *a.Token, nil
	}
	return fail()
}

func repositoryAccessEnvironment(remote string, a protocol.RepositoryAuthentication) ([]string, error) {
	username, token, e := repositoryCredentials(remote, a, 0)
	if e != nil {
		return nil, e
	}
	env := []string{"HOME=/nonexistent", "GIT_ASKPASS=/dev/null", "SSH_ASKPASS=/dev/null", "GIT_CONFIG_COUNT=4", "GIT_CONFIG_KEY_0=credential.helper", "GIT_CONFIG_VALUE_0=", "GIT_CONFIG_KEY_1=http.followRedirects", "GIT_CONFIG_VALUE_1=false", "GIT_CONFIG_KEY_2=protocol.allow", "GIT_CONFIG_VALUE_2=never", "GIT_CONFIG_KEY_3=http.proxy", "GIT_CONFIG_VALUE_3="}
	if a.Kind != "anonymous" {
		env[3] = "GIT_CONFIG_COUNT=5"
		header := "AUTHORIZATION: basic " + base64.StdEncoding.EncodeToString([]byte(username+":"+token))
		env = append(env, "GIT_CONFIG_KEY_4=http."+remote+".extraHeader", "GIT_CONFIG_VALUE_4="+header)
	}
	return env, nil
}
