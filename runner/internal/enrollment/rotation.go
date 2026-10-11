package enrollment

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"reflect"
	"strings"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/control"
	"monos.local/runner/internal/enrollment/storage"
	"monos.local/runner/internal/wire"
)

type rotationPending struct {
	ConfigPath     string                           `json:"config_path"`
	ConfigDigest   string                           `json:"config_digest"`
	CADigest       string                           `json:"ca_digest"`
	PreviousDigest string                           `json:"previous_digest"`
	Grant          protocol.RunnerRotationGrant     `json:"grant"`
	Request        protocol.RunnerRotationRequest   `json:"request"`
	Response       *protocol.RunnerRotationResponse `json:"response,omitempty"`
}

// Rotate replaces only the same Runner's service credential. It never opens or
// changes the execution journal, workspaces, manifests or process identities.
// EOF resumes the exact fsynced intent after a lost response or interrupted rename.
func Rotate(ctx context.Context, configPath string, input io.Reader) (string, error) {
	if os.Geteuid() == 0 {
		return "", fmt.Errorf("Runner must use dedicated service account")
	}
	config, configRaw, err := control.ReadConfig(configPath)
	if err != nil {
		return "", err
	}
	dir, name, err := storage.OpenParent(config.TokenFile, true)
	if err != nil {
		return "", fmt.Errorf("Runner identity directory unavailable or unsafe")
	}
	defer dir.Close()
	lock, err := dir.Lock(name + ".enroll.lock")
	if err != nil {
		return "", fmt.Errorf("Runner identity maintenance already running or unsafe")
	}
	defer lock.Close()
	for _, reserved := range []string{config.TokenFile, config.TokenFile + ".rotate.pending", config.TokenFile + ".enroll.lock"} {
		if reserved == configPath || reserved == config.CAFile || reserved == config.Journal || reserved == config.Journal+"-wal" || reserved == config.Journal+"-shm" {
			return "", fmt.Errorf("Runner maintenance paths overlap")
		}
	}
	current, err := dir.Read(name, 4096, true)
	if err != nil {
		return "", fmt.Errorf("existing Runner identity unavailable or unsafe")
	}
	runnerID := config.RunnerID
	if runnerID == "" {
		var identity protocol.RunnerCredential
		if wire.Decode("RunnerCredential", current, &identity) != nil {
			return "", fmt.Errorf("invalid Runner identity")
		}
		runnerID = identity.RunnerID
	}
	var ca []byte
	if config.CAFile != "" {
		ca, err = storage.Read(config.CAFile, 1024*1024, false)
		if err != nil {
			return "", fmt.Errorf("Runner trust configuration unavailable or unsafe")
		}
	}
	client, err := control.NewHTTPClient(config.Endpoint, ca)
	if err != nil {
		return "", fmt.Errorf("invalid rotation transport configuration")
	}
	defer client.CloseIdleConnections()
	grantRaw, err := io.ReadAll(io.LimitReader(input, 4097))
	if err != nil || len(grantRaw) > 4096 {
		return "", fmt.Errorf("invalid rotation grant input")
	}
	var grant *protocol.RunnerRotationGrant
	if len(bytes.TrimSpace(grantRaw)) > 0 {
		grant = new(protocol.RunnerRotationGrant)
		if wire.Decode("RunnerRotationGrant", grantRaw, grant) != nil || grant.RunnerID != runnerID {
			return "", fmt.Errorf("rotation grant belongs to a different Runner or is invalid")
		}
	}
	state := rotationPending{ConfigPath: configPath, ConfigDigest: hash(configRaw), CADigest: hash(ca), PreviousDigest: hash(current)}
	stateName := name + ".rotate.pending"
	saved, err := dir.Read(stateName, 16384, true)
	if err == nil {
		var retained rotationPending
		decoder := json.NewDecoder(bytes.NewReader(saved))
		decoder.DisallowUnknownFields()
		if _, _, e := wire.CanonicalRaw(saved); e != nil {
			return "", fmt.Errorf("invalid retained rotation")
		}
		if decoder.Decode(&retained) != nil || !validRotation(retained) || retained.ConfigPath != state.ConfigPath || retained.ConfigDigest != state.ConfigDigest || retained.CADigest != state.CADigest || retained.Request.RunnerID != runnerID {
			return "", fmt.Errorf("retained rotation configuration differs or is invalid")
		}
		if grant != nil && !reflect.DeepEqual(*grant, retained.Grant) {
			return "", fmt.Errorf("rotation grant differs from retained intent")
		}
		state = retained
	} else if errors.Is(err, os.ErrNotExist) {
		if grant == nil {
			return "", fmt.Errorf("rotation grant required on stdin")
		}
		expires, e := time.Parse("2006-01-02T15:04:05.000Z", grant.ExpiresAt)
		if e != nil || !time.Now().Before(expires) {
			return "", fmt.Errorf("rotation grant expired")
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
		state.Request = protocol.RunnerRotationRequest{SchemaVersion: 1, RunnerID: runnerID, RequestID: requestID, RotationToken: grant.RotationToken, Credential: credential}
	} else {
		return "", fmt.Errorf("retained rotation unavailable or unsafe")
	}
	identity := protocol.RunnerCredential{SchemaVersion: 1, RunnerID: runnerID, Credential: state.Request.Credential}
	next, _ := json.Marshal(identity)
	if config.RunnerID != "" {
		next = []byte(state.Request.Credential + "\n")
	}
	if hash(current) != state.PreviousDigest && !bytes.Equal(current, next) {
		return "", fmt.Errorf("Runner identity changed outside this rotation")
	}
	saveState := func() error {
		raw, e := json.Marshal(state)
		if e != nil || len(raw) > 16384 || dir.Write(stateName, raw) != nil {
			return fmt.Errorf("rotation intent could not be persisted")
		}
		return nil
	}
	// Always resync recovered intent before sending it again.
	if err = saveState(); err != nil {
		return "", err
	}
	if state.Response == nil {
		response, e := exchangeRotation(ctx, client, config.Endpoint, state.Request)
		if e != nil {
			return "", e
		}
		state.Response = &response
		if err = saveState(); err != nil {
			return "", err
		}
	}
	_, configuration, e := control.ReadConfig(configPath)
	if e != nil || hash(configuration) != state.ConfigDigest {
		return "", fmt.Errorf("rotation configuration changed")
	}
	if config.CAFile != "" {
		currentCA, e := storage.Read(config.CAFile, 1024*1024, false)
		if e != nil || hash(currentCA) != state.CADigest {
			return "", fmt.Errorf("rotation trust configuration changed")
		}
	}
	// All identity writers hold the same descriptor-anchored lock. Refuse an
	// unexpected replacement even if the remote rotation already succeeded.
	current, e = dir.Read(name, 4096, true)
	if e != nil || hash(current) != state.PreviousDigest && !bytes.Equal(current, next) {
		return "", fmt.Errorf("Runner identity conflicts with retained rotation")
	}
	if err = dir.Write(name, next); err != nil {
		return "", fmt.Errorf("Runner identity replacement incomplete; retry retained rotation")
	}
	if err = dir.Remove(stateName); err != nil {
		return "", fmt.Errorf("rotation cleanup incomplete; retry retained rotation")
	}
	return runnerID, nil
}

func validRotation(state rotationPending) bool {
	for _, item := range []struct {
		name  string
		value any
	}{{"RunnerRotationGrant", state.Grant}, {"RunnerRotationRequest", state.Request}} {
		raw, _ := json.Marshal(item.value)
		if wire.Validate(item.name, raw) != nil {
			return false
		}
	}
	if len(state.PreviousDigest) != 64 || state.Request.RunnerID != state.Grant.RunnerID || state.Request.RotationToken != state.Grant.RotationToken {
		return false
	}
	if state.Response != nil {
		raw, _ := json.Marshal(state.Response)
		if wire.Validate("RunnerRotationResponse", raw) != nil || state.Response.RunnerID != state.Request.RunnerID || state.Response.RequestID != state.Request.RequestID {
			return false
		}
	}
	return true
}

func exchangeRotation(ctx context.Context, client *http.Client, endpoint string, request protocol.RunnerRotationRequest) (protocol.RunnerRotationResponse, error) {
	var result protocol.RunnerRotationResponse
	raw, _ := json.Marshal(request)
	if wire.Validate("RunnerRotationRequest", raw) != nil {
		return result, fmt.Errorf("invalid rotation request")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(endpoint, "/")+"/v1/runner/rotate-credential", bytes.NewReader(raw))
	if err != nil {
		return result, fmt.Errorf("invalid rotation endpoint")
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := client.Do(req)
	if err != nil {
		return result, fmt.Errorf("rotation unavailable; retry retained rotation")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return result, fmt.Errorf("rotation rejected: HTTP %d", response.StatusCode)
	}
	raw, err = io.ReadAll(io.LimitReader(response.Body, 4097))
	if err != nil || len(raw) > 4096 || wire.Decode("RunnerRotationResponse", raw, &result) != nil || result.RequestID != request.RequestID || result.RunnerID != request.RunnerID {
		return protocol.RunnerRotationResponse{}, fmt.Errorf("invalid rotation response; retained rotation preserved")
	}
	return result, nil
}
