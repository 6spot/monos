package host

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"syscall"
)

// archiveWorkspaceAllocation only moves the stopped allocation. Git history
// omits ignored files and separate index content; retain both original trees.
// The protected intent makes both rename windows replayable without replacing
// any directory that appeared after the recorded allocation was archived.
func archiveWorkspaceAllocation(base, request, lease string, owner uint32) error {
	if err := trustedDir(base, owner); err != nil {
		return err
	}
	return archiveWorkspaceAllocationAt(base, request, lease, owner)
}

// The production entry validates the complete root-owned ancestry first. Tests
// exercise rename recovery under their own account without privileged setup.
func archiveWorkspaceAllocationAt(base, request, lease string, owner uint32) error {
	if !ValidID(request) || !ValidID(lease) || archiveDirectory(base, owner) != nil {
		return fmt.Errorf("invalid workspace archive identity")
	}
	root := filepath.Join(base, "rework-archives")
	archive := filepath.Join(root, request)
	for _, p := range []string{root, archive} {
		if err := os.Mkdir(p, 0700); err != nil && !os.IsExist(err) {
			return err
		}
		if err := archiveDirectory(p, owner); err != nil {
			return err
		}
		s, err := os.Lstat(p)
		if err != nil || s.Mode().Perm() != 0700 {
			return fmt.Errorf("workspace archive is not private")
		}
	}
	identity := map[string]string{"request_id": request, "lease_id": lease}
	identityPath := filepath.Join(archive, "identity.json")
	if _, err := os.Lstat(identityPath); os.IsNotExist(err) {
		// An unexplained archive is never adopted as a successful prior rename.
		entries, e := os.ReadDir(archive)
		if e != nil || len(entries) != 0 {
			return fmt.Errorf("unattributed workspace archive")
		}
		if err = saveRecord(identityPath, identity); err != nil {
			return err
		}
	} else if err != nil {
		return err
	} else {
		var old map[string]string
		if err = trustedFile(identityPath, owner); err != nil {
			return err
		}
		raw, err := os.ReadFile(identityPath)
		if err != nil || json.Unmarshal(raw, &old) != nil || !reflect.DeepEqual(old, identity) {
			return fmt.Errorf("workspace archive identity changed")
		}
	}
	if err := syncDirectory(root); err != nil {
		return err
	}
	if err := syncDirectory(base); err != nil {
		return err
	}
	for _, name := range []string{"common", "worktree"} {
		source, target := filepath.Join(base, name), filepath.Join(archive, name)
		if s, err := os.Lstat(target); err == nil {
			if !s.IsDir() || s.Mode()&os.ModeSymlink != 0 {
				return fmt.Errorf("invalid archived workspace directory")
			}
			if _, err = os.Lstat(source); !os.IsNotExist(err) {
				return fmt.Errorf("workspace appeared during archival")
			}
			continue
		} else if !os.IsNotExist(err) {
			return err
		}
		s, err := os.Lstat(source)
		if err != nil || !s.IsDir() || s.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("workspace archive source missing or unsafe")
		}
		if err = os.Rename(source, target); err != nil {
			return err
		}
		if err = syncDirectory(archive); err != nil {
			return err
		}
		if err = syncDirectory(base); err != nil {
			return err
		}
	}
	return nil
}

func archiveDirectory(path string, owner uint32) error {
	s, err := os.Lstat(path)
	if err != nil {
		return err
	}
	stat, ok := s.Sys().(*syscall.Stat_t)
	if !ok || !s.IsDir() || s.Mode()&os.ModeSymlink != 0 || stat.Uid != owner || s.Mode().Perm()&0022 != 0 {
		return fmt.Errorf("unsafe archive directory")
	}
	return nil
}
