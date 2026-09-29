package host

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	protocol "monos.local/protocol"
)

func git(dir string, args ...string) (string, error) {
	return gitEnv(dir, nil, args...)
}
func gitEnv(dir string, extra []string, args ...string) (string, error) {
	scopes := []string{filepath.Join(Root, "cache", "fixture.git")}
	if strings.HasPrefix(filepath.Clean(dir), filepath.Join(Root, "tasks")+string(filepath.Separator)) {
		scopes = nil
	}
	return gitScoped(dir, scopes, extra, args...)
}
func gitScoped(dir string, additional, extra []string, args ...string) (string, error) {
	// Git 2.39's local clone transport removes GIT_CONFIG_PARAMETERS before
	// upload-pack, so argv -c alone does not authorize cross-account sources.
	// A private per-command protected config survives that subprocess boundary;
	// it never modifies the Owner's global config or authorizes a wildcard path.
	scopes := append([]string{dir}, additional...)
	for i := 0; i+1 < len(args) && args[i] == "-c"; i += 2 {
		if scope, ok := strings.CutPrefix(args[i+1], "safe.directory="); ok {
			scopes = append(scopes, scope)
		}
	}
	config, err := scopedGitConfig(scopes)
	if err != nil {
		return "", err
	}
	defer os.Remove(config)
	fixed := []string{"--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c", "core.fsync=committed,reference", "-c", "core.fsyncMethod=fsync"}
	fixed = append(fixed, args...)
	cmd := exec.Command("/usr/bin/git", fixed...)
	cmd.Dir = dir
	cmd.Env = []string{"PATH=/usr/bin:/bin", "HOME=/home/me", "LANG=C.UTF-8", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=" + config, "GIT_TERMINAL_PROMPT=0", "GIT_AUTHOR_NAME=monos probe", "GIT_AUTHOR_EMAIL=probe@monos.invalid", "GIT_COMMITTER_NAME=monos probe", "GIT_COMMITTER_EMAIL=probe@monos.invalid"}
	cmd.Env = append(cmd.Env, extra...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git operation failed: %s: %w", strings.TrimSpace(stderr.String()), err)
	}
	return strings.TrimSpace(string(output)), nil
}

func scopedGitConfig(scopes []string) (string, error) {
	var config strings.Builder
	config.WriteString("[core]\n\thooksPath = /dev/null\n\tfsync = committed,reference\n\tfsyncMethod = fsync\n[safe]\n")
	for _, path := range scopes {
		if !filepath.IsAbs(path) || strings.ContainsAny(path, "*?\r\n\x00") {
			return "", fmt.Errorf("invalid scoped Git directory")
		}
		config.WriteString("\tdirectory = " + strconv.Quote(path) + "\n")
	}
	file, err := os.CreateTemp("", "monos-git-config-*")
	if err != nil {
		return "", err
	}
	if _, err = file.WriteString(config.String()); err != nil {
		file.Close()
		os.Remove(file.Name())
		return "", err
	}
	if err = file.Close(); err != nil {
		os.Remove(file.Name())
		return "", err
	}
	return file.Name(), nil
}
func GitEffect(id string, kind protocol.OperationKind, operationID, base string) (protocol.EffectResult, error) {
	if !ValidID(id) || !ValidID(operationID) {
		return protocol.EffectResult{}, fmt.Errorf("invalid effect identity")
	}
	m, err := readManifest(id)
	if err != nil {
		return protocol.EffectResult{}, err
	}
	cache := filepath.Join(Root, "cache", "fixture.git")
	common := Path(id, "common")
	workspace := Path(id, "workspace")
	switch kind {
	case protocol.KindOpenWorkspace:
		if m.Dispatch.Kind != protocol.Node {
			return protocol.EffectResult{}, fmt.Errorf("Planner cannot open writable workspace")
		}
		if err = materialize(workspace, common, cache); err != nil {
			return protocol.EffectResult{}, err
		}
		return protocol.EffectResult{WorkspaceID: ptr(WorkspaceID("workspace", id)), Path: &workspace}, nil
	case protocol.KindInspectRepository:
		return protocol.EffectResult{}, fmt.Errorf("inspection belongs to service identity")
	case protocol.KindCompleteNode:
		if m.Dispatch.Kind != protocol.Node {
			return protocol.EffectResult{}, fmt.Errorf("only Node finalization")
		}
		return finalize(workspace, common, operationID, base)
	default:
		return protocol.EffectResult{}, fmt.Errorf("unsupported Git effect")
	}
}
func ptr[T any](v T) *T { return &v }
func WorkspaceID(kind, id string) string {
	sum := sha256.Sum256([]byte(id))
	return fmt.Sprintf("%s_%x", kind, sum[:])
}
func LoadDispatch(id string) (protocol.Dispatch, error) {
	m, err := readManifest(id)
	return m.Dispatch, err
}
