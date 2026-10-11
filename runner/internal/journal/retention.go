package journal

import (
	"database/sql"
	"encoding/json"
	"errors"
	"reflect"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

// The empty stream key stores the Attempt-wide order. These counters survive
// payload cleanup; terminal events and immutable request/effect records remain.
func nextEvent(tx *sql.Tx, attempt, stream string) (int64, int64, error) {
	if stream == "" {
		return 0, 0, ErrConflict
	}
	if stream == "stdout" || stream == "stderr" {
		var retired int
		if err := tx.QueryRow("SELECT count(*) FROM log_retirements WHERE attempt=?", attempt).Scan(&retired); err != nil {
			return 0, 0, err
		}
		if retired != 0 {
			return 0, 0, ErrConflict
		}
	}
	var seq, order int64
	err := tx.QueryRow(`SELECT max(COALESCE((SELECT sequence FROM event_high_water WHERE attempt=? AND stream=?),0),COALESCE(MAX(seq),0))+1 FROM events WHERE attempt=? AND stream=?`, attempt, stream, attempt, stream).Scan(&seq)
	if err != nil {
		return 0, 0, err
	}
	err = tx.QueryRow(`SELECT max(COALESCE((SELECT sequence FROM event_high_water WHERE attempt=? AND stream=''),0),COALESCE(MAX(order_seq),0))+1 FROM events WHERE attempt=?`, attempt, attempt).Scan(&order)
	if err != nil {
		return 0, 0, err
	}
	for key, value := range map[string]int64{stream: seq, "": order} {
		if _, err = tx.Exec(`INSERT INTO event_high_water VALUES(?,?,?) ON CONFLICT(attempt,stream) DO UPDATE SET sequence=excluded.sequence`, attempt, key, value); err != nil {
			return 0, 0, err
		}
	}
	return seq, order, nil
}

func retentionReady(tx *sql.Tx, attempt, dispatch string) (bool, error) {
	var ready bool
	err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM starts WHERE attempt=? AND dispatch=? AND json_extract(body,'$.phase')='absent')
 AND EXISTS(SELECT 1 FROM events WHERE attempt=? AND stream='runtime' AND acked=1 AND json_extract(body,'$.dispatch_id')=? AND json_extract(body,'$.kind')='process_absent')
 AND NOT EXISTS(SELECT 1 FROM events WHERE attempt=? AND acked=0)
 AND NOT EXISTS(SELECT 1 FROM effects WHERE json_extract(body,'$.attempt_id')=? AND (result IS NULL OR (COALESCE(json_extract(result,'$.success'),0)!=1 AND json_extract(result,'$.cancelled_by_operation_id') IS NULL)))`, attempt, dispatch, attempt, dispatch, attempt, attempt).Scan(&ready)
	return ready, err
}

// RetentionSince starts the clock only after the local absence fact is ACKed,
// all captured output is ACKed, and every local effect is terminal. A renewed
// pending event resets eligibility; wall-clock rollback simply delays cleanup.
func (d *DB) RetentionSince(attempt, dispatch string, now int64) (int64, bool, error) {
	tx, err := d.db.Begin()
	if err != nil {
		return 0, false, err
	}
	defer tx.Rollback()
	ready, err := retentionReady(tx, attempt, dispatch)
	if err != nil {
		return 0, false, err
	}
	if !ready {
		_, err = tx.Exec("DELETE FROM retention_eligible WHERE attempt=?", attempt)
		if err != nil {
			return 0, false, err
		}
		return 0, false, tx.Commit()
	}
	if _, err = tx.Exec("INSERT INTO retention_eligible VALUES(?,?,?) ON CONFLICT(attempt) DO NOTHING", attempt, dispatch, now); err != nil {
		return 0, false, err
	}
	var since int64
	var identity string
	if err = tx.QueryRow("SELECT dispatch,since FROM retention_eligible WHERE attempt=?", attempt).Scan(&identity, &since); err != nil {
		return 0, false, err
	}
	if identity != dispatch {
		return 0, false, ErrConflict
	}
	return since, true, tx.Commit()
}

type LogRetirement struct {
	AttemptID   string
	DispatchID  string
	StdoutBytes int64
	StderrBytes int64
	Cleaned     bool
}

func (d *DB) LogRetirement(attempt string) (*LogRetirement, error) {
	r := &LogRetirement{AttemptID: attempt}
	err := d.db.QueryRow("SELECT dispatch,stdout,stderr,cleaned FROM log_retirements WHERE attempt=?", attempt).Scan(&r.DispatchID, &r.StdoutBytes, &r.StderrBytes, &r.Cleaned)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return r, err
}

// RetireLogs must be called after a fresh physical-absence observation and stat
// of both root-owned spools. The caller supplies only exact terminal byte sizes.
// This durable ticket precedes every filesystem deletion and makes Tick stop
// reading those spools even if a crash interrupted cleanup between the files.
func (d *DB) RetireLogs(attempt, dispatch string, stdout, stderr, cutoff int64) (*LogRetirement, error) {
	tx, err := d.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	ready, err := retentionReady(tx, attempt, dispatch)
	if err != nil {
		return nil, err
	}
	if !ready {
		return nil, ErrConflict
	}
	var since int64
	if err = tx.QueryRow("SELECT since FROM retention_eligible WHERE attempt=? AND dispatch=?", attempt, dispatch).Scan(&since); err != nil {
		return nil, err
	}
	if since > cutoff || stdout < 0 || stderr < 0 {
		return nil, ErrConflict
	}
	for stream, size := range map[string]int64{"stdout": stdout, "stderr": stderr} {
		var offset int64
		err = tx.QueryRow("SELECT position FROM log_offsets WHERE attempt=? AND stream=?", attempt, stream).Scan(&offset)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		if offset != size {
			return nil, ErrConflict
		}
	}
	if _, err = tx.Exec("INSERT INTO log_retirements(attempt,dispatch,stdout,stderr) VALUES(?,?,?,?) ON CONFLICT(attempt) DO NOTHING", attempt, dispatch, stdout, stderr); err != nil {
		return nil, err
	}
	var retainedDispatch string
	var out, errs int64
	if err = tx.QueryRow("SELECT dispatch,stdout,stderr FROM log_retirements WHERE attempt=?", attempt).Scan(&retainedDispatch, &out, &errs); err != nil {
		return nil, err
	}
	if retainedDispatch != dispatch || out != stdout || errs != stderr {
		return nil, ErrConflict
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return d.LogRetirement(attempt)
}

func (d *DB) FinishLogRetirement(r LogRetirement) error {
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec("UPDATE log_retirements SET cleaned=1 WHERE attempt=? AND dispatch=? AND stdout=? AND stderr=?", r.AttemptID, r.DispatchID, r.StdoutBytes, r.StderrBytes)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return ErrConflict
	}
	if _, err = tx.Exec("DELETE FROM events WHERE attempt=? AND stream IN ('stdout','stderr') AND acked=1", r.AttemptID); err != nil {
		return err
	}
	return tx.Commit()
}

// Inspection retirement requires the backend's exact succeeded result as its
// acknowledgement, obtained through the existing authenticated recovery read.
// Retain the whole result and source proof even after deleting its snapshot.
func (d *DB) RetireInspection(remote protocol.Operation, cutoff int64) error {
	if remote.Inspection == nil || string(remote.State) != "succeeded" || remote.Result == nil {
		return ErrConflict
	}
	local, err := d.Operation(remote.OperationID)
	if err != nil {
		return err
	}
	result, err := d.Effect(remote.OperationID)
	if err != nil {
		return err
	}
	if !wire.SameOperation(local, remote) || result == nil || !result.Success || !reflect.DeepEqual(&result.Result, remote.Result) {
		return ErrConflict
	}
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	ready, err := retentionReady(tx, remote.AttemptID, remote.DispatchID)
	if err != nil {
		return err
	}
	if !ready {
		return ErrConflict
	}
	var since int64
	if err = tx.QueryRow("SELECT since FROM retention_eligible WHERE attempt=? AND dispatch=?", remote.AttemptID, remote.DispatchID).Scan(&since); err != nil {
		return err
	}
	if since > cutoff {
		return ErrConflict
	}
	raw, err := json.Marshal(remote)
	if err != nil {
		return err
	}
	if _, err = tx.Exec("INSERT INTO inspection_retirements(id,body) VALUES(?,?) ON CONFLICT(id) DO NOTHING", remote.OperationID, raw); err != nil {
		return err
	}
	return tx.Commit()
}

func (d *DB) InspectionRetired(id string) (bool, error) {
	var n int
	err := d.db.QueryRow("SELECT count(*) FROM inspection_retirements WHERE id=?", id).Scan(&n)
	return n != 0, err
}

func (d *DB) InspectionRetirementComplete(id string) (bool, error) {
	var n int
	err := d.db.QueryRow("SELECT count(*) FROM inspection_retirements WHERE id=? AND cleaned=1", id).Scan(&n)
	return n != 0, err
}

func (d *DB) FinishInspectionRetirement(id string) error {
	r, err := d.db.Exec("UPDATE inspection_retirements SET cleaned=1 WHERE id=?", id)
	if err != nil {
		return err
	}
	n, err := r.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return ErrConflict
	}
	return nil
}
