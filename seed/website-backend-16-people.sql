-- ─────────────────────────────────────────────────────────────────────────────
-- 16 · everyone who signed up, for the "everyone signed up" screen of the admin panel
--
-- the list of accounts lives in auth.users, which the website cannot read. this
-- function hands an admin with the "learners & payments" area the few things the
-- screen shows — never a password, token or anything else from that table.
-- run once in the supabase sql editor (safe to run again).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_people()
returns table (
  id uuid,
  email text,
  signed_up timestamptz,
  last_seen timestamptz,
  confirmed boolean,
  ways text[],
  account_name text,
  full_name text,
  phone text,
  admin_role text
)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not public.admin_can('learners') then
    raise exception 'only admins with the learners area can see this' using errcode = '42501';
  end if;
  return query
    select u.id,
           u.email::text,
           u.created_at,
           u.last_sign_in_at,
           u.email_confirmed_at is not null,
           case when jsonb_typeof(u.raw_app_meta_data -> 'providers') = 'array'
                then array(select jsonb_array_elements_text(u.raw_app_meta_data -> 'providers'))
                else array[coalesce(u.raw_app_meta_data ->> 'provider', 'email')] end,
           nullif(trim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), ''),
           p.full_name,
           p.phone,
           a.role
      from auth.users u
      left join public.profiles p on p.id = u.id
      left join public.admins a on lower(a.email) = lower(u.email)
     where u.deleted_at is null
     order by u.created_at desc;
end;
$$;

revoke all on function public.admin_people() from public, anon;
grant execute on function public.admin_people() to authenticated;
