-- ════════════════════════════════════════════════
-- Amaze Consortium public website — backend, part 5: the academy
-- Run AFTER parts 1–4 (Supabase → SQL editor → paste → Run).
-- Safe to run more than once. Only adds columns; nothing existing changes.
-- ════════════════════════════════════════════════
-- The academy page lists three kinds of thing — courses, programs and
-- webinars — and a lesson can now be a live class with a date.
-- Until this has been run the site keeps working: everything is treated as a
-- course, and the admin panel says that these four fields are switched off.

-- what an entry is: 'course' | 'program' | 'webinar'
alter table public.courses add column if not exists kind text not null default 'course';
-- when it starts (a webinar's date, a program's first day); empty = any time
alter table public.courses add column if not exists starts_at timestamptz;

-- a live class: its date is part of the public outline, like the title
alter table public.course_lessons add column if not exists live_at timestamptz;
-- the link to join it is lesson content, so only people allowed to read the lesson get it
alter table public.lesson_content add column if not exists live_url text;

create index if not exists idx_courses_kind on public.courses (kind, sort_order);

-- make the new columns visible to the API straight away
notify pgrst, 'reload schema';
