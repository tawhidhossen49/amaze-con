-- ═══════════════════════════════════════════════════════════════════════════
--  hardening, round 2 — found in the security review of october 2026
--
--  Run once in supabase → sql editor. Safe to run again.
--
--  1. A learner may change their own enrolment and progress rows (to mark a course
--     finished, to save a quiz score). Nothing stopped them from changing WHICH
--     course or lesson a row is for — so a row earned in a free course could be
--     pointed at a paid one, and a certificate or a review claimed for a course
--     never taken. Those columns can no longer change once a row exists.
--  2. A certificate is only given for a course the learner may actually open
--     (free, or with a confirmed payment).
--  3. Functions that only exist to be run by a trigger can no longer be called
--     through the api at all.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1 ─ what a row is about never changes
create or replace function public.keep_row_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'enrollments' then
    if new.user_id is distinct from old.user_id or new.course_id is distinct from old.course_id then
      raise exception 'an enrolment cannot be moved to another learner or course';
    end if;
    new.enrolled_at := old.enrolled_at;
  elsif tg_table_name = 'lesson_progress' then
    if new.user_id is distinct from old.user_id or new.course_id is distinct from old.course_id or new.lesson_id is distinct from old.lesson_id then
      raise exception 'progress cannot be moved to another learner, course or lesson';
    end if;
  end if;
  return new;
end $$;

create or replace trigger keep_row_identity before update on public.enrollments
  for each row execute function public.keep_row_identity();
create or replace trigger keep_row_identity before update on public.lesson_progress
  for each row execute function public.keep_row_identity();

-- 2 ─ a certificate needs the course to be open to this learner
create or replace function public.issue_certificate(p_course text, p_name text)
returns text language plpgsql security definer set search_path = '' as $$
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

  if not public.course_open_to_me(p_course) then raise exception 'finish every lesson first'; end if;

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
end $$;

-- 3 ─ trigger-only functions are not part of the api
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
