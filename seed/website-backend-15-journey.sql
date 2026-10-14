-- ═══════════════════════════════════════════════════════════════════════════
--  our journey — the milestones on the "our journey" page
--
--  Run once in supabase → sql editor. Safe to run again.
--
--  One row per milestone. The page draws its timeline from these rows, so a new
--  partnership is one new row: the year, what happened, and what kind of step it
--  was. A row without a year is a draft: it waits in the admin panel and is not
--  shown on the website until it gets one.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.journey (
  id         uuid primary key default gen_random_uuid(),
  year       integer check (year is null or year between 1990 and 2100),
  month      integer check (month is null or month between 1 and 12),
  title      text not null check (char_length(btrim(title)) between 2 and 90),
  body       text check (body is null or char_length(body) <= 400),
  kind       text not null default 'milestone' check (kind in ('milestone', 'partnership', 'subsidiary', 'program', 'recognition', 'launch')),
  link       text check (link is null or link ~* '^https?://'),
  hidden     boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists journey_order on public.journey (year, month, sort_order);
alter table public.journey enable row level security;

-- visitors see what is on the page; admins also see drafts and hidden ones. (two rules, because
-- visitors may not run admin_can — one combined rule would refuse every visitor.)
drop policy if exists "public reads the journey" on public.journey;
create policy "public reads the journey" on public.journey for select to anon, authenticated
  using (not hidden and year is not null);
drop policy if exists "admins read the whole journey" on public.journey;
create policy "admins read the whole journey" on public.journey for select to authenticated
  using ((select public.admin_can('lists')));
drop policy if exists "admins write the journey" on public.journey;
create policy "admins write the journey" on public.journey for all to authenticated
  using ((select public.admin_can('lists'))) with check ((select public.admin_can('lists')));
grant select on public.journey to anon, authenticated;
grant insert, update, delete on public.journey to authenticated;

-- the first rows: the founding (on the website since day one), and everything already
-- listed on the home page, waiting for the year it happened
insert into public.journey (year, title, body, kind)
select 2020, 'amaze consortium is founded', 'a student-led non-profit, built to develop people and channel them into independent subsidiaries.', 'milestone'
where not exists (select 1 from public.journey);

insert into public.journey (year, title, body, kind, sort_order)
select null, x.title, x.body, x.kind, x.n
from (values
  (1, 'amaze research, innovation & exploration society (aries) begins', 'the research wing: real-world data across bangladesh.', 'subsidiary'),
  (2, 'the first amaze youth chess tournament', 'a nationwide tournament open to students.', 'subsidiary'),
  (3, 'first principles, the newsletter, is published', 'articles, updates and reflections from across the consortium.', 'launch'),
  (4, 'the outliers club opens', 'an invite-only community for unconventional paths.', 'subsidiary'),
  (5, 'havestack technologies starts', 'the software and technology wing.', 'subsidiary'),
  (6, 'partnership with staty.dev', null, 'partnership'),
  (7, 'partnership with youthverse union', null, 'partnership'),
  (8, 'partnership with simplespeek', null, 'partnership'),
  (9, 'partnership with jnu math club', null, 'partnership'),
  (10, 'partnership with bangla innovator', null, 'partnership'),
  (11, 'the amaze academy opens online', 'courses, programs and live webinars, taught by the people running our subsidiaries.', 'launch')
) as x(n, title, body, kind)
where (select count(*) from public.journey) = 1;
