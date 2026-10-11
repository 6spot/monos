package journal

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"reflect"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func (d *DB) BeginTaskCleanup(request protocol.TaskCleanupRequest) (string, *protocol.TaskCleanupResult, error) {
	raw, digest, err := wire.Canonical(request)
	if err != nil {
		return "", nil, err
	}
	if err = wire.Validate("TaskCleanupRequest", raw); err != nil {
		return "", nil, err
	}
	tx, err := d.db.Begin()
	if err != nil {
		return "", nil, err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("INSERT INTO task_cleanups(id,task,request,digest) VALUES(?,?,?,?) ON CONFLICT DO NOTHING", request.CleanupID, request.TaskID, raw, digest); err != nil {
		return "", nil, err
	}
	var retained, result []byte
	var hash string
	if err = tx.QueryRow("SELECT request,digest,result FROM task_cleanups WHERE id=?", request.CleanupID).Scan(&retained, &hash, &result); err != nil {
		return "", nil, err
	}
	if !bytes.Equal(raw, retained) || hash != digest {
		return "", nil, ErrConflict
	}
	var prior *protocol.TaskCleanupResult
	if result != nil {
		prior = &protocol.TaskCleanupResult{}
		if err = json.Unmarshal(result, prior); err != nil {
			return "", nil, err
		}
	}
	return digest, prior, tx.Commit()
}

func (d *DB) FinishTaskCleanup(result protocol.TaskCleanupResult) error {
	raw, err := json.Marshal(result)
	if err != nil {
		return err
	}
	if err = wire.Validate("TaskCleanupResult", raw); err != nil {
		return err
	}
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var hash string
	var retained []byte
	if err = tx.QueryRow("SELECT digest,result FROM task_cleanups WHERE id=?", result.CleanupID).Scan(&hash, &retained); err != nil {
		return err
	}
	if hash != result.RequestDigest {
		return ErrConflict
	}
	if retained != nil {
		var old protocol.TaskCleanupResult
		if err = json.Unmarshal(retained, &old); err != nil {
			return err
		}
		if old.Status == "completed" && !reflect.DeepEqual(old, result) {
			return ErrConflict
		}
	}
	if _, err = tx.Exec("UPDATE task_cleanups SET result=? WHERE id=?", raw, result.CleanupID); err != nil {
		return err
	}
	return tx.Commit()
}

func (d *DB) AckTaskCleanup(ack protocol.TaskCleanupACK) error {
	r, err := d.db.Exec("UPDATE task_cleanups SET acked=1 WHERE id=? AND digest=? AND json_extract(result,'$.status')='completed'", ack.CleanupID, ack.RequestDigest)
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

func (d *DB) PendingTaskCleanupResults() ([]protocol.TaskCleanupResult, error) {
	rows, err := d.db.Query("SELECT result FROM task_cleanups WHERE acked=0 AND json_extract(result,'$.status')='completed' ORDER BY id LIMIT 16")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	results := []protocol.TaskCleanupResult{}
	for rows.Next() {
		var raw []byte
		var r protocol.TaskCleanupResult
		if err = rows.Scan(&raw); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(raw, &r); err != nil {
			return nil, err
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

func (d *DB) TaskRetired(task string) (bool, error) {
	var id string
	err := d.db.QueryRow("SELECT id FROM task_cleanups WHERE task=?", task).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (d *DB) TaskCleanup(task string) (*protocol.TaskCleanupRequest, error) {
	var raw []byte
	err := d.db.QueryRow("SELECT request FROM task_cleanups WHERE task=?", task).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var request protocol.TaskCleanupRequest
	if err = json.Unmarshal(raw, &request); err != nil {
		return nil, err
	}
	return &request, nil
}

func (d *DB) AttemptEffectsTerminal(attempt string) (bool, error) {
	var n int
	err := d.db.QueryRow("SELECT count(*) FROM effects WHERE json_extract(body,'$.attempt_id')=? AND (result IS NULL OR (COALESCE(json_extract(result,'$.success'),0)!=1 AND json_extract(result,'$.cancelled_by_operation_id') IS NULL))", attempt).Scan(&n)
	return n == 0, err
}
