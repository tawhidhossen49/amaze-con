-- ════════════════════════════════════════════════
-- Amaze Consortium public website — backend, part 8: live classes
-- Run AFTER parts 1–7. Safe to run more than once. (Already applied.)
-- ════════════════════════════════════════════════
-- A live class runs on its lesson page. With no video service connected, the
-- built-in room is used: every browser connects straight to every other one,
-- and they find each other through a private Supabase Realtime channel named
-- 'live:<lesson id>'. These rules decide who may use that channel:
--   admins                      — any live class
--   signed-in learners          — only where the entry is open to them
--                                 (it is free, or their payment was confirmed)
--   everyone else               — refused
-- (The live-room Edge Function, supabase/functions/live-room, asks the same
-- questions first and also checks the time; this is the second lock.)

create or replace function public.can_join_live(p_topic text)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare
  v_course text;
begin
  if p_topic is null or p_topic !~ '^live:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  if (select auth.uid()) is null then return false; end if;
  select l.course_id into v_course
  from public.course_lessons l join public.courses c on c.id = l.course_id join public.course_modules m on m.id = l.module_id
  where l.id = substring(p_topic from 6)::uuid and l.kind = 'live' and not l.is_hidden and not m.is_hidden and c.status = 'published';
  -- a class that is still a draft or hidden: admins only (to try it out)
  if v_course is null then return public.is_admin() and exists (select 1 from public.course_lessons l where l.id = substring(p_topic from 6)::uuid and l.kind = 'live'); end if;
  return public.is_admin() or public.course_open_to_me(v_course);
end;
$$;
revoke all on function public.can_join_live(text) from public, anon;
grant execute on function public.can_join_live(text) to authenticated;

drop policy if exists "live class: listen" on realtime.messages;
create policy "live class: listen" on realtime.messages for select to authenticated
  using (extension in ('broadcast', 'presence') and public.can_join_live((select realtime.topic())));
drop policy if exists "live class: speak" on realtime.messages;
create policy "live class: speak" on realtime.messages for insert to authenticated
  with check (extension in ('broadcast', 'presence') and public.can_join_live((select realtime.topic())));
