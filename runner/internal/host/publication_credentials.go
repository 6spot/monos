package host

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	protocol "monos.local/protocol"
)

const publicationAskpass = "#!/bin/sh\ncase \"$1\" in\n  *Username*) /usr/bin/printf '%s\\n' x-access-token ;;\n  *Password*) /bin/cat <&3 ;;\n  *) exit 78 ;;\nesac\n"

func installPublicationAskpass(dir string) (string, error) {
	path := filepath.Join(dir, "askpass")
	if raw, e := os.ReadFile(path); e == nil {
		s, se := os.Lstat(path)
		if se != nil || trustedFile(path, uint32(os.Geteuid())) != nil || s.Mode().Perm() != 0700 || string(raw) != publicationAskpass {
			return "", errors.New("publication credential plumbing unavailable")
		}
		return path, nil
	} else if !os.IsNotExist(e) {
		return "", errors.New("publication credential plumbing unavailable")
	}
	f, e := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0700)
	if e != nil {
		return "", errors.New("publication credential plumbing unavailable")
	}
	_, e = f.WriteString(publicationAskpass)
	if e == nil {
		e = f.Sync()
	}
	ce := f.Close()
	if e != nil || ce != nil || syncDirectory(dir) != nil {
		return "", errors.New("publication credential plumbing unavailable")
	}
	return path, nil
}

func validPublicationAuthentication(a protocol.PublicationAccessResult) bool {
	if a.Authentication.Kind != "github_installation" || a.Authentication.Token == nil || a.Authentication.ExpiresAt == nil {
		return false
	}
	token := *a.Authentication.Token
	expires, e := time.Parse(time.RFC3339Nano, *a.Authentication.ExpiresAt)
	return e == nil && expires.After(time.Now().Add(30*time.Second)) && len(token) >= 16 && len(token) <= 16384 && !strings.ContainsAny(token, "\x00\r\n")
}

// The token is written only into an anonymous inherited pipe. The child receives
// a fixed askpass script path and FD number, never a secret environment/argument,
// URL, Git config entry, log, journal record or credential file.
func runPublicationAuthenticatedGit(ctx context.Context, store, op string, access protocol.PublicationAccessResult, guard *publicationPushGuard, onStart func(publicationRemoteWorker) error) (publicationRemoteExecution, error) {
	return runPublicationAuthenticatedGitArgs(ctx, store, op, access, guard, nil, onStart)
}

func runPublicationAuthenticatedGitArgs(ctx context.Context, store, op string, access protocol.PublicationAccessResult, guard *publicationPushGuard, localFixtureArgs []string, onStart func(publicationRemoteWorker) error) (publicationRemoteExecution, error) {
	if verifyPublicationStoreConfiguration(ctx, store) != nil {
		return publicationRemoteExecution{WorkerAbsent: true}, errors.New("publication store configuration unavailable")
	}
	if !validPublicationAuthentication(access) {
		return publicationRemoteExecution{WorkerAbsent: true}, errors.New("publication credentials unavailable")
	}
	askpass, e := installPublicationAskpass(op)
	if e != nil {
		return publicationRemoteExecution{WorkerAbsent: true}, e
	}
	var hooks string
	var guardEnv []string
	if guard != nil {
		hooks, guardEnv, e = installPublicationPushGuard(ctx, op, *guard)
		if e != nil {
			return publicationRemoteExecution{WorkerAbsent: true}, e
		}
	}
	read, write, e := os.Pipe()
	if e != nil {
		return publicationRemoteExecution{WorkerAbsent: true}, errors.New("publication credentials unavailable")
	}
	defer read.Close()
	defer write.Close()
	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _ = io.WriteString(write, *access.Authentication.Token+"\n")
		_ = write.Close()
	}()
	out, e := runPublicationRemoteProcess(ctx, func(ctx context.Context) *exec.Cmd {
		args := []string{"--no-replace-objects", "--git-dir=" + store, "-c", "safe.directory=" + store, "-c", "credential.helper=", "-c", "http.followRedirects=false", "-c", "http.sslVerify=true", "-c", "http.proxy=", "-c", "http.lowSpeedLimit=1", "-c", "http.lowSpeedTime=20", "-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "core.hooksPath=/dev/null"}
		if localFixtureArgs != nil {
			args = append(args, localFixtureArgs...)
		} else if guard == nil {
			args = append(args, "ls-remote", "--refs", access.RemoteURL, access.DeliveryRef)
		} else {
			args = append(args, "-c", "core.hooksPath="+hooks, "-c", "push.followTags=false", "push", "--porcelain", "--no-follow-tags", "--recurse-submodules=no", guard.destination, guard.head+":"+guard.ref)
		}
		cmd := exec.CommandContext(ctx, "/usr/bin/git", args...)
		cmd.Env = append(publicationGitEnvironment(), "GIT_ASKPASS="+askpass, "SSH_ASKPASS=/dev/null")
		cmd.Env = append(cmd.Env, guardEnv...)
		cmd.ExtraFiles = []*os.File{read}
		return cmd
	}, onStart)
	_ = read.Close()
	_ = write.Close()
	<-done
	return out, e
}
