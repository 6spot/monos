package control

import (
	"fmt"
	"strings"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/enrollment/storage"
	"monos.local/runner/internal/wire"
)

func (c *Client) credential() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.token
}

// Reload only at the next authenticated connection. A different Runner ID is
// never adopted by an existing daemon or its execution journal.
func (c *Client) reloadCredential() error {
	if c.Config.TokenFile == "" {
		return fmt.Errorf("Runner credential path is missing")
	}
	raw, err := storage.Read(c.Config.TokenFile, 4096, true)
	if err != nil {
		return fmt.Errorf("Runner credential unavailable or unsafe")
	}
	token := strings.TrimSpace(string(raw))
	if c.identityFile {
		var identity protocol.RunnerCredential
		if wire.Decode("RunnerCredential", raw, &identity) != nil || identity.RunnerID != c.Config.RunnerID {
			return fmt.Errorf("Runner identity changed; original execution ownership retained")
		}
		token = identity.Credential
	}
	if len(token) < 16 {
		return fmt.Errorf("Runner credential is invalid")
	}
	c.mu.Lock()
	c.token = token
	c.mu.Unlock()
	return nil
}
