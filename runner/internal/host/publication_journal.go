package host

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"

	"monos.local/runner/internal/wire"
)

const publicationJournalLimit = 16 << 20

func publicationDirectory(path string) error {
	created := false
	if e := os.Mkdir(path, 0700); e == nil {
		created = true
	} else if !os.IsExist(e) {
		return errors.New("publication storage unavailable")
	}
	if resultParents(path, uint32(os.Geteuid())) != nil || serviceDirectory(path, true) != nil {
		return errors.New("publication storage unavailable")
	}
	s, e := os.Lstat(path)
	if e != nil || s.Mode().Perm() != 0700 {
		return errors.New("publication storage unavailable")
	}
	if created {
		if syncDirectory(path) != nil || syncDirectory(filepath.Dir(path)) != nil {
			return errors.New("publication storage unavailable")
		}
	}
	return nil
}
func readPublicationFile(path string) ([]byte, error) {
	if e := trustedFile(path, uint32(os.Geteuid())); e != nil {
		return nil, e
	}
	s, e := os.Lstat(path)
	if e != nil || s.Mode().Perm() != 0600 || s.Size() > publicationJournalLimit {
		return nil, errors.New("publication journal unavailable")
	}
	f, e := os.Open(path)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	raw, e := io.ReadAll(io.LimitReader(f, publicationJournalLimit+1))
	if e != nil || len(raw) > publicationJournalLimit {
		return nil, errors.New("publication journal unavailable")
	}
	return raw, nil
}

// Canonical immutable record with atomic exclusive installation and file + parent
// fsync. Replays compare exact canonical bytes. Existing evidence is never chmoded
// or replaced; a conflicting record requires reconciliation.
func savePublicationFile(path string, value any) error {
	raw, _, e := wire.Canonical(value)
	if e != nil || len(raw) > publicationJournalLimit {
		return errors.New("publication journal limit")
	}
	if old, e := readPublicationFile(path); e == nil {
		if bytes.Equal(old, raw) {
			return nil
		}
		return errors.New("publication journal conflict")
	} else if !os.IsNotExist(e) {
		return errors.New("publication journal unavailable")
	}
	f, e := os.CreateTemp(filepath.Dir(path), ".publication-record-")
	if e != nil {
		return errors.New("publication journal unavailable")
	}
	temp := f.Name()
	defer os.Remove(temp)
	if e = f.Chmod(0600); e == nil {
		_, e = f.Write(raw)
	}
	if e == nil {
		e = f.Sync()
	}
	closeErr := f.Close()
	if e != nil || closeErr != nil {
		return errors.New("publication journal unavailable")
	}
	if e = os.Link(temp, path); e != nil {
		if old, readErr := readPublicationFile(path); readErr == nil && bytes.Equal(old, raw) {
			return nil
		}
		return errors.New("publication journal conflict")
	}
	if e = syncDirectory(filepath.Dir(path)); e != nil {
		return errors.New("publication journal unavailable")
	}
	return nil
}
