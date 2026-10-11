package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"monos.local/runner/internal/control"
	"monos.local/runner/internal/daemon"
	"monos.local/runner/internal/enrollment"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/journal"
	"monos.local/runner/internal/local"
	"os"
	"os/signal"
	"syscall"
)

func run() error {
	if os.Geteuid() == 0 {
		return fmt.Errorf("Runner must use dedicated service account")
	}
	args := os.Args[1:]
	enrolling := len(args) > 0 && args[0] == "enroll"
	if enrolling {
		args = args[1:]
	}
	flags := flag.NewFlagSet("monos-runner", flag.ContinueOnError)
	// Flag errors must never echo an accidentally supplied credential argument.
	flags.SetOutput(io.Discard)
	path := flags.String("config", "/etc/monos-probe/runner.json", "Runner configuration")
	if err := flags.Parse(args); err != nil || flags.NArg() != 0 {
		return fmt.Errorf("usage: monos-runner [enroll] --config <path>; enrollment grant uses stdin")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	if enrolling {
		id, err := enrollment.Enroll(ctx, *path, os.Stdin)
		if err != nil {
			return err
		}
		fmt.Fprintf(os.Stdout, "Runner enrolled: %s\n", id)
		return nil
	}
	config, _, err := control.ReadConfig(*path)
	if err != nil {
		return err
	}
	client, err := control.New(config)
	if err != nil {
		return err
	}
	config = client.Config
	if config.Socket != host.Socket || config.ExecutionUID == 0 || !host.ValidID(config.RunnerID) {
		return fmt.Errorf("invalid Runner config")
	}
	db, err := journal.Open(config.Journal)
	if err != nil {
		return err
	}
	defer db.Close()
	boot, err := host.BootID()
	if err != nil {
		return err
	}
	service := local.Service{DB: db, Control: client, UID: config.ExecutionUID}
	d := daemon.Daemon{DB: db, Control: client, Host: host.Client{}, Boot: boot}
	errors := make(chan error, 2)
	go func() { errors <- service.Serve(ctx, config.Socket) }()
	go func() { errors <- d.Run(ctx) }()
	err = <-errors
	cancel()
	return err
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
