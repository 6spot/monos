package control

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"encoding/pem"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	protocol "monos.local/protocol"
)

func configuredClient(t *testing.T, endpoint string, ca []byte) *Client {
	t.Helper()
	dir := t.TempDir()
	config := Config{Endpoint: endpoint, TokenFile: filepath.Join(dir, "token"), RunnerID: "runner"}
	if err := os.WriteFile(config.TokenFile, []byte("private-runner-test-token"), 0600); err != nil {
		t.Fatal(err)
	}
	if ca != nil {
		config.CAFile = filepath.Join(dir, "ca.pem")
		if err := os.WriteFile(config.CAFile, ca, 0600); err != nil {
			t.Fatal(err)
		}
	}
	client, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.HTTP.CloseIdleConnections)
	return client
}

func certificatePEM(server *httptest.Server) []byte {
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw})
}

func TestConfiguredRunnerReadsOverHTTPAndHTTPS(t *testing.T) {
	for _, secure := range []bool{false, true} {
		name := "http_without_ca"
		if secure {
			name = "https_with_ca"
		}
		t.Run(name, func(t *testing.T) {
			server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/v1/recovery/attempts/attempt/commands/request" || r.Header.Get("Authorization") != "Bearer private-runner-test-token" {
					t.Error("recovery read changed path or Runner credential")
				}
				_ = json.NewEncoder(w).Encode(protocol.CommandResult{SchemaVersion: 1, Status: "unknown"})
			}))
			var ca []byte
			if secure {
				server.StartTLS()
				ca = certificatePEM(server)
			} else {
				server.Start()
			}
			defer server.Close()
			client := configuredClient(t, server.URL+"/", ca)
			var result protocol.CommandResult
			if err := client.Get(context.Background(), "/v1/recovery/attempts/attempt/commands/request", "CommandResult", &result); err != nil || result.Status != "unknown" {
				t.Fatalf("scoped recovery read failed: %+v %v", result, err)
			}
		})
	}
}

func TestTransportRejectsNonOriginEndpoints(t *testing.T) {
	for _, endpoint := range []string{
		"", "ftp://backend", "ws://backend", "https://", "http://:8080",
		"https://user:password@backend", "https://backend/api", "https://backend//",
		"https://backend/%2f", "https://backend?query", "https://backend?",
		"https://backend#fragment", "https://backend#", "https:backend",
	} {
		t.Run(endpoint, func(t *testing.T) {
			if _, err := NewHTTPClient(endpoint, nil); err == nil {
				t.Fatal("invalid backend origin accepted")
			}
		})
	}
}

func TestConfiguredRunnerRejectsUnreadableOrInvalidCA(t *testing.T) {
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, ca := range []string{"", "not a certificate"} {
		path := filepath.Join(dir, "ca.pem")
		if err := os.WriteFile(path, []byte(ca), 0600); err != nil {
			t.Fatal(err)
		}
		for _, endpoint := range []string{"http://backend", "https://backend"} {
			if _, err := New(Config{Endpoint: endpoint, CAFile: path}); err == nil || !strings.Contains(err.Error(), "invalid trusted CA") {
				t.Fatalf("invalid explicit CA did not fail before credential access: %v", err)
			}
		}
	}
	if _, err := New(Config{Endpoint: "https://backend", CAFile: filepath.Join(dir, "missing")}); !os.IsNotExist(err) {
		t.Fatalf("unreadable explicit CA did not fail: %v", err)
	}
}

func TestHTTPSStillVerifiesCertificatesAndTLSVersion(t *testing.T) {
	for _, mode := range []string{"system_roots_reject_untrusted", "wrong_hostname", "tls_1_1"} {
		t.Run(mode, func(t *testing.T) {
			var reached atomic.Int32
			server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				reached.Add(1)
				w.WriteHeader(http.StatusOK)
			}))
			server.Config.ErrorLog = log.New(io.Discard, "", 0)
			if mode == "tls_1_1" {
				server.TLS = &tls.Config{MinVersion: tls.VersionTLS10, MaxVersion: tls.VersionTLS11}
			}
			server.StartTLS()
			defer server.Close()
			endpoint := server.URL
			ca := certificatePEM(server)
			if mode == "system_roots_reject_untrusted" {
				ca = nil
			} else if mode == "wrong_hostname" {
				endpoint = strings.Replace(endpoint, "127.0.0.1", "localhost", 1)
			}
			client := configuredClient(t, endpoint, ca)
			transport := client.HTTP.Transport.(*http.Transport)
			if ca == nil && transport.TLSClientConfig.RootCAs != nil {
				t.Fatal("omitted CA replaced system trust")
			}
			response, err := client.HTTP.Get(endpoint)
			if response != nil {
				response.Body.Close()
			}
			if err == nil || reached.Load() != 0 {
				t.Fatalf("TLS rejection failed: reached=%d err=%v", reached.Load(), err)
			}
		})
	}
}

func TestHTTPTransportDoesNotFollowCredentialedRedirects(t *testing.T) {
	var reached atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached.Add(1) }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	client := configuredClient(t, server.URL, nil)
	var result protocol.CommandResult
	if err := client.Get(context.Background(), "/receipt", "CommandResult", &result); err == nil {
		t.Fatal("redirect treated as a receipt")
	}
	if _, err := Submit(context.Background(), client.HTTP, server.URL, "attempt-credential", []byte(`{}`), strings.Repeat("a", 64)); err == nil {
		t.Fatal("redirect treated as a command result")
	}
	if reached.Load() != 0 {
		t.Fatal("credentialed read or submission followed redirect")
	}
}
