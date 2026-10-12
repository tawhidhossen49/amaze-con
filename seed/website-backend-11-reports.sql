-- ════════════════════════════════════════════════
-- Amaze Consortium public website — backend, part 11: reports
-- Run AFTER parts 1–10. Safe to run more than once. (Already applied.)
-- ════════════════════════════════════════════════
-- What the admin panel's "reports" screen is built on. Three things:
--
--   academy_daily    how many times the academy's pages were opened, per day. Counters only —
--                    no person, device or address is stored. A page adds one per browser
--                    session through academy_seen().
--   activity_log     a line for everything that happens in the academy: a learner enrols,
--                    pays, finishes, earns a certificate; an admin confirms a payment, makes a
--                    course, changes a price, the bkash number or who the admins are.
--                    Written by the database itself (triggers), so nothing in a browser can
--                    add, change or skip a line.
--   academy_report() every number and chart of the reports screen for one period, worked
--                    out in the database in one go.
--
-- Reports show learners' names and money, so they are for main admins and for limited
-- admins who were given "learners & payments".

-- ── visits ───────────────────────────────────────────────────────────────────
create table if not exists public.academy_daily (
  day        date not null,
  kind       text not null,           -- catalog_view | course_view | pay_view | lesson_view
  course_id  text not null default '',
  n          integer not null default 0,
  primary key (day, kind, course_id),
  constraint academy_daily_kind check (kind in ('catalog_view', 'course_view', 'pay_view', 'lesson_view'))
);
alter table public.academy_daily enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'academy_daily' and policyname = 'admins read visits') then
    create policy "admins read visits" on public.academy_daily for select to authenticated using ((select public.admin_can('learners')));
  end if;
end $$;

-- a page says "i was opened" (admins looking at their own site are not counted)
create or replace function public.academy_seen(p_kind text, p_course text default '')
returns void language plpgsql security definer set search_path = ''
as $$
declare v_course text := coalesce(p_course, '');
begin
  if p_kind not in ('catalog_view', 'course_view', 'pay_view', 'lesson_view') then return; end if;
  if public.is_admin() then return; end if;
  if p_kind = 'catalog_view' then v_course := '';
  elsif not exists (select 1 from public.courses c where c.id = v_course and c.status = 'published') then return; end if;
  insert into public.academy_daily (day, kind, course_id, n)
  values ((now() at time zone 'Asia/Dhaka')::date, p_kind, v_course, 1)
  on conflict (day, kind, course_id) do update set n = public.academy_daily.n + 1;
end;
$$;
revoke all on function public.academy_seen(text, text) from public;
grant execute on function public.academy_seen(text, text) to anon, authenticated;

-- ── the activity log ─────────────────────────────────────────────────────────
create table if not exists public.activity_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  kind        text not null,          -- money | learner | content | admin
  actor       text not null,          -- a learner's name, or an admin's email
  actor_kind  text not null,          -- learner | admin | system
  what        text not null,          -- "enrolled in public speaking advancement"
  course_id   text
);
create index if not exists idx_activity_log_at on public.activity_log (at desc);
alter table public.activity_log enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'activity_log' and policyname = 'admins read the log') then
    create policy "admins read the log" on public.activity_log for select to authenticated using ((select public.admin_can('learners')));
  end if;
end $$;

create or replace function public.log_activity()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_admin  boolean := false;
  v_me     text;                 -- the signed-in person's email
  v_kind   text;  v_actor text;  v_akind text;  v_what text;  v_course text;  v_title text;
  o jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  n jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  a jsonb;  b jsonb;
begin
  if v_uid is not null then
    select email into v_me from auth.users where id = v_uid;
    v_admin := public.is_admin();
  end if;
  v_actor := coalesce(v_me, 'the system');
  v_akind := case when v_uid is null then 'system' when v_admin then 'admin' else 'learner' end;
  v_course := case when tg_table_name = 'courses' then r->>'id' when tg_table_name in ('admins', 'coupons', 'site_text') then null else r->>'course_id' end;
  if tg_table_name = 'site_text' and (r->>'key') like 'pay.course.%' then v_course := substr(r->>'key', 12); end if;
  if v_course is not null then select title into v_title from public.courses where id = v_course; end if;
  -- rows that disappear because their course was deleted are not listed one by one
  if tg_op = 'DELETE' and tg_table_name not in ('courses', 'admins', 'coupons') and v_title is null then return null; end if;
  v_title := coalesce(v_title, r->>'title', v_course, '');

  if tg_table_name = 'enrollments' then
    v_kind := 'learner';
    if tg_op = 'INSERT' then
      v_actor := coalesce(nullif(n->>'learner_name', ''), n->>'learner_email', v_actor); v_akind := 'learner';
      v_what := 'enrolled in ' || v_title;
    elsif tg_op = 'UPDATE' then
      if (o->>'completed_at') is not null or (n->>'completed_at') is null then return null; end if;
      v_actor := coalesce(nullif(n->>'learner_name', ''), n->>'learner_email', v_actor); v_akind := 'learner';
      v_what := 'finished ' || v_title;
    elsif v_admin then v_kind := 'admin'; v_what := 'removed ' || coalesce(nullif(o->>'learner_name', ''), o->>'learner_email', 'a learner') || ' from ' || v_title;
    else v_what := 'left ' || v_title; v_actor := coalesce(nullif(o->>'learner_name', ''), o->>'learner_email', v_actor);
    end if;

  elsif tg_table_name = 'payments' then
    v_kind := 'money';
    if tg_op = 'INSERT' then
      if n->>'method' = 'manual' then v_what := 'let ' || coalesce(nullif(n->>'learner_name', ''), n->>'learner_email', 'a learner') || ' into ' || v_title || ' without a bkash payment';
      else
        v_actor := coalesce(nullif(n->>'learner_name', ''), n->>'learner_email', v_actor); v_akind := 'learner';
        v_what := 'sent a payment of ' || coalesce(n->>'amount', '?') || ' for ' || v_title || case when (n->>'coupon') is not null then ' with the coupon ' || (n->>'coupon') else '' end;
      end if;
    elsif tg_op = 'UPDATE' then
      if (o->>'status') is not distinct from (n->>'status') then return null; end if;
      v_what := case n->>'status' when 'confirmed' then 'confirmed' when 'rejected' then 'rejected' else 'reopened' end
        || ' the payment of ' || coalesce(n->>'amount', '?') || ' from ' || coalesce(nullif(n->>'learner_name', ''), n->>'learner_email', 'a learner') || ' for ' || v_title;
    else
      if v_admin then return null; end if;
      v_actor := coalesce(nullif(o->>'learner_name', ''), o->>'learner_email', v_actor);
      v_what := 'took back their payment for ' || v_title || ' to correct it';
    end if;

  elsif tg_table_name = 'certificates' then
    v_kind := 'learner';
    if tg_op = 'INSERT' then v_actor := coalesce(nullif(n->>'learner_name', ''), v_actor); v_akind := 'learner'; v_what := 'earned the certificate for ' || v_title;
    elsif tg_op = 'DELETE' then v_kind := 'admin'; v_what := 'revoked the certificate of ' || coalesce(o->>'learner_name', 'a learner') || ' for ' || v_title;
    else return null; end if;

  elsif tg_table_name = 'course_reviews' then
    if tg_op <> 'INSERT' then return null; end if;
    v_kind := 'learner'; v_actor := coalesce(nullif(n->>'author_name', ''), v_actor); v_akind := 'learner';
    v_what := 'rated ' || v_title || ' ' || (n->>'rating') || ' out of 5';

  elsif tg_table_name = 'lesson_comments' then
    if tg_op <> 'INSERT' then return null; end if;
    if (n->>'is_staff')::boolean then v_kind := 'admin'; v_what := 'answered a question in ' || v_title;
    elsif (n->>'parent_id') is null then v_kind := 'learner'; v_actor := coalesce(nullif(n->>'author_name', ''), v_actor); v_what := 'asked a question in ' || v_title;
    else return null; end if;

  elsif tg_table_name = 'courses' then
    v_kind := 'content';
    if tg_op = 'INSERT' then v_what := 'made the ' || coalesce(n->>'kind', 'course') || ' ' || v_title;
    elsif tg_op = 'DELETE' then v_what := 'deleted the ' || coalesce(o->>'kind', 'course') || ' ' || v_title;
    elsif (o->>'status') is distinct from (n->>'status') then v_what := case when n->>'status' = 'published' then 'published ' || v_title || ' — it is on the website' else 'took ' || v_title || ' off the website' end;
    elsif (o->>'title') is distinct from (n->>'title') then v_what := 'renamed ' || (o->>'title') || ' to ' || (n->>'title');
    else return null; end if;

  elsif tg_table_name = 'course_lessons' then
    v_kind := 'content';
    if tg_op = 'INSERT' then v_what := 'added the ' || case n->>'kind' when 'live' then 'live class' when 'article' then 'reading' when 'form' then 'test' else n->>'kind' end || ' “' || (n->>'title') || '” to ' || v_title;
    elsif tg_op = 'DELETE' then v_what := 'deleted the lesson “' || (o->>'title') || '” from ' || v_title;
    elsif (o->>'live_at') is distinct from (n->>'live_at') and n->>'kind' = 'live' then
      v_what := case when (n->>'live_at') is null then 'took the date off the live class “' || (n->>'title') || '”' else 'set the live class “' || (n->>'title') || '” in ' || v_title || ' to ' || to_char((n->>'live_at')::timestamptz at time zone 'Asia/Dhaka', 'DD Mon YYYY, HH12:MI am') end;
    else return null; end if;

  elsif tg_table_name = 'coupons' then
    v_kind := 'money';
    if tg_op = 'INSERT' then v_what := 'made the coupon ' || (n->>'code') || ' — ' || case when n->>'kind' = 'percent' then trim(to_char((n->>'value')::numeric, 'FM999990.##')) || '% off' else public.pay_money((n->>'value')::numeric) || ' off' end;
    elsif tg_op = 'DELETE' then v_what := 'deleted the coupon ' || (o->>'code');
    elsif (o->>'is_off') is distinct from (n->>'is_off') then v_what := case when (n->>'is_off')::boolean then 'switched off' else 'switched on' end || ' the coupon ' || (n->>'code');
    else return null; end if;

  elsif tg_table_name = 'admins' then
    v_kind := 'admin';
    if tg_op = 'INSERT' then v_what := 'added ' || (n->>'email') || ' as an admin';
    elsif tg_op = 'DELETE' then v_what := 'removed ' || (o->>'email') || ' as an admin';
    elsif (o->>'role') is distinct from (n->>'role') or (o->'access') is distinct from (n->'access') then
      v_what := 'made ' || (n->>'email') || case when n->>'role' = 'main' then ' a main admin' else ' a limited admin' end;
    else return null; end if;

  elsif tg_table_name = 'site_text' then
    if tg_op = 'DELETE' then return null; end if;
    begin a := case when o is null then '{}'::jsonb else (o->>'value')::jsonb end; b := (n->>'value')::jsonb; exception when others then return null; end;
    if n->>'key' = 'pay.settings' then
      v_kind := 'money';
      if (a->>'bkash') is distinct from (b->>'bkash') then v_what := 'changed the bkash number learners pay to — now ' || coalesce(nullif(b->>'bkash', ''), 'none');
      elsif (a->>'whatsapp') is distinct from (b->>'whatsapp') then v_kind := 'admin'; v_what := 'changed the whatsapp help number — now ' || coalesce(nullif(b->>'whatsapp', ''), 'none');
      else return null; end if;
    elsif (n->>'key') like 'pay.course.%' then
      v_kind := 'money';
      if coalesce(a->>'paid', 'true') is distinct from coalesce(b->>'paid', 'true') then v_what := 'made ' || v_title || case when b->>'paid' = 'false' then ' free' else ' paid' end;
      elsif coalesce(a->>'price', '') is distinct from coalesce(b->>'price', '') then v_what := 'set the price of ' || v_title || ' to ' || coalesce(nullif(b->>'price', ''), 'the general price');
      else return null; end if;
    else return null; end if;
  else return null;
  end if;

  insert into public.activity_log (kind, actor, actor_kind, what, course_id)
  values (v_kind, left(v_actor, 160), v_akind, left(v_what, 400), case when exists (select 1 from public.courses where id = v_course) then v_course end);
  return null;
exception when others then
  return null;   -- writing the log must never stop the thing being logged
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['enrollments', 'payments', 'certificates', 'course_reviews', 'lesson_comments', 'courses', 'course_lessons', 'coupons', 'admins', 'site_text'] loop
    execute format('create or replace trigger log_activity after insert or update or delete on public.%I for each row execute function public.log_activity()', t);
  end loop;
end $$;

-- what already happened before the log existed, as far as the tables still show it
do $$ begin
  if not exists (select 1 from public.activity_log) then
    insert into public.activity_log (at, kind, actor, actor_kind, what, course_id)
    select * from (
      select e.enrolled_at as at, 'learner' as kind, coalesce(nullif(e.learner_name, ''), e.learner_email, 'a learner') as actor, 'learner' as actor_kind, 'enrolled in ' || c.title as what, e.course_id
        from public.enrollments e join public.courses c on c.id = e.course_id
      union all select e.completed_at, 'learner', coalesce(nullif(e.learner_name, ''), e.learner_email, 'a learner'), 'learner', 'finished ' || c.title, e.course_id
        from public.enrollments e join public.courses c on c.id = e.course_id where e.completed_at is not null
      union all select p.created_at, 'money', coalesce(nullif(p.learner_name, ''), p.learner_email, 'a learner'), 'learner', 'sent a payment of ' || coalesce(p.amount, '?') || ' for ' || c.title, p.course_id
        from public.payments p join public.courses c on c.id = p.course_id where p.method = 'bkash'
      union all select p.reviewed_at, 'money', coalesce(p.reviewed_by, 'an admin'), 'admin', p.status || ' the payment of ' || coalesce(p.amount, '?') || ' from ' || coalesce(nullif(p.learner_name, ''), p.learner_email, 'a learner') || ' for ' || c.title, p.course_id
        from public.payments p join public.courses c on c.id = p.course_id where p.reviewed_at is not null and p.status in ('confirmed', 'rejected') and p.method = 'bkash'
      union all select k.issued_at, 'learner', coalesce(nullif(k.learner_name, ''), 'a learner'), 'learner', 'earned the certificate for ' || c.title, k.course_id
        from public.certificates k join public.courses c on c.id = k.course_id
      union all select v.created_at, 'learner', coalesce(nullif(v.author_name, ''), 'a learner'), 'learner', 'rated ' || c.title || ' ' || v.rating || ' out of 5', v.course_id
        from public.course_reviews v join public.courses c on c.id = v.course_id
    ) x where x.at is not null order by x.at;
  end if;
end $$;

-- ── the report ───────────────────────────────────────────────────────────────
create or replace function public.pay_number(p_amount text)
returns numeric language sql immutable set search_path = ''
as $$ select nullif(regexp_replace(coalesce(p_amount, ''), '[^0-9.]', '', 'g'), '')::numeric; $$;

-- the headline numbers of one stretch of time
create or replace function public.academy_totals(p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'revenue',      coalesce((select sum(public.pay_number(amount)) from public.payments where status = 'confirmed' and method = 'bkash' and reviewed_at >= p_from and reviewed_at < p_to), 0),
    'paid',         (select count(*) from public.payments where status = 'confirmed' and method = 'bkash' and reviewed_at >= p_from and reviewed_at < p_to),
    'enrolments',   (select count(*) from public.enrollments where enrolled_at >= p_from and enrolled_at < p_to),
    'new_learners', (select count(*) from (select user_id, min(enrolled_at) as first from public.enrollments group by user_id) f where f.first >= p_from and f.first < p_to),
    'signups',      (select count(*) from auth.users u where u.created_at >= p_from and u.created_at < p_to and public.is_learner_account(u)),
    'active',       (select count(distinct user_id) from public.lesson_progress where completed_at >= p_from and completed_at < p_to),
    'lessons_done', (select count(*) from public.lesson_progress where completed_at >= p_from and completed_at < p_to),
    'finished',     (select count(*) from public.enrollments where completed_at >= p_from and completed_at < p_to),
    'certificates', (select count(*) from public.certificates where issued_at >= p_from and issued_at < p_to),
    'reviews',      (select count(*) from public.course_reviews where created_at >= p_from and created_at < p_to),
    'rating',       (select round(avg(rating)::numeric, 1) from public.course_reviews where created_at >= p_from and created_at < p_to and not is_hidden),
    'questions',    (select count(*) from public.lesson_comments where parent_id is null and not is_staff and created_at >= p_from and created_at < p_to),
    'discounts',    coalesce((select sum(public.pay_number(list_amount) - public.pay_number(amount)) from public.payments where status = 'confirmed' and coupon is not null and reviewed_at >= p_from and reviewed_at < p_to), 0),
    'visits',       coalesce((select sum(n) from public.academy_daily where kind = 'course_view' and day >= (p_from at time zone 'Asia/Dhaka')::date and day <= ((p_to - interval '1 second') at time zone 'Asia/Dhaka')::date), 0)
  );
$$;
revoke all on function public.academy_totals(timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.academy_report(p_from timestamptz default null, p_to timestamptz default null, p_tz text default 'Asia/Dhaka')
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tz    text := case when exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz) then p_tz else 'Asia/Dhaka' end;
  v_to    timestamptz := coalesce(p_to, now());
  v_first timestamptz := least(coalesce((select min(enrolled_at) from public.enrollments), now()), coalesce((select min(created_at) from public.payments), now()), coalesce((select min(created_at) from public.courses), now()));
  v_from  timestamptz := coalesce(p_from, v_first);
  v_len   interval;
  v_step  text;
  v_out   jsonb;
begin
  if not public.admin_can('learners') then raise exception 'you do not have access to reports'; end if;
  if v_from >= v_to then v_from := v_to - interval '1 day'; end if;
  v_len := v_to - v_from;
  v_step := case when v_len <= interval '93 days' then 'day' else 'month' end;

  with buckets as (
    select g as b from generate_series(date_trunc(v_step, v_from at time zone v_tz), date_trunc(v_step, (v_to - interval '1 second') at time zone v_tz), ('1 ' || v_step)::interval) g
  ),
  en as (select date_trunc(v_step, enrolled_at at time zone v_tz) as b, count(*) as n from public.enrollments where enrolled_at >= v_from and enrolled_at < v_to group by 1),
  pm as (select date_trunc(v_step, reviewed_at at time zone v_tz) as b, sum(public.pay_number(amount)) as n from public.payments where status = 'confirmed' and method = 'bkash' and reviewed_at >= v_from and reviewed_at < v_to group by 1),
  lp as (select date_trunc(v_step, completed_at at time zone v_tz) as b, count(*) as n from public.lesson_progress where completed_at >= v_from and completed_at < v_to group by 1),
  vs as (select date_trunc(v_step, day::timestamp) as b, sum(n) as n from public.academy_daily where kind = 'course_view' and day >= (v_from at time zone v_tz)::date and day <= ((v_to - interval '1 second') at time zone v_tz)::date group by 1),
  series as (
    select jsonb_agg(jsonb_build_object('d', to_char(k.b, 'YYYY-MM-DD'), 'enrolments', coalesce(en.n, 0), 'revenue', coalesce(pm.n, 0), 'lessons', coalesce(lp.n, 0), 'visits', coalesce(vs.n, 0)) order by k.b) as j
    from buckets k left join en on en.b = k.b left join pm on pm.b = k.b left join lp on lp.b = k.b left join vs on vs.b = k.b
  ),
  courses as (
    select c.id, c.title, coalesce(c.kind, 'course') as kind, c.status, c.sort_order,
      (select count(*) from public.course_lessons l join public.course_modules m on m.id = l.module_id where l.course_id = c.id and not l.is_hidden and not m.is_hidden) as lessons,
      (select count(*) from public.enrollments e where e.course_id = c.id) as enrolled,
      (select count(*) from public.enrollments e where e.course_id = c.id and e.enrolled_at >= v_from and e.enrolled_at < v_to) as joined,
      (select count(*) from public.enrollments e where e.course_id = c.id and e.completed_at is not null) as finished,
      (select count(*) from public.lesson_progress p where p.course_id = c.id) as done,
      (select count(*) from public.payments p where p.course_id = c.id and p.status = 'confirmed' and p.method = 'bkash' and p.reviewed_at >= v_from and p.reviewed_at < v_to) as paid,
      coalesce((select sum(public.pay_number(p.amount)) from public.payments p where p.course_id = c.id and p.status = 'confirmed' and p.method = 'bkash' and p.reviewed_at >= v_from and p.reviewed_at < v_to), 0) as revenue,
      (select count(*) from public.payments p where p.course_id = c.id and p.status = 'pending') as waiting,
      coalesce((select sum(d.n) from public.academy_daily d where d.course_id = c.id and d.kind = 'course_view' and d.day >= (v_from at time zone v_tz)::date and d.day <= ((v_to - interval '1 second') at time zone v_tz)::date), 0) as views,
      (select round(avg(r.rating)::numeric, 1) from public.course_reviews r where r.course_id = c.id and not r.is_hidden) as rating,
      (select count(*) from public.course_reviews r where r.course_id = c.id and not r.is_hidden) as reviews,
      public.course_price(c.id) as price
    from public.courses c
  ),
  by_course as (
    select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'kind', kind, 'status', status, 'lessons', lessons, 'enrolled', enrolled, 'joined', joined, 'finished', finished,
      'progress', case when enrolled > 0 and lessons > 0 then round(100.0 * done / (enrolled * lessons)) else null end,
      'paid', paid, 'revenue', revenue, 'waiting', waiting, 'views', views, 'rating', rating, 'reviews', reviews, 'price', price) order by revenue desc, joined desc, enrolled desc, sort_order) as j
    from courses
  ),
  -- how many learners finished each lesson, in the order the lessons come (all time)
  steps as (
    select l.course_id, jsonb_agg(jsonb_build_object('title', l.title, 'kind', l.kind, 'done', (select count(*) from public.lesson_progress p where p.lesson_id = l.id)) order by l.sort_order) as j
    from public.course_lessons l join public.course_modules m on m.id = l.module_id where not l.is_hidden and not m.is_hidden group by l.course_id
  ),
  coupons as (
    select jsonb_agg(jsonb_build_object('code', k.code, 'worth', case when k.kind = 'percent' then trim(to_char(k.value, 'FM999990.##')) || '%' else public.pay_money(k.value) end,
      'used', u.used, 'revenue', u.revenue, 'given', u.given) order by u.used desc, k.created_at desc) as j
    from public.coupons k
    cross join lateral (select count(*) as used, coalesce(sum(public.pay_number(p.amount)), 0) as revenue, coalesce(sum(public.pay_number(p.list_amount) - public.pay_number(p.amount)), 0) as given
                        from public.payments p where p.coupon = k.code and p.status = 'confirmed' and p.reviewed_at >= v_from and p.reviewed_at < v_to) u
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to, 'step', v_step, 'tz', v_tz, 'all_time', p_from is null,
    'currency', coalesce(nullif(trim(public.pay_setting('pay.settings')->>'currency'), ''), '৳'),
    'now', public.academy_totals(v_from, v_to),
    'before', case when p_from is null then null else public.academy_totals(v_from - v_len, v_from) end,
    'series', coalesce((select j from series), '[]'::jsonb),
    'courses', coalesce((select j from by_course), '[]'::jsonb),
    'steps', coalesce((select jsonb_object_agg(course_id, j) from steps), '{}'::jsonb),
    'coupons', coalesce((select j from coupons), '[]'::jsonb),
    'funnel', jsonb_build_object(
      'course_views', coalesce((select sum(n) from public.academy_daily where kind = 'course_view' and day >= (v_from at time zone v_tz)::date and day <= ((v_to - interval '1 second') at time zone v_tz)::date), 0),
      'pay_views',    coalesce((select sum(n) from public.academy_daily where kind = 'pay_view' and day >= (v_from at time zone v_tz)::date and day <= ((v_to - interval '1 second') at time zone v_tz)::date), 0),
      'sent',         (select count(*) from public.payments where method = 'bkash' and created_at >= v_from and created_at < v_to),
      'confirmed',    (select count(*) from public.payments where method = 'bkash' and status = 'confirmed' and created_at >= v_from and created_at < v_to),
      'tracking_since', (select min(day) from public.academy_daily)),
    -- things that are waiting for someone, whatever the period
    'todo', jsonb_build_object(
      'payments_waiting',  (select count(*) from public.payments where status = 'pending'),
      'payments_late',     (select count(*) from public.payments where status = 'pending' and created_at < now() - interval '24 hours'),
      'not_started',       (select count(*) from public.enrollments e where e.completed_at is null and e.enrolled_at < now() - interval '3 days' and not exists (select 1 from public.lesson_progress p where p.user_id = e.user_id and p.course_id = e.course_id)),
      'unanswered',        (select count(*) from public.lesson_comments q where q.parent_id is null and not q.is_staff and not exists (select 1 from public.lesson_comments a where a.parent_id = q.id and a.is_staff)),
      'hours_to_confirm',  (select round((percentile_cont(0.5) within group (order by extract(epoch from (reviewed_at - created_at)) / 3600))::numeric, 1) from public.payments where method = 'bkash' and status in ('confirmed', 'rejected') and reviewed_at is not null and reviewed_at >= v_from and reviewed_at < v_to))
  ) into v_out;
  return v_out;
end;
$$;
revoke all on function public.academy_report(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.academy_report(timestamptz, timestamptz, text) to authenticated;
