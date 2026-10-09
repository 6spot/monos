package adapter

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
)

const catalogLimit = 4 << 20
const catalogFrameLimit = 64 << 10

var errCatalogServer = errors.New("OpenCode model catalog preflight failed")
var errCatalogEventProtocol = errors.New("invalid OpenCode catalog event stream")

// makeCommand is a private fake-executable seam. Production supplies only the
// fixed serve command; neither dispatch nor the protocol chooses an executable.
func verifyCatalogServer(parent context.Context, selected, scratch string, env []string, makeCommand func(context.Context) *exec.Cmd) (result error) {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return errCatalogServer
	}
	password := hex.EncodeToString(secret)
	cmd := makeCommand(ctx)
	cmd.Env = append(append([]string(nil), env...), "OPENCODE_PASSWORD="+password)
	cmd.Dir = scratch
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return os.ErrProcessDone
		}
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
	stdin, lease, err := os.Pipe()
	if err != nil {
		return errCatalogServer
	}
	defer stdin.Close()
	defer lease.Close()
	stdout, childOut, err := os.Pipe()
	if err != nil {
		return errCatalogServer
	}
	defer stdout.Close()
	defer childOut.Close()
	cmd.Stdin, cmd.Stdout, cmd.Stderr = stdin, childOut, nil
	if err := cmd.Start(); err != nil {
		return errCatalogServer
	}
	stdin.Close()
	childOut.Close()
	var stopping, failed atomic.Bool
	fail := func() {
		if !stopping.Load() {
			failed.Store(true)
			cancel()
		}
	}
	waitDone := make(chan struct{})
	var waitErr error
	go func() {
		waitErr = cmd.Wait()
		fail()
		close(waitDone)
	}()
	ready := make(chan string, 1)
	readerDone := make(chan struct{})
	go func() {
		defer close(readerDone)
		defer fail()
		limited := &io.LimitedReader{R: stdout, N: catalogLimit + 1}
		reader := bufio.NewReaderSize(limited, catalogFrameLimit+1)
		line, err := reader.ReadSlice('\n')
		if err != nil || len(line) > catalogFrameLimit {
			return
		}
		endpoint, err := catalogEndpoint(line)
		if err != nil {
			return
		}
		ready <- endpoint
		// Keep draining bounded stdout for the entire private lifetime. EOF is
		// unexpected until cleanup closes the stdin lease and begins shutdown.
		_, _ = io.Copy(io.Discard, reader)
		if limited.N <= 0 {
			failed.Store(true) // Overflow remains invalid during graceful cleanup.
		}
	}()
	// Cleanup has its own bounded grace after the 30-second discovery deadline.
	// It also runs after every handshake/HTTP/SSE failure. No successful return
	// can leave the native parent, inherited group or stdout reader alive.
	stopHTTP := func() {}
	defer func() {
		stopping.Store(true)
		stopHTTP()
		lease.Close()
		grace := time.NewTimer(time.Second)
		select {
		case <-waitDone:
		case <-grace.C:
		}
		grace.Stop()
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		deadline := time.NewTimer(3 * time.Second)
		defer deadline.Stop()
		tick := time.NewTicker(20 * time.Millisecond)
		defer tick.Stop()
		for {
			if errors.Is(syscall.Kill(-cmd.Process.Pid, 0), syscall.ESRCH) {
				select {
				case <-waitDone:
					// The group is absent; drain retained pipe bytes through the
					// bound before deciding whether this snapshot may launch.
					// A pipe held outside the observed group remains uncertainty.
					drain := time.NewTimer(100 * time.Millisecond)
					select {
					case <-readerDone:
						drain.Stop()
					case <-drain.C:
						stdout.Close()
						<-readerDone
						result = errCatalogServer
						return
					}
					if waitErr != nil || failed.Load() || parent.Err() != nil {
						result = errCatalogServer
					}
					return
				default:
				}
			}
			select {
			case <-deadline.C:
				stdout.Close()
				<-readerDone
				result = errors.New("OpenCode catalog process cleanup unresolved")
				return
			case <-tick.C:
			}
		}
	}()
	var endpoint string
	select {
	case endpoint = <-ready:
	case <-ctx.Done():
		return errCatalogServer
	}
	transport := &http.Transport{DisableCompression: true, MaxResponseHeaderBytes: catalogFrameLimit}
	httpCtx, stopRequests := context.WithCancel(ctx)
	stopHTTP = func() {
		stopRequests()
		transport.CloseIdleConnections()
	}
	client := &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := catalogGet(httpCtx, client, endpoint+"/api/event", password, "text/event-stream")
	if err != nil {
		return err
	}
	events := make(chan catalogEvent, 16)
	eventsDone := make(chan struct{})
	go func() {
		defer close(eventsDone)
		defer fail()
		_ = readCatalogEvents(httpCtx, response.Body, events, &failed)
	}()
	stopHTTP = func() {
		stopRequests()
		response.Body.Close()
		<-eventsDone
		transport.CloseIdleConnections()
	}
	connected := false
	for {
		var event catalogEvent
		select {
		case event = <-events:
		case <-ctx.Done():
			return errCatalogServer
		}
		if !connected {
			if event.Type != "server.connected" {
				return errCatalogServer
			}
			connected = true
		} else {
			if event.Type == "server.connected" {
				return errCatalogServer
			}
			if event.Type != "model.updated" || event.Location.Directory != cmd.Dir {
				continue
			}
		}
		query := url.Values{"location[directory]": {cmd.Dir}}
		snapshot, err := catalogGet(httpCtx, client, endpoint+"/api/model?"+query.Encode(), password, "application/json")
		if err != nil {
			return err
		}
		raw, readErr := io.ReadAll(io.LimitReader(snapshot.Body, catalogLimit+1))
		snapshot.Body.Close()
		if readErr != nil || len(raw) > catalogLimit || ctx.Err() != nil {
			return errCatalogServer
		}
		if err := validateCatalog(string(raw), selected, cmd.Dir); !errors.Is(err, errCatalogPending) {
			return err
		}
	}
}

func catalogEndpoint(raw []byte) (string, error) {
	var handshake struct {
		URL string `json:"url"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&handshake) != nil || decoder.Decode(new(any)) != io.EOF {
		return "", errCatalogServer
	}
	u, err := url.Parse(handshake.URL)
	if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return "", errCatalogServer
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil || port < 1 || port > 65535 || u.Host != "127.0.0.1:"+strconv.Itoa(port) {
		return "", errCatalogServer
	}
	return "http://" + u.Host, nil
}

func catalogGet(ctx context.Context, client *http.Client, target, password, accept string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, errCatalogServer
	}
	req.SetBasicAuth("opencode", password)
	req.Header.Set("Accept", accept)
	response, err := client.Do(req)
	if err != nil {
		return nil, errCatalogServer
	}
	contentType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if response.StatusCode != http.StatusOK || err != nil || contentType != accept || response.ContentLength > catalogLimit {
		response.Body.Close()
		return nil, errCatalogServer
	}
	return response, nil
}

type catalogEvent struct {
	Type     string `json:"type"`
	Location struct {
		Directory string `json:"directory"`
	} `json:"location"`
}

func readCatalogEvents(ctx context.Context, body io.Reader, events chan<- catalogEvent, failed *atomic.Bool) error {
	limited := &io.LimitedReader{R: body, N: catalogLimit + 1}
	reader := bufio.NewReaderSize(limited, catalogFrameLimit+1)
	for {
		event, err := nextCatalogEvent(reader)
		if limited.N <= 0 || errors.Is(err, errCatalogEventProtocol) {
			// A protocol violation is evidence against the snapshot even when
			// cleanup has already cancelled requests and closed the HTTP body.
			failed.Store(true)
			return errCatalogEventProtocol
		}
		if err != nil {
			return err
		}
		select {
		case events <- event:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func nextCatalogEvent(reader *bufio.Reader) (catalogEvent, error) {
	var data []byte
	size := 0
	for {
		line, err := reader.ReadSlice('\n')
		size += len(line)
		if size > catalogFrameLimit || errors.Is(err, bufio.ErrBufferFull) {
			return catalogEvent{}, errCatalogEventProtocol
		}
		if err != nil {
			return catalogEvent{}, err
		}
		line = bytes.TrimSuffix(bytes.TrimSuffix(line, []byte{'\n'}), []byte{'\r'})
		if len(line) == 0 {
			if len(data) == 0 {
				size = 0 // Empty frames and SSE comments carry no event.
				continue
			}
			var event catalogEvent
			if json.Unmarshal(data, &event) != nil || event.Type == "" || len(event.Type) > 128 || strings.ContainsAny(event.Type, "\r\n") {
				return catalogEvent{}, errCatalogEventProtocol
			}
			return event, nil
		}
		if bytes.HasPrefix(line, []byte("data:")) {
			if len(data) > 0 {
				data = append(data, '\n')
			}
			data = append(data, bytes.TrimPrefix(line[5:], []byte{' '})...)
		} else if line[0] != ':' {
			return catalogEvent{}, errCatalogEventProtocol
		}
	}
}
