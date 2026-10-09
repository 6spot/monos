package adapter

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/host"
)

// This executable exercises actual private-server pipes, HTTP/SSE, authentication
// and descendant cleanup. It never invokes the installed CLI or a model.
func TestCatalogServerHelper(t *testing.T) {
	mode := os.Getenv("MONOS_CATALOG_HELPER")
	if mode == "" {
		return
	}
	if mode == "descendant" {
		os.Stdout.Close()
		os.Stderr.Close()
		_ = os.WriteFile("child.pid", []byte(strconv.Itoa(os.Getpid())), 0600)
		time.Sleep(120 * time.Second)
		os.Exit(0)
	}
	if mode == "early-exit" {
		fmt.Fprintln(os.Stderr, "private diagnostic must not escape")
		os.Exit(7)
	}
	if mode == "lingering" {
		child := exec.Command(os.Args[0], "-test.run=^TestCatalogServerHelper$")
		child.Env = []string{"MONOS_CATALOG_HELPER=descendant", "GORACE=atexit_sleep_ms=0"}
		child.Stdout, child.Stderr = os.Stdout, os.Stderr
		if child.Start() != nil {
			os.Exit(70)
		}
		deadline := time.Now().Add(3 * time.Second)
		for {
			if _, err := os.Stat("child.pid"); err == nil {
				break
			}
			if time.Now().After(deadline) {
				os.Exit(71)
			}
			time.Sleep(5 * time.Millisecond)
		}
	}
	scratch, _ := os.Getwd()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		os.Exit(72)
	}
	endpoint := "http://" + listener.Addr().String()
	var mu sync.Mutex
	log := func(entry string) {
		mu.Lock()
		defer mu.Unlock()
		f, err := os.OpenFile("requests", os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
		if err == nil {
			fmt.Fprintln(f, entry)
			f.Close()
		}
	}
	var reads atomic.Int32
	update := make(chan struct{}, 1)
	modelStarted := make(chan struct{})
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, password, ok := r.BasicAuth()
		if !ok || user != "opencode" || password == "" || password != os.Getenv("OPENCODE_PASSWORD") || r.Method != http.MethodGet {
			log("invalid-auth-or-method")
			w.WriteHeader(http.StatusForbidden)
			return
		}
		log(r.URL.Path)
		switch r.URL.Path {
		case "/api/event":
			if mode == "redirect" {
				http.Redirect(w, r, endpoint+"/forbidden", http.StatusFound)
				return
			}
			w.Header().Set("Content-Type", "text/event-stream")
			flusher := w.(http.Flusher)
			emit := func(kind, directory string) {
				raw, _ := json.Marshal(map[string]any{"type": kind, "location": map[string]string{"directory": directory}, "data": map[string]any{}})
				fmt.Fprintf(w, "data: %s\n\n", raw)
				flusher.Flush()
			}
			if mode == "bad-event" {
				fmt.Fprint(w, "data: not json\n\n")
				flusher.Flush()
				return
			}
			if mode == "event-overflow" {
				fmt.Fprint(w, "data: "+strings.Repeat("x", catalogFrameLimit+1)+"\n\n")
				flusher.Flush()
				return
			}
			emit("server.connected", "")
			if mode == "sse-eof" {
				<-modelStarted
				return
			}
			select {
			case <-update:
				emit("provider.updated", scratch)
				emit("model.updated", scratch+"-other")
				if mode != "pending" {
					emit("model.updated", scratch)
				}
			case <-r.Context().Done():
				return
			}
			<-r.Context().Done()
		case "/api/model":
			if r.URL.Query().Get("location[directory]") != scratch || len(r.URL.Query()) != 1 {
				log("invalid-location-query")
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			count := reads.Add(1)
			if mode == "sse-eof" {
				close(modelStarted)
				<-r.Context().Done()
				return
			}
			w.Header().Set("Content-Type", "application/json")
			if mode == "updated" && count == 1 || mode == "pending" {
				fmt.Fprint(w, catalogEnvelope(scratch))
				w.(http.Flusher).Flush()
				update <- struct{}{}
				return
			}
			value := modelCatalogAt(scratch, host.FreeModel, freeCost)
			switch mode {
			case "paid":
				value = strings.Replace(value, `"input":0`, `"input":1`, 1)
			case "duplicate":
				value = catalogEnvelope(scratch, catalogEntry(host.FreeModel, freeCost), catalogEntry(host.FreeModel, freeCost))
			case "wrong-location":
				value = modelCatalogAt(scratch+"-other", host.FreeModel, freeCost)
			case "null-data":
				value = strings.Replace(catalogEnvelope(scratch), "[]", "null", 1)
			case "catalog-overflow":
				value += strings.Repeat(" ", catalogLimit+1)
			case "http-failure":
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			fmt.Fprint(w, value)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})}
	go func() { _ = server.Serve(listener) }()
	switch mode {
	case "bad-handshake":
		fmt.Fprintln(os.Stdout, `{"url":"http://example.com:1234"}`)
	case "handshake-overflow":
		fmt.Fprintln(os.Stdout, strings.Repeat("x", catalogFrameLimit+1))
	default:
		_ = json.NewEncoder(os.Stdout).Encode(map[string]string{"url": endpoint})
	}
	if mode == "stdout-overflow" {
		fmt.Fprint(os.Stdout, strings.Repeat("x", catalogLimit+1))
	}
	_, _ = io.Copy(io.Discard, os.Stdin)
	_ = server.Close()
	os.Exit(0)
}

func TestCatalogServerActualAttemptConfiguration(t *testing.T) {
	d := protocol.Dispatch{AttemptID: "catalog-test", Kind: protocol.Node, RuntimeID: protocol.Opencode, Model: host.FreeModel}
	env, err := Environment(d)
	if err != nil {
		t.Fatal(err)
	}
	original := append([]string(nil), env...)
	var command *exec.Cmd
	err = verifyCatalogServer(context.Background(), string(d.Model), host.Path(d.AttemptID, "scratch"), env, func(ctx context.Context) *exec.Cmd {
		command = catalogServerCommand(ctx)
		command.Path = filepath.Join(t.TempDir(), "missing-native-cli")
		return command
	})
	if err == nil || command.Process != nil {
		t.Fatal("missing executable unexpectedly started")
	}
	if !reflect.DeepEqual(command.Args, []string{host.Runtime, "serve", "--stdio", "--hostname", "127.0.0.1", "--port", "0"}) || command.Dir != host.Path(d.AttemptID, "scratch") {
		t.Fatal("catalog command left the native Attempt contract")
	}
	if !reflect.DeepEqual(env, original) || len(command.Env) != len(env)+1 || !reflect.DeepEqual(command.Env[:len(env)], env) {
		t.Fatal("catalog altered or replaced Attempt environment")
	}
	password := strings.TrimPrefix(command.Env[len(env)], "OPENCODE_PASSWORD=")
	if len(password) != 64 || password == command.Env[len(env)] || strings.Contains(err.Error(), password) {
		t.Fatal("private server password missing or exposed")
	}
	if command.Stderr != nil || command.SysProcAttr == nil || !command.SysProcAttr.Setpgid {
		t.Fatal("catalog did not discard stderr or own its process group")
	}
}

func TestCatalogServerGatesRunAndSettlesNativeProcess(t *testing.T) {
	for _, mode := range []string{"normal", "updated", "lingering", "paid", "duplicate", "wrong-location", "null-data", "catalog-overflow", "http-failure", "pending", "redirect", "sse-eof", "bad-event", "event-overflow", "early-exit", "bad-handshake", "handshake-overflow", "stdout-overflow"} {
		t.Run(mode, func(t *testing.T) {
			scratch := t.TempDir()
			d := protocol.Dispatch{AttemptID: "catalog-test", Kind: protocol.Node, RuntimeID: protocol.Opencode, Model: host.FreeModel}
			duration := 5 * time.Second
			if mode == "pending" {
				duration = 500 * time.Millisecond
			}
			ctx, cancel := context.WithTimeout(context.Background(), duration)
			defer cancel()
			var command *exec.Cmd
			assertAbsent := func() {
				t.Helper()
				if command == nil || command.Process == nil || command.ProcessState == nil || !errors.Is(syscall.Kill(-command.Process.Pid, 0), syscall.ESRCH) {
					t.Fatal("catalog returned before native process/group settlement")
				}
				if raw, err := os.ReadFile(filepath.Join(scratch, "child.pid")); err == nil {
					pid, err := strconv.Atoi(string(raw))
					if err != nil || !errors.Is(syscall.Kill(pid, 0), syscall.ESRCH) {
						t.Fatal("catalog child survived settlement")
					}
				}
			}
			calls := 0
			err := runWithPreflight(d, func(*exec.Cmd) error { calls++; assertAbsent(); return nil }, outputSink{stdout: io.Discard, stderr: io.Discard}, func(d protocol.Dispatch, _ []string) error {
				return verifyCatalogServer(ctx, string(d.Model), scratch, []string{"MONOS_CATALOG_HELPER=" + mode, "GORACE=atexit_sleep_ms=0", "PWD=" + scratch}, func(ctx context.Context) *exec.Cmd {
					command = exec.CommandContext(ctx, os.Args[0], "-test.run=^TestCatalogServerHelper$")
					return command
				})
			})
			assertAbsent()
			wantSuccess := mode == "normal" || mode == "updated" || mode == "lingering"
			if wantSuccess && (err != nil || calls != 1) || !wantSuccess && (err == nil || calls != 0) {
				t.Fatalf("run gate mismatch: calls=%d err=%v", calls, err)
			}
			if err != nil && strings.Contains(err.Error(), "private diagnostic") {
				t.Fatal("native diagnostic escaped")
			}
			raw, _ := os.ReadFile(filepath.Join(scratch, "requests"))
			requests := string(raw)
			if strings.Contains(requests, "invalid-") || strings.Contains(requests, "/forbidden") {
				t.Fatal("private HTTP contract violated", requests)
			}
			if mode == "updated" && requests != "/api/event\n/api/model\n/api/model\n" {
				t.Fatalf("missing subscribe-empty-update-valid sequence: %q", requests)
			}
			if mode == "pending" && requests != "/api/event\n/api/model\n" {
				t.Fatalf("unrelated events or a timer triggered a catalog read: %q", requests)
			}
		})
	}
}

func TestCatalogEndpointRejectsUnexpectedHandshake(t *testing.T) {
	for _, raw := range []string{
		`{"url":"https://127.0.0.1:10"}`, `{"url":"http://localhost:10"}`, `{"url":"http://127.0.0.2:10"}`,
		`{"url":"http://user:secret@127.0.0.1:10"}`, `{"url":"http://127.0.0.1:0"}`, `{"url":"http://127.0.0.1:65536"}`,
		`{"url":"http://127.0.0.1:10/path"}`, `{"url":"http://127.0.0.1:10?x=1"}`, `{"url":"http://127.0.0.1:10#fragment"}`,
		`{"url":"http://127.0.0.1:10","unexpected":true}`, `{"url":"http://127.0.0.1:10"}{}`, `not JSON`,
	} {
		if _, err := catalogEndpoint([]byte(raw)); err == nil {
			t.Fatal("unexpected handshake accepted", raw)
		}
	}
}

// Model the HTTP transport having buffered bytes when shutdown closes its body.
// The second read is held until Close so classification happens after cleanup
// has cancelled the context, rather than depending on a scheduling race.
type catalogCleanupBody struct {
	initial, tail       *strings.Reader
	reading, closed     chan struct{}
	readOnce, closeOnce sync.Once
}

func (b *catalogCleanupBody) Read(p []byte) (int, error) {
	if b.initial.Len() > 0 {
		return b.initial.Read(p)
	}
	b.readOnce.Do(func() { close(b.reading) })
	<-b.closed
	return b.tail.Read(p)
}

func (b *catalogCleanupBody) Close() error {
	b.closeOnce.Do(func() { close(b.closed) })
	return nil
}

func TestCatalogEventViolationDuringCleanupStillRejectsSnapshot(t *testing.T) {
	for name, payload := range map[string]string{
		"malformed JSON":  "data: not-json\n\n",
		"invalid framing": "event: model.updated\n\n",
		"frame overflow":  "data: " + strings.Repeat("x", catalogFrameLimit+1) + "\n\n",
		"stream overflow": strings.Repeat(": heartbeat\n\n", catalogLimit/13+2),
		"intentional EOF": "",
	} {
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			body := &catalogCleanupBody{
				initial: strings.NewReader("data: {\"type\":\"server.connected\"}\n\n"),
				tail:    strings.NewReader(payload), reading: make(chan struct{}), closed: make(chan struct{}),
			}
			defer body.Close()
			events := make(chan catalogEvent, 1)
			var failed atomic.Bool
			done := make(chan error, 1)
			go func() { done <- readCatalogEvents(ctx, body, events, &failed) }()
			select {
			case event := <-events:
				if event.Type != "server.connected" {
					t.Fatal("subscription handshake changed")
				}
			case <-time.After(time.Second):
				t.Fatal("subscription did not start")
			}
			<-body.reading
			// A valid snapshot has arrived; perform the same request cancellation
			// and body close as successful cleanup, then join the reader.
			cancel()
			body.Close()
			select {
			case <-done:
			case <-time.After(time.Second):
				t.Fatal("closed SSE reader did not join")
			}
			if want := name != "intentional EOF"; failed.Load() != want {
				t.Fatalf("cleanup lost protocol failure: failed=%v want=%v", failed.Load(), want)
			}
		})
	}
}
