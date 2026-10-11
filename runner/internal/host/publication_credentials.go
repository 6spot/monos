package host

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	protocol "monos.local/protocol"
)

const publicationAskpass = "#!/bin/sh\ncase \"$1\" in\n  *Username*) /bin/cat <&4 ;;\n  *Password*) /bin/cat <&3 ;;\n  *) exit 78 ;;\nesac\n"

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
	_, _, e := repositoryCredentials(a.RemoteURL, a.Authentication, 30*time.Second)
	return e == nil && (a.Purpose != "push" || a.Authentication.Kind != "anonymous")
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
	username, token, credentialErr := repositoryCredentials(access.RemoteURL, access.Authentication, 30*time.Second)
	if credentialErr != nil || (guard != nil || access.Purpose == "push") && access.Authentication.Kind == "anonymous" {
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
	var files []*os.File
	var writers []*os.File
	var completed []chan struct{}
	defer func() {
		for _, f := range files {
			_ = f.Close()
		}
		for _, f := range writers {
			_ = f.Close()
		}
		for _, done := range completed {
			<-done
		}
	}()
	if access.Authentication.Kind != "anonymous" {
		for _, input := range []string{token, username} {
			read, write, err := os.Pipe()
			if err != nil {
				return publicationRemoteExecution{WorkerAbsent: true}, errors.New("publication credentials unavailable")
			}
			files = append(files, read)
			writers = append(writers, write)
			done := make(chan struct{})
			completed = append(completed, done)
			go func(value string) { defer close(done); _, _ = io.WriteString(write, value+"\n"); _ = write.Close() }(input)
		}
	}
	if !validPublicationAuthentication(access) {
		return publicationRemoteExecution{WorkerAbsent: true}, errors.New("publication credentials expired")
	}
	out, e := runPublicationRemoteProcess(ctx, func(ctx context.Context) *exec.Cmd {
		args := []string{"--no-replace-objects", "--git-dir=" + store, "-c", "safe.directory=" + store, "-c", "credential.helper=", "-c", "http.followRedirects=false", "-c", "http.sslVerify=true", "-c", "http.proxy=", "-c", "http.lowSpeedLimit=1", "-c", "http.lowSpeedTime=20", "-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "core.hooksPath=/dev/null"}
		// Only private test/native-fixture callers supply overrides. A CA-only
		// prefix exercises the production command/guard without disabling TLS.
		fixture := localFixtureArgs
		for len(fixture) >= 2 && fixture[0] == "-c" {
			args = append(args, fixture[:2]...)
			fixture = fixture[2:]
		}
		if len(fixture) > 0 {
			args = append(args, fixture...)
		} else if guard == nil {
			args = append(args, "ls-remote", "--refs", access.RemoteURL, access.DeliveryRef)
		} else {
			args = append(args, "-c", "core.hooksPath="+hooks, "-c", "push.followTags=false", "push", "--porcelain", "--no-follow-tags", "--recurse-submodules=no", guard.destination, guard.head+":"+guard.ref)
		}
		cmd := exec.CommandContext(ctx, "/usr/bin/git", args...)
		cmd.Env = append(publicationGitEnvironment(), "GIT_ASKPASS="+askpass, "SSH_ASKPASS=/dev/null")
		if access.Authentication.Kind == "anonymous" {
			cmd.Env = append(publicationGitEnvironment(), "GIT_ASKPASS=/dev/null", "SSH_ASKPASS=/dev/null")
		}
		cmd.Env = append(cmd.Env, guardEnv...)
		cmd.ExtraFiles = files
		return cmd
	}, onStart)
	return out, e
}
