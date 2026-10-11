// Package storage confines enrollment files to trusted, descriptor-anchored paths.
package storage

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"unicode/utf8"
)

var ErrUnsafe = errors.New("unsafe enrollment storage")

type Directory struct{ root *os.Root }

// OpenParent rejects aliases instead of resolving them. System-owned ancestors
// may be public; a secret's immediate directory must be service-owned 0700.
func OpenParent(path string, private bool) (*Directory, string, error) {
	if !utf8.ValidString(path) || !filepath.IsAbs(path) || filepath.Clean(path) != path || path == "/" {
		return nil, "", ErrUnsafe
	}
	root, err := os.OpenRoot("/")
	if err != nil {
		return nil, "", err
	}
	parts := strings.Split(strings.TrimPrefix(filepath.Dir(path), "/"), "/")
	for _, part := range parts {
		if part == "" {
			continue
		}
		before, err := root.Lstat(part)
		if err != nil {
			root.Close()
			return nil, "", err
		}
		if !safeDirectory(before, false) {
			root.Close()
			return nil, "", ErrUnsafe
		}
		next, err := root.OpenRoot(part)
		if err != nil {
			root.Close()
			return nil, "", err
		}
		after, statErr := next.Stat(".")
		root.Close()
		if statErr != nil || !os.SameFile(before, after) || !safeDirectory(after, false) {
			next.Close()
			return nil, "", ErrUnsafe
		}
		root = next
	}
	info, err := root.Stat(".")
	if err != nil || !safeDirectory(info, private) {
		root.Close()
		return nil, "", ErrUnsafe
	}
	return &Directory{root}, filepath.Base(path), nil
}

func safeDirectory(info os.FileInfo, private bool) bool {
	if info == nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return false
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return false
	}
	if private {
		return stat.Uid == uint32(os.Geteuid()) && info.Mode().Perm() == 0700 && info.Mode()&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) == 0
	}
	return (stat.Uid == 0 || stat.Uid == uint32(os.Geteuid())) && (info.Mode().Perm()&0022 == 0 || stat.Uid == 0 && info.Mode()&os.ModeSticky != 0)
}

func safeFile(info os.FileInfo, private bool, maxLinks uint64) bool {
	if info == nil || !info.Mode().IsRegular() || info.Mode()&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 {
		return false
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || uint64(stat.Nlink) < 1 || uint64(stat.Nlink) > maxLinks {
		return false
	}
	if private {
		return stat.Uid == uint32(os.Geteuid()) && info.Mode().Perm() == 0600
	}
	return (stat.Uid == 0 || stat.Uid == uint32(os.Geteuid())) && info.Mode().Perm()&0022 == 0
}

func (d *Directory) Close() error { return d.root.Close() }
func (d *Directory) Exists(name string) (bool, error) {
	_, err := d.root.Lstat(name)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	return err == nil, err
}

func (d *Directory) read(name string, limit int, private bool, links uint64, syncFile bool) ([]byte, os.FileInfo, error) {
	f, err := d.root.OpenFile(name, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !safeFile(info, private, links) {
		return nil, nil, ErrUnsafe
	}
	raw, err := io.ReadAll(io.LimitReader(f, int64(limit)+1))
	if err != nil {
		return nil, nil, err
	}
	if len(raw) > limit {
		return nil, nil, ErrUnsafe
	}
	if syncFile {
		// A recovered file may have been fully written but never synced. Its
		// directory entry alone does not make the credential bytes durable.
		if err = f.Sync(); err != nil {
			return nil, nil, err
		}
	}
	return raw, info, nil
}

func (d *Directory) Read(name string, limit int, private bool) ([]byte, error) {
	raw, _, err := d.read(name, limit, private, 1, false)
	return raw, err
}

func Read(path string, limit int, private bool) ([]byte, error) {
	dir, name, err := OpenParent(path, private)
	if err != nil {
		return nil, err
	}
	defer dir.Close()
	return dir.Read(name, limit, private)
}

// Lock files are retained: unlinking one would allow two different locked inodes.
func (d *Directory) Lock(name string) (*os.File, error) {
	f, err := d.root.OpenFile(name, os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0600)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil || !safeFile(info, true, 1) {
		f.Close()
		return nil, ErrUnsafe
	}
	if err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		return nil, fmt.Errorf("enrollment already running")
	}
	return f, nil
}

func (d *Directory) sync() error {
	f, err := d.root.Open(".")
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}

func (d *Directory) create(name string, raw []byte) error {
	f, err := d.root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return err
	}
	// An unusual service umask must not publish an unreadable pending intent.
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(raw)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	return closeErr
}

// Write atomically replaces only enrollment's pending state while its lock is held.
func (d *Directory) Write(name string, raw []byte) error {
	if exists, err := d.Exists(name); err != nil {
		return err
	} else if exists {
		if _, err = d.Read(name, 16384, true); err != nil {
			return err
		}
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return err
	}
	temporary := ".enroll-" + hex.EncodeToString(nonce[:])
	defer d.root.Remove(temporary)
	if err := d.create(temporary, raw); err != nil {
		return err
	}
	if err := d.root.Rename(temporary, name); err != nil {
		return err
	}
	return d.sync()
}

func (d *Directory) Remove(name string) error {
	if err := d.root.Remove(name); err != nil {
		return err
	}
	return d.sync()
}

// PublishIdentity never replaces an existing file. Only the exact pending-owned
// staging hardlink can be recovered after a crash between link and unlink.
func (d *Directory) PublishIdentity(name string, expected []byte, beforeCreate func() error) error {
	stage := name + ".enroll.install"
	final, finalInfo, finalErr := d.read(name, 4096, true, 2, true)
	staged, stageInfo, stageErr := d.read(stage, 4096, true, 2, true)
	if finalErr != nil && !errors.Is(finalErr, os.ErrNotExist) {
		return finalErr
	}
	if stageErr != nil && !errors.Is(stageErr, os.ErrNotExist) {
		return stageErr
	}
	if errors.Is(finalErr, os.ErrNotExist) {
		if err := beforeCreate(); err != nil {
			return err
		}
	}
	if stageErr == nil && !bytes.Equal(staged, expected) {
		// Only an unlinked prefix of this exact pending-owned identity can be
		// an interrupted staging write. Never repair a published identity.
		if finalErr == nil || stageInfo.Sys().(*syscall.Stat_t).Nlink != 1 || !bytes.HasPrefix(expected, staged) {
			return ErrUnsafe
		}
		if err := d.Remove(stage); err != nil {
			return err
		}
		stageErr = os.ErrNotExist
	}
	if finalErr == nil {
		if !bytes.Equal(final, expected) {
			return ErrUnsafe
		}
		if finalInfo.Sys().(*syscall.Stat_t).Nlink == 2 {
			if stageErr != nil || !os.SameFile(finalInfo, stageInfo) {
				return ErrUnsafe
			}
		} else if stageErr == nil && stageInfo.Sys().(*syscall.Stat_t).Nlink != 1 {
			return ErrUnsafe
		}
		if stageErr == nil {
			return d.Remove(stage)
		}
		return d.sync()
	}
	if stageErr == nil {
		if stageInfo.Sys().(*syscall.Stat_t).Nlink != 1 {
			return ErrUnsafe
		}
	} else if err := d.create(stage, expected); err != nil {
		return err
	}
	if err := beforeCreate(); err != nil {
		return err
	}
	if err := d.root.Link(stage, name); err != nil {
		return err
	}
	if err := d.sync(); err != nil {
		return err
	}
	return d.Remove(stage)
}
