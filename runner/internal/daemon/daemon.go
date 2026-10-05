package daemon

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/control"
	"monos.local/runner/internal/host"
	"monos.local/runner/internal/journal"
	"monos.local/runner/internal/wire"
)

type Daemon struct {
	DB                *journal.DB
	Control           *control.Client
	Host              host.Supervisor
	Boot              string
	mu                sync.Mutex
	queueMu           sync.Mutex
	queued            map[string]bool
	readSlots         chan struct{}
	publicationSlots  chan struct{}
	publicationQueued map[string]bool
	remoteSlots       chan struct{}
	remoteQueued      map[string]bool
	workers           sync.WaitGroup
	recovery          *recoveryBatch // protected by queueMu; one complete connection inventory
}

func (d *Daemon) InstalledRuntimes(ctx context.Context) []protocol.RuntimeInstallation {
	status, err := d.Host.Call(ctx, host.Request{Action: "discover"})
	if err != nil {
		return []protocol.RuntimeInstallation{{RuntimeID: "opencode", Executable: host.Runtime, Availability: "unavailable", SupportsModel: true, SupportsThinking: false, ModelIDS: []string{}}}
	}
	return status.Runtimes
}

func (d *Daemon) event(ctx context.Context, start journal.Start, kind protocol.RuntimeEventKind, text string) error {
	e, err := d.DB.Event(protocol.RuntimeEvent{AttemptID: start.Dispatch.AttemptID, DispatchID: start.Dispatch.DispatchID, StreamID: "runtime", Kind: kind, Text: text, BootID: &d.Boot})
	if err != nil {
		return err
	}
	return d.Control.Send(ctx, protocol.Frame{Type: protocol.Event, Event: &e})
}
func (d *Daemon) Reconcile(ctx context.Context, inventory protocol.RunnerInventory) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if inventory.NextCursor != nil {
		return fmt.Errorf("partial inventory cannot authorize recovery")
	}
	known := map[string]protocol.Dispatch{}
	for _, dispatch := range inventory.Dispatches {
		known[dispatch.AttemptID] = dispatch
	}
	starts, err := d.DB.Starts()
	if err != nil {
		return err
	}
	for _, s := range starts {
		remote, exists := known[s.Dispatch.AttemptID]
		if s.Phase == "cancel_intent" {
			if exists && (remote.DispatchID != s.Dispatch.DispatchID || remote.MutationAllowed) {
				return fmt.Errorf("revocation lineage changed")
			}
			var err error
			s, err = d.confirmNeverLaunched(ctx, s)
			if err != nil {
				return err
			}
		}
		status, err := d.Host.Call(ctx, host.Request{Action: "status", AttemptID: s.Dispatch.AttemptID})
		if err != nil {
			return fmt.Errorf("retained ownership requires recovery: %w", err)
		}
		if !status.Known {
			if s.Phase == "intent" && exists && !remote.MutationAllowed {
				var stop *protocol.Operation
				for _, operation := range inventory.Operations {
					if operation.AttemptID == s.Dispatch.AttemptID && operation.DispatchID == s.Dispatch.DispatchID && operation.Kind == protocol.Stop {
						copy := operation
						stop = &copy
						break
					}
				}
				if stop == nil {
					return fmt.Errorf("revoked start intent has no admitted Stop")
				}
				s, err = d.unstartedRevocation(ctx, *stop, inventory)
				if err != nil {
					return err
				}
				status, err = d.Host.Call(ctx, host.Request{Action: "status", AttemptID: s.Dispatch.AttemptID})
				if err != nil {
					return err
				}
			}
			if !status.Known {
				return fmt.Errorf("retained launch manifest unavailable; ownership unresolved")
			}
		}
		if status.CaptureFailed {
			d.captureFailure(ctx, s, fmt.Errorf("supervised output writer failed"))
		}
		if !exists && status.Populated {
			return fmt.Errorf("live local ownership absent from backend inventory")
		}
		if exists && remote.DispatchID != s.Dispatch.DispatchID {
			return fmt.Errorf("dispatch lineage mismatch")
		}
		if err = d.observeMainExit(s, status); err != nil {
			return err
		}
		if exists && !remote.MutationAllowed && status.Populated {
			status, err = d.Host.Call(ctx, host.Request{Action: "stop", AttemptID: s.Dispatch.AttemptID})
			if err != nil {
				return err
			}
		}
		if status.Populated {
			if status.BootID != s.BootID || status.Cgroup == "" {
				return fmt.Errorf("ambiguous retained process")
			}
			if s.Cgroup != "" && s.Cgroup != status.Cgroup {
				return fmt.Errorf("retained cgroup changed")
			}
			if s.PID > 0 && status.PID > 0 && (s.PID != status.PID || s.Birth != status.Birth) {
				return fmt.Errorf("retained process birth changed")
			}
			s.PID = status.PID
			s.Birth = status.Birth
			s.Cgroup = status.Cgroup
			s.Phase = "running"
		} else {
			if s.Phase != "absent" && s.Phase != "revoked" {
				if _, err = d.DB.Event(protocol.RuntimeEvent{AttemptID: s.Dispatch.AttemptID, DispatchID: s.Dispatch.DispatchID, StreamID: "runtime", Kind: protocol.ProcessAbsent, Text: "reconciled verified whole-tree absence", BootID: &d.Boot}); err != nil {
					return err
				}
			}
			if s.Phase != "revoked" {
				s.Phase = "absent"
			}
		}
		if err = d.DB.SaveStart(s); err != nil {
			return err
		}
	}
	return d.prepareRecovery(ctx, inventory, known)
}

// The backend repeats unacknowledged frames. Keep at most one queued job per
// durable identity and a bounded queue; dropped deliveries will be redelivered.
func (d *Daemon) enqueue(ctx context.Context, key string, work func() error) bool {
	d.queueMu.Lock()
	defer d.queueMu.Unlock()
	return d.enqueueLocked(ctx, key, work)
}

func (d *Daemon) enqueueLocked(ctx context.Context, key string, work func() error) bool {
	if d.queued == nil {
		d.queued = map[string]bool{}
	}
	if d.queued[key] || len(d.queued) >= 64 {
		return false
	}
	d.queued[key] = true
	d.workers.Add(1)
	go func() {
		defer d.workers.Done()
		defer func() {
			d.queueMu.Lock()
			delete(d.queued, key)
			d.drainRecoveryLocked()
			d.queueMu.Unlock()
		}()
		if !strings.HasPrefix(key, "workspace:") {
			d.mu.Lock()
			defer d.mu.Unlock()
		}
		if ctx.Err() != nil {
			return
		}
		if err := work(); err != nil {
			log.Printf("control work requires recovery: %s", err)
		}
	}()
	return true
}
func (d *Daemon) Frame(ctx context.Context, frame protocol.Frame) {
	switch frame.Type {
	case protocol.Type("publication_prepare"):
		d.publicationPrepare(ctx, frame)
	case protocol.Type("publication_push"):
		d.publicationPush(ctx, frame)
	case protocol.Type("publication_push_ack"):
		if frame.PublicationPushACK != nil {
			_ = host.PublicationPushAck(ctx, *frame.PublicationPushACK)
		}
	case protocol.Type("publication_ack"):
		if frame.PublicationACK != nil {
			d.publicationAck(ctx, *frame.PublicationACK)
		}
	case protocol.ResultRead:
		d.resultRead(ctx, frame)
	case protocol.EventACK:
		if frame.AttemptID != nil && frame.StreamID != nil && frame.Sequence != nil {
			if err := d.DB.Ack(*frame.AttemptID, *frame.StreamID, *frame.Sequence); err != nil {
				log.Print("event acknowledgement persistence failed")
			}
		}
	case protocol.Start:
		if frame.Dispatch != nil {
			d.enqueue(ctx, "start:"+frame.Dispatch.DispatchID, func() error { return d.start(ctx, *frame.Dispatch) })
		}
	case protocol.Effect:
		if frame.Operation != nil {
			d.enqueue(ctx, effectKey(*frame.Operation), func() error { return d.effect(ctx, *frame.Operation) })
		}
	}
}

func effectKey(op protocol.Operation) string {
	if op.Workspace != nil {
		return "workspace:" + op.OperationID
	}
	return "effect:" + op.OperationID
}

func (d *Daemon) start(ctx context.Context, dispatch protocol.Dispatch) error {
	retained, err := d.DB.Start(dispatch.AttemptID)
	if err == nil {
		if retained.Dispatch.DispatchID != dispatch.DispatchID {
			return fmt.Errorf("conflicting dispatch")
		}
		if retained.Phase == "revoked" || retained.Phase == "cancel_intent" {
			return fmt.Errorf("dispatch revoked before launch")
		}
		if retained.Phase == "running" {
			return d.event(ctx, retained, protocol.KindStarted, "retained supervised process")
		}
		if retained.Phase == "absent" {
			return d.event(ctx, retained, protocol.ProcessAbsent, "verified absent retained process")
		}
		return fmt.Errorf("unresolved prior start intent")
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if _, err = d.Control.Authorize(ctx, dispatch.DispatchID); err != nil {
		return err
	}
	if err := reserveCaptureMarker(serviceCaptureMarker(dispatch.AttemptID)); err != nil {
		return fmt.Errorf("cannot reserve capture failure evidence: %w", err)
	}
	retained = journal.Start{Dispatch: dispatch, BootID: d.Boot, Phase: "intent"}
	if err := d.DB.SaveStart(retained); err != nil {
		return err
	}
	status, err := d.Host.Call(ctx, host.Request{Action: "start", AttemptID: dispatch.AttemptID, Dispatch: &dispatch})
	if err != nil {
		return err
	}
	if !status.Known || status.BootID != d.Boot {
		return fmt.Errorf("unknown launch ownership")
	}
	return d.recordLaunch(ctx, retained, status)
}

func (d *Daemon) recordLaunch(ctx context.Context, retained journal.Start, status host.Status) error {
	retained.PID = status.PID
	retained.Birth = status.Birth
	retained.Cgroup = status.Cgroup
	retained.Phase = "running"
	if !status.Populated {
		retained.Phase = "absent"
	}
	if err := d.DB.SaveStart(retained); err != nil {
		return err
	}
	startErr := d.event(ctx, retained, protocol.KindStarted, "supervised runtime launch")
	// A worker can fail output capture and exit before the helper returns its
	// first status. Preserve that fact even when the Start send is interrupted;
	// this path will no longer be polled as running once absence is recorded.
	if status.CaptureFailed {
		d.captureFailure(ctx, retained, fmt.Errorf("supervised output writer failed"))
	}
	if err := d.observeMainExit(retained, status); err != nil {
		return err
	}
	if startErr != nil {
		return startErr
	}
	if retained.Phase == "absent" {
		return d.event(ctx, retained, protocol.ProcessAbsent, "verified no live descendants")
	}
	return nil
}
func (d *Daemon) effect(ctx context.Context, op protocol.Operation) error {
	if err := d.DB.BeginEffect(op); err != nil {
		return err
	}
	old, err := d.DB.Effect(op.OperationID)
	if err != nil {
		return err
	}
	if old != nil && (old.Success || old.CancelledByOperationID != nil) {
		if op.Kind == protocol.KindCompleteNode && old.CancelledByOperationID != nil {
			return d.replayCompletionSettlement(ctx, op, *old.CancelledByOperationID)
		}
		return d.Control.Send(ctx, protocol.Frame{Type: protocol.TypeOperationResult, OperationResult: old})
	}
	s, err := d.DB.Start(op.AttemptID)
	if (errors.Is(err, sql.ErrNoRows) || err == nil && s.Phase == "intent") && op.Kind == protocol.Stop {
		needsTombstone := errors.Is(err, sql.ErrNoRows)
		if !needsTombstone {
			var status host.Status
			status, err = d.Host.Call(ctx, host.Request{Action: "status", AttemptID: s.Dispatch.AttemptID})
			if err != nil {
				return err
			}
			needsTombstone = !status.Known
		}
		if needsTombstone {
			var inventory protocol.RunnerInventory
			inventory, err = d.Control.Inventory(ctx)
			if err == nil {
				s, err = d.unstartedRevocation(ctx, op, inventory)
			}
		}
	}
	if err != nil {
		return err
	}
	if s.Phase == "cancel_intent" && op.Kind == protocol.Stop {
		s, err = d.confirmNeverLaunched(ctx, s)
		if err != nil {
			return err
		}
	}
	if err := host.ValidateEffectScope(s.Dispatch, op); err != nil {
		return err
	}
	result := protocol.OperationResult{AttemptID: op.AttemptID, OperationID: op.OperationID}
	var original *protocol.Operation
	if op.Kind == protocol.SettleCompletion {
		if op.CompletionOperationID == nil {
			return fmt.Errorf("settlement target missing")
		}
		value, e := d.DB.Operation(*op.CompletionOperationID)
		if errors.Is(e, sql.ErrNoRows) {
			e = d.Control.Get(ctx, "/v1/recovery/operations/"+*op.CompletionOperationID, "Operation", &value)
			if e == nil {
				e = d.DB.BeginEffect(value)
			}
		}
		if e != nil {
			return e
		}
		if e = wire.ValidateCompletionTarget(op, value); e != nil {
			return e
		}
		original = &value
	}
	var status host.Status
	if op.Kind == protocol.KindInspectRepository {
		var snapshot protocol.EffectResult
		snapshot, err = host.Inspect(op.AttemptID)
		status = host.Status{Known: true, Result: &snapshot}
	} else {
		status, err = d.Host.Call(ctx, host.Request{Action: "effect", AttemptID: op.AttemptID, Operation: &op, CompletionOperation: original})
		if err == nil && status.NeedsRepositoryAccess {
			var access protocol.GitHubRepositoryAccessResult
			access, err = d.Control.RepositoryAccess(ctx, op)
			if err == nil {
				status, err = d.Host.Call(ctx, host.Request{Action: "effect", AttemptID: op.AttemptID, Operation: &op, RepositoryAccess: &access})
			}
		}
	}
	if err == nil && op.Kind == protocol.KindCompleteNode && status.CancelledByOperationID != nil {
		// A root pair may precede a failed export. Never publish its original
		// cancellation alone: resume the target pair's export and atomic journal.
		return d.replayCompletionSettlement(ctx, op, *status.CancelledByOperationID)
	}
	if err == nil && op.Workspace != nil && status.PriorOperationResult != nil {
		prior := status.PriorOperationResult
		// The helper supplies only an exact prior open outcome for this lease.
		if prior.OperationID != op.Workspace.OpenOperationID || prior.AttemptID != op.AttemptID {
			return fmt.Errorf("prior workspace result scope mismatch")
		}
		if e := d.DB.FinishEffect(*prior); e != nil {
			if !errors.Is(e, sql.ErrNoRows) {
				return e
			}
			var original protocol.Operation
			if e = d.Control.Get(ctx, "/v1/recovery/operations/"+prior.OperationID, "Operation", &original); e != nil {
				return e
			}
			if e = d.DB.BeginEffect(original); e != nil {
				return e
			}
			if e = d.DB.FinishEffect(*prior); e != nil {
				return e
			}
		}
		if e := d.Control.Send(ctx, protocol.Frame{Type: protocol.TypeOperationResult, OperationResult: prior}); e != nil {
			return e
		}
	}
	if err == nil && op.Kind == protocol.SettleCompletion {
		if status.Result == nil || status.CompletionSettlement == nil {
			return fmt.Errorf("missing completion settlement pair")
		}
		pair := protocol.OperationResult{AttemptID: op.AttemptID, OperationID: op.OperationID, Success: true, Result: *status.Result, CompletionSettlement: status.CompletionSettlement}
		if e := wire.ValidateCompletionPair(op, *original, pair); e != nil {
			return e
		}
		if status.CompletionSettlement.Disposition == protocol.AlreadyFinalized {
			err = host.ExportWorkspace(*original, status.CompletionSettlement.CompletionResult.Result)
		} else {
			err = host.ExportWorkspace(op, *status.Result)
		}
	} else if err == nil && op.Workspace != nil && status.Result != nil {
		err = host.ExportWorkspace(op, *status.Result)
	} else if err == nil && op.Kind == protocol.KindCompleteNode && op.RepositoryFree == nil && status.Result != nil && status.Result.GitCommit != nil && status.Result.GitTree != nil {
		err = host.Export(op.AttemptID, op.OperationID, *status.Result.GitCommit, *status.Result.GitTree)
	}
	if err == nil && !status.Known {
		err = fmt.Errorf("effect ownership unresolved")
	}
	if err == nil && (op.Kind == protocol.Stop || op.Kind == protocol.KindCompleteNode || op.Kind == protocol.SettleCompletion) && status.Populated {
		err = fmt.Errorf("writer absence unresolved")
	}
	if err == nil && op.Kind == protocol.KindCompleteNode && op.RepositoryFree == nil && status.CancelledByOperationID == nil && (status.Result == nil || status.Result.GitCommit == nil || status.Result.GitTree == nil) {
		err = fmt.Errorf("missing finalized Git evidence")
	}
	if err == nil && op.RepositoryFree != nil {
		if status.Result == nil || status.Result.WriterAbsent == nil || !*status.Result.WriterAbsent || status.Result.GitCommit != nil || status.Result.GitTree != nil || status.Result.WorkspaceID != nil || status.Result.WorkspaceMetadata != nil || status.Result.Path != nil || status.Result.InstructionFiles != nil {
			err = fmt.Errorf("invalid repository-free completion evidence")
		}
	}
	if err != nil {
		message := "host effect unresolved; retained for recovery"
		kind := host.ClassifyFailure(err)
		switch kind {
		case protocol.CaptureHardLimit:
			message = "local capture storage limit; preserve workspace and repair before retry"
		case protocol.InvalidFinalization:
			message = "finalized result violates recorded Git identity; preserve data for reconciliation"
		}
		result.Result.Message = &message
		result.FailureKind = &kind
		if op.Workspace != nil {
			reason := protocol.OwnershipUnresolved
			for _, candidate := range []protocol.WorkspaceUnavailableReason{protocol.WorkspaceUnavailableReasonCredentialsMissing, protocol.RepositoryDenied, protocol.RefUnavailable, protocol.StorageUnavailable, protocol.UnsupportedRemote} {
				if strings.Contains(err.Error(), string(candidate)) {
					reason = candidate
					break
				}
			}
			result.Result.WorkspaceUnavailableReason = &reason
		}
	} else {
		result.Success = status.CancelledByOperationID == nil
		result.CancelledByOperationID = status.CancelledByOperationID
		result.CompletionSettlement = status.CompletionSettlement
		if status.Result != nil {
			result.Result = *status.Result
		}
		if op.Kind == protocol.Stop || op.Kind == protocol.KindCompleteNode || op.Kind == protocol.SettleCompletion {
			absent := !status.Populated
			result.Result.WriterAbsent = &absent
			if err = d.recordEffectAbsence(op); err != nil {
				return err
			}
		}
	}
	if err = d.DB.FinishEffect(result); err != nil {
		return err
	}
	return d.Control.Send(ctx, protocol.Frame{Type: protocol.TypeOperationResult, OperationResult: &result})
}

func (d *Daemon) recordEffectAbsence(op protocol.Operation) error {
	// Canonical network/Git work runs outside mu. Re-read under the short
	// lifecycle lock so a completed effect cannot overwrite a newer launch or
	// reconciliation PID/birth/cgroup with its pre-network snapshot.
	if op.Workspace != nil {
		d.mu.Lock()
		defer d.mu.Unlock()
	}
	latest, err := d.DB.Start(op.AttemptID)
	if err != nil {
		return err
	}
	if latest.Dispatch.DispatchID != op.DispatchID {
		return fmt.Errorf("effect absence dispatch changed")
	}
	if latest.Phase != "revoked" {
		latest.Phase = "absent"
	}
	return d.DB.SaveStart(latest)
}

func (d *Daemon) unstartedRevocation(ctx context.Context, op protocol.Operation, inventory protocol.RunnerInventory) (journal.Start, error) {
	if op.Kind != protocol.Stop {
		return journal.Start{}, fmt.Errorf("only Stop can settle a never-launched Attempt")
	}
	var dispatch *protocol.Dispatch
	var operationFound bool
	for _, candidate := range inventory.Dispatches {
		if candidate.AttemptID == op.AttemptID {
			copy := candidate
			dispatch = &copy
		}
	}
	for _, candidate := range inventory.Operations {
		if candidate.OperationID == op.OperationID && candidate.AttemptID == op.AttemptID && candidate.DispatchID == op.DispatchID && candidate.RequestID == op.RequestID && wire.SameResource(candidate.ResourceID, op.ResourceID) && candidate.Kind == protocol.Stop {
			operationFound = true
		}
	}
	if dispatch == nil || dispatch.DispatchID != op.DispatchID || dispatch.MutationAllowed || dispatch.ProcessReleased || !operationFound {
		return journal.Start{}, fmt.Errorf("missing authoritative unstarted revocation")
	}
	old, err := d.DB.Start(op.AttemptID)
	if err == nil {
		expected := old.Dispatch
		expected.MutationAllowed = false
		expected.ProcessReleased = dispatch.ProcessReleased
		if old.Phase != "intent" || !reflect.DeepEqual(expected, *dispatch) {
			return journal.Start{}, fmt.Errorf("revocation collides with retained start")
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return journal.Start{}, err
	}
	s := journal.Start{Dispatch: *dispatch, BootID: d.Boot, Phase: "cancel_intent"}
	if err := d.DB.SaveStart(s); err != nil {
		return s, err
	}
	return d.confirmNeverLaunched(ctx, s)
}
func (d *Daemon) confirmNeverLaunched(ctx context.Context, s journal.Start) (journal.Start, error) {
	if s.Phase != "cancel_intent" || s.Dispatch.MutationAllowed {
		return s, fmt.Errorf("invalid retained revocation")
	}
	status, err := d.Host.Call(ctx, host.Request{Action: "tombstone", AttemptID: s.Dispatch.AttemptID, Dispatch: &s.Dispatch})
	if err != nil {
		return s, err
	}
	if !status.Known || status.Exists || status.Populated || status.BootID != d.Boot {
		return s, fmt.Errorf("never-launched absence not established")
	}
	s.Phase = "revoked"
	s.BootID = status.BootID
	if err = d.DB.SaveStart(s); err != nil {
		return s, err
	}
	return s, nil
}
func (d *Daemon) Tick(ctx context.Context) {
	if !d.mu.TryLock() {
		return
	}
	defer d.mu.Unlock()
	pending, err := d.DB.PendingEvents()
	if err != nil {
		log.Printf("journal event recovery failed: %v", err)
		// A failed journal scan cannot justify continuing execution while output
		// may be accumulating without durable event identities.
		if starts, startsErr := d.DB.Starts(); startsErr == nil {
			for _, s := range starts {
				if s.Phase == "running" {
					d.captureFailure(ctx, s, err)
				}
			}
		} else {
			log.Printf("journal ownership scan failed: %v", startsErr)
		}
		return
	}
	for _, event := range pending {
		if d.Control.Send(ctx, protocol.Frame{Type: protocol.Event, Event: &event}) != nil {
			return
		}
	}
	starts, err := d.DB.Starts()
	if err != nil {
		return
	}
	for _, s := range starts {
		workerMarker := host.Path(s.Dispatch.AttemptID, "scratch") + "/capture.failure"
		if captureMarkerSet(workerMarker) || captureMarkerSet(serviceCaptureMarker(s.Dispatch.AttemptID)) {
			alerted, checkErr := d.DB.HasCaptureAlert(s.Dispatch.AttemptID)
			// A prior alert does not prove the physical stop succeeded. Retry for
			// live work, but do not stop historical Attempts on every tick.
			if s.Phase == "running" || checkErr != nil || !alerted {
				d.captureFailure(ctx, s, fmt.Errorf("supervised output writer failed"))
			}
		}
		for _, stream := range []string{"stdout", "stderr"} {
			offset, e := d.DB.LogOffset(s.Dispatch.AttemptID, stream)
			if e != nil {
				d.captureFailure(ctx, s, e)
				continue
			}
			p := filepath.Join(host.Root, "logs", s.Dispatch.AttemptID+"."+stream)
			file, e := os.Open(p)
			if e != nil {
				if !os.IsNotExist(e) || s.Phase == "running" || s.Phase == "absent" {
					d.captureFailure(ctx, s, e)
				}
				continue
			}
			info, statErr := file.Stat()
			if statErr != nil || info.Size() < offset {
				file.Close()
				if statErr == nil {
					statErr = fmt.Errorf("log spool shrank below acknowledged offset")
				}
				d.captureFailure(ctx, s, statErr)
				continue
			}
			_, e = file.Seek(offset, io.SeekStart)
			if e != nil {
				file.Close()
				d.captureFailure(ctx, s, e)
				continue
			}
			buf := make([]byte, 32768)
			n, readErr := file.Read(buf)
			closeErr := file.Close()
			if readErr != nil && readErr != io.EOF {
				d.captureFailure(ctx, s, readErr)
				continue
			}
			if closeErr != nil {
				d.captureFailure(ctx, s, closeErr)
				continue
			}
			// Keep display text at a UTF-8 boundary. The exact source bytes are
			// still retained in data_base64, including malformed byte sequences.
			// An unfinished rune at the current EOF may be completed by a live
			// writer; after exit, retain those bytes as a final replacement rune.
			if end := completeUTF8Prefix(buf[:n]); end < n && (offset+int64(n) < info.Size() || s.Phase == "running") {
				n = end
			}
			if e == nil && n > 0 {
				kind := protocol.Output
				text := strings.ToValidUTF8(string(buf[:n]), "?")
				if stream == "stderr" && strings.Contains(text, "permission requested:") {
					kind = protocol.RuntimeEventKind("attention")
				}
				event, err := d.DB.LogEvent(protocol.RuntimeEvent{AttemptID: s.Dispatch.AttemptID, DispatchID: s.Dispatch.DispatchID, StreamID: stream, Kind: kind, Text: text, DataBase64: ptr(base64.StdEncoding.EncodeToString(buf[:n])), BootID: &d.Boot}, offset, offset+int64(n))
				if err != nil {
					d.captureFailure(ctx, s, err)
					continue
				}
				_ = d.Control.Send(ctx, protocol.Frame{Type: protocol.Event, Event: &event})
			}
		}
		if s.Phase == "running" {
			status, e := d.Host.Call(ctx, host.Request{Action: "status", AttemptID: s.Dispatch.AttemptID})
			if e != nil {
				continue
			}
			if status.CaptureFailed {
				d.captureFailure(ctx, s, fmt.Errorf("supervised output writer failed"))
			}
			if err = d.observeMainExit(s, status); err != nil {
				continue
			}
			if !status.Populated && status.Known {
				if _, err = d.DB.Event(protocol.RuntimeEvent{AttemptID: s.Dispatch.AttemptID, DispatchID: s.Dispatch.DispatchID, StreamID: "runtime", Kind: protocol.ProcessAbsent, Text: "verified whole-tree absence", BootID: &d.Boot}); err != nil {
					continue
				}
				s.Phase = "absent"
				_ = d.DB.SaveStart(s)
			}
		}
	}
}
func ptr(value string) *string { return &value }

func completeUTF8Prefix(data []byte) int {
	for i := 0; i < len(data); {
		_, size := utf8.DecodeRune(data[i:])
		if size == 1 && !utf8.FullRune(data[i:]) {
			return i
		}
		i += size
	}
	return len(data)
}

func serviceCaptureMarker(attemptID string) string {
	return filepath.Join(host.Root, "service", "capture-"+attemptID)
}

func captureMarkerSet(path string) bool {
	data, err := os.ReadFile(path)
	return err == nil && len(data) > 0 && data[0] == '1'
}

func reserveCaptureMarker(path string) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if errors.Is(err, os.ErrExist) {
		data, readErr := os.ReadFile(path)
		if readErr != nil || len(data) != 1 || data[0] != '0' {
			return fmt.Errorf("capture marker is not a clean reserved block: %w", errors.Join(readErr, err))
		}
		return nil
	}
	if err != nil {
		return err
	}
	_, writeErr := file.Write([]byte{'0'})
	syncErr := file.Sync()
	return errors.Join(writeErr, syncErr, file.Close())
}

func persistCaptureMarker(path string) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, writeErr := file.WriteAt([]byte{'1'}, 0)
	syncErr := file.Sync()
	return errors.Join(writeErr, syncErr, file.Close())
}

// A retained systemd wait result is a main-process exit fact even while
// detached descendants still hold the Attempt cgroup. The journal identity
// survives reconnect and prevents repeat terminal observations.
func (d *Daemon) observeMainExit(s journal.Start, status host.Status) error {
	if !status.Known || !status.MainExited {
		return nil
	}
	found, err := d.DB.HasRuntimeEvent(s.Dispatch.AttemptID, protocol.Exited)
	if err != nil || found {
		return err
	}
	_, err = d.DB.Event(protocol.RuntimeEvent{AttemptID: s.Dispatch.AttemptID, DispatchID: s.Dispatch.DispatchID, StreamID: "runtime", Kind: protocol.Exited, Text: "runtime main process exited; formal completion is independent", ExitCode: status.ExitCode, BootID: &d.Boot})
	return err
}

// A failed durable capture freezes this Attempt by asking the constrained host
// to stop the whole process tree. The reservation remains until reconciliation.
func (d *Daemon) captureFailure(ctx context.Context, s journal.Start, cause error) {
	log.Printf("Attempt %s log capture requires recovery: %v", s.Dispatch.AttemptID, cause)
	// The execution-account marker is read-only to this service. Record a
	// separate service-owned fact before Stop so a SQLite outage followed by
	// daemon restart cannot erase the need to publish Owner attention.
	if err := persistCaptureMarker(serviceCaptureMarker(s.Dispatch.AttemptID)); err != nil {
		log.Printf("Attempt %s capture marker failed: %v", s.Dispatch.AttemptID, err)
	}
	if _, err := d.Host.Call(ctx, host.Request{Action: "stop", AttemptID: s.Dispatch.AttemptID}); err != nil {
		log.Printf("Attempt %s writer stop remains unresolved: %v", s.Dispatch.AttemptID, err)
	}
	if alerted, err := d.DB.HasCaptureAlert(s.Dispatch.AttemptID); err == nil && alerted {
		return
	}
	_ = d.event(ctx, s, protocol.CaptureFailed, journal.CaptureAlertText)
}

func (d *Daemon) Run(ctx context.Context) error {
	for {
		if ctx.Err() != nil {
			return nil
		}
		err := d.Control.Run(ctx, d.Boot, d)
		if ctx.Err() != nil {
			return nil
		}
		log.Printf("control reconnect required: %s", err)
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(2 * time.Second):
		}
	}
}
