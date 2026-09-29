-- Ordered Runner observations are separate from formal Task Events.
ALTER TABLE attempts ADD COLUMN exit_observed boolean NOT NULL DEFAULT false;
ALTER TABLE attempts ADD COLUMN activity_at timestamptz;
ALTER TABLE attempts ADD COLUMN log_visible_sequence bigint NOT NULL DEFAULT 0 CHECK (log_visible_sequence BETWEEN 0 AND 9007199254740991);
CREATE TABLE attempt_log_entries (
  attempt_id text NOT NULL REFERENCES attempts(id),
  order_sequence bigint NOT NULL CHECK (order_sequence BETWEEN 1 AND 9007199254740991),
  stream_id text NOT NULL, stream_sequence bigint NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (attempt_id,order_sequence),
  UNIQUE (attempt_id,stream_id,stream_sequence),
  FOREIGN KEY (attempt_id,stream_id,stream_sequence) REFERENCES runtime_events(attempt_id,stream_id,sequence)
);
-- Existing probe rows remain in runtime_events, without a false global order.
