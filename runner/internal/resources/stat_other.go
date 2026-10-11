//go:build !linux && !darwin

package resources

import "fmt"

func DiskSpace(string) (int64, int64, error) {
	return 0, 0, fmt.Errorf("filesystem observation unavailable")
}
