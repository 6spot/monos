package control

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func backendOrigin(endpoint string) (*url.URL, error) {
	parsed, err := url.Parse(endpoint)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.Hostname() == "" || parsed.User != nil || parsed.Opaque != "" || (parsed.Path != "" && parsed.Path != "/") || parsed.RawPath != "" || parsed.RawQuery != "" || parsed.ForceQuery || strings.Contains(endpoint, "#") {
		return nil, fmt.Errorf("HTTP or HTTPS backend origin required")
	}
	return parsed, nil
}

// NewHTTPClient shares the Runner/CLI origin and TLS policy. A nil CA uses system
// trust. An explicitly supplied CA is validated even for an HTTP origin.
func NewHTTPClient(endpoint string, ca []byte) (*http.Client, error) {
	if _, err := backendOrigin(endpoint); err != nil {
		return nil, err
	}
	var roots *x509.CertPool
	if ca != nil {
		var err error
		roots, err = x509.SystemCertPool()
		if err != nil {
			return nil, fmt.Errorf("system trust unavailable: %w", err)
		}
		if !roots.AppendCertsFromPEM(ca) {
			return nil, fmt.Errorf("invalid trusted CA")
		}
	}
	return &http.Client{
		Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}},
		Timeout:   15 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}, nil
}
