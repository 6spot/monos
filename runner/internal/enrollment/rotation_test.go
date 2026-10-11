package enrollment

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	protocol "monos.local/protocol"
)

type rotationFixture struct {
	enrollmentFixture
	grant    protocol.RunnerRotationGrant
	previous []byte
}

func rotationSetup(t *testing.T, endpoint string, rawToken bool) rotationFixture {
	t.Helper()
	f := rotationFixture{enrollmentFixture: fixture(t, endpoint), grant: protocol.RunnerRotationGrant{
		SchemaVersion: 1, RunnerID: "existing-runner", RotationID: "rotation-grant", RotationToken: strings.Repeat("g", 43),
		ExpiresAt: time.Now().Add(time.Hour).UTC().Format("2006-01-02T15:04:05.000Z"),
	}}
	f.previous, _ = json.Marshal(protocol.RunnerCredential{SchemaVersion: 1, RunnerID: f.grant.RunnerID, Credential: strings.Repeat("p", 43)})
	if rawToken {
		f.config.RunnerID = f.grant.RunnerID
		f.previous = []byte(strings.Repeat("p", 43) + "\n")
		f.writeConfig(t)
	}
	if err := os.WriteFile(f.config.TokenFile, f.previous, 0600); err != nil {
		t.Fatal(err)
	}
	for _, suffix := range []string{"", "-wal", "-shm"} {
		if err := os.WriteFile(f.config.Journal+suffix, []byte("retained execution"+suffix), 0600); err != nil {
			t.Fatal(err)
		}
	}
	return f
}

func (f rotationFixture) rotate(t *testing.T, withGrant bool) (string, error) {
	t.Helper()
	var raw []byte
	if withGrant {
		raw, _ = json.Marshal(f.grant)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return Rotate(ctx, f.path, bytes.NewReader(raw))
}

func (f rotationFixture) retained(t *testing.T) rotationPending {
	t.Helper()
	raw, err := os.ReadFile(f.config.TokenFile + ".rotate.pending")
	if err != nil {
		t.Fatal(err)
	}
	var state rotationPending
	if json.Unmarshal(raw, &state) != nil {
		t.Fatal("invalid retained rotation")
	}
	return state
}

func (f rotationFixture) assertPreserved(t *testing.T) {
	t.Helper()
	for _, suffix := range []string{"", "-wal", "-shm"} {
		raw, err := os.ReadFile(f.config.Journal + suffix)
		if err != nil || string(raw) != "retained execution"+suffix {
			t.Fatal("rotation changed execution ownership files")
		}
	}
}

func rotationReply(t *testing.T, w http.ResponseWriter, r *http.Request) protocol.RunnerRotationRequest {
	t.Helper()
	if r.Method != http.MethodPost || r.URL.Path != "/v1/runner/rotate-credential" || r.Header.Get("Authorization") != "" {
		t.Error("rotation transport scope changed")
	}
	var request protocol.RunnerRotationRequest
	if json.NewDecoder(r.Body).Decode(&request) != nil {
		t.Error("invalid rotation request")
	}
	_ = json.NewEncoder(w).Encode(protocol.RunnerRotationResponse{SchemaVersion: 1, RunnerID: request.RunnerID, RequestID: request.RequestID})
	return request
}

func TestRotationLostResponseReplaysExactIntentAfterExpiry(t *testing.T) {
	var f rotationFixture
	var calls atomic.Int32
	var first atomic.Pointer[protocol.RunnerRotationRequest]
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request protocol.RunnerRotationRequest
		if json.NewDecoder(r.Body).Decode(&request) != nil {
			t.Error("invalid request")
		}
		if f.retained(t).Request != request {
			t.Error("rotation sent before persisting exact intent")
		}
		if calls.Add(1) == 1 {
			first.Store(&request)
			conn, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				t.Error(err)
				return
			}
			_ = conn.Close()
			return
		}
		if first.Load() == nil || *first.Load() != request {
			t.Error("rotation replay changed its request or credential")
		}
		_ = json.NewEncoder(w).Encode(protocol.RunnerRotationResponse{SchemaVersion: 1, RunnerID: request.RunnerID, RequestID: request.RequestID})
	}))
	defer s.Close()
	f = rotationSetup(t, s.URL, false)
	// The first wire validation compiles schemas under the race detector; keep
	// the initial grant valid through that work, then actually wait for expiry.
	f.grant.ExpiresAt = time.Now().Add(time.Second).UTC().Format("2006-01-02T15:04:05.000Z")
	if _, err := f.rotate(t, true); err == nil || first.Load() == nil || strings.Contains(err.Error(), f.grant.RotationToken) || strings.Contains(err.Error(), first.Load().Credential) {
		t.Fatal("lost response reported success or exposed a credential")
	}
	current, _ := os.ReadFile(f.config.TokenFile)
	if !bytes.Equal(current, f.previous) || f.retained(t).Response != nil {
		t.Fatal("uncertain rotation replaced current identity")
	}
	expires, _ := time.Parse("2006-01-02T15:04:05.000Z", f.grant.ExpiresAt)
	if remaining := time.Until(expires) + time.Millisecond; remaining > 0 {
		time.Sleep(remaining)
	}
	if id, err := f.rotate(t, false); err != nil || id != f.grant.RunnerID || calls.Load() != 2 {
		t.Fatal("exact retained rotation did not recover after expiry", err)
	}
	var identity protocol.RunnerCredential
	current, _ = os.ReadFile(f.config.TokenFile)
	if json.Unmarshal(current, &identity) != nil || identity.Credential != first.Load().Credential || identity.RunnerID != first.Load().RunnerID {
		t.Fatal("rotation installed a different identity")
	}
	f.assertPreserved(t)
}

func TestRotationRecoversConfirmedReplacementWithoutAnotherRequest(t *testing.T) {
	for _, rawToken := range []bool{false, true} {
		t.Run(map[bool]string{false: "identity", true: "raw-token"}[rawToken], func(t *testing.T) {
			var f rotationFixture
			var calls atomic.Int32
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				_ = os.WriteFile(f.config.TokenFile, []byte("unrelated replacement"), 0600)
				rotationReply(t, w, r)
			}))
			defer s.Close()
			f = rotationSetup(t, s.URL, rawToken)
			configBefore, _ := os.ReadFile(f.path)
			if _, err := f.rotate(t, true); err == nil {
				t.Fatal("foreign replacement was overwritten")
			}
			state := f.retained(t)
			if state.Response == nil {
				t.Fatal("confirmed response was not persisted before replacement")
			}
			current, _ := os.ReadFile(f.config.TokenFile)
			if string(current) != "unrelated replacement" {
				t.Fatal("foreign identity changed")
			}
			// Recover the precise original before-rename state or the precise
			// after-rename state. Neither case may send the remote request again.
			next, _ := json.Marshal(protocol.RunnerCredential{SchemaVersion: 1, RunnerID: state.Request.RunnerID, Credential: state.Request.Credential})
			if rawToken {
				next = []byte(state.Request.Credential + "\n")
				_ = os.WriteFile(f.config.TokenFile, next, 0600)
			} else {
				_ = os.WriteFile(f.config.TokenFile, f.previous, 0600)
			}
			if id, err := f.rotate(t, false); err != nil || id != f.grant.RunnerID || calls.Load() != 1 {
				t.Fatal("confirmed replacement did not recover offline", err)
			}
			current, _ = os.ReadFile(f.config.TokenFile)
			info, _ := os.Stat(f.config.TokenFile)
			if !bytes.Equal(current, next) || info.Mode().Perm() != 0600 {
				t.Fatal("wrong or nonprivate rotated identity")
			}
			if _, err := os.Stat(f.config.TokenFile + ".rotate.pending"); !os.IsNotExist(err) {
				t.Fatal("confirmed rotation intent was not retired")
			}
			configAfter, _ := os.ReadFile(f.path)
			if !bytes.Equal(configBefore, configAfter) {
				t.Fatal("rotation modified configuration")
			}
			f.assertPreserved(t)
		})
	}
}

func TestRotationRejectsForeignResponseWithoutSecretDisclosure(t *testing.T) {
	var credential atomic.Value
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request protocol.RunnerRotationRequest
		_ = json.NewDecoder(r.Body).Decode(&request)
		credential.Store(request.Credential)
		_ = json.NewEncoder(w).Encode(map[string]any{"schema_version": 1, "runner_id": "foreign-runner", "request_id": request.RequestID, "secret": request.Credential})
	}))
	defer s.Close()
	f := rotationSetup(t, s.URL, false)
	if _, err := f.rotate(t, true); err == nil || credential.Load() == nil || strings.Contains(err.Error(), credential.Load().(string)) || strings.Contains(err.Error(), f.grant.RotationToken) {
		t.Fatal("foreign response accepted or exposed credential")
	}
	current, _ := os.ReadFile(f.config.TokenFile)
	if !bytes.Equal(current, f.previous) || f.retained(t).Response != nil {
		t.Fatal("invalid response became replacement authority")
	}
	f.assertPreserved(t)
}
