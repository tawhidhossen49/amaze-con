-- ════════════════════════════════════════════════
-- MIGRATION — open tasks (optional bounty-style tasks
--             any member can pick up for credits)
-- ════════════════════════════════════════════════
-- Run this once in the Supabase SQL editor (SQL Editor → New query →
-- paste → Run) for the project the portal points at. It is safe to run
-- more than once: every statement is "if not exists"/idempotent.
--
-- This is also folded into seed/schema.sql so a fresh project created
-- from that file already has it.
-- ════════════════════════════════════════════════

-- ─────────────────────────────
-- 1. open_tasks — the task itself
-- ─────────────────────────────
create table if not exists open_tasks (
  id text primary key  -- 'task_' + Date.now()
);
alter table open_tasks add column if not exists title       text not null default '';
alter table open_tasks add column if not exists description text;
alter table open_tasks add column if not exists credits     integer not null default 0;   -- reward for completing it
alter table open_tasks add column if not exists category    text not null default 'general';
alter table open_tasks add column if not exists repeatable  boolean not null default false; -- true = many members can each complete & earn it; false = first claim locks it
alter table open_tasks add column if not exists status      text not null default 'open';  -- 'open' | 'closed'
-- Delegated per-task editing power — a JSON array of member ids who may
-- edit THIS task and review/approve/reject ITS claims, on top of whoever
-- holds the global "tasks" permission and the administrator.
alter table open_tasks add column if not exists assigned_staff jsonb not null default '[]'::jsonb;
alter table open_tasks add column if not exists created_at  bigint;
alter table open_tasks disable row level security;
grant all on open_tasks to anon;

-- ─────────────────────────────
-- 2. task_claims — one row per member's attempt at an open task
-- ─────────────────────────────
create table if not exists task_claims (
  task_id   text not null references open_tasks(id) on delete cascade,
  member_id text not null references members(id) on delete cascade,
  primary key (task_id, member_id)
);
alter table task_claims add column if not exists member_name     text;
alter table task_claims add column if not exists status          text not null default 'claimed'; -- claimed | submitted | approved | rejected
alter table task_claims add column if not exists submission_link text;
alter table task_claims add column if not exists submission_note text;
alter table task_claims add column if not exists claimed_at      bigint;
alter table task_claims add column if not exists submitted_at    bigint;
alter table task_claims add column if not exists reviewed_at     bigint;
alter table task_claims add column if not exists reviewed_by     text;
alter table task_claims add column if not exists review_note     text;
alter table task_claims disable row level security;
grant all on task_claims to anon;

-- ─────────────────────────────
-- 3. Indexes
-- ─────────────────────────────
create index if not exists idx_open_tasks_status  on open_tasks  (status);
create index if not exists idx_task_claims_task   on task_claims (task_id);
create index if not exists idx_task_claims_member on task_claims (member_id);

-- ─────────────────────────────
-- 4. Add "tasks" to the set of sections that can be delegated
-- ─────────────────────────────
-- No schema change needed for this part — members.permissions already
-- stores a free-form JSON array of section keys (see
-- migration-permissions-and-logs.sql). The portal's PERM_SECTIONS list in
-- js/permissions.js now includes 'tasks', so ticking it for a member in
-- the admin panel's access-control screen is enough to let them create,
-- edit, and delete any open task and review any submission — the same
-- as the administrator, scoped to this one section.
