-- Migration: Create laptop_loans table
-- Run this in your Supabase SQL editor

CREATE TABLE IF NOT EXISTS laptop_loans (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  laptop_id           TEXT        NOT NULL,
  laptop_name         TEXT        NOT NULL,
  borrower_name       TEXT        NOT NULL,
  ministry            TEXT,
  start_date          DATE        NOT NULL,
  end_date            DATE        NOT NULL,
  start_datetime      TIMESTAMPTZ NOT NULL,
  end_datetime        TIMESTAMPTZ NOT NULL,
  duration            TEXT,
  reason              TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'active',   -- 'active' | 'returned'
  reminder_sent       BOOLEAN     NOT NULL DEFAULT FALSE,
  overdue_notified    BOOLEAN     NOT NULL DEFAULT FALSE,
  returned_by         TEXT,
  return_datetime     TIMESTAMPTZ,
  return_remarks      TEXT,
  checklist_checked   TEXT[],
  checklist_unchecked TEXT[],
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast user queries
CREATE INDEX IF NOT EXISTS laptop_loans_user_id_idx ON laptop_loans(user_id);

-- Index for status + date queries (cron, availability checks)
CREATE INDEX IF NOT EXISTS laptop_loans_status_end_idx ON laptop_loans(status, end_date);
CREATE INDEX IF NOT EXISTS laptop_loans_laptop_status_idx ON laptop_loans(laptop_id, status);
