-- ════════════════════════════════════════════════
-- Amaze Consortium public website — backend, part 3
-- Run AFTER parts 1 and 2. Safe to run more than once.
-- ════════════════════════════════════════════════
-- Anyone added from the Supabase dashboard (Authentication → Users → "Add
-- user", or "Send invitation") is put on the admin list automatically, so
-- adding the person is the only step.
--
-- People who sign up on the website are learners and are never promoted.
-- The two are told apart by one fact: a website sign-up is confirmed through
-- an emailed link (confirmation_sent_at is set), a dashboard-added account
-- is not. That holds only while the project requires email confirmation and
-- has no other sign-in providers — the admin panel checks both every time
-- the "admins" screen opens and switches this rule off if either changes.

create table if not exists public.site_settings (
  key   text primary key,
  value jsonb not null
);
alter table public.site_settings enable row level security;
drop policy if exists "admins manage settings" on public.site_settings;
create policy "admins manage settings" on public.site_settings
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.site_settings to authenticated;
insert into public.site_settings (key, value) values ('auto_admin', 'true'::jsonb) on conflict (key) do nothing;

-- Never raises, so it can never block someone from being created or signing up.
create or replace function public.grant_admin_to_dashboard_users()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.email is null or new.email_confirmed_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.email_confirmed_at is not null then return new; end if;   -- only at the moment of confirmation
  if coalesce(new.is_anonymous, false) or coalesce(new.is_sso_user, false) then return new; end if;
  if coalesce(new.raw_app_meta_data->>'provider', 'email') <> 'email' then return new; end if;
  -- a learner's own sign-up always carries a confirmation email; a dashboard-added account never does
  if new.confirmation_sent_at is not null and new.invited_at is null then return new; end if;
  if not coalesce((select (value)::boolean from public.site_settings where key = 'auto_admin'), false) then return new; end if;

  insert into public.admins (email) values (lower(new.email)) on conflict (email) do nothing;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.grant_admin_to_dashboard_users() from public, anon, authenticated;

create or replace trigger grant_admin_to_dashboard_users
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.grant_admin_to_dashboard_users();

-- everyone already added from the dashboard
insert into public.admins (email)
select lower(email) from auth.users
where email is not null and email_confirmed_at is not null and confirmation_sent_at is null
  and not coalesce(is_anonymous, false) and not coalesce(is_sso_user, false)
on conflict (email) do nothing;


-- ════════════════════════════════════════════════
-- Learner accounts and admin logins are separate
-- ════════════════════════════════════════════════
-- An account made by signing up on the website is a LEARNER account for good
-- (it carries the confirmation email every website sign-up gets). It can never
-- be an admin. An admin login is made in one of two places only: the Supabase
-- dashboard, or the admin panel's "create admin login" form.

create or replace function public.is_learner_account(u auth.users)
returns boolean language sql immutable set search_path = ''
as $$ select u.confirmation_sent_at is not null and u.invited_at is null $$;
revoke all on function public.is_learner_account(auth.users) from public, anon, authenticated;

-- Admin = on the admin list AND not a learner account.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join public.admins a on lower(a.email) = lower(u.email)
    where u.id = (select auth.uid())
      and u.email_confirmed_at is not null
      and not public.is_learner_account(u)
  );
$$;

-- A learner's email can't be put on the admin list at all.
create or replace function public.keep_learners_off_admin_list()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.email := lower(trim(new.email));
  if exists (select 1 from auth.users u where lower(u.email) = new.email and public.is_learner_account(u)) then
    raise exception 'that email already belongs to a learner account — admins need their own separate login';
  end if;
  return new;
end;
$$;
create or replace trigger keep_learners_off_admin_list
  before insert or update of email on public.admins
  for each row execute function public.keep_learners_off_admin_list();

-- The admin panel's "create admin login": account + admin access in one step.
-- Only an admin can call it; it refuses any email that already has an account.
create or replace function public.create_admin(p_email text, p_password text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_id    uuid := gen_random_uuid();
begin
  if not public.is_admin() then raise exception 'only an admin can add admins'; end if;
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
revoke all on function public.create_admin(text, text) from public, anon;
grant execute on function public.create_admin(text, text) to authenticated;

-- Admin logins don't take courses: no enrolments, progress or reviews.
alter policy "enrol self" on public.enrollments
  with check (user_id = (select auth.uid()) and not (select public.is_admin()));
alter policy "record own" on public.lesson_progress
  with check (user_id = (select auth.uid()) and not (select public.is_admin()));
alter policy "enrolled learners review" on public.course_reviews
  with check (
    user_id = (select auth.uid()) and not is_hidden and not (select public.is_admin())
    and exists (select 1 from public.enrollments e where e.user_id = (select auth.uid()) and e.course_id = course_reviews.course_id)
  );
