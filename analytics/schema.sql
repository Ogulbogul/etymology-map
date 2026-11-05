-- Anonymous daily usage totals for Etymology Map (see functions/api/e.js).
-- One row per day, event type and word/search text. No visitor data.
CREATE TABLE IF NOT EXISTS daily_counts (
  day     TEXT    NOT NULL,            -- YYYY-MM-DD (UTC)
  type    TEXT    NOT NULL,            -- view | miss | story | share | time | 404 | game (see functions/api/score.js)
  key     TEXT    NOT NULL,            -- word, missing search text, or 404 path
  count   INTEGER NOT NULL DEFAULT 0,  -- number of events that day
  seconds INTEGER NOT NULL DEFAULT 0,  -- total visible time (type = time only)
  PRIMARY KEY (day, type, key)
);
CREATE INDEX IF NOT EXISTS idx_daily_counts_type_day ON daily_counts (type, day);

-- Messages from the "Feedback" button (functions/api/feedback.js). Only what the sender typed.
CREATE TABLE IF NOT EXISTS feedback (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  day     TEXT    NOT NULL,            -- YYYY-MM-DD (UTC)
  page    TEXT    NOT NULL DEFAULT '', -- path the sender was on
  message TEXT    NOT NULL,
  contact TEXT    NOT NULL DEFAULT ''  -- optional reply-to email typed by the sender
);
CREATE INDEX IF NOT EXISTS idx_feedback_day ON feedback (day);
