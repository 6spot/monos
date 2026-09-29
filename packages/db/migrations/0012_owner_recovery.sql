-- One settled Attempt can authorize at most one Owner Continue/Retry decision.
-- The immutable command receipt records the full request; this marker prevents
-- a later, different request from reopening the same historical blocker.
ALTER TABLE attempts ADD COLUMN recovery_consumed_by text;
