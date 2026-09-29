package control

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"reflect"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

type Config struct {
	Endpoint     string `json:"endpoint"`
	CAFile       string `json:"ca_file"`
	TokenFile    string `json:"token_file"`
	RunnerID     string `json:"runner_id"`
	Journal      string `json:"journal"`
	Socket       string `json:"socket"`
	ExecutionUID uint32 `json:"execution_uid"`
}
type Client struct {
	Config  Config
	HTTP    *http.Client
	token   string
	mu      sync.Mutex
	conn    *websocket.Conn
	inc     int64
	ready   bool
	pending map[string]chan protocol.Frame
}

type HTTPError struct{ Status int }

func (e *HTTPError) Error() string { return fmt.Sprintf("Runner read denied: HTTP %d", e.Status) }

var errSnapshotChanged = errors.New("inventory snapshot changed")

func New(c Config) (*Client, error) {
	parsed, err := url.Parse(c.Endpoint)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, fmt.Errorf("verified HTTPS endpoint required")
	}
	pool := x509.NewCertPool()
	ca, err := os.ReadFile(c.CAFile)
	if err != nil {
		return nil, err
	}
	if !pool.AppendCertsFromPEM(ca) {
		return nil, fmt.Errorf("invalid CA")
	}
	token, err := os.ReadFile(c.TokenFile)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(c.TokenFile)
	if err != nil {
		return nil, err
	}
	if info.Mode().Perm()&0077 != 0 {
		return nil, fmt.Errorf("Runner credential file must be private")
	}
	if len(strings.TrimSpace(string(token))) < 16 {
		return nil, fmt.Errorf("missing Runner credential")
	}
	transport := &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}}
	return &Client{Config: c, HTTP: &http.Client{Transport: transport, Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, token: strings.TrimSpace(string(token)), pending: map[string]chan protocol.Frame{}}, nil
}
func (c *Client) Get(ctx context.Context, path, name string, out any) error {
	request, err := http.NewRequestWithContext(ctx, "GET", strings.TrimRight(c.Config.Endpoint, "/")+path, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+c.token)
	response, err := c.HTTP.Do(request)
	if err != nil {
		return fmt.Errorf("Runner recovery read unavailable")
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, wire.Limit+1))
	if err != nil {
		return err
	}
	if response.StatusCode != http.StatusOK {
		return &HTTPError{Status: response.StatusCode}
	}
	return wire.Decode(name, raw, out)
}

// Inventory returns only a complete, internally consistent snapshot. Partial
// pages never reach reconciliation and cannot release retained ownership.
func (c *Client) Inventory(ctx context.Context) (protocol.RunnerInventory, error) {
	for attempt := 0; attempt < 3; attempt++ {
		inventory, err := c.inventoryOnce(ctx)
		if err == nil {
			return inventory, nil
		}
		var httpError *HTTPError
		if !errors.Is(err, errSnapshotChanged) && !(errors.As(err, &httpError) && httpError.Status == http.StatusConflict) {
			return protocol.RunnerInventory{}, err
		}
	}
	return protocol.RunnerInventory{}, fmt.Errorf("inventory changed repeatedly; reconciliation retained for reconnect")
}
func (c *Client) inventoryOnce(ctx context.Context) (protocol.RunnerInventory, error) {
	merged := protocol.RunnerInventory{SchemaVersion: 1, Dispatches: []protocol.Dispatch{}, Operations: []protocol.Operation{}}
	dispatches := map[string]protocol.Dispatch{}
	operations := map[string]protocol.Operation{}
	cursors := map[string]bool{}
	cursor := ""
	bytesRead := 0
	for pageNumber := 0; pageNumber < 256; pageNumber++ {
		path := "/v1/runner/inventory"
		if cursor != "" {
			query := url.Values{}
			query.Set("after", cursor)
			query.Set("snapshot_id", merged.SnapshotID)
			path += "?" + query.Encode()
		}
		var page protocol.RunnerInventory
		if err := c.Get(ctx, path, "RunnerInventory", &page); err != nil {
			return protocol.RunnerInventory{}, err
		}
		if merged.SnapshotID == "" {
			merged.SnapshotID = page.SnapshotID
		} else if merged.SnapshotID != page.SnapshotID {
			return protocol.RunnerInventory{}, errSnapshotChanged
		}
		raw, _ := json.Marshal(page)
		bytesRead += len(raw)
		if bytesRead > 64<<20 {
			return protocol.RunnerInventory{}, fmt.Errorf("inventory exceeds bounded recovery memory; ownership retained")
		}
		for _, dispatch := range page.Dispatches {
			if dispatch.RunnerID != c.Config.RunnerID {
				return protocol.RunnerInventory{}, fmt.Errorf("inventory Runner scope mismatch")
			}
			if old, ok := dispatches[dispatch.AttemptID]; ok {
				if !reflect.DeepEqual(old, dispatch) {
					return protocol.RunnerInventory{}, fmt.Errorf("conflicting duplicate inventory dispatch")
				}
				continue
			}
			dispatches[dispatch.AttemptID] = dispatch
			merged.Dispatches = append(merged.Dispatches, dispatch)
		}
		for _, operation := range page.Operations {
			if old, ok := operations[operation.OperationID]; ok {
				if !reflect.DeepEqual(old, operation) {
					return protocol.RunnerInventory{}, fmt.Errorf("conflicting duplicate inventory operation")
				}
				continue
			}
			operations[operation.OperationID] = operation
			merged.Operations = append(merged.Operations, operation)
		}
		if page.NextCursor == nil {
			for _, operation := range merged.Operations {
				dispatch, ok := dispatches[operation.AttemptID]
				if !ok || dispatch.DispatchID != operation.DispatchID {
					return protocol.RunnerInventory{}, fmt.Errorf("inventory operation has no matching dispatch")
				}
			}
			return merged, nil
		}
		if *page.NextCursor == "" || cursors[*page.NextCursor] {
			return protocol.RunnerInventory{}, fmt.Errorf("inventory cursor did not progress")
		}
		cursors[*page.NextCursor] = true
		cursor = *page.NextCursor
	}
	return protocol.RunnerInventory{}, fmt.Errorf("inventory page bound reached; ownership retained")
}
func (c *Client) Send(ctx context.Context, frame protocol.Frame) error {
	c.mu.Lock()
	conn := c.conn
	inc := c.inc
	c.mu.Unlock()
	if conn == nil {
		return fmt.Errorf("control unavailable")
	}
	frame.SchemaVersion = 1
	if frame.Type != protocol.Hello {
		frame.Incarnation = &inc
	}
	raw, err := json.Marshal(frame)
	if err != nil {
		return err
	}
	if err = wire.Validate("Frame", raw); err != nil {
		return err
	}
	sendCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return conn.Write(sendCtx, websocket.MessageText, raw)
}
func (c *Client) Authorize(ctx context.Context, dispatch string) (string, error) {
	id := ID()
	result := make(chan protocol.Frame, 1)
	c.mu.Lock()
	if !c.ready {
		c.mu.Unlock()
		return "", fmt.Errorf("control unavailable")
	}
	c.pending[id] = result
	c.mu.Unlock()
	defer func() { c.mu.Lock(); delete(c.pending, id); c.mu.Unlock() }()
	if err := c.Send(ctx, protocol.Frame{Type: protocol.AuthorizeDispatch, DispatchID: &dispatch, CorrelationID: &id}); err != nil {
		return "", err
	}
	select {
	case frame := <-result:
		if frame.Allowed == nil || !*frame.Allowed || frame.Credential == nil {
			return "", fmt.Errorf("dispatch authority denied")
		}
		return *frame.Credential, nil
	case <-ctx.Done():
		return "", ctx.Err()
	case <-time.After(10 * time.Second):
		return "", fmt.Errorf("authorization unavailable")
	}
}

type Handler interface {
	Reconcile(context.Context, protocol.RunnerInventory) error
	Frame(context.Context, protocol.Frame)
	Tick(context.Context)
}

func (c *Client) Run(ctx context.Context, boot string, h Handler) error {
	// Dispatch workers belong to this connection incarnation. On disconnect,
	// cancel queued/in-flight work before another connection can become ready;
	// durable start/effect records remain available for normal reconciliation.
	ctx, cancelConnection := context.WithCancel(ctx)
	defer cancelConnection()
	header := http.Header{}
	header.Set("Authorization", "Bearer "+c.token)
	conn, _, err := websocket.Dial(ctx, "wss"+strings.TrimPrefix(strings.TrimRight(c.Config.Endpoint, "/"), "https")+"/v1/runner", &websocket.DialOptions{HTTPClient: c.HTTP, HTTPHeader: header})
	if err != nil {
		return fmt.Errorf("Runner connection unavailable")
	}
	defer conn.CloseNow()
	conn.SetReadLimit(wire.Limit)
	c.mu.Lock()
	c.conn = conn
	c.ready = false
	c.mu.Unlock()
	defer func() { c.mu.Lock(); c.conn = nil; c.ready = false; c.mu.Unlock() }()
	if err = c.Send(ctx, protocol.Frame{Type: protocol.Hello, RunnerID: &c.Config.RunnerID, BootID: &boot}); err != nil {
		return err
	}
	_, raw, err := conn.Read(ctx)
	if err != nil {
		return err
	}
	var welcome protocol.Frame
	if err = wire.Decode("Frame", raw, &welcome); err != nil {
		return err
	}
	if welcome.Type != protocol.Welcome || welcome.Incarnation == nil {
		return fmt.Errorf("expected compatible welcome")
	}
	c.mu.Lock()
	c.inc = *welcome.Incarnation
	c.mu.Unlock()
	inventory, err := c.Inventory(ctx)
	if err != nil {
		return err
	}
	if err = h.Reconcile(ctx, inventory); err != nil {
		return err
	}
	ready := protocol.Frame{Type: protocol.Ready, LogModes: []protocol.LogModeElement{protocol.PurpleOrderedV1}}
	if reporter, ok := h.(interface {
		InstalledRuntimes(context.Context) []protocol.RuntimeInstallation
	}); ok {
		ready.Runtimes = reporter.InstalledRuntimes(ctx)
	}
	if err = c.Send(ctx, ready); err != nil {
		return err
	}
	c.mu.Lock()
	c.ready = true
	c.mu.Unlock()
	heartbeatCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() {
		timer := time.NewTicker(3 * time.Second)
		defer timer.Stop()
		for {
			select {
			case <-heartbeatCtx.Done():
				return
			case <-timer.C:
				if c.Send(heartbeatCtx, protocol.Frame{Type: protocol.Heartbeat}) != nil {
					conn.CloseNow()
					return
				}
				go h.Tick(heartbeatCtx)
			}
		}
	}()
	for {
		_, raw, err = conn.Read(ctx)
		if err != nil {
			return err
		}
		var frame protocol.Frame
		if err = wire.Decode("Frame", raw, &frame); err != nil {
			return err
		}
		if frame.Incarnation == nil || *frame.Incarnation != *welcome.Incarnation {
			return fmt.Errorf("stale channel frame")
		}
		if frame.Type == protocol.Authorization || frame.Type == protocol.TypeError && frame.CorrelationID != nil {
			if frame.CorrelationID != nil {
				c.mu.Lock()
				ch := c.pending[*frame.CorrelationID]
				c.mu.Unlock()
				if ch != nil {
					select {
					case ch <- frame:
					default:
					}
				}
			}
			continue
		}
		h.Frame(ctx, frame)
	}
}
func ID() string {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		panic(err)
	}
	return hex.EncodeToString(raw)
}
func Submit(ctx context.Context, client *http.Client, endpoint, credential string, raw []byte, digest string) (protocol.CommandResult, error) {
	payload, err := json.Marshal(protocol.CommandSubmission{EnvelopeJSON: string(raw), Sha256: digest})
	if err != nil {
		return protocol.CommandResult{}, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(endpoint, "/")+"/v1/commands", bytes.NewReader(payload))
	if err != nil {
		return protocol.CommandResult{}, err
	}
	req.Header.Set("Authorization", "Bearer "+credential)
	req.Header.Set("Content-Type", "application/json")
	response, err := client.Do(req)
	if err != nil {
		return protocol.CommandResult{}, fmt.Errorf("submission outcome uncertain; retain request ID and query command-status")
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, wire.Limit+1))
	if err != nil {
		return protocol.CommandResult{}, err
	}
	var result protocol.CommandResult
	if err = wire.Decode("CommandResult", body, &result); err != nil {
		return result, fmt.Errorf("submission outcome uncertain: invalid response")
	}
	return result, nil
}
