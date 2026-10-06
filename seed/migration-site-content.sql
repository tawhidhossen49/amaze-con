-- ════════════════════════════════════════════════
-- Public website content (shared with the members portal)
-- ════════════════════════════════════════════════
-- One table backs every editable list on the PUBLIC website (the
-- "Amaze Con 1" site, deployed separately from this portal):
--   'executive' → executive members section
--   'advisor'   → "the people we learn from" section
--   'school'    → "run by students from" logo strip
--   'subsidiary'→ "our subsidiaries" (ventures) section
--   'partner'   → "trusted by our partners" section
--
-- The public site READS this table directly (same Supabase project,
-- same public anon key it already used before). The members portal
-- reads AND writes it from Dashboard → "public website", which now has
-- a tab per type above. Safe to run more than once.

create table if not exists site_content (
  id text primary key  -- 'sc_' + Date.now()
);
alter table site_content add column if not exists type        text not null default 'executive'; -- see list above
alter table site_content add column if not exists name        text not null default '';
alter table site_content add column if not exists subtitle    text;    -- role (executive/advisor) or short wordmark (subsidiary) — unused for school/partner
alter table site_content add column if not exists description text;    -- longer blurb — only used for subsidiaries today
alter table site_content add column if not exists img         text;    -- photo / logo URL, or a path already on the public site (e.g. img/zihan.jpg)
alter table site_content add column if not exists initials    text;    -- shown if img is empty/broken
alter table site_content add column if not exists url         text;    -- optional: makes the card/logo a link
alter table site_content add column if not exists sort_order  integer not null default 0;  -- lower = shown first, within its type
alter table site_content add column if not exists created_at  bigint;

create index if not exists idx_site_content_type_sort on site_content (type, sort_order asc, created_at asc);

-- ─────────────────────────────
-- Row Level Security
-- ─────────────────────────────
-- Unlike most tables in this project, this one is worth actually
-- locking down, since it's readable directly by the public website —
-- i.e. anyone who opens the public site's page source can see (and,
-- under the old "disable RLS / grant all" pattern used elsewhere in
-- this schema, could also WRITE to) this table using the same
-- anon/publishable key. That key is *meant* to be public — Supabase
-- calls it "publishable" for a reason, and it was already shipped
-- inside the members portal's own JS bundle before this table existed —
-- but there's no reason to also leave the door open for writes.
--
-- So: anyone (anon or logged in) can READ this table — it's public
-- website content, that's the point — but only someone signed in
-- through the portal can WRITE to it.
alter table site_content enable row level security;

drop policy if exists "public read" on site_content;
create policy "public read" on site_content
  for select using (true);

drop policy if exists "signed-in members can write" on site_content;
create policy "signed-in members can write" on site_content
  for all
  to authenticated
  using (true)
  with check (true);

-- IMPORTANT CAVEAT — please read:
-- The administrator login in this app (ADMIN_ID / ADMIN_PWD in
-- js/auth.js) is a hardcoded value checked in the browser, not a real
-- Supabase Auth account — so it does NOT get a Supabase session, and
-- the "authenticated" policy above does not apply to it. For the admin
-- account to write to this table under the policy above, either:
--   (a) give the administrator a real Supabase Auth account too (then
--       ADMIN_ID/PWD can sign in behind the scenes the same way members
--       do), or
--   (b) skip this stricter policy for now — see the commented-out
--       fallback below, which matches every OTHER table in this schema
--       (open to anon, same as before).
-- Ask if you'd like help with (a) — it's the fix worth doing since it
-- also closes the "hardcoded password sitting in plain JS" issue
-- flagged elsewhere in this project.
--
-- Fallback (matches the rest of the schema; anon can write too):
-- drop policy if exists "signed-in members can write" on site_content;
-- create policy "anon can write too" on site_content for all using (true) with check (true);

-- ─────────────────────────────
-- One-time seed: carries over everything that was hardcoded across the
-- public site's index.html (executives, advisors, the "run by students
-- from" logo strip, subsidiaries/ventures, and partners), so switching
-- to the database doesn't lose or reorder anyone. Safe to run more than
-- once (ON CONFLICT DO NOTHING) — if you've already edited these from
-- the portal, re-running this file will NOT overwrite your changes.
-- ─────────────────────────────
insert into site_content (id, type, name, subtitle, description, img, initials, url, sort_order, created_at) values
  -- executives
  ('sc_exec_1', 'executive', 'farhan s zihan',   'vice-president',          null, 'img/zihan.jpg',   'FZ', null, 1, 1),
  ('sc_exec_2', 'executive', 'nazmus salehin',   'co-ordinator',            null, 'img/salehin.png', 'NS', null, 2, 2),
  ('sc_exec_3', 'executive', 'asif chowdhury',   'data manager',            null, 'img/asif.jpg',    'AC', null, 3, 3),
  ('sc_exec_4', 'executive', 'maliha mehzabien', 'creative media officer',  null, 'img/maliha.jpg',  'MM', null, 4, 4),
  ('sc_exec_5', 'executive', 'taha nibras',      'human resources manager',null, 'img/taha.jpg',     'TN', null, 5, 5),
  ('sc_exec_6', 'executive', 'eftiyak arfin',    'marketing manager',      null, 'img/eftiyak.jpg',  'EA', null, 6, 6),
  ('sc_exec_7', 'executive', 'tawhid hossen',    'technology manager',     null, 'img/tawhid.jpg',   'TH', null, 7, 7),

  -- advisors ("the people we learn from")
  ('sc_adv_1', 'advisor', 's m ehsan habib shumon', 'founder of sarangsho',      null, 'img/advisoreh.jpg', 'EH', 'https://www.linkedin.com/in/ehsanhabibshumon/', 1, 1),
  ('sc_adv_2', 'advisor', 'md abdur rahman',        'founder of bondi pathshala', null, 'img/advisorar.jpg', 'AR', 'https://www.linkedin.com/in/md-abdur-rahman-9090ba358/', 2, 2),

  -- schools ("run by students from" marquee)
  ('sc_sch_1', 'school', 'adamjee cantonment college',   null, null, 'img/acc.png',   'ACC',   null, 1, 1),
  ('sc_sch_2', 'school', 'baf shaheen college dhaka',    null, null, 'img/bafsd.png', 'BAFSD', null, 2, 2),
  ('sc_sch_3', 'school', 'government science college',   null, null, 'img/gsc.png',   'GSC',   null, 3, 3),
  ('sc_sch_4', 'school', 'dhaka college',                null, null, 'img/dc.png',    'DC',    null, 4, 4),
  ('sc_sch_5', 'school', 'dhaka university',             null, null, 'img/du.png',    'DU',    null, 5, 5),
  ('sc_sch_6', 'school', 'rajuk uttara model college',   null, null, 'img/rumc.png',  'RUMC',  null, 6, 6),
  ('sc_sch_7', 'school', 'comilla university',           null, null, 'img/cu.png',    'CU',    null, 7, 7),

  -- subsidiaries ("our subsidiaries" / ventures)
  ('sc_sub_1', 'subsidiary', 'amaze research, innovation & exploration society', 'ARIES',
     'the research hub of amaze consortium exploring real-world data across bangladesh and beyond to uncover insights, identify gaps, and support practical, evidence-driven initiatives across multiple domains.',
     'img/ventures/aries.png', null, 'https://aries.amazeconsortium.org', 1, 1),
  ('sc_sub_2', 'subsidiary', 'amaze youth chess tournament', 'AYCT',
     'a nationwide chess tournament in bangladesh open to students, promoting merit-based competition, accessible participation, and long-term development of a strong youth chess community.',
     'img/ventures/ayct.png', null, 'https://ayct.amazeconsortium.org', 2, 2),
  ('sc_sub_3', 'subsidiary', 'first principles', 'First Principles',
     'the official newsletter of amaze consortium featuring articles, updates, insights, and reflections across its initiatives, while encouraging critical thinking, collaboration, and principled understanding of ideas and progress.',
     'img/ventures/fp.png', null, 'https://fp.amazeconsortium.org', 3, 3),
  ('sc_sub_4', 'subsidiary', 'the outliers club', 'The Outliers Club',
     'an invite-only community of bangladeshi youth focused on unconventional paths in entrepreneurship, innovation, and global education, built to foster collaboration, support, and alternative definitions of success beyond traditional career routes.',
     'img/ventures/toc.png', null, 'https://toc.amazeconsortium.org', 4, 4),
  ('sc_sub_5', 'subsidiary', 'havestack technologies', 'Havestack',
     'the software development and technology wing of amaze consortium, partnering with businesses on b2b engineering work — from custom software and internal tooling to full product builds.',
     'img/ventures/havestack.png', null, 'https://havestack.com', 5, 5),

  -- partners ("trusted by our partners")
  ('sc_par_1', 'partner', 'global youth opportunities', null, null, 'img/gyo.png',            'GYO',   'https://www.linkedin.com/company/youth-opportunities-global/', 1, 1),
  ('sc_par_2', 'partner', 'staty.dev',                  null, null, 'img/staty1.png',         'ST',    'https://staty.dev', 2, 2),
  ('sc_par_3', 'partner', 'youthverse union',           null, null, 'img/yvu.png',            'YVU',   'https://youthverseunion.org', 3, 3),
  ('sc_par_4', 'partner', 'simplespeek',                null, null, 'img/simplespeek.png',    'SP',    'https://simplespeek.ai', 4, 4),
  ('sc_par_5', 'partner', 'jnu math club',              null, null, 'img/jnumc.png',          'JNUMC', 'https://www.facebook.com/jnumc25/', 5, 5),
  ('sc_par_6', 'partner', 'bangla innovator',           null, null, 'img/banglainnovator.png','BI',    'https://banglainnovator.com/', 6, 6)
on conflict (id) do nothing;
