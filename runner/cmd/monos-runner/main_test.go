package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/control"
	"monos.local/runner/internal/host"
)

func TestRunnerProcess(t *testing.T) {
	if os.Getenv("MONOS_RUNNER_TEST_PROCESS") != "1" {
		return
	}
	for i, arg := range os.Args {
		if arg == "--" {
			os.Args = append([]string{"monos-runner"}, os.Args[i+1:]...)
			break
		}
	}
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	os.Exit(0)
}

func runnerCommand(t *testing.T, input []byte, args ...string) ([]byte, error) {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(executable, append([]string{"-test.run=^TestRunnerProcess$", "--"}, args...)...)
	cmd.Env = append(os.Environ(), "MONOS_RUNNER_TEST_PROCESS=1")
	cmd.Stdin = bytes.NewReader(input)
	return cmd.CombinedOutput()
}

func TestRunnerEnrollmentCLIAndIdentityBeforeJournal(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("service-account CLI test")
	}
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	_ = os.Chmod(dir, 0700)
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request protocol.RunnerEnrollmentRequest
		if json.NewDecoder(r.Body).Decode(&request) != nil {
			t.Error("invalid CLI request")
		}
		_ = json.NewEncoder(w).Encode(protocol.RunnerEnrollmentResponse{SchemaVersion: 1, RequestID: request.RequestID, RunnerID: "cli-runner"})
	}))
	defer s.Close()
	config := control.Config{Endpoint: s.URL, TokenFile: filepath.Join(dir, "identity.json"), Journal: filepath.Join(dir, "journal.sqlite"), Socket: host.Socket, ExecutionUID: uint32(os.Geteuid() + 1)}
	raw, _ := json.Marshal(config)
	path := filepath.Join(dir, "runner.json")
	if err = os.WriteFile(path, raw, 0640); err != nil {
		t.Fatal(err)
	}
	output, err := runnerCommand(t, nil, "--config", path)
	if err == nil || !strings.Contains(string(output), "Runner identity unavailable") {
		t.Fatal("daemon did not reject missing identity")
	}
	if _, err = os.Stat(config.Journal); !os.IsNotExist(err) {
		t.Fatal("daemon opened journal before identity resolution")
	}
	grant := protocol.RunnerEnrollmentGrant{SchemaVersion: 1, EnrollmentID: "grant", EnrollmentToken: strings.Repeat("b", 43), ExpiresAt: time.Now().Add(time.Hour).UTC().Format("2006-01-02T15:04:05.000Z"), Capacity: 1}
	input, _ := json.Marshal(grant)
	output, err = runnerCommand(t, input, "enroll", "--config", path)
	if err != nil || string(output) != "Runner enrolled: cli-runner\n" {
		t.Fatal("CLI enrollment failed")
	}
	if _, err = os.Stat(config.Journal); !os.IsNotExist(err) {
		t.Fatal("enrollment touched journal")
	}
	for _, args := range [][]string{{"enroll", "--token=" + grant.EnrollmentToken}, {"enroll", grant.EnrollmentToken}} {
		output, err = runnerCommand(t, nil, args...)
		if err == nil || strings.Contains(string(output), grant.EnrollmentToken) {
			t.Fatal("CLI accepted or echoed an argv credential")
		}
	}
}
