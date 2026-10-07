-- ════════════════════════════════════════════════
-- Amaze Consortium public website — backend, part 2
-- Run AFTER seed/website-backend.sql (Supabase → SQL editor → paste → Run).
-- Safe to run more than once.
-- ════════════════════════════════════════════════
-- Adds:
--   show / hide for list items, course modules and lessons
--   richer courses (trailer, requirements, audience, skills, language, locked order)
--   lesson attachments and Google Form lessons
--   learner notes, lesson Q&A, course reviews, course announcements
--   certificates issued and verified by the database
--   public course numbers (learners, rating) for the catalogue

-- ── show / hide ──────────────────────────────────────────────────────────────
alter table public.site_content   add column if not exists hidden    boolean not null default false;
alter table public.course_modules add column if not exists is_hidden boolean not null default false;
alter table public.course_lessons add column if not exists is_hidden boolean not null default false;

-- ── richer courses ───────────────────────────────────────────────────────────
alter table public.courses add column if not exists trailer_url  text;                              -- intro video on the course page
alter table public.courses add column if not exists requirements jsonb not null default '[]'::jsonb; -- ["what you need before starting", …]
alter table public.courses add column if not exists audience     jsonb not null default '[]'::jsonb; -- ["who this is for", …]
alter table public.courses add column if not exists tags         jsonb not null default '[]'::jsonb; -- skills gained
alter table public.courses add column if not exists language     text not null default 'english';
alter table public.courses add column if not exists sequential   boolean not null default false;    -- true = lessons unlock in order
alter table public.courses add column if not exists updated_at   timestamptz not null default now();
alter table public.courses add column if not exists includes     jsonb not null default '[]'::jsonb; -- [{ "label": "...", "value": "..." }] — replaces the automatic "this course includes" list

alter table public.lesson_content add column if not exists form_url  text;                              -- Google Form (or any embeddable form) for 'form' lessons
alter table public.lesson_content add column if not exists resources jsonb not null default '[]'::jsonb; -- [{ "label": "...", "url": "..." }]

-- ── policies that respect hidden rows ────────────────────────────────────────
drop policy if exists "public read" on public.site_content;
create policy "public read" on public.site_content
  for select using (not hidden or (select public.is_admin()));

drop policy if exists "read published" on public.course_modules;
create policy "read published" on public.course_modules
  for select using (
    (select public.is_admin())
    or (not is_hidden and exists (select 1 from public.courses c where c.id = course_modules.course_id and c.status = 'published'))
  );

drop policy if exists "read published" on public.course_lessons;
create policy "read published" on public.course_lessons
  for select using (
    (select public.is_admin())
    or (not is_hidden
        and exists (select 1 from public.courses c where c.id = course_lessons.course_id and c.status = 'published')
        and exists (select 1 from public.course_modules m where m.id = course_lessons.module_id and not m.is_hidden))
  );

drop policy if exists "read lesson content" on public.lesson_content;
create policy "read lesson content" on public.lesson_content
  for select using (
    (select public.is_admin())
    or exists (
      select 1
      from public.course_lessons l
      join public.courses c on c.id = l.course_id
      join public.course_modules m on m.id = l.module_id
      where l.id = lesson_content.lesson_id
        and c.status = 'published' and not l.is_hidden and not m.is_hidden
        and (l.is_preview or c.access = 'open' or (select auth.uid()) is not null)
    )
  );

-- ── personal notes ───────────────────────────────────────────────────────────
create table if not exists public.lesson_notes (
  user_id    uuid not null references auth.users(id) on delete cascade,
  lesson_id  uuid not null references public.course_lessons(id) on delete cascade,
  course_id  text not null references public.courses(id) on delete cascade on update cascade,
  body       text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);
create index if not exists idx_lesson_notes_lesson on public.lesson_notes (lesson_id);
create index if not exists idx_lesson_notes_course on public.lesson_notes (course_id);
alter table public.lesson_notes enable row level security;
drop policy if exists "own notes" on public.lesson_notes;
create policy "own notes" on public.lesson_notes
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ── questions & answers ──────────────────────────────────────────────────────
create table if not exists public.lesson_comments (
  id          uuid primary key default gen_random_uuid(),
  course_id   text not null references public.courses(id) on delete cascade on update cascade,
  lesson_id   uuid not null references public.course_lessons(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  parent_id   uuid references public.lesson_comments(id) on delete cascade,  -- null = a question, set = a reply
  author_name text not null default 'learner',
  is_staff    boolean not null default false,                                -- shown as "instructor"; can only be true for admins
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_lesson_comments_lesson on public.lesson_comments (lesson_id, created_at);
create index if not exists idx_lesson_comments_course on public.lesson_comments (course_id);
create index if not exists idx_lesson_comments_user   on public.lesson_comments (user_id);
create index if not exists idx_lesson_comments_parent on public.lesson_comments (parent_id);
alter table public.lesson_comments enable row level security;
drop policy if exists "signed-in read" on public.lesson_comments;
create policy "signed-in read" on public.lesson_comments
  for select to authenticated using (true);
drop policy if exists "post as self" on public.lesson_comments;
create policy "post as self" on public.lesson_comments
  for insert to authenticated
  with check (user_id = (select auth.uid()) and is_staff = (select public.is_admin()) and char_length(body) between 1 and 4000);
drop policy if exists "delete own or admin" on public.lesson_comments;
create policy "delete own or admin" on public.lesson_comments
  for delete to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

-- ── reviews ──────────────────────────────────────────────────────────────────
create table if not exists public.course_reviews (
  user_id     uuid not null references auth.users(id) on delete cascade,
  course_id   text not null references public.courses(id) on delete cascade on update cascade,
  rating      integer not null check (rating between 1 and 5),
  body        text,
  author_name text not null default 'learner',
  is_hidden   boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (user_id, course_id)
);
create index if not exists idx_course_reviews_course on public.course_reviews (course_id);
alter table public.course_reviews enable row level security;
drop policy if exists "read visible" on public.course_reviews;
create policy "read visible" on public.course_reviews
  for select using (not is_hidden or user_id = (select auth.uid()) or (select public.is_admin()));
-- One review per enrolled learner. It can't be edited afterwards, so a review
-- an admin has hidden can't be quietly re-posted.
drop policy if exists "enrolled learners review" on public.course_reviews;
create policy "enrolled learners review" on public.course_reviews
  for insert to authenticated
  with check (
    user_id = (select auth.uid()) and not is_hidden
    and exists (select 1 from public.enrollments e where e.user_id = (select auth.uid()) and e.course_id = course_reviews.course_id)
  );
drop policy if exists "admins moderate" on public.course_reviews;
create policy "admins moderate" on public.course_reviews
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "admins remove" on public.course_reviews;
create policy "admins remove" on public.course_reviews
  for delete to authenticated using ((select public.is_admin()));

-- ── announcements ────────────────────────────────────────────────────────────
create table if not exists public.course_announcements (
  id         uuid primary key default gen_random_uuid(),
  course_id  text not null references public.courses(id) on delete cascade on update cascade,
  title      text not null default '',
  body       text,
  created_at timestamptz not null default now()
);
create index if not exists idx_course_announcements_course on public.course_announcements (course_id, created_at desc);
alter table public.course_announcements enable row level security;
drop policy if exists "read published" on public.course_announcements;
create policy "read published" on public.course_announcements
  for select using (
    (select public.is_admin())
    or exists (select 1 from public.courses c where c.id = course_announcements.course_id and c.status = 'published')
  );
drop policy if exists "admins write" on public.course_announcements;
create policy "admins write" on public.course_announcements
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ── certificates: issued and checked by the database, not the browser ────────
create table if not exists public.certificates (
  id           text primary key,                    -- e.g. AC-4F2A91C07B, printed on the certificate
  user_id      uuid not null references auth.users(id) on delete cascade,
  course_id    text not null references public.courses(id) on delete cascade on update cascade,
  learner_name text not null,
  issued_at    timestamptz not null default now(),
  unique (user_id, course_id)
);
create index if not exists idx_certificates_course on public.certificates (course_id);
alter table public.certificates enable row level security;
drop policy if exists "own or admin read" on public.certificates;
create policy "own or admin read" on public.certificates
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "admins revoke" on public.certificates;
create policy "admins revoke" on public.certificates
  for delete to authenticated using ((select public.is_admin()));

-- Issues a certificate only if every visible lesson of the course is complete.
-- There is no insert policy on the table: this function is the only way in.
create or replace function public.issue_certificate(p_course text, p_name text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_user  uuid := (select auth.uid());
  v_total integer;
  v_done  integer;
  v_id    text;
begin
  if v_user is null then raise exception 'sign in first'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then raise exception 'enter the name for the certificate'; end if;

  select id into v_id from public.certificates where user_id = v_user and course_id = p_course;
  if v_id is not null then return v_id; end if;

  select count(*) into v_total
  from public.course_lessons l
  join public.course_modules m on m.id = l.module_id
  join public.courses c on c.id = l.course_id
  where l.course_id = p_course and not l.is_hidden and not m.is_hidden and c.status = 'published';

  select count(*) into v_done
  from public.lesson_progress p
  join public.course_lessons l on l.id = p.lesson_id
  join public.course_modules m on m.id = l.module_id
  where p.user_id = v_user and l.course_id = p_course and not l.is_hidden and not m.is_hidden;

  if v_total = 0 or v_done < v_total then raise exception 'finish every lesson first'; end if;

  v_id := 'AC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.certificates (id, user_id, course_id, learner_name) values (v_id, v_user, p_course, left(trim(p_name), 80));
  update public.enrollments set completed_at = coalesce(completed_at, now()) where user_id = v_user and course_id = p_course;
  return v_id;
end;
$$;
revoke all on function public.issue_certificate(text, text) from public, anon;
grant execute on function public.issue_certificate(text, text) to authenticated;

-- Public verification: anyone holding a certificate id can check it.
create or replace function public.get_certificate(p_id text)
returns table (id text, learner_name text, issued_at timestamptz, course_id text, course_title text, instructor_name text)
language sql stable security definer set search_path = ''
as $$
  select ce.id, ce.learner_name, ce.issued_at, c.id, c.title, c.instructor_name
  from public.certificates ce join public.courses c on c.id = ce.course_id
  where ce.id = p_id;
$$;
revoke all on function public.get_certificate(text) from public;
grant execute on function public.get_certificate(text) to anon, authenticated;

-- Public numbers for course cards: learners, average rating, review count.
create or replace function public.course_stats()
returns table (course_id text, learners bigint, rating numeric, reviews bigint)
language sql stable security definer set search_path = ''
as $$
  select c.id,
         (select count(*) from public.enrollments e where e.course_id = c.id),
         (select round(avg(r.rating)::numeric, 1) from public.course_reviews r where r.course_id = c.id and not r.is_hidden),
         (select count(*) from public.course_reviews r where r.course_id = c.id and not r.is_hidden)
  from public.courses c where c.status = 'published';
$$;
revoke all on function public.course_stats() from public;
grant execute on function public.course_stats() to anon, authenticated;

grant select on public.course_reviews, public.course_announcements to anon;
grant select, insert, update, delete on public.lesson_notes, public.lesson_comments, public.course_reviews,
  public.course_announcements to authenticated;
grant select, delete on public.certificates to authenticated;

-- Lets admins list and delete uploaded files (public downloads don't need this).
drop policy if exists "site-media admins read" on storage.objects;
create policy "site-media admins read" on storage.objects
  for select to authenticated using (bucket_id = 'site-media' and (select public.is_admin()));
