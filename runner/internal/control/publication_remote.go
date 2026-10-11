package control

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

// This typed scheduling error preserves an admitted operation when the exact
// provider wait exceeds its remaining execution budget. It carries no grant.
type PublicationSchedulingWaitError struct{ RetryAfter time.Duration }

func (*PublicationSchedulingWaitError) Error() string                          { return "publication provider scheduling wait" }
func (e *PublicationSchedulingWaitError) PublicationRetryAfter() time.Duration { return e.RetryAfter }

// Only current authenticated service connections can acquire transient grants.
// No returned credential is sent on WSS or exposed through the Agent protocol.
func (c *Client) publicationPost(ctx context.Context, path, name string, payload func(int64) any, out any) error {
	c.mu.Lock()
	inc, connected := c.inc, c.conn != nil && c.ready
	c.mu.Unlock()
	if !connected {
		return errors.New("publication connection unavailable")
	}
	raw, e := json.Marshal(payload(inc))
	if e != nil || len(raw) > 16384 {
		return errors.New("publication request unavailable")
	}
	ctx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()
	for {
		c.mu.Lock()
		same := c.inc == inc && c.conn != nil && c.ready
		c.mu.Unlock()
		if !same {
			return errors.New("publication connection changed")
		}
		requestCtx, requestCancel := context.WithTimeout(ctx, 10*time.Second)
		req, e := http.NewRequestWithContext(requestCtx, http.MethodPost, strings.TrimRight(c.Config.Endpoint, "/")+path, bytes.NewReader(raw))
		if e != nil {
			requestCancel()
			return errors.New("publication request unavailable")
		}
		req.Header.Set("Authorization", "Bearer "+c.credential())
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Cache-Control", "no-store")
		resp, e := c.HTTP.Do(req)
		if e != nil {
			requestCancel()
			return errors.New("publication access unavailable")
		}
		response, e := io.ReadAll(io.LimitReader(resp.Body, 16385))
		_ = resp.Body.Close()
		requestCancel()
		if e != nil || len(response) > 16384 || !strings.Contains(strings.ToLower(resp.Header.Get("Cache-Control")), "no-store") {
			return errors.New("publication access unavailable")
		}
		if resp.StatusCode == http.StatusTooManyRequests {
			var result protocol.CommandResult
			if wire.Decode("CommandResult", response, &result) == nil && result.Status == "error" && result.Error != nil && result.Error.Code == "rate_limited" {
				wait := &PublicationSchedulingWaitError{}
				seconds, e := strconv.ParseInt(resp.Header.Get("Retry-After"), 10, 64)
				if e != nil || seconds < 1 || seconds > 86400 {
					return wait
				}
				wait.RetryAfter = time.Duration(seconds) * time.Second
				deadline, _ := ctx.Deadline()
				if wait.RetryAfter >= time.Until(deadline) {
					return wait
				}
				timer := time.NewTimer(wait.RetryAfter)
				select {
				case <-ctx.Done():
					timer.Stop()
					return wait
				case <-timer.C:
					continue
				}
			}
		}
		if resp.StatusCode != http.StatusOK {
			return errors.New("publication access unavailable")
		}
		if wire.Decode(name, response, out) != nil {
			return errors.New("publication response unavailable")
		}
		c.mu.Lock()
		same = c.inc == inc && c.conn != nil && c.ready
		c.mu.Unlock()
		if !same {
			return errors.New("publication connection changed")
		}
		return nil
	}
}

func (c *Client) PublicationPermission(ctx context.Context, r protocol.PublicationPrepareRequest) (protocol.PublicationPermissionResult, error) {
	var result protocol.PublicationPermissionResult
	_, digest, e := wire.Canonical(r)
	if e != nil {
		return result, e
	}
	e = c.publicationPost(ctx, "/v1/runner/publication-operations/"+url.PathEscape(r.OperationID)+"/permission", "PublicationPermissionResult", func(inc int64) any {
		return protocol.PublicationPermissionRequest{SchemaVersion: 1, Incarnation: inc, RequestDigest: digest}
	}, &result)
	if e != nil {
		return protocol.PublicationPermissionResult{}, e
	}
	if result.OperationID != r.OperationID || result.RequestDigest != digest {
		return protocol.PublicationPermissionResult{}, errors.New("publication permission mismatch")
	}
	return result, e
}

func (c *Client) PublicationAccess(ctx context.Context, r protocol.PublicationPushRequest, purpose protocol.PublicationAccessRequestPurpose, attempt string) (protocol.PublicationAccessResult, error) {
	var result protocol.PublicationAccessResult
	_, digest, e := wire.Canonical(r)
	if e != nil {
		return result, e
	}
	e = c.publicationPost(ctx, "/v1/runner/remote-preparation/"+url.PathEscape(r.OperationID)+"/access", "PublicationAccessResult", func(inc int64) any {
		return protocol.PublicationAccessRequest{SchemaVersion: 1, Incarnation: inc, RequestDigest: digest, Purpose: purpose, AttemptID: attempt}
	}, &result)
	if e != nil {
		return protocol.PublicationAccessResult{}, e
	}
	if result.OperationID != r.OperationID || result.RequestDigest != digest || result.ItemID != r.ItemID || result.AttemptID != attempt || result.Purpose != purpose || result.RemoteURL != r.RemoteURL || !wire.SameRepositoryProvider(&result.ProviderMetadata, &r.ProviderMetadata) || result.DeliveryRef != r.DeliveryRef || r.Prepared.Candidate == nil || result.CandidateHead != r.Prepared.Candidate.Head || !reflectPublicationHead(result.ExpectedHead, r.ExpectedHead) {
		return protocol.PublicationAccessResult{}, errors.New("publication access mismatch")
	}
	return result, e
}
func reflectPublicationHead(a, b *string) bool {
	return a == nil && b == nil || a != nil && b != nil && *a == *b
}
