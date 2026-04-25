-- Synthetic prior schema so the DM-18 trigger in 0002 has a table to
-- reference. Without this, 0002's ALTER fires DM-01 (table not found)
-- before DM-18 has a chance to evaluate.

CREATE TABLE users (
  id BIGINT PRIMARY KEY,
  email TEXT
);
