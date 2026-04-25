-- Synthetic DM-18 trigger: ALTER TABLE ... SET NOT NULL on a pre-existing
-- column without a backfill or DEFAULT. Should fire DM-18 (blocking) per
-- the calibrated rubric.
--
-- Depends on 0001_create_users.sql to provide the users table; otherwise
-- DM-01 (table not found) fires before DM-18.

ALTER TABLE users ALTER COLUMN email SET NOT NULL;
