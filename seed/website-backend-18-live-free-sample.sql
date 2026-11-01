-- ─────────────────────────────────────────────────────────────────────────────
-- 18 · a live class marked "free sample" can really be joined
--
-- the admin panel lets a lesson be a free sample, which people can open before they
-- enrol or pay. a live class marked that way showed its door and then refused them.
-- anyone signed in may now use its room; any other live class stays as it was.
-- run once in the supabase sql editor (safe to run again).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.can_join_live(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_course text;
  v_sample boolean;
begin
  if p_topic is null or p_topic !~ '^live:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  if (select auth.uid()) is null then return false; end if;
  select l.course_id, l.is_preview into v_course, v_sample
  from public.course_lessons l join public.courses c on c.id = l.course_id join public.course_modules m on m.id = l.module_id
  where l.id = substring(p_topic from 6)::uuid and l.kind = 'live' and not l.is_hidden and not m.is_hidden and c.status = 'published';
  if v_course is null then return public.is_admin() and exists (select 1 from public.course_lessons l where l.id = substring(p_topic from 6)::uuid and l.kind = 'live'); end if;
  return public.is_admin() or v_sample or public.course_open_to_me(v_course);
end;
$$;
