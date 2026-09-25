-- Anonymous daily usage totals for Etymology Map (see functions/api/e.js).
-- One row per day, event type and word/search text. No visitor data.
CREATE TABLE IF NOT EXISTS daily_counts (
  day     TEXT    NOT NULL,            -- YYYY-MM-DD (UTC)
  type    TEXT    NOT NULL,            -- view | miss | story | share | time | 404
  key     TEXT    NOT NULL,            -- word, missing search text, or 404 path
  count   INTEGER NOT NULL DEFAULT 0,  -- number of events that day
  seconds INTEGER NOT NULL DEFAULT 0,  -- total visible time (type = time only)
  PRIMARY KEY (day, type, key)
);
CREATE INDEX IF NOT EXISTS idx_daily_counts_type_day ON daily_counts (type, day);
