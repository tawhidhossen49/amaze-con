-- ════════════════════════════════════════════════
-- Amaze Consortium public website — backend schema
-- Supabase project: Amaze-con (muaxisgstxpoyfhzdgcm)
-- ════════════════════════════════════════════════
-- Everything the public site and its admin panel (/admin) need:
--   admins            who may edit the site
--   site_content      repeating lists (schools, subsidiaries, executives, advisors, partners)
--   site_text         per-field text / link / image overrides for every page
--   courses …         the learning platform (/courses)
--   storage: site-media   uploaded images
--
-- Access model, enforced by Row Level Security (never by the browser):
--   anyone            reads published website content and course outlines
--   signed-in learner reads lesson content, owns their enrolments and progress
--   admin             a signed-in, email-confirmed user whose email is in `admins`
--                     — may write everything
-- Safe to run more than once.

-- ─────────────────────────────
-- Admins
-- ─────────────────────────────
create table if not exists public.admins (
  email    text primary key,
  added_at timestamptz not null default now()
);
alter table public.admins enable row level security;

-- True when the caller is signed in with a CONFIRMED email listed in `admins`.
-- Reads auth.users directly (security definer) so it can't be fooled by
-- anything the client puts in its own token metadata.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join public.admins a on lower(a.email) = lower(u.email)
    where u.id = (select auth.uid())
      and u.email_confirmed_at is not null
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

drop policy if exists "admins manage admins" on public.admins;
create policy "admins manage admins" on public.admins
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ─────────────────────────────
-- site_content — repeating lists
-- ─────────────────────────────
create table if not exists public.site_content (
  id          text primary key default ('sc_' || replace(gen_random_uuid()::text, '-', '')),
  type        text not null,            -- 'school' | 'subsidiary' | 'executive' | 'advisor' | 'partner'
  name        text not null default '',
  subtitle    text,                     -- role, or short wordmark for a subsidiary
  description text,
  img         text,                     -- image URL or a path on the site (img/…)
  initials    text,                     -- shown if img is empty or fails
  url         text,
  sort_order  integer not null default 0,
  created_at  bigint not null default (extract(epoch from now()) * 1000)::bigint
);
create index if not exists idx_site_content_type_sort on public.site_content (type, sort_order, created_at);
alter table public.site_content enable row level security;

drop policy if exists "public read" on public.site_content;
create policy "public read" on public.site_content for select using (true);
drop policy if exists "admins write" on public.site_content;
create policy "admins write" on public.site_content
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ─────────────────────────────
-- site_text — one row per edited field. A page shows its built-in copy
-- unless a row exists here for that field's key (see js/site-fields.js).
-- ─────────────────────────────
create table if not exists public.site_text (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.site_text enable row level security;

drop policy if exists "public read" on public.site_text;
create policy "public read" on public.site_text for select using (true);
drop policy if exists "admins write" on public.site_text;
create policy "admins write" on public.site_text
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ─────────────────────────────
-- Courses
-- ─────────────────────────────
create table if not exists public.courses (
  id              text primary key,                 -- url slug, e.g. 'web-development-fundamentals'
  title           text not null default '',
  tagline         text,                             -- one line under the title
  description     text,                             -- longer overview
  category        text not null default 'general',
  level           text not null default 'beginner', -- 'beginner' | 'intermediate' | 'advanced' | 'all levels'
  duration        text,                             -- display text, e.g. '6 weeks'
  cover           text,                             -- image URL
  instructor_name text,
  instructor_role text,
  instructor_img  text,
  outcomes        jsonb not null default '[]'::jsonb, -- ["what you will be able to do", …]
  access          text not null default 'account',  -- 'open' = lessons readable by anyone | 'account' = free account required
  status          text not null default 'draft',    -- 'draft' | 'published'
  featured        boolean not null default false,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now()
);

create table if not exists public.course_modules (
  id         uuid primary key default gen_random_uuid(),
  course_id  text not null references public.courses(id) on delete cascade on update cascade,
  title      text not null default '',
  summary    text,
  sort_order integer not null default 0
);
create index if not exists idx_course_modules_course on public.course_modules (course_id, sort_order);

-- The outline (titles, types, lengths) is public for published courses.
create table if not exists public.course_lessons (
  id           uuid primary key default gen_random_uuid(),
  course_id    text not null references public.courses(id) on delete cascade on update cascade,
  module_id    uuid not null references public.course_modules(id) on delete cascade,
  title        text not null default '',
  kind         text not null default 'article',     -- 'video' | 'article' | 'quiz'
  duration_min integer not null default 5,
  is_preview   boolean not null default false,      -- readable without an account
  sort_order   integer not null default 0
);
create index if not exists idx_course_lessons_course on public.course_lessons (course_id, sort_order);
create index if not exists idx_course_lessons_module on public.course_lessons (module_id, sort_order);

-- The lesson itself lives in its own table so it can be gated separately
-- from the outline.
create table if not exists public.lesson_content (
  lesson_id uuid primary key references public.course_lessons(id) on delete cascade,
  video_url text,                                   -- YouTube / Vimeo link, or a direct .mp4
  body      text,                                   -- article text (simple markdown)
  quiz      jsonb                                   -- [{ "q": "...", "options": ["..."], "answer": 0, "why": "..." }]
);

create table if not exists public.enrollments (
  user_id       uuid not null references auth.users(id) on delete cascade,
  course_id     text not null references public.courses(id) on delete cascade on update cascade,
  learner_name  text,
  learner_email text,
  enrolled_at   timestamptz not null default now(),
  completed_at  timestamptz,
  primary key (user_id, course_id)
);
create index if not exists idx_enrollments_course on public.enrollments (course_id);

create table if not exists public.lesson_progress (
  user_id      uuid not null references auth.users(id) on delete cascade,
  lesson_id    uuid not null references public.course_lessons(id) on delete cascade,
  course_id    text not null references public.courses(id) on delete cascade on update cascade,
  quiz_score   integer,                             -- percent, quizzes only
  completed_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);
create index if not exists idx_lesson_progress_course on public.lesson_progress (course_id);
create index if not exists idx_lesson_progress_lesson on public.lesson_progress (lesson_id);

alter table public.courses         enable row level security;
alter table public.course_modules  enable row level security;
alter table public.course_lessons  enable row level security;
alter table public.lesson_content  enable row level security;
alter table public.enrollments     enable row level security;
alter table public.lesson_progress enable row level security;

drop policy if exists "read published" on public.courses;
create policy "read published" on public.courses
  for select using (status = 'published' or (select public.is_admin()));
drop policy if exists "admins write" on public.courses;
create policy "admins write" on public.courses
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "read published" on public.course_modules;
create policy "read published" on public.course_modules
  for select using (
    (select public.is_admin())
    or exists (select 1 from public.courses c where c.id = course_modules.course_id and c.status = 'published')
  );
drop policy if exists "admins write" on public.course_modules;
create policy "admins write" on public.course_modules
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "read published" on public.course_lessons;
create policy "read published" on public.course_lessons
  for select using (
    (select public.is_admin())
    or exists (select 1 from public.courses c where c.id = course_lessons.course_id and c.status = 'published')
  );
drop policy if exists "admins write" on public.course_lessons;
create policy "admins write" on public.course_lessons
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Lesson content: previews and open courses for anyone, everything else
-- for any signed-in learner.
drop policy if exists "read lesson content" on public.lesson_content;
create policy "read lesson content" on public.lesson_content
  for select using (
    (select public.is_admin())
    or exists (
      select 1
      from public.course_lessons l
      join public.courses c on c.id = l.course_id
      where l.id = lesson_content.lesson_id
        and c.status = 'published'
        and (l.is_preview or c.access = 'open' or (select auth.uid()) is not null)
    )
  );
drop policy if exists "admins write" on public.lesson_content;
create policy "admins write" on public.lesson_content
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "own or admin read" on public.enrollments;
create policy "own or admin read" on public.enrollments
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "enrol self" on public.enrollments;
create policy "enrol self" on public.enrollments
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "update own" on public.enrollments;
create policy "update own" on public.enrollments
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "leave or admin remove" on public.enrollments;
create policy "leave or admin remove" on public.enrollments
  for delete to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "own or admin read" on public.lesson_progress;
create policy "own or admin read" on public.lesson_progress
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "record own" on public.lesson_progress;
create policy "record own" on public.lesson_progress
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "update own" on public.lesson_progress;
create policy "update own" on public.lesson_progress
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "clear own" on public.lesson_progress;
create policy "clear own" on public.lesson_progress
  for delete to authenticated using (user_id = (select auth.uid()));

-- ─────────────────────────────
-- API access (RLS above decides what each role actually sees)
-- ─────────────────────────────
grant usage on schema public to anon, authenticated;
grant select on public.site_content, public.site_text, public.courses, public.course_modules,
                public.course_lessons, public.lesson_content to anon;
grant select, insert, update, delete on public.admins, public.site_content, public.site_text, public.courses,
                public.course_modules, public.course_lessons, public.lesson_content,
                public.enrollments, public.lesson_progress to authenticated;

-- ─────────────────────────────
-- Image uploads
-- ─────────────────────────────
insert into storage.buckets (id, name, public) values ('site-media', 'site-media', true)
on conflict (id) do nothing;

drop policy if exists "site-media admins upload" on storage.objects;
create policy "site-media admins upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'site-media' and (select public.is_admin()));
drop policy if exists "site-media admins update" on storage.objects;
create policy "site-media admins update" on storage.objects
  for update to authenticated using (bucket_id = 'site-media' and (select public.is_admin()));
drop policy if exists "site-media admins delete" on storage.objects;
create policy "site-media admins delete" on storage.objects
  for delete to authenticated using (bucket_id = 'site-media' and (select public.is_admin()));

-- ════════════════════════════════════════════════
-- SEED — existing public content + three starter courses
-- Every insert is "on conflict do nothing": re-running this file never
-- overwrites anything edited from the admin panel.
-- ════════════════════════════════════════════════

-- The lists the site was already showing (copied from the members-portal project).
insert into public.site_content (id, type, name, subtitle, description, img, initials, url, sort_order, created_at) values
  ('sc_adv_1', 'advisor', 's m ehsan habib shumon', 'founder of sarangsho', null, 'img/advisoreh.jpg', 'EH', 'https://www.linkedin.com/in/ehsanhabibshumon/', 1, 1),
  ('sc_adv_2', 'advisor', 'md abdur rahman', 'founder of bondi pathshala', null, 'img/advisorar.jpg', 'AR', 'https://www.linkedin.com/in/md-abdur-rahman-9090ba358/', 2, 2),
  ('sc_exec_1', 'executive', 'farhan s zihan', 'vice-president', null, 'img/zihan.jpg', 'FZ', null, 1, 1),
  ('sc_exec_2', 'executive', 'nazmus salehin', 'co-ordinator', null, 'img/salehin.jpeg', 'NS', null, 2, 2),
  ('sc_exec_3', 'executive', 'asif chowdhury', 'data manager', null, 'img/asif.jpg', 'AC', null, 3, 3),
  ('sc_exec_4', 'executive', 'maliha mehzabien', 'creative media officer', null, 'img/maliha.jpg', 'MM', null, 4, 4),
  ('sc_exec_5', 'executive', 'taha nibras', 'human resources manager', null, 'img/taha.jpg', 'TN', null, 5, 5),
  ('sc_exec_6', 'executive', 'eftiyak arfin', 'marketing manager', null, 'img/eftiyak.jpg', 'EA', null, 6, 6),
  ('sc_exec_7', 'executive', 'tawhid hossen', 'technology manager', null, 'img/tawhid.jpg', 'TH', null, 7, 7),
  ('sc_par_2', 'partner', 'staty.dev', null, null, 'img/staty1.png', 'ST', 'https://staty.dev', 2, 2),
  ('sc_par_3', 'partner', 'youthverse union', null, null, 'img/yvu.png', 'YVU', 'https://youthverseunion.org', 3, 3),
  ('sc_par_4', 'partner', 'simplespeek', null, null, 'img/simplespeek.png', 'SP', 'https://simplespeek.ai', 4, 4),
  ('sc_par_5', 'partner', 'jnu math club', null, null, 'img/jnumc.png', 'JNUMC', 'https://www.facebook.com/jnumc25/', 5, 5),
  ('sc_par_6', 'partner', 'bangla innovator', null, null, 'img/banglainnovator.png', 'BI', 'https://banglainnovator.com/', 6, 6),
  ('sc_sch_1', 'school', 'adamjee cantonment college', null, null, 'img/acc.png', 'ACC', null, 1, 1),
  ('sc_sch_2', 'school', 'baf shaheen college dhaka', null, null, 'img/bafsd.png', 'BAFSD', null, 2, 2),
  ('sc_sch_3', 'school', 'government science college', null, null, 'img/gsc.png', 'GSC', null, 3, 3),
  ('sc_sch_4', 'school', 'dhaka college', null, null, 'img/dc.png', 'DC', null, 4, 4),
  ('sc_sch_5', 'school', 'dhaka university', null, null, 'img/du.png', 'DU', null, 5, 5),
  ('sc_sch_6', 'school', 'rajuk uttara model college', null, null, 'img/rumc.png', 'RUMC', null, 6, 6),
  ('sc_sch_7', 'school', 'comilla university', null, null, 'img/cu.png', 'CU', null, 7, 7),
  ('sc_sub_1', 'subsidiary', 'amaze research, innovation & exploration society', 'ARIES', 'the research hub of amaze consortium exploring real-world data across bangladesh and beyond to uncover insights, identify gaps, and support practical, evidence-driven initiatives across multiple domains.', 'img/ventures/aries.png', null, 'https://aries.amazeconsortium.org', 1, 1),
  ('sc_sub_2', 'subsidiary', 'amaze youth chess tournament', 'AYCT', 'a nationwide chess tournament in bangladesh open to students, promoting merit-based competition, accessible participation, and long-term development of a strong youth chess community.', 'img/ventures/ayct.png', null, 'https://ayct.amazeconsortium.org', 2, 2),
  ('sc_sub_3', 'subsidiary', 'first principles', 'First Principles', 'the official newsletter of amaze consortium featuring articles, updates, insights, and reflections across its initiatives, while encouraging critical thinking, collaboration, and principled understanding of ideas and progress.', 'img/ventures/fp.png', null, 'https://fp.amazeconsortium.org', 3, 3),
  ('sc_sub_4', 'subsidiary', 'the outliers club', 'The Outliers Club', 'an invite-only community of bangladeshi youth focused on unconventional paths in entrepreneurship, innovation, and global education, built to foster collaboration, support, and alternative definitions of success beyond traditional career routes.', 'img/ventures/toc.png', null, 'https://toc.amazeconsortium.org', 4, 4),
  ('sc_sub_5', 'subsidiary', 'havestack technologies', 'Havestack', 'the software development and technology wing of amaze consortium, partnering with businesses on b2b engineering work — from custom software and internal tooling to full product builds.', 'img/ventures/havestack.png', null, 'https://havestack.com', 5, 5)
on conflict (id) do nothing;

-- Starter courses — written as real, usable lessons, but meant to be replaced
-- or extended from the admin panel.
insert into public.courses (id, title, tagline, description, category, level, duration, instructor_name, instructor_role, outcomes, access, status, featured, sort_order) values
  ('web-development-fundamentals', 'web development fundamentals', 'html and css from a blank file to a page you can put online.', 'a first course in building for the web. you will learn how a browser turns files into a page, write semantic html, and style and lay it out with css — the way working front-end developers actually do it.', 'web development', 'beginner', '6 weeks', 'amaze web team', 'havestack technologies', '["explain what happens between typing a url and seeing a page", "write clean, semantic html for a real page", "style and lay out a page with modern css", "read and debug a page with browser developer tools"]'::jsonb, 'account', 'published', true, 1),
  ('writing-research-proposals', 'writing research proposals', 'structure, argue and format a proposal that gets read to the end.', 'a short, practical course from the research desk. you will learn what a reviewer is actually looking for, how to turn an interest into an answerable question, and how to lay out a proposal so the argument is impossible to miss.', 'research', 'beginner', '2 weeks', 'research desk', 'amaze research, innovation & exploration society', '["state a research question that can actually be answered", "structure a proposal a reviewer can follow in one read", "justify a method, a timeline and a budget"]'::jsonb, 'open', 'published', false, 2),
  ('public-speaking-and-communication', 'public speaking & communication', 'structure a talk, hold a room, and stay clear under pressure.', 'a practical course for anyone who has to present — in class, at an event, or to a room of strangers. it covers how to build a talk around one idea, how to open and close, and how to manage your voice and your nerves.', 'leadership', 'beginner', '3 weeks', 'amaze consortium', 'the amaze academy', '["build any talk around a single clear idea", "open and close in a way people remember", "control pace, pauses and nerves while speaking"]'::jsonb, 'account', 'published', false, 3)
on conflict (id) do nothing;

insert into public.course_modules (id, course_id, title, summary, sort_order) values
  ('a2bcb8b2-8e34-566b-b4e2-efe10e128a34', 'web-development-fundamentals', 'how the web works', 'the mental model everything else sits on.', 1),
  ('2b7838bd-7db3-5395-869a-5756a274d39b', 'web-development-fundamentals', 'writing html', 'structure a page so people and machines can both read it.', 2),
  ('c4aab0b6-0577-58b7-8b20-b7cff1bb4b9b', 'web-development-fundamentals', 'styling with css', 'make it look intentional.', 3),
  ('1b4f74a6-8c0c-539b-bc32-ed851128bbfb', 'writing-research-proposals', 'the argument', 'what a proposal has to prove.', 1),
  ('fab4da8e-0481-569b-a224-1cbb39ed1c17', 'writing-research-proposals', 'the document', 'lay it out so the argument is obvious.', 2),
  ('b72821e7-40f2-5f24-a830-3886b99de30c', 'public-speaking-and-communication', 'building the talk', 'what to say, and in what order.', 1),
  ('4d4f17a7-1d42-5c24-a561-6ff29461a18d', 'public-speaking-and-communication', 'delivering it', 'voice, pace and pressure.', 2)
on conflict (id) do nothing;

insert into public.course_lessons (id, course_id, module_id, title, kind, duration_min, is_preview, sort_order) values
  ('67cdfc17-dcaf-533f-9c79-01ab60c0f95b', 'web-development-fundamentals', 'a2bcb8b2-8e34-566b-b4e2-efe10e128a34', 'what happens when you open a page', 'article', 6, true, 1),
  ('7e4051d1-a9eb-5965-8c62-ba3c52a4260f', 'web-development-fundamentals', 'a2bcb8b2-8e34-566b-b4e2-efe10e128a34', 'your tools: an editor and a browser', 'article', 5, false, 2),
  ('2141d1c8-8fd9-5f5b-8fa6-639482a7a073', 'web-development-fundamentals', 'a2bcb8b2-8e34-566b-b4e2-efe10e128a34', 'check: how the web works', 'quiz', 4, false, 3),
  ('0117ded5-9da1-5760-a604-96db1cbb3a8e', 'web-development-fundamentals', '2b7838bd-7db3-5395-869a-5756a274d39b', 'the skeleton of a page', 'article', 7, false, 4),
  ('a22f4e9a-d52d-58fd-93d0-82e838473616', 'web-development-fundamentals', '2b7838bd-7db3-5395-869a-5756a274d39b', 'choosing the right element', 'article', 8, false, 5),
  ('60d0f8a0-ad3d-5a3a-810e-b66ba78c8eea', 'web-development-fundamentals', 'c4aab0b6-0577-58b7-8b20-b7cff1bb4b9b', 'selectors and the box model', 'article', 8, false, 6),
  ('c562e7f6-52b7-5323-b701-9823ccd935a5', 'web-development-fundamentals', 'c4aab0b6-0577-58b7-8b20-b7cff1bb4b9b', 'layout with flexbox', 'article', 9, false, 7),
  ('7a6c2676-8df9-525b-be69-b34d0fa5c690', 'web-development-fundamentals', 'c4aab0b6-0577-58b7-8b20-b7cff1bb4b9b', 'check: html and css', 'quiz', 5, false, 8),
  ('d2365ae9-4648-5c56-9a0e-d7ba14ba2b86', 'writing-research-proposals', '1b4f74a6-8c0c-539b-bc32-ed851128bbfb', 'what a reviewer is looking for', 'article', 6, true, 1),
  ('c85f28fa-4bfc-5482-8ac6-4f46647317c6', 'writing-research-proposals', '1b4f74a6-8c0c-539b-bc32-ed851128bbfb', 'from an interest to a question', 'article', 7, false, 2),
  ('384fc9ad-64af-5e23-9e70-c1bbac65bc2d', 'writing-research-proposals', 'fab4da8e-0481-569b-a224-1cbb39ed1c17', 'the standard structure', 'article', 6, false, 3),
  ('43cf18f6-7e79-54fb-ab31-9fa1d333f9f9', 'writing-research-proposals', 'fab4da8e-0481-569b-a224-1cbb39ed1c17', 'method, timeline and budget', 'article', 7, false, 4),
  ('92dc6a08-0cb8-5884-8ca5-67bb7d192977', 'writing-research-proposals', 'fab4da8e-0481-569b-a224-1cbb39ed1c17', 'check: proposals', 'quiz', 4, false, 5),
  ('c5d52683-e712-5d2f-851e-51f71281b9d5', 'public-speaking-and-communication', 'b72821e7-40f2-5f24-a830-3886b99de30c', 'one talk, one idea', 'article', 6, true, 1),
  ('2b9f5977-c9b6-58e8-95db-9a81ec7b9dd8', 'public-speaking-and-communication', 'b72821e7-40f2-5f24-a830-3886b99de30c', 'how to open and how to close', 'article', 6, false, 2),
  ('fbb5dd56-63af-5b26-98a4-175ee788bca8', 'public-speaking-and-communication', '4d4f17a7-1d42-5c24-a561-6ff29461a18d', 'pace, pauses and voice', 'article', 6, false, 3),
  ('874b6172-6686-5199-b009-9a2b4137530e', 'public-speaking-and-communication', '4d4f17a7-1d42-5c24-a561-6ff29461a18d', 'nerves and difficult questions', 'article', 6, false, 4),
  ('093accef-b4a3-501d-8d11-58055f36ccbb', 'public-speaking-and-communication', '4d4f17a7-1d42-5c24-a561-6ff29461a18d', 'check: speaking', 'quiz', 4, false, 5)
on conflict (id) do nothing;

insert into public.lesson_content (lesson_id, body, quiz) values
  ('67cdfc17-dcaf-533f-9c79-01ab60c0f95b', '## one request, one response

when you type an address and press enter, your browser does three things. it looks up which computer owns that name, it asks that computer for a file, and it turns the file it gets back into what you see.

the file is almost always **html**. html describes what is on the page: a heading, a paragraph, an image. it does not say how any of it should look.

as the browser reads the html it finds references to other files — stylesheets, scripts, images — and requests each of those too.

## the three languages

- **html** is the content and its structure
- **css** is how that content looks and where it sits
- **javascript** is what the page does when you interact with it

this course covers the first two. learn them in that order: a page with good html and no css still works. a page with beautiful css and bad html does not.', null),
  ('7e4051d1-a9eb-5965-8c62-ba3c52a4260f', 'you need exactly two programs.

## a code editor

install **visual studio code**. it is free and it is what most of the industry uses. create a folder for this course, open it in the editor, and make a file called `index.html`.

## a browser with developer tools

every modern browser ships with developer tools. open any page, right-click something, and choose **inspect**. you will see the html on the left and the css that applies to the selected element on the right.

get into the habit now: when something looks wrong, inspect it before you guess. the tools show you what the browser actually did, which is often not what you think you told it to do.

## your first page

```
<h1>hello</h1>
<p>this is my first page.</p>
```

save the file and open it in your browser. that is a web page.', null),
  ('2141d1c8-8fd9-5f5b-8fa6-639482a7a073', null, '[{"q": "which language describes what is on a page, without saying how it looks?", "options": ["css", "html", "javascript", "http"], "answer": 1, "why": "html is content and structure. css handles appearance."}, {"q": "something on your page looks wrong. what should you do first?", "options": ["rewrite the css from scratch", "inspect the element in developer tools", "clear the browser cache", "add more javascript"], "answer": 1, "why": "the developer tools show what the browser actually applied, so you fix the real cause."}, {"q": "a page has well-written html but its stylesheet fails to load. what happens?", "options": ["nothing is shown", "the browser shows an error page", "the content still appears, unstyled", "the page reloads forever"], "answer": 2, "why": "html works on its own. that is why it comes first."}]'::jsonb),
  ('0117ded5-9da1-5760-a604-96db1cbb3a8e', 'every html document has the same outer shape.

```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>my page</title>
  </head>
  <body>
    <h1>my page</h1>
  </body>
</html>
```

- `<!doctype html>` tells the browser to use modern rules
- `<head>` holds information **about** the page: its title, its language, its stylesheets
- `<body>` holds everything a visitor sees

## elements and attributes

an **element** is an opening tag, some content, and a closing tag: `<p>hello</p>`. an **attribute** adds detail inside the opening tag: `lang="en"`.

indent nested elements. the browser does not care, but the next person to read your file — usually you, in a month — will.', null),
  ('a22f4e9a-d52d-58fd-93d0-82e838473616', 'html has an element for most kinds of content. using the right one is called writing **semantic** html.

## why it matters

screen readers, search engines and browsers all read your tags to understand the page. a `<button>` can be focused and pressed with a keyboard. a `<div>` that only looks like a button cannot.

## the ones you will use every day

- `<h1>` to `<h6>` for headings, in order, with one `<h1>` per page
- `<p>` for paragraphs
- `<a href="...">` for links
- `<img src="..." alt="...">` for images, always with `alt` text
- `<ul>` and `<ol>` with `<li>` for lists
- `<header>`, `<nav>`, `<main>`, `<section>`, `<footer>` for the regions of a page

a good test: read your html with the styles turned off. if the page still makes sense top to bottom, the structure is right.', null),
  ('60d0f8a0-ad3d-5a3a-810e-b66ba78c8eea', 'a css rule has two parts: a **selector** that picks elements, and **declarations** that style them.

```
p {
  color: #333;
  line-height: 1.6;
}
```

## three selectors cover most of your work

- `p` selects every paragraph
- `.card` selects every element with `class="card"`
- `.card p` selects paragraphs inside a card

prefer classes. they are reusable and they do not break when the html changes.

## every element is a box

from the inside out: **content**, **padding**, **border**, **margin**. padding is space inside the border. margin is space outside it.

add this to the top of every stylesheet you write:

```
* { box-sizing: border-box; }
```

it makes `width` include padding and border, which is how almost everyone expects it to work.', null),
  ('c562e7f6-52b7-5323-b701-9823ccd935a5', 'flexbox lays out items in one direction — a row or a column — and decides how they share the space.

```
.row {
  display: flex;
  gap: 16px;
  justify-content: space-between;
  align-items: center;
}
```

- `display: flex` goes on the **parent**
- `gap` sets the space between children
- `justify-content` positions them along the main direction
- `align-items` positions them across it

## the pattern you will use most

a navigation bar: logo on the left, links on the right, everything vertically centred. that is the four lines above.

when a layout needs rows **and** columns at once, reach for css grid instead. for a single line of things, flexbox is the right tool.', null),
  ('7a6c2676-8df9-525b-be69-b34d0fa5c690', null, '[{"q": "where does `display: flex` go?", "options": ["on each child", "on the parent", "on the body only", "in the html head"], "answer": 1, "why": "flex is set on the container; its direct children become flex items."}, {"q": "which is the best choice for something a visitor clicks to submit a form?", "options": ["<div>", "<span>", "<button>", "<a>"], "answer": 2, "why": "a button is focusable and keyboard-operable by default."}, {"q": "padding is the space…", "options": ["outside the border", "inside the border", "between two elements", "around the whole page"], "answer": 1, "why": "padding sits between the content and the border; margin sits outside."}]'::jsonb),
  ('d2365ae9-4648-5c56-9a0e-d7ba14ba2b86', 'a proposal is not a description of a topic. it is an argument that a specific piece of work is worth doing and that you can do it.

a reviewer reads with four questions in mind.

- **what is the problem?** and who says it is a problem
- **what do we not yet know?** the gap your work fills
- **what exactly will you do?** concretely, step by step
- **why you, and why now?** your access, your skills, your timing

if any one of these is unclear, the proposal fails, however good the idea.

## write the one-paragraph version first

before any formatting, answer the four questions in four sentences. if you cannot, you are not ready to write the long version. if you can, the long version is mostly evidence for those four sentences.', null),
  ('c85f28fa-4bfc-5482-8ac6-4f46647317c6', '"i am interested in youth unemployment" is an interest. it is not a question.

## narrow it three times

- **who?** recent graduates of public universities
- **where and when?** in dhaka, in the last three years
- **what about them?** how long they take to find a first job, and what predicts it

now you have: *what predicts the time to first employment among recent public-university graduates in dhaka?*

## test the question

- can it be answered with data you can actually get?
- would the answer change what someone does?
- can it be answered in the time you have?

a smaller question answered well is worth more than a large one answered vaguely. reviewers know this.', null),
  ('384fc9ad-64af-5e23-9e70-c1bbac65bc2d', 'most funders and institutions expect roughly the same sections, in this order.

- **title and summary** — the four-sentence version
- **background** — what is known, and the gap
- **research question and objectives**
- **method** — data, sample, analysis
- **timeline**
- **budget**
- **expected outcomes** — who will use the result

## rules that make it readable

put the question on the first page. reviewers should not have to hunt for it.

one idea per paragraph, and make the first sentence carry it. a reviewer who reads only first sentences should still follow the argument.

cite the gap. "little is known about…" needs a reference showing you looked.', null),
  ('43cf18f6-7e79-54fb-ab31-9fa1d333f9f9', 'these three sections are where a reviewer decides whether you can deliver.

## method

say what data you will collect, from whom, how many, and how you will analyse it. name the limits honestly. a method that admits its weaknesses is more convincing than one that claims none.

## timeline

break the work into phases with dates. include time for things that always take longer than planned: permissions, recruitment, cleaning data.

## budget

every line should trace back to a step in the method. if the method says 200 survey responses, the budget should show what 200 responses cost.

a budget that is obviously padded costs you trust. so does one that is obviously too small to do the work.', null),
  ('92dc6a08-0cb8-5884-8ca5-67bb7d192977', null, '[{"q": "which of these is a research question rather than an interest?", "options": ["youth unemployment in bangladesh", "the future of education", "what predicts time to first job among recent graduates in dhaka?", "problems facing students"], "answer": 2, "why": "it names who, where, and what is being measured."}, {"q": "where should the research question appear?", "options": ["in the appendix", "on the first page", "after the budget", "only in the title"], "answer": 1, "why": "a reviewer should never have to search for it."}, {"q": "every budget line should trace back to…", "options": ["the background section", "a step in the method", "the summary", "the references"], "answer": 1, "why": "the budget is the cost of doing what the method describes."}]'::jsonb),
  ('c5d52683-e712-5d2f-851e-51f71281b9d5', 'most weak talks have the same problem: too many points. the audience leaves remembering none of them.

## the one-sentence test

before you make a single slide, finish this sentence: *after this talk, the audience will believe that…*

if you need the word "and", you have two talks. pick one.

## build everything around it

- three supporting points, at most
- one story or example for each
- cut anything that does not serve the sentence, however interesting it is

this feels like throwing away good material. it is. that is what makes the rest land.

## structure

say what you will argue, argue it, then say what you argued. it feels repetitive to write. it feels clear to hear, because listeners cannot scroll back.', null),
  ('2b9f5977-c9b6-58e8-95db-9a81ec7b9dd8', 'people decide in the first thirty seconds whether to keep listening, and they remember the last thirty longest. spend your preparation time accordingly.

## openings that work

- a specific story: "last march, three of us were standing outside a locked hall…"
- a surprising fact
- a question the audience genuinely wants answered

## openings that do not

thanking the organisers, apologising for being nervous, reading your own title aloud.

## closing

end on your one sentence, said plainly. then stop. do not trail off into "so, yeah, that is it".

memorise your first two lines and your last line word for word. everything in between can be looser, but those must be automatic.', null),
  ('fbb5dd56-63af-5b26-98a4-175ee788bca8', 'nervous speakers speed up. the fix is not to "slow down" in general — it is to pause in specific places.

## where to pause

- after your opening line
- before and after your main point
- after a question, long enough that it feels slightly uncomfortable

a two-second pause feels endless to you and natural to the room.

## voice

speak to the back row, not the front. drop your pitch at the end of a statement; rising pitch makes a claim sound like a question.

## practise out loud

reading a talk silently is not rehearsal. say it aloud, standing, at least three times. record one run and listen to it once. you will hear your filler words immediately, and hearing them is most of the cure.', null),
  ('874b6172-6686-5199-b009-9a2b4137530e', 'nerves do not go away with experience. experienced speakers have simply learned what to do with them.

## before you speak

arrive early and stand where you will stand. breathe out for longer than you breathe in, a few times. know your first two lines so well that you could say them half asleep — the first thirty seconds carry you past the worst of it.

## when a question is hard

- repeat it back. this buys time and makes sure you understood
- if you do not know, say so, and say how you would find out
- if it is hostile, answer the content and ignore the tone

"i do not know, but here is what i would check" is a strong answer. bluffing is not, and audiences can tell.', null),
  ('093accef-b4a3-501d-8d11-58055f36ccbb', null, '[{"q": "you have five strong points for a ten-minute talk. what should you do?", "options": ["speak faster to fit them all", "cut to the three that best support one idea", "put all five on one slide", "skip the introduction"], "answer": 1, "why": "fewer points, properly supported, is what an audience remembers."}, {"q": "which parts of a talk should you memorise word for word?", "options": ["the whole talk", "only the statistics", "the first two lines and the last line", "nothing"], "answer": 2, "why": "the opening carries you through the worst nerves and the close is what people remember."}, {"q": "you are asked a question you cannot answer. the best response is to…", "options": ["change the subject", "guess confidently", "say you do not know and how you would find out", "ask them to email you and move on quickly"], "answer": 2, "why": "honesty with a next step keeps your credibility."}]'::jsonb)
on conflict (lesson_id) do nothing;
