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

type InspectionAccessFailure struct {
	Reason protocol.InspectionUnavailableReason
}

func (e *InspectionAccessFailure) Error() string {
	return "inspection repository access unavailable: " + string(e.Reason)
}

// InspectionRepositoryAccess exchanges the frozen inspection identity for
// transient service-only access. Connected recovery does not require Ready;
// credentials never enter command receipts, the journal, or the snapshot.
func (c *Client) InspectionRepositoryAccess(ctx context.Context, op protocol.Operation) (protocol.InspectionRepositoryAccessResult, error) {
	var access protocol.InspectionRepositoryAccessResult
	i := op.Inspection
	if i == nil || op.InspectionDigest == nil || op.Kind != "inspect_repository" || op.ResourceID == nil ||
		i.InspectionID != op.OperationID || i.AttemptID != op.AttemptID || i.DispatchID != op.DispatchID ||
		i.RunnerID != c.Config.RunnerID || i.Resource.ResourceID != *op.ResourceID || i.Origin.Kind != "default_ref" {
		return access, fmt.Errorf("inspection descriptor identity required")
	}
	raw, digest, err := wire.Canonical(i)
	if err != nil || digest != *op.InspectionDigest || wire.Validate("InspectionDescriptor", raw) != nil {
		return access, fmt.Errorf("inspection descriptor mismatch")
	}
	c.mu.Lock()
	inc, conn := c.inc, c.conn
	c.mu.Unlock()
	if conn == nil {
		return access, fmt.Errorf("inspection access connection unavailable")
	}
	raw, err = json.Marshal(protocol.InspectionRepositoryAccessRequest{SchemaVersion: 1, Incarnation: inc, InspectionDigest: digest})
	if err != nil {
		return access, fmt.Errorf("invalid inspection access request")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(c.Config.Endpoint, "/")+"/v1/runner/operations/"+url.PathEscape(op.OperationID)+"/inspection-access", bytes.NewReader(raw))
	if err != nil {
		return access, fmt.Errorf("invalid inspection access endpoint")
	}
	req.Header.Set("Authorization", "Bearer "+c.credential())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Cache-Control", "no-store")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return access, fmt.Errorf("inspection repository access unavailable")
	}
	defer resp.Body.Close()
	raw, err = io.ReadAll(io.LimitReader(resp.Body, 16385))
	if err != nil || len(raw) > 16384 {
		return access, fmt.Errorf("inspection access exceeds response bound")
	}
	if resp.StatusCode != http.StatusOK {
		failure := protocol.InspectionRepositoryAccessError{}
		reason := protocol.InspectionUnavailableReason("resource_unavailable")
		if wire.Decode("InspectionRepositoryAccessError", raw, &failure) == nil {
			reason = failure.Reason
		}
		return access, &InspectionAccessFailure{Reason: reason}
	}
	if err = wire.Decode("InspectionRepositoryAccessResult", raw, &access); err != nil {
		return protocol.InspectionRepositoryAccessResult{}, fmt.Errorf("invalid inspection access response")
	}
	if access.OperationID != op.OperationID || access.InspectionDigest != digest {
		return protocol.InspectionRepositoryAccessResult{}, fmt.Errorf("inspection access operation mismatch")
	}
	if wire.ValidateRepositoryEndpoint(i.Resource, access.RemoteURL, access.ProviderMetadata) != nil {
		return protocol.InspectionRepositoryAccessResult{}, fmt.Errorf("inspection access repository mismatch")
	}
	c.mu.Lock()
	same := c.inc == inc && c.conn == conn
	c.mu.Unlock()
	if !same {
		return protocol.InspectionRepositoryAccessResult{}, fmt.Errorf("inspection access connection changed")
	}
	return access, nil
}
