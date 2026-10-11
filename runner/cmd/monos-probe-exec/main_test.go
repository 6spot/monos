package main

import (
	"errors"
	"fmt"
	"os/exec"
	"testing"

	"monos.local/runner/internal/adapter"
	"monos.local/runner/internal/host"
)

func TestWorkerReservedExitCodesRequireTypedAdapterFailure(t *testing.T) {
	native75 := exec.Command("/bin/sh", "-c", "exit 75").Run()
	for _, test := range []struct {
		err  error
		want int
	}{
		{nil, 0},
		{native75, 1},
		{errors.New("native runtime terminal failure"), 1},
		{fmt.Errorf("adapter: %w", adapter.ErrRuntimeFailure), host.RuntimeFailureExitCode},
		{adapter.ErrCaptureFailure, host.CaptureFailureExitCode},
		{errors.Join(adapter.ErrRuntimeFailure, adapter.ErrCaptureFailure), host.CaptureFailureExitCode},
	} {
		if got := workerExitCode(test.err); got != test.want {
			t.Fatalf("exit code %d, want %d for %v", got, test.want, test.err)
		}
	}
}
