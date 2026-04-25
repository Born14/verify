-- Synthetic DM-18 trigger: ALTER TABLE ... SET NOT NULL on a pre-existing
-- column without a backfill. Should fire DM-18 (blocking) per the
-- calibrated rubric.

ALTER TABLE users ALTER COLUMN email SET NOT NULL;
