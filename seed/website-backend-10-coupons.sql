-- ════════════════════════════════════════════════
-- Amaze Consortium public website — backend, part 10: coupons
-- Run AFTER parts 1–9. Safe to run more than once. (Already applied.)
-- ════════════════════════════════════════════════
-- A coupon is a code that lowers the fee of a paid course, program or webinar.
-- An admin makes one in the panel (academy → coupons): the code is generated,
-- the admin chooses what it is worth (a percentage, or an amount of money),
-- when it starts and stops working, and whether it is for everything or one entry.
--
-- Learners never see the list of coupons. Their payment page asks check_coupon()
-- about the one code they typed. And when a payment is submitted the database
-- works out the amount itself — the price from the admin panel, minus the coupon
-- if it is valid at that moment — so the amount an admin is shown to match against
-- bKash cannot be made up in a browser.

create table if not exists public.coupons (
  code        text primary key,
  kind        text not null default 'percent',
  value       numeric not null,
  starts_at   timestamptz,                          -- empty: works from the moment it is made
  ends_at     timestamptz,                          -- empty: works until it is switched off
  course_id   text references public.courses(id) on update cascade on delete cascade,   -- empty: every paid entry
  is_off      boolean not null default false,       -- switched off by hand
  note        text,
  created_at  timestamptz not null default now(),
  created_by  text,
  constraint coupons_code  check (code ~ '^[A-Z0-9]{4,20}$'),
  constraint coupons_kind  check (kind in ('percent', 'amount')),
  constraint coupons_value check (value > 0 and (kind <> 'percent' or value < 100)),
  constraint coupons_dates check (starts_at is null or ends_at is null or ends_at > starts_at),
  constraint coupons_note  check (char_length(coalesce(note, '')) <= 200)
);
alter table public.coupons enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coupons' and policyname = 'admins manage coupons') then
    create policy "admins manage coupons" on public.coupons for all to authenticated
      using ((select public.admin_can('courses'))) with check ((select public.admin_can('courses')));
  end if;
end $$;

alter table public.payments add column if not exists coupon text;        -- the code used, if any
alter table public.payments add column if not exists list_amount text;   -- the fee before the coupon

-- the academy's saved settings (kept as text with the site's other wording), read safely
create or replace function public.pay_setting(p_key text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  select value::jsonb into v from public.site_text where key = p_key;
  return coalesce(v, '{}'::jsonb);
exception when others then return '{}'::jsonb;
end;
$$;
revoke all on function public.pay_setting(text) from public, anon, authenticated;

-- the fee of an entry as a number; nothing for a free entry or one with no price set
create or replace function public.course_price(p_course text)
returns numeric language plpgsql stable security definer set search_path = ''
as $$
declare own jsonb := public.pay_setting('pay.course.' || p_course); raw text;
begin
  if own->>'paid' = 'false' then return null; end if;
  raw := coalesce(nullif(trim(own->>'price'), ''), nullif(trim(public.pay_setting('pay.settings')->>'price'), ''));
  return nullif(regexp_replace(coalesce(raw, ''), '[^0-9.]', '', 'g'), '')::numeric;
exception when others then return null;
end;
$$;
revoke all on function public.course_price(text) from public, anon, authenticated;

-- an amount written the way the site writes it: ৳250
create or replace function public.pay_money(p_amount numeric)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare cur text := coalesce(nullif(trim(public.pay_setting('pay.settings')->>'currency'), ''), '৳');
        txt text := regexp_replace(regexp_replace(trim(to_char(p_amount, 'FM999999990.00')), '0+$', ''), '\.$', '');
begin
  return lower(case when cur ~ '^[A-Za-z]' then cur || ' ' || txt else cur || txt end);
end;
$$;
revoke all on function public.pay_money(numeric) from public, anon, authenticated;

-- is this code good for this entry right now, and what does the fee become?
create or replace function public.coupon_result(p_code text, p_course text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_code  text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  c       public.coupons;
  v_price numeric := public.course_price(p_course);
  v_pay   numeric;
begin
  if v_code !~ '^[A-Z0-9]{4,20}$' then return jsonb_build_object('ok', false, 'why', 'unknown'); end if;
  select * into c from public.coupons where code = v_code;
  if c.code is null then return jsonb_build_object('ok', false, 'why', 'unknown'); end if;
  if c.is_off then return jsonb_build_object('ok', false, 'why', 'ended'); end if;
  if c.starts_at is not null and now() < c.starts_at then return jsonb_build_object('ok', false, 'why', 'not_yet', 'starts_at', c.starts_at); end if;
  if c.ends_at is not null and now() >= c.ends_at then return jsonb_build_object('ok', false, 'why', 'ended'); end if;
  if c.course_id is not null and c.course_id <> p_course then return jsonb_build_object('ok', false, 'why', 'other_course'); end if;
  if v_price is null then return jsonb_build_object('ok', false, 'why', 'no_price'); end if;
  v_pay := case when c.kind = 'percent' then round(v_price * (100 - c.value) / 100) else v_price - c.value end;
  if v_pay < 1 then return jsonb_build_object('ok', false, 'why', 'too_big'); end if;
  return jsonb_build_object('ok', true, 'code', c.code, 'kind', c.kind, 'value', c.value, 'ends_at', c.ends_at,
    'price', v_price, 'pay', v_pay, 'price_label', public.pay_money(v_price), 'pay_label', public.pay_money(v_pay), 'saved_label', public.pay_money(v_price - v_pay));
end;
$$;
revoke all on function public.coupon_result(text, text) from public, anon, authenticated;

-- what the payment page asks about the code a learner typed
create or replace function public.check_coupon(p_code text, p_course text)
returns jsonb language sql stable security definer set search_path = ''
as $$ select public.coupon_result(p_code, p_course); $$;
revoke all on function public.check_coupon(text, text) from public;
grant execute on function public.check_coupon(text, text) to anon, authenticated;

-- a payment as it is stored: tidied, limited — and with its amount worked out here
create or replace function public.tidy_payment()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_price numeric;
  v_cut   jsonb;
begin
  new.trx_id := upper(regexp_replace(coalesce(new.trx_id, ''), '\s', '', 'g'));
  if new.method = 'bkash' then
    new.sender := regexp_replace(coalesce(new.sender, ''), '[^0-9+]', '', 'g');
  end if;
  new.coupon := nullif(upper(regexp_replace(coalesce(new.coupon, ''), '\s', '', 'g')), '');
  if public.is_admin() then return new; end if;
  if (select count(*) from public.payments p where p.user_id = new.user_id and p.created_at > now() - interval '1 day') >= 6 then
    raise exception 'too many attempts today — please write to us and we will sort it out';
  end if;
  -- the amount is the entry's price (less a coupon that is valid now), whatever the browser sent
  v_price := public.course_price(new.course_id);
  new.list_amount := null;
  if new.coupon is not null then
    v_cut := public.coupon_result(new.coupon, new.course_id);
    if not (v_cut->>'ok')::boolean then raise exception 'coupon_refused:%', v_cut->>'why'; end if;
    new.amount := v_cut->>'pay_label';
    new.list_amount := v_cut->>'price_label';
  elsif v_price is not null then
    new.amount := public.pay_money(v_price);
  end if;
  return new;
end;
$$;
