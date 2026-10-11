package enrollment

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/control"
	"monos.local/runner/internal/host"
)

type enrollmentFixture struct {
	config control.Config
	path   string
	grant  protocol.RunnerEnrollmentGrant
}

func fixture(t *testing.T, endpoint string) enrollmentFixture {
	t.Helper()
	if os.Geteuid() == 0 {
		t.Skip("enrollment must run under a service account")
	}
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	f := enrollmentFixture{
		config: control.Config{Endpoint: endpoint, TokenFile: filepath.Join(dir, "identity.json"), Journal: filepath.Join(dir, "journal.sqlite"), Socket: host.Socket, ExecutionUID: uint32(os.Geteuid() + 1)},
		path:   filepath.Join(dir, "runner.json"),
		grant:  protocol.RunnerEnrollmentGrant{SchemaVersion: 1, EnrollmentID: "grant-1", EnrollmentToken: strings.Repeat("a", 43), ExpiresAt: time.Now().Add(time.Hour).UTC().Format("2006-01-02T15:04:05.000Z"), Capacity: 2},
	}
	f.writeConfig(t)
	return f
}

func (f enrollmentFixture) writeConfig(t *testing.T) {
	t.Helper()
	raw, _ := json.Marshal(f.config)
	if err := os.WriteFile(f.path, raw, 0640); err != nil {
		t.Fatal(err)
	}
}

func (f enrollmentFixture) run(t *testing.T, grant bool) (string, error) {
	t.Helper()
	var raw []byte
	if grant {
		raw, _ = json.Marshal(f.grant)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return Enroll(ctx, f.path, bytes.NewReader(raw))
}

func (f enrollmentFixture) pending(t *testing.T) pending {
	t.Helper()
	raw, err := os.ReadFile(f.config.TokenFile + ".enroll.pending")
	if err != nil {
		t.Fatal(err)
	}
	var state pending
	if err = json.Unmarshal(raw, &state); err != nil {
		t.Fatal("invalid pending JSON")
	}
	return state
}

func reply(t *testing.T, w http.ResponseWriter, r *http.Request) protocol.RunnerEnrollmentRequest {
	t.Helper()
	var request protocol.RunnerEnrollmentRequest
	if r.Method != http.MethodPost || r.URL.Path != "/v1/runner/enroll" || r.Header.Get("Authorization") != "" {
		t.Error("wrong enrollment transport scope")
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		t.Error("invalid request")
	}
	_ = json.NewEncoder(w).Encode(protocol.RunnerEnrollmentResponse{SchemaVersion: 1, RequestID: request.RequestID, RunnerID: "enrolled-runner"})
	return request
}

func TestEnrollInstallsOneIdentityAndResolvesControlConfig(t *testing.T) {
	var calls atomic.Int32
	var credential string
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/check" {
			if r.Header.Get("Authorization") != "Bearer "+credential {
				t.Error("resolved credential not used")
			}
			_, _ = io.WriteString(w, `{}`)
			return
		}
		calls.Add(1)
		credential = reply(t, w, r).Credential
	}))
	defer s.Close()
	f := fixture(t, s.URL)
	original, _ := os.ReadFile(f.path)
	id, err := f.run(t, true)
	if err != nil || id != "enrolled-runner" {
		t.Fatal("enrollment failed", err)
	}
	unchanged, _ := os.ReadFile(f.path)
	if !bytes.Equal(original, unchanged) {
		t.Fatal("enrollment rewrote configuration")
	}
	info, err := os.Stat(f.config.TokenFile)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("identity is not private", err)
	}
	if _, err = os.Stat(f.config.Journal); !os.IsNotExist(err) {
		t.Fatal("enrollment created execution journal")
	}
	if _, err = os.Stat(f.config.TokenFile + ".enroll.pending"); !os.IsNotExist(err) {
		t.Fatal("pending was not cleared")
	}
	client, err := control.New(f.config)
	if err != nil || client.Config.RunnerID != id {
		t.Fatal("control did not resolve identity", err)
	}
	// A real authenticated request exercises the resolved private token.
	_ = client.Get(context.Background(), "/check", "RunnerEnrollmentResponse", new(protocol.RunnerEnrollmentResponse))
	if _, err = f.run(t, true); err == nil || calls.Load() != 1 {
		t.Fatal("fresh enrollment replaced an identity")
	}
}

func TestEnrollLostResponseReplaysPersistedRequestAfterExpiry(t *testing.T) {
	var calls atomic.Int32
	var first protocol.RunnerEnrollmentRequest
	var f enrollmentFixture
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request protocol.RunnerEnrollmentRequest
		if json.NewDecoder(r.Body).Decode(&request) != nil {
			t.Error("invalid request")
		}
		state := f.pending(t)
		if state.Request != request {
			t.Error("request sent before exact durable intent")
		}
		if calls.Add(1) == 1 {
			first = request
			conn, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				t.Error(err)
				return
			}
			_ = conn.Close()
			return
		}
		if request != first {
			t.Error("retry minted a different request or credential")
		}
		_ = json.NewEncoder(w).Encode(protocol.RunnerEnrollmentResponse{SchemaVersion: 1, RequestID: request.RequestID, RunnerID: "same-runner"})
	}))
	defer s.Close()
	f = fixture(t, s.URL)
	f.grant.ExpiresAt = time.Now().Add(150 * time.Millisecond).UTC().Format("2006-01-02T15:04:05.000Z")
	if _, err := f.run(t, true); err == nil {
		t.Fatal("lost response reported success")
	}
	// Simulate a readable retained rename whose file and parent directory have
	// not been synced. Replay must make the same intent durable again.
	statePath := f.config.TokenFile + ".enroll.pending"
	retained, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(statePath+".unsynced", retained, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(statePath+".unsynced", statePath); err != nil {
		t.Fatal(err)
	}
	expires, _ := time.Parse("2006-01-02T15:04:05.000Z", f.grant.ExpiresAt)
	if delay := time.Until(expires) + 5*time.Millisecond; delay > 0 {
		time.Sleep(delay)
	}
	if id, err := f.run(t, false); err != nil || id != "same-runner" || calls.Load() != 2 {
		t.Fatal("exact replay after expiry failed", err)
	}
}

func TestEnrollSerializesConcurrentAttempts(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		close(started)
		<-release
		reply(t, w, r)
	}))
	defer s.Close()
	f := fixture(t, s.URL)
	done := make(chan error, 1)
	go func() { _, err := f.run(t, true); done <- err }()
	<-started
	_, concurrentErr := f.run(t, false)
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if concurrentErr == nil || calls.Load() != 1 {
		t.Fatal("concurrent enrollment was not locked")
	}
}

func TestEnrollCancellationKeepsExactIntentAndRejectsReplacementGrant(t *testing.T) {
	started := make(chan struct{})
	var calls atomic.Int32
	var original protocol.RunnerEnrollmentRequest
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request protocol.RunnerEnrollmentRequest
		_ = json.NewDecoder(r.Body).Decode(&request)
		if calls.Add(1) == 1 {
			original = request
			close(started)
			<-r.Context().Done()
			return
		}
		if request != original {
			t.Error("cancellation lost the original request")
		}
		_ = json.NewEncoder(w).Encode(protocol.RunnerEnrollmentResponse{SchemaVersion: 1, RequestID: request.RequestID, RunnerID: "resumed"})
	}))
	defer s.Close()
	f := fixture(t, s.URL)
	input, _ := json.Marshal(f.grant)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := Enroll(ctx, f.path, bytes.NewReader(input)); done <- err }()
	<-started
	cancel()
	if err := <-done; err == nil {
		t.Fatal("cancelled request reported success")
	}
	f.grant.Capacity++
	if _, err := f.run(t, true); err == nil || calls.Load() != 1 {
		t.Fatal("replacement grant was used after cancellation")
	}
	if id, err := f.run(t, false); err != nil || id != "resumed" || calls.Load() != 2 {
		t.Fatal("cancelled intent did not resume", err)
	}
}

func TestEnrollRejectsResponsesWithoutExposingSecrets(t *testing.T) {
	for _, variant := range []string{"wrong-id", "extra-secret", "oversize", "malformed", "denied"} {
		t.Run(variant, func(t *testing.T) {
			var credential string
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request protocol.RunnerEnrollmentRequest
				_ = json.NewDecoder(r.Body).Decode(&request)
				credential = request.Credential
				switch variant {
				case "wrong-id":
					_ = json.NewEncoder(w).Encode(protocol.RunnerEnrollmentResponse{SchemaVersion: 1, RequestID: "wrong", RunnerID: "runner"})
				case "extra-secret":
					_ = json.NewEncoder(w).Encode(map[string]any{"schema_version": 1, "request_id": request.RequestID, "runner_id": "runner", "credential": credential})
				case "oversize":
					_, _ = io.WriteString(w, strings.Repeat(" ", 4097))
				case "malformed":
					_, _ = io.WriteString(w, credential)
				case "denied":
					w.WriteHeader(403)
					_, _ = io.WriteString(w, credential)
				}
			}))
			defer s.Close()
			f := fixture(t, s.URL)
			if _, err := f.run(t, true); err == nil || strings.Contains(err.Error(), credential) || strings.Contains(err.Error(), f.grant.EnrollmentToken) {
				t.Fatal("response was accepted or exposed credentials")
			}
			if f.pending(t).Response != nil {
				t.Fatal("invalid response became installation authority")
			}
			if _, err := os.Stat(f.config.TokenFile); !os.IsNotExist(err) {
				t.Fatal("invalid response installed identity")
			}
		})
	}
}

func TestEnrollRejectsUnsafeStorageAndExistingExecution(t *testing.T) {
	for _, variant := range []string{"config-mode", "config-link", "parent-link", "directory-mode", "identity-exists", "journal", "journal-wal", "journal-shm", "journal-directory-mode", "expired", "path-overlap", "pending-mode", "pending-link"} {
		t.Run(variant, func(t *testing.T) {
			var calls atomic.Int32
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); reply(t, w, r) }))
			defer s.Close()
			f := fixture(t, s.URL)
			switch variant {
			case "config-mode":
				_ = os.Chmod(f.path, 0660)
			case "config-link":
				real := f.path + ".real"
				_ = os.Rename(f.path, real)
				_ = os.Symlink(real, f.path)
			case "parent-link":
				alias := filepath.Join(filepath.Dir(f.path), "alias")
				_ = os.Symlink(filepath.Dir(f.path), alias)
				f.path = filepath.Join(alias, "runner.json")
			case "directory-mode":
				_ = os.Chmod(filepath.Dir(f.config.TokenFile), 0750)
			case "identity-exists":
				_ = os.WriteFile(f.config.TokenFile, []byte("existing identity"), 0600)
			case "journal", "journal-wal", "journal-shm":
				suffix := strings.TrimPrefix(variant, "journal")
				_ = os.WriteFile(f.config.Journal+suffix, []byte("retained execution"), 0600)
			case "journal-directory-mode":
				parent := filepath.Join(filepath.Dir(f.path), "public-journal")
				_ = os.Mkdir(parent, 0755)
				f.config.Journal = filepath.Join(parent, "journal.sqlite")
				f.writeConfig(t)
			case "expired":
				f.grant.ExpiresAt = time.Now().Add(-time.Hour).UTC().Format("2006-01-02T15:04:05.000Z")
			case "path-overlap":
				f.config.TokenFile = f.config.Journal
				f.writeConfig(t)
			case "pending-mode":
				_ = os.WriteFile(f.config.TokenFile+".enroll.pending", []byte("{}"), 0640)
			case "pending-link":
				_ = os.Chmod(f.path, 0600)
				_ = os.Link(f.path, f.config.TokenFile+".enroll.pending")
			}
			if _, err := f.run(t, true); err == nil || calls.Load() != 0 {
				t.Fatal("unsafe enrollment reached backend")
			}
		})
	}
}

func TestEnrollRecoversOnlyExactPendingPublication(t *testing.T) {
	for _, variant := range []string{"before-link", "between-link-unlink", "partial-stage", "after-publication", "foreign-hardlink", "different-stage"} {
		t.Run(variant, func(t *testing.T) {
			var calls atomic.Int32
			var f enrollmentFixture
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				// Force the first installer to retain a confirmed response without
				// ever overwriting a different credential file.
				_ = os.WriteFile(f.config.TokenFile, []byte("conflicting identity"), 0600)
				reply(t, w, r)
			}))
			defer s.Close()
			f = fixture(t, s.URL)
			if _, err := f.run(t, true); err == nil {
				t.Fatal("different identity was overwritten")
			}
			state := f.pending(t)
			if state.Response == nil {
				t.Fatal("response not durable before installation")
			}
			old, _ := os.ReadFile(f.config.TokenFile)
			if string(old) != "conflicting identity" {
				t.Fatal("different identity changed")
			}
			_ = os.Remove(f.config.TokenFile)
			raw, _ := json.Marshal(protocol.RunnerCredential{SchemaVersion: 1, RunnerID: state.Response.RunnerID, Credential: state.Request.Credential})
			stage := f.config.TokenFile + ".enroll.install"
			switch variant {
			case "before-link":
				// WriteFile closes without fsync: recovery must sync these complete
				// bytes before publishing and discarding the retained credential.
				_ = os.WriteFile(stage, raw, 0600)
			case "between-link-unlink":
				_ = os.WriteFile(stage, raw, 0600)
				_ = os.Link(stage, f.config.TokenFile)
			case "partial-stage":
				_ = os.WriteFile(stage, raw[:len(raw)/2], 0600)
			case "after-publication":
				_ = os.WriteFile(f.config.TokenFile, raw, 0600)
				// A daemon may already be using this exact published identity.
				_ = os.WriteFile(f.config.Journal, []byte("retained execution"), 0600)
			case "foreign-hardlink":
				_ = os.WriteFile(f.config.TokenFile, raw, 0600)
				_ = os.Link(f.config.TokenFile, f.config.TokenFile+".foreign")
			case "different-stage":
				_ = os.WriteFile(stage, []byte("different identity"), 0600)
			}
			id, err := f.run(t, false)
			valid := variant != "foreign-hardlink" && variant != "different-stage"
			if (err == nil) != valid || calls.Load() != 1 {
				t.Fatal("incorrect offline publication recovery", err)
			}
			if valid {
				client, e := control.New(f.config)
				if e != nil || client.Config.RunnerID != id {
					t.Fatal("recovered identity is not usable", e)
				}
			}
		})
	}
}

func TestEnrollBindsConfigurationDuringAndAfterRequest(t *testing.T) {
	var f enrollmentFixture
	var calls atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		f.config.Endpoint = "http://127.0.0.1:1"
		f.writeConfig(t)
		reply(t, w, r)
	}))
	defer s.Close()
	f = fixture(t, s.URL)
	if _, err := f.run(t, true); err == nil {
		t.Fatal("configuration changed during request was accepted")
	}
	if _, err := f.run(t, false); err == nil || calls.Load() != 1 {
		t.Fatal("pending replay ignored changed endpoint")
	}
	if _, err := os.Stat(f.config.TokenFile); !os.IsNotExist(err) {
		t.Fatal("credential installed for changed origin")
	}
}

func TestEnrollPreservesJournalsAppearingAfterIntent(t *testing.T) {
	for _, timing := range []string{"lost-response", "in-flight"} {
		for _, suffix := range []string{"", "-wal", "-shm"} {
			t.Run(timing+suffix, func(t *testing.T) {
				var calls atomic.Int32
				var f enrollmentFixture
				s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					calls.Add(1)
					if timing == "lost-response" {
						conn, _, e := w.(http.Hijacker).Hijack()
						if e != nil {
							t.Error(e)
							return
						}
						_ = conn.Close()
						return
					}
					_ = os.WriteFile(f.config.Journal+suffix, []byte("retained execution"), 0600)
					reply(t, w, r)
				}))
				defer s.Close()
				f = fixture(t, s.URL)
				if _, err := f.run(t, true); err == nil {
					t.Fatal("initial enrollment unexpectedly succeeded")
				}
				if timing == "lost-response" {
					_ = os.WriteFile(f.config.Journal+suffix, []byte("retained execution"), 0600)
				}
				before, _ := os.ReadFile(f.config.TokenFile + ".enroll.pending")
				if _, err := f.run(t, false); err == nil || calls.Load() != 1 {
					t.Fatal("retained execution did not prevent new identity")
				}
				after, _ := os.ReadFile(f.config.TokenFile + ".enroll.pending")
				journal, _ := os.ReadFile(f.config.Journal + suffix)
				if !bytes.Equal(before, after) || string(journal) != "retained execution" {
					t.Fatal("retained files changed")
				}
				if _, err := os.Stat(f.config.TokenFile); !os.IsNotExist(err) {
					t.Fatal("new identity published over execution state")
				}
			})
		}
	}
}

func TestEnrollUsesVerifiedTLSAndRejectsRedirects(t *testing.T) {
	for _, variant := range []string{"trusted", "untrusted", "redirect"} {
		t.Run(variant, func(t *testing.T) {
			var calls, redirected atomic.Int32
			target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { redirected.Add(1) }))
			defer target.Close()
			s := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if variant == "redirect" {
					http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
					return
				}
				reply(t, w, r)
			}))
			defer s.Close()
			f := fixture(t, s.URL)
			if variant != "untrusted" {
				f.config.CAFile = filepath.Join(filepath.Dir(f.path), "ca.pem")
				ca := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: s.TLS.Certificates[0].Certificate[0]})
				_ = os.WriteFile(f.config.CAFile, ca, 0644)
				f.writeConfig(t)
			}
			_, err := f.run(t, true)
			if (err == nil) != (variant == "trusted") || redirected.Load() != 0 {
				t.Fatal("TLS or redirect policy failed", err)
			}
			if variant == "untrusted" && calls.Load() != 0 {
				t.Fatal("untrusted server received credential")
			}
		})
	}
}
