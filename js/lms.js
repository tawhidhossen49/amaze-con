// ── ACADEMY ─────────────────────────────────────────────────────────────────
// One script for the five academy views, chosen by <body data-view="…">.
// An entry is a course, a program or a webinar (courses.kind); all three are
// built the same way — modules of lessons — and share every page below.
//   catalog      academy/index.html          courses, programs, webinars: filter, sort, search
//   course       academy/course.html?c=      overview, curriculum, reviews
//   learn        academy/learn.html?c=&l=    the lesson player
//   my           academy/my.html             a learner's dashboard
//   certificate  academy/certificate.html    ?c= to claim one, ?id= to verify one
//   pay          academy/pay.html?c=         enrolment and payment for a paid entry
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
    S.name = (S.user.user_metadata && S.user.user_metadata.full_name) || '';
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
  function fee(course) {
    if (S.preview) return { paid: false, label: 'free', amount: '', link: '', was: '', off: 0, saved: '' };
    const own = S.pay.course[course.id] || {}, all = S.pay.settings;
    const paid = own.paid !== false;
    const amount = String(own.price || all.price || '').trim();
    const unit = String(all.currency || '৳').trim();
    const money = (v) => (/^[a-z]/i.test(unit) ? `${unit} ${v}` : unit + v).toLowerCase();
    const label = !paid ? 'free' : amount ? money(amount) : 'paid';
    // an entry can carry the price it used to be; it is shown crossed out beside the price to pay,
    // but only when it really is higher
    const n = (v) => parseFloat(String(v).replace(/[^0-9.]/g, ''));
    const before = String(own.was || '').trim();
    const cut = paid && !!amount && !!before && n(before) > n(amount);
    return { paid, amount, label, link: String(own.link || all.link || '').trim(),
      was: cut ? money(before) : '', off: cut ? Math.round((1 - n(amount) / n(before)) * 100) : 0, saved: cut ? money(+(n(before) - n(amount)).toFixed(2)) : '' };
  }
  // the price as it is written on a card or a page: what you pay, with the earlier price crossed out after it
  const priceTag = (course) => { const f = fee(course); return `<strong>${esc(f.label)}</strong>${f.was ? `<s>${esc(f.was)}</s>` : ''}`; };
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
  function videoEmbed(raw) {
    const url = String(raw || '').trim();
    const frame = (src, extra = '') => `<iframe src="${esc(src)}" title="lesson video" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen" allowfullscreen ${extra}></iframe>`;
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
        const start = m && t ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
        return frame(`https://www.youtube-nocookie.com/embed/${yt}?rel=0&modestbranding=1${start ? '&start=' + start : ''}`);
      }
      if (host === 'vimeo.com' || host === 'player.vimeo.com') {
        const id = parts.find((p) => /^\d+$/.test(p));
        if (id) return frame(`https://player.vimeo.com/video/${id}`);
      }
      if (host === 'drive.google.com' && parts[0] === 'file' && parts[2]) return frame(`https://drive.google.com/file/d/${parts[2]}/preview`);
    }
    return `<video src="${esc(url)}" controls playsinline preload="metadata"></video>`;
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
  function openDialog(html) {
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.className = 'dialog';
      dialog.innerHTML = '<div class="dialog-box" role="dialog" aria-modal="true"><button class="dialog-close" aria-label="close">✕</button><div class="dialog-body"></div></div>';
      document.body.appendChild(dialog);
      dialog.addEventListener('click', (e) => { if (e.target === dialog || e.target.closest('.dialog-close')) closeDialog(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDialog(); });
    }
    $('.dialog-body', dialog).innerHTML = html;
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

  // Learners sign in with their Google account — there is no password to make or forget and
  // no confirmation email. (Admin logins are separate and stay email + password, on the admin page.)
  const GOOGLE = '<svg viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>';
  function authDialog(mode = 'signin') {
    if (S.preview) {
      openDialog('<span class="lesson-kicker">accounts</span><h2>not connected yet</h2><p>learner accounts switch on once the course database is set up. until then every lesson is open and your progress is kept on this device.</p>');
      return;
    }
    const fresh = mode === 'signup';
    const body = openDialog(`
      <span class="lesson-kicker">${fresh ? 'create a free account' : 'welcome'}</span>
      <h2>${fresh ? 'start learning' : 'sign in'}</h2>
      <p>use your google account — one click, nothing to remember. it keeps your progress, notes and certificates, on any device.</p>
      <button class="btn-google" type="button" id="google-go">${GOOGLE}<span>continue with google</span></button>
      <p class="dialog-small">the name on your google account is the name printed on your certificates. we only receive your name, email address and profile picture.</p>`);
    $('#google-go', body).addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      say(body, 'taking you to google…');
      // google sends the learner straight back to the page they were on
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.href.split('#')[0], queryParams: { prompt: 'select_account' } } });
      if (error) { e.currentTarget.disabled = false; say(body, /not enabled|unsupported provider/i.test(error.message) ? 'google sign-in is not switched on yet — please try again later.' : error.message, true); }
    });
  }

  function accountDialog() {
    const body = openDialog(`
      <span class="lesson-kicker">${S.admin ? 'admin login' : 'learner account'}</span>
      <h2>${esc(S.name || (S.admin ? 'admin' : 'learner'))}</h2>
      <p>${esc(S.user.email)}</p>
      <ul class="account-list">
        <li><a href="${A.root}academy/my.html">my learning <span>→</span></a></li>
        <li><a href="${A.root}academy/index.html">all courses <span>→</span></a></li>
        ${S.admin ? `<li><a href="${A.root}admin/index.html">admin panel <span>→</span></a></li>` : ''}
        <li><button data-act="out">sign out <span>→</span></button></li>
      </ul>`);
    $('[data-act="out"]', body).addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
  }

  function newPasswordDialog() {
    const body = openDialog(`
      <span class="lesson-kicker">reset password</span><h2>new password</h2><p>choose a new password for your account.</p>
      <form><label class="field"><span>new password</span><input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
      <button class="btn-primary" type="submit">save password <span class="btn-arrow" aria-hidden="true">→</span></button></form>`);
    $('form', body).addEventListener('submit', async (e) => {
      e.preventDefault();
      const { error } = await sb.auth.updateUser({ password: new FormData(e.target).get('password') });
      if (error) return say(body, error.message, true);
      say(body, 'password updated.'); setTimeout(() => location.reload(), 900);
    });
  }

  function wireAccountButton() {
    const btn = $('#lms-account');
    if (!btn) return;
    btn.textContent = S.user ? (S.admin ? 'admin' : S.name.split(' ')[0] || 'account') : 'sign in';
    btn.addEventListener('click', () => (S.user ? accountDialog() : authDialog()));
  }

  const adminNote = () => (S.admin ? `<div class="lms-notice">you are signed in with an admin login, so you are previewing — nothing you do here is saved as learner progress. to take courses, sign out and use a learner account. <a href="${A.root}admin/index.html" style="color:var(--green)">open the admin panel →</a></div>` : '');
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
    const href = opts.resume && st.next ? `learn.html?c=${enc(course.id)}&l=${st.next.id}` : `course.html?c=${enc(course.id)}`;
    const isSaved = !!saved()[course.id];
    const media = course.cover
      ? `<img src="${esc(imageUrl(course.cover))}" alt="" loading="lazy">`
      : `<span class="ucard-blank"><svg viewBox="0 0 100 100" aria-hidden="true"><path fill-rule="evenodd" d="M10 8H90V52A40 40 0 0 1 10 52Z M22 20H46V44H22Z M54 20H78V44H54Z M22.3 56H46V79.7A28 28 0 0 1 22.3 56Z M77.7 56H54V79.7A28 28 0 0 0 77.7 56Z"/></svg><b>${esc(course.category)}</b></span>`;
    const type = typeOf(course);
    const state = course.starts_at ? liveState(course.starts_at, st.minutes) : '';
    const badges = [
      state === 'live' ? '<span class="b b--live">live now</span>' : state === 'upcoming' ? '<span class="b b--hot">upcoming</span>' : state === 'ended' && type === 'webinar' ? '<span class="b">recording</span>' : '',
      course.featured ? '<span class="b b--hot">featured</span>' : '',
      !going && fee(course).off ? `<span class="b b--off">${fee(course).off}% off</span>` : '',
      `<span class="b">${esc(course.level)}</span>`,
      +n.reviews > 0 ? `<span class="b"><i class="star">★</i> ${(+n.rating).toFixed(1)}</span>` : '',
      +n.reviews > 0 ? `<span class="b">${(+n.reviews).toLocaleString()} rating${+n.reviews === 1 ? '' : 's'}</span>` : '',
      +n.learners > 0 ? `<span class="b">${(+n.learners).toLocaleString()} learner${+n.learners === 1 ? '' : 's'}</span>` : '',
    ].join('');
    const foot = going
      ? `<div class="ucard-price"><strong>${st.pct === 100 ? 'completed' : st.pct + '%'}</strong><small>${st.done} of ${st.count} lessons</small></div><span class="ucard-btn">${st.pct === 100 ? 'review' : 'continue'}</span>`
      : `<div class="ucard-price">${priceTag(course)}<small>${course.starts_at ? when(course.starts_at) : `${st.count} lesson${st.count === 1 ? '' : 's'} · ${length(st.minutes)}`}</small></div><span class="ucard-btn">view ${type}</span>`;
    return `<article class="ucard rise" style="animation-delay:${Math.min(i, 6) * 0.05}s">
      <div class="ucard-media">${media}<span class="ucard-flag">${esc(course.category)}</span></div>
      <button class="ucard-save${isSaved ? ' is-on' : ''}" type="button" data-save="${esc(course.id)}" aria-pressed="${isSaved}" aria-label="${isSaved ? 'remove from saved' : 'save for later'}">${HEART}</button>
      <h3 class="ucard-title"><a href="${href}">${esc(course.title)}</a></h3>
      <p class="ucard-by">${esc(course.instructor_name || 'amaze consortium')}</p>
      <div class="ucard-badges">${badges}</div>
      ${going ? `<div class="progress"><i style="width:${st.pct}%"></i></div>` : ''}
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
        if (closed) return `<li><a class="lesson-row is-closed" href="pay.html?c=${enc(course.id)}" title="unlocks after payment"><span class="mark"></span><span class="lesson-name"><span class="kind">${PADLOCK}</span><span>${esc(l.title)}</span></span><small><b>locked</b>${KIND[l.kind] || esc(l.kind)}${l.kind === 'live' ? '' : ` · ${l.duration_min} min`}</small></a></li>`;
        const lock = locked(course, l, all);
        const cls = `lesson-row${S.done[l.id] ? ' is-done' : ''}${l.id === currentId ? ' is-current' : ''}${lock ? ' is-locked' : ''}`;
        const live = l.kind === 'live' ? liveState(l.live_at, l.duration_min) : '';
        const tag = `<small>${l.is_preview && !inPlayer ? '<b>preview</b>' : ''}${lock ? '<b>locked</b>' : ''}${live === 'live' ? '<b class="is-live">live now</b>' : ''}${
          l.kind !== 'live' ? `${KIND[l.kind] || esc(l.kind)} · ${l.duration_min} min`
          // the player's side list is narrow: just the day there, the full date on the course page
          : inPlayer ? (live === 'live' ? '' : l.live_at ? new Date(l.live_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toLowerCase() + ' · ' + clock(l.live_at) : 'live · date tba')
          : `live class · ${l.live_at ? when(l.live_at) : 'date to be announced'}`}</small>`;
        return `<li><a class="${cls}" href="learn.html?c=${enc(course.id)}&l=${l.id}"><span class="mark"></span><span class="lesson-name">${kindIcon(l)}<span>${esc(l.title)}</span></span>${tag}</a></li>`;
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

    const of = (type) => S.courses.filter((c) => typeOf(c) === type);
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
    chips.innerHTML = [['all', 'all', S.courses.length], ...Object.keys(TYPES).map((t) => [t, TYPES[t], of(t).length])]
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
        });
        return;
      }
      const term = search.value.trim().toLowerCase();
      let list = S.courses.filter((c) => (active === 'all' || typeOf(c) === active)
        && (!category.value || c.category === category.value)
        && (!level.value || c.level === level.value)
        && (!term || `${c.title} ${c.tagline} ${c.category} ${c.description} ${c.instructor_name} ${typeOf(c)} ${(c.tags || []).join(' ')}`.toLowerCase().includes(term)));
      list = sort.value === 'recommended' ? schedule(list.sort(SORTS.recommended)) : list.sort(SORTS[sort.value] || SORTS.recommended);
      const what = active === 'all' ? ['result', 'results'] : [active, TYPES[active]];
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
    const hashType = { '#courses': 'course', '#programs': 'program', '#webinars': 'webinar' }[location.hash];

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
      const href = started(c) && st.next ? `learn.html?c=${enc(c.id)}&l=${st.next.id}` : `course.html?c=${enc(c.id)}`;
      const media = c.cover ? `<img src="${esc(imageUrl(c.cover))}" alt="">`
        : `<span class="feat-blank"><svg viewBox="0 0 100 100" aria-hidden="true"><path fill-rule="evenodd" d="M10 8H90V52A40 40 0 0 1 10 52Z M22 20H46V44H22Z M54 20H78V44H54Z M22.3 56H46V79.7A28 28 0 0 1 22.3 56Z M77.7 56H54V79.7A28 28 0 0 0 77.7 56Z"/></svg><b>${esc(c.category)}</b></span>`;
      const facts = [
        c.starts_at ? [type === 'webinar' ? 'date' : 'starts', when(c.starts_at)] : ['pace', 'start any time'],
        ['lessons', `${st.count} · ${length(st.minutes)}`],
        ['level', esc(c.level)],
        +n.reviews > 0 ? ['rating', `★ ${(+n.rating).toFixed(1)} (${n.reviews})`] : ['fee', priceTag(c)],
      ];
      const soon = state === 'upcoming' ? startsIn(c.starts_at) : '';
      $('.feat-stage', feat).innerHTML = `<article class="feat${animate ? ' is-new' : ''}">
        <div class="feat-in">
          <a class="feat-media" href="${href}" tabindex="-1" aria-hidden="true">${media}<span class="feat-sheen"></span></a>
          <div class="feat-body">
            <div class="feat-kicker"><span class="feat-star"><i aria-hidden="true">★</i>featured ${type}</span>${state === 'live' ? '<span class="feat-state is-live">live now</span>' : soon ? `<span class="feat-state">${soon}</span>` : ''}</div>
            <h2 class="feat-title"><a href="${href}">${esc(c.title)}</a></h2>
            ${c.tagline ? `<p class="feat-tag">${esc(c.tagline)}</p>` : ''}
            <ul class="feat-facts">${facts.map(([k, v]) => `<li><small>${k}</small><span>${v}</span></li>`).join('')}</ul>
            <div class="feat-foot">
              <a class="btn-primary" href="${href}">${started(c) ? (st.pct === 100 ? 'review' : 'continue') : state === 'live' ? 'join now' : 'view ' + type} <span class="btn-arrow" aria-hidden="true">→</span></a>
              <span class="feat-by">with <b>${esc(c.instructor_name || 'amaze consortium')}</b></span>
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
    const course = S.courses.find((c) => c.id === params.get('c'));
    if (!course) {
      root.innerHTML = '<section class="course-hero"><div class="course-hero-inner"><a class="crumb" href="index.html">← academy</a><h1 class="course-h1">not found.</h1><p class="page-sub" style="margin:28px 0 96px;">it may have been renamed or unpublished.</p></div></section>';
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
    const lessonUrl = (l) => `learn.html?c=${enc(course.id)}&l=${l.id}`;
    const preview = st.lessons.find((l) => l.is_preview);
    let action;
    const price = fee(course), mustPay = price.paid && !paidUp(course);
    if (!st.count) action = '<span class="btn-outline" style="pointer-events:none;opacity:0.6;">lessons coming soon <span class="btn-arrow" aria-hidden="true">→</span></span>';
    // a paid entry: "enrol now" leads to the payment page; while a payment is being checked it says so
    else if (mustPay) action = `<a class="btn-primary" href="pay.html?c=${enc(course.id)}">${payState(course) === 'pending' ? 'payment being checked' : payState(course) === 'rejected' ? 'payment not confirmed — try again' : (noun === 'webinar' ? 'register now' : 'enrol now') + ' — ' + price.label} <span class="btn-arrow" aria-hidden="true">→</span></a>${price.was && !payState(course) ? `<span class="was-note"><s>${esc(price.was)}</s> ${price.off}% off</span>` : ''}`;
    else if (going) action = `<a class="btn-primary" href="${lessonUrl(st.next)}">${st.pct === 100 ? 'review the ' + noun : noun === 'webinar' ? 'open the webinar' : 'continue learning'} <span class="btn-arrow" aria-hidden="true">→</span></a>`;
    else if (S.user || open) action = `<button class="btn-primary" id="enrol" type="button">${S.admin ? 'preview the lessons' : S.user ? (noun === 'webinar' ? 'register — it\'s free' : 'enrol — it\'s free') : 'start the ' + noun} <span class="btn-arrow" aria-hidden="true">→</span></button>`;
    else action = `<button class="btn-primary" id="join" type="button">create a free account to ${noun === 'webinar' ? 'register' : 'enrol'} <span class="btn-arrow" aria-hidden="true">→</span></button>`;
    const second = !going && preview && !open && !mustPay ? `<a class="btn-outline" href="${lessonUrl(preview)}">try a free lesson <span class="btn-arrow" aria-hidden="true">→</span></a>` : '';
    const done100 = st.pct === 100 && st.count > 0;
    const initials = (course.instructor_name || 'a').trim()[0];
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
    const bullets = (title, items, cls = 'outcomes') => ((items || []).length ? `<div class="course-block rise"><h2>// ${title}</h2><ul class="${cls}">${items.map((o) => `<li>${esc(o)}</li>`).join('')}</ul></div>` : '');
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
    const reviewsBlock = !S.preview && (shown.length || reviewForm || mineReview) ? `<div class="course-block rise" id="reviews"><h2>// learner reviews</h2>
        ${shown.length ? `<div class="review-summary"><div><strong>${avg.toFixed(1)}</strong><span class="stars">★★★★★</span><small>${shown.length} review${shown.length === 1 ? '' : 's'}</small></div><ul>${bars}</ul></div>` : '<p class="lms-empty" style="padding:28px 0;">no reviews yet — be the first.</p>'}
        ${reviewForm}
        ${mineReview && mineReview.is_hidden ? '<p class="lms-notice" style="margin-top:20px;">your review is currently hidden by a moderator.</p>' : ''}
        <ul class="reviews">${shown.slice(0, 20).map((r) => `<li><div class="review-top"><strong>${esc(r.author_name)}</strong><span class="stars">${'★'.repeat(r.rating)}<i>${'★'.repeat(5 - r.rating)}</i></span><small>${ago(r.created_at)}</small></div>${r.body ? `<p>${esc(r.body)}</p>` : ''}</li>`).join('')}</ul>
      </div>` : '';

    root.innerHTML = `
      <section class="course-hero">
        <div class="course-hero-inner">
          ${notice()}
          <a class="crumb rise" href="index.html">← academy</a>
          <div class="hero-tag rise"><i></i>${esc(course.category)}</div>
          <h1 class="course-h1 rise rise-2">${esc(course.title)}</h1>
          ${social ? `<div class="course-social course-social--lg rise rise-2">${social}</div>` : ''}
          <div class="course-hero-foot rise rise-3">
            <div>
              <p class="page-sub">${esc(course.tagline || '')}</p>
              <div class="course-actions" style="margin-top:28px;">
                <div class="hero-buttons" style="justify-content:flex-start;">${action}${second}</div>
                ${going ? `<div class="progress"><i style="width:${st.pct}%"></i></div><small>${st.done} of ${st.count} lessons complete${done100 ? ` · <a href="certificate.html?c=${enc(course.id)}" style="color:var(--green)">get your certificate →</a>` : ''}</small>` : ''}
              </div>
            </div>
            <ul class="course-facts">
              <li><small>level</small><span>${esc(course.level)}</span></li>
              ${course.starts_at ? `<li><small>${noun === 'webinar' ? 'date' : 'starts'}</small><span>${when(course.starts_at)}</span></li>` : `<li><small>duration</small><span>${esc(course.duration || 'self-paced')}</span></li>`}
              <li><small>lessons</small><span>${st.count}</span></li>
              <li><small>study time</small><span>${length(st.minutes)}</span></li>
            </ul>
          </div>
        </div>
      </section>
      <section style="border-top:1px solid var(--line);">
        <div class="course-body">
          <div>
            ${news.length ? `<div class="course-block rise"><h2>// announcements</h2><ul class="news">${news.map((n) => `<li><small>${ago(n.created_at)}</small><strong>${esc(n.title)}</strong>${n.body ? `<div class="prose">${markdown(n.body)}</div>` : ''}</li>`).join('')}</ul></div>` : ''}
            ${course.trailer_url ? `<div class="course-block rise"><h2>// watch the introduction</h2><div class="lesson-video" style="margin:0;">${videoEmbed(course.trailer_url)}</div></div>` : ''}
            ${course.description ? `<div class="course-block rise"><h2>// about this ${noun}</h2><p class="course-desc">${esc(course.description)}</p></div>` : ''}
            ${bullets('what you will be able to do', course.outcomes)}
            ${(course.tags || []).length ? `<div class="course-block rise"><h2>// skills you will gain</h2><ul class="tags">${course.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
            <div class="course-block rise"><h2>// curriculum${mustPay ? ' — locked' : course.sequential ? ' — lessons unlock in order' : ''}</h2>
              ${mustPay && st.count ? `<div class="cur-lock">${PADLOCK}<div><strong>${payState(course) === 'pending' ? 'your payment is being checked.' : payState(course) === 'rejected' ? 'we could not confirm your payment.' : `the lessons open once you have enrolled and paid.`}</strong>
                <p>${payState(course) === 'pending' ? 'as soon as we confirm it, every lesson below unlocks for your account.' : payState(course) === 'rejected' ? 'open the payment page to see why, and enter your transaction id again.' : `this ${noun} has ${modulesOf(course.id).length} module${modulesOf(course.id).length === 1 ? '' : 's'} and ${st.count} lesson${st.count === 1 ? '' : 's'}${kinds('live') ? `, ${kinds('live')} of them live` : ''}. you can read the lesson titles below; the videos, readings and files open after you pay and we confirm it — nothing more to do.`}</p></div>
                <a class="btn-primary" href="pay.html?c=${enc(course.id)}">${payState(course) ? 'open the payment page' : (noun === 'webinar' ? 'register now' : 'enrol now') + ' — ' + price.label} <span class="btn-arrow" aria-hidden="true">→</span></a></div>` : ''}
              ${outline(course, null, false) || '<p class="lms-empty">lessons are being added.</p>'}</div>
            ${bullets('before you start', course.requirements, 'plain-list')}
            ${bullets(`who this ${noun} is for`, course.audience, 'plain-list')}
            ${reviewsBlock}
          </div>
          <aside class="course-side rise rise-2">
            ${course.instructor_name ? `<div class="side-card"><h3>taught by</h3><div class="instructor"><div class="instructor-photo">${course.instructor_img ? `<img src="${esc(course.instructor_img)}" alt="">` : esc(initials)}</div><div><strong>${esc(course.instructor_name)}</strong><span>${esc(course.instructor_role || '')}</span></div></div></div>` : ''}
            <div class="side-card"><h3>this ${noun} includes</h3><ul class="includes">
              ${includes.map(([label, value]) => `<li>${esc(label)} <b>${esc(value)}</b></li>`).join('')}
            </ul></div>
          </aside>
        </div>
      </section>`;

    wireModules(root);
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
    const course = S.courses.find((c) => c.id === params.get('c'));
    if (!course) { location.replace('index.html'); return; }
    const all = lessonsOf(course.id);
    const lesson = all.find((l) => l.id === params.get('l')) || stats(course).next;
    if (!lesson) { location.replace(`course.html?c=${enc(course.id)}`); return; }
    const idx = all.indexOf(lesson);
    const prev = all[idx - 1], next = all[idx + 1];
    const mod = S.modules.find((m) => m.id === lesson.module_id);
    const url = (l) => `learn.html?c=${enc(course.id)}&l=${l.id}`;
    const courseUrl = `course.html?c=${enc(course.id)}`;
    const isLocked = locked(course, lesson, all);
    document.title = `${lesson.title} — ${course.title}`;

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
    let bodyHtml, about = '', stageKind = 'page';
    // a document a reading lesson is built around: a pdf attached to it (or a google drive file)
    const isDoc = (r) => /\.pdf($|[?#])/i.test(String(r.url || '')) || /drive\.google\.com\/file\/d\//.test(String(r.url || ''));
    let docs = [];
    if (payLocked) {
      const waiting = payState(course) === 'pending';
      bodyHtml = `<div class="gate"><strong>${waiting ? 'your payment is being checked.' : `this lesson is part of a paid ${typeOf(course)}.`}</strong>
        <p>${waiting ? 'as soon as it is confirmed, every lesson here unlocks for your account by itself.' : `enrol to unlock every lesson, the live classes, your notes and the certificate. the fee is ${fee(course).label}.`}</p>
        <div class="hero-buttons"><a class="btn-primary" href="pay.html?c=${enc(course.id)}">${waiting ? 'open the payment page' : 'enrol now'} <span class="btn-arrow" aria-hidden="true">→</span></a>
        <a class="btn-outline" href="${courseUrl}">back to the ${typeOf(course)} <span class="btn-arrow" aria-hidden="true">→</span></a></div></div>`;
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
      // date and countdown state, the link to join, an "add to calendar" link and — afterwards — the recording
      const state = liveState(lesson.live_at, lesson.duration_min);
      const join = content.live_url ? safeUrl(content.live_url) : '';
      const stamp = (d) => new Date(d).toISOString().replace(/[-:]|\.\d{3}/g, '');
      const cal = lesson.live_at ? 'https://calendar.google.com/calendar/render?action=TEMPLATE'
        + `&text=${enc(lesson.title + ' — ' + course.title)}`
        + `&dates=${stamp(lesson.live_at)}/${stamp(+new Date(lesson.live_at) + Math.max(15, lesson.duration_min || 60) * 60000)}`
        + `&details=${enc('live class — amaze consortium academy\n' + location.href)}` : '';
      const flag = { upcoming: 'upcoming live class', live: 'live now', ended: 'this class has ended', tba: 'live class — date to be announced' }[state];
      bodyHtml = `<div class="live live--${state}">
          <span class="live-flag">${flag}</span>
          ${lesson.live_at ? `<strong class="live-when">${when(lesson.live_at)}</strong><small>shown in your own time zone · about ${length(lesson.duration_min || 60)}</small>` : '<small>the date will be shown here as soon as it is set.</small>'}
          <div class="hero-buttons">
            ${join && state !== 'ended' ? `<a class="btn-primary" href="${esc(join)}" target="_blank" rel="noopener noreferrer">${state === 'live' ? 'join now' : 'join link'} <span class="btn-arrow" aria-hidden="true">↗</span></a>` : ''}
            ${cal && state === 'upcoming' ? `<a class="btn-outline" href="${esc(cal)}" target="_blank" rel="noopener noreferrer">add to calendar <span class="btn-arrow" aria-hidden="true">+</span></a>` : ''}
          </div>
          ${!join && state !== 'ended' ? '<small>the link to join will appear here before the class starts.</small>' : ''}
        </div>`
        + (content.video_url ? `<span class="lesson-kicker" style="display:block;margin:36px 0 14px;">// recording</span><div class="lesson-video">${videoEmbed(content.video_url)}</div>` : state === 'ended' ? '<p class="form-alt">if a recording is published, it will appear here.</p>' : '')
;
      about = content.body || '';
    } else if (lesson.kind === 'form') {
      about = content.body || '';
      bodyHtml = (content.form_url ? `<div class="lesson-form"><iframe src="${esc(formEmbed(safeUrl(content.form_url)))}" title="${esc(lesson.title)}" loading="lazy">loading…</iframe></div>
          <p class="form-alt">form not showing? <a href="${esc(safeUrl(content.form_url))}" target="_blank" rel="noopener noreferrer">open it in a new tab ↗</a> — then come back and mark it as submitted.</p>`
          : '<p class="lms-empty">the form for this lesson hasn\'t been added yet.</p>');
    } else if (content.video_url) {
      stageKind = 'video'; about = content.body || '';
      bodyHtml = `<div class="lesson-video">${videoEmbed(content.video_url)}</div>`;
    } else if ((docs = resources.filter(isDoc)).length) {
      // a reading built around a pdf: the pages are drawn right here, one under another
      stageKind = 'doc'; about = content.body || '';
      bodyHtml = `<div class="lp-doc">
          <div class="lp-doc-bar">${docs.length > 1 ? `<div class="lp-doc-pick">${docs.map((d, i) => `<button type="button" data-doc="${i}"${i ? '' : ' class="is-on"'}>${esc(d.label || 'document ' + (i + 1))}</button>`).join('')}</div>` : `<strong>${esc(docs[0].label || 'document')}</strong>`}
            <span class="lp-doc-count" id="doc-count"></span><a id="doc-open" href="${esc(safeUrl(docs[0].url))}" target="_blank" rel="noopener noreferrer">open in a new tab ↗</a></div>
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
        ${resources.length ? `<ul class="resources">${resources.map((r) => `<li><a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener noreferrer"><span class="lesson-name">${ICON.file}<span>${esc(r.label || r.url)}</span></span><i>↓</i></a></li>`).join('')}</ul>` : '<p class="lms-empty" style="padding:28px 0;">no files or links for this lesson.</p>'}
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
            <a class="lp-row" href="${closedByFee ? `pay.html?c=${enc(course.id)}` : url(l)}"><span class="lesson-name">${n}. ${esc(l.title)}</span><span class="lp-meta">${ICON[l.kind] || ICON.article}<span>${meta}</span></span></a></li>`;
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
      const opened = $$('.lp-sec', side).map((x) => x.classList.contains('is-open'));
      side.innerHTML = sideList();
      $$('.lp-sec', side).forEach((x, i) => x.classList.toggle('is-open', !!opened[i]));
      $('.player-bar', root).innerHTML = bar(); wireBar();
      if (l.id === lesson.id) { const c = $('#complete', root); if (c) c.firstChild.textContent = (S.done[l.id] ? (next ? 'next lesson' : 'finish') : doneLabel) + ' '; }
    });

    // a pdf: drawn page by page with pdf.js (kept on this site, js/vendor), so it reads the same on a phone as on a laptop
    async function openDoc(r) {
      const box = $('#doc-pages', root), count = $('#doc-count', root), link = safeUrl(r.url);
      $('#doc-open', root).href = link; count.textContent = '';
      const drive = /drive\.google\.com\/file\/d\/([^/]+)/.exec(link);
      if (drive) { box.innerHTML = `<iframe class="lp-doc-frame" src="https://drive.google.com/file/d/${esc(drive[1])}/preview" title="${esc(r.label || 'document')}" allow="autoplay"></iframe>`; return; }
      box.innerHTML = '<p class="lp-doc-msg">opening the document…</p>';
      try {
        if (!window.pdfjsLib) await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = A.root + 'js/vendor/pdf.min.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = A.root + 'js/vendor/pdf.worker.min.js';
        // (isEvalSupported off: the site's security headers do not allow code built from strings, and pdf.js does not need it)
        const pdf = await window.pdfjsLib.getDocument({ url: link, isEvalSupported: false }).promise;
        if (r !== docNow) return;   // another document was chosen while this one was loading
        const first = await pdf.getPage(1), shape = first.getViewport({ scale: 1 });
        box.innerHTML = Array.from({ length: pdf.numPages }, (_, i) => `<div class="lp-page" data-page="${i + 1}" style="aspect-ratio:${shape.width}/${shape.height};"></div>`).join('');
        count.textContent = `${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'}`;
        // each page is drawn when it comes near the screen, not all at once
        const seen = new IntersectionObserver((entries) => entries.forEach(async (en) => {
          if (!en.isIntersecting) return;
          seen.unobserve(en.target);
          const page = await pdf.getPage(+en.target.dataset.page);
          const scale = (en.target.clientWidth / page.getViewport({ scale: 1 }).width) * Math.min(2, window.devicePixelRatio || 1);
          const view = page.getViewport({ scale }), canvas = document.createElement('canvas');
          canvas.width = Math.floor(view.width); canvas.height = Math.floor(view.height);
          en.target.style.aspectRatio = `${view.width}/${view.height}`;
          en.target.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: view }).promise;
          en.target.classList.add('is-drawn');
        }), { root: box, rootMargin: '800px 0px' });
        $$('.lp-page', box).forEach((el) => seen.observe(el));
      } catch (e) {
        box.innerHTML = `<div class="lp-doc-msg"><strong>this document could not be shown here.</strong><p>open it in a new tab instead — it will open or download there.</p><a class="btn-primary" href="${esc(link)}" target="_blank" rel="noopener noreferrer">open the document <span class="btn-arrow" aria-hidden="true">↗</span></a></div>`;
      }
    }
    let docNow = docs[0];
    if (stageKind === 'doc') {
      openDoc(docNow);
      $$('[data-doc]', root).forEach((b) => b.addEventListener('click', () => { docNow = docs[+b.dataset.doc]; $$('[data-doc]', root).forEach((x) => x.classList.toggle('is-on', x === b)); openDoc(docNow); }));
    }
    // ← and → move between lessons, the way they do in a video course (not while typing)
    document.addEventListener('keydown', (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft' && prev) location.href = url(prev);
      if (e.key === 'ArrowRight' && next && !locked(course, next, all)) location.href = url(next);
    });
    const goNext = () => {
      if (next) { location.href = url(next); return; }
      location.href = stats(course).pct === 100 ? `certificate.html?c=${enc(course.id)}` : courseUrl;
    };
    $$('[data-auth]', root).forEach((b) => b.addEventListener('click', () => authDialog(b.dataset.auth)));
    wireBar();
    // bring the current lesson into view inside the list, without moving the page itself
    const current = $('.lp-item.is-current', root);
    if (current) { const list = $('.lp-side', root); list.scrollTop = Math.max(0, current.offsetTop - list.clientHeight / 2); }

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
        if (!next && stats(course).pct === 100) { after.href = `certificate.html?c=${enc(course.id)}`; after.firstChild.textContent = 'get your certificate '; }
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
    const course = S.courses.find((c) => c.id === params.get('c'));
    if (!course) { location.replace('index.html'); return; }
    const f = fee(course), type = typeOf(course), st = stats(course);
    const back = `course.html?c=${enc(course.id)}`;
    if (!f.paid) { location.replace(back); return; }
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
    let draft = { sender: '', trx: '' }, problem = '', busy = false;
    try { const kept = JSON.parse(sessionStorage.getItem(DRAFT) || 'null'); if (kept) draft = { sender: String(kept.sender || ''), trx: String(kept.trx || '') }; } catch (e) {}
    const keep = () => { try { if (draft.sender || draft.trx) sessionStorage.setItem(DRAFT, JSON.stringify(draft)); else sessionStorage.removeItem(DRAFT); } catch (e) {} };

    function draw() {
      const mine = S.payments[course.id];
      const state = !S.user ? 'guest' : S.admin ? 'admin' : paidUp(course) ? 'paid' : mine && mine.status === 'pending' ? 'pending' : mine && mine.status === 'rejected' ? 'rejected' : 'new';
      const step = { guest: 1, new: 2, rejected: 2, admin: 2, pending: 3, paid: 4 }[state];
      const steps = [['account', 'sign in with google'], ['payment', 'send the fee by bkash'], ['confirmation', 'we check it and unlock']]
        .map(([name, sub], i) => `<li class="${i + 1 < step ? 'is-done' : i + 1 === step ? 'is-on' : ''}"><b>${i + 1 < step ? '✓' : pad2(i + 1)}</b><div><strong>${name}</strong><span>${sub}</span></div></li>`).join('');
      const open = !!number;   // the admin has said where the money goes

      const status = state === 'paid'
        ? `<div class="pay-status is-ok"><strong>payment confirmed — you are in.</strong><p>everything in this ${type} is unlocked for your account.</p>
            <a class="btn-primary" href="${st.next ? `learn.html?c=${enc(course.id)}&l=${st.next.id}` : back}">start learning <span class="btn-arrow" aria-hidden="true">→</span></a></div>`
        : state === 'pending'
          ? `<div class="pay-status"><strong>thank you — we are checking your payment.</strong>
              <p>we match it against our bkash account by hand, usually within a day. the moment it is confirmed, this ${type} unlocks by itself — you do not need to do anything else, and you can close this page.</p>
              <dl class="pay-sent"><div><dt>transaction id</dt><dd><code>${esc(mine.trx_id)}</code></dd></div><div><dt>paid from</dt><dd>${esc(hide(mine.sender))}</dd></div><div><dt>amount</dt><dd>${esc(mine.amount || f.label)}</dd></div><div><dt>sent to us</dt><dd>${ago(mine.created_at)}</dd></div></dl>
              <button class="linkish" type="button" id="pay-redo">i typed something wrong — let me correct it</button></div>`
          : state === 'rejected'
            ? `<div class="pay-status is-bad"><strong>we could not confirm that payment.</strong>
                <p>${esc(mine.note || 'the transaction id did not match a payment in our bkash account.')}</p>
                <p>check the transaction id in your bkash app or the confirmation sms and enter it again below. if you are sure it is right, write to <a href="mailto:learn@amazeconsortium.org">learn@amazeconsortium.org</a> with a screenshot.</p></div>`
            : state === 'admin'
              ? '<div class="pay-status"><strong>you are signed in with an admin login.</strong><p>this is the page learners see. admins can open every lesson without paying, so the form below is switched off for you.</p></div>'
              : '';

      const account = state === 'guest'
        ? `<p class="pay-lead">sign in first, so the ${type} can be unlocked for you and your progress and certificate have somewhere to live. it takes one click.</p>
           <div class="hero-buttons" style="justify-content:flex-start;"><button class="btn-primary" type="button" data-auth="signin">continue with google <span class="btn-arrow" aria-hidden="true">→</span></button></div>`
        : `<dl class="pay-who pay-who--2"><div><dt>name</dt><dd>${esc(S.name || '—')}</dd></div><div><dt>email</dt><dd style="text-transform:none;">${esc(S.user.email)}</dd></div></dl>
           <p class="hint">the ${type} is unlocked for this account. not you? use the button at the top right to sign out.</p>`;

      const how = !open
        ? `<p class="pay-lead">our bkash number will be shown here. if you do not have it yet, write to <a href="mailto:learn@amazeconsortium.org" style="color:var(--green)">learn@amazeconsortium.org</a> and we will send it to you — the fee is <b style="color:var(--fg)">${esc(f.label)}</b>. once you have paid, fill in the two boxes below.</p>`
        : `<div class="pay-bkash">
             <div><span>bkash number${merchant ? ' (merchant)' : ' (personal)'}</span><strong id="pay-number">${esc(spaced(number))}</strong><button class="linkish" type="button" data-copy="${esc(number)}">copy number</button></div>
             <div><span>amount to send</span><strong>${esc(f.label)}</strong>${f.amount ? `<button class="linkish" type="button" data-copy="${esc(f.amount)}">copy amount</button>` : ''}</div>
           </div>
           <ol class="pay-how">${[
             ['open the bkash app', `or dial *247# on any phone.`],
             [merchant ? 'choose “payment”' : 'choose “send money”', `enter the number above${merchant ? '' : ' — it is a personal number, so “send money”, not “payment”'}.`],
             [`send ${f.amount ? esc(f.label) : 'the fee'}`, 'the exact amount, in one go. confirm with your pin.'],
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
              <div class="pay-lines"><div><span>${type} fee</span><b>${esc(f.was || f.label)}</b></div>${f.was ? `<div class="pay-cut"><span>discount · ${f.off}% off</span><b>− ${esc(f.saved)}</b></div>` : ''}<div class="pay-total"><span>total to pay</span><b>${esc(f.label)}</b></div></div>
              ${sideButton}
              ${state === 'paid' ? '' : `<p class="pay-fine">${LOCK}<span>you pay in your own bkash app — we never ask for your pin or password. your place is confirmed once we have checked the payment.</span></p>`}
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
      const jump = $('a.pay-now[href="#pay-form"]', root);
      if (jump) jump.addEventListener('click', (e) => { e.preventDefault(); $('#pay-tell', root).scrollIntoView({ behavior: 'smooth', block: 'center' }); const i = $('#pay-form [name=sender]', root); if (i) setTimeout(() => i.focus({ preventScroll: true }), 500); });

      const pf = $('#pay-form', root);
      if (pf && canSend) pf.addEventListener('input', () => { draft = { sender: pf.sender.value, trx: pf.trx.value }; keep(); });
      if (pf && canSend) pf.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (busy) return;
        const v = new FormData(pf);
        draft = { sender: String(v.get('sender')).trim(), trx: String(v.get('trx')).trim() }; keep();
        const sender = readSender(draft.sender), trx = readTrx(draft.trx);
        problem = !draft.sender || !draft.trx ? 'fill in both boxes: the number you paid from, and the transaction id.'
          : !sender ? 'that does not look like a bkash number. enter the 11-digit number you paid from, for example 017XXXXXXXX.'
            : number && sender === readSender(number) ? 'that is our number. enter the number you sent the money from.'
              : !trx ? 'that does not look like a bkash transaction id. it is about ten letters and numbers with no spaces, for example 9FA5LK2B3C — you will find it in the bkash sms as “TrxID”.'
                : '';
        if (problem) { draw(); return; }
        // not signed in yet: sign in first — what was typed is waiting when google brings them back
        if (!S.user) { problem = 'one more step: sign in with google, and you will come straight back here with these two boxes still filled in — then press submit.'; draw(); authDialog('signin'); return; }
        busy = true; draw();
        const { data, error } = await sb.from('payments').insert({ user_id: S.user.id, course_id: course.id, learner_name: S.name || null, learner_email: S.user.email, amount: f.label, sender, trx_id: trx }).select().single();
        busy = false;
        if (error) {
          const m = error.message || '';
          if (/payments_one_open/.test(m)) {   // already sent from another tab or device: show that one
            const again = await soft(sb.from('payments').select('*').eq('course_id', course.id).order('created_at', { ascending: false }).limit(1));
            if (again[0]) S.payments[course.id] = again[0];
            problem = '';
          } else {
            problem = /payments_trx_once/.test(m) ? 'that transaction id has already been used for a payment. check it again — if it really is yours, write to learn@amazeconsortium.org.'
              : /too many attempts/.test(m) ? m
                : /row-level security/.test(m) ? 'this account cannot submit a payment. sign out and sign in again with your own google account.'
                  : plain(m);
          }
          draw(); return;
        }
        S.payments[course.id] = data; problem = ''; draft = { sender: '', trx: '' }; keep();
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
        if (!error && (!now[0] || now[0].status === 'rejected')) draft = { sender: mine.sender, trx: mine.trx_id };
        if (S.payments[course.id] && S.payments[course.id].status === 'confirmed') { location.reload(); return; }
        draw();
      });
    }
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
    root.innerHTML = `
      <section class="course-hero"><div class="course-hero-inner">
        ${notice()}
        <a class="crumb rise" href="index.html">← academy</a>
        <div class="hero-tag rise"><i></i>my learning</div>
        <h1 class="course-h1 rise rise-2">${esc(hello)}.</h1>
        ${S.user || S.preview ? '' : `<div class="gate rise rise-3" style="margin-top:clamp(28px,3vw,44px);max-width:720px;">
          <strong>sign in to keep your place.</strong>
          <p>a free learner account saves the courses you enrol in, every lesson you finish, your notes and your certificates — so you can stop anywhere and carry on later, on any device.</p>
          <div class="hero-buttons"><button class="btn-primary" type="button" data-auth="signup">create a free account <span class="btn-arrow" aria-hidden="true">→</span></button>
          <button class="btn-outline" type="button" data-auth="signin">sign in <span class="btn-arrow" aria-hidden="true">→</span></button></div>
          ${mine.length ? '<p style="margin:22px 0 0;font-size:13px;">the progress below is saved on this device only. it moves into your account as soon as you sign in.</p>' : ''}
        </div>`}
        <ul class="course-facts rise rise-3" style="grid-template-columns:repeat(3,1fr);margin:clamp(36px,5vw,64px) 0 clamp(40px,5vw,72px);">
          <li><small>courses started</small><span>${mine.length}</span></li>
          <li><small>lessons completed</small><span>${lessonsDone}</span></li>
          <li><small>courses finished</small><span>${finished.length}</span></li>
        </ul>
      </div></section>
      <section style="border-top:1px solid var(--line);"><div class="sect-inner">
        <span class="lesson-kicker">// in progress</span>
        ${going.length ? `<div class="ugrid" style="margin-top:24px;">${going.map((c, i) => card(c, i, { resume: true })).join('')}</div>` : `<p class="lms-empty" style="margin-top:24px;">nothing in progress. <a href="index.html" style="color:var(--green)">browse the catalogue →</a></p>`}
        ${finished.length ? `<span class="lesson-kicker" style="display:block;margin-top:clamp(56px,7vw,96px);">// completed</span>
          <div class="rows-plain">${finished.map((c) => `<div><div><strong>${esc(c.title)}</strong><small>${stats(c).count} lessons${S.enrolled[c.id] && S.enrolled[c.id].completed_at ? ` · finished ${day(S.enrolled[c.id].completed_at)}` : ''}</small></div>
            <div class="hero-buttons" style="justify-content:flex-end;"><a class="btn-outline" href="course.html?c=${enc(c.id)}">review <span class="btn-arrow" aria-hidden="true">→</span></a>
            <a class="btn-primary" href="certificate.html?${S.certs[c.id] ? 'id=' + enc(S.certs[c.id]) : 'c=' + enc(c.id)}">certificate <span class="btn-arrow" aria-hidden="true">→</span></a></div></div>`).join('')}</div>` : ''}
      </div></section>`;
    $$('[data-auth]', root).forEach((b) => b.addEventListener('click', () => authDialog(b.dataset.auth)));
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
    const id = params.get('id');

    // ?id= — anyone can open this link to check a certificate is genuine
    if (id) {
      const rows = S.preview ? [] : await soft(sb.rpc('get_certificate', { p_id: id }));
      const c = rows[0];
      if (!c) {
        root.innerHTML = '<div class="gate" style="max-width:640px;"><h1>no certificate with that reference.</h1><p>check the link or the reference printed on the certificate. references look like AC-1A2B3C4D5E.</p><div class="hero-buttons"><a class="btn-primary" href="index.html">browse courses <span class="btn-arrow" aria-hidden="true">→</span></a></div></div>';
        return;
      }
      document.title = `certificate — ${c.learner_name}`;
      const link = `${A.root}academy/certificate.html?id=${enc(c.id)}`;
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

    const course = S.courses.find((c) => c.id === params.get('c'));
    if (!course) { location.replace('index.html'); return; }
    if (S.certs[course.id]) { location.replace(`certificate.html?id=${enc(S.certs[course.id])}`); return; }
    const st = stats(course);
    if (st.pct < 100 || !st.count) {
      root.innerHTML = `<div class="gate" style="max-width:640px;"><h1>not quite there yet.</h1><p>you have completed ${st.done} of ${st.count} lessons in ${esc(course.title)}. finish the rest and your certificate will be waiting here.</p><div class="hero-buttons"><a class="btn-primary" href="learn.html?c=${enc(course.id)}">continue learning <span class="btn-arrow" aria-hidden="true">→</span></a></div></div>`;
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
        location.replace(`certificate.html?id=${enc(data)}`);
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
