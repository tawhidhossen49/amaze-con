-- ════════════════════════════════════════════════
-- MIGRATION — delegated permissions, activity log,
--             credit-log attribution, attendance excusals
-- ════════════════════════════════════════════════
-- Run this once in the Supabase SQL editor (SQL Editor → New query →
-- paste → Run) for the project the portal points at. It is safe to run
-- more than once: every statement is "if not exists"/idempotent.
--
-- These changes are also folded into seed/schema.sql so a fresh project
-- created from that file already has them.
-- ════════════════════════════════════════════════

-- ─────────────────────────────
-- 1. Delegated section permissions
-- ─────────────────────────────
-- A JSON array of section keys a member is allowed to administer, e.g.
--   ["resources","schedule"]
-- An empty array (the default) means "ordinary member". The main
-- administrator is not a row in this table and therefore can never have
-- their power revoked from inside the app.
alter table members add column if not exists permissions jsonb not null default '[]'::jsonb;

-- ─────────────────────────────
-- 2. Credit log — who applied the change
-- ─────────────────────────────
alter table credit_log add column if not exists actor_id   text;
alter table credit_log add column if not exists actor_name text;

-- ─────────────────────────────
-- 3. Activity log — append-only audit trail of every action
-- ─────────────────────────────
create table if not exists activity_log (
  id bigint generated always as identity primary key
);
alter table activity_log add column if not exists actor_id   text;   -- 'admin' or a membership id
alter table activity_log add column if not exists actor_name text;   -- 'Administrator' or the member's name
alter table activity_log add column if not exists action     text;   -- 'create' | 'update' | 'delete' | 'reset' | 'award' | 'grant' | 'revoke' | 'enroll' | 'submit'
alter table activity_log add column if not exists section    text;   -- 'resources' | 'schedule' | 'credits' | ...
alter table activity_log add column if not exists target     text;   -- the thing acted on, e.g. a resource title
alter table activity_log add column if not exists details    text;   -- free-form extra context
alter table activity_log add column if not exists timestamp  bigint; -- Date.now() in ms

create index if not exists idx_activity_log_timestamp on activity_log (timestamp desc);
create index if not exists idx_activity_log_section   on activity_log (section);

alter table activity_log disable row level security;
grant all on activity_log to anon;

-- ─────────────────────────────
-- 4. Attendance — 'excused' means "not counted"
-- ─────────────────────────────
-- No column change is needed (att_records.status already stores
-- 'present' | 'absent' | 'excused'); the app now excludes 'excused' rows
-- from every attendance percentage, and marks members as 'excused' for
-- events that happened before they joined. This backfill applies that
-- same rule to the history already in the database: any member who has
-- no record at all for an event that predates their joining date is
-- given an explicit 'excused' record, and any 'absent' record for such an
-- event is corrected to 'excused'.
--
-- NOTE ON THE DATE COMPARISON BELOW: depending on how the table was first
-- created, members.joined and att_events.date may be stored as `date` or as
-- `text`, and Postgres has no `date < text` operator. Both are written in
-- ISO form (YYYY-MM-DD), which sorts identically as text, so both sides are
-- cast to text and compared that way — correct for either column type, and
-- it never tries to parse a value that isn't a real date.
insert into att_records (event_id, member_id, status)
select e.id, m.id, 'excused'
from att_events e
cross join members m
where m.joined::text ~ '^\d{4}-\d{2}-\d{2}'
  and e.date::text   ~ '^\d{4}-\d{2}-\d{2}'
  and left(e.date::text, 10) < left(m.joined::text, 10)
  and not exists (
    select 1 from att_records r where r.event_id = e.id and r.member_id = m.id
  );

update att_records r
set status = 'excused'
from att_events e, members m
where r.event_id = e.id
  and r.member_id = m.id
  and r.status = 'absent'
  and m.joined::text ~ '^\d{4}-\d{2}-\d{2}'
  and e.date::text   ~ '^\d{4}-\d{2}-\d{2}'
  and left(e.date::text, 10) < left(m.joined::text, 10);
