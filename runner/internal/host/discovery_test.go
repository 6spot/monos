package host

import (
	"context"
	"reflect"
	"strings"
	"testing"
)

func TestDiscoveryFixedExecutionIdentity(t *testing.T) {
	if err := ValidateRequest(Request{Action: "discover"}); err != nil {
		t.Fatal(err)
	}
	if err := ValidateRequest(Request{Action: "discover", AttemptID: "caller-attempt"}); err == nil {
		t.Fatal("accepted execution fields")
	}
	for _, row := range UnavailableRuntimes() {
		cmd, err := discoveryCommand(context.Background(), row.RuntimeID, 1000, 1000)
		if err != nil || !reflect.DeepEqual(cmd.Args, []string{row.Executable, "--version"}) || cmd.Dir != "/home/me" {
			t.Fatal("discovery command changed", err)
		}
		cred := cmd.SysProcAttr.Credential
		if cred == nil || cred.Uid != 1000 || cred.Gid != 1000 || !reflect.DeepEqual(cred.Groups, []uint32{1000}) {
			t.Fatal("discovery retained privileged identity")
		}
		if !cmd.SysProcAttr.Setpgid || cmd.Cancel == nil {
			t.Fatal("discovery lost group cancellation")
		}
		for _, entry := range cmd.Env {
			if strings.Contains(entry, "TOKEN") || strings.Contains(entry, "SECRET") {
				t.Fatal("service secret in discovery environment")
			}
		}
	}
	if _, err := discoveryCommand(context.Background(), "/tmp/caller-cli", 1000, 1000); err == nil {
		t.Fatal("accepted caller-selected executable")
	}
	var output discoveryOutput
	if _, err := output.Write([]byte(strings.Repeat("x", 4097))); err == nil || !output.exceeded {
		t.Fatal("unbounded discovery output")
	}
	if versionPattern.MatchString("1.18.30\nsecret=value") || !versionPattern.MatchString("1.18.30") {
		t.Fatal("invalid version parsing")
	}
}

func TestDiscoveryVersionOutput(t *testing.T) {
	for _, raw := range []string{"2.0.20", "opencode v2.0.20\n"} {
		if version, ok := runtimeVersion("opencode", raw); !ok || version != "2.0.20" {
			t.Fatal("installed version not recognized", version, ok)
		}
	}
	for _, raw := range []string{"other v2.0.20", "opencode v2.0.20\nprivate diagnostic", "opencode v"} {
		if _, ok := runtimeVersion("opencode", raw); ok {
			t.Fatal("diagnostic accepted as version")
		}
	}
}

func TestCodexDiscoveryVersionContract(t *testing.T) {
	for _, version := range []string{"0.162.1", "0.162.2", "0.163.0", "1.0.0", "0.162.1+build.2"} {
		parsed, ok := runtimeVersion("codex", "codex-cli "+version+"\n")
		if !ok || parsed != version || !supportedCodexVersion(parsed) {
			t.Fatalf("supported Codex version rejected: %q", version)
		}
	}
	for _, version := range []string{"0.162.0", "0.161.20", "0.163.0-alpha.1", "0.162.1-rc.1", "999999999999.0.0"} {
		if supportedCodexVersion(version) {
			t.Fatalf("unsupported Codex version accepted: %q", version)
		}
	}
	for _, output := range []string{"0.162.1", "codex 0.162.1", "codex-cli v0.162.1", "codex-cli 0.162.1\nprivate diagnostic", "opencode v0.162.1"} {
		if _, ok := runtimeVersion("codex", output); ok {
			t.Fatalf("unexpected Codex version output accepted: %q", output)
		}
	}
}
