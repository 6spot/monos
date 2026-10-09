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
	cmd := discoveryCommand(context.Background(), 1000, 1000)
	if !reflect.DeepEqual(cmd.Args, []string{Runtime, "--version"}) || cmd.Dir != "/home/me" {
		t.Fatal("discovery command changed")
	}
	cred := cmd.SysProcAttr.Credential
	if cred == nil || cred.Uid != 1000 || cred.Gid != 1000 || !reflect.DeepEqual(cred.Groups, []uint32{1000}) {
		t.Fatal("discovery retained privileged identity")
	}
	for _, entry := range cmd.Env {
		if strings.Contains(entry, "TOKEN") || strings.Contains(entry, "SECRET") {
			t.Fatal("service secret in discovery environment")
		}
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
		if version, ok := runtimeVersion(raw); !ok || version != "2.0.20" {
			t.Fatal("installed version not recognized", version, ok)
		}
	}
	for _, raw := range []string{"other v2.0.20", "opencode v2.0.20\nprivate diagnostic", "opencode v"} {
		if _, ok := runtimeVersion(raw); ok {
			t.Fatal("diagnostic accepted as version")
		}
	}
}
