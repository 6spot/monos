package host

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"syscall"
)

// Targets are derived by root from exact admitted allocations, then fsynced in
// the Task retirement record before deletion. A recreated directory can never
// be mistaken for an interrupted cleanup of the original inode.
type cleanupTarget struct {
	Path    string `json:"path"`
	Owner   uint32 `json:"owner"`
	Device  uint64 `json:"device"`
	Inode   uint64 `json:"inode"`
	Present bool   `json:"present"`
}

func observeCleanupTarget(path string, owner uint32) (cleanupTarget, error) {
	t := cleanupTarget{Path: path, Owner: owner}
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return t, nil
	}
	if err != nil {
		return t, err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || !info.IsDir() || stat.Uid != owner {
		return t, fmt.Errorf("cleanup directory ownership mismatch")
	}
	parent, err := os.Lstat(filepath.Dir(path))
	if err != nil {
		return t, err
	}
	parentStat, ok := parent.Sys().(*syscall.Stat_t)
	if !ok || parentStat.Dev != stat.Dev {
		return t, fmt.Errorf("cleanup target is a separate mount")
	}
	t.Present = true
	t.Device = uint64(stat.Dev)
	t.Inode = uint64(stat.Ino)
	return t, nil
}

func removeCleanupTarget(ctx context.Context, target cleanupTarget) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	current, err := observeCleanupTarget(target.Path, target.Owner)
	if err != nil {
		return err
	}
	if !current.Present {
		return nil
	}
	if !target.Present || current.Device != target.Device || current.Inode != target.Inode {
		return fmt.Errorf("cleanup target changed after retirement")
	}
	parent, err := os.OpenRoot(filepath.Dir(target.Path))
	if err != nil {
		return err
	}
	defer parent.Close()
	verify := func() error {
		if err := ctx.Err(); err != nil {
			return err
		}
		current, err := observeCleanupTarget(target.Path, target.Owner)
		if err != nil {
			return err
		}
		if !current.Present || current.Device != target.Device || current.Inode != target.Inode {
			return fmt.Errorf("cleanup target changed during deletion")
		}
		return nil
	}
	if err = removeCleanupEntry(ctx, parent, filepath.Base(target.Path), target.Device, verify); err != nil {
		return err
	}
	return syncDirectory(filepath.Dir(target.Path))
}

// Descriptor-anchored, bounded directory reads keep cancellation observable
// between individual unlinks. Each entry is rechecked before removal, symlinks
// are unlinked without following them, and a different-device mount is refused.
func removeCleanupEntry(ctx context.Context, parent *os.Root, name string, device uint64, verify func() error) error {
	if err := verify(); err != nil {
		return err
	}
	before, err := parent.Lstat(name)
	if err != nil {
		return err
	}
	stat, ok := before.Sys().(*syscall.Stat_t)
	if !ok || uint64(stat.Dev) != device {
		return fmt.Errorf("cleanup tree crosses a mount")
	}
	if before.IsDir() {
		child, err := parent.OpenRoot(name)
		if err != nil {
			return err
		}
		defer child.Close()
		opened, err := child.Stat(".")
		if err != nil || !os.SameFile(before, opened) {
			return fmt.Errorf("cleanup directory changed before traversal")
		}
		current, err := parent.Lstat(name)
		if err != nil || !current.IsDir() || !os.SameFile(before, current) {
			return fmt.Errorf("cleanup directory replaced by alias")
		}
		verifyChild := func() error {
			if err := verify(); err != nil {
				return err
			}
			current, err := parent.Lstat(name)
			if err != nil || !current.IsDir() || !os.SameFile(before, current) {
				return fmt.Errorf("cleanup directory moved during traversal")
			}
			return nil
		}
		entries, err := child.Open(".")
		if err != nil {
			return err
		}
		defer entries.Close()
		for {
			if err := ctx.Err(); err != nil {
				return err
			}
			names, readErr := entries.Readdirnames(128)
			if readErr != nil && readErr != io.EOF {
				return readErr
			}
			for _, entry := range names {
				if err = removeCleanupEntry(ctx, child, entry, device, verifyChild); err != nil {
					return err
				}
			}
			if readErr == io.EOF {
				break
			}
		}
	}
	if err = verify(); err != nil {
		return err
	}
	after, err := parent.Lstat(name)
	if err != nil || !os.SameFile(before, after) || before.Mode().Type() != after.Mode().Type() {
		return fmt.Errorf("cleanup entry changed before removal")
	}
	return parent.Remove(name)
}
