// ── ACADEMY ─────────────────────────────────────────────────────────────────
// One script for the five academy views, chosen by <body data-view="…">.
// An entry is a course, a program or a webinar (courses.kind); all three are
// built the same way — modules of lessons — and share every page below.
//   catalog      /academy/                          courses, programs, webinars: filter, sort, search
//   course       /academy/<course>                  overview, curriculum, reviews
//   learn        /academy/<course>/learn/<lesson>   the lesson player
//   my           /academy/my-learning               a learner's dashboard
//   certificate  /academy/certificate/<id>          to verify one  (…/certificate?c=<course> to claim one)
//   pay          /academy/<course>/pay              enrolment and payment for a paid entry
// Those addresses are folders, not files: vercel.json maps each onto the page that draws it
// (course.html, learn.html, my.html, certificate.html, pay.html). Older links that end in
// .html?c=… still open their page directly, and the page then shows the new form in the address bar.
//
// Data lives in the site's Supabase project (seed/website-backend*.sql).
// Course outlines, reviews and announcements are public; lesson content,
// notes, Q&A, enrolments, progress and certificates are gated by Row Level
// Security there, not here. Learners sign in with a free account; without
// one, progress and notes on open lessons are kept on this device.
// Every optional feature fails soft: if its table or function isn't there
// yet, that part of the page is simply left out. If the database can't be
// reached at all, the pages fall back to academy/sample.json in a read-only
// "preview" mode so they never render blank.
(function () {
  const A = window.AMAZE;
  const view = document.body.dataset.view;
  const sb = window.supabase ? window.supabase.createClient(A.url, A.key) : null;
  const params = new URLSearchParams(location.search);
  // ── addresses ──────────────────────────────────────────────────────────────
  const HOME = new URL(A.root).pathname + 'academy/';
  const U = {
    catalog: () => HOME,
    course: (id) => HOME + encodeURIComponent(id),
    learn: (id, lesson) => HOME + encodeURIComponent(id) + '/learn' + (lesson ? '/' + encodeURIComponent(lesson) : ''),
    pay: (id) => HOME + encodeURIComponent(id) + '/pay',
    my: () => HOME + 'my-learning',
    cert: (x) => (x.id ? HOME + 'certificate/' + encodeURIComponent(x.id) : HOME + 'certificate?c=' + encodeURIComponent(x.c)),
  };
  // which course / lesson / certificate this page is about: from the folders of the address,
  // or — for a link in the old form — from ?c= &l= &id=
  const Q = (() => {
    const tail = location.pathname.startsWith(HOME) ? location.pathname.slice(HOME.length) : '';
    const seg = tail.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch (e) { return x; } });
    const old = !seg.length || /\.html$/.test(seg[0]) || ['course', 'learn', 'pay', 'my', 'index'].includes(seg[0]);
    const q = { c: params.get('c') || '', l: params.get('l') || '', id: params.get('id') || '', old: /\.html$/.test(location.pathname) || !!(params.get('c') || params.get('l') || params.get('id')) };
    if (old) return q;
    if (seg[0] === 'certificate') { if (seg[1]) q.id = seg[1]; return q; }
    if (seg[0] === 'my-learning') return q;
    q.c = seg[0];
    if (seg[1] === 'learn' && seg[2]) q.l = seg[2];
    return q;
  })();
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad2 = (n) => String(n).padStart(2, '0');
  const enc = encodeURIComponent;
  const LOCAL_PROGRESS = 'amaze.lms.progress';
  const LOCAL_NOTES = 'amaze.lms.notes';
  const local = {
    get(key) { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { return {}; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} },
  };
  // optional queries: a missing table or a refused read is "nothing", not a crash
  const soft = async (query, fallback = []) => { try { const { data, error } = await query; return error || data == null ? fallback : data; } catch (e) { return fallback; } };
  const day = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).toLowerCase();
  const ago = (d) => {
    const s = (Date.now() - new Date(d)) / 1000;
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    if (s < 2592000) return `${Math.round(s / 86400)} d ago`;
    return day(d);
  };

  const S = { user: null, name: '', admin: false, preview: false, sample: null, courses: [], modules: [], lessons: [], numbers: {}, enrolled: {}, done: {}, certs: {}, payments: {}, pay: { settings: {}, course: {} } };

  // ── data ───────────────────────────────────────────────────────────────────
  async function loadOutline() {
    try {
      if (!sb) throw new Error('no client');
      // the client library retries a dead connection for several seconds; give up after five
      const [c, m, l] = await Promise.race([
        Promise.all([
          sb.from('courses').select('*').eq('status', 'published').order('sort_order'),
          sb.from('course_modules').select('*').order('sort_order'),
          sb.from('course_lessons').select('*').order('sort_order'),
        ]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 5000)),
      ]);
      if (c.error || m.error || l.error) throw (c.error || m.error || l.error);
      // admins can read drafts and hidden rows; the public pages never show them
      const live = new Set(c.data.map((x) => x.id));
      S.courses = c.data;
      S.modules = m.data.filter((x) => live.has(x.course_id) && !x.is_hidden);
      const shown = new Set(S.modules.map((x) => x.id));
      S.lessons = l.data.filter((x) => shown.has(x.module_id) && !x.is_hidden);
      (await soft(sb.rpc('course_stats'))).forEach((r) => { S.numbers[r.course_id] = r; });
      // payment settings live with the site's other saved text, under keys starting "pay."
      (await soft(sb.from('site_text').select('key,value').like('key', 'pay.%'))).forEach((r) => {
        let v; try { v = JSON.parse(r.value); } catch (e) { return; }
        if (r.key === 'pay.settings') S.pay.settings = v || {};
        else if (r.key === 'pay.faq') S.pay.faq = v && typeof v === 'object' ? v : {};
        else if (r.key.startsWith('pay.course.')) S.pay.course[r.key.slice(11)] = v || {};
      });
    } catch (e) {
      S.preview = true;
      S.sample = await (await fetch(A.root + 'academy/sample.json')).json();
      S.courses = S.sample.courses; S.modules = S.sample.modules; S.lessons = S.sample.lessons;
    }
  }

  async function loadLearner() {
    const device = local.get(LOCAL_PROGRESS);
    Object.assign(S.done, device);
    if (!sb || S.preview) return;
    const { data } = await sb.auth.getSession();
    S.user = data.session ? data.session.user : null;
    if (!S.user) return;
    const meta = S.user.user_metadata || {};
    S.profile = await soft(sb.from('profiles').select('full_name,phone').eq('id', S.user.id).maybeSingle(), null);
    S.name = (S.profile && S.profile.full_name) || meta.full_name || meta.name || '';
    nameKeep();
    S.admin = (await soft(sb.rpc('is_admin'), false)) === true;
    // Admin logins are kept apart from learner accounts: an admin can open any
    // lesson to check it, but nothing is recorded against them (the database
    // refuses it too). Their clicking-through is remembered on this device only.
    if (S.admin) return;

    // Anything completed on this device before signing in moves into the
    // account, so no progress is lost by creating one late.
    const known = new Map(S.lessons.map((l) => [l.id, l.course_id]));
    // (not into paid entries: those are joined from the payment page)
    const open = new Set(S.courses.filter((c) => !fee(c).paid).map((c) => c.id));
    const carry = Object.keys(device).filter((id) => known.has(id) && open.has(known.get(id)));
    if (carry.length) {
      const courses = [...new Set(carry.map((id) => known.get(id)))];
      await sb.from('enrollments').upsert(courses.map((c) => ({ user_id: S.user.id, course_id: c, learner_name: S.name, learner_email: S.user.email })), { onConflict: 'user_id,course_id', ignoreDuplicates: true });
      const { error } = await sb.from('lesson_progress').upsert(carry.map((id) => ({ user_id: S.user.id, lesson_id: id, course_id: known.get(id) })), { onConflict: 'user_id,lesson_id', ignoreDuplicates: true });
      if (!error) local.set(LOCAL_PROGRESS, {});
    }

    const [en, pr, ce, pm] = await Promise.all([
      soft(sb.from('enrollments').select('course_id,enrolled_at,completed_at')),
      soft(sb.from('lesson_progress').select('lesson_id')),
      soft(sb.from('certificates').select('id,course_id').eq('user_id', S.user.id)),
      soft(sb.from('payments').select('*').eq('user_id', S.user.id).order('created_at')),
    ]);
    pm.forEach((r) => { S.payments[r.course_id] = r; });   // oldest first, so the newest wins
    S.done = {};   // a signed-in learner's record is the account's, not the device's
    en.forEach((r) => { S.enrolled[r.course_id] = r; });
    pr.forEach((r) => { S.done[r.lesson_id] = true; });
    ce.forEach((r) => { S.certs[r.course_id] = r.id; });
  }

  const lessonsOf = (id) => S.lessons.filter((l) => l.course_id === id).sort((a, b) => a.sort_order - b.sort_order);
  const modulesOf = (id) => S.modules.filter((m) => m.course_id === id).sort((a, b) => a.sort_order - b.sort_order);
  function stats(course) {
    const ls = lessonsOf(course.id);
    const done = ls.filter((l) => S.done[l.id]).length;
    const minutes = ls.reduce((t, l) => t + (l.duration_min || 0), 0);
    return { lessons: ls, count: ls.length, done, minutes, pct: ls.length ? Math.round((done / ls.length) * 100) : 0, next: ls.find((l) => !S.done[l.id]) || ls[0] };
  }
  // ── payment ────────────────────────────────────────────────────────────────
  // Every entry is paid unless the admin panel marks it free. The price is the
  // entry's own, or the general one from the payment settings. A learner has
  // access to a paid entry once an admin has confirmed their bKash payment
  // (the payments table; the database enforces the same rule).
  // An entry can be a course that lives on another website (a partner's or a subsidiary's).
  // Its card and page here are a signpost: pressing it opens that website. Nothing is enrolled,
  // paid or taught here. Returns { url, host, by } for such an entry, otherwise null.
  function outside(course) {
    const own = (!S.preview && S.pay.course[course.id]) || {};
    const url = String(own.external || '').trim();
    if (!/^https?:\/\/[^\s]+$/i.test(url)) return null;
    let host = ''; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return null; }
    return { url, host, by: String(own.external_by || '').trim() };
  }
  // the attributes of a link that leaves for that website (it opens beside this one, and is counted as a visit)
  const outLink = (course) => { const o = outside(course); return o ? `href="${esc(o.url)}" target="_blank" rel="noopener noreferrer" data-out="${esc(course.id)}"` : ''; };
  // financial aid: the entry's own form, or the academy's — only for an entry that is paid for here
  function aidUrl(course) {
    if (S.preview || outside(course) || !fee(course).paid) return '';
    const u = String((S.pay.course[course.id] || {}).aid || S.pay.settings.aid || '').trim();
    return /^https:\/\/[^\s.]+\.[^\s]+$/i.test(u) ? u : '';
  }
  const aidButton = (course) => { const u = aidUrl(course); return u ? `<a class="btn-outline btn-aid" href="${esc(u)}" target="_blank" rel="noopener noreferrer">apply for financial aid <span class="btn-arrow" aria-hidden="true">↗</span></a>` : ''; };
  function fee(course) {
    if (S.preview) return { paid: false, label: 'free', amount: '', link: '', was: '', off: 0, saved: '' };
    const own = S.pay.course[course.id] || {}, all = S.pay.settings;
    // an entry on another website is never paid for here; a price, if one was typed, is only shown
    const away = !!outside(course);
    const paid = !away && own.paid !== false;
    const amount = String(own.price || (away ? '' : all.price) || '').trim();
    const unit = String(all.currency || '৳').trim();
    const money = (v) => (/^[a-z]/i.test(unit) ? `${unit} ${v}` : unit + v).toLowerCase();
    const label = away ? (amount ? money(amount) : '') : !paid ? 'free' : amount ? money(amount) : 'paid';
    // an entry can carry the price it used to be; it is shown crossed out beside the price to pay,
    // but only when it really is higher
    const n = (v) => parseFloat(String(v).replace(/[^0-9.]/g, ''));
    const before = String(own.was || '').trim();
    const cut = (paid || away) && !!amount && !!before && n(before) > n(amount);
    return { paid, amount, label, link: String(own.link || all.link || '').trim(),
      was: cut ? money(before) : '', off: cut ? Math.round((1 - n(amount) / n(before)) * 100) : 0, saved: cut ? money(+(n(before) - n(amount)).toFixed(2)) : '' };
  }
  // the price as it is written on a card or a page: what you pay, with the earlier price crossed out after it
  const priceTag = (course) => { const f = fee(course), o = outside(course); return `<strong>${esc(f.label || (o ? 'on ' + o.host : ''))}</strong>${f.was ? `<s>${esc(f.was)}</s>` : ''}`; };
  // '' (nothing sent) | 'pending' (being checked) | 'rejected' | 'confirmed'
  const payState = (course) => (S.payments[course.id] || {}).status || '';
  const paidUp = (course) => !fee(course).paid || S.admin || payState(course) === 'confirmed';
  // has started for real — someone still waiting for their payment to be confirmed has not
  const started = (course) => paidUp(course) && (!!S.enrolled[course.id] || stats(course).done > 0);
  const length = (min) => (min >= 60 ? `${Math.floor(min / 60)}h ${min % 60 ? (min % 60) + 'm' : ''}`.trim() : `${min} min`);
  const KIND = { video: 'video', article: 'reading', quiz: 'quiz', form: 'test', live: 'live class' };
  // the three things the academy lists; anything unmarked is a course
  const TYPES = { course: 'courses', program: 'programs', webinar: 'webinars' };
  const typeOf = (course) => (TYPES[course.kind] ? course.kind : 'course');
  // dates are stored once and shown in each visitor's own time zone
  const clock = (d) => new Date(d).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
  const shortDay = (d) => new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).toLowerCase();
  const when = (d) => `${shortDay(d)} · ${clock(d)}`;
  // a live class is upcoming, then live for as long as it runs, then over
  const liveState = (at, minutes) => {
    if (!at) return 'tba';
    const start = +new Date(at), now = Date.now();
    return now < start ? 'upcoming' : now < start + Math.max(15, minutes || 60) * 60000 ? 'live' : 'ended';
  };
  // ── help, reminders and "where was i" ──────────────────────────────────────
  // The WhatsApp number learners can write to is set in the admin panel (academy → help for
  // learners) and kept with the payment settings. Without one, help falls back to email.
  const HELP_MAIL = 'learn@amazeconsortium.org';
  // a list of questions saved in the admin panel, or null when that list was never changed
  const savedFaq = (place) => { const l = S.pay.faq && S.pay.faq[place]; return Array.isArray(l) ? l.filter((x) => x && x.q) : null; };
  const waNumber = () => { let n = String(S.pay.settings.whatsapp || '').replace(/[^0-9]/g, ''); if (/^01\d{9}$/.test(n)) n = '88' + n; return n.length >= 10 && n.length <= 15 ? n : ''; };
  const WA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2a8.7 8.7 0 0 0-7.5 13.2L3.3 20.8l4.500-1.200A8.700 8.700 0 1 0 12 3.200z"/><path d="M9 8.200c-.3.700-.4 1.600.300 2.800.9 1.500 2.200 2.700 3.800 3.400 1 .4 1.800.2 2.400-.5l.3-.700-1.900-.900-.700.800c-1-.4-1.900-1.300-2.400-2.300l.7-.700-.800-1.900z"/></svg>';
  // a link to get help about something: whatsapp when a number is set, otherwise email
  const helpUrl = (about) => (waNumber() ? `https://wa.me/${waNumber()}?text=${enc('hello amaze consortium — ' + about)}` : `mailto:${HELP_MAIL}?subject=${enc(about)}`);
  const helpLink = (about, label) => `<a class="help-link${waNumber() ? ' is-wa' : ''}" href="${esc(helpUrl(about))}" target="_blank" rel="noopener noreferrer">${waNumber() ? WA : ''}<span>${label || (waNumber() ? 'message us on whatsapp' : 'email ' + HELP_MAIL)}</span></a>`;
  // a live class as a google calendar entry
  const calLink = (lesson, course) => {
    if (!lesson.live_at) return '';
    const stamp = (d) => new Date(d).toISOString().replace(/[-:]|\.\d{3}/g, ''), mins = Math.max(15, lesson.duration_min || 60);
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE'
      + `&text=${enc(lesson.title + ' — ' + course.title)}`
      + `&dates=${stamp(lesson.live_at)}/${stamp(+new Date(lesson.live_at) + mins * 60000)}`
      + `&details=${enc('live class — amaze consortium academy\n' + new URL(`${U.learn(course.id, lesson.id)}`, location.href).href)}`;
  };
  // "in 3 days 4 h", "in 2 h 10 min", "in 5 min"
  const until = (at) => { const sec = Math.max(0, (+new Date(at) - Date.now()) / 1000), d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.ceil((sec % 3600) / 60); return d ? `${d} day${d === 1 ? '' : 's'}${h ? ` ${h} h` : ''}` : h ? `${h} h ${m} min` : `${Math.max(1, m)} min`; };
  // the next live class of a course that has not finished yet (live now counts)
  const nextLive = (course) => lessonsOf(course.id).filter((l) => l.kind === 'live' && l.live_at && liveState(l.live_at, l.duration_min) !== 'ended').sort((a, b) => new Date(a.live_at) - new Date(b.live_at))[0] || null;
  // the lesson last opened on this device, and how far into each video the learner got
  const LOCAL_LAST = 'amaze.lms.last';
  const LOCAL_WATCH = 'amaze.lms.watch';
  const mmss = (sec) => `${Math.floor(sec / 60)}:${pad2(Math.floor(sec % 60))}`;

  // one small line icon per lesson type, shown beside every lesson title
  const svg = (inner) => `<svg class="kind-icon" viewBox="0 0 16 16" aria-hidden="true">${inner}</svg>`;
  const ICON = {
    video: svg('<rect x="1.5" y="2.5" width="13" height="11"/><path class="solid" d="M6.5 5.4v5.2L11 8z"/>'),
    article: svg('<path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3M5.5 8h5M5.5 10.5h5"/>'),
    quiz: svg('<rect x="1.5" y="1.5" width="13" height="13"/><path d="M4.5 8.2l2.2 2.2 4.8-5"/>'),
    form: svg('<path d="M4.5 2.5h-2v12h11v-12h-2"/><rect x="4.5" y="1.5" width="7" height="2.5"/><path d="M5 7.5h6M5 10h6M5 12.5h3.5"/>'),
    file: svg('<path d="M8 2v8.5M4.5 7.5L8 11l3.5-3.5M2.5 13.5h11"/>'),
    live: svg('<circle class="solid" cx="8" cy="8" r="1.7"/><path d="M5 5a4.2 4.2 0 0 0 0 6M11 5a4.2 4.2 0 0 1 0 6M2.8 2.8a7.4 7.4 0 0 0 0 10.4M13.2 2.8a7.4 7.4 0 0 1 0 10.4"/>'),
  };
  const kindIcon = (lesson) => `<span class="kind kind--${esc(lesson.kind)}" title="${KIND[lesson.kind] || esc(lesson.kind)}">${ICON[lesson.kind] || ICON.article}</span>`;
  // in a locked-order course a lesson opens once everything before it is done
  const locked = (course, lesson, all) => !!course.sequential && !S.admin && !all.slice(0, all.indexOf(lesson)).every((l) => S.done[l.id]);
  const rating = (course) => {
    const n = S.numbers[course.id];
    return n && +n.reviews > 0 ? `<span class="stars">★ ${(+n.rating).toFixed(1)}</span> <span>(${n.reviews})</span>` : '';
  };
  const learners = (course) => {
    const n = S.numbers[course.id];
    return n && +n.learners > 0 ? `${(+n.learners).toLocaleString()} learner${+n.learners === 1 ? '' : 's'}` : '';
  };

  async function getContent(lesson) {
    if (S.preview) return S.sample.content.find((c) => c.lesson_id === lesson.id) || null;
    const { data } = await sb.from('lesson_content').select('*').eq('lesson_id', lesson.id).maybeSingle();
    return data;   // null when this visitor isn't allowed to read it
  }

  async function enrol(course) {
    if (!S.user || S.admin || S.enrolled[course.id] || !paidUp(course)) return;
    const row = { user_id: S.user.id, course_id: course.id, learner_name: S.name, learner_email: S.user.email };
    const { error } = await sb.from('enrollments').insert(row);
    if (!error) S.enrolled[course.id] = { course_id: course.id, completed_at: null };
  }

  async function markDone(course, lesson, score) {
    S.done[lesson.id] = true;
    if (!S.user || S.admin) { local.set(LOCAL_PROGRESS, S.done); return; }
    await enrol(course);
    await sb.from('lesson_progress').upsert({ user_id: S.user.id, lesson_id: lesson.id, course_id: course.id, quiz_score: score ?? null });
    if (stats(course).pct === 100 && S.enrolled[course.id] && !S.enrolled[course.id].completed_at) {
      const at = new Date().toISOString();
      await sb.from('enrollments').update({ completed_at: at }).eq('user_id', S.user.id).eq('course_id', course.id);
      S.enrolled[course.id].completed_at = at;
    }
  }

  // ── small markdown: headings, lists, code, bold, italic, links ─────────────
  function inline(t) {
    return esc(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }
  function markdown(src) {
    const out = [];
    const lines = String(src || '').replace(/\r/g, '').split('\n');
    let para = [], list = null, code = null;
    const flush = () => {
      if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; }
      if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; }
    };
    lines.forEach((raw) => {
      if (code) { if (/^```/.test(raw)) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; } else code.push(raw); return; }
      const line = raw.trim();
      if (/^```/.test(line)) { flush(); code = []; return; }
      if (!line) { flush(); return; }
      let m;
      if ((m = /^(#{2,3})\s+(.*)$/.exec(line))) { flush(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); return; }
      if ((m = /^[-*]\s+(.*)$/.exec(line))) { if (para.length) flush(); if (!list || list.tag !== 'ul') { flush(); list = { tag: 'ul', items: [] }; } list.items.push(m[1]); return; }
      if ((m = /^\d+[.)]\s+(.*)$/.exec(line))) { if (para.length) flush(); if (!list || list.tag !== 'ol') { flush(); list = { tag: 'ol', items: [] }; } list.items.push(m[1]); return; }
      if (list) flush();
      para.push(line);
    });
    if (code) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
    flush();
    return out.join('\n');
  }

  // Turns whatever link was pasted into something that plays inside the page:
  // any YouTube address (watch, youtu.be, shorts, live, embed — with or without
  // extra ?si= / &t= parts), Vimeo, a Google Drive file, or a video file of our
  // own (uploaded from the admin panel, or any direct .mp4 / .webm link).
  const VIDEOS = new Map();
  function videoEmbed(raw, opts = {}) {
    const url = String(raw || '').trim();
    // (sandbox: the player runs, but it may not open a new tab or send this page anywhere)
    const frame = (src, extra = '') => `<iframe src="${esc(src)}" title="lesson video" sandbox="allow-scripts allow-same-origin allow-presentation" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; fullscreen" allowfullscreen ${extra}></iframe>`;
    let u = null;
    try { u = new URL(url); } catch (e) {}
    if (u) {
      const host = u.hostname.replace(/^(www\.|m\.)/, '');
      const parts = u.pathname.split('/').filter(Boolean);
      let yt = null;
      if (host === 'youtu.be') yt = parts[0];
      else if (host === 'youtube.com' || host === 'youtube-nocookie.com') yt = u.searchParams.get('v') || (['embed', 'shorts', 'live', 'v'].includes(parts[0]) ? parts[1] : null);
      if (yt && /^[\w-]{6,}$/.test(yt)) {
        // a link copied at a timestamp (?t=90 or ?t=1m30s) starts there
        const t = u.searchParams.get('t') || u.searchParams.get('start') || '';
        const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t);
        const start = opts.resume || (m && t ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0);
        if (!opts.guard) return frame(`https://www.youtube-nocookie.com/embed/${yt}?rel=0&modestbranding=1${start ? '&start=' + Math.floor(start) : ''}`);
        // A lesson's video plays inside our own player. YouTube's own buttons — the title that links
        // to youtube, "copy link", "share", "watch on youtube", the right-click menu — are all still
        // drawn by YouTube inside its frame, so a sheet is laid over the whole frame: nothing in it can
        // be pressed, and the buttons learners use (play, seek, sound, speed, full screen) are ours and
        // talk to the video from outside. See guard() for the other half.
        // Which video it is, is not written into the page either: the frame is opened empty and told
        // the video afterwards (guard() collects it from VIDEOS with this ticket, once).
        const ticket = Math.random().toString(36).slice(2) + Date.now().toString(36);
        VIDEOS.set(ticket, { id: yt, start: Math.floor(start) || 0 });
        const src = `https://www.youtube-nocookie.com/embed/?controls=0&disablekb=1&fs=0&iv_load_policy=3&playsinline=1&rel=0&modestbranding=1&enablejsapi=1&origin=${enc(location.origin)}`;
        return `<div class="vp is-new" data-vp="${ticket}">
            <iframe src="${esc(src)}" title="lesson video" tabindex="-1" sandbox="allow-scripts allow-same-origin allow-presentation" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media" data-yt></iframe>
            ${PLAYER_TOP}
            ${PLAYER_BAR}
          </div>`;
      }
      if (host === 'vimeo.com' || host === 'player.vimeo.com') {
        const id = parts.find((p) => /^\d+$/.test(p));
        if (id) return frame(`https://player.vimeo.com/video/${id}`);
      }
      if (host === 'drive.google.com' && parts[0] === 'file' && parts[2]) return frame(`https://drive.google.com/file/d/${parts[2]}/preview`);
    }
    // the address of the file is not written into the page either: guard() sets it from VIDEOS
    const ticket = Math.random().toString(36).slice(2) + Date.now().toString(36);
    VIDEOS.set(ticket, { file: url, start: Math.floor(opts.resume || 0) });
    return `<div class="vp vp--file is-new" data-vp="${ticket}">
        <video data-file playsinline preload="metadata" disablepictureinpicture disableremoteplayback x-webkit-airplay="deny" controlslist="nodownload nofullscreen noremoteplayback noplaybackrate"></video>
        ${PLAYER_TOP}
        ${PLAYER_BAR}
      </div>`;
  }
  // the parts of the player that are the same for youtube and for a file of our own
  const PLAYER_TOP = `<div class="vp-dim"></div>
            <div class="vp-shield" tabindex="0" role="button" aria-label="play or pause the video"></div>`;
  const PLAYER_BAR = `<button class="vp-big" type="button" aria-label="play"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.500z"/></svg></button>
            <p class="vp-hint" hidden>tap the middle of the video once more to start it.</p>
            <div class="vp-bar">
              <button type="button" data-vp="play" aria-label="play"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="i-play" d="M8 5.5v13l11-6.500z"/><path class="i-pause" d="M7 5.5h3.500v13H7zM13.500 5.500H17v13h-3.500z"/></svg></button>
              <span class="vp-time"><b data-vp="now">0:00</b> / <span data-vp="total">0:00</span></span>
              <input class="vp-seek" type="range" min="0" max="1000" value="0" step="1" aria-label="move through the video">
              <button type="button" data-vp="mute" aria-label="sound"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.500h3.500L12 6v12l-4.500-3.500H4z"/><path class="i-loud" d="M15.500 9a4.500 4.500 0 0 1 0 6M17.800 6.700a7.800 7.800 0 0 1 0 10.600"/><path class="i-quiet" d="M15.500 9.500l5 5M20.500 9.500l-5 5"/></svg></button>
              <button type="button" class="vp-speed" data-vp="speed" aria-label="speed" title="speed">1×</button>
              <button type="button" data-vp="full" aria-label="full screen" title="full screen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.500 9.500v-5h5M19.500 9.500v-5h-5M4.500 14.500v5h5M19.500 14.500v5h-5"/></svg></button>
            </div>`;

  // ── the watermark: who is watching, on every lesson video, recording and live class ──
  // Two layers, both drawn over the picture so that a recording of the screen carries them:
  //   • a pattern of the learner's email repeated across the whole picture, very faint (like the
  //     pattern on a banknote). It covers every part of the frame, so cropping a recording cannot
  //     cut it out without cutting the video away with it.
  //   • the same email, a little clearer, small, fading out and reappearing somewhere else now
  //     and then — so even a short clip shows plainly whose account it came from.
  // Neither takes clicks, and neither changes size with the picture. If either is removed, hidden,
  // made see-through, shrunk or rewritten (with the browser's tools, for example), onTamper() is
  // called — the video stops or the class goes blank — and the watermark is put back.
  function watermark(box, text, onTamper) {
    if (!box || !text) return null;
    const cell = (t) => {
      const v = String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='380' height='170'><g fill='white' font-family='Helvetica, Arial, sans-serif' font-size='13' font-weight='700' transform='rotate(-20 190 85)'><text x='14' y='62'>${v}</text><text x='200' y='150'>${v}</text></g></svg>`;
      return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
    };
    const pattern = cell(text);
    let tile, drift, label, moving = false, stopped = false;
    const build = () => {
      tile = document.createElement('div'); tile.className = 'wm-tile'; tile.setAttribute('aria-hidden', 'true'); tile.style.backgroundImage = pattern;
      drift = document.createElement('div'); drift.className = 'wm-drift'; drift.setAttribute('aria-hidden', 'true');
      label = document.createElement('b'); label.textContent = text; drift.appendChild(label);
      box.append(tile, drift);
      place();
    };
    // a new place: away from the very middle (what is being watched) and from the buttons at the bottom
    const place = () => {
      let x, y;
      do { x = 3 + Math.random() * 64; y = 6 + Math.random() * 70; } while (x > 26 && x < 50 && y > 30 && y < 58);
      drift.style.left = x + '%'; drift.style.top = y + '%';
    };
    const move = () => {
      if (stopped) return;
      moving = true; drift.classList.add('is-moving');
      setTimeout(() => { place(); drift.classList.remove('is-moving'); setTimeout(() => { moving = false; }, 800); }, 800);
    };
    const intact = () => {
      if (!tile.isConnected || !drift.isConnected || tile.parentNode !== box || drift.parentNode !== box || !label.isConnected) return false;
      if (label.textContent !== text || tile.style.backgroundImage.indexOf('data:image/svg+xml') < 0) return false;
      const t = getComputedStyle(tile), d = getComputedStyle(drift), l = getComputedStyle(label);
      const shown = (cs) => cs.display !== 'none' && cs.visibility === 'visible' && cs.transform === 'none' && cs.filter === 'none' && cs.clipPath === 'none' && cs.contentVisibility !== 'hidden';
      if (!shown(t) || !shown(d) || l.display === 'none' || l.visibility !== 'visible' || l.transform !== 'none' || l.filter !== 'none') return false;
      if (+t.opacity < 0.04 || +d.opacity < 0.99 || (!moving && +l.opacity < 0.9)) return false;
      if (parseFloat(l.fontSize) < 9 || t.backgroundImage === 'none') return false;
      const a = box.getBoundingClientRect(), b = tile.getBoundingClientRect();
      if (a.width > 40 && (b.width < a.width - 2 || b.height < a.height - 2)) return false;
      return true;
    };
    const check = () => {
      if (stopped || intact()) return;
      [tile, drift].forEach((el) => { if (el && el.parentNode) el.remove(); });
      build();
      if (onTamper) onTamper();
    };
    build();
    const timer = setInterval(move, 13000 + Math.random() * 6000);
    const watch = setInterval(check, 1500);
    let soon = 0;
    const seen = new MutationObserver(() => { if (!soon) soon = setTimeout(() => { soon = 0; check(); }, 300); });
    seen.observe(box, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    return { stop: () => { stopped = true; clearInterval(timer); clearInterval(watch); seen.disconnect(); } };
  }
  // Runs one player from videoEmbed: a youtube video (guard: true) or a video file of our own.
  //   on.time(seconds, total)   as it plays        on.ended()   when it reaches the end
  //   mark                      the watermark (who is watching: their email), or '' for none
  function guard(el, on = {}, mark = '') {
    const frame = $('iframe[data-yt]', el), file = $('video[data-file]', el), shield = $('.vp-shield', el), seek = $('.vp-seek', el), hint = $('.vp-hint', el);
    const YT = 'https://www.youtube-nocookie.com';
    const st = { state: -1, now: 0, total: 0, muted: false, rate: 1, heard: false, dragging: false, started: false };
    const video = VIDEOS.get(el.dataset.vp) || {}; VIDEOS.delete(el.dataset.vp); el.dataset.vp = '';
    let cued = false;
    // the same commands drive either engine
    const tell = file ? (func, args = []) => {
      try {
        if (func === 'playVideo') { const go = file.play(); if (go && go.catch) go.catch(() => {}); }
        else if (func === 'pauseVideo') file.pause();
        else if (func === 'seekTo') file.currentTime = args[0];
        else if (func === 'mute') file.muted = true;
        else if (func === 'unMute') file.muted = false;
        else if (func === 'setPlaybackRate') file.playbackRate = args[0];
      } catch (e) {}
    } : (func, args = []) => { try { frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), YT); } catch (e) {} };
    const listen = () => { try { frame.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), YT); } catch (e) {} };
    if (frame) {
      let knocks = 0; const knock = setInterval(() => { knocks += 1; if (st.heard || knocks > 60) return clearInterval(knock); listen(); }, 600);
      frame.addEventListener('load', listen);
    }
    const draw = () => {
      const playing = st.state === 1 || st.state === 3;
      el.classList.toggle('is-playing', playing); el.classList.toggle('is-paused', st.state === 2);
      el.classList.toggle('is-ended', st.state === 0); el.classList.toggle('is-loading', st.state === 3);
      el.classList.toggle('is-muted', st.muted);
      $('[data-vp=play]', el).setAttribute('aria-label', playing ? 'pause' : 'play');
      $('[data-vp=now]', el).textContent = mmss(st.now); $('[data-vp=total]', el).textContent = mmss(st.total);
      if (!st.dragging) { seek.value = st.total ? Math.round((st.now / st.total) * 1000) : 0; seek.style.setProperty('--at', (st.total ? (st.now / st.total) * 100 : 0) + '%'); }
      $('[data-vp=speed]', el).textContent = st.rate + '×';
    };
    if (file) {
      // a file of our own: the browser reports everything directly
      const sync = () => {
        st.heard = true;
        st.now = file.currentTime || 0; st.total = isFinite(file.duration) ? file.duration : 0;
        st.muted = file.muted; st.rate = file.playbackRate;
        st.state = file.ended ? 0 : file.paused ? (st.started ? 2 : -1) : file.readyState < 3 ? 3 : 1;
        if (!file.paused) { st.started = true; el.classList.remove('is-new', 'needs-tap'); hint.hidden = true; }
        draw();
      };
      ['play', 'playing', 'pause', 'waiting', 'seeked', 'durationchange', 'loadedmetadata', 'ratechange', 'volumechange'].forEach((t) => file.addEventListener(t, sync));
      file.addEventListener('timeupdate', () => { sync(); if (on.time) on.time(st.now, st.total); });
      file.addEventListener('ended', () => { sync(); if (on.ended) on.ended(); });
      // carries on from where it was stopped last time, unless it was nearly over
      if (video.start) file.addEventListener('loadedmetadata', () => { if (video.start < file.duration - 20) file.currentTime = video.start; }, { once: true });
      if (video.file) file.src = video.file;
    }
    if (frame) window.addEventListener('message', (e) => {
      if (e.source !== frame.contentWindow || !/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(e.origin)) return;
      let d; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (err) { return; }
      if (!d) return;
      // the player has answered: now it is told which video to show (and where to carry on from)
      if (!cued && video.id) { cued = true; st.heard = true; tell('cueVideoById', [{ videoId: video.id, startSeconds: video.start }]); if (video.start) { st.now = video.start; } }
      if (!d.info) return;
      st.heard = true;
      const i = d.info;
      if (typeof i.duration === 'number' && i.duration > 0) { st.total = i.duration; frame.dataset.total = i.duration; }
      if (typeof i.currentTime === 'number') { st.now = i.currentTime; if (on.time) on.time(st.now, st.total); }
      if (typeof i.muted === 'boolean') st.muted = i.muted;
      if (typeof i.playbackRate === 'number') st.rate = i.playbackRate;
      if (typeof i.playerState === 'number') {
        const was = st.state; st.state = i.playerState;
        if (st.state === 1) { st.started = true; el.classList.remove('is-new', 'needs-tap'); hint.hidden = true; }
        if (st.state === 0 && was !== 0 && on.ended) on.ended();
      }
      draw();
    });
    // pressing play: asked from outside. some phones only let a video start from a touch on the
    // video itself — if it has not started a moment later, the middle of the sheet is opened for one tap.
    const play = () => {
      tell('playVideo');
      if (st.started || file) return;
      setTimeout(() => { if (!st.started && st.state !== 1 && st.state !== 3) { el.classList.add('needs-tap'); hint.hidden = false; } }, 1800);
    };
    const toggle = () => (st.state === 1 || st.state === 3 ? tell('pauseVideo') : st.state === 0 ? (tell('seekTo', [0, true]), tell('playVideo')) : play());
    const jump = (sec) => { const to = Math.max(0, Math.min(st.total || 1e9, sec)); st.now = to; tell('seekTo', [to, true]); draw(); };
    const SPEEDS = [1, 1.25, 1.5, 2, 0.75];
    // full screen — or, on a phone that has none for anything but its own video player (an iphone),
    // the player fills the whole browser window instead
    const canFull = !!(el.requestFullscreen || el.webkitRequestFullscreen);
    const fill = (on) => { el.classList.toggle('is-full', on); document.documentElement.classList.toggle('vp-open', on); };
    const full = () => {
      if (el.classList.contains('is-full')) return fill(false);
      if (!canFull) return fill(true);
      if (document.fullscreenElement || document.webkitFullscreenElement) return (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      // a browser that refuses full screen (some apps' own browsers do): the player fills the window instead
      const go = (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      if (go && go.catch) go.catch(() => fill(true));
    };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && el.classList.contains('is-full')) fill(false); });
    shield.addEventListener('click', toggle);
    $('.vp-big', el).addEventListener('click', toggle);
    shield.addEventListener('dblclick', full);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-vp]'); if (!b || b === el) return;
      const k = b.dataset.vp;
      if (k === 'play') toggle(); else if (k === 'mute') { tell(st.muted ? 'unMute' : 'mute'); st.muted = !st.muted; draw(); }
      else if (k === 'speed') { st.rate = SPEEDS[(SPEEDS.indexOf(st.rate) + 1) % SPEEDS.length]; tell('setPlaybackRate', [st.rate]); draw(); }
      else if (k === 'full') full();
    });
    seek.addEventListener('input', () => { st.dragging = true; st.now = (seek.value / 1000) * st.total; seek.style.setProperty('--at', seek.value / 10 + '%'); $('[data-vp=now]', el).textContent = mmss(st.now); });
    seek.addEventListener('change', () => { st.dragging = false; jump((seek.value / 1000) * st.total); });
    el.addEventListener('keydown', (e) => {
      if (e.target.matches('input')) return;
      const k = e.key;
      if (k === ' ' || k === 'k') { e.preventDefault(); toggle(); } else if (k === 'ArrowRight') { e.preventDefault(); jump(st.now + 5); } else if (k === 'ArrowLeft') { e.preventDefault(); jump(st.now - 5); }
      else if (k === 'm') $('[data-vp=mute]', el).click(); else if (k === 'f') full();
    });
    // nothing to right-click, drag or select on the picture
    ['contextmenu', 'dragstart', 'selectstart'].forEach((t) => el.addEventListener(t, (e) => e.preventDefault()));
    // the buttons fade away while it plays, and come back when the pointer moves or the screen is touched
    let idle; const wake = () => { el.classList.remove('is-idle'); clearTimeout(idle); idle = setTimeout(() => el.classList.add('is-idle'), 2600); };
    ['pointermove', 'pointerdown', 'keydown', 'focusin'].forEach((t) => el.addEventListener(t, wake)); wake();
    // who is watching: if the watermark is tampered with, the video stops (and the watermark comes back)
    if (mark) watermark(el, mark, () => { tell('pauseVideo'); el.classList.add('is-tampered'); hint.textContent = 'the watermark was changed, so the video stopped. refresh the page to watch again.'; hint.hidden = false; });
    draw();
    return { tell, state: st };
  }

  // a link is only used if it is a normal web address (or a path on this site)
  const safeUrl = (v) => (/^(https?:)?\/\//i.test(String(v || '').trim()) ? String(v).trim() : /^[a-z][a-z0-9+.-]*:/i.test(String(v || '').trim()) ? '#' : A.root + String(v || '').trim().replace(/^\/+/, ''));
  // a Google Form link in the shape that can be shown inside the page
  function formEmbed(url) {
    if (!/docs\.google\.com\/forms/.test(url)) return url;
    const clean = url.split('#')[0].replace(/\/(edit|prefill)(\?.*)?$/, '/viewform');
    return /embedded=true/.test(clean) ? clean : clean + (clean.includes('?') ? '&' : '?') + 'embedded=true';
  }

  // ── account dialog ─────────────────────────────────────────────────────────
  let dialog;
  function openDialog(html, look = '') {
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.className = 'dialog';
      dialog.innerHTML = '<div class="dialog-box" role="dialog" aria-modal="true"><button class="dialog-close" aria-label="close">✕</button><div class="dialog-body"></div></div>';
      document.body.appendChild(dialog);
      dialog.addEventListener('click', (e) => { if (e.target === dialog || e.target.closest('.dialog-close')) closeDialog(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDialog(); });
    }
    $('.dialog-body', dialog).innerHTML = html;
    dialog.className = 'dialog' + (look ? ' ' + look : '') + (dialog.classList.contains('is-open') ? ' is-open' : '');
    requestAnimationFrame(() => dialog.classList.add('is-open'));
    const first = $('input', dialog); if (first) setTimeout(() => first.focus(), 80);
    return $('.dialog-body', dialog);
  }
  function closeDialog() { if (dialog) dialog.classList.remove('is-open'); }
  const plain = (message) => (/failed to fetch|networkerror|load failed/i.test(message) ? 'can\'t reach the server — check your internet connection and try again.' : message);
  function say(body, text, isError) {
    text = plain(text);
    let el = $('.dialog-msg', body);
    if (!el) { el = document.createElement('div'); el.className = 'dialog-msg'; body.appendChild(el); }
    el.classList.toggle('is-error', !!isError);
    el.textContent = text;
  }

  // Learners sign in with their Google account, or — once an admin switches it on (it needs an
  // email sender, see the admin panel) — with an email address and a password. Admin logins
  // are separate and stay on the admin page.
  const emailOn = () => S.pay.settings && S.pay.settings.email_login === true;
  const signInWords = () => (emailOn() ? 'sign in' : 'sign in with google');
  const GOOGLE = '<svg viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>';
  // what the sign-in service says, in plain words
  const authProblem = (m) => (/invalid login credentials/i.test(m) ? 'that email and password do not match. check both, or press “forgot your password?”.'
    : /email not confirmed/i.test(m) ? 'your email is not confirmed yet. open the message we sent you and press the link in it — then sign in here.'
    : /already registered|already been registered|user already exists/i.test(m) ? 'there is already an account with this email. sign in instead — or press “forgot your password?”.'
    : /not authori[sz]ed|sending.*email|smtp|error sending/i.test(m) ? 'we could not send the email just now. please use “continue with google” for the moment, or try again later.'
    : /rate limit|too many|security purposes/i.test(m) ? 'too many tries in a short time. wait a minute, then try again.'
    : /password.*(at least|short|weak|characters)/i.test(m) ? 'choose a longer password — at least 8 characters.'
    : /valid email|invalid.*email/i.test(m) ? 'that email address does not look right.'
    : m);
  function authDialog(mode = 'signin') {
    if (S.preview) {
      openDialog('<span class="lesson-kicker">accounts</span><h2>not connected yet</h2><p>learner accounts switch on once the course database is set up. until then every lesson is open and your progress is kept on this device.</p>');
      return;
    }
    const fresh = mode === 'signup';
    const tab = (k, t) => `<button type="button" class="auth-tab${(k === 'up') === fresh ? ' is-on' : ''}" data-auth-tab="${k}" aria-pressed="${(k === 'up') === fresh}">${t}</button>`;
    const SHIELD = '<svg viewBox="0 0 100 100" aria-hidden="true"><path fill-rule="evenodd" d="M10 8H90V52A40 40 0 0 1 10 52Z M22 20H46V44H22Z M54 20H78V44H54Z M22.3 56H46V79.7A28 28 0 0 1 22.3 56Z M77.7 56H54V79.7A28 28 0 0 0 77.7 56Z"/></svg>';
    const body = $('.auth-main', openDialog(`
      <div class="auth-main">
      <div class="auth-brand">${SHIELD}<b>amaze academy</b></div>
      <h2>${fresh ? 'create your account' : 'welcome back'}</h2>
      <p class="auth-sub">${emailOn() ? 'your progress, notes and certificates, on every device.' : 'one click with google. your progress, notes and certificates, on every device.'}</p>
      <button class="btn-google" type="button" id="google-go">${GOOGLE}<span>continue with google</span></button>
      ${emailOn() ? `<div class="auth-or"><span>or use your email</span></div>
      <div class="auth-tabs" data-mode="${fresh ? 'up' : 'in'}" role="group" aria-label="sign in or create an account">${tab('in', 'sign in')}${tab('up', 'create account')}</div>
      <form class="auth-form" id="auth-form" novalidate>
        <label class="field" data-for="up"${fresh ? '' : ' hidden'}><span>your name</span><input name="name" autocomplete="name" maxlength="80" placeholder="as it should appear on your certificate"></label>
        <label class="field"><span>email</span><input name="email" type="email" autocomplete="email" inputmode="email" required placeholder="you@example.com"></label>
        <label class="field" data-for="in up"><span>password</span><div class="pw"><input name="password" type="password" autocomplete="${fresh ? 'new-password' : 'current-password'}" minlength="8" required placeholder="${fresh ? 'at least 8 characters' : 'your password'}"><button type="button" class="pw-show" aria-label="show the password">show</button></div></label>
        <button class="btn-primary" type="submit"><span>${fresh ? 'create my account' : 'sign in'}</span><span class="btn-arrow" aria-hidden="true">→</span></button>
        <button type="button" class="auth-link" data-auth-forgot${fresh ? ' hidden' : ''}>forgot your password?</button>
      </form>` : ''}
      <p class="dialog-small">${emailOn() ? 'the name on your account goes on your certificates. you can change it, and add a phone number, once you are signed in.' : 'the name on your google account goes on your certificates. you can change it once you are signed in. we only receive your name, email address and picture.'}</p>
      </div>`, 'dialog--auth'));
    $('#google-go', body).addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      say(body, 'taking you to google…');
      // google sends the learner straight back to the page they were on (it is remembered too, in
      // case they are returned to the home page instead — see "back from google" in site-config.js)
      local.set('amaze.return', { u: location.pathname + location.search, at: Date.now() });
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.href.split('#')[0], queryParams: { prompt: 'select_account' } } });
      if (error) { e.currentTarget.disabled = false; say(body, /not enabled|unsupported provider/i.test(error.message) ? 'google sign-in is not switched on yet — please try again later.' : error.message, true); }
    });
    const card = body.closest('.dialog-box');
    if (card && matchMedia('(hover: hover)').matches) {
      let raf = 0;
      card.onpointermove = (e) => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; const r = card.getBoundingClientRect(); card.style.setProperty('--mx', `${e.clientX - r.left}px`); card.style.setProperty('--my', `${e.clientY - r.top}px`); }); };
    }
    const form = $('#auth-form', body); if (!form) return;
    let up = fresh, forgot = false;
    const draw = () => {
      $$('.auth-tab', body).forEach((b) => { const on = (b.dataset.authTab === 'up') === up && !forgot; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
      $('.auth-tabs', body).dataset.mode = forgot ? 'none' : up ? 'up' : 'in';
      $('[data-for="up"]', form).hidden = !up || forgot;
      $('[data-for="in up"]', form).hidden = forgot;
      $('[data-auth-forgot]', form).hidden = up || forgot;
      form.password.autocomplete = up ? 'new-password' : 'current-password';
      form.password.placeholder = up ? 'at least 8 characters' : 'your password';
      $('button[type=submit] span', form).textContent = forgot ? 'send me a reset link' : up ? 'create my account' : 'sign in';
      $('h2', body).textContent = forgot ? 'reset your password' : up ? 'create your account' : 'welcome back';
      $('.auth-sub', body).textContent = forgot ? 'type your email and we will send you a link to choose a new one.' : 'your progress, notes and certificates, on every device.';
      const msg = $('.dialog-msg', body); if (msg) msg.remove();
    };
    $$('.auth-tab', body).forEach((b) => b.addEventListener('click', () => { up = b.dataset.authTab === 'up'; forgot = false; draw(); }));
    $('[data-auth-forgot]', form).addEventListener('click', () => { forgot = true; draw(); form.email.focus(); });
    $('.pw-show', form).addEventListener('click', (e) => { const show = form.password.type === 'password'; form.password.type = show ? 'text' : 'password'; e.currentTarget.textContent = show ? 'hide' : 'show'; e.currentTarget.setAttribute('aria-label', show ? 'hide the password' : 'show the password'); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = form.email.value.trim().toLowerCase(), password = form.password.value, name = form.name.value.trim().replace(/\s+/g, ' ');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return say(body, 'type your email address, like you@example.com.', true);
      const go = $('button[type=submit]', form); go.disabled = true;
      const back = location.href.split('#')[0];
      try {
        if (forgot) {
          const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: back });
          if (error) return say(body, authProblem(error.message), true);
          return say(body, `if there is an account for ${email}, a link to choose a new password is on its way. open it on this device.`);
        }
        if (password.length < 8) return say(body, up ? 'choose a password of at least 8 characters.' : 'type your password.', true);
        if (up) {
          if (name.length < 2) return say(body, 'type your name — it goes on your certificates.', true);
          const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: back } });
          if (error) return say(body, authProblem(error.message), true);
          // an address that already has an account comes back with no identities, and no email is sent
          if (data && data.user && Array.isArray(data.user.identities) && !data.user.identities.length) return say(body, authProblem('already registered'), true);
          if (data && data.session) { location.reload(); return; }
          form.hidden = true; $$('.auth-or, .auth-tabs, #google-go', body).forEach((x) => { x.hidden = true; });
          return say(body, `almost done — we sent a message to ${email}. open it and press the link to confirm your email; you are then signed in. nothing there? look in spam, or wait a minute.`);
        }
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) return say(body, authProblem(error.message), true);
        location.reload();
      } catch (err) { say(body, authProblem(String(err && err.message || err)), true); }
      finally { go.disabled = false; }
    });
  }

  // ── my profile: the name to be called (and printed on new certificates), and a phone number ──
  // a phone number written the bangladesh way (017…) is kept with its country code
  const phoneOf = (v) => { let n = String(v || '').replace(/[^0-9+]/g, ''); if (/^01\d{9}$/.test(n)) n = '+88' + n; else if (/^8801\d{9}$/.test(n)) n = '+' + n; else if (n.startsWith('00')) n = '+' + n.slice(2); return n; };
  const nameKeep = () => { try { localStorage.setItem('amaze.name', JSON.stringify({ id: S.user.id, name: S.name })); } catch (e) {} };
  function profileDialog() {
    const viaEmail = ((S.user.app_metadata || {}).provider || 'email') === 'email';
    const body = openDialog(`
      <span class="lesson-kicker">my profile</span>
      <h2>your details</h2>
      <p>your name is printed on the certificates you get from now on. your phone number is only seen by our team — we use it if we need to reach you about a payment or a class.</p>
      <form id="profile-form" novalidate>
        <label class="field"><span>your name</span><input name="name" autocomplete="name" maxlength="80" required value="${esc(S.name)}"></label>
        <label class="field"><span>phone number (optional)</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" value="${esc((S.profile && S.profile.phone) || '')}" placeholder="017XXXXXXXX"></label>
        <label class="field"><span>email</span><input value="${esc(S.user.email || '')}" disabled></label>
        <button class="btn-primary" type="submit"><span>save my details</span><span class="btn-arrow" aria-hidden="true">→</span></button>
      </form>
      ${viaEmail ? '<button type="button" class="auth-link" data-new-password>change my password</button>' : '<p class="dialog-small">you sign in with google, so your password is managed by google.</p>'}`);
    const form = $('#profile-form', body);
    const pw = $('[data-new-password]', body); if (pw) pw.addEventListener('click', () => newPasswordDialog(true));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = form.name.value.trim().replace(/\s+/g, ' '), phone = phoneOf(form.phone.value);
      if (name.length < 2) return say(body, 'type your name — at least 2 letters.', true);
      if (phone && !/^\+?[0-9]{8,15}$/.test(phone)) return say(body, 'that phone number does not look right. type it the way you would dial it, like 01712345678.', true);
      const go = $('button[type=submit]', form); go.disabled = true;
      const { error } = await sb.from('profiles').upsert({ id: S.user.id, full_name: name, phone: phone || null });
      go.disabled = false;
      if (error) return say(body, /relation|does not exist|schema cache/i.test(error.message) ? 'saving details is not switched on yet — please try again later.' : plain(error.message), true);
      S.name = name; S.profile = { full_name: name, phone: phone || null }; nameKeep();
      // the courses already joined show the new name to the team too
      sb.from('enrollments').update({ learner_name: name }).eq('user_id', S.user.id).then(() => {}, () => {});
      say(body, 'saved.');
      setTimeout(() => location.reload(), 700);
    });
  }

  function accountDialog() {
    const body = openDialog(`
      <span class="lesson-kicker">${S.admin ? 'admin login' : 'learner account'}</span>
      <h2>${esc(S.name || (S.admin ? 'admin' : 'learner'))}</h2>
      <p>${esc(S.user.email)}</p>
      <ul class="account-list">
        ${S.admin ? '' : '<li><button data-act="profile">my profile — name &amp; phone <span>→</span></button></li>'}
        <li><a href="${U.my()}">my learning <span>→</span></a></li>
        <li><a href="${U.catalog()}">all courses <span>→</span></a></li>
        ${S.admin ? `<li><a href="${A.root}admin/">admin panel <span>→</span></a></li>` : ''}
        <li><button data-act="out">sign out <span>→</span></button></li>
      </ul>`);
    $('[data-act="out"]', body).addEventListener('click', async () => { try { localStorage.removeItem('amaze.name'); } catch (e) {} await sb.auth.signOut(); location.reload(); });
    const prof = $('[data-act="profile"]', body); if (prof) prof.addEventListener('click', profileDialog);
  }

  function newPasswordDialog(change) {
    const body = openDialog(`
      <span class="lesson-kicker">${change ? 'my profile' : 'reset password'}</span><h2>new password</h2><p>choose a new password for your account — at least 8 characters.</p>
      <form><label class="field"><span>new password</span><input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
      <button class="btn-primary" type="submit">save password <span class="btn-arrow" aria-hidden="true">→</span></button></form>`);
    $('form', body).addEventListener('submit', async (e) => {
      e.preventDefault();
      const { error } = await sb.auth.updateUser({ password: new FormData(e.target).get('password') });
      if (error) return say(body, authProblem(error.message), true);
      say(body, 'password updated.'); setTimeout(() => location.reload(), 900);
    });
  }

  function wireAccountButton() {
    const btn = $('#lms-account');
    if (!btn) return;
    btn.textContent = S.user ? (S.admin ? 'admin' : S.name.split(' ')[0] || 'account') : 'sign in';
    btn.addEventListener('click', () => (S.user ? accountDialog() : authDialog()));
  }

  const adminNote = () => (S.admin ? `<div class="lms-notice">you are signed in with an admin login, so you are previewing — nothing you do here is saved as learner progress. to take courses, sign out and use a learner account. <a href="${A.root}admin/" style="color:var(--green)">open the admin panel →</a></div>` : '');
  const notice = () => adminNote() + (S.preview ? '<div class="lms-notice">preview mode — the course database isn\'t connected yet, so these are sample courses and your progress is kept on this device only.</div>' : '');

  // ── course card — image on top, then title, instructor, badges, action ────
  const LOCAL_SAVED = 'amaze.lms.saved';
  const LOCAL_VIEWED = 'amaze.lms.viewed';
  const saved = () => local.get(LOCAL_SAVED);
  const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5 4.2 12.6a4.9 4.9 0 0 1 0-7 5 5 0 0 1 7 0l.8.8.8-.8a5 5 0 0 1 7 0 4.9 4.9 0 0 1 0 7z"/></svg>';
  // addresses saved as site paths (img/courses/x.jpg) are resolved from the site root
  const imageUrl = (v) => (/^(https?:)?\/\//.test(v) ? v : A.root + v);

  function card(course, i, opts = {}) {
    const st = stats(course);
    const going = started(course);
    const n = S.numbers[course.id] || {};
    const out = outside(course);
    const link = out ? outLink(course) : `href="${opts.resume && st.next ? U.learn(course.id, st.next.id) : U.course(course.id)}"`;
    const isSaved = !!saved()[course.id];
    const media = course.cover
      ? `<img src="${esc(imageUrl(course.cover))}" alt="" loading="lazy">`
      : `<span class="ucard-blank"><svg viewBox="0 0 100 100" aria-hidden="true"><path fill-rule="evenodd" d="M10 8H90V52A40 40 0 0 1 10 52Z M22 20H46V44H22Z M54 20H78V44H54Z M22.3 56H46V79.7A28 28 0 0 1 22.3 56Z M77.7 56H54V79.7A28 28 0 0 0 77.7 56Z"/></svg><b>${esc(course.category)}</b></span>`;
    const type = typeOf(course);
    const state = course.starts_at ? liveState(course.starts_at, st.minutes) : '';
    const badges = [
      state === 'live' ? '<span class="b b--live">live now</span>' : state === 'upcoming' ? '<span class="b b--hot">upcoming</span>' : state === 'ended' && type === 'webinar' ? '<span class="b">recording</span>' : '',
      course.featured ? '<span class="b b--hot">featured</span>' : '',
      out ? `<span class="b b--out">on ${esc(out.host)} ↗</span>` : '',
      !going && fee(course).off ? `<span class="b b--off">${fee(course).off}% off</span>` : '',
      `<span class="b">${esc(course.level)}</span>`,
      +n.reviews > 0 ? `<span class="b"><i class="star">★</i> ${(+n.rating).toFixed(1)}</span>` : '',
      +n.reviews > 0 ? `<span class="b">${(+n.reviews).toLocaleString()} rating${+n.reviews === 1 ? '' : 's'}</span>` : '',
      +n.learners > 0 ? `<span class="b">${(+n.learners).toLocaleString()} learner${+n.learners === 1 ? '' : 's'}</span>` : '',
    ].join('');
    const foot = out
      ? `<div class="ucard-price">${priceTag(course)}<small>${course.starts_at ? when(course.starts_at) : 'opens on their website'}</small></div><span class="ucard-btn">view ${type} ↗</span>`
      : going
      ? `<div class="ucard-price"><strong>${st.pct === 100 ? 'completed' : st.pct + '%'}</strong><small>${st.done} of ${st.count} lessons</small></div><span class="ucard-btn">${st.pct === 100 ? 'review' : 'continue'}</span>`
      : `<div class="ucard-price">${priceTag(course)}<small>${course.starts_at ? when(course.starts_at) : `${st.count} lesson${st.count === 1 ? '' : 's'} · ${length(st.minutes)}`}</small></div><span class="ucard-btn">view ${type}</span>`;
    return `<article class="ucard rise" style="animation-delay:${Math.min(i, 6) * 0.05}s">
      <div class="ucard-media">${media}<span class="ucard-flag">${esc(course.category)}</span></div>
      <button class="ucard-save${isSaved ? ' is-on' : ''}" type="button" data-save="${esc(course.id)}" aria-pressed="${isSaved}" aria-label="${isSaved ? 'remove from saved' : 'save for later'}">${HEART}</button>
      <h3 class="ucard-title"><a ${link}>${esc(course.title)}</a></h3>
      <p class="ucard-by">${esc((out && out.by) || course.instructor_name || 'amaze consortium')}</p>
      <div class="ucard-badges">${badges}</div>
      ${going && !out ? `<div class="progress"><i style="width:${st.pct}%"></i></div>` : ''}
      <div class="ucard-foot">${foot}</div>
    </article>`;
  }

  // a titled row of cards that pages sideways with arrows (and swipes on touch)
  function rail(title, courses, opts = {}) {
    if (!courses.length) return '';
    return `<div class="rail"><h3 class="rail-title">${title}</h3>
      <div class="rail-view"><div class="rail-track">${courses.map((c, i) => card(c, i, opts)).join('')}</div>
      <button class="rail-arrow rail-arrow--prev" type="button" aria-label="previous courses" hidden>‹</button>
      <button class="rail-arrow rail-arrow--next" type="button" aria-label="more courses" hidden>›</button></div></div>`;
  }
  function wireRails(root) {
    $$('.rail', root).forEach((r) => {
      const track = $('.rail-track', r), prev = $('.rail-arrow--prev', r), next = $('.rail-arrow--next', r);
      const sync = () => {
        prev.hidden = track.scrollLeft < 8;
        next.hidden = track.scrollLeft + track.clientWidth > track.scrollWidth - 8;
      };
      const page = (dir) => track.scrollBy({ left: dir * Math.max(240, track.clientWidth - 120), behavior: 'smooth' });
      prev.addEventListener('click', () => page(-1));
      next.addEventListener('click', () => page(1));
      track.addEventListener('scroll', sync, { passive: true });
      new ResizeObserver(sync).observe(track);
      sync();
    });
  }
  // the heart on a card: a per-device "saved for later" list
  function wireSaves(root, onChange) {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-save]'); if (!b) return;
      e.preventDefault();
      const all = saved(), id = b.dataset.save;
      if (all[id]) delete all[id]; else all[id] = true;
      local.set(LOCAL_SAVED, all);
      $$(`[data-save="${CSS.escape(id)}"]`).forEach((x) => { x.classList.toggle('is-on', !!all[id]); x.setAttribute('aria-pressed', String(!!all[id])); });
      if (onChange) onChange();
    });
  }

  // lesson rows, used by the course page (accordion) and the player (outline)
  // Until a paid entry has been paid for (and the payment confirmed), its curriculum is
  // closed: every lesson is listed by its title, with a padlock, and none of them opens —
  // no video, no text, no file. ("free preview" only applies to entries that are free.)
  const PADLOCK = '<svg class="kind-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5"/><path d="M5.2 7V4.8a2.8 2.8 0 0 1 5.6 0V7"/></svg>';
  function outline(course, currentId, inPlayer) {
    const all = lessonsOf(course.id);
    const closed = fee(course).paid && !paidUp(course);
    return modulesOf(course.id).map((m, mi) => {
      const ls = all.filter((l) => l.module_id === m.id);
      const mins = ls.reduce((t, l) => t + (l.duration_min || 0), 0);
      const done = ls.filter((l) => S.done[l.id]).length;
      const rows = ls.map((l) => {
        if (closed) return `<li><a class="lesson-row is-closed" href="${U.pay(course.id)}" title="unlocks after payment"><span class="mark"></span><span class="lesson-name"><span class="kind">${PADLOCK}</span><span>${esc(l.title)}</span></span><small><b>locked</b>${KIND[l.kind] || esc(l.kind)}${l.kind === 'live' ? '' : ` · ${l.duration_min} min`}</small></a></li>`;
        const lock = locked(course, l, all);
        const cls = `lesson-row${S.done[l.id] ? ' is-done' : ''}${l.id === currentId ? ' is-current' : ''}${lock ? ' is-locked' : ''}`;
        const live = l.kind === 'live' ? liveState(l.live_at, l.duration_min) : '';
        const tag = `<small>${l.is_preview && !inPlayer ? '<b>preview</b>' : ''}${lock ? '<b>locked</b>' : ''}${live === 'live' ? '<b class="is-live">live now</b>' : ''}${
          l.kind !== 'live' ? `${KIND[l.kind] || esc(l.kind)} · ${l.duration_min} min`
          // the player's side list is narrow: just the day there, the full date on the course page
          : inPlayer ? (live === 'live' ? '' : l.live_at ? new Date(l.live_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toLowerCase() + ' · ' + clock(l.live_at) : 'live · date tba')
          : `live class · ${l.live_at ? when(l.live_at) : 'date to be announced'}`}</small>`;
        return `<li><a class="${cls}" href="${U.learn(course.id, l.id)}"><span class="mark"></span><span class="lesson-name">${kindIcon(l)}<span>${esc(l.title)}</span></span>${tag}</a></li>`;
      }).join('');
      const open = inPlayer ? ls.some((l) => l.id === currentId) || !currentId : mi === 0;
      return `<div class="module${open ? ' is-open' : ''}">
        <button class="module-head" type="button"><small>${pad2(mi + 1)}</small><div><strong>${esc(m.title)}</strong>${m.summary && !inPlayer ? `<em>${esc(m.summary)}</em>` : ''}</div><span>${closed ? `<i class="module-lock">${PADLOCK}</i>` : ''}${inPlayer ? `${done}/${ls.length}` : `${ls.length} lessons · ${length(mins)}`}</span></button>
        <div class="module-lessons"><ul>${rows}</ul></div>
      </div>`;
    }).join('');
  }
  const wireModules = (root) => $$('.module-head', root).forEach((h) => h.addEventListener('click', () => h.parentElement.classList.toggle('is-open')));

  // ── view: academy (catalogue) ──────────────────────────────────────────────
  // Three sections — courses, programs, webinars — each with its own heading
  // (editable in the admin panel) and its first few cards. Choosing a type,
  // category or level, sorting, or searching swaps them for one grid of results.
  function catalog() {
    const browse = $('#academy-browse'), results = $('#course-results'), top = $('#rail-top'), feat = $('#aca-feature');
    const chips = $('#course-chips'), search = $('#course-search'), sort = $('#course-sort'), level = $('#course-level'), category = $('#course-category');
    const SHOWN = 6;   // cards per section before "all …" takes over
    $('#lms-notice').innerHTML = notice();

    // entries on another website have a section of their own ("out"); they are never mixed in with ours
    const of = (type) => S.courses.filter((c) => (type === 'out' ? !!outside(c) : !outside(c) && typeOf(c) === type));
    const OUT = (($('.aca-block[data-kind="out"] .aca-title') || {}).textContent || 'from our subsidiaries and partners').trim().toLowerCase();
    const num = (c, k) => +((S.numbers[c.id] || {})[k] || 0);
    const SORTS = {
      recommended: (a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || a.sort_order - b.sort_order,
      newest: (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0),
      rated: (a, b) => num(b, 'rating') - num(a, 'rating') || num(b, 'reviews') - num(a, 'reviews'),
      popular: (a, b) => num(b, 'learners') - num(a, 'learners'),
    };
    // dated entries: what is coming up first (soonest first), then undated, then what is over (latest first)
    const schedule = (list) => {
      const rank = (c) => (!c.starts_at ? 1 : liveState(c.starts_at, stats(c).minutes) === 'ended' ? 2 : 0);
      return list.slice().sort((a, b) => rank(a) - rank(b)
        || (rank(a) === 0 ? new Date(a.starts_at) - new Date(b.starts_at) : rank(a) === 2 ? new Date(b.starts_at) - new Date(a.starts_at) : 0));
    };

    let active = 'all';
    chips.innerHTML = [['all', 'all', S.courses.length], ...Object.keys(TYPES).map((t) => [t, TYPES[t], of(t).length]), ...(of('out').length ? [['out', OUT, of('out').length]] : [])]
      .map(([t, label, n]) => `<button class="chip${t === 'all' ? ' is-active' : ''}" data-type="${t}">${label}<span>${n}</span></button>`).join('');
    category.innerHTML = '<option value="">any category</option>' + [...new Set(S.courses.map((c) => c.category))].map((c) => `<option>${esc(c)}</option>`).join('');
    level.innerHTML = '<option value="">any level</option>' + [...new Set(S.courses.map((c) => c.level))].map((l) => `<option>${esc(l)}</option>`).join('');
    if (!S.courses.length) $('.catalog-tools').hidden = true;

    const browsing = () => active === 'all' && !search.value.trim() && !level.value && !category.value && sort.value === 'recommended';
    function draw() {
      const plain = browsing();
      browse.hidden = !plain; results.hidden = plain; feat.hidden = !plain || !featured.length;
      if (plain) {
        const going = S.courses.filter((c) => started(c) && stats(c).pct < 100);
        const kept = S.courses.filter((c) => saved()[c.id]);
        top.innerHTML = rail('continue learning', going, { resume: true }) + rail('saved for later', kept);
        wireRails(top);
        $$('.aca-block', browse).forEach((block) => {
          const type = block.dataset.kind;
          const list = schedule(of(type).sort(SORTS.recommended));
          $('.aca-cards', block).innerHTML = list.slice(0, SHOWN).map((c, i) => card(c, i)).join('');
          $('.aca-cards', block).hidden = !list.length;
          $('.aca-empty', block).hidden = !!list.length;
          $('.aca-all', block).hidden = !list.length;
          block.classList.toggle('is-empty', type === 'out' && !list.length);
        });
        return;
      }
      const term = search.value.trim().toLowerCase();
      let list = (active === 'all' ? S.courses : of(active)).filter((c) => true
        && (!category.value || c.category === category.value)
        && (!level.value || c.level === level.value)
        && (!term || `${c.title} ${c.tagline} ${c.category} ${c.description} ${c.instructor_name} ${typeOf(c)} ${(c.tags || []).join(' ')}`.toLowerCase().includes(term)));
      list = sort.value === 'recommended' ? schedule(list.sort(SORTS.recommended)) : list.sort(SORTS[sort.value] || SORTS.recommended);
      const what = active === 'all' ? ['result', 'results'] : active === 'out' ? [OUT, OUT] : [active, TYPES[active]];
      results.innerHTML = list.length
        ? `<h3 class="rail-title">${list.length} ${list.length === 1 ? what[0] : what[1]}</h3><div class="ugrid">${list.map((c, i) => card(c, i)).join('')}</div>`
        : `<p class="lms-empty">${active !== 'all' && !of(active).length ? esc(($(`.aca-block[data-kind="${active}"] .aca-empty`) || {}).textContent || 'nothing here yet.') : 'nothing matches that — try another word, level or category.'}</p>`;
    }
    function pick(type) {
      active = type;
      $$('.chip', chips).forEach((x) => x.classList.toggle('is-active', x.dataset.type === type));
      draw();
    }
    chips.addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) pick(b.dataset.type); });
    // "all webinars →" under a section opens that type on its own, back at the tools
    browse.addEventListener('click', (e) => {
      const all = e.target.closest('.aca-all'); if (!all) return;
      e.preventDefault();
      pick(all.closest('.aca-block').dataset.kind);
      $('#catalogue').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    [search, sort, level, category].forEach((el) => el.addEventListener('input', draw));
    // saving an entry adds or removes it from the "saved for later" row straight away
    wireSaves(browse, () => { if (browsing()) draw(); });
    wireSaves(results);
    // a link such as academy/index.html#webinars opens the page at that section
    const hashType = { '#courses': 'course', '#programs': 'program', '#webinars': 'webinar', '#subsidiaries': 'out' }[location.hash];

    // ── the featured card ────────────────────────────────────────────────────
    // Whatever is marked "featured" in the admin panel is shown above everything
    // else in one large card of its own. With more than one, the card moves on to
    // the next by itself every few seconds, round and round without stopping, and
    // the numbered tabs under it jump straight to one (soonest date comes first).
    const featured = schedule(S.courses.filter((c) => c.featured).sort(SORTS.recommended));
    const startsIn = (d) => {
      const sec = (new Date(d) - Date.now()) / 1000;
      if (sec <= 0) return '';
      const days = Math.floor(sec / 86400);
      return days >= 1 ? `starts in ${days} day${days === 1 ? '' : 's'}` : `starts in ${Math.max(1, Math.floor(sec / 3600))} h`;
    };
    let featAt = 0, featTall = 0;
    window.addEventListener('resize', () => { featTall = 0; const st = $('.feat-stage', feat); if (st) st.style.minHeight = ''; });
    function featShow(i, animate) {
      featAt = i;
      const c = featured[i], st = stats(c), type = typeOf(c), n = S.numbers[c.id] || {};
      const state = c.starts_at ? liveState(c.starts_at, st.minutes) : '';
      const out = outside(c);
      const link = out ? outLink(c) : `href="${started(c) && st.next ? U.learn(c.id, st.next.id) : U.course(c.id)}"`;
      const media = c.cover ? `<img src="${esc(imageUrl(c.cover))}" alt="">`
        : `<span class="feat-blank"><svg viewBox="0 0 100 100" aria-hidden="true"><path fill-rule="evenodd" d="M10 8H90V52A40 40 0 0 1 10 52Z M22 20H46V44H22Z M54 20H78V44H54Z M22.3 56H46V79.7A28 28 0 0 1 22.3 56Z M77.7 56H54V79.7A28 28 0 0 0 77.7 56Z"/></svg><b>${esc(c.category)}</b></span>`;
      const facts = [
        c.starts_at ? [type === 'webinar' ? 'date' : 'starts', when(c.starts_at)] : ['pace', 'start any time'],
        out ? ['where', esc(out.host)] : ['lessons', `${st.count} · ${length(st.minutes)}`],
        ['level', esc(c.level)],
        out ? ['fee', priceTag(c)] : +n.reviews > 0 ? ['rating', `★ ${(+n.rating).toFixed(1)} (${n.reviews})`] : ['fee', priceTag(c)],
      ];
      const soon = state === 'upcoming' ? startsIn(c.starts_at) : '';
      $('.feat-stage', feat).innerHTML = `<article class="feat${animate ? ' is-new' : ''}">
        <div class="feat-in">
          <a class="feat-media" ${link} tabindex="-1" aria-hidden="true">${media}<span class="feat-sheen"></span></a>
          <div class="feat-body">
            <div class="feat-kicker"><span class="feat-star"><i aria-hidden="true">★</i>featured ${type}</span>${state === 'live' ? '<span class="feat-state is-live">live now</span>' : soon ? `<span class="feat-state">${soon}</span>` : ''}</div>
            <h2 class="feat-title"><a ${link}>${esc(c.title)}</a></h2>
            ${c.tagline ? `<p class="feat-tag">${esc(c.tagline)}</p>` : ''}
            <ul class="feat-facts">${facts.map(([k, v]) => `<li><small>${k}</small><span>${v}</span></li>`).join('')}</ul>
            <div class="feat-foot">
              <a class="btn-primary" ${link}>${out ? 'view ' + type + ' on ' + esc(out.host) : started(c) ? (st.pct === 100 ? 'review' : 'continue') : state === 'live' ? 'join now' : 'view ' + type} <span class="btn-arrow" aria-hidden="true">${out ? '↗' : '→'}</span></a>
              <span class="feat-by">${out && out.by ? 'by' : 'with'} <b>${esc((out && out.by) || c.instructor_name || 'amaze consortium')}</b></span>
            </div>
          </div>
        </div>
      </article>`;
      $$('.feat-tabs button', feat).forEach((b, k) => {
        b.classList.toggle('is-on', k === i); b.setAttribute('aria-pressed', String(k === i));
        // the bar on the active tab is the timer: restarting it starts the wait for the next change
        const bar = $('i', b); bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = '';
      });
      // entries differ in height; the card keeps the tallest so the page below never jumps when it changes
      const stage = $('.feat-stage', feat);
      featTall = Math.max(featTall, stage.firstElementChild.offsetHeight);
      stage.style.minHeight = featTall + 'px';
    }
    if (featured.length) {
      $('.feat-tabs', feat).innerHTML = featured.length > 1
        ? featured.map((c, k) => `<button type="button" data-feat="${k}"><small>${pad2(k + 1)}</small><span>${esc(c.title)}</span><em>${typeOf(c)}</em><i></i></button>`).join('') : '';
      $('.feat-tabs', feat).hidden = featured.length < 2;
      feat.addEventListener('click', (e) => { const b = e.target.closest('[data-feat]'); if (b && !b.classList.contains('is-on')) featShow(+b.dataset.feat, true); });
      // when the active tab's bar has run its course, the next entry swipes in — after the last comes the first again
      feat.addEventListener('animationend', (e) => { if (e.animationName === 'feat-bar' && featured.length > 1 && !feat.hidden) featShow((featAt + 1) % featured.length, true); });
      // it waits while the card is off screen, and while the pointer is on it so it can be read and clicked
      new IntersectionObserver(([en]) => feat.classList.toggle('is-away', !en.isIntersecting), { threshold: 0.2 }).observe(feat);
      featShow(0, false);
    }
    draw();
    if (hashType) { const b = $(`.aca-block[data-kind="${hashType}"]`); if (b) setTimeout(() => b.scrollIntoView({ block: 'start' }), 400); }

    // questions & answers: the list saved in the admin panel replaces the one the page came with;
    // an empty list leaves the whole part out
    const asked = savedFaq('academy'), faqEl = $('.faq');
    if (asked && faqEl) {
      faqEl.innerHTML = asked.map((x) => `<div class="faq-item"><button class="faq-q" type="button" aria-expanded="false"><span>${esc(x.q)}</span><i aria-hidden="true">+</i></button><div class="faq-a"><div><p>${esc(x.a)}</p></div></div></div>`).join('');
      const part = faqEl.closest('section'); if (part) part.hidden = !asked.length;
    }
    $$('.faq-q').forEach((q) => q.addEventListener('click', () => {
      const item = q.closest('.faq-item'), open = item.classList.contains('is-open');
      $$('.faq-item.is-open').forEach((x) => x.classList.remove('is-open'));
      item.classList.toggle('is-open', !open);
      q.setAttribute('aria-expanded', String(!open));
    }));
  }

  // ── view: course page ──────────────────────────────────────────────────────
  async function coursePage() {
    const root = $('#course-root');
    const course = S.courses.find((c) => c.id === Q.c);
    if (!course) {
      root.innerHTML = '<section class="course-hero"><div class="course-hero-inner"><a class="crumb" href="${U.catalog()}">← academy</a><h1 class="course-h1">not found.</h1><p class="page-sub" style="margin:28px 0 96px;">it may have been renamed or unpublished.</p></div></section>';
      return;
    }
    document.title = `${course.title} — amaze consortium`;
    const noun = typeOf(course);   // course | program | webinar
    try { localStorage.setItem(LOCAL_VIEWED, course.id); } catch (e) {}
    const [reviews, news] = S.preview ? [[], []] : await Promise.all([
      soft(sb.from('course_reviews').select('*').eq('course_id', course.id).order('created_at', { ascending: false })),
      soft(sb.from('course_announcements').select('*').eq('course_id', course.id).order('created_at', { ascending: false }).limit(5)),
    ]);
    const shown = reviews.filter((r) => !r.is_hidden);
    const mineReview = S.user && reviews.find((r) => r.user_id === S.user.id);
    const st = stats(course);
    const going = started(course);
    const open = course.access === 'open' || S.preview;
    const lessonUrl = (l) => `${U.learn(course.id, l.id)}`;
    const preview = st.lessons.find((l) => l.is_preview);
    let action;
    const out = outside(course);
    const price = fee(course), mustPay = price.paid && !paidUp(course);
    if (out) action = `<a class="btn-primary" ${outLink(course)}>go to the ${noun} on ${esc(out.host)} <span class="btn-arrow" aria-hidden="true">↗</span></a>${price.label ? `<span class="was-note"><b style="color:var(--fg)">${esc(price.label)}</b>${price.was ? ` <s>${esc(price.was)}</s> ${price.off}% off` : ''}</span>` : ''}`;
    else if (!st.count) action = '<span class="btn-outline" style="pointer-events:none;opacity:0.6;">lessons coming soon <span class="btn-arrow" aria-hidden="true">→</span></span>';
    // a paid entry: "enrol now" leads to the payment page; while a payment is being checked it says so
    else if (mustPay) action = `<a class="btn-primary" href="${U.pay(course.id)}">${payState(course) === 'pending' ? 'payment being checked' : payState(course) === 'rejected' ? 'payment not confirmed — try again' : (noun === 'webinar' ? 'register now' : 'enrol now') + ' — ' + price.label} <span class="btn-arrow" aria-hidden="true">→</span></a>${price.was && !payState(course) ? `<span class="was-note"><s>${esc(price.was)}</s> ${price.off}% off</span>` : ''}`;
    else if (going) action = `<a class="btn-primary" href="${lessonUrl(st.next)}">${st.pct === 100 ? 'review the ' + noun : noun === 'webinar' ? 'open the webinar' : 'continue learning'} <span class="btn-arrow" aria-hidden="true">→</span></a>`;
    else if (S.user || open) action = `<button class="btn-primary" id="enrol" type="button">${S.admin ? 'preview the lessons' : S.user ? (noun === 'webinar' ? 'register — it\'s free' : 'enrol — it\'s free') : 'start the ' + noun} <span class="btn-arrow" aria-hidden="true">→</span></button>`;
    else action = `<button class="btn-primary" id="join" type="button">create a free account to ${noun === 'webinar' ? 'register' : 'enrol'} <span class="btn-arrow" aria-hidden="true">→</span></button>`;
    const second = !out && !going && preview && !open && !mustPay ? `<a class="btn-outline" href="${lessonUrl(preview)}">try a free lesson <span class="btn-arrow" aria-hidden="true">→</span></a>` : '';
    const done100 = st.pct === 100 && st.count > 0;
    const initials = (course.instructor_name || 'a').trim()[0];
    // for someone who has not started: the whole path in four short steps
    const steps = out || going || S.admin || !st.count ? [] : price.paid ? [
      [signInWords(), emailOn() ? 'with google in one click, or with your email.' : 'one click — no password to make or remember.'],
      [`pay ${price.label} by bkash`, 'send the fee from your bkash app, then type the transaction id here.'],
      ['we confirm it', 'usually within a day. the lessons then open by themselves.'],
      [noun === 'webinar' ? 'join the session' : 'learn, then get your certificate', noun === 'webinar' ? 'it happens on this website — nothing to install.' : 'at your own pace, on your phone or laptop.'],
    ] : [
      [signInWords(), emailOn() ? 'with google in one click, or with your email.' : 'one click — no password to make or remember.'],
      [noun === 'webinar' ? 'press “register”' : 'press “enrol”', 'it is free. nothing to pay.'],
      [noun === 'webinar' ? 'join the session' : 'learn at your own pace', noun === 'webinar' ? 'it happens on this website — nothing to install.' : 'on your phone or laptop. your place is saved.'],
      ['get your certificate', 'when you finish every lesson.'],
    ];
    const live = out ? null : nextLive(course);
    const liveNow = live && liveState(live.live_at, live.duration_min) === 'live';
    const liveCard = live ? `<div class="next-live rise${liveNow ? ' is-now' : ''}"><div><span class="live-flag">${liveNow ? 'live now' : 'next live class'}</span><strong>${esc(live.title)}</strong>
        <p>${when(live.live_at)} — ${liveNow ? 'it has started' : `in <b data-until="${esc(live.live_at)}">${until(live.live_at)}</b>`}. the class happens on this website; nothing to install.</p></div>
        <div class="hero-buttons">${mustPay ? '' : `<a class="btn-${liveNow ? 'primary' : 'outline'}" href="${lessonUrl(live)}">${liveNow ? 'go to the class' : 'open the class page'} <span class="btn-arrow" aria-hidden="true">→</span></a>`}
          ${liveNow ? '' : `<a class="btn-outline" href="${esc(calLink(live, course))}" target="_blank" rel="noopener noreferrer">add to my calendar <span class="btn-arrow" aria-hidden="true">+</span></a>`}</div></div>` : '';
    const kinds = (k) => st.lessons.filter((l) => l.kind === k).length;
    // "this course includes": the list written in the admin panel, or — if that
    // is left empty — one worked out from the lessons themselves
    const includes = (course.includes || []).length
      ? course.includes.map((r) => [r.label, r.value])
      : [
        kinds('video') && ['video lessons', kinds('video')],
        kinds('article') && ['readings', kinds('article')],
        kinds('quiz') && ['quizzes', kinds('quiz')],
        kinds('form') && ['tests & assignments', kinds('form')],
        kinds('live') && ['live classes', kinds('live')],
        ['notes & q&a', 'on every lesson'],
        ['pace', kinds('live') ? 'live, on set dates' : 'your own'],
        price.paid ? ['fee', price.label + (price.was ? ` (was ${price.was})` : '')] : ['access', course.access === 'open' ? 'open to everyone' : 'free account'],
        ['certificate', 'verifiable'],
      ].filter(Boolean);
    const social = [rating(course), learners(course), course.updated_at ? `updated ${new Date(course.updated_at).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toLowerCase()}` : '', esc(course.language || '')].filter(Boolean).join(' · ');
    const bullets = (title, items, cls = 'outcomes') => ((items || []).length ? `<div class="course-block rise"><h2>${title}</h2><ul class="${cls}">${items.map((o) => `<li>${esc(o)}</li>`).join('')}</ul></div>` : '');
    const avg = shown.length ? shown.reduce((t, r) => t + r.rating, 0) / shown.length : 0;
    const bars = [5, 4, 3, 2, 1].map((n) => {
      const c = shown.filter((r) => r.rating === n).length;
      return `<li><span>${n} ★</span><div class="progress"><i style="width:${shown.length ? (c / shown.length) * 100 : 0}%"></i></div><span>${c}</span></li>`;
    }).join('');
    const reviewForm = S.user && !S.admin && S.enrolled[course.id] && !mineReview ? `
      <form class="review-form" id="review-form">
        <span class="lesson-kicker">rate this course</span>
        <div class="star-pick" role="radiogroup" aria-label="rating">${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="rating" value="${n}" required><span>★</span></label>`).join('')}</div>
        <label class="field"><span>what did you think? (optional)</span><textarea name="body" rows="3" maxlength="1500"></textarea></label>
        <button class="btn-outline" type="submit">post review <span class="btn-arrow" aria-hidden="true">→</span></button>
        <small class="hint">reviews are public and can't be edited once posted.</small>
      </form>` : '';
    const reviewsBlock = !S.preview && (shown.length || reviewForm || mineReview) ? `<div class="course-block rise" id="reviews"><h2>learner reviews</h2>
        ${shown.length ? `<div class="review-summary"><div><strong>${avg.toFixed(1)}</strong><span class="stars">★★★★★</span><small>${shown.length} review${shown.length === 1 ? '' : 's'}</small></div><ul>${bars}</ul></div>` : '<p class="lms-empty" style="padding:28px 0;">no reviews yet — be the first.</p>'}
        ${reviewForm}
        ${mineReview && mineReview.is_hidden ? '<p class="lms-notice" style="margin-top:20px;">your review is currently hidden by a moderator.</p>' : ''}
        <ul class="reviews">${shown.slice(0, 20).map((r) => `<li><div class="review-top"><strong>${esc(r.author_name)}</strong><span class="stars">${'★'.repeat(r.rating)}<i>${'★'.repeat(5 - r.rating)}</i></span><small>${ago(r.created_at)}</small></div>${r.body ? `<p>${esc(r.body)}</p>` : ''}</li>`).join('')}</ul>
      </div>` : '';

    root.innerHTML = `
      <section class="course-hero${course.cover ? ' has-cover' : ''}">
        ${course.cover ? `<div class="course-hero-bg" aria-hidden="true"><img src="${esc(imageUrl(course.cover))}" alt="" decoding="async" onerror="this.parentNode.remove()"></div>` : ''}
        <div class="course-hero-inner">
          ${notice()}
          <a class="crumb rise" href="${U.catalog()}">← academy</a>
          <div class="hero-tag rise"><i></i>${esc(course.category)}</div>
          <h1 class="course-h1 rise rise-2">${esc(course.title)}</h1>
          ${social ? `<div class="course-social course-social--lg rise rise-2">${social}</div>` : ''}
          <div class="course-hero-foot rise rise-3">
            <div>
              <p class="page-sub">${esc(course.tagline || '')}</p>
              <div class="course-actions" style="margin-top:28px;">
                <div class="hero-buttons" style="justify-content:flex-start;" id="course-cta">${action}${second}${going || S.admin || payState(course) === 'paid' ? '' : aidButton(course)}</div>
                ${out ? `<p class="ask">this ${noun} is run by ${esc(out.by || out.host)} on their own website — you enrol, pay and learn there. the button opens it beside this page.</p>` : ''}
                ${going || S.admin || out ? '' : `<p class="ask">a question before you start? ${helpLink('i have a question about “' + course.title + '”')}</p>`}
                ${going ? `<div class="progress"><i style="width:${st.pct}%"></i></div><small>${st.done} of ${st.count} lessons complete${done100 ? ` · <a href="${U.cert({ c: course.id })}" style="color:var(--green)">get your certificate →</a>` : ''}</small>` : ''}
              </div>
            </div>
            <ul class="course-facts">
              <li><small>level</small><span>${esc(course.level)}</span></li>
              ${course.starts_at ? `<li><small>${noun === 'webinar' ? 'date' : 'starts'}</small><span>${when(course.starts_at)}</span></li>` : `<li><small>duration</small><span>${esc(course.duration || 'self-paced')}</span></li>`}
              ${out ? `<li><small>where</small><span style="text-transform:none;">${esc(out.host)}</span></li><li><small>run by</small><span>${esc(out.by || course.instructor_name || out.host)}</span></li>` : `<li><small>lessons</small><span>${st.count}</span></li>
              <li><small>study time</small><span>${length(st.minutes)}</span></li>`}
            </ul>
          </div>
        </div>
      </section>
      <section style="border-top:1px solid var(--line);">
        <div class="course-body">
          <div>
            ${liveCard}
            ${steps.length ? `<div class="course-block rise"><h2>how it works</h2><ol class="how">${steps.map(([t, d], i) => `<li><b>${i + 1}</b><div><strong>${t}</strong><span>${d}</span></div></li>`).join('')}</ol></div>` : ''}
            ${news.length ? `<div class="course-block rise"><h2>announcements</h2><ul class="news">${news.map((n) => `<li><small>${ago(n.created_at)}</small><strong>${esc(n.title)}</strong>${n.body ? `<div class="prose">${markdown(n.body)}</div>` : ''}</li>`).join('')}</ul></div>` : ''}
            ${course.trailer_url ? `<div class="course-block rise"><h2>watch the introduction</h2><div class="lesson-video" style="margin:0;">${videoEmbed(course.trailer_url, { guard: true })}</div></div>` : ''}
            ${course.description ? `<div class="course-block rise"><h2>about this ${noun}</h2><p class="course-desc">${esc(course.description)}</p></div>` : ''}
            ${bullets('what you will be able to do', course.outcomes)}
            ${(course.tags || []).length ? `<div class="course-block rise"><h2>skills you will gain</h2><ul class="tags">${course.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
            ${out ? `<div class="course-block rise"><h2>where it happens</h2><div class="cur-lock"><div><strong>on ${esc(out.host)}.</strong>
                <p>the lessons, the enrolment and any fee are on ${esc(out.by || 'their')} website, not here. we list it because we think it is worth your time.</p></div>
                <a class="btn-primary" ${outLink(course)}>go to the ${noun} <span class="btn-arrow" aria-hidden="true">↗</span></a></div></div>` : ''}
            <div class="course-block rise"${out ? ' hidden' : ''}><h2>curriculum${mustPay ? ' — locked' : course.sequential ? ' — lessons unlock in order' : ''}</h2>
              ${mustPay && st.count ? `<div class="cur-lock">${PADLOCK}<div><strong>${payState(course) === 'pending' ? 'your payment is being checked.' : payState(course) === 'rejected' ? 'we could not confirm your payment.' : `the lessons open once you have enrolled and paid.`}</strong>
                <p>${payState(course) === 'pending' ? 'as soon as we confirm it, every lesson below unlocks for your account.' : payState(course) === 'rejected' ? 'open the payment page to see why, and enter your transaction id again.' : `this ${noun} has ${modulesOf(course.id).length} module${modulesOf(course.id).length === 1 ? '' : 's'} and ${st.count} lesson${st.count === 1 ? '' : 's'}${kinds('live') ? `, ${kinds('live')} of them live` : ''}. you can read the lesson titles below; the videos, readings and files open after you pay and we confirm it — nothing more to do.`}</p></div>
                <a class="btn-primary" href="${U.pay(course.id)}">${payState(course) ? 'open the payment page' : (noun === 'webinar' ? 'register now' : 'enrol now') + ' — ' + price.label} <span class="btn-arrow" aria-hidden="true">→</span></a></div>` : ''}
              ${outline(course, null, false) || '<p class="lms-empty">lessons are being added.</p>'}</div>
            ${bullets('before you start', course.requirements, 'plain-list')}
            ${bullets(`who this ${noun} is for`, course.audience, 'plain-list')}
            ${reviewsBlock}
          </div>
          <aside class="course-side rise rise-2">
            ${course.instructor_name ? `<div class="side-card"><h3>taught by</h3><div class="instructor"><div class="instructor-photo">${course.instructor_img ? `<img src="${esc(course.instructor_img)}" alt="">` : esc(initials)}</div><div><strong>${esc(course.instructor_name)}</strong><span>${esc(course.instructor_role || '')}</span></div></div></div>` : ''}
            <div class="side-card"${out && !(course.includes || []).length ? ' hidden' : ''}><h3>this ${noun} includes</h3><ul class="includes">
              ${includes.map(([label, value]) => `<li>${esc(label)} <b>${esc(value)}</b></li>`).join('')}
            </ul></div>
          </aside>
        </div>
      </section>
      ${st.count || out ? `<div class="sticky-cta" id="sticky-cta" hidden><div><strong>${esc(course.title)}</strong><span>${out ? 'on ' + esc(out.host) : going ? `${st.done} of ${st.count} lessons done` : esc(price.label)}</span></div><button class="btn-primary" type="button">${out ? 'view ' + noun + ' ↗' : going ? (st.pct === 100 ? 'review' : 'continue') : mustPay ? (payState(course) ? 'payment' : noun === 'webinar' ? 'register' : 'enrol') : 'start'} <span class="btn-arrow" aria-hidden="true">→</span></button></div>` : ''}`;

    // on a phone the main button stays in reach once the one at the top has scrolled away
    const sticky = $('#sticky-cta', root), cta = $('#course-cta', root);
    if (sticky && cta && 'IntersectionObserver' in window) {
      new IntersectionObserver(([en]) => { sticky.hidden = en.isIntersecting; document.body.classList.toggle('has-sticky', !en.isIntersecting); }, { threshold: 0 }).observe(cta);
      $('button', sticky).addEventListener('click', () => { const b = $('a.btn-primary, button.btn-primary', cta); if (b) b.click(); });
    }
    // the countdown keeps itself up to date
    setInterval(() => $$('[data-until]', root).forEach((b) => { b.textContent = until(b.dataset.until); }), 30000);

    wireModules(root);
    // the introduction video plays in our own player (no watermark: anyone may watch it)
    $$('.course-block .vp', root).forEach((el) => guard(el));
    const enrolBtn = $('#enrol');
    if (enrolBtn) enrolBtn.addEventListener('click', async () => { enrolBtn.disabled = true; await enrol(course); location.href = lessonUrl(st.next); });
    const join = $('#join');
    if (join) join.addEventListener('click', () => authDialog('signup'));
    const rf = $('#review-form');
    if (rf) rf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(rf);
      const { error } = await sb.from('course_reviews').insert({ user_id: S.user.id, course_id: course.id, rating: +f.get('rating'), body: f.get('body').trim() || null, author_name: S.name || 'learner' });
      if (error) { rf.insertAdjacentHTML('beforeend', `<p class="dialog-msg is-error">${esc(error.message)}</p>`); return; }
      location.hash = 'reviews'; location.reload();
    });
  }

  // ── view: lesson player ────────────────────────────────────────────────────
  async function player() {
    const root = $('#player-root');
    const course = S.courses.find((c) => c.id === Q.c);
    if (!course) { location.replace(U.catalog()); return; }
    if (outside(course)) { location.replace(U.course(course.id)); return; }
    const all = lessonsOf(course.id);
    const lesson = all.find((l) => l.id === Q.l) || stats(course).next;
    if (!lesson) { location.replace(`${U.course(course.id)}`); return; }
    const idx = all.indexOf(lesson);
    const prev = all[idx - 1], next = all[idx + 1];
    const mod = S.modules.find((m) => m.id === lesson.module_id);
    const url = (l) => `${U.learn(course.id, l.id)}`;
    const courseUrl = `${U.course(course.id)}`;
    const isLocked = locked(course, lesson, all);
    document.title = `${lesson.title} — ${course.title}`;
    local.set(LOCAL_LAST, { c: course.id, l: lesson.id, at: Date.now() });

    // a paid entry opens once the payment is confirmed — every lesson of it, previews included
    const payLocked = !isLocked && fee(course).paid && !paidUp(course);
    const content = isLocked || payLocked ? null : await getContent(lesson);
    const [news, comments, noteRow] = S.preview || !content ? [[], [], null] : await Promise.all([
      soft(sb.from('course_announcements').select('*').eq('course_id', course.id).order('created_at', { ascending: false }).limit(10)),
      S.user ? soft(sb.from('lesson_comments').select('*').eq('lesson_id', lesson.id).order('created_at')) : [],
      S.user ? soft(sb.from('lesson_notes').select('body').eq('lesson_id', lesson.id).eq('user_id', S.user.id).maybeSingle(), null) : null,
    ]);
    const resources = (content && content.resources) || [];
    let note = S.user ? ((noteRow && noteRow.body) || '') : (local.get(LOCAL_NOTES)[lesson.id] || '');

    function bar() {
      const st = stats(course);
      return `<a class="exit" href="${courseUrl}" aria-label="back to the course">←</a>
        <strong>${esc(course.title)}</strong>
        <button class="side-toggle" type="button">course content</button>
        <span class="pct">${st.done} / ${st.count} · ${st.pct}%</span>
        <div class="progress"><i style="width:${st.pct}%"></i></div>`;
    }

    // The page is laid out the way course sites do it: one large stage for the thing itself
    // (the video, the document, the reading, the quiz…), the course content list down the
    // right, and tabs underneath. `bodyHtml` is what goes on the stage; `about` is any
    // written text that belongs with a video or document and is shown under "overview".
    let bodyHtml, about = '', stageKind = 'page', resumeAt = 0;
    // a document a reading lesson is built around: a pdf attached to it (or a google drive file)
    const isDoc = (r) => /\.pdf($|[?#])/i.test(String(r.url || '')) || /drive\.google\.com\/file\/d\//.test(String(r.url || ''));
    let docs = [];
    if (payLocked) {
      const waiting = payState(course) === 'pending';
      bodyHtml = `<div class="gate"><strong>${waiting ? 'your payment is being checked.' : `this lesson is part of a paid ${typeOf(course)}.`}</strong>
        <p>${waiting ? 'as soon as it is confirmed, every lesson here unlocks for your account by itself.' : `enrol to unlock every lesson, the live classes, your notes and the certificate. the fee is ${fee(course).label}.`}</p>
        <div class="hero-buttons"><a class="btn-primary" href="${U.pay(course.id)}">${waiting ? 'open the payment page' : 'enrol now'} <span class="btn-arrow" aria-hidden="true">→</span></a>
        ${waiting ? '' : aidButton(course)}
        <a class="btn-outline" href="${courseUrl}">back to the ${typeOf(course)} <span class="btn-arrow" aria-hidden="true">→</span></a></div>
        <p class="ask">${waiting ? 'waiting longer than a day?' : 'not sure how to pay?'} ${helpLink('i need help with my payment for “' + course.title + '”')}</p></div>`;
    } else if (isLocked) {
      const need = all.find((l) => !S.done[l.id]);
      bodyHtml = `<div class="gate"><strong>this lesson unlocks in order.</strong><p>finish the lessons before it first — you are up to “${esc(need.title)}”.</p>
        <div class="hero-buttons"><a class="btn-primary" href="${url(need)}">go to that lesson <span class="btn-arrow" aria-hidden="true">→</span></a></div></div>`;
    } else if (!content) {
      bodyHtml = `<div class="gate"><strong>this lesson is for enrolled learners.</strong>
        <p>create a free account to unlock every lesson in this course, keep your progress and notes, and earn the certificate.</p>
        <div class="hero-buttons"><button class="btn-primary" type="button" data-auth="signup">create a free account <span class="btn-arrow" aria-hidden="true">→</span></button>
        <button class="btn-outline" type="button" data-auth="signin">sign in <span class="btn-arrow" aria-hidden="true">→</span></button></div></div>`;
    } else if (lesson.kind === 'quiz' && (content.quiz || []).length) {
      const qs = content.quiz;
      bodyHtml = (content.body ? `<div class="prose" style="margin-bottom:32px;">${markdown(content.body)}</div>` : '') + `<form class="quiz">${qs.map((q, qi) => `
        <fieldset class="quiz-q">
          <h3><small>${pad2(qi + 1)}</small><span>${inline(q.q)}</span></h3>
          <div class="quiz-options">${q.options.map((o, oi) => `<label class="quiz-option"><input type="radio" name="q${qi}" value="${oi}" required><span>${inline(o)}</span></label>`).join('')}</div>
          ${q.why ? `<p class="quiz-why">${inline(q.why)}</p>` : ''}
        </fieldset>`).join('')}
        <div class="quiz-result" hidden></div>
        <div class="lesson-foot" style="border-top:0;margin-top:28px;padding-top:0;"><span></span><button class="btn-primary" type="submit">check my answers <span class="btn-arrow" aria-hidden="true">→</span></button></div>
      </form>`;
    } else if (lesson.kind === 'live') {
      // The class happens here, on the lesson page: a video room (camera, microphone, screen
      // share, chat, raised hands) opens on the stage when "enter the live class" is pressed.
      // Who may go in, and when, is decided by the live-room function on the server — this
      // page only shows the door. See supabase/functions/live-room. The room is Daily's when
      // a Daily key is saved, and otherwise the built-in one further down.
      stageKind = 'live';
      about = content.body || '';
      bodyHtml = '<div class="live-stage" id="live-stage"></div>'
        + (content.video_url ? `<div class="live-rec"><span class="lesson-kicker">recording</span><div class="lesson-video">${videoEmbed(content.video_url, { guard: true })}</div></div>` : '');
    } else if (lesson.kind === 'form') {
      about = content.body || '';
      bodyHtml = (content.form_url ? `<div class="lesson-form"><iframe src="${esc(formEmbed(safeUrl(content.form_url)))}" title="${esc(lesson.title)}" loading="lazy">loading…</iframe></div>
          <p class="form-alt">form not showing? <a href="${esc(safeUrl(content.form_url))}" target="_blank" rel="noopener noreferrer">open it in a new tab ↗</a> — then come back and mark it as submitted.</p>`
          : '<p class="lms-empty">the form for this lesson hasn\'t been added yet.</p>');
    } else if (content.video_url) {
      stageKind = 'video'; about = content.body || '';
      // a video carries on from where it was stopped last time (unless it was nearly over)
      const seen = +(local.get(LOCAL_WATCH)[lesson.id] || 0);
      resumeAt = seen > 15 && !S.done[lesson.id] ? seen : 0;
      bodyHtml = `<div class="lesson-video">${videoEmbed(content.video_url, { guard: true, resume: resumeAt })}</div>`;
    } else if ((docs = resources.filter(isDoc)).length) {
      // a reading built around a pdf: the pages are drawn right here, one under another
      stageKind = 'doc'; about = content.body || '';
      bodyHtml = `<div class="lp-doc">
          <div class="lp-doc-bar">${docs.length > 1 ? `<div class="lp-doc-pick">${docs.map((d, i) => `<button type="button" data-doc="${i}"${i ? '' : ' class="is-on"'}>${esc(d.label || 'document ' + (i + 1))}</button>`).join('')}</div>` : `<strong>${esc(docs[0].label || 'document')}</strong>`}
            <div class="lp-doc-tools" hidden>
              <button type="button" data-zoom="out" aria-label="zoom out" title="zoom out">−</button><span id="doc-zoom" aria-live="polite">100%</span><button type="button" data-zoom="in" aria-label="zoom in" title="zoom in">+</button>
              <button type="button" data-zoom="fit" title="fit the page to the width">fit</button>
              <span class="lp-doc-count" id="doc-count" title="page"></span>
              <button type="button" id="doc-full">full screen</button>
            </div>
            <div class="lp-doc-links"><button type="button" id="doc-save">download</button><a id="doc-open" href="${esc(safeUrl(docs[0].url))}" target="_blank" rel="noopener noreferrer">open ↗</a></div></div>
          <div class="lp-doc-pages" id="doc-pages"><p class="lp-doc-msg">opening the document…</p></div>
        </div>`;
    } else {
      stageKind = 'read';
      bodyHtml = `<div class="lp-read"><div class="lp-read-in"><h1 class="lesson-title">${esc(lesson.title)}</h1><div class="prose">${markdown(content.body)}</div></div></div>`;
    }
    if (payLocked || isLocked || !content) stageKind = 'gate';

    const usable = !!content;
    const isQuiz = usable && lesson.kind === 'quiz' && (content.quiz || []).length > 0;
    // a class that hasn't happened yet can't be marked as attended
    const waiting = usable && lesson.kind === 'live' && ['upcoming', 'tba'].includes(liveState(lesson.live_at, lesson.duration_min)) && !S.done[lesson.id];
    const doneLabel = lesson.kind === 'form' ? (next ? 'i have submitted it — continue' : 'i have submitted it — finish')
      : lesson.kind === 'live' ? (next ? 'i attended — continue' : 'i attended — finish')
      : (next ? 'complete & continue' : 'complete the course');
    const tabs = usable ? `
      <div class="tabs-bar" role="tablist">
        <button class="tab is-active" data-tab="overview">overview</button>
        <button class="tab" data-tab="notes">notes</button>
        <button class="tab" data-tab="resources">resources<span>${resources.length}</span></button>
        <button class="tab" data-tab="qa">q&amp;a<span>${comments.filter((c) => !c.parent_id).length}</span></button>
        <button class="tab" data-tab="news">announcements<span>${news.length}</span></button>
      </div>
      <div class="tab-panel" data-panel="overview">
        ${about ? `<div class="prose">${markdown(about)}</div>` : ''}
        <div class="lp-about${about ? ' has-text' : ''}">
          <div><small>${esc(typeOf(course))}</small><strong>${esc(course.title)}</strong>${course.tagline ? `<p>${esc(course.tagline)}</p>` : ''}</div>
          <ul><li><small>this lesson</small><span>${idx + 1} of ${all.length}</span></li><li><small>section</small><span>${esc(mod ? mod.title : '—')}</span></li><li><small>taught by</small><span>${esc(course.instructor_name || 'amaze consortium')}</span></li></ul>
        </div>
      </div>
      <div class="tab-panel" data-panel="notes" hidden>
        <label class="field" style="margin-top:0;"><span>private notes for this lesson — only you can see them</span><textarea id="note" rows="6" placeholder="write as you go…">${esc(note)}</textarea></label>
        <small class="hint" id="note-status">${S.user ? 'saved to your account' : 'saved on this device — sign in to keep notes across devices'}</small>
      </div>
      <div class="tab-panel" data-panel="resources" hidden>
        ${resources.length ? `<ul class="resources">${resources.map((r) => `<li><a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener noreferrer"${/\.pdf($|[?#])/i.test(String(r.url || '')) ? ` download="${esc(String(r.label || 'document').replace(/\.pdf$/i, ''))}.pdf"` : ''}><span class="lesson-name">${ICON.file}<span>${esc(r.label || r.url)}</span></span><i>↓</i></a></li>`).join('')}</ul>` : '<p class="lms-empty" style="padding:28px 0;">no files or links for this lesson.</p>'}
      </div>
      <div class="tab-panel" data-panel="qa" hidden id="qa"></div>
      <div class="tab-panel" data-panel="news" hidden>
        ${news.length ? `<ul class="news">${news.map((n) => `<li><small>${ago(n.created_at)}</small><strong>${esc(n.title)}</strong>${n.body ? `<div class="prose">${markdown(n.body)}</div>` : ''}</li>`).join('')}</ul>` : '<p class="lms-empty" style="padding:28px 0;">no announcements for this course.</p>'}
      </div>` : '';

    // the course content list: sections that fold, a tick box per lesson, the current one marked
    const closedByFee = fee(course).paid && !paidUp(course);
    const canTick = (l) => !closedByFee && !locked(course, l, all) && l.kind !== 'quiz' && !(l.kind === 'live' && ['upcoming', 'tba'].includes(liveState(l.live_at, l.duration_min)));
    function sideList() {
      let n = 0;
      return modulesOf(course.id).map((m, mi) => {
        const ls = all.filter((l) => l.module_id === m.id);
        const mins = ls.reduce((t, l) => t + (l.duration_min || 0), 0), done = ls.filter((l) => S.done[l.id]).length;
        const rows = ls.map((l) => {
          n += 1;
          const isDone = !!S.done[l.id], shut = closedByFee || locked(course, l, all);
          const meta = l.kind === 'live' ? (l.live_at ? new Date(l.live_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toLowerCase() + ' · ' + clock(l.live_at) : 'date tba') : `${l.duration_min}min`;
          const box = shut ? `<span class="lp-tick is-shut" title="locked">${PADLOCK}</span>`
            : canTick(l) ? `<button class="lp-tick${isDone ? ' is-on' : ''}" type="button" data-tick="${l.id}" aria-pressed="${isDone}" aria-label="${isDone ? 'mark as not done' : 'mark as done'}: ${esc(l.title)}"></button>`
              : `<span class="lp-tick${isDone ? ' is-on' : ''}" title="${l.kind === 'quiz' ? 'ticked when you pass the quiz' : 'ticked after the class'}"></span>`;
          return `<li class="lp-item${l.id === lesson.id ? ' is-current' : ''}${isDone ? ' is-done' : ''}${shut ? ' is-shut' : ''}">${box}
            <a class="lp-row" href="${closedByFee ? `${U.pay(course.id)}` : url(l)}"><span class="lesson-name">${n}. ${esc(l.title)}</span><span class="lp-meta">${ICON[l.kind] || ICON.article}<span>${meta}</span></span></a></li>`;
        }).join('');
        return `<div class="lp-sec${ls.some((l) => l.id === lesson.id) ? ' is-open' : ''}">
          <button class="lp-sec-head" type="button" aria-expanded="${ls.some((l) => l.id === lesson.id)}"><div><strong>section ${mi + 1}: ${esc(m.title)}</strong><span>${done} / ${ls.length} | ${length(mins)}</span></div><i aria-hidden="true"></i></button>
          <ul>${rows}</ul></div>`;
      }).join('');
    }
    let sideOpen = true; try { sideOpen = localStorage.getItem('amaze.lms.side') !== '0'; } catch (e) {}

    root.innerHTML = `
      <header class="player-bar">${bar()}</header>
      <div class="lp${sideOpen ? '' : ' is-wide'}">
        <main class="lp-main">
          <section class="lp-stage lp-stage--${stageKind}" aria-label="${esc(lesson.title)}">
            ${prev ? `<a class="lp-nav lp-nav--prev" href="${url(prev)}" title="previous: ${esc(prev.title)}" aria-label="previous lesson">‹</a>` : ''}
            ${bodyHtml}
            ${next ? `<a class="lp-nav lp-nav--next" href="${url(next)}" title="next: ${esc(next.title)}" aria-label="next lesson">›</a>` : ''}
          </section>
          <div class="lp-under"><article class="lesson rise">
            ${notice()}
            <div class="lp-note" id="lp-note"${resumeAt ? '' : ' hidden'}>${resumeAt ? `<span>carrying on from <b>${mmss(resumeAt)}</b>, where you stopped.</span><button class="linkish" type="button" id="from-start">start from the beginning</button>` : ''}</div>
            <div class="lp-head">
              <div><div class="lesson-kicker lesson-name">${kindIcon(lesson)}<span>${esc(mod ? mod.title : '')} · lesson ${idx + 1} of ${all.length} · ${KIND[lesson.kind] || esc(lesson.kind)}</span></div>
                ${stageKind === 'read' ? '' : `<h1 class="lesson-title">${esc(lesson.title)}</h1>`}</div>
              <div class="lesson-foot">
                ${waiting ? (next && !course.sequential ? `<a class="btn-outline" href="${url(next)}">next lesson <span class="btn-arrow" aria-hidden="true">→</span></a>` : '<span class="form-alt" style="margin:0;">you can mark this as attended once the class has started.</span>') : ''}
                ${usable && !isQuiz && !waiting ? `<button class="btn-primary" id="complete" type="button">${S.done[lesson.id] ? (next ? 'next lesson' : 'finish') : doneLabel} <span class="btn-arrow" aria-hidden="true">→</span></button>` : ''}
                ${isQuiz ? `<a class="btn-outline" id="after-quiz" href="${next ? url(next) : courseUrl}"${S.done[lesson.id] ? '' : ' hidden'}>${next ? 'next lesson' : 'back to the course'} <span class="btn-arrow" aria-hidden="true">→</span></a>` : ''}
              </div>
            </div>
            ${tabs}
          </article></div>
        </main>
        <aside class="lp-side" aria-label="course content">
          <div class="lp-side-top"><strong>course content</strong><button class="lp-side-close" type="button" aria-label="hide the course content list">✕</button></div>
          <div class="lp-side-list">${sideList()}</div>
        </aside>
      </div>`;

    const layout = $('.lp', root), side = $('.lp-side-list', root);
    function setSide(open) { sideOpen = open; layout.classList.toggle('is-wide', !open); try { localStorage.setItem('amaze.lms.side', open ? '1' : '0'); } catch (e) {} }
    const wireBar = () => $('.side-toggle', root).addEventListener('click', () => { setSide(!sideOpen); if (sideOpen && window.innerWidth <= 1000) $('.lp-side', root).scrollIntoView({ behavior: 'smooth' }); });
    $('.lp-side-close', root).addEventListener('click', () => setSide(false));
    // sections fold; a tick box marks a lesson done (or not done again) without leaving the page
    side.addEventListener('click', async (e) => {
      const head = e.target.closest('.lp-sec-head');
      if (head) { const open = head.parentElement.classList.toggle('is-open'); head.setAttribute('aria-expanded', String(open)); return; }
      const tick = e.target.closest('[data-tick]'); if (!tick) return;
      const l = all.find((x) => x.id === tick.dataset.tick); if (!l || !canTick(l)) return;
      tick.disabled = true;
      if (S.done[l.id]) {
        delete S.done[l.id];
        if (S.user && !S.admin) await sb.from('lesson_progress').delete().eq('user_id', S.user.id).eq('lesson_id', l.id);
        else local.set(LOCAL_PROGRESS, S.done);
      } else await markDone(course, l);
      refreshProgress();
    });

    // ── a pdf, read inside the lesson ────────────────────────────────────────
    // Drawn page by page with pdf.js (kept on this site, js/vendor), so it reads the same on a
    // phone as on a laptop. The reader can zoom in and out (buttons, or ctrl + scroll), go back
    // to "fit the width", fill the whole screen, and download the file or open it in a new tab.
    const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
    const doc = { pdf: null, zoom: 1, token: 0, seen: null, timer: null };
    const docName = (r) => (String(r.label || 'document').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'document').replace(/\.pdf$/i, '') + '.pdf';
    // the width one page takes at 100%: the reading column, or the screen on a phone
    const pageWidth = (box) => Math.max(200, Math.min(box.clientWidth - (window.innerWidth <= 700 ? 16 : 48), 980));
    function drawPages() {
      const box = $('#doc-pages', root); if (!doc.pdf || !box) return;
      const w = Math.round(pageWidth(box) * doc.zoom), at = box.scrollHeight ? box.scrollTop / box.scrollHeight : 0;
      if (doc.seen) doc.seen.disconnect();
      const pdf = doc.pdf, token = doc.token;
      // each page is drawn when it comes near the screen, not all at once
      doc.seen = new IntersectionObserver((entries) => entries.forEach(async (en) => {
        if (!en.isIntersecting || en.target.dataset.w === String(w)) return;
        en.target.dataset.w = String(w);
        const page = await pdf.getPage(+en.target.dataset.page);
        // sharp on a good screen, but never so large that a phone runs out of memory
        const scale = Math.min((w / page.getViewport({ scale: 1 }).width) * Math.min(2, window.devicePixelRatio || 1), 4096 / page.getViewport({ scale: 1 }).width);
        const view = page.getViewport({ scale }), canvas = document.createElement('canvas');
        canvas.width = Math.floor(view.width); canvas.height = Math.floor(view.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: view }).promise;
        if (token !== doc.token || en.target.dataset.w !== String(w)) return;   // zoomed or switched again meanwhile
        en.target.replaceChildren(canvas);
        en.target.classList.add('is-drawn');
      }), { root: box, rootMargin: '900px 0px' });
      $$('.lp-page', box).forEach((el) => { el.style.width = w + 'px'; doc.seen.observe(el); });
      box.classList.toggle('is-zoomed', doc.zoom > 1);
      box.scrollTop = at * box.scrollHeight;
      if (doc.zoom > 1) box.scrollLeft = (box.scrollWidth - box.clientWidth) / 2;
      const label = $('#doc-zoom', root); if (label) label.textContent = Math.round(doc.zoom * 100) + '%';
      const out = $('[data-zoom="out"]', root), inn = $('[data-zoom="in"]', root);
      if (out) out.disabled = doc.zoom <= ZOOMS[0]; if (inn) inn.disabled = doc.zoom >= ZOOMS[ZOOMS.length - 1];
    }
    function setZoom(z) { doc.zoom = Math.min(ZOOMS[ZOOMS.length - 1], Math.max(ZOOMS[0], z)); clearTimeout(doc.timer); doc.timer = setTimeout(drawPages, 60); }
    const stepZoom = (dir) => { const i = ZOOMS.findIndex((z) => z >= doc.zoom - 0.001); setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? ZOOMS.length - 1 : i) + dir))]); };
    function showPageNumber() {
      const box = $('#doc-pages', root), count = $('#doc-count', root); if (!doc.pdf || !box || !count) return;
      const mid = box.getBoundingClientRect().top + box.clientHeight * 0.35;
      const now = $$('.lp-page', box).find((el) => el.getBoundingClientRect().bottom > mid);
      count.textContent = `${now ? now.dataset.page : doc.pdf.numPages} / ${doc.pdf.numPages}`;
    }

    async function openDoc(r) {
      const box = $('#doc-pages', root), count = $('#doc-count', root), link = safeUrl(r.url), tools = $('.lp-doc-tools', root);
      const token = (doc.token += 1); doc.pdf = null; doc.zoom = 1;
      $('#doc-open', root).href = link; count.textContent = '';
      const drive = /drive\.google\.com\/file\/d\/([^/]+)/.exec(link);
      // a google drive file is shown by google's own viewer, which brings its own zoom
      if (drive) { tools.hidden = true; box.classList.add('is-frame'); box.innerHTML = `<iframe class="lp-doc-frame" src="https://drive.google.com/file/d/${esc(drive[1])}/preview" title="${esc(r.label || 'document')}" allow="autoplay"></iframe>`; return; }
      tools.hidden = false; box.classList.remove('is-frame');
      box.innerHTML = '<p class="lp-doc-msg">opening the document…</p>';
      try {
        if (!window.pdfjsLib) await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = A.root + 'js/vendor/pdf.min.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = A.root + 'js/vendor/pdf.worker.min.js';
        // (isEvalSupported off: the site's security headers do not allow code built from strings, and pdf.js does not need it)
        const pdf = await window.pdfjsLib.getDocument({ url: link, isEvalSupported: false }).promise;
        if (token !== doc.token) return;   // another document was chosen while this one was loading
        const first = await pdf.getPage(1), shape = first.getViewport({ scale: 1 });
        box.innerHTML = Array.from({ length: pdf.numPages }, (_, i) => `<div class="lp-page" data-page="${i + 1}" style="aspect-ratio:${shape.width}/${shape.height};"></div>`).join('');
        doc.pdf = pdf;
        drawPages(); showPageNumber();
      } catch (e) {
        if (token !== doc.token) return;
        tools.hidden = true;
        box.innerHTML = `<div class="lp-doc-msg"><strong>this document could not be shown here.</strong><p>open it in a new tab instead — it will open or download there.</p><a class="btn-primary" href="${esc(link)}" target="_blank" rel="noopener noreferrer">open the document <span class="btn-arrow" aria-hidden="true">↗</span></a></div>`;
      }
    }
    // saves the file itself (a plain link to another site's file would only open it)
    async function downloadDoc(r, btn) {
      const link = safeUrl(r.url), was = btn.textContent;
      btn.disabled = true; btn.textContent = 'downloading…';
      try {
        const res = await fetch(link); if (!res.ok) throw new Error('not found');
        const href = URL.createObjectURL(await res.blob());
        const a = document.createElement('a'); a.href = href; a.download = docName(r); document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 20000);
        btn.textContent = 'downloaded';
      } catch (e) { window.open(link, '_blank', 'noopener'); btn.textContent = was; }
      setTimeout(() => { btn.textContent = was; btn.disabled = false; }, 1800);
    }
    // ── a live class ─────────────────────────────────────────────────────────
    if (stageKind === 'live') {
      const stage = $('#live-stage', root), OPENS = 15, STAYS = 30;   // minutes: the same as the server's
      const mins = Math.max(15, lesson.duration_min || 60);
      const outside = content.live_url ? safeUrl(content.live_url) : '';   // an optional link to somewhere else, kept as a way in if the room is not set up
      const cal = calLink(lesson, course);
      // tba | early (more than 15 minutes to go) | open (the door is open) | live | over
      const phase = () => {
        if (!lesson.live_at) return 'tba';
        const start = +new Date(lesson.live_at), now = Date.now();
        return now < start - OPENS * 60000 ? 'early' : now < start ? 'open' : now < start + mins * 60000 ? 'live' : now < start + (mins + STAYS) * 60000 ? 'late' : 'over';
      };
      const wait = () => { const s = Math.max(0, (+new Date(lesson.live_at) - OPENS * 60000 - Date.now()) / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.ceil((s % 3600) / 60); return d ? `${d} day${d === 1 ? '' : 's'}${h ? ` ${h} h` : ''}` : h ? `${h} h ${m} min` : `${Math.max(1, m)} min`; };
      let inRoom = false, problem = '', busy = false, shown = '';

      function door() {
        const ph = phase();
        const canEnter = S.admin || ph === 'open' || ph === 'live' || ph === 'late';
        const flag = { tba: 'live class — date to be announced', early: 'upcoming live class', open: 'the room is open', live: 'live now', late: 'live now — running over', over: 'this class has ended' }[ph];
        shown = ph + '|' + problem + '|' + busy;
        stage.className = 'live-stage';
        stage.innerHTML = `<div class="live live--${ph === 'early' ? 'upcoming' : ph === 'over' ? 'ended' : ph === 'tba' ? 'tba' : 'live'}">
            <span class="live-flag">${flag}</span>
            ${lesson.live_at ? `<strong class="live-when">${when(lesson.live_at)}</strong><small>shown in your own time zone · about ${length(mins)}</small>` : '<small>the date will be shown here as soon as it is set.</small>'}
            ${ph === 'early' ? `<p class="live-note">the room opens ${OPENS} minutes before the start — in <b>${wait()}</b>. come back to this page then; the class happens right here.</p>` : ''}
            ${ph === 'open' || ph === 'live' || ph === 'late' ? '<p class="live-note">the class happens right here on this page. your camera and microphone start switched off — you choose when to turn them on.</p>' : ''}
            ${ph === 'over' ? `<p class="live-note">${content.video_url ? 'the recording is below.' : 'if a recording is published, it will appear on this page.'}</p>` : ''}
            ${S.admin && ph !== 'open' && ph !== 'live' && ph !== 'late' ? '<p class="live-note">you are an admin, so you can open the room at any time — to test it, or to start early. learners can only come in around the class time.</p>' : ''}
            ${problem ? `<p class="dialog-msg is-error" role="alert">${esc(problem)}</p>` : ''}
            <div class="hero-buttons">
              ${canEnter ? `<button class="btn-primary" id="live-enter" type="button"${busy ? ' disabled' : ''}>${busy ? 'opening the room…' : S.admin ? (ph === 'live' || ph === 'open' || ph === 'late' ? 'start teaching' : 'open the room') : 'enter the live class'} <span class="btn-arrow" aria-hidden="true">→</span></button>` : ''}
              ${cal && ph === 'early' ? `<a class="btn-outline" href="${esc(cal)}" target="_blank" rel="noopener noreferrer">add to my calendar <span class="btn-arrow" aria-hidden="true">+</span></a>` : ''}
              ${ph !== 'over' && ph !== 'tba' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia ? '<button class="btn-outline" id="live-test" type="button">test my camera &amp; microphone <span class="btn-arrow" aria-hidden="true">→</span></button>' : ''}
              ${outside && ph !== 'over' && ph !== 'tba' ? `<a class="btn-outline" href="${esc(outside)}" target="_blank" rel="noopener noreferrer">join by link instead <span class="btn-arrow" aria-hidden="true">↗</span></a>` : ''}
            </div>
            <div class="live-check" id="live-check" hidden></div>
            ${ph === 'over' ? '' : `<p class="ask">trouble getting in? ${helpLink('i cannot get into the live class “' + lesson.title + '”')}</p>`}
          </div>`;
        const enter = $('#live-enter', stage);
        if (enter) enter.addEventListener('click', () => { stopCheck(); goIn(); });
        const test = $('#live-test', stage);
        if (test) test.addEventListener('click', deviceCheck);
        if (checking) deviceCheck();   // the door was redrawn while a check was open: keep it open
      }

      // ── before the class: does my camera work, can my microphone hear me? ──
      // Nothing is sent anywhere — the picture is only shown back to the learner, and the
      // microphone is only measured for the bar. Both are switched off again when the check is closed.
      let checking = false, checkStream = null, checkFrame = 0, checkAudio = null;
      function stopCheck() {
        checking = false; cancelAnimationFrame(checkFrame);
        if (checkStream) { checkStream.getTracks().forEach((t) => t.stop()); checkStream = null; }
        if (checkAudio) { try { checkAudio.close(); } catch (e) {} checkAudio = null; }
        const box = $('#live-check', stage); if (box) { box.hidden = true; box.innerHTML = ''; }
      }
      async function deviceCheck() {
        const box = $('#live-check', stage); if (!box) return;
        if (checking && checkStream && !box.hidden) return stopCheck();
        checking = true; box.hidden = false;
        box.innerHTML = '<p class="live-check-msg">your browser will ask to use the camera and microphone — press “allow”.</p>';
        const reason = (e) => (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'the browser blocked it. press the padlock beside the website address, allow the camera and microphone, then test again.' : e && e.name === 'NotFoundError' ? 'none was found on this device.' : e && e.name === 'NotReadableError' ? 'another app is using it — close that app and test again.' : 'it could not be started.');
        if (checkStream) { checkStream.getTracks().forEach((t) => t.stop()); checkStream = null; }
        let cam = null, mic = null, camWhy = '', micWhy = '';
        try { cam = (await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 } } })).getVideoTracks()[0]; } catch (e) { camWhy = reason(e); }
        try { mic = (await navigator.mediaDevices.getUserMedia({ audio: true })).getAudioTracks()[0]; } catch (e) { micWhy = reason(e); }
        if (!checking) { [cam, mic].forEach((t) => t && t.stop()); return; }
        checkStream = new MediaStream([cam, mic].filter(Boolean));
        box.innerHTML = `<div class="live-check-in">
            <div class="live-check-pic">${cam ? '<video autoplay playsinline muted></video>' : '<span>no picture</span>'}</div>
            <ul>
              <li class="${cam ? 'is-ok' : 'is-bad'}"><b>${cam ? '✓' : '!'}</b><div><strong>camera ${cam ? 'works' : 'is not working'}</strong><span>${cam ? 'that is you in the picture. a camera is optional in class.' : esc(camWhy)}</span></div></li>
              <li class="${mic ? 'is-ok' : 'is-bad'}"><b>${mic ? '✓' : '!'}</b><div><strong>microphone ${mic ? 'works' : 'is not working'}</strong><span>${mic ? 'say something — the bar below should move.' : esc(micWhy)}</span>${mic ? '<div class="live-meter"><i></i></div>' : ''}</div></li>
            </ul></div>
          <div class="hero-buttons"><button class="btn-outline" type="button" id="live-check-done">${cam || mic ? 'done — close the test' : 'close'} <span class="btn-arrow" aria-hidden="true">✓</span></button></div>
          <p class="live-check-msg">${cam && mic ? 'everything works. in class both start switched off — you turn them on when you want.' : !cam && !mic ? 'you can still join and listen, and write in the chat.' : 'you can still join the class with what works.'}</p>`;
        const v = $('video', box); if (v) v.srcObject = new MediaStream([cam]);
        $('#live-check-done', box).addEventListener('click', stopCheck);
        if (mic) {
          try {
            checkAudio = new (window.AudioContext || window.webkitAudioContext)();
            const an = checkAudio.createAnalyser(); an.fftSize = 256;
            checkAudio.createMediaStreamSource(new MediaStream([mic])).connect(an);
            const buf = new Uint8Array(an.frequencyBinCount), bar = $('.live-meter i', box);
            const tick = () => { if (!checking) return; an.getByteTimeDomainData(buf); let peak = 0; for (let i = 0; i < buf.length; i += 1) peak = Math.max(peak, Math.abs(buf[i] - 128)); if (bar) bar.style.width = Math.min(100, Math.round((peak / 60) * 100)) + '%'; checkFrame = requestAnimationFrame(tick); };
            tick();
          } catch (e) {}
        }
      }
      window.addEventListener('pagehide', stopCheck);

      async function goIn() {
        if (busy) return;
        if (!S.user) { authDialog('signin'); return; }
        busy = true; problem = ''; door();
        let got = null, why = '', own = false;
        const sid = newId();
        try {
          const { data, error } = await sb.functions.invoke('live-room', { body: { lesson_id: lesson.id, session: sid } });
          got = data;
          if (error) { got = null; try { const said = await error.context.json(); why = said.message || said.error || ''; if (said.error === 'not_configured') own = true; } catch (e) { why = ''; } }
        } catch (e) { got = null; }
        busy = false;
        const big = !!(got && got.provider === 'livekit' && got.url && got.token);
        if (own || big) { if (!window.RTCPeerConnection) { problem = 'this browser cannot do video calls. open the class in chrome, safari, edge or firefox.'; door(); return; } return openBuiltIn(big ? { sfu: got, id: got.session || sid } : {}); }
        if (!got || !got.url || !got.token) { problem = why || 'the room could not be opened. check your connection and try again.'; door(); return; }
        inRoom = true;
        // the room itself: a page from the video service, given the camera, microphone and screen for as long as it is open
        stage.className = 'live-stage is-room';
        stage.innerHTML = `<div class="live-bar"><span class="live-flag">${got.host ? 'you are teaching' : 'live class'}</span><strong>${esc(lesson.title)}</strong>
            <a class="linkish" href="${esc(got.url + '?t=' + got.token)}" target="_blank" rel="noopener noreferrer" id="live-tab" title="if your camera or microphone will not turn on here">open in its own tab ↗</a>
            <button class="btn btn--leave" type="button" id="live-leave">leave</button></div>
          <iframe class="live-frame" title="live class: ${esc(lesson.title)}" src="${esc(got.url + '?t=' + got.token)}" allow="camera; microphone; fullscreen; display-capture; autoplay; speaker-selection" allowfullscreen></iframe>`;
        $('#live-leave', stage).addEventListener('click', () => { inRoom = false; door(); });
        // going to the separate tab means leaving this one, or there would be two of you in the room
        $('#live-tab', stage).addEventListener('click', () => { inRoom = false; door(); });
        stage.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
      // ── the built-in room ────────────────────────────────────────────────────
      // A live class with nothing to set up: every browser in the room connects straight
      // to every other one (WebRTC), and they find each other through this site's own
      // Supabase project (a private Realtime channel that only admins and learners the entry
      // is open to may use — see can_join_live in the database). Good for small classes:
      // with direct connections everyone sends their video to everyone, so it is capped.
      // For big classes the same room sends its sound and pictures through a LiveKit server
      // instead (one connection each, however many people): that happens by itself when the
      // LiveKit keys are saved — see supabase/functions/live-room. Names, chat, raised hands
      // and "mute everyone" travel over the Supabase channel either way.
      const ROOM_CAP = 12, BIG_ROOM_CAP = 90;
      const newId = () => (crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
      const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
      const MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></svg>';
      const CAM = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6.5" width="12" height="11"/><path d="M15 10.5l6-3.5v10l-6-3.5z"/></svg>';
      const SCR = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="12"/><path d="M8.5 20.5h7M12 16.5v4M12 13.5v-6M9.5 10l2.5-2.5 2.5 2.5"/></svg>';
      const HAND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5a1.5 1.5 0 0 1 3 0V11m0-5a1.5 1.5 0 0 1 3 0v8.5c0 3.6-2.4 6-6 6s-5.2-1.9-6.5-4.6L4 14.2c-.4-.9.7-1.8 1.5-1.2L8 15"/></svg>';
      const CHAT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H10l-4 3.5V16H4z"/></svg>';
      const END = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 14.5c0-1 .4-1.900 1.200-2.500C6.300 10.400 9 9.500 12 9.500s5.700.9 7.800 2.500c.8.600 1.200 1.500 1.200 2.500v1.300c0 .6-.5 1-1.100.9l-3.100-.6c-.5-.1-.8-.5-.8-1v-1.700c-1.200-.4-2.600-.6-4-.6s-2.800.2-4 .6v1.700c0 .5-.3.9-.8 1l-3.100.6c-.6.1-1.100-.3-1.100-.9z"/></svg>';
      const PPL = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.6-3 2.7-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/><circle cx="17" cy="9.5" r="2.3"/><path d="M16 14.6c2.400 0 4 1.3 4.5 3.9"/></svg>';

      // How the people in a room reach each other. The site uses its Supabase project; a test
      // can put its own in window.__liveTransport to stand in for it.
      // Who is in the room comes from the channel's presence, which each person sets ONCE:
      // Supabase allows a person only a handful of presence changes per half minute and closes
      // the channel beyond that. So what changes all the time — microphone, camera, screen,
      // raised hand — is sent as ordinary messages instead, and told again to anyone who arrives.
      function supabaseTransport(topic, id) {
        let ch = null, on = null, card = null, mine = null, gone = false, joined = false, again = null, tell = null;
        const states = new Map(), known = new Set();
        const flags = (x) => ({ cam: !!x.cam, mic: !!x.mic, screen: !!x.screen, hand: !!x.hand });
        const sendState = () => { if (ch && mine) ch.send({ type: 'broadcast', event: 'st', payload: { id, ...flags(mine) } }); };
        const emit = () => {
          if (!ch || !on) return;
          const st = ch.presenceState(), ids = Object.keys(st);
          const fresh = ids.some((k) => k !== id && !known.has(k));
          [...known].filter((k) => !st[k]).forEach((k) => { known.delete(k); states.delete(k); });
          ids.forEach((k) => known.add(k));
          on.people(ids.map((k) => ({ id: k, ...st[k][st[k].length - 1], ...(states.get(k) || {}) })));
          // someone new cannot know what they missed: say it again, not all at the same instant
          if (fresh && mine && Object.values(flags(mine)).some(Boolean)) { clearTimeout(tell); tell = setTimeout(sendState, 300 + Math.random() * 1200); }
        };
        function open(done, fail) {
          ch = sb.channel(topic, { config: { private: true, broadcast: { self: false }, presence: { key: id } } });
          const mineCh = ch;
          ch.on('presence', { event: 'sync' }, emit);
          ch.on('broadcast', { event: 'st' }, ({ payload }) => { if (!payload || payload.id === id) return; states.set(payload.id, flags(payload)); emit(); });
          ch.on('broadcast', { event: 'sig' }, ({ payload }) => { if (payload.to === id) on.signal(payload); });
          ch.on('broadcast', { event: 'chat' }, ({ payload }) => on.chat(payload));
          ch.on('broadcast', { event: 'cmd' }, ({ payload }) => on.cmd(payload));
          ch.subscribe(async (status) => {
            if (gone || ch !== mineCh) return;
            if (status === 'SUBSCRIBED') { await ch.track(card); joined = true; sendState(); if (done) { done(); done = null; } }
            else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              if (!joined) { if (fail) { fail(new Error(status)); fail = null; } return; }
              // the line dropped in the middle of a class: come back by ourselves
              clearTimeout(again); again = setTimeout(() => { if (gone) return; try { sb.removeChannel(mineCh); } catch (e) {} open(); }, 2500);
            }
          });
        }
        return {
          join(info, handlers) { on = handlers; mine = info; card = { name: info.name, host: !!info.host, at: info.at }; return new Promise((resolve, reject) => open(resolve, reject)); },
          send: (event, payload) => ch && ch.send({ type: 'broadcast', event, payload }),
          update: (info) => { mine = info; sendState(); },
          leave() { gone = true; clearTimeout(again); clearTimeout(tell); if (ch) { try { ch.untrack(); } catch (e) {} sb.removeChannel(ch); ch = null; } },
        };
      }

      async function openBuiltIn(opt = {}) {
        inRoom = true;   // from this moment the stage belongs to the room: the door must not redraw itself over it
        const me = opt.id || newId();
        const sfu = opt.sfu || null, cap = sfu ? BIG_ROOM_CAP : ROOM_CAP;
        const host = sfu ? !!sfu.host : !!S.admin;
        const my = { name: (S.name || (S.user && S.user.email ? S.user.email.split('@')[0] : '') || 'learner').slice(0, 40), host, cam: false, mic: false, screen: false, hand: false, at: Date.now() };
        const peers = new Map();    // id → { pc, a, v, stream, queue, out, timer, info }
        const net = (window.__liveTransport || supabaseTransport)('live:' + lesson.id, me);
        let micTrack = null, camTrack = null, screenTrack = null, people = [], chat = [], unread = 0, panel = '', closed = false;
        const videoOut = () => screenTrack || camTrack || null;

        stage.className = 'live-stage is-room is-own';
        const ico = (svg) => `<i class="mr-ico">${svg}</i>`;
        stage.innerHTML = `<div class="live-bar"><span class="live-flag">${host ? 'you are teaching' : 'live class'}</span><strong>${esc(lesson.title)}</strong>
            <span class="mr-clock" id="mr-clock" title="time in this class">00:00</span><span class="mr-count" id="mr-count"></span></div>
          <div class="mr"><div class="mr-grid" id="mr-grid"></div>
            <p class="mr-alone" id="mr-alone" hidden><b>you are the first one here.</b> everyone else appears as they come in.</p>
            <p class="mr-msg" id="mr-msg" role="status"></p>
            <aside class="mr-side" id="mr-side" hidden></aside></div>
          <div class="mr-controls" role="toolbar" aria-label="class controls">
            <div class="mr-set">
              <button type="button" data-do="mic" aria-pressed="false" title="microphone">${ico(MIC)}<span>unmute</span></button>
              <button type="button" data-do="cam" aria-pressed="false" title="camera">${ico(CAM)}<span>start video</span></button>
            </div>
            <div class="mr-set">
              ${navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia ? `<button type="button" data-do="screen" aria-pressed="false" title="share your screen">${ico(SCR)}<span>share screen</span></button>` : ''}
              <button type="button" data-do="hand" aria-pressed="false" title="raise your hand">${ico(HAND)}<span>raise hand</span></button>
            </div>
            <div class="mr-set">
              <button type="button" data-do="people" title="people in the class">${ico(PPL)}<span>people</span></button>
              <button type="button" data-do="chat" title="chat">${ico(CHAT)}<span>chat</span><i class="mr-dot" hidden></i></button>
            </div>
            <div class="mr-set mr-set--end">
              <button class="mr-leave" type="button" id="live-leave" title="leave the class">${ico(END)}<span>leave</span></button>
            </div>
          </div>`;
        const grid = $('#mr-grid', stage), side = $('#mr-side', stage), msg = $('#mr-msg', stage);
        // who is in the room, written over every picture in it (the watermark). if it is tampered
        // with, the pictures go blank until the class is joined again.
        const roomMark = S.user ? String(S.user.email || S.name || '').trim() : '';
        if (roomMark) watermark($('.mr', stage), roomMark, () => { stage.classList.add('is-veiled'); msg.textContent = 'the watermark was changed, so the pictures are hidden. leave and join the class again.'; });
        const say = (t, bad) => { msg.textContent = t || ''; msg.classList.toggle('is-bad', !!bad); if (t) setTimeout(() => { if (msg.textContent === t) msg.textContent = ''; }, 6000); };
        const btn = (k) => $(`[data-do="${k}"]`, stage);
        const setBtn = (k, on, label) => { const b = btn(k); if (!b) return; b.setAttribute('aria-pressed', String(on)); b.classList.toggle('is-on', on); $('span', b).textContent = label; };

        // ── tiles ──
        function tile(id, info, mine) {
          let el = $(`[data-peer="${id}"]`, grid);
          if (!el) {
            el = document.createElement('div'); el.className = 'mr-tile' + (mine ? ' is-me' : ''); el.dataset.peer = id;
            el.innerHTML = `<video autoplay playsinline${mine ? ' muted' : ''}></video><div class="mr-face"><i></i></div><b class="mr-hand" hidden>${HAND}<em>hand up</em></b><div class="mr-name"><i class="mr-mic">${MIC}</i><span></span></div>`;
            grid.appendChild(el);
          }
          const showing = info.cam || info.screen;
          el.classList.toggle('has-video', !!showing); el.classList.toggle('is-screen', !!info.screen); el.classList.toggle('is-muted', !info.mic);
          $('.mr-face i', el).textContent = (info.name || '?').trim()[0] || '?';
          el.classList.toggle('has-hand', !!info.hand);
          $('.mr-name span', el).textContent = (mine ? 'you' : info.name) + (info.host ? ' · teacher' : '') + (info.screen ? ' · screen' : '');
          $('.mr-hand', el).hidden = !info.hand;
          return el;
        }
        function layout() {
          const n = grid.children.length, sharing = $('.mr-tile.is-screen', grid);
          grid.dataset.n = String(Math.min(n, 12)); grid.classList.toggle('is-big', n > 12); grid.classList.toggle('has-screen', !!sharing);
          $('#mr-count', stage).textContent = `${n} in the class`;
          $('#mr-alone', stage).hidden = n !== 1;
          // whoever is sharing a screen goes first and large; then the teacher; then cameras that are on; then everyone else
          const order = [...grid.children], sorted = order.slice().sort((a, b) => (b.classList.contains('is-screen') - a.classList.contains('is-screen')) || ((b.dataset.host === '1') - (a.dataset.host === '1')) || (b.classList.contains('has-video') - a.classList.contains('has-video')));
          if (sorted.some((el, i) => el !== order[i])) sorted.forEach((el) => grid.appendChild(el));
          if (panel === 'people') drawSide();
        }

        // ── connections: one to each other person; the one with the smaller id makes the call ──
        function connect(id) {
          const pc = new RTCPeerConnection({ iceServers: ICE });
          const p = { pc, a: null, v: null, stream: new MediaStream(), queue: [], out: [], timer: null, info: {} };
          peers.set(id, p);
          pc.ontrack = (e) => { p.stream.addTrack(e.track); const el = $(`[data-peer="${id}"] video`, grid); if (el && el.srcObject !== p.stream) el.srcObject = p.stream; };
          // ice candidates are sent a few at a time, not one message each
          pc.onicecandidate = (e) => { if (!e.candidate) return; p.out.push(e.candidate.toJSON()); clearTimeout(p.timer); p.timer = setTimeout(() => { net.send('sig', { from: me, to: id, cands: p.out.splice(0) }); }, 120); };
          pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' && me < id) pc.restartIce(); if (pc.connectionState === 'connected') tune(p); };
          pc.onnegotiationneeded = async () => { if (me > id) return; try { await pc.setLocalDescription(); net.send('sig', { from: me, to: id, desc: pc.localDescription.toJSON() }); } catch (e) {} };
          return p;
        }
        function call(id) {
          const p = connect(id);
          // one audio and one video line each way from the start, so turning a camera on or off later never needs a new call
          p.a = p.pc.addTransceiver('audio', { direction: 'sendrecv' }); p.v = p.pc.addTransceiver('video', { direction: 'sendrecv' });
          p.a.sender.replaceTrack(micTrack); p.v.sender.replaceTrack(videoOut());
        }
        async function onSignal({ from, desc, cands }) {
          let p = peers.get(from); if (!p) p = connect(from);
          const pc = p.pc;
          try {
            if (desc && desc.type === 'offer') {
              await pc.setRemoteDescription(desc);
              pc.getTransceivers().forEach((t) => { const kind = t.receiver.track.kind; t.direction = 'sendrecv'; if (kind === 'audio') { p.a = t; t.sender.replaceTrack(micTrack); } else { p.v = t; t.sender.replaceTrack(videoOut()); } });
              await pc.setLocalDescription(await pc.createAnswer());
              net.send('sig', { from: me, to: from, desc: pc.localDescription.toJSON() });
            } else if (desc) await pc.setRemoteDescription(desc);
            if (cands) p.queue.push(...cands);
            if (pc.remoteDescription) while (p.queue.length) await pc.addIceCandidate(p.queue.shift()).catch(() => {});
          } catch (e) {}
        }
        function onPeople(list) {
          if (closed) return;
          people = list.sort((a, b) => (a.at || 0) - (b.at || 0));
          const here = new Set(people.map((x) => x.id));
          people.forEach((info) => {
            const mine = info.id === me, el = tile(info.id, mine ? my : info, mine);
            el.dataset.host = info.host ? '1' : '0';
            if (mine) return;
            if (sfu) { const f = far.get(info.id), v = $('video', el); if (f && f.v && f.v.attachedElements.indexOf(v) < 0) f.v.attach(v); return; }
            if (!peers.has(info.id)) { if (me < info.id) call(info.id); else connect(info.id); }
            peers.get(info.id).info = info;
            const v = $('video', el), p = peers.get(info.id); if (v.srcObject !== p.stream) v.srcObject = p.stream;
          });
          [...peers.keys()].filter((id) => !here.has(id)).forEach((id) => { peers.get(id).pc.close(); peers.delete(id); });
          [...grid.children].filter((el) => el.dataset.peer !== me && !here.has(el.dataset.peer)).forEach((el) => el.remove());
          layout();
        }
        const publish = () => { tile(me, my, true); layout(); net.update(my); };
        // a shared screen is mostly text: keep it sharp and let it go slower, where a camera does the opposite
        const tune = (p) => { if (!p.v) return; try { const s = p.v.sender, q = s.getParameters(); if (!q.encodings || !q.encodings.length) return; q.degradationPreference = my.screen ? 'maintain-resolution' : 'balanced'; if (my.screen) q.encodings[0].maxBitrate = 2500000; else delete q.encodings[0].maxBitrate; s.setParameters(q).catch(() => {}); } catch (e) {} };
        const sendMesh = () => peers.forEach((p) => { if (p.a) p.a.sender.replaceTrack(micTrack); if (p.v) { p.v.sender.replaceTrack(videoOut()); tune(p); } });

        // ── the big room: one connection to a LiveKit server, which passes sound and pictures on ──
        let lk = null, room = null, line = Promise.resolve();
        const far = new Map();              // id → { v: their picture }
        const sent = { a: null, v: null };  // what of mine is going out now
        const whose = (person) => String(person.identity).split('_').pop();
        async function startBig() {
          if (!window.LivekitClient) await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = A.root + 'js/vendor/livekit-client.umd.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
          lk = window.LivekitClient;
          // pictures nobody is looking at are not fetched, and small tiles get a small picture
          room = new lk.Room({ adaptiveStream: true, dynacast: true });
          room.on(lk.RoomEvent.TrackSubscribed, (track, pub, person) => {
            const id = whose(person);
            if (track.kind === 'video') { const f = far.get(id) || {}; far.set(id, f); f.v = track; const el = $(`[data-peer="${id}"] video`, grid); if (el) track.attach(el); }
            else { const a = track.attach(); a.className = 'mr-sound'; a.hidden = true; stage.appendChild(a); }
          });
          room.on(lk.RoomEvent.TrackUnsubscribed, (track, pub, person) => {
            if (track.kind === 'video') { const f = far.get(whose(person)); if (f && f.v === track) f.v = null; track.detach(); }
            else track.detach().forEach((el) => el.remove());
          });
          room.on(lk.RoomEvent.ActiveSpeakersChanged, (list) => { const loud = new Set(list.map(whose)); $$('.mr-tile', grid).forEach((el) => el.classList.toggle('is-speaking', loud.has(el.dataset.peer))); });
          room.on(lk.RoomEvent.Disconnected, () => { if (!closed) say('the connection to the class was lost. press leave, then enter again.', true); });
          await room.connect(sfu.url, sfu.token);
          sendBig();
        }
        // one change at a time, in the order they were asked for
        const sendBig = () => { line = line.then(async () => {
          if (!room || closed) return;
          const mine = room.localParticipant, v = videoOut();
          try {
            if (micTrack && sent.a !== micTrack) { if (sent.a) await mine.unpublishTrack(sent.a, false); sent.a = micTrack; await mine.publishTrack(micTrack, { source: lk.Track.Source.Microphone }); }
            if (sent.v !== v) {
              if (sent.v) await mine.unpublishTrack(sent.v, false);
              sent.v = v;
              // a shared screen is mostly text: one sharp picture; a camera goes out in sizes, so small tiles cost little
              if (v) await mine.publishTrack(v, v === screenTrack ? { source: lk.Track.Source.ScreenShare, simulcast: false, screenShareEncoding: { maxBitrate: 2500000, maxFramerate: 15 }, degradationPreference: 'maintain-resolution' } : { source: lk.Track.Source.Camera, simulcast: true });
            }
          } catch (e) { say('that could not be sent to the class. try again.', true); }
        }); };
        const sendAll = () => (sfu ? sendBig() : sendMesh());
        const showMine = () => { const v = $(`[data-peer="${me}"] video`, grid); const t = videoOut(); if (v) v.srcObject = t ? new MediaStream([t]) : null; };
        const why = (e) => (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'your browser blocked it — allow the camera and microphone for this site (the padlock beside the address), then try again.' : e && e.name === 'NotFoundError' ? 'no camera or microphone was found on this device.' : e && e.name === 'NotReadableError' ? 'another app is using it — close that app and try again.' : 'that could not be started.');

        // ── controls ──
        async function toggleMic(force) {
          const want = typeof force === 'boolean' ? force : !my.mic;
          if (want && !micTrack) { try { micTrack = (await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })).getAudioTracks()[0]; } catch (e) { return say('microphone: ' + why(e), true); } }
          if (micTrack) micTrack.enabled = want;
          my.mic = want && !!micTrack; setBtn('mic', my.mic, my.mic ? 'mute' : 'unmute'); sendAll(); publish();
        }
        async function toggleCam() {
          if (my.cam) { camTrack.stop(); camTrack = null; my.cam = false; }
          else { try { camTrack = (await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 24 } } })).getVideoTracks()[0]; my.cam = true; } catch (e) { return say('camera: ' + why(e), true); } }
          setBtn('cam', my.cam, my.cam ? 'stop video' : 'start video'); sendAll(); showMine(); publish();
        }
        async function toggleScreen() {
          if (my.screen) { screenTrack.stop(); screenTrack = null; my.screen = false; }
          else {
            try { screenTrack = (await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 12, max: 15 } }, audio: false })).getVideoTracks()[0]; try { screenTrack.contentHint = 'detail'; } catch (e) {} } catch (e) { return e && e.name === 'NotAllowedError' ? null : say('screen share: ' + why(e), true); }
            my.screen = true;
            // the browser's own "stop sharing" bar ends it too
            screenTrack.addEventListener('ended', () => { if (my.screen) toggleScreen(); });
          }
          setBtn('screen', my.screen, my.screen ? 'stop sharing' : 'share screen'); sendAll(); showMine(); publish();
        }
        function drawSide() {
          side.hidden = !panel; btn('chat').classList.toggle('is-on', panel === 'chat'); btn('people').classList.toggle('is-on', panel === 'people');
          if (!panel) return;
          if (panel === 'people') {
            side.innerHTML = `<div class="mr-side-top"><strong>people · ${people.length}</strong><button type="button" data-do="shut" aria-label="close">✕</button></div>
              <ul class="mr-people">${people.map((x) => { const info = x.id === me ? my : x; return `<li${info.host ? ' class="is-host"' : ''}><i aria-hidden="true">${esc((info.name || '?').trim()[0] || '?')}</i><span>${esc(info.name)}${x.id === me ? ' (you)' : ''}${info.host ? ' · teacher' : ''}</span><em${info.mic ? ' class="is-live"' : ''}>${info.hand ? 'hand up · ' : ''}${info.mic ? 'mic on' : 'muted'}</em></li>`; }).join('')}</ul>
              ${host ? '<button class="btn-outline mr-muteall" type="button" data-do="muteall">mute everyone <span class="btn-arrow" aria-hidden="true">→</span></button>' : ''}`;
          } else {
            unread = 0; $('.mr-dot', stage).hidden = true;
            side.innerHTML = `<div class="mr-side-top"><strong>chat</strong><button type="button" data-do="shut" aria-label="close">✕</button></div>
              <ul class="mr-chat">${chat.map((c) => `<li${c.me ? ' class="is-me"' : ''}><small>${esc(c.name)}${c.host ? ' · teacher' : ''}</small><p>${esc(c.text).replace(/\n/g, '<br>')}</p></li>`).join('') || '<li class="is-empty">messages are seen by everyone in the class and are not saved.</li>'}</ul>
              <form class="mr-say"><input name="text" maxlength="500" autocomplete="off" placeholder="write to everyone…"><button type="submit" aria-label="send">→</button></form>`;
            const list = $('.mr-chat', side); list.scrollTop = list.scrollHeight;
          }
        }
        const onChat = (c) => { chat.push(c); if (chat.length > 200) chat.shift(); if (panel === 'chat') drawSide(); else if (!c.me) { unread += 1; $('.mr-dot', stage).hidden = false; } };
        const onCmd = (c) => { if (c.type === 'mute-all' && !host && my.mic) { toggleMic(false); say('the teacher muted everyone. unmute when you want to speak.'); } };

        stage.addEventListener('click', (e) => {
          const b = e.target.closest('[data-do]'); if (!b || closed) return;
          const k = b.dataset.do;
          if (k === 'mic') toggleMic(); else if (k === 'cam') toggleCam(); else if (k === 'screen') toggleScreen();
          else if (k === 'hand') { my.hand = !my.hand; setBtn('hand', my.hand, my.hand ? 'lower hand' : 'raise hand'); publish(); }
          else if (k === 'chat' || k === 'people') { panel = panel === k ? '' : k; drawSide(); }
          else if (k === 'shut') { panel = ''; drawSide(); }
          else if (k === 'muteall') { net.send('cmd', { type: 'mute-all', from: me }); say('everyone else has been muted.'); }
        });
        stage.addEventListener('submit', (e) => {
          const f = e.target.closest('.mr-say'); if (!f) return;
          e.preventDefault();
          const text = f.text.value.trim(); if (!text) return;
          const c = { name: my.name, host, text: text.slice(0, 500), at: Date.now() };
          net.send('chat', c); onChat({ ...c, me: true }); f.text.value = ''; const again = $('.mr-say input', side); if (again) again.focus();
        });
        const leave = () => {
          if (closed) return; closed = true; inRoom = false;
          [micTrack, camTrack, screenTrack].forEach((t) => t && t.stop());
          peers.forEach((p) => p.pc.close()); peers.clear(); net.leave();
          if (room) { try { room.disconnect(); } catch (e) {} }
          clearInterval(ticking);
          window.removeEventListener('pagehide', leave);
          door();
        };
        $('#live-leave', stage).addEventListener('click', leave);
        window.addEventListener('pagehide', leave);
        // how long you have been in the class
        const since = Date.now(), two = (n) => String(n).padStart(2, '0');
        const ticking = setInterval(() => { const c = $('#mr-clock', stage); if (!c) return; const sec = Math.floor((Date.now() - since) / 1000), h = Math.floor(sec / 3600); c.textContent = (h ? h + ':' : '') + two(Math.floor(sec / 60) % 60) + ':' + two(sec % 60); }, 1000);

        tile(me, my, true); layout();
        try { await net.join(my, { people: onPeople, signal: onSignal, chat: onChat, cmd: onCmd }); }
        catch (e) { closed = true; inRoom = false; problem = 'you could not be connected to the class. check your connection, make sure you are signed in, and try again.'; net.leave(); door(); return; }
        if (people.length > cap) { say(''); const full = people.findIndex((x) => x.id === me) >= cap; if (full && !host) { leave(); problem = `this class is full — the room holds ${cap} people. please tell the academy team.`; door(); return; } }
        if (sfu) { try { await startBig(); } catch (e) { leave(); problem = 'you could not be connected to the class. check your connection and try again.'; door(); return; } if (closed) return; }
        inRoom = true;
        say(host ? 'you are in. turn on your microphone and camera when you are ready.' : 'you are in. your microphone and camera are off until you turn them on.');
        stage.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }

      door();
      // the door changes by itself as the time comes: "opens in 12 min" → "the room is open" → "live now" → "ended"
      setInterval(() => { if (!inRoom && !checking && shown !== phase() + '|' + problem + '|' + busy) door(); else if (!inRoom && phase() === 'early') { const b = $('.live-note b', stage); if (b) b.textContent = wait(); } }, 20000);
      // closing the page in the middle of a class by accident is easy to do
      window.addEventListener('beforeunload', (e) => { if (inRoom) { e.preventDefault(); e.returnValue = ''; } });
    }

    let docNow = docs[0];
    if (stageKind === 'doc') {
      const frame = $('.lp-doc', root), box = $('#doc-pages', root);
      openDoc(docNow);
      $$('[data-doc]', root).forEach((b) => b.addEventListener('click', () => { docNow = docs[+b.dataset.doc]; $$('[data-doc]', root).forEach((x) => x.classList.toggle('is-on', x === b)); openDoc(docNow); }));
      $('[data-zoom="in"]', root).addEventListener('click', () => stepZoom(1));
      $('[data-zoom="out"]', root).addEventListener('click', () => stepZoom(-1));
      $('[data-zoom="fit"]', root).addEventListener('click', () => setZoom(1));
      $('#doc-save', root).addEventListener('click', (e) => downloadDoc(docNow, e.currentTarget));
      box.addEventListener('scroll', showPageNumber, { passive: true });
      // ctrl + scroll (or a pinch on a laptop trackpad) zooms the document, not the whole page
      box.addEventListener('wheel', (e) => { if (!e.ctrlKey || !doc.pdf) return; e.preventDefault(); stepZoom(e.deltaY < 0 ? 1 : -1); }, { passive: false });
      const full = $('#doc-full', root);
      if (!frame.requestFullscreen) full.hidden = true;
      else {
        full.addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : frame.requestFullscreen().catch(() => {})));
        document.addEventListener('fullscreenchange', () => { full.textContent = document.fullscreenElement ? 'exit full screen' : 'full screen'; setZoom(doc.zoom); });
      }
      // turning the phone, or resizing the window: the pages are fitted again
      let lastW = box.clientWidth;
      new ResizeObserver(() => { if (Math.abs(box.clientWidth - lastW) < 2) return; lastW = box.clientWidth; setZoom(doc.zoom); }).observe(box);
    }
    // ← and → move between lessons, the way they do in a video course (not while typing)
    document.addEventListener('keydown', (e) => {
      if (/^(INPUT|TEXTAREA|SELECT|IFRAME)$/.test(document.activeElement.tagName) || e.altKey || e.ctrlKey || e.metaKey || $('.live-stage.is-room', root)) return;
      if (e.key === 'ArrowLeft' && prev) location.href = url(prev);
      if (e.key === 'ArrowRight' && next && !locked(course, next, all)) location.href = url(next);
    });
    const goNext = () => {
      if (next) { location.href = url(next); return; }
      location.href = stats(course).pct === 100 ? `${U.cert({ c: course.id })}` : courseUrl;
    };
    $$('[data-auth]', root).forEach((b) => b.addEventListener('click', () => authDialog(b.dataset.auth)));
    wireBar();
    // bring the current lesson into view inside the list, without moving the page itself
    const current = $('.lp-item.is-current', root);
    if (current) { const list = $('.lp-side', root); list.scrollTop = Math.max(0, current.offsetTop - list.clientHeight / 2); }

    // On a lesson, the keys that open the browser's "inspect" and "view source" tools do nothing for
    // learners. (A determined person has other ways in — this only stops the casual look.)
    if (!S.admin) window.addEventListener('keydown', (e) => {
      const k = (e.key || '').toLowerCase(), mod = e.ctrlKey || e.metaKey;
      if (k === 'f12' || (mod && e.shiftKey && ['i', 'j', 'c', 'k'].includes(k)) || (mod && e.altKey && ['i', 'j', 'u', 'c'].includes(k)) || (mod && ['u', 's'].includes(k) && !e.shiftKey && !e.altKey)) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    // whoever is signed in carries their own email on the video (the watermark)
    const viewerMark = S.user ? String(S.user.email || S.name || '').trim() : '';
    // ── the video: remember how far it got, and when it ends say what comes next ──
    function refreshProgress() {
      const opened = $$('.lp-sec', side).map((x) => x.classList.contains('is-open'));
      side.innerHTML = sideList();
      $$('.lp-sec', side).forEach((x, i) => x.classList.toggle('is-open', !!opened[i]));
      $('.player-bar', root).innerHTML = bar(); wireBar();
      const c = $('#complete', root); if (c) c.firstChild.textContent = (S.done[lesson.id] ? (next ? 'next lesson' : 'finish') : doneLabel) + ' ';
    }
    if (stageKind === 'video') {
      const noteBox = $('#lp-note', root);
      let lastSaved = 0, ended = false;
      const savePos = (sec, total) => {
        if (ended || !(sec > 0) || Math.abs(sec - lastSaved) < 5) return;
        lastSaved = sec;
        const w = local.get(LOCAL_WATCH);
        if (total && sec > total - 20) delete w[lesson.id]; else w[lesson.id] = Math.floor(sec);
        local.set(LOCAL_WATCH, w);
      };
      const onEnded = async () => {
        if (ended) return; ended = true;
        const w = local.get(LOCAL_WATCH); delete w[lesson.id]; local.set(LOCAL_WATCH, w);
        const wasDone = !!S.done[lesson.id];
        if (!wasDone && !locked(course, lesson, all)) { await markDone(course, lesson); refreshProgress(); }
        if (!noteBox) return;
        noteBox.hidden = false; noteBox.classList.add('is-done');
        noteBox.innerHTML = `<span><b>✓ ${wasDone ? 'video finished.' : 'lesson complete.'}</b> ${next ? `next: ${esc(next.title)}` : 'that was the last lesson.'}</span><a class="btn-primary" href="${next ? url(next) : (stats(course).pct === 100 ? `${U.cert({ c: course.id })}` : courseUrl)}">${next ? 'next lesson' : stats(course).pct === 100 ? 'get my certificate' : 'back to the ' + typeOf(course)} <span class="btn-arrow" aria-hidden="true">→</span></a>`;
      };
      const restart = $('#from-start', root);
      if (restart) restart.addEventListener('click', () => { const w = local.get(LOCAL_WATCH); delete w[lesson.id]; local.set(LOCAL_WATCH, w); location.reload(); });
      // youtube or a file of our own, in our own player: it tells us the time as it plays, and when it ends
      const player = $('.lp-stage .vp', root);
      if (player) guard(player, { time: savePos, ended: onEnded }, viewerMark);
    }
    // the recording of a live class is guarded the same way
    $$('.live-rec .vp', root).forEach((el) => guard(el, {}, viewerMark));

    const complete = $('#complete');
    if (complete) complete.addEventListener('click', async () => {
      complete.disabled = true;
      if (!S.done[lesson.id]) await markDone(course, lesson);
      goNext();
    });

    // tabs
    $$('.tab', root).forEach((t) => t.addEventListener('click', () => {
      $$('.tab', root).forEach((x) => x.classList.toggle('is-active', x === t));
      $$('.tab-panel', root).forEach((p) => { p.hidden = p.dataset.panel !== t.dataset.tab; });
    }));

    // notes: saved a moment after the learner stops typing
    const noteEl = $('#note');
    if (noteEl) {
      let timer;
      const status = $('#note-status');
      noteEl.addEventListener('input', () => {
        status.textContent = 'saving…';
        clearTimeout(timer);
        timer = setTimeout(async () => {
          note = noteEl.value;
          if (S.user) {
            const { error } = await sb.from('lesson_notes').upsert({ user_id: S.user.id, lesson_id: lesson.id, course_id: course.id, body: note, updated_at: new Date().toISOString() });
            status.textContent = error ? 'could not save — ' + error.message : 'saved to your account';
          } else {
            const allNotes = local.get(LOCAL_NOTES); allNotes[lesson.id] = note; local.set(LOCAL_NOTES, allNotes);
            status.textContent = 'saved on this device';
          }
        }, 700);
      });
    }

    // q&a
    const qa = $('#qa');
    if (qa) {
      let thread = comments.slice();
      const one = (c) => `<div class="qa-item${c.is_staff ? ' is-staff' : ''}" data-id="${c.id}">
          <div class="review-top"><strong>${esc(c.author_name)}</strong>${c.is_staff ? '<span class="badge-staff">instructor</span>' : ''}<small>${ago(c.created_at)}</small>
            ${S.user && (c.user_id === S.user.id || S.admin) ? '<button class="linkish" data-del>delete</button>' : ''}</div>
          <p>${esc(c.body).replace(/\n/g, '<br>')}</p></div>`;
      function drawQa() {
        if (!S.user) {
          qa.innerHTML = `<div class="gate" style="padding:28px;"><p style="margin:0 0 18px;">${S.preview ? 'questions switch on once the course database is connected.' : 'sign in to ask a question and read the answers.'}</p>${S.preview ? '' : '<button class="btn-outline" type="button" data-auth="signin">sign in <span class="btn-arrow" aria-hidden="true">→</span></button>'}</div>`;
          $$('[data-auth]', qa).forEach((b) => b.addEventListener('click', () => authDialog(b.dataset.auth)));
          return;
        }
        const tops = thread.filter((c) => !c.parent_id).reverse();
        qa.innerHTML = `<form class="qa-ask"><label class="field" style="margin-top:0;"><span>ask a question about this lesson</span><textarea name="body" rows="3" required maxlength="4000"></textarea></label>
            <button class="btn-outline" type="submit">post question <span class="btn-arrow" aria-hidden="true">→</span></button></form>`
          + (tops.length ? tops.map((q) => `<div class="qa-thread">${one(q)}<div class="qa-replies">${thread.filter((c) => c.parent_id === q.id).map(one).join('')}
              <form class="qa-reply" data-parent="${q.id}"><input name="body" required maxlength="4000" placeholder="write a reply…"><button class="btn btn--sm" type="submit">reply</button></form></div></div>`).join('')
            : '<p class="lms-empty" style="padding:28px 0;">no questions yet. ask the first one.</p>');
      }
      qa.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target, body = new FormData(form).get('body').trim();
        if (!body) return;
        const { data, error } = await sb.from('lesson_comments').insert({ course_id: course.id, lesson_id: lesson.id, user_id: S.user.id, parent_id: form.dataset.parent || null, author_name: S.name || 'learner', is_staff: S.admin, body }).select().single();
        if (error) { form.insertAdjacentHTML('beforeend', `<p class="dialog-msg is-error">${esc(error.message)}</p>`); return; }
        thread.push(data); drawQa();
      });
      qa.addEventListener('click', async (e) => {
        const del = e.target.closest('[data-del]'); if (!del) return;
        const id = del.closest('.qa-item').dataset.id;
        if (!confirm('delete this post?')) return;
        const { error } = await sb.from('lesson_comments').delete().eq('id', id);
        if (!error) { thread = thread.filter((c) => c.id !== id && c.parent_id !== id); drawQa(); }
      });
      drawQa();
    }

    const quiz = $('.quiz', root);
    if (quiz) quiz.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submit = $('button[type=submit]', quiz);
      if (quiz.classList.contains('is-marked')) {
        quiz.reset(); quiz.classList.remove('is-marked');
        $$('.quiz-option', quiz).forEach((o) => o.classList.remove('is-right', 'is-wrong'));
        $$('input', quiz).forEach((i) => { i.disabled = false; });
        $('.quiz-result', quiz).hidden = true; submit.firstChild.textContent = 'check my answers ';
        return;
      }
      const qs = content.quiz;
      const answers = new FormData(quiz);
      let right = 0;
      qs.forEach((q, qi) => {
        if (+answers.get(`q${qi}`) === q.answer) right += 1;
        $$(`input[name=q${qi}]`, quiz).forEach((inp) => {
          const opt = inp.closest('.quiz-option');
          if (+inp.value === q.answer) opt.classList.add('is-right');
          else if (inp.checked) opt.classList.add('is-wrong');
          inp.disabled = true;
        });
      });
      const score = Math.round((right / qs.length) * 100);
      const passed = score >= 70;
      quiz.classList.add('is-marked');
      const res = $('.quiz-result', quiz);
      res.hidden = false;
      res.innerHTML = `<strong>${right} / ${qs.length} — ${score}%</strong><span>${passed ? 'passed. this lesson is marked complete.' : 'you need 70% to pass. read the explanations above, then try again.'}</span>`;
      submit.firstChild.textContent = passed ? 'retake ' : 'try again ';
      if (passed) {
        await markDone(course, lesson, score);
        $('.player-bar', root).innerHTML = bar(); wireBar();
        side.innerHTML = sideList();
        const after = $('#after-quiz');
        after.hidden = false;
        if (!next && stats(course).pct === 100) { after.href = `${U.cert({ c: course.id })}`; after.firstChild.textContent = 'get your certificate '; }
      }
    });
  }

  // ── view: payment ──────────────────────────────────────────────────────────
  // Where "enrol now" on a paid course, program or webinar leads. The learner
  // sends the fee by bKash to the number set in the admin panel, then types the
  // number they paid from and the bKash transaction id here. That is saved as a
  // payment "being checked"; an admin confirms or rejects it (admin panel →
  // learners) and the lessons open the moment it is confirmed. The database
  // enforces all of it — see seed/website-backend-07-bkash-payments.sql.
  async function payPage() {
    const root = $('#pay-root');
    const course = S.courses.find((c) => c.id === Q.c);
    if (!course) { location.replace(U.catalog()); return; }
    const f = fee(course), type = typeOf(course), st = stats(course);
    const back = `${U.course(course.id)}`;
    if (!f.paid || outside(course)) { location.replace(back); return; }
    document.title = `enrol — ${course.title} — amaze consortium`;
    const set = S.pay.settings;
    const number = String(set.bkash || '').replace(/[^0-9+]/g, '');
    const merchant = set.bkash_type === 'merchant';
    const LOCK = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5"/><path d="M5.2 7V4.8a2.8 2.8 0 0 1 5.6 0V7"/></svg>';
    const cover = course.cover ? `<img src="${esc(imageUrl(course.cover))}" alt="">`
      : `<span class="feat-blank"><svg viewBox="0 0 100 100" aria-hidden="true"><path fill-rule="evenodd" d="${CREST}"/></svg><b>${esc(course.category)}</b></span>`;
    // 017 0000 0000 reads more easily than 01700000000, and is what people check digit by digit
    const spaced = (n) => (/^01\d{9}$/.test(n) ? `${n.slice(0, 5)} ${n.slice(5)}` : n);
    const hide = (n) => (n && n.length > 6 ? n.slice(0, 3) + '•'.repeat(n.length - 6) + n.slice(-3) : n || '');
    // what was typed, tidied the way the database will store it — or the reason it can't be right
    const readSender = (v) => { let n = String(v).replace(/[^0-9]/g, ''); if (n.startsWith('880')) n = n.slice(2); if (n.length === 10 && n[0] === '1') n = '0' + n; return /^01[3-9]\d{8}$/.test(n) ? n : ''; };
    const readTrx = (v) => { const t = String(v).replace(/\s/g, '').toUpperCase(); return /^[A-Z0-9]{8,12}$/.test(t) ? t : ''; };
    // what has been typed is kept for this browser tab, so it survives the trip to google and back when signing in
    const DRAFT = 'amaze.pay.draft.' + course.id;
    let draft = { sender: '', trx: '', coupon: '' }, problem = '', busy = false;
    try { const kept = JSON.parse(sessionStorage.getItem(DRAFT) || 'null'); if (kept) draft = { sender: String(kept.sender || ''), trx: String(kept.trx || ''), coupon: String(kept.coupon || '') }; } catch (e) {}
    const keep = () => { try { if (draft.sender || draft.trx || draft.coupon) sessionStorage.setItem(DRAFT, JSON.stringify(draft)); else sessionStorage.removeItem(DRAFT); } catch (e) {} };
    // A coupon: the learner types a code, the database says whether it is good right now and what
    // the fee becomes. (The database works the amount out again when the payment is sent, so a
    // code that has ended in the meantime — or a made-up amount — is refused there.)
    let cut = null, couponSaid = '', couponBusy = false;
    const couponWhy = (r) => ({ unknown: 'that code is not one of ours — check the spelling and try again.', ended: 'this coupon is no longer working.', other_course: `this coupon is for a different ${type}.`, too_big: `this coupon cannot be used on this ${type}.`, no_price: `this coupon cannot be used on this ${type}.`,
      not_yet: `this coupon starts working on ${r && r.starts_at ? when(r.starts_at) : 'a later date'}.` }[r && r.why] || 'that coupon could not be used.');
    async function tryCoupon(code, quiet) {
      code = String(code || '').replace(/\s/g, '').toUpperCase();
      if (!code) { couponSaid = quiet ? '' : 'type the coupon code first.'; return; }
      if (!/^[A-Z0-9]{4,20}$/.test(code)) { cut = null; couponSaid = quiet ? '' : couponWhy({ why: 'unknown' }); return; }
      const { data, error } = await sb.rpc('check_coupon', { p_code: code, p_course: course.id });
      if (error || !data) { cut = null; couponSaid = quiet ? '' : 'the coupon could not be checked — check your connection and try again.'; return; }
      if (data.ok) { cut = data; couponSaid = ''; draft.coupon = data.code; } else { cut = null; couponSaid = quiet ? '' : couponWhy(data); if (quiet) draft.coupon = ''; }
      keep();
    }
    const due = () => (cut ? cut.pay_label : f.label);
    const dueNumber = () => (cut ? String(cut.pay) : f.amount);

    function draw() {
      const mine = S.payments[course.id];
      const state = !S.user ? 'guest' : S.admin ? 'admin' : paidUp(course) ? 'paid' : mine && mine.status === 'pending' ? 'pending' : mine && mine.status === 'rejected' ? 'rejected' : 'new';
      const step = { guest: 1, new: 2, rejected: 2, admin: 2, pending: 3, paid: 4 }[state];
      const steps = [['account', signInWords()], ['payment', 'send the fee by bkash'], ['confirmation', 'we check it and unlock']]
        .map(([name, sub], i) => `<li class="${i + 1 < step ? 'is-done' : i + 1 === step ? 'is-on' : ''}"><b>${i + 1 < step ? '✓' : pad2(i + 1)}</b><div><strong>${name}</strong><span>${sub}</span></div></li>`).join('');
      const open = !!number;   // the admin has said where the money goes

      const status = state === 'paid'
        ? `<div class="pay-status is-ok"><strong>payment confirmed — you are in.</strong><p>everything in this ${type} is unlocked for your account.</p>
            <a class="btn-primary" href="${st.next ? `${U.learn(course.id, st.next.id)}` : back}">start learning <span class="btn-arrow" aria-hidden="true">→</span></a></div>`
        : state === 'pending'
          ? `<div class="pay-status"><strong>thank you — we are checking your payment.</strong>
              <p>we match it against our bkash account by hand, usually within a day. the moment it is confirmed, this ${type} unlocks by itself — you do not need to do anything else, and you can close this page.</p>
              <dl class="pay-sent"><div><dt>transaction id</dt><dd><code>${esc(mine.trx_id)}</code></dd></div><div><dt>paid from</dt><dd>${esc(hide(mine.sender))}</dd></div><div><dt>amount${mine.coupon ? ` · coupon ${esc(mine.coupon)}` : ''}</dt><dd>${esc(mine.amount || f.label)}</dd></div><div><dt>sent to us</dt><dd>${ago(mine.created_at)}</dd></div></dl>
              <button class="linkish" type="button" id="pay-redo">i typed something wrong — let me correct it</button>
              <p class="ask">waiting longer than a day? ${helpLink('i am waiting for my payment for “' + course.title + '” to be confirmed (transaction id ' + mine.trx_id + ')')}</p></div>`
          : state === 'rejected'
            ? `<div class="pay-status is-bad"><strong>we could not confirm that payment.</strong>
                <p>${esc(mine.note || 'the transaction id did not match a payment in our bkash account.')}</p>
                <p>check the transaction id in your bkash app or the confirmation sms and enter it again below. if you are sure it is right, send us a screenshot: ${helpLink('my payment for “' + course.title + '” was not confirmed')}</p></div>`
            : state === 'admin'
              ? '<div class="pay-status"><strong>you are signed in with an admin login.</strong><p>this is the page learners see. admins can open every lesson without paying, so the form below is switched off for you.</p></div>'
              : '';

      const account = state === 'guest'
        ? `<p class="pay-lead">sign in first, so the ${type} can be unlocked for you and your progress and certificate have somewhere to live. it takes one click.</p>
           <div class="hero-buttons" style="justify-content:flex-start;"><button class="btn-primary" type="button" data-auth="signin">${emailOn() ? 'sign in' : 'continue with google'} <span class="btn-arrow" aria-hidden="true">→</span></button></div>`
        : `<dl class="pay-who pay-who--2"><div><dt>name</dt><dd>${esc(S.name || '—')}</dd></div><div><dt>email</dt><dd style="text-transform:none;">${esc(S.user.email)}</dd></div></dl>
           <p class="hint">the ${type} is unlocked for this account. not you? use the button at the top right to sign out.</p>`;

      // "have a coupon?" — offered while the payment can still be sent, on an entry that has a price
      const couponBox = !(state === 'guest' || state === 'new' || state === 'rejected') || !f.amount ? ''
        : cut ? `<div class="pay-coupon is-on"><div><strong>coupon ${esc(cut.code)} is applied.</strong><span>${esc(cut.price_label)} → <b>${esc(cut.pay_label)}</b> · you save ${esc(cut.saved_label)}${cut.ends_at ? ` · works until ${when(cut.ends_at)}` : ''}</span></div><button class="linkish" type="button" id="coupon-off">remove</button></div>`
          : `<details class="pay-coupon"${couponSaid || draft.coupon ? ' open' : ''}><summary>have a coupon code?</summary>
              <div class="pay-coupon-row"><input id="coupon-in" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="24" placeholder="type the code" value="${esc(draft.coupon)}" aria-label="coupon code"><button class="btn-outline" type="button" id="coupon-go"${couponBusy ? ' disabled' : ''}>${couponBusy ? 'checking…' : 'use it'} <span class="btn-arrow" aria-hidden="true">→</span></button></div>
              ${couponSaid ? `<p class="dialog-msg is-error" role="alert">${esc(couponSaid)}</p>` : ''}</details>`;

      const how = !open
        ? `<p class="pay-lead">our bkash number will be shown here. if you do not have it yet, ask us and we will send it to you — the fee is <b style="color:var(--fg)">${esc(f.label)}</b>. once you have paid, fill in the two boxes below.</p><p class="ask">${helpLink('please send me the bkash number for “' + course.title + '”')}</p>`
        : `<div class="pay-bkash">
             <div><span>bkash number${merchant ? ' (merchant)' : ' (personal)'}</span><strong id="pay-number">${esc(spaced(number))}</strong><button class="linkish" type="button" data-copy="${esc(number)}">copy number</button></div>
             <div><span>amount to send${cut ? ' — with your coupon' : ''}</span><strong>${cut ? `<s>${esc(cut.price_label)}</s> ` : ''}${esc(due())}</strong>${dueNumber() ? `<button class="linkish" type="button" data-copy="${esc(dueNumber())}">copy amount</button>` : ''}</div>
           </div>
           ${couponBox}
           <ol class="pay-how">${[
             ['open the bkash app', `or dial *247# on any phone.`],
             [merchant ? 'choose “payment”' : 'choose “send money”', `enter the number above${merchant ? '' : ' — it is a personal number, so “send money”, not “payment”'}.`],
             [`send ${dueNumber() ? esc(due()) : 'the fee'}`, 'the exact amount, in one go. confirm with your pin.'],
             ['keep the transaction id', 'bkash shows it on the confirmation screen and in the sms, as “TrxID” — ten letters and numbers, like 9FA5LK2B3C. you need it for the next step.'],
           ].map(([t, d], i) => `<li><b>${pad2(i + 1)}</b><div><strong>${t}</strong><span>${d}</span></div></li>`).join('')}</ol>
           ${set.note ? `<div class="pay-note"><span class="lesson-kicker">from us</span><div class="prose">${markdown(set.note)}</div></div>` : ''}`;

      const canSend = state === 'guest' || state === 'new' || state === 'rejected';
      const form = state === 'pending' || state === 'paid' ? '' : `
        <form id="pay-form" novalidate${canSend ? '' : ' class="is-off"'}>
          <div class="form-2">
            <label class="field"><span>the bkash number you paid from</span><input name="sender" inputmode="numeric" autocomplete="tel" placeholder="017XXXXXXXX" maxlength="17" value="${esc(draft.sender)}"${canSend ? '' : ' disabled'}></label>
            <label class="field"><span>transaction id (trxid)</span><input name="trx" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="9FA5LK2B3C" maxlength="14" style="text-transform:uppercase;font-family:ui-monospace,Consolas,monospace;letter-spacing:0.08em;" value="${esc(draft.trx)}"${canSend ? '' : ' disabled'}></label>
          </div>
          ${problem ? `<p class="dialog-msg is-error" role="alert">${esc(problem)}</p>` : ''}
          <button class="btn-primary" type="submit"${canSend && !busy ? '' : ' disabled'}>${busy ? 'sending…' : state === 'guest' ? 'sign in and submit' : 'submit for confirmation'} <span class="btn-arrow" aria-hidden="true">→</span></button>
          <p class="hint">only submit after the money has left your bkash account. one transaction id works once.</p>
        </form>`;

      const sideButton = state === 'paid' ? ''
        : state === 'pending' ? '<span class="btn-primary pay-now is-off" aria-disabled="true">payment being checked <span class="btn-arrow" aria-hidden="true">✓</span></span>'
            : canSend ? '<a class="btn-primary pay-now" href="#pay-form">enter my transaction id <span class="btn-arrow" aria-hidden="true">↓</span></a>'
              : '<span class="btn-primary pay-now is-off" aria-disabled="true">admin preview <span class="btn-arrow" aria-hidden="true">→</span></span>';

      root.innerHTML = `<section class="pay"><div class="pay-inner">
        ${notice()}
        <a class="crumb rise" href="${back}">← back to the ${type}</a>
        <div class="hero-tag rise"><i></i>enrolment</div>
        <h1 class="pay-h1 rise rise-2">complete your <em>enrolment.</em></h1>
        <ol class="pay-steps rise rise-3">${steps}</ol>
        <div class="pay-grid">
          <div class="pay-main rise rise-3">
            ${status}
            <div class="pay-panel"><h2><small>01</small>your account</h2>${account}</div>
            ${state === 'paid' ? '' : `<div class="pay-panel"><h2><small>02</small>send the fee by bkash</h2>${how}</div>`}
            ${form ? `<div class="pay-panel" id="pay-tell"><h2><small>03</small>tell us you have paid</h2>
              <p class="pay-lead">once the money is sent, enter these two things. we use them to find your payment — nothing else is needed.</p>${form}</div>` : ''}
          </div>
          <aside class="pay-side rise rise-4"><div class="pay-card">
            <div class="pay-cover">${cover}<span class="pay-type">${type}</span></div>
            <div class="pay-card-body">
              <h3>${esc(course.title)}</h3>
              <p class="pay-by">${esc(course.instructor_name || 'amaze consortium')}</p>
              <ul class="pay-facts">
                ${course.starts_at ? `<li><span>${type === 'webinar' ? 'date' : 'starts'}</span><b>${when(course.starts_at)}</b></li>` : ''}
                <li><span>lessons</span><b>${st.count}</b></li>
                <li><span>study time</span><b>${length(st.minutes)}</b></li>
                <li><span>level</span><b>${esc(course.level)}</b></li>
              </ul>
              <div class="pay-lines"><div><span>${type} fee</span><b>${esc(f.was || f.label)}</b></div>${f.was ? `<div class="pay-cut"><span>discount · ${f.off}% off</span><b>− ${esc(f.saved)}</b></div>` : ''}${cut ? `<div class="pay-cut"><span>coupon ${esc(cut.code)}</span><b>− ${esc(cut.saved_label)}</b></div>` : ''}<div class="pay-total"><span>total to pay</span><b>${esc(due())}</b></div></div>
              ${sideButton}
              ${state === 'paid' ? '' : `<p class="pay-fine">${LOCK}<span>you pay in your own bkash app — we never ask for your pin or password. your place is confirmed once we have checked the payment.</span></p>`}
              ${state === 'paid' || state === 'admin' ? '' : `<div class="pay-help"><strong>stuck on a step?</strong>${helpLink('i need help paying for “' + course.title + '”')}</div>`}
              ${state === 'paid' || state === 'admin' || !aidUrl(course) ? '' : `<div class="pay-help pay-aid"><strong>cannot afford the fee?</strong><span>tell us about your situation. if financial aid is given, your place is opened for you.</span>${aidButton(course)}</div>`}
            </div>
          </div></aside>
        </div>
      </div></section>`;

      $$('[data-auth]', root).forEach((b) => b.addEventListener('click', () => authDialog(b.dataset.auth)));
      $$('[data-copy]', root).forEach((b) => b.addEventListener('click', async () => {
        const was = b.textContent;
        try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'copied'; } catch (e) { prompt('copy this', b.dataset.copy); }
        setTimeout(() => { b.textContent = was; }, 1600);
      }));
      const cgo = $('#coupon-go', root), cin = $('#coupon-in', root);
      if (cgo) {
        const go = async () => { if (couponBusy) return; draft.coupon = cin.value.trim(); couponBusy = true; draw(); await tryCoupon(draft.coupon); couponBusy = false; draw(); };
        cgo.addEventListener('click', go);
        cin.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
        cin.addEventListener('input', () => { draft.coupon = cin.value.trim(); keep(); });
      }
      const coff = $('#coupon-off', root);
      if (coff) coff.addEventListener('click', () => { cut = null; couponSaid = ''; draft.coupon = ''; keep(); draw(); });
      const jump = $('a.pay-now[href="#pay-form"]', root);
      if (jump) jump.addEventListener('click', (e) => { e.preventDefault(); $('#pay-tell', root).scrollIntoView({ behavior: 'smooth', block: 'center' }); const i = $('#pay-form [name=sender]', root); if (i) setTimeout(() => i.focus({ preventScroll: true }), 500); });

      const pf = $('#pay-form', root);
      if (pf && canSend) pf.addEventListener('input', () => { draft = { ...draft, sender: pf.sender.value, trx: pf.trx.value }; keep(); });
      if (pf && canSend) pf.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (busy) return;
        const v = new FormData(pf);
        draft = { ...draft, sender: String(v.get('sender')).trim(), trx: String(v.get('trx')).trim() }; keep();
        const sender = readSender(draft.sender), trx = readTrx(draft.trx);
        problem = !draft.sender || !draft.trx ? 'fill in both boxes: the number you paid from, and the transaction id.'
          : !sender ? 'that does not look like a bkash number. enter the 11-digit number you paid from, for example 017XXXXXXXX.'
            : number && sender === readSender(number) ? 'that is our number. enter the number you sent the money from.'
              : !trx ? 'that does not look like a bkash transaction id. it is about ten letters and numbers with no spaces, for example 9FA5LK2B3C — you will find it in the bkash sms as “TrxID”.'
                : '';
        if (problem) { draw(); return; }
        // not signed in yet: sign in first — what was typed is waiting when google brings them back
        if (!S.user) { problem = 'one more step: ' + signInWords() + ', and you will come straight back here with these two boxes still filled in — then press submit.'; draw(); authDialog('signin'); return; }
        busy = true; draw();
        const { data, error } = await sb.from('payments').insert({ user_id: S.user.id, course_id: course.id, learner_name: S.name || null, learner_email: S.user.email, amount: due(), sender, trx_id: trx, ...(cut ? { coupon: cut.code } : {}) }).select().single();
        busy = false;
        if (error) {
          const m = error.message || '';
          const refused = /coupon_refused:(\w+)/.exec(m);
          if (refused) {   // the coupon stopped working between applying it and paying
            const was = cut; cut = null; draft.coupon = ''; keep();
            couponSaid = couponWhy({ why: refused[1] });
            problem = `your coupon could not be used any more, so nothing was submitted. the fee without it is ${f.label}${was ? ` — you were shown ${was.pay_label}` : ''}. if you already sent the lower amount, message us before paying again.`;
          } else if (/payments_one_open/.test(m)) {   // already sent from another tab or device: show that one
            const again = await soft(sb.from('payments').select('*').eq('course_id', course.id).order('created_at', { ascending: false }).limit(1));
            if (again[0]) S.payments[course.id] = again[0];
            problem = '';
          } else {
            problem = /payments_trx_once/.test(m) ? `that transaction id has already been used for a payment. check it again — if it really is yours, ${waNumber() ? 'message us on whatsapp (the button on this page)' : 'write to ' + HELP_MAIL}.`
              : /too many attempts/.test(m) ? m
                : /row-level security/.test(m) ? 'this account cannot submit a payment. sign out and sign in again with your own google account.'
                  : plain(m);
          }
          draw(); return;
        }
        S.payments[course.id] = data; problem = ''; cut = null; draft = { sender: '', trx: '', coupon: '' }; keep();
        draw(); window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      // a typo spotted after sending: take the payment back and put what was typed back in the boxes
      const redo = $('#pay-redo', root);
      if (redo) redo.addEventListener('click', async () => {
        redo.disabled = true;
        const { error } = await sb.from('payments').delete().eq('id', mine.id).eq('status', 'pending');
        const now = await soft(sb.from('payments').select('*').eq('course_id', course.id).order('created_at', { ascending: false }).limit(1));
        // if it was confirmed or rejected in the meantime, that decision stands and is shown instead
        if (now[0]) S.payments[course.id] = now[0]; else delete S.payments[course.id];
        if (!error && (!now[0] || now[0].status === 'rejected')) { draft = { sender: mine.sender, trx: mine.trx_id, coupon: mine.coupon || '' }; if (draft.coupon) await tryCoupon(draft.coupon, true); }
        if (S.payments[course.id] && S.payments[course.id].status === 'confirmed') { location.reload(); return; }
        draw();
      });
    }
    if (draft.coupon && !S.preview && sb && f.amount) await tryCoupon(draft.coupon, true);
    draw();
  }

  // ── view: my learning ──────────────────────────────────────────────────────
  function myLearning() {
    const root = $('#my-root');
    const mine = S.courses.filter(started);
    const going = mine.filter((c) => stats(c).pct < 100);
    const finished = mine.filter((c) => stats(c).pct === 100);
    const lessonsDone = S.lessons.filter((l) => S.done[l.id]).length;
    const hello = S.user ? (S.name.split(' ')[0] || 'welcome back') : 'my learning';
    const lessonUrl = (c, l) => `${U.learn(c.id, l.id)}`;

    // where they stopped: the lesson last opened on this device, or the next one of whatever is in progress
    const last = local.get(LOCAL_LAST);
    let onCourse = going.find((c) => c.id === last.c), onLesson = onCourse ? lessonsOf(onCourse.id).find((l) => l.id === last.l) : null;
    if (onLesson && S.done[onLesson.id]) onLesson = stats(onCourse).next;
    if (!onCourse && going.length) onCourse = going[0];
    if (onCourse && !onLesson) onLesson = stats(onCourse).next;
    const resume = onCourse && onLesson ? (() => {
      const st = stats(onCourse), n = st.lessons.indexOf(onLesson) + 1;
      return `<a class="dash-continue rise rise-3" href="${lessonUrl(onCourse, onLesson)}">
          <div class="dash-continue-in"><span class="lesson-kicker">continue where you left off</span>
            <strong>${esc(onLesson.title)}</strong>
            <p>${esc(onCourse.title)} · lesson ${n} of ${st.count} · ${KIND[onLesson.kind] || esc(onLesson.kind)}</p>
            <div class="progress"><i style="width:${st.pct}%"></i></div><small>${st.done} of ${st.count} lessons done</small></div>
          <span class="btn-primary">continue <span class="btn-arrow" aria-hidden="true">→</span></span></a>`;
    })() : '';

    // the next live class in anything they can enter
    const classes = S.courses.filter((c) => paidUp(c) && (started(c) || payState(c) === 'confirmed' || S.enrolled[c.id])).map((c) => ({ c, l: nextLive(c) })).filter((x) => x.l).sort((a, b) => new Date(a.l.live_at) - new Date(b.l.live_at));
    const cls = classes[0];
    const clsNow = cls && liveState(cls.l.live_at, cls.l.duration_min) === 'live';
    const liveCard = cls ? `<div class="next-live rise rise-3${clsNow ? ' is-now' : ''}"><div><span class="live-flag">${clsNow ? 'live now' : 'your next live class'}</span><strong>${esc(cls.l.title)}</strong>
        <p>${esc(cls.c.title)} · ${when(cls.l.live_at)} — ${clsNow ? 'it has started' : `in <b data-until="${esc(cls.l.live_at)}">${until(cls.l.live_at)}</b>`}</p></div>
        <div class="hero-buttons"><a class="btn-${clsNow ? 'primary' : 'outline'}" href="${lessonUrl(cls.c, cls.l)}">${clsNow ? 'go to the class' : 'open the class page'} <span class="btn-arrow" aria-hidden="true">→</span></a>
          ${clsNow ? '' : `<a class="btn-outline" href="${esc(calLink(cls.l, cls.c))}" target="_blank" rel="noopener noreferrer">add to my calendar <span class="btn-arrow" aria-hidden="true">+</span></a>`}</div></div>` : '';

    // payments that still need something
    const open = S.courses.filter((c) => fee(c).paid && ['pending', 'rejected'].includes(payState(c)));
    const payRows = open.length ? `<div class="dash-pay rise rise-3">${open.map((c) => { const bad = payState(c) === 'rejected'; return `<a href="${U.pay(c.id)}" class="${bad ? 'is-bad' : ''}"><div><strong>${bad ? 'we could not confirm your payment' : 'your payment is being checked'}</strong><span>${esc(c.title)} — ${bad ? 'open it to see why and try again' : 'usually within a day; the lessons then open by themselves'}</span></div><i aria-hidden="true">→</i></a>`; }).join('')}</div>` : '';

    const faq = savedFaq('my') ? savedFaq('my').map((x) => [esc(x.q), esc(x.a)]) : [
      ['how do i join a course?', 'open it from the academy page and press “enrol”. a free one starts straight away. for a paid one you are taken to the payment page.'],
      ['how do i pay?', 'by bkash. the payment page shows our number and the amount. send it from your bkash app, then type two things on that page: the number you paid from and the transaction id (trxid) from the bkash message.'],
      ['i paid — why are my lessons still locked?', 'we check each payment by hand, usually within a day. you do not need to do anything: when it is confirmed, the lessons open by themselves and this page shows it.'],
      ['how do i join a live class?', 'open the class from this page or from the course. the room opens 15 minutes before the start: press “enter the live class”. it happens on this website — there is nothing to install.'],
      ['my camera or microphone does not work', 'on the class page press “test my camera & microphone” before the class. if the browser blocked it, press the padlock beside the website address and allow both. you can always join without them and use the chat.'],
      ['will i lose my place if i change phone?', 'no. sign in with the same account on any phone or laptop and your lessons, notes and certificates are there.'],
      ['how do i get my certificate?', 'finish every lesson of a course. the certificate then appears on this page under “completed”, with a link you can share.'],
    ];

    root.innerHTML = `
      <section class="course-hero"><div class="course-hero-inner">
        ${notice()}
        <a class="crumb rise" href="${U.catalog()}">← academy</a>
        <div class="hero-tag rise"><i></i>my learning</div>
        <h1 class="course-h1 rise rise-2">${esc(hello)}.</h1>
        ${S.user && !S.admin ? `<div class="me-line rise rise-2"><span>${esc(S.user.email || '')}${S.profile && S.profile.phone ? ` · ${esc(S.profile.phone)}` : ''}</span><button type="button" class="me-edit" data-profile>${S.profile && S.profile.phone ? 'edit profile' : 'edit name · add phone'}</button></div>` : ''}
        ${S.user || S.preview ? '' : `<div class="gate rise rise-3" style="margin-top:clamp(28px,3vw,44px);max-width:720px;">
          <strong>sign in to keep your place.</strong>
          <p>${emailOn() ? 'with google or your email.' : 'one click with your google account.'} it saves the courses you join, every lesson you finish, your notes and your certificates — so you can stop anywhere and carry on later, on any phone or laptop.</p>
          <div class="hero-buttons"><button class="btn-primary" type="button" data-auth="signin">${emailOn() ? 'sign in' : 'continue with google'} <span class="btn-arrow" aria-hidden="true">→</span></button></div>
          ${mine.length ? '<p style="margin:22px 0 0;font-size:13px;">the progress below is saved on this device only. it moves into your account as soon as you sign in.</p>' : ''}
        </div>`}
        <div class="dash">${resume}${liveCard}${payRows}</div>
        <ul class="course-facts rise rise-3" style="grid-template-columns:repeat(3,1fr);margin:clamp(28px,4vw,48px) 0 clamp(40px,5vw,72px);">
          <li><small>started</small><span>${mine.length}</span></li>
          <li><small>lessons done</small><span>${lessonsDone}</span></li>
          <li><small>finished</small><span>${finished.length}</span></li>
        </ul>
      </div></section>
      <section style="border-top:1px solid var(--line);"><div class="sect-inner">
        <span class="lesson-kicker">in progress</span>
        ${going.length ? `<div class="ugrid" style="margin-top:24px;">${going.map((c, i) => card(c, i, { resume: true })).join('')}</div>` : `<p class="lms-empty" style="margin-top:24px;">${mine.length ? 'nothing in progress — everything you started is finished.' : 'you have not started anything yet.'} <a class="btn-outline" href="${U.catalog()}" style="margin-left:8px;">find something to learn <span class="btn-arrow" aria-hidden="true">→</span></a></p>`}
        ${finished.length ? `<span class="lesson-kicker" style="display:block;margin-top:clamp(56px,7vw,96px);">completed</span>
          <div class="rows-plain">${finished.map((c) => `<div><div><strong>${esc(c.title)}</strong><small>${stats(c).count} lessons${S.enrolled[c.id] && S.enrolled[c.id].completed_at ? ` · finished ${day(S.enrolled[c.id].completed_at)}` : ''}</small></div>
            <div class="hero-buttons" style="justify-content:flex-end;"><a class="btn-outline" href="${U.course(c.id)}">review <span class="btn-arrow" aria-hidden="true">→</span></a>
            <a class="btn-primary" href="${U.cert(S.certs[c.id] ? { id: S.certs[c.id] } : { c: c.id })}">certificate <span class="btn-arrow" aria-hidden="true">→</span></a></div></div>`).join('')}</div>` : ''}
      </div></section>
      <section style="border-top:1px solid var(--line);"><div class="sect-inner">
        <div class="dash-help">
          <div class="dash-help-card" id="help"><span class="lesson-kicker">need help?</span>
            <strong>${waNumber() ? 'talk to us on whatsapp.' : 'write to us.'}</strong>
            <p>stuck on a payment, a class or anything else? ${waNumber() ? 'send us a message and a person from the team will answer.' : 'send us an email and a person from the team will answer.'}</p>
            ${waNumber() ? `<a class="btn-wa" href="${esc(helpUrl('i need help with my learning'))}" target="_blank" rel="noopener noreferrer">${WA}<span>message us on whatsapp</span></a><small>+${esc(waNumber())}</small>` : `<a class="btn-outline" href="${esc(helpUrl('i need help with my learning'))}">email ${HELP_MAIL} <span class="btn-arrow" aria-hidden="true">→</span></a>`}
          </div>
          <div${faq.length ? '' : ' hidden'}><span class="lesson-kicker">questions people ask</span>
            <div class="faq">${faq.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</div>
          </div>
        </div>
      </div></section>`;
    $$('[data-auth]', root).forEach((b) => b.addEventListener('click', () => authDialog(b.dataset.auth)));
    $$('[data-profile]', root).forEach((b) => b.addEventListener('click', profileDialog));
    setInterval(() => $$('[data-until]', root).forEach((b) => { b.textContent = until(b.dataset.until); }), 30000);
    wireSaves(root);
  }

  // ── view: certificate ──────────────────────────────────────────────────────
  const CREST = 'M10 8H90V52A40 40 0 0 1 10 52Z M22 20H46V44H22Z M54 20H78V44H54Z M22.3 56H46V79.7A28 28 0 0 1 22.3 56Z M77.7 56H54V79.7A28 28 0 0 0 77.7 56Z';
  function certSheet({ name, title, instructor, date, detail, ref }) {
    return `<div class="cert">
      <div class="cert-top"><svg viewBox="0 0 100 100" aria-hidden="true"><path fill-rule="evenodd" d="${CREST}"/></svg><span>amaze consortium<br>certificate of completion</span></div>
      <div class="cert-kicker">this certifies that</div>
      <div class="cert-name" id="cert-name">${esc(name || 'your name')}</div>
      <p class="cert-line">has completed every lesson and assessment in <b>${esc(title)}</b>${instructor ? `, taught by ${esc(instructor)}` : ''}.</p>
      <div class="cert-foot">
        <div><small>completed</small>${date}</div>
        <div><small>${detail[0]}</small>${detail[1]}</div>
        <div><small>reference</small>${esc(ref)}</div>
      </div>
    </div>`;
  }

  async function certificate() {
    const root = $('#cert-root');
    const id = Q.id;

    // ?id= — anyone can open this link to check a certificate is genuine
    if (id) {
      const rows = S.preview ? [] : await soft(sb.rpc('get_certificate', { p_id: id }));
      const c = rows[0];
      if (!c) {
        root.innerHTML = '<div class="gate" style="max-width:640px;"><h1>no certificate with that reference.</h1><p>check the link or the reference printed on the certificate. references look like AC-1A2B3C4D5E.</p><div class="hero-buttons"><a class="btn-primary" href="${U.catalog()}">browse courses <span class="btn-arrow" aria-hidden="true">→</span></a></div></div>';
        return;
      }
      document.title = `certificate — ${c.learner_name}`;
      const link = new URL(U.cert({ id: c.id }), location.href).href;
      root.innerHTML = `<div>
        <div class="cert-tools">
          <div class="verified">verified — issued by amaze consortium on ${day(c.issued_at)}</div>
          <button class="btn-outline" type="button" id="cert-copy">copy link <span class="btn-arrow" aria-hidden="true">↗</span></button>
          <button class="btn-primary" type="button" id="cert-print">print or save as pdf <span class="btn-arrow" aria-hidden="true">↓</span></button>
        </div>
        ${certSheet({ name: c.learner_name, title: c.course_title, instructor: c.instructor_name, date: day(c.issued_at), detail: ['verify at', 'amazeconsortium.org/academy'], ref: c.id })}
      </div>`;
      $('#cert-print').addEventListener('click', () => window.print());
      $('#cert-copy').addEventListener('click', async (e) => { try { await navigator.clipboard.writeText(link); e.currentTarget.firstChild.textContent = 'link copied '; } catch (err) { prompt('copy this link', link); } });
      return;
    }

    const course = S.courses.find((c) => c.id === Q.c);
    if (!course) { location.replace(U.catalog()); return; }
    if (S.certs[course.id]) { location.replace(U.cert({ id: S.certs[course.id] })); return; }
    const st = stats(course);
    if (st.pct < 100 || !st.count) {
      root.innerHTML = `<div class="gate" style="max-width:640px;"><h1>not quite there yet.</h1><p>you have completed ${st.done} of ${st.count} lessons in ${esc(course.title)}. finish the rest and your certificate will be waiting here.</p><div class="hero-buttons"><a class="btn-primary" href="${U.learn(course.id)}">continue learning <span class="btn-arrow" aria-hidden="true">→</span></a></div></div>`;
      return;
    }
    document.title = `certificate — ${course.title}`;

    // signed in: the database checks the work and issues a permanent, verifiable certificate
    if (S.user && !S.admin) {
      root.innerHTML = `<div class="gate" style="max-width:640px;"><span class="lesson-kicker">course complete</span><h1 style="margin-top:14px;">claim your certificate.</h1>
        <p>enter your name exactly as it should be printed. it can't be changed once the certificate is issued.</p>
        <form id="claim"><label class="field" style="margin-top:0;"><span>name on the certificate</span><input name="name" required minlength="2" maxlength="80" value="${esc(S.name)}"></label>
        <button class="btn-primary" type="submit" style="margin-top:24px;">issue my certificate <span class="btn-arrow" aria-hidden="true">→</span></button></form></div>`;
      $('#claim').addEventListener('submit', async (e) => {
        e.preventDefault();
        const { data, error } = await sb.rpc('issue_certificate', { p_course: course.id, p_name: new FormData(e.target).get('name').trim() });
        if (error) { e.target.insertAdjacentHTML('beforeend', `<p class="dialog-msg is-error">${esc(error.message)}</p>`); return; }
        location.replace(U.cert({ id: data }));
      });
      return;
    }

    // no account: a keepsake only — it has no reference and can't be verified
    root.innerHTML = `<div>
      <div class="cert-tools">
        <label class="field"><span>name on the certificate</span><input id="cert-name-in" placeholder="your full name"></label>
        <button class="btn-primary" type="button" id="cert-print" style="align-self:flex-end;">print or save as pdf <span class="btn-arrow" aria-hidden="true">↓</span></button>
      </div>
      <p class="lms-notice" style="max-width:none;">this copy is not verifiable because you are not signed in. create a free account and finish the course there to get a certificate with a reference anyone can check.</p>
      ${certSheet({ name: '', title: course.title, instructor: course.instructor_name, date: day(Date.now()), detail: ['course length', `${st.count} lessons · ${length(st.minutes)}`], ref: 'unverified copy' })}
    </div>`;
    $('#cert-name-in').addEventListener('input', (e) => { $('#cert-name').textContent = e.target.value || 'your name'; });
    $('#cert-print').addEventListener('click', () => window.print());
  }

  // ── boot ───────────────────────────────────────────────────────────────────
  (async function () {
    if (sb) sb.auth.onAuthStateChange((event) => { if (event === 'PASSWORD_RECOVERY') newPasswordDialog(); });
    await loadOutline();
    await loadLearner();
    wireAccountButton();
    // a link in the old form (…/course.html?c=x) is shown as the new one, so what gets copied and shared is clean
    if (Q.old && view !== 'catalog' && history.replaceState) {
      const clean = view === 'course' && Q.c ? U.course(Q.c) : view === 'learn' && Q.c ? U.learn(Q.c, Q.l) : view === 'pay' && Q.c ? U.pay(Q.c) : view === 'my' ? U.my() : view === 'certificate' && Q.id ? U.cert({ id: Q.id }) : view === 'certificate' && Q.c ? U.cert({ c: Q.c }) : '';
      if (clean && clean !== location.pathname + location.search) history.replaceState(null, '', clean + location.hash);
    }
    // the reports screen in the admin panel counts how often these pages are opened: one count per
    // page per visitor per browser session, and nothing about the visitor is sent or stored
    if (sb && !S.preview && !S.admin) {
      const kind = { catalog: 'catalog_view', course: 'course_view', pay: 'pay_view', learn: 'lesson_view' }[view];
      const key = 'amaze.seen.' + kind + '.' + (Q.c || '');
      let counted = false; try { counted = !!sessionStorage.getItem(key); if (!counted) sessionStorage.setItem(key, '1'); } catch (e) {}
      if (kind && !counted && (kind === 'catalog_view' || Q.c)) sb.rpc('academy_seen', { p_kind: kind, p_course: Q.c || '' }).then(() => {}, () => {});
    }
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[data-out]');
      if (a && sb && !S.preview && !S.admin) sb.rpc('academy_seen', { p_kind: 'course_view', p_course: a.dataset.out }).then(() => {}, () => {});
    });
    if (view === 'catalog') catalog();
    else if (view === 'course') await coursePage();
    else if (view === 'learn') await player();
    else if (view === 'my') myLearning();
    else if (view === 'pay') await payPage();
    else if (view === 'certificate') await certificate();
    document.documentElement.classList.add('lms-ready');
    if (window.ScrollTrigger) window.ScrollTrigger.refresh();
  })();
})();
