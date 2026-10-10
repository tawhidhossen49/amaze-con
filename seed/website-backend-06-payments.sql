-- ════════════════════════════════════════════════
-- Amaze Consortium public website — backend, part 6: paid entries
-- Run AFTER parts 1–5. Safe to run more than once.
-- ════════════════════════════════════════════════
-- The pages already keep a paid course, program or webinar closed until an
-- admin confirms the learner's payment. This makes the database refuse too:
-- the lessons of a paid entry (video links, text, files, quizzes, join links)
-- are only handed to admins and to learners whose payment has been confirmed.
--
-- Where the facts live (written by the admin panel, readable by everyone,
-- writable only by admins — see site_text in part 1):
--   site_text 'pay.course.<course id>'  { "paid": true|false, "price": …, "was": …, "link": … }
--   site_text 'pay.ok.<course id>'      [ "<user id>", … ]   learners whose payment is confirmed
-- An entry with nothing saved is paid.

-- true when the person asking may open this entry's lessons:
-- it is free, or their payment for it has been confirmed
create or replace function public.course_open_to_me(p_course text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_fee jsonb;
  v_ok  jsonb;
  v_uid uuid := (select auth.uid());
begin
  begin
    select value::jsonb into v_fee from public.site_text where key = 'pay.course.' || p_course;
  exception when others then v_fee := null;   -- unreadable setting = paid
  end;
  if v_fee is not null and jsonb_typeof(v_fee) = 'object' and v_fee->>'paid' = 'false' then
    return true;
  end if;
  if v_uid is null then return false; end if;
  begin
    select value::jsonb into v_ok from public.site_text where key = 'pay.ok.' || p_course;
  exception when others then v_ok := null;
  end;
  return v_ok is not null and jsonb_typeof(v_ok) = 'array' and v_ok ? v_uid::text;
end;
$$;
revoke all on function public.course_open_to_me(text) from public;
grant execute on function public.course_open_to_me(text) to anon, authenticated;

-- Lesson content: as before, plus "…and the entry is open to you".
-- (In a paid entry that also closes lessons marked "free preview".)
alter policy "read lesson content" on public.lesson_content
  using (
    (select public.is_admin())
    or exists (
      select 1
      from public.course_lessons l
      join public.courses c on c.id = l.course_id
      join public.course_modules m on m.id = l.module_id
      where l.id = lesson_content.lesson_id
        and c.status = 'published' and not l.is_hidden and not m.is_hidden
        and (l.is_preview or c.access = 'open' or (select auth.uid()) is not null)
        and public.course_open_to_me(c.id)
    )
  );

-- Progress (and so certificates) only in entries that are open to the learner.
alter policy "record own" on public.lesson_progress
  with check (
    user_id = (select auth.uid()) and not (select public.is_admin())
    and exists (
      select 1 from public.course_lessons l
      join public.courses c on c.id = l.course_id
      join public.course_modules m on m.id = l.module_id
      where l.id = lesson_progress.lesson_id and l.course_id = lesson_progress.course_id
        and c.status = 'published' and not l.is_hidden and not m.is_hidden
        and public.course_open_to_me(c.id)
    )
  );
