-- ─────────────────────────────────────────────────────────────────────────────
-- 19 · a course's web address follows its name
--
-- a course's id is made from its first name and can never change (enrolments,
-- payments, progress and certificates all point at it). the address people see now
-- comes from `slug`, which the admin panel changes when a course is renamed; every
-- earlier address is kept in `old_slugs` and still leads to the course.
-- run once in the supabase sql editor (safe to run again).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.courses add column if not exists slug text;
alter table public.courses add column if not exists old_slugs text[] not null default '{}';
create unique index if not exists courses_slug_unique on public.courses (slug) where slug is not null;

-- courses renamed before this existed get the address of their current name, made the way the admin panel makes one
update public.courses c
   set slug = s.addr, old_slugs = array[c.id]
  from (select id, trim(both '-' from regexp_replace(replace(lower(trim(title)), '&', ' and '), '[^a-z0-9]+', '-', 'g')) as addr from public.courses) s
 where s.id = c.id and c.slug is null and s.addr <> '' and s.addr <> c.id
   and not exists (select 1 from public.courses o where o.id <> c.id and (o.id = s.addr or o.slug = s.addr));
