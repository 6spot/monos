package control

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

type RepositoryAccessFailure struct {
	Reason protocol.WorkspaceUnavailableReason
}

func (e *RepositoryAccessFailure) Error() string {
	return "repository access unavailable: " + string(e.Reason)
}

// RepositoryAccess is transient service-only data. It is never a command receipt
// and may be requested during connected, not-yet-ready recovery of an admitted open.
func (c *Client) RepositoryAccess(ctx context.Context, op protocol.Operation) (protocol.RepositoryAccessResult, error) {
	var access protocol.RepositoryAccessResult
	if op.Workspace == nil || op.WorkspaceDigest == nil {
		return access, fmt.Errorf("workspace descriptor required")
	}
	c.mu.Lock()
	inc, conn := c.inc, c.conn
	c.mu.Unlock()
	if conn == nil {
		return access, fmt.Errorf("repository access connection unavailable")
	}
	raw, err := json.Marshal(protocol.RepositoryAccessRequest{SchemaVersion: 1, Incarnation: inc, WorkspaceDigest: *op.WorkspaceDigest})
	if err != nil {
		return access, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(c.Config.Endpoint, "/")+"/v1/runner/operations/"+url.PathEscape(op.OperationID)+"/repository-access", bytes.NewReader(raw))
	if err != nil {
		return access, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Cache-Control", "no-store")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return access, fmt.Errorf("repository access unavailable")
	}
	defer resp.Body.Close()
	raw, err = io.ReadAll(io.LimitReader(resp.Body, 16385))
	if err != nil || len(raw) > 16384 {
		return access, fmt.Errorf("repository access exceeds response bound")
	}
	if resp.StatusCode != http.StatusOK {
		failure := protocol.RepositoryAccessError{}
		reason := protocol.OwnershipUnresolved
		if wire.Decode("RepositoryAccessError", raw, &failure) == nil {
			reason = failure.Reason
		}
		return access, &RepositoryAccessFailure{Reason: reason}
	}
	if err = wire.Decode("RepositoryAccessResult", raw, &access); err != nil {
		return protocol.RepositoryAccessResult{}, fmt.Errorf("invalid repository access response")
	}
	if access.OperationID != op.OperationID || access.WorkspaceDigest != *op.WorkspaceDigest || wire.ValidateRepositoryEndpoint(op.Workspace.Resource, access.RemoteURL, access.ProviderMetadata) != nil {
		return protocol.RepositoryAccessResult{}, fmt.Errorf("repository access operation mismatch")
	}
	c.mu.Lock()
	same := c.inc == inc && c.conn == conn
	c.mu.Unlock()
	if !same {
		return protocol.RepositoryAccessResult{}, fmt.Errorf("repository access connection changed")
	}
	return access, nil
}
