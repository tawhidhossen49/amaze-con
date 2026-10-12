-- ════════════════════════════════════════════════
-- Amaze Consortium public website — backend, part 9: admin roles
-- Run AFTER parts 1–8. Safe to run more than once. (Already applied.)
-- ════════════════════════════════════════════════
-- Not every admin has to be able to do everything.
--   main admin      everything, including deciding who the admins are
--   limited admin   only the parts of the panel a main admin ticked for them:
--                     pages      words & pictures (the text and images of the pages)
--                     lists      people & logos
--                     courses    academy (courses, programs, webinars, lessons, prices, bkash number)
--                     learners   learners & payments
--                   …and never the admins screen.
-- The panel hides what someone may not use, but these rules are what actually
-- stop them: every write below is refused by the database itself.
-- (Any admin, main or limited, can still open draft courses and teach a live class.)

alter table public.admins add column if not exists role text not null default 'limited';
alter table public.admins add column if not exists access text[] not null default '{}';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'admins_role_known') then
    alter table public.admins add constraint admins_role_known check (role in ('main', 'limited'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'admins_access_known') then
    alter table public.admins add constraint admins_access_known check (access <@ array['pages', 'lists', 'courses', 'learners']);
  end if;
end $$;

-- the two people who run the site
update public.admins set role = 'main' where lower(email) in ('tawhidhossen449@gmail.com', 'ariyanbiswas500@gmail.com') and role <> 'main';

-- may the person asking use this part of the panel?
create or replace function public.admin_can(p_area text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_admin() and exists (
    select 1 from public.admins a join auth.users u on lower(u.email) = lower(a.email)
    where u.id = (select auth.uid()) and (a.role = 'main' or (p_area <> 'admins' and p_area = any(a.access)))
  );
$$;
revoke all on function public.admin_can(text) from public, anon;
grant execute on function public.admin_can(text) to authenticated;

-- what the panel asks when it opens: who am i here?
create or replace function public.admin_me()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select case when public.is_admin() then (
    select jsonb_build_object('role', a.role, 'access', to_jsonb(a.access))
    from public.admins a join auth.users u on lower(u.email) = lower(a.email)
    where u.id = (select auth.uid()) limit 1) end;
$$;
revoke all on function public.admin_me() from public, anon;
grant execute on function public.admin_me() to authenticated;

-- there is always at least one main admin, or nobody could ever manage admins again
create or replace function public.keep_a_main_admin()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.role = 'main' and (tg_op = 'DELETE' or new.role <> 'main')
     and not exists (select 1 from public.admins where role = 'main' and email <> old.email) then
    raise exception 'there has to be at least one main admin — make someone else a main admin first';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create or replace trigger admins_keep_a_main before update or delete on public.admins
  for each row execute function public.keep_a_main_admin();

-- ── who may change what ──
-- admins and the panel's own settings: main admins only
alter policy "admins manage admins" on public.admins
  using ((select public.admin_can('admins'))) with check ((select public.admin_can('admins')));
alter policy "admins manage settings" on public.site_settings
  using ((select public.admin_can('admins'))) with check ((select public.admin_can('admins')));

-- words & pictures — except prices and the bkash number, which belong to the academy
alter policy "admins write" on public.site_text
  using (case when key like 'pay.%' then (select public.admin_can('courses')) else (select public.admin_can('pages')) end)
  with check (case when key like 'pay.%' then (select public.admin_can('courses')) else (select public.admin_can('pages')) end);

-- people & logos
alter policy "admins write" on public.site_content
  using ((select public.admin_can('lists'))) with check ((select public.admin_can('lists')));

-- academy
alter policy "admins write" on public.courses
  using ((select public.admin_can('courses'))) with check ((select public.admin_can('courses')));
alter policy "admins write" on public.course_modules
  using ((select public.admin_can('courses'))) with check ((select public.admin_can('courses')));
alter policy "admins write" on public.course_lessons
  using ((select public.admin_can('courses'))) with check ((select public.admin_can('courses')));
alter policy "admins write" on public.lesson_content
  using ((select public.admin_can('courses'))) with check ((select public.admin_can('courses')));
alter policy "admins write" on public.course_announcements
  using ((select public.admin_can('courses'))) with check ((select public.admin_can('courses')));
alter policy "admins moderate" on public.course_reviews
  using ((select public.admin_can('courses'))) with check ((select public.admin_can('courses')));
alter policy "admins remove" on public.course_reviews
  using ((select public.admin_can('courses')));
alter policy "delete own or admin" on public.lesson_comments
  using (user_id = (select auth.uid()) or (select public.admin_can('courses')));
alter policy "admins revoke" on public.certificates
  using ((select public.admin_can('courses')));
alter policy "own or admin read" on public.certificates
  using (user_id = (select auth.uid()) or (select public.admin_can('courses')) or (select public.admin_can('learners')));

-- learners & payments: names, emails, progress and money
alter policy "own or admin read" on public.enrollments
  using (user_id = (select auth.uid()) or (select public.admin_can('learners')));
alter policy "leave or admin remove" on public.enrollments
  using (user_id = (select auth.uid()) or (select public.admin_can('learners')));
alter policy "own or admin read" on public.lesson_progress
  using (user_id = (select auth.uid()) or (select public.admin_can('learners')));
alter policy "admins manage" on public.payments
  using ((select public.admin_can('learners'))) with check ((select public.admin_can('learners')));
alter policy "own or admin read" on public.payments
  using (user_id = (select auth.uid()) or (select public.admin_can('learners')));

-- uploads (pictures, pdfs, videos): anyone who can edit pages, lists or the academy
alter policy "site-media admins upload" on storage.objects
  with check (bucket_id = 'site-media' and ((select public.admin_can('pages')) or (select public.admin_can('lists')) or (select public.admin_can('courses'))));
alter policy "site-media admins update" on storage.objects
  using (bucket_id = 'site-media' and ((select public.admin_can('pages')) or (select public.admin_can('lists')) or (select public.admin_can('courses'))));
alter policy "site-media admins delete" on storage.objects
  using (bucket_id = 'site-media' and ((select public.admin_can('pages')) or (select public.admin_can('lists')) or (select public.admin_can('courses'))));

-- ── the functions the panel calls ──
create or replace function public.review_payment(p_payment uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_pay public.payments;
begin
  if not public.admin_can('learners') then raise exception 'you do not have access to learners & payments'; end if;
  if p_status not in ('pending', 'confirmed', 'rejected') then raise exception 'unknown status'; end if;
  update public.payments
     set status = p_status,
         note = case when p_status = 'rejected' then nullif(left(trim(coalesce(p_note, '')), 500), '') else null end,
         reviewed_at = case when p_status = 'pending' then null else now() end,
         reviewed_by = case when p_status = 'pending' then null else (select email from auth.users where id = (select auth.uid())) end
   where id = p_payment
   returning * into v_pay;
  if v_pay.id is null then raise exception 'that payment no longer exists'; end if;
  if p_status = 'confirmed' then
    insert into public.enrollments (user_id, course_id, learner_name, learner_email)
    values (v_pay.user_id, v_pay.course_id, v_pay.learner_name, v_pay.learner_email)
    on conflict (user_id, course_id) do nothing;
  end if;
end;
$$;

create or replace function public.grant_course_access(p_email text, p_course text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_user auth.users;
  v_admin text;
begin
  if not public.admin_can('learners') then raise exception 'you do not have access to learners & payments'; end if;
  select * into v_user from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_user.id is null then raise exception 'no account uses that email yet — ask them to sign in on the site once, then try again'; end if;
  if not exists (select 1 from public.courses where id = p_course) then raise exception 'that entry no longer exists'; end if;
  select email into v_admin from auth.users where id = (select auth.uid());

  update public.payments set status = 'confirmed', note = null, reviewed_at = now(), reviewed_by = v_admin
   where user_id = v_user.id and course_id = p_course and status = 'pending';
  if not found and not exists (select 1 from public.payments where user_id = v_user.id and course_id = p_course and status = 'confirmed') then
    insert into public.payments (user_id, course_id, learner_name, learner_email, method, sender, trx_id, status, reviewed_at, reviewed_by)
    values (v_user.id, p_course, coalesce(v_user.raw_user_meta_data->>'full_name', v_user.raw_user_meta_data->>'name'), v_user.email,
            'manual', 'manual', 'MANUAL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)), 'confirmed', now(), v_admin);
  end if;
  insert into public.enrollments (user_id, course_id, learner_name, learner_email)
  values (v_user.id, p_course, coalesce(v_user.raw_user_meta_data->>'full_name', v_user.raw_user_meta_data->>'name'), v_user.email)
  on conflict (user_id, course_id) do nothing;
end;
$$;

-- a new admin login: made by a main admin, and it starts with no access until one is chosen for it
create or replace function public.create_admin(p_email text, p_password text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_id    uuid := gen_random_uuid();
begin
  if not public.admin_can('admins') then raise exception 'only a main admin can add admins'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'enter a valid email address'; end if;
  if char_length(coalesce(p_password, '')) < 8 then raise exception 'the password needs at least 8 characters'; end if;
  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'that email already has an account — use a different email for the admin login';
  end if;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change, email_change_token_new,
                          email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_email,
          extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, '{"email_verified":true}'::jsonb, now(), now(),
          '', '', '', '', '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text, 'email',
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false), now(), now(), now());
  insert into public.admins (email) values (v_email) on conflict (email) do nothing;
  return v_email;
end;
$$;
