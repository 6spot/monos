package journal

import (
	"encoding/json"

	protocol "monos.local/protocol"
)

// Inspections reads retained immutable effect envelopes. It creates no second
// operation projection and includes intents without a result after a crash.
func (d *DB) Inspections(attempt string) ([]protocol.Operation, error) {
	rows, err := d.db.Query("SELECT body FROM effects WHERE json_extract(body, '$.attempt_id')=? AND json_type(body, '$.inspection')='object' ORDER BY id", attempt)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ops := []protocol.Operation{}
	for rows.Next() {
		var raw []byte
		if err = rows.Scan(&raw); err != nil {
			return nil, err
		}
		var op protocol.Operation
		if err = json.Unmarshal(raw, &op); err != nil {
			return nil, err
		}
		if op.AttemptID == attempt && op.Inspection != nil {
			ops = append(ops, op)
		}
	}
	return ops, rows.Err()
}
