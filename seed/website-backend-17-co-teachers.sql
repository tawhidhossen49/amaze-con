-- ─────────────────────────────────────────────────────────────────────────────
-- 17 · more than one teacher on a course, program or webinar
--
-- the main teacher stays in instructor_name / _role / _img, so everything that
-- already reads those keeps working. anyone teaching beside them goes in
-- co_teachers, in the order they are shown: [{ "name", "role", "img" }, ...]
-- the certificate check names all of them.
-- run once in the supabase sql editor (safe to run again).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.courses add column if not exists co_teachers jsonb not null default '[]'::jsonb;

alter table public.courses drop constraint if exists courses_co_teachers_is_a_list;
alter table public.courses add constraint courses_co_teachers_is_a_list check (jsonb_typeof(co_teachers) = 'array');

-- same columns as before, so nothing that calls it changes; instructor_name now reads "sara, rafi and mina"
create or replace function public.get_certificate(p_id text)
returns table (id text, learner_name text, issued_at timestamptz, course_id text, course_title text, instructor_name text)
language sql
stable
security definer
set search_path to ''
as $$
  select ce.id, ce.learner_name, ce.issued_at, c.id, c.title,
         case when cardinality(t.names) > 1
              then array_to_string(t.names[1:cardinality(t.names) - 1], ', ') || ' and ' || t.names[cardinality(t.names)]
              else t.names[1] end
    from public.certificates ce
    join public.courses c on c.id = ce.course_id
   cross join lateral (
     select array_remove(array[nullif(trim(c.instructor_name), '')], null)
         || array(select trim(x.v ->> 'name')
                    from jsonb_array_elements(c.co_teachers) with ordinality as x(v, n)
                   where nullif(trim(x.v ->> 'name'), '') is not null
                   order by x.n) as names
   ) t
   where ce.id = p_id;
$$;
