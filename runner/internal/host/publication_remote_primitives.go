package host

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Physical item exclusion is separate from retained remote-effect authority.
// Releasing this lock never makes an unfinished remote intent safe to replace.
type publicationRemoteItem struct {
	path string
	lock *os.File
}

func lockPublicationRemoteItem(ctx context.Context, root, itemID string) (*publicationRemoteItem, error) {
	if !ValidID(itemID) {
		return nil, errors.New("publication remote item unavailable")
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	for _, path := range []string{root, filepath.Join(root, "items"), filepath.Join(root, "items", itemID)} {
		if e := publicationDirectory(path); e != nil {
			return nil, e
		}
	}
	path := filepath.Join(root, "items", itemID)
	lock, e := acquireFileLock(ctx, filepath.Join(path, "lock"))
	if e != nil {
		return nil, e
	}
	if ctx.Err() != nil {
		releaseFileLock(lock)
		return nil, ctx.Err()
	}
	info, e := lock.Stat()
	if e != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || trustedFile(filepath.Join(path, "lock"), uint32(os.Geteuid())) != nil {
		releaseFileLock(lock)
		return nil, errors.New("publication remote item unavailable")
	}
	if lock.Sync() != nil || syncDirectory(path) != nil {
		releaseFileLock(lock)
		return nil, errors.New("publication remote item unavailable")
	}
	return &publicationRemoteItem{path: path, lock: lock}, nil
}

func (item *publicationRemoteItem) close() { releaseFileLock(item.lock) }

func (item *publicationRemoteItem) operationDirectory(operationID string) (string, error) {
	if !ValidID(operationID) {
		return "", errors.New("publication remote operation unavailable")
	}
	operations := filepath.Join(item.path, "operations")
	if e := publicationDirectory(operations); e != nil {
		return "", e
	}
	path := filepath.Join(operations, operationID)
	if e := publicationDirectory(path); e != nil {
		return "", e
	}
	return path, nil
}

type publicationPushGuard struct {
	head, expected, ref, destination string
}

// This is fixed Program code, never a repository/Agent-supplied hook. Its only
// inputs are already validated nonsecret expected facts. Bound input before
// parsing; require one complete update line with no additional lines or fields.
const publicationPrePushScript = `#!/bin/sh
set -eu
LC_ALL=C
export LC_ALL
reject() { exit 78; }
[ "$#" -eq 2 ] || reject
[ "$1" = "$MONOS_PUSH_DESTINATION" ] || reject
[ "$2" = "$MONOS_PUSH_DESTINATION" ] || reject
payload=$(/bin/dd bs=1 count=4097 2>/dev/null | /usr/bin/tr '\000' '?'; printf '.')
[ "${#payload}" -le 4097 ] || reject
lf='
'
case "$payload" in *"$lf".) ;; *) reject ;; esac
line=${payload%"$lf".}
case "$line" in *"$lf"*) reject ;; esac
set -f
old_ifs=$IFS
IFS=' '
set -- $line
IFS=$old_ifs
[ "$#" -eq 4 ] || reject
[ "$1" = "$MONOS_PUSH_HEAD" ] || reject
[ "$2" = "$MONOS_PUSH_HEAD" ] || reject
[ "$3" = "$MONOS_PUSH_REF" ] || reject
[ "$4" = "$MONOS_PUSH_EXPECTED" ] || reject
`

func installPublicationPushGuard(ctx context.Context, operationDir string, guard publicationPushGuard) (string, []string, error) {
	if !objectID.MatchString(guard.head) || guard.head == strings.Repeat("0", len(guard.head)) || len(guard.expected) != len(guard.head) || !objectID.MatchString(guard.expected) || !strings.HasPrefix(guard.ref, "refs/heads/") || len(guard.ref) > 512 || guard.destination == "" || len(guard.destination) > 4096 || strings.ContainsAny(guard.destination, "\x00\r\n") {
		return "", nil, errors.New("publication push guard unavailable")
	}
	cmd := exec.CommandContext(ctx, "/usr/bin/git", "check-ref-format", guard.ref)
	cmd.Env = publicationGitEnvironment()
	cmd.Stdout, cmd.Stderr = io.Discard, io.Discard
	if cmd.Run() != nil {
		return "", nil, errors.New("publication push guard unavailable")
	}
	dir := filepath.Join(operationDir, "hooks")
	if e := publicationDirectory(dir); e != nil {
		return "", nil, e
	}
	path := filepath.Join(dir, "pre-push")
	if e := savePublicationPushScript(path); e != nil {
		return "", nil, e
	}
	env := []string{"MONOS_PUSH_HEAD=" + guard.head, "MONOS_PUSH_EXPECTED=" + guard.expected, "MONOS_PUSH_REF=" + guard.ref, "MONOS_PUSH_DESTINATION=" + guard.destination}
	return dir, env, nil
}

func savePublicationPushScript(path string) error {
	check := func() error {
		if trustedFile(path, uint32(os.Geteuid())) != nil {
			return errors.New("publication push guard unavailable")
		}
		s, e := os.Lstat(path)
		if e != nil || s.Mode().Perm() != 0700 || s.Size() != int64(len(publicationPrePushScript)) {
			return errors.New("publication push guard unavailable")
		}
		raw, e := os.ReadFile(path)
		if e != nil || !bytes.Equal(raw, []byte(publicationPrePushScript)) {
			return errors.New("publication push guard unavailable")
		}
		return nil
	}
	if _, e := os.Lstat(path); e == nil {
		return check()
	} else if !os.IsNotExist(e) {
		return errors.New("publication push guard unavailable")
	}
	f, e := os.CreateTemp(filepath.Dir(path), ".publication-hook-")
	if e != nil {
		return errors.New("publication push guard unavailable")
	}
	temp := f.Name()
	defer os.Remove(temp)
	if e = f.Chmod(0700); e == nil {
		_, e = f.WriteString(publicationPrePushScript)
	}
	if e == nil {
		e = f.Sync()
	}
	closeErr := f.Close()
	if e != nil || closeErr != nil {
		return errors.New("publication push guard unavailable")
	}
	if os.Link(temp, path) != nil {
		return check()
	}
	if syncDirectory(filepath.Dir(path)) != nil {
		return errors.New("publication push guard unavailable")
	}
	return check()
}
