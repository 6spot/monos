// Package journal owns private infrastructure records; it is not a domain database.
package journal

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"

	_ "github.com/mattn/go-sqlite3"
	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

var ErrConflict = errors.New("payload_conflict")
var ErrUnknown = errors.New("unknown retained request")

const CaptureAlertText = "execution output capture uncertain; process stop requested; ownership requires reconciliation"

type DB struct{ db *sql.DB }
type Start struct {
	Dispatch protocol.Dispatch `json:"dispatch"`
	BootID   string            `json:"boot_id"`
	PID      int               `json:"pid"`
	Birth    string            `json:"birth"`
	Cgroup   string            `json:"cgroup"`
	Phase    string            `json:"phase"`
}
type Request struct {
	AttemptID string
	ID        string
	Raw       []byte
	Digest    string
}

func Open(path string) (*DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	info, err := os.Stat(filepath.Dir(path))
	if err != nil {
		return nil, err
	}
	if info.Mode().Perm()&0077 != 0 {
		return nil, fmt.Errorf("journal directory must be private")
	}
	handle, err := sql.Open("sqlite3", "file:"+path+"?_journal_mode=WAL&_synchronous=FULL&_busy_timeout=5000&_foreign_keys=on")
	if err != nil {
		return nil, err
	}
	handle.SetMaxOpenConns(1)
	_, err = handle.Exec(`CREATE TABLE IF NOT EXISTS starts(attempt TEXT PRIMARY KEY, dispatch TEXT UNIQUE NOT NULL, body BLOB NOT NULL);
 CREATE TABLE IF NOT EXISTS requests(attempt TEXT NOT NULL, id TEXT NOT NULL, envelope BLOB NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(attempt,id));
 CREATE TABLE IF NOT EXISTS effects(id TEXT PRIMARY KEY, body BLOB NOT NULL, result BLOB);
 CREATE TABLE IF NOT EXISTS events(attempt TEXT NOT NULL, stream TEXT NOT NULL, seq INTEGER NOT NULL, body BLOB NOT NULL, acked INTEGER NOT NULL DEFAULT 0, order_seq INTEGER, PRIMARY KEY(attempt,stream,seq));
 CREATE TABLE IF NOT EXISTS log_offsets(attempt TEXT NOT NULL, stream TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY(attempt,stream));`)
	if err != nil {
		handle.Close()
		return nil, err
	}
	// Existing probe journals have no Attempt order. Keep those rows unnumbered;
	// new observations start a durable order without claiming old interleaving.
	columns, err := handle.Query("PRAGMA table_info(events)")
	if err != nil {
		handle.Close()
		return nil, err
	}
	hasOrder := false
	for columns.Next() {
		var cid, notnull, pk int
		var name, typ string
		var defaultValue sql.NullString
		if err = columns.Scan(&cid, &name, &typ, &notnull, &defaultValue, &pk); err != nil {
			break
		}
		if name == "order_seq" {
			hasOrder = true
		}
	}
	if err == nil {
		err = columns.Err()
	}
	columns.Close()
	if err != nil {
		handle.Close()
		return nil, err
	}
	if !hasOrder {
		if _, err = handle.Exec("ALTER TABLE events ADD COLUMN order_seq INTEGER"); err != nil {
			handle.Close()
			return nil, err
		}
	}
	if _, err = handle.Exec("CREATE UNIQUE INDEX IF NOT EXISTS one_attempt_event_order ON events(attempt,order_seq) WHERE order_seq IS NOT NULL"); err != nil {
		handle.Close()
		return nil, err
	}
	if err = os.Chmod(path, 0600); err != nil {
		handle.Close()
		return nil, err
	}
	return &DB{handle}, nil
}
func (d *DB) Close() error { return d.db.Close() }
func (d *DB) SaveStart(s Start) error {
	old, err := d.Start(s.Dispatch.AttemptID)
	if err == nil && old.Dispatch.DispatchID != s.Dispatch.DispatchID {
		return ErrConflict
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	raw, err := json.Marshal(s)
	if err != nil {
		return err
	}
	_, err = d.db.Exec("INSERT INTO starts VALUES(?,?,?) ON CONFLICT(attempt) DO UPDATE SET body=excluded.body", s.Dispatch.AttemptID, s.Dispatch.DispatchID, raw)
	return err
}
func (d *DB) Start(id string) (Start, error) {
	var s Start
	var raw []byte
	err := d.db.QueryRow("SELECT body FROM starts WHERE attempt=?", id).Scan(&raw)
	if err == nil {
		err = json.Unmarshal(raw, &s)
	}
	return s, err
}
func (d *DB) Starts() ([]Start, error) {
	rows, err := d.db.Query("SELECT body FROM starts ORDER BY attempt")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Start{}
	for rows.Next() {
		var raw []byte
		var s Start
		if err = rows.Scan(&raw); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(raw, &s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
func (d *DB) PutRequest(attempt string, raw []byte) (Request, error) {
	env, err := wire.Envelope(raw)
	if err != nil {
		return Request{}, err
	}
	canonical, digest, err := wire.CanonicalRaw(raw)
	if err != nil {
		return Request{}, err
	}
	tx, err := d.db.Begin()
	if err != nil {
		return Request{}, err
	}
	defer tx.Rollback()
	_, err = tx.Exec("INSERT INTO requests VALUES(?,?,?,?) ON CONFLICT(attempt,id) DO NOTHING", attempt, env.RequestID, canonical, digest)
	if err != nil {
		return Request{}, err
	}
	var retained []byte
	var hash string
	err = tx.QueryRow("SELECT envelope,digest FROM requests WHERE attempt=? AND id=?", attempt, env.RequestID).Scan(&retained, &hash)
	if err != nil {
		return Request{}, err
	}
	if !bytes.Equal(retained, canonical) || hash != digest {
		return Request{}, ErrConflict
	}
	if err = tx.Commit(); err != nil {
		return Request{}, err
	}
	return Request{attempt, env.RequestID, retained, hash}, nil
}
func (d *DB) Request(attempt, id string) (Request, error) {
	r := Request{AttemptID: attempt, ID: id}
	err := d.db.QueryRow("SELECT envelope,digest FROM requests WHERE attempt=? AND id=?", attempt, id).Scan(&r.Raw, &r.Digest)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrUnknown
	}
	return r, err
}
func (d *DB) BeginEffect(op protocol.Operation) error {
	raw, err := json.Marshal(op)
	if err != nil {
		return err
	}
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.Exec("INSERT INTO effects(id,body) VALUES(?,?) ON CONFLICT(id) DO NOTHING", op.OperationID, raw)
	if err != nil {
		return err
	}
	var oldRaw []byte
	if err = tx.QueryRow("SELECT body FROM effects WHERE id=?", op.OperationID).Scan(&oldRaw); err != nil {
		return err
	}
	var old protocol.Operation
	if err = json.Unmarshal(oldRaw, &old); err != nil {
		return err
	}
	if !wire.SameOperation(old, op) {
		return ErrConflict
	}

	return tx.Commit()
}

func (d *DB) LogOffset(attempt, stream string) (int64, error) {
	var n int64
	err := d.db.QueryRow("SELECT position FROM log_offsets WHERE attempt=? AND stream=?", attempt, stream).Scan(&n)
	if errors.Is(err, sql.ErrNoRows) {
		err = nil
	}
	return n, err
}

// LogEvent atomically records a chunk and advances its source cursor. Reconnect
// replays the same event sequence rather than minting duplicate stream events.
func (d *DB) LogEvent(e protocol.RuntimeEvent, from, to int64) (protocol.RuntimeEvent, error) {
	tx, err := d.db.Begin()
	if err != nil {
		return e, err
	}
	defer tx.Rollback()
	var current int64
	err = tx.QueryRow("SELECT position FROM log_offsets WHERE attempt=? AND stream=?", e.AttemptID, e.StreamID).Scan(&current)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return e, err
	}
	if current != from || to <= from {
		return e, ErrConflict
	}
	if err = tx.QueryRow("SELECT COALESCE(MAX(seq),0)+1 FROM events WHERE attempt=? AND stream=?", e.AttemptID, e.StreamID).Scan(&e.Sequence); err != nil {
		return e, err
	}
	var order int64
	if err = tx.QueryRow("SELECT COALESCE(MAX(order_seq),0)+1 FROM events WHERE attempt=?", e.AttemptID).Scan(&order); err != nil {
		return e, err
	}
	e.OrderSequence = &order
	raw, err := json.Marshal(e)
	if err != nil {
		return e, err
	}
	if _, err = tx.Exec("INSERT INTO events(attempt,stream,seq,body,order_seq) VALUES(?,?,?,?,?)", e.AttemptID, e.StreamID, e.Sequence, raw, order); err != nil {
		return e, err
	}
	if _, err = tx.Exec("INSERT INTO log_offsets VALUES(?,?,?) ON CONFLICT(attempt,stream) DO UPDATE SET position=excluded.position", e.AttemptID, e.StreamID, to); err != nil {
		return e, err
	}
	return e, tx.Commit()
}
func (d *DB) Operation(id string) (protocol.Operation, error) {
	var op protocol.Operation
	var raw []byte
	err := d.db.QueryRow("SELECT body FROM effects WHERE id=?", id).Scan(&raw)
	if err != nil {
		return op, err
	}
	err = json.Unmarshal(raw, &op)
	return op, err
}

func finishEffect(tx *sql.Tx, r protocol.OperationResult) error {
	raw, err := json.Marshal(r)
	if err != nil {
		return err
	}
	var body, previous []byte
	if err = tx.QueryRow("SELECT body,result FROM effects WHERE id=?", r.OperationID).Scan(&body, &previous); err != nil {
		return err
	}
	var op protocol.Operation
	if err = json.Unmarshal(body, &op); err != nil {
		return err
	}
	if op.AttemptID != r.AttemptID {
		return ErrConflict
	}
	if r.Success && op.Kind == protocol.KindCompleteNode && op.Workspaces != nil {
		if err = wire.ValidateCompletionResult(op, r.Result); err != nil {
			return err
		}
	}
	if previous != nil {
		var old protocol.OperationResult
		if err = json.Unmarshal(previous, &old); err != nil {
			return err
		}
		if (old.Success || old.CancelledByOperationID != nil) && !reflect.DeepEqual(old, r) {
			return ErrConflict
		}
	}
	_, err = tx.Exec("UPDATE effects SET result=? WHERE id=?", raw, r.OperationID)
	return err
}

func (d *DB) FinishEffect(r protocol.OperationResult) error {
	if r.CompletionSettlement != nil {
		return d.FinishCompletionSettlement(r)
	}
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = finishEffect(tx, r); err != nil {
		return err
	}
	return tx.Commit()
}

// Both terminal records commit together. A failed second write or changed
// retained terminal result leaves both previous results untouched.
func (d *DB) FinishCompletionSettlement(r protocol.OperationResult) error {
	if r.CompletionSettlement == nil {
		return ErrConflict
	}
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	read := func(id string) (protocol.Operation, error) {
		var op protocol.Operation
		var raw []byte
		if e := tx.QueryRow("SELECT body FROM effects WHERE id=?", id).Scan(&raw); e != nil {
			return op, e
		}
		e := json.Unmarshal(raw, &op)
		return op, e
	}
	op, err := read(r.OperationID)
	if err != nil {
		return err
	}
	original, err := read(r.CompletionSettlement.CompletionOperationID)
	if err != nil {
		return err
	}
	if err = wire.ValidateCompletionPair(op, original, r); err != nil {
		return err
	}
	if err = finishEffect(tx, wire.CompletionResult(r.CompletionSettlement.CompletionResult)); err != nil {
		return err
	}
	if err = finishEffect(tx, r); err != nil {
		return err
	}
	return tx.Commit()
}
func (d *DB) Effect(id string) (*protocol.OperationResult, error) {
	var raw []byte
	err := d.db.QueryRow("SELECT result FROM effects WHERE id=?", id).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) || err == nil && raw == nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var result protocol.OperationResult
	err = json.Unmarshal(raw, &result)
	return &result, err
}
func (d *DB) Event(e protocol.RuntimeEvent) (protocol.RuntimeEvent, error) {
	tx, err := d.db.Begin()
	if err != nil {
		return e, err
	}
	defer tx.Rollback()
	if err = tx.QueryRow("SELECT COALESCE(MAX(seq),0)+1 FROM events WHERE attempt=? AND stream=?", e.AttemptID, e.StreamID).Scan(&e.Sequence); err != nil {
		return e, err
	}
	var order int64
	if err = tx.QueryRow("SELECT COALESCE(MAX(order_seq),0)+1 FROM events WHERE attempt=?", e.AttemptID).Scan(&order); err != nil {
		return e, err
	}
	e.OrderSequence = &order
	raw, err := json.Marshal(e)
	if err != nil {
		return e, err
	}
	_, err = tx.Exec("INSERT INTO events(attempt,stream,seq,body,order_seq) VALUES(?,?,?,?,?)", e.AttemptID, e.StreamID, e.Sequence, raw, order)
	if err != nil {
		return e, err
	}
	return e, tx.Commit()
}
func (d *DB) Ack(attempt, stream string, seq int64) error {
	_, err := d.db.Exec("UPDATE events SET acked=1 WHERE attempt=? AND stream=? AND seq=?", attempt, stream, seq)
	return err
}
func (d *DB) PendingEvents() ([]protocol.RuntimeEvent, error) {
	rows, err := d.db.Query("SELECT body FROM events WHERE acked=0 ORDER BY attempt,order_seq,stream,seq LIMIT 256")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []protocol.RuntimeEvent{}
	for rows.Next() {
		var raw []byte
		var e protocol.RuntimeEvent
		if err = rows.Scan(&raw); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(raw, &e); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (d *DB) HasCaptureAlert(attempt string) (bool, error) {
	return d.HasRuntimeEvent(attempt, protocol.CaptureFailed)
}

func (d *DB) HasRuntimeEvent(attempt string, kind protocol.RuntimeEventKind) (bool, error) {
	var count int
	err := d.db.QueryRow("SELECT count(*) FROM events WHERE attempt=? AND stream='runtime' AND json_extract(body,'$.kind')=?", attempt, kind).Scan(&count)
	return count > 0, err
}

// TerminalEvent reads the immutable retained terminal fact, including ACKed
// rows. PendingEvents is only a delivery batch and cannot prove a past exit.
func (d *DB) TerminalEvent(attempt, dispatch string, kind protocol.RuntimeEventKind) (protocol.RuntimeEvent, bool, error) {
	var event protocol.RuntimeEvent
	if kind != protocol.Exited && kind != protocol.ProcessAbsent {
		return event, false, fmt.Errorf("not a terminal runtime event")
	}
	var raw []byte
	err := d.db.QueryRow("SELECT body FROM events WHERE attempt=? AND stream='runtime' AND json_extract(body,'$.dispatch_id')=? AND json_extract(body,'$.kind')=? ORDER BY seq LIMIT 1", attempt, dispatch, kind).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return event, false, nil
	}
	if err != nil {
		return event, false, err
	}
	if err = json.Unmarshal(raw, &event); err != nil {
		return event, false, err
	}
	return event, true, nil
}
