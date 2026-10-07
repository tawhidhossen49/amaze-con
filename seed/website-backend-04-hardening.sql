-- ════════════════════════════════════════════════
-- Amaze Consortium public website — backend, part 4: security hardening
-- Run AFTER parts 1–3. Safe to run more than once.
-- ════════════════════════════════════════════════
-- Tightens what a signed-in learner can write. None of it changes what the
-- site does for an honest visitor; it only refuses things the pages never ask
-- for (enrolling in an unpublished course, posting on a lesson that isn't
-- visible, flooding the Q&A, storing oversized text).

-- Enrol only in courses that are actually published.
alter policy "enrol self" on public.enrollments
  with check (
    user_id = (select auth.uid()) and not (select public.is_admin())
    and exists (select 1 from public.courses c where c.id = enrollments.course_id and c.status = 'published')
  );

-- Progress only for a real, visible lesson of the course it claims to belong to.
alter policy "record own" on public.lesson_progress
  with check (
    user_id = (select auth.uid()) and not (select public.is_admin())
    and exists (
      select 1 from public.course_lessons l
      join public.courses c on c.id = l.course_id
      join public.course_modules m on m.id = l.module_id
      where l.id = lesson_progress.lesson_id and l.course_id = lesson_progress.course_id
        and c.status = 'published' and not l.is_hidden and not m.is_hidden
    )
  );

-- Questions: only on visible lessons of published courses.
-- (This policy must not look at lesson_comments itself — a policy that reads
-- its own table recurses. The reply rule lives in the trigger below instead.)
alter policy "post as self" on public.lesson_comments
  with check (
    user_id = (select auth.uid())
    and is_staff = (select public.is_admin())
    and char_length(body) between 1 and 4000
    and char_length(author_name) between 1 and 80
    and exists (
      select 1 from public.course_lessons l
      join public.courses c on c.id = l.course_id
      join public.course_modules m on m.id = l.module_id
      where l.id = lesson_comments.lesson_id and l.course_id = lesson_comments.course_id
        and ((select public.is_admin()) or (c.status = 'published' and not l.is_hidden and not m.is_hidden))
    )
  );
alter policy "signed-in read" on public.lesson_comments
  using (
    (select public.is_admin())
    or exists (select 1 from public.courses c where c.id = lesson_comments.course_id and c.status = 'published')
  );

-- Flood control, and replies may only sit directly under a question on the same lesson.
create or replace function public.limit_comment_rate()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from public.lesson_comments p where p.id = new.parent_id and p.lesson_id = new.lesson_id and p.parent_id is null
  ) then
    raise exception 'a reply must answer a question on the same lesson';
  end if;
  if public.is_admin() then return new; end if;
  if (select count(*) from public.lesson_comments c where c.user_id = new.user_id and c.created_at > now() - interval '1 minute') >= 5 then
    raise exception 'you are posting too quickly — wait a minute and try again';
  end if;
  if (select count(*) from public.lesson_comments c where c.user_id = new.user_id and c.created_at > now() - interval '1 day') >= 100 then
    raise exception 'daily posting limit reached — try again tomorrow';
  end if;
  return new;
end;
$$;
create or replace trigger limit_comment_rate
  before insert on public.lesson_comments
  for each row execute function public.limit_comment_rate();

-- Size limits on everything a learner can write.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'course_reviews_sizes') then
    alter table public.course_reviews add constraint course_reviews_sizes check (char_length(coalesce(body, '')) <= 2000 and char_length(author_name) <= 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'enrollments_sizes') then
    alter table public.enrollments add constraint enrollments_sizes check (char_length(coalesce(learner_name, '')) <= 120 and char_length(coalesce(learner_email, '')) <= 254);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lesson_notes_sizes') then
    alter table public.lesson_notes add constraint lesson_notes_sizes check (char_length(body) <= 20000);
  end if;
end $$;

-- Internal functions are not callable through the API.
revoke execute on function public.keep_learners_off_admin_list() from public, anon, authenticated;
revoke execute on function public.limit_comment_rate() from public, anon, authenticated;
revoke execute on function public.issue_certificate(text, text) from public, anon;
revoke execute on function public.create_admin(text, text) from public, anon;
