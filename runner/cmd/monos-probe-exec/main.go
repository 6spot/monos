package main

import (
	"errors"
	"fmt"
	protocol "monos.local/protocol"
	"monos.local/runner/internal/adapter"
	"monos.local/runner/internal/host"
	"os"
)

func run() error {
	if os.Geteuid() == 0 {
		return fmt.Errorf("refusing root execution")
	}
	if len(os.Args) < 3 || !host.ValidID(os.Args[2]) {
		return fmt.Errorf("invalid worker arguments")
	}
	switch os.Args[1] {
	case "workspace":
		if len(os.Args) != 3 {
			return fmt.Errorf("invalid workspace worker arguments")
		}
		r, err := host.WorkspaceWorker(os.Args[2], os.Stdin)
		return host.WriteStatus(os.Stdout, r, err)
	case "attempt":
		if len(os.Args) != 3 {
			return fmt.Errorf("invalid attempt arguments")
		}
		d, err := host.LoadDispatch(os.Args[2])
		if err != nil {
			return err
		}
		return adapter.Run(d)
	case "effect":
		if len(os.Args) < 5 || len(os.Args) > 6 {
			return fmt.Errorf("invalid effect arguments")
		}
		kind := protocol.OperationKind(os.Args[3])
		base := ""
		if kind == protocol.KindCompleteNode {
			if len(os.Args) != 6 {
				return fmt.Errorf("finalization requires system-retained base")
			}
			base = os.Args[5]
		} else if len(os.Args) != 5 {
			return fmt.Errorf("unexpected effect base")
		}
		r, err := host.GitEffect(os.Args[2], kind, os.Args[4], base)
		status := host.Status{Known: true, Result: &r}
		if err == nil && kind == protocol.KindOpenWorkspace {
			base, err = host.MaterializationBase(os.Args[2])
			status.MaterializationBase = &base
		}
		return host.WriteStatus(os.Stdout, status, err)
	}
	return fmt.Errorf("unknown worker action")
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(workerExitCode(err))
	}
}

func workerExitCode(err error) int {
	if errors.Is(err, adapter.ErrCaptureFailure) {
		return host.CaptureFailureExitCode
	}
	if errors.Is(err, adapter.ErrRuntimeFailure) {
		return host.RuntimeFailureExitCode
	}
	if err != nil {
		return 1
	}
	return 0
}
