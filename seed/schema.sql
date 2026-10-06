-- ════════════════════════════════════════════════
-- Amaze Consortium Members Portal — Supabase schema
-- Reconstructed from the app's REST calls (sbGet/sbInsert/sbUpdate/
-- sbUpsert/sbDelete) in js/*.js. Safe to run more than once: each
-- table is created if missing, then every column is added if missing
-- (so a partially-created table from an earlier run gets patched
-- instead of silently left as-is). Run this first, then seed.sql.
-- ════════════════════════════════════════════════

-- ─────────────────────────────
-- members
-- ─────────────────────────────
create table if not exists members (
  id text primary key
);
alter table members add column if not exists name      text;
alter table members add column if not exists position  text;  -- e.g. 'President' — drives role badges
alter table members add column if not exists joined    date;
alter table members add column if not exists pwd       text;  -- NOTE: stored/compared in plaintext today, see chat
alter table members add column if not exists email     text;
alter table members add column if not exists phone     text;
alter table members add column if not exists institute text;  -- affiliation / school / university
-- Email is now the login identifier: a member's Supabase Auth account
-- (created by hand in the dashboard, see seed/README.md) must use this
-- same email address. Login matches the signed-in Auth user back to this
-- table by email — see js/auth.js. Must be unique per member.
create unique index if not exists idx_members_email_lower
  on members (lower(email));
-- Delegated administrative power: a JSON array of section keys this member
-- may administer, e.g. ["resources","schedule"]. Empty = ordinary member.
-- The main administrator is not a row here, so their power can never be
-- revoked from inside the app.
alter table members add column if not exists permissions jsonb not null default '[]'::jsonb;

-- ─────────────────────────────
-- credits (one row per member; running totals shown on the leaderboard)
-- ─────────────────────────────
create table if not exists credits (
  member_id text primary key references members(id) on delete cascade
);
alter table credits add column if not exists season  integer not null default 0;
alter table credits add column if not exists month   integer not null default 0;
alter table credits add column if not exists alltime  integer not null default 0;

-- ─────────────────────────────
-- credit_log (append-only history of credit changes)
-- ─────────────────────────────
create table if not exists credit_log (
  id bigint generated always as identity primary key
);
alter table credit_log add column if not exists member_id   text references members(id) on delete cascade;
alter table credit_log add column if not exists member_name text;
alter table credit_log add column if not exists delta       integer;
alter table credit_log add column if not exists reason      text;
alter table credit_log add column if not exists type        text;    -- 'add' | 'sub'
alter table credit_log add column if not exists timestamp   bigint;  -- Date.now() in ms
alter table credit_log add column if not exists actor_id    text;    -- who applied the change ('admin' or a membership id)
alter table credit_log add column if not exists actor_name  text;    -- 'Administrator' or the member's name

-- ─────────────────────────────
-- activity_log (append-only audit trail of every action in the portal)
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
alter table activity_log disable row level security;
grant all on activity_log to anon;

-- ─────────────────────────────
-- config (generic key/value store; currently just the "stats" blob:
-- vicePresidents / seasonalChampions / monthlyChampions)
-- ─────────────────────────────
create table if not exists config (
  key text primary key
);
alter table config add column if not exists value text;  -- JSON-encoded string

-- ─────────────────────────────
-- att_events (attendance-taking events)
-- ─────────────────────────────
create table if not exists att_events (
  id text primary key  -- 'ev_' + Date.now()
);
alter table att_events add column if not exists title      text;
alter table att_events add column if not exists type       text;
alter table att_events add column if not exists date       date;
alter table att_events add column if not exists notes      text;
alter table att_events add column if not exists created_at bigint;

-- ─────────────────────────────
-- att_records (per-member status for each att_event)
-- ─────────────────────────────
create table if not exists att_records (
  event_id  text not null references att_events(id) on delete cascade,
  member_id text not null references members(id) on delete cascade,
  primary key (event_id, member_id)
);
-- 'excused' is NOT counted in attendance percentages at all — the event is
-- skipped for that member (this is also how members are handled for events
-- that happened before they joined the consortium).
alter table att_records add column if not exists status text;  -- 'present' | 'absent' | 'excused'

-- ─────────────────────────────
-- schedule_events (upcoming/past schedule cards)
-- ─────────────────────────────
create table if not exists schedule_events (
  id text primary key  -- 'sev_' + Date.now()
);
alter table schedule_events add column if not exists title      text;
alter table schedule_events add column if not exists type       text;
alter table schedule_events add column if not exists date       date;
alter table schedule_events add column if not exists time       text;
alter table schedule_events add column if not exists platform   text;
alter table schedule_events add column if not exists "desc"     text;  -- quoted: "desc" is a reserved word in Postgres
alter table schedule_events add column if not exists recording  text;  -- YouTube URL for the recording embed
alter table schedule_events add column if not exists created_at bigint;

-- ─────────────────────────────
-- programs
-- ─────────────────────────────
create table if not exists programs (
  id text primary key  -- 'prog_' + Date.now()
);
alter table programs add column if not exists title       text;
alter table programs add column if not exists description text;
alter table programs add column if not exists moderator   text;
alter table programs add column if not exists category    text;
alter table programs add column if not exists start_date  date;
alter table programs add column if not exists end_date    date;
alter table programs add column if not exists visibility  text default 'public';  -- 'public' | 'private'
alter table programs add column if not exists password    text;  -- access code, only used if visibility='private'
alter table programs add column if not exists items       jsonb default '[]';    -- program structure (modules/items built in admin UI)
alter table programs add column if not exists enrollments jsonb default '[]';    -- array of enrolled member ids (denormalized cache)
alter table programs add column if not exists created_at  bigint;

-- ─────────────────────────────
-- program_enrollments (source-of-truth enrollment records)
-- ─────────────────────────────
create table if not exists program_enrollments (
  program_id text not null references programs(id) on delete cascade,
  member_id  text not null references members(id) on delete cascade,
  primary key (program_id, member_id)
);
alter table program_enrollments add column if not exists enrolled_at bigint;

-- ─────────────────────────────
-- program_submissions (assignment submissions, admin-reviewable)
-- item_id is a stable identifier for the item within programs.items so that
-- reordering a program's items (moving videos/exams/etc up or down) never
-- breaks existing submissions. item_idx is kept only as a legacy reference.
-- ─────────────────────────────
create table if not exists program_submissions (
  program_id text not null references programs(id) on delete cascade,
  member_id  text not null references members(id) on delete cascade
);
alter table program_submissions add column if not exists item_id      text;
alter table program_submissions add column if not exists item_idx    integer;
alter table program_submissions add column if not exists item_title   text;
alter table program_submissions add column if not exists member_name  text;
alter table program_submissions add column if not exists link         text not null default '';
alter table program_submissions add column if not exists submitted_at bigint;

-- backfill item_id for any rows created before this migration, matching the
-- 'legacy_<index>' ids the app now assigns to pre-existing program items
update program_submissions set item_id = 'legacy_' || item_idx::text where item_id is null and item_idx is not null;

alter table program_submissions alter column item_id set not null;
alter table program_submissions drop constraint if exists program_submissions_pkey;
alter table program_submissions add primary key (program_id, item_id, member_id);

alter table program_submissions disable row level security;
grant all on program_submissions to anon;

-- ─────────────────────────────
-- resources (member-facing resource links, grouped by category)
-- ─────────────────────────────
create table if not exists resources (
  id text primary key  -- 'res_' + Date.now()
);
alter table resources add column if not exists title       text not null default '';
alter table resources add column if not exists description text;
alter table resources add column if not exists url         text not null default '';
alter table resources add column if not exists category    text not null default 'other';
alter table resources add column if not exists created_at  bigint;
alter table resources disable row level security;
grant all on resources to anon;

-- ─────────────────────────────
-- announcements
-- ─────────────────────────────
create table if not exists announcements (
  id text primary key  -- 'ann_' + Date.now()
);
alter table announcements add column if not exists title       text not null default '';
alter table announcements add column if not exists announcer   text not null default '';
alter table announcements add column if not exists date        text not null default '';
alter table announcements add column if not exists description text not null default '';
alter table announcements add column if not exists link_label  text;
alter table announcements add column if not exists link_url    text;
alter table announcements add column if not exists created_at  bigint;
alter table announcements disable row level security;
grant all on announcements to anon;

-- ─────────────────────────────
-- projects (active projects / sub teams / events / ventures members can join)
-- ─────────────────────────────
create table if not exists projects (
  id text primary key  -- 'proj_' + Date.now()
);
alter table projects add column if not exists title       text not null default '';
alter table projects add column if not exists objective   text not null default '';
alter table projects add column if not exists status      text not null default 'Active';  -- 'Active' | 'Partially Active' | 'Less Active' | 'Inactive'
alter table projects add column if not exists type        text not null default 'Project'; -- 'Project' | 'Sub Team' | 'Event' | 'Venture'
alter table projects add column if not exists manager     text not null default '';         -- project manager name
alter table projects add column if not exists start_date  date;
alter table projects add column if not exists progress    integer not null default 0;       -- 0-100
alter table projects add column if not exists how_to_join text;
alter table projects add column if not exists created_at  bigint;
alter table projects disable row level security;
grant all on projects to anon;

-- ─────────────────────────────
-- open_tasks (optional bounty-style tasks any member can pick up for credits)
-- ─────────────────────────────
create table if not exists open_tasks (
  id text primary key  -- 'task_' + Date.now()
);
alter table open_tasks add column if not exists title       text not null default '';
alter table open_tasks add column if not exists description text;
alter table open_tasks add column if not exists credits     integer not null default 0;   -- reward for completing it
alter table open_tasks add column if not exists category    text not null default 'general';
alter table open_tasks add column if not exists repeatable  boolean not null default false; -- true = many members can each complete & earn it; false = first claim locks it
alter table open_tasks add column if not exists status      text not null default 'open';  -- 'open' | 'closed' (closed = no new claims, existing claims still reviewable)
-- Delegated per-task editing power: a JSON array of member ids who may edit
-- THIS task and review/approve/reject ITS claims, in addition to whoever
-- holds the global "tasks" permission (see members.permissions) and the
-- administrator. Mirrors members.permissions but scoped to one task.
alter table open_tasks add column if not exists assigned_staff jsonb not null default '[]'::jsonb;
alter table open_tasks add column if not exists created_at  bigint;
alter table open_tasks disable row level security;
grant all on open_tasks to anon;

-- ─────────────────────────────
-- task_claims (one row per member's attempt at an open task)
-- ─────────────────────────────
create table if not exists task_claims (
  task_id   text not null references open_tasks(id) on delete cascade,
  member_id text not null references members(id) on delete cascade,
  primary key (task_id, member_id)
);
alter table task_claims add column if not exists member_name     text;
-- 'claimed' (picked up, working on it) | 'submitted' (proof sent, awaiting review)
-- | 'approved' (credited) | 'rejected' (sent back, may reclaim)
alter table task_claims add column if not exists status          text not null default 'claimed';
alter table task_claims add column if not exists submission_link text;
alter table task_claims add column if not exists submission_note text;
alter table task_claims add column if not exists claimed_at      bigint;
alter table task_claims add column if not exists submitted_at    bigint;
alter table task_claims add column if not exists reviewed_at     bigint;
alter table task_claims add column if not exists reviewed_by     text;  -- 'Administrator' or the reviewer's name
alter table task_claims add column if not exists review_note     text;  -- optional feedback, shown to the member
alter table task_claims disable row level security;
grant all on task_claims to anon;

-- ─────────────────────────────
-- Helpful indexes
-- ─────────────────────────────
create index if not exists idx_credit_log_timestamp on credit_log (timestamp desc);
create index if not exists idx_activity_log_timestamp on activity_log (timestamp desc);
create index if not exists idx_activity_log_section on activity_log (section);
create index if not exists idx_att_records_event on att_records (event_id);
create index if not exists idx_schedule_events_date on schedule_events (date);
create index if not exists idx_program_enrollments_program on program_enrollments (program_id);
create index if not exists idx_program_submissions_program on program_submissions (program_id);
create index if not exists idx_open_tasks_status on open_tasks (status);
create index if not exists idx_task_claims_task on task_claims (task_id);
create index if not exists idx_task_claims_member on task_claims (member_id);

-- ════════════════════════════════════════════════
-- ROW LEVEL SECURITY — please read before running
-- ════════════════════════════════════════════════
-- Member login now goes through Supabase Auth (email + password), so
-- Postgres/GoTrue verifies the password server-side — the browser never
-- sees anyone's password hash, and it can't compare its own guess against
-- a fetched list the way the old client-side check did. Auth accounts are
-- created/edited/deleted by hand in the Supabase dashboard
-- (Authentication → Users) — the app never touches Auth accounts itself.
--
-- That said, once a member IS signed in, this project still reads/writes
-- these tables with the anon key rather than per-user Auth policies, so
-- RLS here is still table-wide (open or closed), not per-member. Enabling
-- RLS with the permissive policies below restores today's behavior (anon
-- key can read/write everything) but at least makes that an explicit,
-- visible choice instead of an implicit default:
--
-- alter table members enable row level security;
-- create policy "public read/write" on members for all using (true) with check (true);
-- (repeat per table as needed)
--
-- Locking this down further (per-member RLS instead of table-wide) would
-- mean switching these REST calls to use each member's own Auth session
-- token instead of the shared anon key — a bigger follow-up if you want
-- it later.
