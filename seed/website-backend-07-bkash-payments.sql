-- ════════════════════════════════════════════════
-- Amaze Consortium public website — backend, part 7: bKash payments
-- Run AFTER parts 1–6. Safe to run more than once.
-- ════════════════════════════════════════════════
-- A learner pays the fee by bKash, then types the number they paid from and the
-- bKash transaction id on the payment page. That is one row here, "pending".
-- An admin checks it against the bKash account and confirms or rejects it
-- (admin panel → learners). A confirmed row is what opens a paid entry.
--
-- What the database itself guarantees:
--   * a learner can only add a payment for themselves, and only as "pending"
--   * a learner can never change a payment, confirm one, or see anyone else's
--   * one transaction id can only be used once (unless the earlier use was rejected)
--   * one open payment per learner per entry; a handful of attempts a day at most
--   * the lessons of a paid entry are only handed to learners with a confirmed payment

create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  course_id     text not null references public.courses(id) on delete cascade on update cascade,
  learner_name  text,
  learner_email text,
  amount        text,                              -- the price shown to the learner when they paid, e.g. "৳1200"
  method        text not null default 'bkash',     -- 'bkash' | 'manual' (access given by an admin without a bKash payment)
  sender        text not null,                     -- the number the money was sent from
  trx_id        text not null,                     -- bKash transaction id
  status        text not null default 'pending',   -- 'pending' | 'confirmed' | 'rejected'
  note          text,                              -- the admin's reason when rejecting; shown to the learner
  created_at    timestamptz not null default now(),
  reviewed_at   timestamptz,
  reviewed_by   text,
  constraint payments_status check (status in ('pending', 'confirmed', 'rejected')),
  constraint payments_method check (method in ('bkash', 'manual')),
  constraint payments_sizes  check (
    char_length(sender) between 5 and 20 and char_length(trx_id) between 4 and 40
    and char_length(coalesce(amount, '')) <= 40 and char_length(coalesce(note, '')) <= 500
    and char_length(coalesce(learner_name, '')) <= 120 and char_length(coalesce(learner_email, '')) <= 254
  )
);
-- a transaction id counts once; a rejected one may be entered again (a typo, or a wrong rejection)
create unique index if not exists payments_trx_once on public.payments (upper(trx_id)) where status <> 'rejected';
-- one payment in play per learner per entry
create unique index if not exists payments_one_open on public.payments (user_id, course_id) where status in ('pending', 'confirmed');
create index if not exists idx_payments_status on public.payments (status, created_at desc);
create index if not exists idx_payments_course on public.payments (course_id);

alter table public.payments enable row level security;

drop policy if exists "own or admin read" on public.payments;
create policy "own or admin read" on public.payments
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "submit own payment" on public.payments;
create policy "submit own payment" on public.payments
  for insert to authenticated
  with check (
    user_id = (select auth.uid()) and not (select public.is_admin())
    and status = 'pending' and method = 'bkash'
    and note is null and reviewed_at is null and reviewed_by is null
    and exists (select 1 from public.courses c where c.id = payments.course_id and c.status = 'published')
  );

drop policy if exists "admins manage" on public.payments;
create policy "admins manage" on public.payments
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- a learner who typed it wrong can take a payment back while it is still waiting
drop policy if exists "withdraw own pending" on public.payments;
create policy "withdraw own pending" on public.payments
  for delete to authenticated using (user_id = (select auth.uid()) and status = 'pending');

grant select, insert, update, delete on public.payments to authenticated;

-- tidies what was typed, and stops the form being hammered
create or replace function public.tidy_payment()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.trx_id := upper(regexp_replace(coalesce(new.trx_id, ''), '\s', '', 'g'));
  if new.method = 'bkash' then
    new.sender := regexp_replace(coalesce(new.sender, ''), '[^0-9+]', '', 'g');
  end if;
  if public.is_admin() then return new; end if;
  if (select count(*) from public.payments p where p.user_id = new.user_id and p.created_at > now() - interval '1 day') >= 6 then
    raise exception 'too many attempts today — please write to us and we will sort it out';
  end if;
  return new;
end;
$$;
drop trigger if exists tidy_payment on public.payments;
create trigger tidy_payment before insert on public.payments
  for each row execute function public.tidy_payment();
revoke execute on function public.tidy_payment() from public, anon, authenticated;

-- An admin's decision on a payment. Confirming also puts the learner on the entry's list.
create or replace function public.review_payment(p_payment uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_pay public.payments;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
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
revoke all on function public.review_payment(uuid, text, text) from public, anon;
grant execute on function public.review_payment(uuid, text, text) to authenticated;

-- Access without a bKash payment (paid in cash, a scholarship, a team member): by the learner's email.
create or replace function public.grant_course_access(p_email text, p_course text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_user auth.users;
  v_admin text;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
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
revoke all on function public.grant_course_access(text, text) from public, anon;
grant execute on function public.grant_course_access(text, text) to authenticated;

-- An entry is open to someone when it is free, or they have a confirmed payment for it.
-- (replaces the version in part 6, which read a list kept in site_text)
create or replace function public.course_open_to_me(p_course text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_fee jsonb;
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
  return exists (select 1 from public.payments p where p.user_id = v_uid and p.course_id = p_course and p.status = 'confirmed');
end;
$$;

-- Joining an entry's list: free entries as before; paid ones only once the payment is confirmed.
alter policy "enrol self" on public.enrollments
  with check (
    user_id = (select auth.uid()) and not (select public.is_admin())
    and exists (select 1 from public.courses c where c.id = enrollments.course_id and c.status = 'published')
    and public.course_open_to_me(enrollments.course_id)
  );

notify pgrst, 'reload schema';
