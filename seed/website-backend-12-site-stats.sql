-- ═══════════════════════════════════════════════════════════════════════════
--  website statistics — visitors, countries, popular pages, buttons pressed
--
--  Run once in supabase → sql editor. Safe to run again.
--
--  Only COUNTS are kept: "on this day, this page was opened 14 times". Nothing
--  about a person is stored — no ip address, no cookie, no name. That keeps the
--  table tiny (it fits the free plan for years) and the visitors private.
--
--    site_daily            one row per day, per thing counted
--    site_seen(events)     the website calls this to add to the counts
--    site_report(from,to)  the admin panel's reports screen reads this
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.site_daily (
  day  date not null,
  kind text not null,              -- visitor | visit | view | click | ref | entry | device | browser | new | country
  key  text not null default '',   -- the page, the button, the country code …
  n    integer not null default 0,
  primary key (day, kind, key)
);
alter table public.site_daily enable row level security;
-- no policies on purpose: nobody reads or writes the table directly, only through the two functions below
revoke all on public.site_daily from anon, authenticated;

-- The website adds to the counts. Anyone may call it (visitors are not signed in), so it is
-- strict about what it accepts: known kinds only, short keys, a few events per call, and a
-- ceiling on how many different keys one day can hold.
create or replace function public.site_seen(p_events jsonb, p_country text default '')
returns void language plpgsql security definer set search_path = public as $$
declare
  d   date := (now() at time zone 'Asia/Dhaka')::date;
  e   jsonb;
  k   text;
  v   text;
  i   int := 0;
  cc  text := '';
  cap int;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' then return; end if;
  -- the country comes from the network in front of the database when it says so, else from the website
  begin cc := coalesce(current_setting('request.headers', true)::json ->> 'cf-ipcountry', ''); exception when others then cc := ''; end;
  if cc !~* '^[a-z]{2}$' or upper(cc) in ('XX', 'T1') then cc := coalesce(p_country, ''); end if;
  cc := case when cc ~* '^[a-z]{2}$' and upper(cc) not in ('XX', 'T1') then upper(cc) else '??' end;

  for e in select * from jsonb_array_elements(p_events) loop
    i := i + 1; exit when i > 12;
    k := e ->> 'k';
    if k is null or k not in ('visitor', 'visit', 'view', 'click', 'ref', 'entry', 'device', 'browser', 'new', 'country') then continue; end if;
    v := btrim(regexp_replace(left(coalesce(e ->> 'v', ''), 140), '[[:cntrl:]]', ' ', 'g'));
    if k in ('visitor', 'visit') then v := '';
    elsif k = 'country' then v := cc;
    elsif k = 'device' then v := case when v in ('phone', 'tablet', 'computer') then v else 'computer' end;
    elsif k = 'new' then v := case when v = 'new' then 'new' else 'returning' end;
    elsif v = '' then continue;
    end if;
    -- a day cannot grow without end: past the ceiling, new keys are counted together
    cap := case k when 'click' then 1500 when 'view' then 600 when 'entry' then 600 when 'ref' then 300 when 'browser' then 40 else 300 end;
    if not exists (select 1 from site_daily where day = d and kind = k and key = v)
       and (select count(*) from site_daily where day = d and kind = k) >= cap then v := '(everything else)'; end if;
    insert into site_daily (day, kind, key, n) values (d, k, v, 1)
      on conflict (day, kind, key) do update set n = site_daily.n + 1;
  end loop;
end $$;
revoke all on function public.site_seen(jsonb, text) from public;
grant execute on function public.site_seen(jsonb, text) to anon, authenticated;

-- The reports screen. Only an admin who may see learners & payments (the same admins who see
-- the academy report) gets an answer.
create or replace function public.site_report(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today  date := (now() at time zone 'Asia/Dhaka')::date;
  v_first  date;
  a      date;
  b      date;
  v_days   int;
  pa     date;
  pb     date;
  v_step   text;
  res    jsonb;
begin
  if not public.admin_can('learners') then raise exception 'not allowed'; end if;
  select min(day) into v_first from site_daily;
  b := least(coalesce(p_to, v_today), v_today);
  a := coalesce(p_from, v_first, b);
  if a > b then a := b; end if;
  v_days := b - a + 1;
  v_step := case when v_days > 92 then 'month' else 'day' end;
  if p_from is not null then pb := a - 1; pa := a - v_days; end if;

  select jsonb_build_object(
    'since', v_first, 'from', a, 'to', b, 'step', v_step,
    'now', (select jsonb_build_object(
        'visitors', coalesce(sum(n) filter (where kind = 'visitor'), 0), 'visits', coalesce(sum(n) filter (where kind = 'visit'), 0),
        'views', coalesce(sum(n) filter (where kind = 'view'), 0), 'clicks', coalesce(sum(n) filter (where kind = 'click'), 0),
        'fresh', coalesce(sum(n) filter (where kind = 'new' and key = 'new'), 0))
      from site_daily where day between a and b),
    'before', case when pa is null or v_first is null or pb < v_first then null else (select jsonb_build_object(
        'visitors', coalesce(sum(n) filter (where kind = 'visitor'), 0), 'visits', coalesce(sum(n) filter (where kind = 'visit'), 0),
        'views', coalesce(sum(n) filter (where kind = 'view'), 0), 'clicks', coalesce(sum(n) filter (where kind = 'click'), 0),
        'fresh', coalesce(sum(n) filter (where kind = 'new' and key = 'new'), 0))
      from site_daily where day between pa and pb) end,
    'series', (select coalesce(jsonb_agg(jsonb_build_object('d', g.d, 'visitors', coalesce(s.visitors, 0), 'visits', coalesce(s.visits, 0), 'views', coalesce(s.views, 0), 'clicks', coalesce(s.clicks, 0)) order by g.d), '[]'::jsonb)
      from (select generate_series(date_trunc(v_step, a::timestamp), date_trunc(v_step, b::timestamp), ('1 ' || v_step)::interval)::date as d) g
      left join (select date_trunc(v_step, day::timestamp)::date as d,
          sum(n) filter (where kind = 'visitor') as visitors, sum(n) filter (where kind = 'visit') as visits,
          sum(n) filter (where kind = 'view') as views, sum(n) filter (where kind = 'click') as clicks
        from site_daily where day between a and b group by 1) s on s.d = g.d),
    'pages',     (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'n', n) order by n desc, key), '[]'::jsonb) from (select key, sum(n) as n from site_daily where day between a and b and kind = 'view'    group by key order by 2 desc, 1 limit 25) t),
    'entries',   (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'n', n) order by n desc, key), '[]'::jsonb) from (select key, sum(n) as n from site_daily where day between a and b and kind = 'entry'   group by key order by 2 desc, 1 limit 10) t),
    'countries', (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'n', n) order by n desc, key), '[]'::jsonb) from (select key, sum(n) as n from site_daily where day between a and b and kind = 'country' group by key order by 2 desc, 1 limit 40) t),
    'clicks',    (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'n', n) order by n desc, key), '[]'::jsonb) from (select key, sum(n) as n from site_daily where day between a and b and kind = 'click'   group by key order by 2 desc, 1 limit 40) t),
    'refs',      (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'n', n) order by n desc, key), '[]'::jsonb) from (select key, sum(n) as n from site_daily where day between a and b and kind = 'ref'     group by key order by 2 desc, 1 limit 15) t),
    'devices',   (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'n', n) order by n desc, key), '[]'::jsonb) from (select key, sum(n) as n from site_daily where day between a and b and kind = 'device'  group by key) t),
    'browsers',  (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'n', n) order by n desc, key), '[]'::jsonb) from (select key, sum(n) as n from site_daily where day between a and b and kind = 'browser' group by key order by 2 desc, 1 limit 8) t)
  ) into res;
  return res;
end $$;
revoke all on function public.site_report(date, date) from public, anon;
grant execute on function public.site_report(date, date) to authenticated;
