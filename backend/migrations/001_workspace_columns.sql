-- Migration: add inputs to tasks, ready_at to practice_drugs
-- Run this in the Supabase SQL editor at:
-- https://supabase.com/dashboard/project/cysvwehmebnjvpxhdudv/sql/new

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS inputs jsonb NOT NULL DEFAULT '{}';

ALTER TABLE practice_drugs
  ADD COLUMN IF NOT EXISTS ready_at timestamptz;
