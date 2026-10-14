-- ═══════════════════════════════════════════════════════════════════════════
--  learner profiles — the name they want to be called, and a phone number
--
--  Run once in supabase → sql editor. Safe to run again.
--
--  A learner's name used to come only from their google account. Now they can
--  change it, and add a phone number, from their own page. One row per account:
--    • a learner reads and changes only their own row
--    • admins who look after learners & payments can read every row (to call
--      someone about a payment, or to see who a learner is)
--  The name chosen here is the one printed on certificates made from now on.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null check (char_length(btrim(full_name)) between 2 and 80),
  phone      text check (phone is null or phone ~ '^\+?[0-9]{8,15}$'),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.touch_profile()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.full_name := btrim(regexp_replace(new.full_name, '\s+', ' ', 'g'));
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.id is distinct from old.id then raise exception 'a profile cannot be moved to another account'; end if;
  return new;
end $$;
revoke all on function public.touch_profile() from public, anon, authenticated;
create or replace trigger touch_profile before insert or update on public.profiles
  for each row execute function public.touch_profile();

drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.admin_can('learners')));
drop policy if exists "own profile add" on public.profiles;
create policy "own profile add" on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
drop policy if exists "own profile change" on public.profiles;
create policy "own profile change" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

revoke all on public.profiles from anon;
grant select, insert, update on public.profiles to authenticated;
