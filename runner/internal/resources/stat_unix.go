//go:build linux || darwin

package resources

import (
	"fmt"
	"syscall"
)

// Do not walk to a parent on ENOENT: a missing configured mount must remain
// unknown rather than appearing healthy on a different filesystem.
func DiskSpace(path string) (int64, int64, error) {
	var s syscall.Statfs_t
	if err := syscall.Statfs(path, &s); err != nil {
		return 0, 0, err
	}
	if s.Bsize <= 0 || uint64(s.Bsize) > uint64(MaxSafeInteger) || uint64(s.Blocks) > uint64(MaxSafeInteger)/uint64(s.Bsize) || uint64(s.Bavail) > uint64(s.Blocks) {
		return 0, 0, fmt.Errorf("unsupported filesystem size")
	}
	return int64(s.Bavail) * int64(s.Bsize), int64(s.Blocks) * int64(s.Bsize), nil
}
