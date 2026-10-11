// Package enrollment installs a Runner identity without touching execution state.
package enrollment

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/control"
	"monos.local/runner/internal/enrollment/storage"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/wire"
)

type pending struct {
	SchemaVersion int64                              `json:"schema_version"`
	ConfigPath    string                             `json:"config_path"`
	ConfigDigest  string                             `json:"config_digest"`
	Endpoint      string                             `json:"endpoint"`
	CADigest      string                             `json:"ca_digest"`
	Grant         protocol.RunnerEnrollmentGrant     `json:"grant"`
	Request       protocol.RunnerEnrollmentRequest   `json:"request"`
	Response      *protocol.RunnerEnrollmentResponse `json:"response,omitempty"`
}

func hash(raw []byte) string { sum := sha256.Sum256(raw); return hex.EncodeToString(sum[:]) }
func secret() (string, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", fmt.Errorf("enrollment randomness unavailable")
	}
	return base64.RawURLEncoding.EncodeToString(raw[:]), nil
}

// Enroll reads a grant from stdin, or replays retained intent on EOF. Errors never
// contain response content, credentials, filesystem paths or endpoint details.
func Enroll(ctx context.Context, configPath string, input io.Reader) (string, error) {
	if os.Geteuid() == 0 {
		return "", fmt.Errorf("Runner must use dedicated service account")
	}
	config, configRaw, err := control.ReadConfig(configPath)
	if err != nil {
		return "", err
	}
	if config.RunnerID != "" {
		return "", fmt.Errorf("Runner is already configured")
	}
	if config.Socket != host.Socket || config.ExecutionUID == 0 || config.ExecutionUID == uint32(os.Geteuid()) || !filepath.IsAbs(config.Journal) || filepath.Clean(config.Journal) != config.Journal {
		return "", fmt.Errorf("invalid enrollment configuration")
	}
	dir, name, err := storage.OpenParent(config.TokenFile, true)
	if err != nil {
		return "", fmt.Errorf("Runner identity directory unavailable or unsafe")
	}
	defer dir.Close()
	for _, reserved := range []string{config.TokenFile, config.TokenFile + ".enroll.lock", config.TokenFile + ".enroll.pending", config.TokenFile + ".enroll.install"} {
		if reserved == configPath || reserved == config.CAFile || reserved == config.Journal || reserved == config.Journal+"-wal" || reserved == config.Journal+"-shm" {
			return "", fmt.Errorf("enrollment paths overlap")
		}
	}
	lock, err := dir.Lock(name + ".enroll.lock")
	if err != nil {
		return "", fmt.Errorf("enrollment lock unavailable or unsafe")
	}
	defer lock.Close()
	var ca []byte
	if config.CAFile != "" {
		ca, err = storage.Read(config.CAFile, 1024*1024, false)
		if err != nil {
			return "", fmt.Errorf("enrollment trust configuration unavailable or unsafe")
		}
	}
	client, err := control.NewHTTPClient(config.Endpoint, ca)
	if err != nil {
		return "", fmt.Errorf("invalid enrollment transport configuration")
	}
	defer client.CloseIdleConnections()
	grantRaw, err := io.ReadAll(io.LimitReader(input, 4097))
	if err != nil || len(grantRaw) > 4096 {
		return "", fmt.Errorf("invalid enrollment grant input")
	}
	var grant *protocol.RunnerEnrollmentGrant
	if len(bytes.TrimSpace(grantRaw)) != 0 {
		grant = new(protocol.RunnerEnrollmentGrant)
		if err = wire.Decode("RunnerEnrollmentGrant", grantRaw, grant); err != nil {
			return "", fmt.Errorf("invalid enrollment grant")
		}
		if _, err = time.Parse("2006-01-02T15:04:05.000Z", grant.ExpiresAt); err != nil {
			return "", fmt.Errorf("invalid enrollment expiry")
		}
	}
	state := pending{SchemaVersion: 1, ConfigPath: configPath, ConfigDigest: hash(configRaw), Endpoint: config.Endpoint, CADigest: hash(ca)}
	stateName := name + ".enroll.pending"
	saved, err := dir.Read(stateName, 16384, true)
	if err == nil {
		var retained pending
		decoder := json.NewDecoder(bytes.NewReader(saved))
		decoder.DisallowUnknownFields()
		if _, _, e := wire.CanonicalRaw(saved); e != nil {
			return "", fmt.Errorf("invalid retained enrollment")
		}
		if e := decoder.Decode(&retained); e != nil {
			return "", fmt.Errorf("invalid retained enrollment")
		}
		if retained.SchemaVersion != 1 || retained.ConfigPath != state.ConfigPath || retained.ConfigDigest != state.ConfigDigest || retained.Endpoint != state.Endpoint || retained.CADigest != state.CADigest {
			return "", fmt.Errorf("enrollment configuration changed")
		}
		if !validState(retained) {
			return "", fmt.Errorf("invalid retained enrollment")
		}
		if grant != nil && !reflect.DeepEqual(*grant, retained.Grant) {
			return "", fmt.Errorf("enrollment grant differs from retained intent")
		}
		state = retained
	} else if errors.Is(err, os.ErrNotExist) {
		for _, leaf := range []string{name, name + ".enroll.install"} {
			if exists, e := dir.Exists(leaf); e != nil || exists {
				return "", fmt.Errorf("Runner identity already exists or is unsafe")
			}
		}
		if err = requireUnusedJournal(config.Journal); err != nil {
			return "", err
		}
		if grant == nil {
			return "", fmt.Errorf("enrollment grant required on stdin")
		}
		expires, _ := time.Parse("2006-01-02T15:04:05.000Z", grant.ExpiresAt)
		if !time.Now().Before(expires) {
			return "", fmt.Errorf("enrollment grant expired")
		}
		credential, e := secret()
		if e != nil {
			return "", e
		}
		requestID, e := secret()
		if e != nil {
			return "", e
		}
		state.Grant = *grant
		state.Request = protocol.RunnerEnrollmentRequest{SchemaVersion: 1, RequestID: requestID, EnrollmentToken: grant.EnrollmentToken, Credential: credential}
		if err = save(dir, stateName, state); err != nil {
			return "", err
		}
	} else {
		return "", fmt.Errorf("retained enrollment unavailable or unsafe")
	}
	if state.Response == nil {
		if exists, e := dir.Exists(name); e != nil || exists {
			return "", fmt.Errorf("unconfirmed Runner identity already exists")
		}
		if err = requireUnusedJournal(config.Journal); err != nil {
			return "", err
		}
		// A prior process may have stopped after rename but before directory
		// sync. Re-establish file and directory durability before any replay.
		if err = save(dir, stateName, state); err != nil {
			return "", err
		}
		response, e := exchange(ctx, client, config.Endpoint, state.Request)
		if e != nil {
			return "", e
		}
		state.Response = &response
		if err = save(dir, stateName, state); err != nil {
			return "", err
		}
	}
	// Configuration can be edited while the request is in flight. Never install
	// a credential that a newly configured origin would receive on daemon start.
	_, currentConfig, err := control.ReadConfig(configPath)
	if err != nil || hash(currentConfig) != state.ConfigDigest {
		return "", fmt.Errorf("enrollment configuration changed")
	}
	if config.CAFile != "" {
		currentCA, e := storage.Read(config.CAFile, 1024*1024, false)
		if e != nil || hash(currentCA) != state.CADigest {
			return "", fmt.Errorf("enrollment trust configuration changed")
		}
	}
	identity := protocol.RunnerCredential{SchemaVersion: 1, RunnerID: state.Response.RunnerID, Credential: state.Request.Credential}
	raw, _ := json.Marshal(identity)
	if err = dir.PublishIdentity(name, raw, func() error { return requireUnusedJournal(config.Journal) }); err != nil {
		return "", fmt.Errorf("Runner identity installation incomplete or conflicting; retained enrollment preserved")
	}
	if err = dir.Remove(stateName); err != nil {
		return "", fmt.Errorf("enrollment cleanup incomplete; retry retained enrollment")
	}
	return identity.RunnerID, nil
}

func validState(state pending) bool {
	for _, item := range []struct {
		name  string
		value any
	}{{"RunnerEnrollmentGrant", state.Grant}, {"RunnerEnrollmentRequest", state.Request}} {
		raw, _ := json.Marshal(item.value)
		if wire.Validate(item.name, raw) != nil {
			return false
		}
	}
	if state.Request.EnrollmentToken != state.Grant.EnrollmentToken {
		return false
	}
	if _, err := time.Parse("2006-01-02T15:04:05.000Z", state.Grant.ExpiresAt); err != nil {
		return false
	}
	if state.Response != nil {
		raw, _ := json.Marshal(state.Response)
		if wire.Validate("RunnerEnrollmentResponse", raw) != nil || state.Response.RequestID != state.Request.RequestID {
			return false
		}
	}
	return true
}

func save(dir *storage.Directory, name string, state pending) error {
	raw, err := json.Marshal(state)
	if err != nil || len(raw) > 16384 || dir.Write(name, raw) != nil {
		return fmt.Errorf("enrollment intent could not be persisted")
	}
	return nil
}

func requireUnusedJournal(path string) error {
	dir, name, err := storage.OpenParent(path, true)
	if err != nil {
		return fmt.Errorf("execution journal location unavailable or unsafe")
	}
	defer dir.Close()
	for _, suffix := range []string{"", "-wal", "-shm"} {
		if exists, err := dir.Exists(name + suffix); err != nil || exists {
			return fmt.Errorf("existing execution journal prevents fresh enrollment")
		}
	}
	return nil
}

func exchange(ctx context.Context, client *http.Client, endpoint string, request protocol.RunnerEnrollmentRequest) (protocol.RunnerEnrollmentResponse, error) {
	var result protocol.RunnerEnrollmentResponse
	raw, _ := json.Marshal(request)
	if err := wire.Validate("RunnerEnrollmentRequest", raw); err != nil {
		return result, fmt.Errorf("invalid enrollment request")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(endpoint, "/")+"/v1/runner/enroll", bytes.NewReader(raw))
	if err != nil {
		return result, fmt.Errorf("invalid enrollment endpoint")
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := client.Do(req)
	if err != nil {
		return result, fmt.Errorf("enrollment unavailable; retry retained enrollment")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return result, fmt.Errorf("enrollment rejected: HTTP %d", response.StatusCode)
	}
	raw, err = io.ReadAll(io.LimitReader(response.Body, 4097))
	if err != nil || len(raw) > 4096 || wire.Decode("RunnerEnrollmentResponse", raw, &result) != nil || result.RequestID != request.RequestID {
		return protocol.RunnerEnrollmentResponse{}, fmt.Errorf("invalid enrollment response; retained enrollment preserved")
	}
	return result, nil
}
