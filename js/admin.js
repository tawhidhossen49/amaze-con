// ── ADMIN PANEL ─────────────────────────────────────────────────────────────
// Written for people who have never run a website: plain words, one obvious thing to
// press, and forms that show only the boxes that belong to what was chosen (a live class
// asks for a date, not for a pdf). Keep every new screen and setting to that.
//
// Edits everything the public site shows:
//   pages     every heading, paragraph, button, link and image on the static
//             pages (the field list is js/site-fields.js; values → site_text)
//   lists     schools, subsidiaries, executives, advisors, partners (site_content)
//   courses   courses, modules, lessons (video / reading / quiz / form), files,
//             announcements, reviews, questions and certificates
//   learners  who is enrolled and how far along they are (read-only)
//   reports   how the academy is doing — money, enrolments, visits, where learners stop —
//             and a log of everything that happened (seed/website-backend-11-reports.sql)
//   admins    who may use this panel, and which parts of it each person may open
//             (a main admin has everything; a limited admin only what was ticked for them)
//
// This page is only a form. What a visitor is ALLOWED to change is enforced
// by Row Level Security in the database (seed/website-backend.sql): every
// write below is rejected unless the signed-in, email-confirmed user is
// listed in the `admins` table — and, for a limited admin, unless that part of the
// panel was given to them (seed/website-backend-09-admin-roles.sql). Hiding or
// bypassing this page changes nothing.
(function () {
  const A = window.AMAZE;
  const app = document.getElementById('admin');
  if (!window.supabase) {
    app.innerHTML = '<div class="admin-gate"><div class="dialog-box" style="width:min(480px,100%);"><span class="lesson-kicker">can\'t start</span><h1 style="font-size:30px;letter-spacing:-0.04em;margin:8px 0;">the admin panel couldn\'t load</h1><p style="font-size:14px;line-height:1.6;color:var(--muted);">a file it needs didn\'t download — usually a connection problem or a blocker extension. check your internet connection and reload the page.</p><div class="dialog-links"><button class="linkish" onclick="location.reload()">reload</button></div></div></div>';
    return;
  }
  const sb = window.supabase.createClient(A.url, A.key);
  const plain = (message) => (/failed to fetch|networkerror|load failed/i.test(message) ? 'can\'t reach the server — check your internet connection and try again.' : message);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = (t) => t.toLowerCase().trim().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const img = (src) => (!src ? '' : /^(https?:)?\/\//.test(src) || src.startsWith('data:') ? src : A.root + src);
  let user = null;
  // what the signed-in admin may open: a main admin everything, a limited admin the parts ticked for them
  let me = { role: 'main', access: [] };
  const AREAS = [['pages', 'words & pictures', 'the text and images of the pages'], ['lists', 'people & logos', 'executives, advisors, schools, partners'], ['courses', 'academy', 'courses, lessons, live classes, prices'], ['learners', 'learners & payments', 'check payments, see who is enrolled']];
  const can = (view) => view === 'home' || me.role === 'main' || (view !== 'admins' && me.access.includes(view === 'reports' ? 'learners' : view));

  // ── feedback ───────────────────────────────────────────────────────────────
  let toastEl, toastTimer;
  function toast(text, isError) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = plain(text);
    toastEl.classList.toggle('is-error', !!isError);
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), isError ? 5200 : 2600);
  }
  // runs a Supabase call and reports failure in one place
  async function run(promise, okText) {
    const { data, error } = await promise;
    if (error) { toast(error.message, true); return null; }
    if (okText) toast(okText);
    return data === null ? true : data;
  }

  async function upload(file) {
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from('site-media').upload(path, file, { cacheControl: '31536000' });
    if (error) { toast('upload failed: ' + error.message, true); return null; }
    return sb.storage.from('site-media').getPublicUrl(path).data.publicUrl;
  }

  // an image field: preview + address + upload button
  const imageField = (name, value) => `<div class="with-upload"><div class="thumb">${value ? `<img src="${esc(img(value))}" alt="">` : 'none'}</div>
    <input name="${name}" value="${esc(value || '')}" placeholder="image address, or upload →" data-image>
    <label class="btn btn--sm" style="align-self:stretch;">upload<input type="file" accept="image/*" hidden data-upload="${name}"></label></div>`;
  // ── forms that only ask what is needed ─────────────────────────────────────
  // A choice between a few things is shown as cards. The hidden <select> beside the cards
  // holds the value the form saves, so the rest of the code reads it like any other field.
  const choice = (name, options, value, cls = '') => `<div class="choice ${cls}" data-choice="${name}">${options.map(([v, title, text, icon]) => `<button type="button" data-value="${v}"${v === value ? ' class="is-on"' : ''} aria-pressed="${v === value}">${icon ? `<i aria-hidden="true">${icon}</i>` : ''}<b>${title}</b>${text ? `<small>${text}</small>` : ''}</button>`).join('')}</div><select name="${name}" hidden>${options.map(([v, title]) => `<option value="${v}"${v === value ? ' selected' : ''}>${title}</option>`).join('')}</select>`;
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.choice button'); if (!b) return;
    const box = b.parentElement, sel = box.nextElementSibling, form = b.closest('form');
    if (!sel || !sel.matches('select')) return;   // cards that act by themselves (no hidden select beside them)
    if (b.dataset.ui && form) form.dataset.ui = b.dataset.ui;
    sel.value = b.dataset.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  document.addEventListener('change', (e) => {
    const sel = e.target; if (!sel.matches || !sel.matches('select[hidden]')) return;
    const box = sel.previousElementSibling; if (!box || !box.classList.contains('choice')) return;
    const form = sel.closest('form');
    if (form && form.matches('[data-lesson]') && sel.name === 'kind') return syncLesson(form);
    $$('button', box).forEach((b) => { const on = b.dataset.value === sel.value; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
    if (form) syncShown(form);
  });
  // a row's “more ▾” list closes when anything else is pressed
  document.addEventListener('click', (e) => { $$('details.menu[open]').forEach((m) => { if (!m.contains(e.target) || e.target.closest('.menu-in')) m.open = false; }); });
  // parts of a form that belong to one answer only:  data-when="pay_paid=1"  or  data-when="kind=program,webinar"
  // (several answers: separate them with |, as in  data-when="pay_paid=1|where=out";
  //  two things at once: join them with &, as in  data-when="where=out&filled=0")
  function syncShown(form) {
    $$('[data-when]', form).forEach((el) => {
      el.hidden = !el.dataset.when.split('|').some((rules) => rules.split('&').every((rule) => {
        const [name, list] = rule.split('=');
        const field = form.querySelector(`[name="${name}"]`);
        return !!field && list.split(',').includes(field.value);
      }));
    });
  }

  // The kinds of lesson. "pdf" is a reading built around a document, so the database sees it as a reading.
  const LESSON_TYPES = [
    ['video', 'video', 'video', 'a youtube link, or a video you upload', '▶'],
    ['article', 'article', 'reading', 'text you write here', '▤'],
    ['pdf', 'article', 'pdf', 'a document learners read on the page', '▣'],
    ['live', 'live', 'live class', 'a class on a date, inside the site', '◉'],
    ['quiz', 'quiz', 'quiz', 'questions with one right answer', '☑'],
    ['form', 'form', 'test or assignment', 'a google form', '✎'],
  ];
  const UI_KIND = Object.fromEntries(LESSON_TYPES.map(([ui, kind]) => [ui, kind]));
  // what a few shared boxes are called, depending on the kind of lesson
  const LESSON_WORDS = {
    title: { video: 'lesson title — filled in from the youtube video by itself', article: 'lesson title', pdf: 'lesson title', live: 'name of the class', quiz: 'name of the quiz', form: 'name of the test or assignment' },
    minutes: { video: 'how long is the video, in minutes', article: 'minutes it takes to read', pdf: 'minutes it takes to read', live: 'how long the class lasts, in minutes', quiz: 'minutes it takes', form: 'minutes it takes' },
    body: { video: 'text shown under the video (optional)', article: 'the lesson — write or paste it here', pdf: 'a note shown with the document (optional)', live: 'what the class is about (optional)', quiz: 'a short introduction above the questions (optional)', form: 'instructions shown with the form (optional)' },
    files: { video: 'files for learners to download (optional)', article: 'files for learners to download (optional)', pdf: 'the pdf learners will read', live: 'files for learners to download (optional)', quiz: 'files for learners to download (optional)', form: 'files for learners to download (optional)' },
    save: { video: 'video', article: 'reading', pdf: 'pdf lesson', live: 'live class', quiz: 'quiz', form: 'test' },
  };
  // shows the boxes for the chosen kind of lesson and nothing else
  function syncLesson(form) {
    const kind = form.kind.value; let ui = form.dataset.ui || '';
    if (ui && UI_KIND[ui] !== kind) ui = kind;          // the kind was changed some other way
    form.dataset.ui = ui;
    form.classList.toggle('is-picked', !!ui);
    $$('[data-types] button', form).forEach((b) => { const on = b.dataset.ui === ui; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
    $$('[data-for]', form).forEach((el) => { el.hidden = !ui || !el.dataset.for.split(' ').includes(ui); });
    $$('[data-word]', form).forEach((el) => { const w = (LESSON_WORDS[el.dataset.word] || {})[ui]; if (w) el.textContent = w; });
    // the lesson text is the main thing in a reading, and an extra everywhere else
    const body = $('[data-body]', form), slot = $(ui === 'article' ? '[data-slot=main]' : '[data-slot=more]', form);
    if (body && slot && body.parentElement !== slot) slot.appendChild(body);
    const submit = $('[data-save-lesson]', form);
    if (submit && ui) submit.textContent = (form.dataset.lesson ? 'save ' : 'add ') + LESSON_WORDS.save[ui];
  }
  // files attached to a lesson: kept as "name | link" lines in a hidden box, shown as a list
  const fileLines = (text) => text.split('\n').map((line) => line.split('|').map((x) => x.trim())).filter((x) => x.length >= 2 && x[1]).map(([label, ...rest]) => ({ label: label || rest.join('|'), url: rest.join('|') }));
  function drawFiles(form) {
    const box = $('[data-files]', form); if (!box) return;
    const list = fileLines(form.resources.value);
    box.innerHTML = list.map((f, i) => `<div class="file-row"><i aria-hidden="true">${/\.pdf($|[?#])/i.test(f.url) ? 'pdf' : 'file'}</i><span>${esc(f.label)}</span><a class="linkish" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">open ↗</a><button type="button" class="linkish" data-fdel="${i}">remove</button></div>`).join('') || '<p class="file-none">nothing attached yet.</p>';
  }
  document.addEventListener('input', (e) => { if (e.target.matches && e.target.matches('form[data-lesson] [name=resources]')) drawFiles(e.target.form); });
  document.addEventListener('click', (e) => {
    const t = e.target; if (!t.closest) return;
    const form = t.closest('form[data-lesson]'); if (!form) return;
    const del = t.closest('[data-fdel]');
    if (del) { const list = fileLines(form.resources.value); list.splice(+del.dataset.fdel, 1); form.resources.value = list.map((f) => `${f.label} | ${f.url}`).join('\n'); return drawFiles(form); }
    if (t.closest('[data-fadd]')) {
      const name = $('[data-fname]', form), link = $('[data-furl]', form);
      if (!/^https?:\/\/\S+$/.test(link.value.trim())) { toast('paste the full link — it starts with https://', true); return link.focus(); }
      form.resources.value = (form.resources.value.trim() ? form.resources.value.trim() + '\n' : '') + `${name.value.trim().replace(/\|/g, ' ') || 'link'} | ${link.value.trim()}`;
      name.value = ''; link.value = ''; return drawFiles(form);
    }
    // quiz builder
    const quiz = t.closest('[data-quiz]'); if (!quiz) return;
    const qs = quiz._qs, q = t.closest('[data-q]') ? qs[+t.closest('[data-q]').dataset.q] : null;
    if (t.closest('[data-qadd]')) qs.push({ q: '', options: ['', ''], answer: 0 });
    else if (t.closest('[data-qdel]')) qs.splice(qs.indexOf(q), 1);
    else if (t.closest('[data-oadd]')) q.options.push('');
    else if (t.closest('[data-odel]')) { const i = +t.closest('[data-odel]').dataset.odel; q.options.splice(i, 1); if (q.answer === i) q.answer = 0; else if (q.answer > i) q.answer -= 1; }
    else return;
    drawQuiz(form);
    const fresh = t.closest('[data-qadd]') ? $$('[data-qtext]', quiz).pop() : null; if (fresh) fresh.focus();
  });
  document.addEventListener('input', (e) => {
    const t = e.target; if (!t.closest) return;
    const quiz = t.closest('[data-quiz]'); if (!quiz) return;
    const q = quiz._qs[+t.closest('[data-q]').dataset.q];
    if (t.matches('[data-qtext]')) q.q = t.value;
    else if (t.matches('[data-otext]')) q.options[+t.dataset.otext] = t.value;
    else if (t.matches('[data-why]')) q.why = t.value;
    else if (t.matches('[data-right]')) { q.answer = +t.dataset.right; $$('.quiz-opt', t.closest('[data-q]')).forEach((el, i) => el.classList.toggle('is-right', i === q.answer)); }
  });
  function drawQuiz(form) {
    const box = $('[data-quiz]', form); if (!box) return;
    if (!box._qs) box._qs = [];
    box.innerHTML = box._qs.map((q, qi) => `<div class="quiz-q" data-q="${qi}">
        <div class="quiz-q-top"><b>question ${qi + 1}</b><button type="button" class="linkish" data-qdel>remove this question</button></div>
        <input data-qtext placeholder="type the question" value="${esc(q.q)}">
        <p class="quiz-tip">the answers — tick the one that is correct</p>
        ${q.options.map((o, oi) => `<div class="quiz-opt${oi === q.answer ? ' is-right' : ''}"><input type="radio" name="right-${qi}" data-right="${oi}"${oi === q.answer ? ' checked' : ''} title="tick if this is the correct answer" aria-label="answer ${oi + 1} is the correct one"><input data-otext="${oi}" placeholder="answer ${oi + 1}" value="${esc(o)}">${q.options.length > 2 ? `<button type="button" data-odel="${oi}" aria-label="remove this answer" title="remove this answer">✕</button>` : ''}</div>`).join('')}
        <button type="button" class="linkish" data-oadd>+ add another answer</button>
        <input data-why placeholder="explanation shown after they answer (optional)" value="${esc(q.why || '')}">
      </div>`).join('') + `<button type="button" class="btn btn--sm" data-qadd>+ add a question</button>`;
  }
  // the questions as they will be saved: empty answers dropped, the right one kept pointing at the same answer
  function readQuiz(form) {
    const box = $('[data-quiz]', form); if (!box || !box._qs) return [];
    return box._qs.map((q) => {
      const kept = q.options.map((o, i) => ({ o: o.trim(), i })).filter((x) => x.o);
      const out = { q: q.q.trim(), options: kept.map((x) => x.o), answer: Math.max(0, kept.findIndex((x) => x.i === q.answer)) };
      if ((q.why || '').trim()) out.why = q.why.trim();
      return out;
    }).filter((q) => q.q && q.options.length >= 2);
  }

  // a thumbnail that fails to load is replaced by its initials (as plain text, never markup)
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t.tagName === 'IMG' && t.dataset.fallback !== undefined) t.replaceWith(document.createTextNode(t.dataset.fallback));
  }, true);
  // one listener handles every upload button and live thumbnail on the page
  document.addEventListener('change', async (e) => {
    const input = e.target.closest('[data-upload]');
    if (!input || !input.files[0]) return;
    toast('uploading…');
    const url = await upload(input.files[0]);
    if (!url) return;
    const target = input.closest('.with-upload').querySelector('[data-image]');
    target.value = url;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    toast('uploaded');
  });
  // "upload a video file" on a lesson: stores the file and fills in its address
  document.addEventListener('change', async (e) => {
    const input = e.target.closest('[data-video-upload]');
    if (!input || !input.files[0]) return;
    const file = input.files[0];
    const mb = Math.round(file.size / 1048576);
    if (mb > 50 && !confirm(`this video is ${mb} MB. supabase's free plan accepts files up to 50 MB, so the upload may be refused — for long videos an unlisted youtube link is the better choice. try anyway?`)) { input.value = ''; return; }
    const status = input.closest('.field').querySelector('[data-video-status]');
    status.textContent = `uploading ${file.name} (${mb} MB) — keep this page open…`;
    const url = await upload(file);
    input.value = '';
    if (!url) { status.textContent = 'upload failed — see the message at the bottom right.'; return; }
    const target = input.closest('.field').querySelector('[name=video_url]');
    target.value = url;
    const kind = input.closest('form').querySelector('[name=kind]');
    if (kind.value === 'article') { kind.value = 'video'; input.closest('form').dataset.ui = 'video'; syncLesson(input.closest('form')); }
    // an uploaded video has no title of its own: start from the file name, for the admin to rewrite
    const title = input.closest('form').querySelector('[name=title]');
    const named = !title.value.trim() || title.value === title.dataset.auto;
    if (named) { const guess = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().toLowerCase(); title.value = guess; title.dataset.auto = guess; }
    status.textContent = `uploaded: ${file.name}. ${named ? 'the lesson title above was filled in from the file name — write the title you want learners to see, then save.' : 'save the lesson to publish it.'}`;
    if (named) { title.focus(); title.select(); }
    toast('video uploaded');
  });
  // A lesson's title from its video. Put a YouTube (or Vimeo) link in the video box and the
  // lesson takes the video's own title — every time the link changes. The title box stays
  // editable afterwards. An uploaded file has no title of its own, so that one is typed by hand
  // (it starts as the file name). Returns once the title box is settled, so saving can wait for it.
  async function titleFromVideo(input) {
    const form = input.closest('form'); if (!form) return;
    const title = form.querySelector('[name=title]'), status = form.querySelector('[data-video-status]');
    const url = input.value.trim();
    let site = null;
    try { const h = new URL(url).hostname.replace(/^(www\.|m\.)/, ''); site = /^(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(h) ? 'youtube' : /vimeo\.com$/.test(h) ? 'vimeo' : null; } catch (e) {}
    if (!site) return;
    // the link the lesson was opened with keeps the title it already has — unless there is none
    if (url === input.defaultValue.trim() && title.value.trim()) return;
    if (input.dataset.looked === url) return;
    input.dataset.looked = url;
    try {
      const api = site === 'youtube' ? 'https://www.youtube.com/oembed?format=json&url=' : 'https://vimeo.com/api/oembed.json?url=';
      const res = await fetch(api + encodeURIComponent(url));
      if (!res.ok) throw new Error('not found');
      const got = String((await res.json()).title || '').trim().slice(0, 140);
      if (!got) throw new Error('no title');
      const before = title.value.trim();
      title.value = got; title.dataset.auto = got;
      if (status) status.textContent = `lesson title set to the video's own: “${got}”${before && before !== got ? ` (it was “${before}”)` : ''}. change it above if you want something else, then save.`;
      const kind = form.querySelector('[name=kind]'); if (kind && kind.value === 'article') { kind.value = 'video'; form.dataset.ui = 'video'; syncLesson(form); }
    } catch (e) {
      if (status) status.textContent = 'could not read that video’s title (it may be private, or the link is not a video) — type the lesson title yourself.';
    }
  }
  document.addEventListener('change', (e) => { const i = e.target.closest && e.target.closest('form[data-lesson] [name=video_url]'); if (i) titleFromVideo(i); });
  document.addEventListener('paste', (e) => { const i = e.target.closest && e.target.closest('form[data-lesson] [name=video_url]'); if (i) setTimeout(() => titleFromVideo(i), 60); });

  // "attach a file" / "upload a pdf" on a lesson: uploads it and adds a "name | link" line.
  // The name is the file's own, without its ending, and can be rewritten in the box.
  document.addEventListener('change', async (e) => {
    const input = e.target.closest('[data-attach]');
    if (!input || !input.files[0]) return;
    const file = input.files[0], pdf = input.hasAttribute('data-pdf');
    if (pdf && !(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) { input.value = ''; return toast('that is not a pdf — choose a file ending in .pdf', true); }
    const mb = file.size / 1048576;
    if (mb > 50) { input.value = ''; return toast(`that file is ${mb.toFixed(0)} MB — the limit is 50 MB. compress it (search “compress pdf”) and try again.`, true); }
    toast(`uploading ${file.name} (${mb < 1 ? '<1' : mb.toFixed(0)} MB) — keep this page open…`);
    const url = await upload(file);
    input.value = '';
    if (!url) return;
    const form = input.closest('form');
    const box = (form || document).querySelector(`[name="${input.dataset.attach}"]`);
    const name = file.name.replace(/\.[^.]+$/, '').replace(/[_|]+/g, ' ').trim() || 'document';
    box.value = (box.value.trim() ? box.value.trim() + '\n' : '') + `${name} | ${url}`;
    if (form && form.matches('[data-lesson]')) drawFiles(form);
    if (pdf && form) {
      const kind = form.querySelector('[name=kind]'), title = form.querySelector('[name=title]');
      const reading = kind && kind.value === 'article' && !form.querySelector('[name=video_url]').value.trim();
      // a pdf dropped into a lesson with no kind chosen yet (or an empty reading) makes it a pdf lesson
      if (reading && (!form.dataset.ui || (form.dataset.ui === 'article' && !form.body.value.trim()))) { form.dataset.ui = 'pdf'; syncLesson(form); }
      if (title && !title.value.trim()) title.value = name.toLowerCase();
      const note = form.querySelector('[data-pdf-status]');
      if (note) note.textContent = reading ? `uploaded “${name}”. learners will read it inside this lesson — with zoom, full screen and a download button. save the lesson to publish it.`
        : `uploaded “${name}”. because this lesson is a ${kind ? kind.options[kind.selectedIndex].text : 'different kind'}, learners get it as a download under the lesson’s “resources” tab. to have them read it on the lesson page itself, choose “pdf” as the kind of lesson.`;
    }
    toast(pdf ? 'pdf uploaded' : 'attached');
  });
  document.addEventListener('input', (e) => {
    if (!e.target.matches('[data-image]')) return;
    const t = e.target.closest('.with-upload').querySelector('.thumb');
    t.innerHTML = e.target.value ? `<img src="${esc(img(e.target.value))}" alt="">` : 'none';
  });

  // ── sign-in and access ─────────────────────────────────────────────────────
  function gate(html) { app.innerHTML = `<div class="admin-gate"><div class="dialog-box" style="width:min(480px,100%);">${html}</div></div>`; return $('.dialog-box', app); }
  function note(box, text, isError) {
    let el = $('.dialog-msg', box);
    if (!el) { el = document.createElement('div'); el.className = 'dialog-msg'; box.appendChild(el); }
    el.classList.toggle('is-error', !!isError); el.textContent = plain(text);
  }

  // Email and password only. Admin logins are created by hand in the Supabase
  // dashboard (Authentication → Users → Add user), never from this page.
  function signIn() {
    const box = gate(`
      <span class="lesson-kicker">amaze consortium — admin</span>
      <h1 style="font-size:34px;line-height:1;letter-spacing:-0.04em;margin:8px 0;">sign in</h1>
      <form>
        <label class="field"><span>email</span><input name="email" type="email" required autocomplete="email"></label>
        <label class="field"><span>password</span><input name="password" type="password" required autocomplete="current-password"></label>
        <button class="btn-primary" type="submit" style="width:100%;justify-content:space-between;margin-top:24px;">sign in <span class="btn-arrow" aria-hidden="true">→</span></button>
      </form>`);
    $('form', box).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      note(box, 'one moment…');
      const { error } = await sb.auth.signInWithPassword({ email: f.get('email').trim(), password: f.get('password') });
      if (error) return note(box, error.message === 'Invalid login credentials' ? 'that email and password do not match.' : error.message, true);
      boot();
    });
  }

  async function boot() {
    const { data } = await sb.auth.getSession();
    user = data.session ? data.session.user : null;
    if (!user) return signIn();
    const { data: ok, error } = await sb.rpc('is_admin');
    if (error) {
      const box = gate(`<span class="lesson-kicker">setup needed</span><h1 style="font-size:30px;letter-spacing:-0.04em;margin:8px 0;">the database isn't set up yet</h1>
        <p style="font-size:14px;line-height:1.6;color:var(--muted);">open the supabase project, go to <b>sql editor</b>, paste the contents of <b>seed/website-backend.sql</b> and run it. then add yourself as the first admin:</p>
        <pre>insert into public.admins (email) values ('${esc(user.email)}');</pre>
        <div class="dialog-links"><button class="linkish" id="retry">i've done that — retry</button><button class="linkish" id="out">sign out</button></div>`);
      $('#retry', box).addEventListener('click', boot);
      $('#out', box).addEventListener('click', async () => { await sb.auth.signOut(); boot(); });
      return;
    }
    if (ok !== true) {
      const box = gate(`<span class="lesson-kicker">no access</span><h1 style="font-size:30px;letter-spacing:-0.04em;margin:8px 0;">this account isn't an admin</h1>
        <p style="font-size:14px;line-height:1.6;color:var(--muted);">you are signed in as <b>${esc(user.email)}</b>. accounts created by signing up on the website are learner accounts and can't open this panel.</p>
        <p style="font-size:14px;line-height:1.6;color:var(--muted);margin-top:12px;">to make someone an admin, add them in supabase under <b>authentication → users → add user</b> — they get access automatically — or an existing admin can add this email on the <b>admins</b> screen.</p>
        <div class="dialog-links"><button class="linkish" id="retry">retry</button><button class="linkish" id="out">sign out</button></div>`);
      $('#retry', box).addEventListener('click', boot);
      $('#out', box).addEventListener('click', async () => { await sb.auth.signOut(); boot(); });
      return;
    }
    // which parts of the panel this admin may use (older databases without roles: everything)
    const mine = await sb.rpc('admin_me');
    me = mine.error ? { role: 'main', access: [] } : { role: mine.data && mine.data.role === 'main' ? 'main' : 'limited', access: (mine.data && Array.isArray(mine.data.access) ? mine.data.access : []) };
    shell();
  }

  // ── shell ──────────────────────────────────────────────────────────────────
  // each screen: its name in the menu, what draws it, a small sign, and one line saying what it is for
  const VIEWS = {
    home: ['home', homeView, '⌂', ''],
    pages: ['words & pictures', pagesView, '✎', 'change any text, button or picture on the website’s pages'],
    lists: ['people & logos', listsView, '☺', 'executives, advisors, schools, subsidiaries and partners'],
    courses: ['academy', coursesView, '▤', 'courses, programs and webinars — their lessons, prices and live classes'],
    learners: ['learners & payments', learnersView, '৳', 'check bkash payments and see who is enrolled'],
    reports: ['reports', reportsView, '▥', 'how the academy and the website are doing: money, enrolments, visitors, countries, popular pages — and a log of everything that happened'],
    admins: ['admins', adminsView, '⚿', 'who is allowed to use this panel'],
  };
  let main, savebar, dirtyGuard = () => false;

  function shell() {
    app.innerHTML = `<div class="admin-shell">
      <aside class="admin-side">
        <a class="admin-brand" href="${A.root}" target="_blank" rel="noopener" title="open the website"><img src="${A.root}img/amazelogo.png" alt=""><span>site admin</span></a>
        <nav class="admin-nav">${Object.entries(VIEWS).filter(([k]) => can(k)).map(([k, [label, , icon]]) => `<button data-view="${k}"><i aria-hidden="true">${icon}</i><span>${label}</span></button>`).join('')}</nav>
        <a class="admin-site" href="${A.root}" target="_blank" rel="noopener">see the website ↗</a>
        <div class="admin-user"><span>signed in as — ${me.role === 'main' ? 'main admin' : 'limited admin'}</span>${esc(user.email)}<button class="linkish" id="signout">sign out</button></div>
      </aside>
      <main class="admin-main"></main>
    </div>
    <div class="savebar"><span></span><div class="admin-actions"><button class="btn" data-save="discard">undo my changes</button><button class="btn btn--solid" data-save="save">save changes</button></div></div>`;
    main = $('.admin-main', app); savebar = $('.savebar', app);
    $('#signout', app).addEventListener('click', async () => { await sb.auth.signOut(); boot(); });
    $$('.admin-nav button', app).forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
    window.addEventListener('beforeunload', (e) => { if (dirtyGuard()) { e.preventDefault(); e.returnValue = ''; } });
    // back / forward and typed #links switch screens too (go() itself uses pushState, which doesn't fire this)
    window.onhashchange = () => { const [v, arg] = route(); if (v in VIEWS) go(v, arg); };
    const [v, arg] = route();
    go(v in VIEWS ? v : 'home', arg);
    if (can('learners')) payBadge();
  }

  // ── home: what would you like to do? ───────────────────────────────────────
  async function homeView() {
    let waiting = 0;
    if (can('learners')) { try { const { data } = await sb.from('payments').select('id').eq('status', 'pending'); waiting = Array.isArray(data) ? data.length : 0; } catch (e) {} }
    const open = Object.entries(VIEWS).filter(([k]) => k !== 'home' && can(k));
    const jobs = [['courses', 'new:course', '+ make a new course'], ['courses', 'new:webinar', '+ make a new webinar'], ['pages', '', 'change text on the home page'], ['lists', '', 'add a person or a logo']].filter(([k]) => can(k));
    const first = String((user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || user.email.split('@')[0]).split(/[ .]/)[0];
    if (!open.length) { main.innerHTML = head(`hello, ${esc(first)}`, 'you are an admin, but no part of the panel has been opened for you yet. ask a main admin to choose what you can do — they do that on their “admins” screen.'); return; }
    main.innerHTML = head(`hello, ${esc(first)}`, 'what would you like to do? pick one — you can always come back here with “home” in the menu.' + (me.role === 'main' ? '' : ' you see the parts a main admin opened for you.'))
      + (waiting ? `<button class="notice" data-go="learners"><b>${waiting} payment${waiting === 1 ? ' is' : 's are'} waiting for you to check</b><span>open learners & payments →</span></button>` : '')
      + `<div class="home-cards">${open.map(([k, [label, , icon, text]]) => `<button class="home-card" data-go="${k}"><i aria-hidden="true">${icon}</i><b>${label}</b><span>${text}</span><em>open →</em></button>`).join('')}</div>
        <div class="h2"><span>quick jobs</span></div>
        <div class="quick">${jobs.map(([k, arg, label]) => `<button class="btn" data-go="${k}"${arg ? ` data-arg="${arg}"` : ''}>${label}</button>`).join('')}</div>
        <p class="lede" style="margin-top:28px;">nothing here can break the website: every change can be changed back, and anything you delete asks you first.</p>`;
    main.onclick = (e) => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go, b.dataset.arg || undefined); };
  }

  // '#courses/web-development-fundamentals' → ['courses', 'web-development-fundamentals']
  const route = () => { const [v, ...rest] = location.hash.slice(1).split('/'); return [v, rest.length ? decodeURIComponent(rest.join('/')) : undefined]; };

  function go(view, arg) {
    if (!can(view)) { view = 'home'; arg = undefined; }   // a part this admin was not given
    teacherEdit = null; teacherOpen = false; faqOpen = false; faqEdit = -1;
    if (dirtyGuard() && !confirm('you have unsaved changes on this screen. leave without saving?')) return;
    dirtyGuard = () => false;
    main.onclick = null; main.oninput = null; main.onsubmit = null; main.onchange = null; savebar.onclick = null;
    savebar.classList.remove('is-on');
    $$('.admin-nav button', app).forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
    const hash = '#' + view + (arg ? '/' + encodeURIComponent(arg) : '');
    // pushState, so the browser's back button steps through screens; neither call fires hashchange
    if (location.hash !== hash) history[location.hash ? 'pushState' : 'replaceState'](null, '', hash);
    main.innerHTML = '<p class="empty">loading…</p>';
    window.scrollTo(0, 0);
    VIEWS[view][1](arg);
  }
  const head = (title, text, actions = '') => `<header class="admin-head"><div><h1>${title}</h1>${text ? `<p>${text}</p>` : ''}</div><div class="admin-actions">${actions}</div></header>`;

  // ── pages ──────────────────────────────────────────────────────────────────
  let currentPage = 'home';
  async function pagesView() {
    const page = window.AMAZE_PAGES.find((p) => p.id === currentPage);
    const [html, saved] = await Promise.all([
      fetch(A.root + page.file, { cache: 'no-store' }).then((r) => r.text()),
      run(sb.from('site_text').select('key,value').like('key', page.id + '.%')),
    ]);
    if (!saved) return;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const stored = Object.fromEntries(saved.map((r) => [r.key, r.value]));
    const fields = window.AMAZE_resolveFields(page, doc).filter((f) => f.el).map((f) => {
      const builtIn = window.AMAZE_text.read(f.el, f.type === 'stat' ? 'text' : f.type);
      return { ...f, builtIn, value: f.key in stored ? stored[f.key] : builtIn };
    });
    const groups = [...new Set(fields.map((f) => f.group))];
    const hints = { pre: 'paste your text here. it appears on the page exactly as it looks in this box — every new line and empty line is kept. a long text gets a “read more” button by itself.', html: 'to make a word green, write &lt;em&gt;word&lt;/em&gt;. to start a new line, write &lt;br&gt;.', stat: 'a number — you can add a sign after it, like 25+' };

    main.innerHTML = head('words & pictures', 'change any text, button or picture on a page. 1 — choose the page. 2 — open a part of it and type. 3 — press “save changes” at the bottom.',
      `<a class="btn" href="${(A.root + page.file).replace(/index\.html$/, '')}" target="_blank" rel="noopener">see this page ↗</a>`)
      + `<p class="step-label"><b>1</b> which page?</p><div class="tabs">${window.AMAZE_PAGES.map((p) => `<button class="chip${p.id === page.id ? ' is-active' : ''}" data-page="${p.id}">${esc(p.title)}</button>`).join('')}</div>`
      + `<p class="step-label"><b>2</b> which part of “${esc(page.title)}”?</p><label class="search"><input type="search" id="find" placeholder="type a few words you see on the page to find them…" autocomplete="off"><span id="find-n"></span></label>`
      + groups.map((g, gi) => {
        const fs = fields.filter((f) => f.group === g);
        const edited = fs.filter((f) => f.key in stored).length;
        return `<details class="group"${gi === 0 ? ' open' : ''}><summary>${esc(g)}<small>${fs.length} thing${fs.length === 1 ? '' : 's'} to change${edited ? ` · <b>${edited} changed by you</b>` : ''}</small></summary><div class="group-body">${fs.map((f) => {
          const long = f.type === 'html' || f.type === 'pre' || f.value.length > 70 || f.builtIn.length > 70;
          const control = f.type === 'src' ? imageField(f.key, f.value)
            : f.type === 'visible' ? `<select name="${f.key}"><option value="1"${f.value === '1' ? ' selected' : ''}>shown</option><option value="0"${f.value === '0' ? ' selected' : ''}>hidden</option></select>`
            : f.type === 'pre' ? `<textarea name="${f.key}" rows="${Math.min(28, Math.max(10, f.value.split('\n').length + Math.ceil(f.value.length / 90)))}" style="white-space:pre-wrap;line-height:1.6;">\n${esc(f.value)}</textarea>`
            : long ? `<textarea name="${f.key}" rows="${Math.min(8, Math.max(2, Math.ceil(f.value.length / 80)))}">${esc(f.value)}</textarea>`
              : `<input name="${f.key}" value="${esc(f.value)}">`;
          const tag = f.type === 'src' ? 'div' : 'label';   // the image control has its own <label>
          return `<${tag} class="field${long || f.type === 'src' ? ' field--wide' : ''}" data-key="${f.key}">
            <div class="field-top"><span>${esc(f.label)}</span>${f.key in stored ? '<button type="button" class="linkish" data-reset title="put back the wording the website came with">put the original back</button>' : ''}</div>
            ${control}${hints[f.type] ? `<small class="hint">${hints[f.type]}</small>` : ''}</${tag}>`;
        }).join('')}</div></details>`;
      }).join('');

    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    const control = (key) => $(`[name="${CSS.escape(key)}"]`, main);
    const changed = () => fields.filter((f) => control(f.key).value !== f.value);
    function refresh() {
      const list = changed();
      fields.forEach((f) => control(f.key).closest('.field').classList.toggle('is-changed', control(f.key).value !== f.value));
      savebar.classList.toggle('is-on', list.length > 0);
      $('span', savebar).textContent = `${list.length} unsaved change${list.length === 1 ? '' : 's'} on “${page.title}” — not on the website until you save`;
    }
    dirtyGuard = () => changed().length > 0;
    main.oninput = (e) => {
      if (e.target.id !== 'find') return refresh();
      // finding a text: show only the boxes whose label or wording contains what was typed
      const want = e.target.value.trim().toLowerCase(); let n = 0;
      $$('.group', main).forEach((g) => {
        let any = false;
        $$('.field[data-key]', g).forEach((el) => { const c = control(el.dataset.key); const hit = !want || (el.textContent + ' ' + c.value).toLowerCase().includes(want); el.hidden = !hit; if (hit) { any = true; n += 1; } });
        g.hidden = !any; if (want && any) g.open = true;
      });
      $('#find-n', main).textContent = want ? (n ? `${n} found` : 'nothing found — try fewer words') : '';
    };
    $$('[data-page]', main).forEach((b) => b.addEventListener('click', () => { currentPage = b.dataset.page; go('pages'); }));
    $$('[data-reset]', main).forEach((b) => b.addEventListener('click', () => {
      const key = b.closest('.field').dataset.key;
      control(key).value = byKey[key].builtIn;
      control(key).dispatchEvent(new Event('input', { bubbles: true }));
    }));
    savebar.onclick = async (e) => {
      const act = e.target.dataset.save;
      if (act === 'discard') { dirtyGuard = () => false; return go('pages'); }
      if (act !== 'save') return;
      const list = changed();
      // a value put back to the built-in wording doesn't need a row at all
      const upserts = list.filter((f) => control(f.key).value !== f.builtIn).map((f) => ({ key: f.key, value: control(f.key).value, updated_at: new Date().toISOString() }));
      const removes = list.filter((f) => control(f.key).value === f.builtIn).map((f) => f.key);
      if (upserts.length && !(await run(sb.from('site_text').upsert(upserts)))) return;
      if (removes.length && !(await run(sb.from('site_text').delete().in('key', removes)))) return;
      toast(`saved — ${list.length} change${list.length === 1 ? ' is' : 's are'} on the website now`);
      dirtyGuard = () => false;
      go('pages');
    };
  }

  // ── lists ──────────────────────────────────────────────────────────────────
  const LISTS = {
    school: { title: 'schools', sub: null, desc: false, url: false, note: 'the “run by students from” strip.' },
    subsidiary: { title: 'subsidiaries', sub: 'short name (shown if the logo is missing)', desc: true, url: true, note: '“our subsidiaries”.' },
    executive: { title: 'executives', sub: 'role', desc: false, url: true, note: 'the executive members rail.' },
    advisor: { title: 'advisors', sub: 'role / affiliation', desc: false, url: true, note: '“the people we learn from”.' },
    partner: { title: 'partners', sub: null, desc: false, url: true, note: '“trusted by our partners”.' },
  };
  let currentList = 'executive';
  async function listsView(editId) {
    const cfg = LISTS[currentList];
    const rows = await run(sb.from('site_content').select('*').eq('type', currentList).order('sort_order').order('created_at'));
    if (!rows) return;

    const form = (r) => `<form class="editor" data-id="${esc(r.id || '')}">
      <div class="form-grid">
        <label class="field"><span>name</span><input name="name" required value="${esc(r.name || '')}"></label>
        ${cfg.sub ? `<label class="field"><span>${cfg.sub}</span><input name="subtitle" value="${esc(r.subtitle || '')}"></label>` : ''}
        ${cfg.url ? `<label class="field"><span>a link to open when it is clicked (optional)</span><input name="url" type="url" value="${esc(r.url || '')}" placeholder="https://"></label>` : ''}
        <label class="field"><span>initials — shown when there is no picture</span><input name="initials" maxlength="6" value="${esc(r.initials || '')}" placeholder="e.g. FZ"></label>
        ${cfg.desc ? `<label class="field field--wide"><span>description</span><textarea name="description" rows="3">${esc(r.description || '')}</textarea></label>` : ''}
        <div class="field field--wide"><span>${currentList === 'executive' || currentList === 'advisor' ? 'photo' : 'logo'}</span>${imageField('img', r.img)}</div>
      </div>
      <div class="editor-foot"><button class="btn btn--solid" type="submit">${r.id ? 'save' : 'add'}</button><button class="btn" type="button" data-cancel>cancel</button></div>
    </form>`;

    main.innerHTML = head('people & logos', 'the rows of people and logos on the home page. choose a list, then add, change or reorder what is in it. everything here is on the website as soon as you save it.',
      `<button class="btn btn--solid" data-new>+ add to ${cfg.title}</button>`)
      + `<p class="step-label"><b>1</b> which list?</p><div class="tabs">${Object.entries(LISTS).map(([k, v]) => `<button class="chip${k === currentList ? ' is-active' : ''}" data-list="${k}">${v.title}</button>`).join('')}</div>`
      + `<p class="step-label"><b>2</b> ${cfg.title} — on the site as ${cfg.note} ${rows.length} in this list, shown in this order.</p>`
      + (editId === 'new' ? form({}) : '')
      + `<div class="rows">${rows.map((r, i) => (r.id === editId ? form(r) : `<div class="row" data-id="${esc(r.id)}">
          <div class="thumb">${r.img ? `<img src="${esc(img(r.img))}" alt="" data-fallback="${esc(r.initials || '—')}">` : esc(r.initials || '—')}</div>
          <div><strong>${esc(r.name)}${r.hidden ? '<span class="badge">hidden</span>' : ''}</strong>${r.subtitle || r.url ? `<span class="sub">${esc(r.subtitle || r.url)}</span>` : ''}</div>
          <div class="row-actions"><button class="btn btn--sm btn--solid" data-edit>edit</button><button class="btn btn--sm" data-move="-1"${i === 0 ? ' disabled' : ''} aria-label="move up" title="move up">↑</button><button class="btn btn--sm" data-move="1"${i === rows.length - 1 ? ' disabled' : ''} aria-label="move down" title="move down">↓</button><button class="btn btn--sm" data-hide>${r.hidden ? 'show' : 'hide'}</button><button class="btn btn--sm btn--danger" data-del>delete</button></div>
        </div>`)).join('') || '<p class="empty">nothing here yet.</p>'}</div>`;

    $$('[data-list]', main).forEach((b) => b.addEventListener('click', () => { currentList = b.dataset.list; go('lists'); }));
    $('[data-new]', main).addEventListener('click', () => listsView('new'));
    main.onclick = async (e) => {
      const row = e.target.closest('.row');
      if (e.target.closest('[data-cancel]')) return listsView();
      if (!row) return;
      const id = row.dataset.id, at = rows.findIndex((r) => r.id === id);
      if (e.target.closest('[data-edit]')) return listsView(id);
      if (e.target.closest('[data-del]')) {
        if (!confirm(`delete “${rows[at].name}”? this cannot be undone.`)) return;
        if (await run(sb.from('site_content').delete().eq('id', id), 'deleted')) listsView();
        return;
      }
      if (e.target.closest('[data-hide]')) {
        if (await run(sb.from('site_content').update({ hidden: !rows[at].hidden }).eq('id', id), rows[at].hidden ? 'shown on the site again' : 'hidden from the site')) listsView();
        return;
      }
      const move = e.target.closest('[data-move]');
      if (move) {
        const order = rows.slice(); const [item] = order.splice(at, 1); order.splice(at + +move.dataset.move, 0, item);
        const updates = order.map((r, i) => ({ r, i: i + 1 })).filter(({ r, i }) => r.sort_order !== i);
        const results = await Promise.all(updates.map(({ r, i }) => sb.from('site_content').update({ sort_order: i }).eq('id', r.id)));
        const failed = results.find((x) => x.error);
        if (failed) toast(failed.error.message, true);
        listsView();
      }
    };
    const f = $('form.editor', main);
    if (f) f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f)); delete v[''];
      const row = { type: currentList, name: v.name.trim(), subtitle: v.subtitle || null, url: v.url || null, initials: v.initials || null, img: v.img || null, description: v.description || null };
      const id = f.dataset.id;
      const ok = id ? await run(sb.from('site_content').update(row).eq('id', id), 'saved')
        : await run(sb.from('site_content').insert({ ...row, sort_order: rows.length + 1 }), 'added');
      if (ok) listsView();
    });
  }

  // ── academy: courses, programs, webinars ───────────────────────────────────
  const TYPES = { course: 'courses', program: 'programs', webinar: 'webinars' };
  const typeOf = (c) => (TYPES[c.kind] ? c.kind : 'course');
  // <input type="datetime-local"> works in the admin's own time zone; the database stores one exact moment
  const toLocalInput = (iso) => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
  const whenText = (iso) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
  // Programs, webinars and live-class dates need four columns added by
  // seed/website-backend-05-academy.sql. Until that has been run, those fields
  // are left out of every save so nothing else breaks.
  let academyReady = null;
  async function checkAcademy() {
    if (academyReady !== null) return academyReady;
    const [a, b, c] = await Promise.all([
      sb.from('courses').select('kind,starts_at').limit(1),
      sb.from('course_lessons').select('live_at').limit(1),
      sb.from('lesson_content').select('live_url').limit(1),
    ]);
    academyReady = !a.error && !b.error && !c.error;
    return academyReady;
  }
  const setupNote = () => (academyReady ? '' : '<p class="empty" style="margin-bottom:20px;border-color:var(--green);color:var(--fg);">one step left to switch on programs, webinars and live-class dates: open supabase → sql editor, paste the file <b>seed/website-backend-05-academy.sql</b> and press run (once). until then everything is saved as a course and the fields marked “needs setup” are ignored.</p>');

  // ── payment ────────────────────────────────────────────────────────────────
  // Prices and the bKash number are kept with the site's other saved text (site_text):
  //   pay.course.<id>   { paid, price, was }                    one entry: free or paid, price, previous price
//                     { external, external_by }               …or: it lives on another website (its link, and whose it is)
  //   pay.settings      { bkash, bkash_type, note, price, … }   where the fee is sent, and the older general price
//   pay.teachers      [{ name, role, img }]                   teachers saved once, to fill in on any course with one press
// Coupons are rows in the coupons table (seed/website-backend-10-coupons.sql): only admins can read them, and
// the database works out what a learner owes when a payment comes in with one.
  // An entry with nothing saved is paid. The payments themselves — who sent which transaction id,
  // and what an admin decided — are rows in the payments table (seed/website-backend-07-bkash-payments.sql).
  async function payLoad() {
    const rows = await run(sb.from('site_text').select('key,value').like('key', 'pay.%'));
    const out = { settings: {}, course: {}, teachers: [], faq: {} };
    (rows && rows !== true ? rows : []).forEach((r) => {
      let v; try { v = JSON.parse(r.value); } catch (e) { return; }
      if (r.key === 'pay.settings') out.settings = v || {};
      else if (r.key === 'pay.teachers') out.teachers = Array.isArray(v) ? v.filter((t) => t && t.name) : [];
      else if (r.key === 'pay.faq') out.faq = v && typeof v === 'object' ? v : {};
      else if (r.key.startsWith('pay.course.')) out.course[r.key.slice(11)] = v || {};
    });
    return out;
  }
  const paySave = (key, value, okText) => run(sb.from('site_text').upsert({ key, value: JSON.stringify(value), updated_at: new Date().toISOString() }), okText);
  const feeOf = (pay, id) => {
    const own = pay.course[id] || {}, unit = String(pay.settings.currency || '৳').trim(), away = !!own.external, amount = String(own.price || (away ? '' : pay.settings.price) || '').trim();
    const money = (v) => (/^[a-z]/i.test(unit) ? `${unit} ${v}` : unit + v);
    const paid = !away && own.paid !== false;
    let host = ''; try { host = away ? new URL(own.external).hostname.replace(/^www\./, '') : ''; } catch (e) {}
    // an entry on another website: nothing is paid here; a price, if typed, is only shown
    if (away) return { paid: false, away: true, host, priced: true, label: amount ? money(amount) + ' on their site' : 'price on their site' };
    return { paid, priced: !paid || !!amount, label: !paid ? 'free' : amount ? money(amount) + (own.was ? ` · was ${money(own.was)}` : '') : 'paid — no price set' };
  };

  let madeCoupon = '';   // the code just made, shown large once
  // ── questions & answers (faq) ──────────────────────────────────────────────
  // Two lists: the one on the academy page, and the one on a learner's own page. They are kept
  // together in site_text as  pay.faq = { academy: [{q, a}], my: [{q, a}] }.  A list that has
  // never been saved shows the questions the website came with (the same words as in
  // academy/index.html and js/lms.js).
  const FAQ_PLACES = [['academy', 'the academy page', 'everyone sees these, under “frequently asked”'], ['my', 'the learner’s own page', 'signed-in learners see these, under “questions people ask”']];
  const FAQ_BUILT_IN = {
    academy: [
      ['do i need any prior experience?', 'most courses are built for beginners, and every course is marked by level — check it on the course page before you start.'],
      ['is it live or self-paced?', 'both. courses are self-paced — short modules you work through in your own time. programs and webinars include live classes on set dates, shown in your own time zone, with a recording afterwards where one is offered.'],
      ['how do i enrol?', 'open a course and press enrol. you will need a free account, which takes a minute to create — some courses and every preview lesson are open without one.'],
      ['do you offer certificates?', 'yes. finish every lesson and pass the quizzes in a course and you can download a completion certificate with your name on it.'],
      ['can international learners join?', 'yes — the courses are online and open to learners anywhere.'],
    ],
    my: [
      ['how do i join a course?', 'open it from the academy page and press “enrol”. a free one starts straight away. for a paid one you are taken to the payment page.'],
      ['how do i pay?', 'by bkash. the payment page shows our number and the amount. send it from your bkash app, then type two things on that page: the number you paid from and the transaction id (trxid) from the bkash message.'],
      ['i paid — why are my lessons still locked?', 'we check each payment by hand, usually within a day. you do not need to do anything: when it is confirmed, the lessons open by themselves and this page shows it.'],
      ['how do i join a live class?', 'open the class from this page or from the course. the room opens 15 minutes before the start: press “enter the live class”. it happens on this website — there is nothing to install.'],
      ['my camera or microphone does not work', 'on the class page press “test my camera & microphone” before the class. if the browser blocked it, press the padlock beside the website address and allow both. you can always join without them and use the chat.'],
      ['will i lose my place if i change phone?', 'no. sign in with the same google account on any phone or laptop and your lessons, notes and certificates are there.'],
      ['how do i get my certificate?', 'finish every lesson of a course. the certificate then appears on this page under “completed”, with a link you can share.'],
    ],
  };
  const faqList = (pay, place) => (Array.isArray((pay.faq || {})[place]) ? pay.faq[place].filter((x) => x && x.q) : FAQ_BUILT_IN[place].map(([q, a]) => ({ q, a })));
  let faqOpen = false, faqPlace = 'academy', faqEdit = -1;   // the box stays open after a save; which list; which question is being changed
  function faqBox(pay) {
    const list = faqList(pay, faqPlace), editing = list[faqEdit];
    return `<details class="group faq-box" id="faq-box"${faqOpen ? ' open' : ''}><summary>questions &amp; answers (faq)<small><b>${faqList(pay, 'academy').length}</b> on the academy page · <b>${faqList(pay, 'my').length}</b> on the learner’s page · press to add or change</small></summary>
      <div style="padding:4px 20px 22px;">
        <p class="lede" style="margin-top:16px;">the questions people can open and read. choose which list, then add, change, remove or move them.</p>
        <div class="field"><span>which list?</span><div class="choice choice--2">${FAQ_PLACES.map(([k, t, s]) => `<button type="button" data-faq-place="${k}"${k === faqPlace ? ' class="is-on" aria-pressed="true"' : ' aria-pressed="false"'}><b>${t}</b><small>${s}</small></button>`).join('')}</div></div>
        <form id="faq-form" class="card" style="margin-top:14px;"><h2 class="card-title">${editing ? 'change this question' : 'add a question'}</h2>
          <label class="field"><span>the question</span><input name="q" required maxlength="160" autocomplete="off" value="${esc(editing ? editing.q : '')}" placeholder="e.g. can i pay in two parts?"></label>
          <label class="field"><span>the answer</span><textarea name="a" required rows="3" maxlength="1200" placeholder="write the answer in plain words">${esc(editing ? editing.a : '')}</textarea></label>
          <div class="editor-foot"><button class="btn btn--solid" type="submit">${editing ? 'save changes' : 'add this question'}</button>${editing ? '<button class="btn" type="button" data-faq-cancel>cancel</button>' : ''}</div>
        </form>
        <div class="h2" style="margin-top:28px;"><span>on ${FAQ_PLACES.find(([k]) => k === faqPlace)[1]} <small>${list.length}</small></span></div>
        <div class="rows">${list.map((x, i) => `<div class="row faq-row" data-faq="${i}">
            <div class="faq-n">${i + 1}</div>
            <div><strong style="text-transform:none;">${esc(x.q)}</strong><span class="sub" style="text-transform:none;">${esc(x.a)}</span></div>
            <div class="row-actions"><button class="btn btn--sm" data-faq-up title="move up" aria-label="move up"${i ? '' : ' disabled'}>↑</button><button class="btn btn--sm" data-faq-down title="move down" aria-label="move down"${i < list.length - 1 ? '' : ' disabled'}>↓</button><button class="btn btn--sm btn--solid" data-faq-edit>change</button><button class="btn btn--sm btn--danger" data-faq-del>remove</button></div>
          </div>`).join('') || '<p class="empty">no questions in this list, so this part is left out of the page. add one above to bring it back.</p>'}</div>
      </div></details>`;
  }
  // every change is one save of the whole list, read fresh first so nothing saved elsewhere is lost
  async function faqChange(change, okText) {
    const pay = await payLoad(), list = faqList(pay, faqPlace).map((x) => ({ q: x.q, a: x.a }));
    const next = change(list); if (!next) return false;
    return paySave('pay.faq', { ...(pay.faq || {}), [faqPlace]: next }, okText);
  }
  let teacherOpen = false, teacherEdit = null;   // the teachers box: kept open after a save, and who is being changed
  async function coursesView(courseId) {
    await checkAcademy();
    if (courseId && courseId.startsWith('new:')) return courseEditor(null, null, courseId.slice(4));
    if (courseId) return courseEditor(courseId);
    const [courses, lessons, pay, couponRows, usedRows] = await Promise.all([
      run(sb.from('courses').select('*').order('sort_order').order('created_at')),
      run(sb.from('course_lessons').select('course_id')),
      payLoad(),
      sb.from('coupons').select('*').order('created_at', { ascending: false }),
      can('learners') ? sb.from('payments').select('coupon,status').not('coupon', 'is', null) : Promise.resolve({ data: null }),
    ]);
    if (!courses || !lessons) return;
    // coupons need seed/website-backend-10-coupons.sql; without it the box is simply left out
    const coupons = couponRows.error ? null : (couponRows.data || []);
    const used = (code) => (usedRows.data || []).filter((p) => p.coupon === code && p.status !== 'rejected').length;
    const cur = String(pay.settings.currency || '৳').trim();
    const money = (v) => (/^[a-z]/i.test(cur) ? `${cur} ${v}` : cur + v);
    const worth = (k) => (k.kind === 'percent' ? `${+k.value}% off` : `${money(+k.value)} off`);
    const couponState = (k) => { const now = Date.now(); return k.is_off ? ['switched off', ''] : k.starts_at && now < +new Date(k.starts_at) ? [`starts ${whenText(k.starts_at)}`, 'wait'] : k.ends_at && now >= +new Date(k.ends_at) ? [`ended ${whenText(k.ends_at)}`, ''] : [k.ends_at ? `working — until ${whenText(k.ends_at)}` : 'working now', 'on']; };
    const paidOnes = courses.filter((c) => feeOf(pay, c.id).paid);
    const ps = pay.settings;
    const count = (id) => lessons.filter((l) => l.course_id === id).length;
    const rowsOf = (type) => courses.filter((c) => typeOf(c) === type);
    const one = { course: 'course', program: 'program', webinar: 'webinar' };
    main.innerHTML = head('academy', 'everything on the academy page. press “edit” on one to change it, set its price or add lessons and live classes. a draft is only seen here — publish it to put it on the website.',
      Object.keys(TYPES).map((t) => `<button class="btn${t === 'course' ? ' btn--solid' : ''}" data-new="${t}">+ new ${t}</button>`).join(''))
      + setupNote()
      + `<details class="group pay-box"${ps.bkash ? '' : ' open'}><summary>where learners send the fee — bkash<small>${ps.bkash ? `<b>${esc(ps.bkash.slice(0, 5))} ${esc(ps.bkash.slice(5))}</b> · press to change` : '<b style="color:#f2b42e;">not set yet — paid entries say “payment opens soon”</b>'}</small></summary>
      <form id="bkash-form" style="padding:4px 20px 22px;"><div class="form-grid">
        <label class="field"><span>your bkash number</span><input name="bkash" inputmode="numeric" value="${esc(ps.bkash || '')}" placeholder="017XXXXXXXX" maxlength="17">
          <small class="hint">learners are told to send the fee to this number. check every digit.</small></label>
        <div class="field"><span>what kind of bkash account is it?</span>${choice('bkash_type', [['personal', 'personal', 'learners use “send money”'], ['merchant', 'merchant', 'learners use “payment”']], ps.bkash_type === 'merchant' ? 'merchant' : 'personal', 'choice--2')}
          <small class="hint">the wrong one makes payments fail in the bkash app.</small></div>
        <label class="field field--wide"><span>anything else to tell learners on the payment page (optional)</span><textarea name="note" rows="2" placeholder="e.g. payments are checked every evening.">${esc(ps.note || '')}</textarea></label>
      </div><div class="editor-foot"><button class="btn btn--solid" type="submit">save bkash details</button></div></form></details>
      <details class="group signin-box"><summary>how learners sign in<small>${ps.email_login ? '<b>google, or email and password</b> · press to change' : '<b>google only</b> · press to change'}</small></summary>
      <form id="signin-form" style="padding:4px 20px 22px;">
        <div class="field"><span>which ways can learners sign in?</span>${choice('email_login', [['0', 'google only', 'one click with a google account — nothing to set up', 'G'], ['1', 'google, or email and password', 'for learners without google. needs an email sender — see below', '@']], ps.email_login ? '1' : '0', 'choice--2')}</div>
        <div class="note-box" data-when="email_login=1">
          <b>before you switch this on:</b> a learner who signs up with an email gets a message to confirm it, and one to reset a forgotten password. supabase’s own sender only delivers to your supabase team, so connect a free email sender first:
          <ol>
            <li>make a free account at <b>brevo.com</b> (no card) and, under <b>senders</b>, add and confirm the email address the messages should come from.</li>
            <li>in brevo open <b>smtp &amp; api</b> and make an <b>smtp key</b>.</li>
            <li>in supabase open <b>authentication → emails → smtp settings</b>, switch on <b>custom smtp</b> and fill in: host <code>smtp-relay.brevo.com</code>, port <code>587</code>, username = your brevo login, password = the smtp key, and the sender email from step 1.</li>
            <li>press save, then on the website press “sign in” → “create account” with a test email of yours. if the message arrives, it all works. if it does not, come back and choose “google only” again.</li>
          </ol>
        </div>
        <div class="editor-foot"><button class="btn btn--solid" type="submit">save</button></div></form></details>
      <details class="group help-box"${ps.whatsapp ? '' : ' open'}><summary>help for learners — your whatsapp number<small>${ps.whatsapp ? `<b>+${esc(ps.whatsapp)}</b> · press to change` : '<b style="color:#f2b42e;">not set yet — learners are told to email instead</b>'}</small></summary>
      <form id="help-form" style="padding:4px 20px 22px;">
        <label class="field field--short" style="max-width:420px;"><span>the whatsapp number learners can message</span><input name="whatsapp" inputmode="tel" value="${esc(ps.whatsapp ? '+' + ps.whatsapp : '')}" placeholder="017XXXXXXXX" maxlength="20">
          <small class="hint">a “message us on whatsapp” button with this number appears on every learner’s “my learning” page, on the payment page and on live class pages. type it the way you would dial it — a bangladesh number like 017… gets +88 added for you. leave it empty to take the button away.</small></label>
        <div class="editor-foot"><button class="btn btn--solid" type="submit">save whatsapp number</button>${ps.whatsapp ? `<a class="btn" href="https://wa.me/${esc(ps.whatsapp)}" target="_blank" rel="noopener noreferrer">try it ↗</a>` : ''}</div></form></details>`
      + `<details class="group teacher-box" id="teacher-box"${teacherOpen ? ' open' : ''}><summary>teachers — saved once, used on any course<small>${pay.teachers.length ? `<b>${pay.teachers.length} saved</b> · press to add or change` : 'none yet — press to add your teachers'}</small></summary>
      <div style="padding:4px 20px 22px;">
        <p class="lede" style="margin-top:16px;">save each teacher here once. when you make a course, program or webinar, “who teaches it” then shows them — one press fills in the name, role and photo.</p>
        <form id="teacher-form" class="card" style="margin-top:14px;"><h2 class="card-title">${teacherEdit ? 'change ' + esc(teacherEdit.name) : 'add a teacher'}</h2>
          <input type="hidden" name="was" value="${esc(teacherEdit ? teacherEdit.name : '')}">
          <div class="form-grid">
            <label class="field"><span>teacher’s name</span><input name="name" required value="${esc(teacherEdit ? teacherEdit.name : '')}" autocomplete="off" placeholder="e.g. Ariyan Biswas"></label>
            <label class="field"><span>their role or organisation</span><input name="role" value="${esc(teacherEdit ? teacherEdit.role || '' : '')}" autocomplete="off" placeholder="e.g. President"></label>
            <div class="field field--wide"><span>their photo (optional)</span>${imageField('img', teacherEdit ? teacherEdit.img : '')}</div>
          </div>
          <div class="editor-foot"><button class="btn btn--solid" type="submit">${teacherEdit ? 'save changes' : 'save this teacher'}</button>${teacherEdit ? '<button class="btn" type="button" data-teacher-cancel>cancel</button>' : ''}</div></form>
        <div class="h2" style="margin-top:28px;"><span>saved teachers <small>${pay.teachers.length}</small></span></div>
        <div class="rows">${pay.teachers.map((t, i) => `<div class="row" data-saved-teacher="${i}">
            <div class="thumb">${t.img ? `<img src="${esc(img(t.img))}" alt="" data-fallback="${esc(t.name.trim()[0] || '?')}">` : esc(t.name.trim()[0] || '?')}</div>
            <div><strong style="text-transform:none;">${esc(t.name)}</strong><span class="sub">${esc(t.role || 'no role saved')}${courses.filter((c) => String(c.instructor_name || '').trim().toLowerCase() === t.name.trim().toLowerCase()).length ? ` · teaches ${courses.filter((c) => String(c.instructor_name || '').trim().toLowerCase() === t.name.trim().toLowerCase()).length} here` : ''}</span></div>
            <div class="row-actions"><button class="btn btn--sm btn--solid" data-teacher-edit>change</button><button class="btn btn--sm btn--danger" data-teacher-del>remove</button></div>
          </div>`).join('') || '<p class="empty">no teachers saved yet. fill in the form above and press “save this teacher”.</p>'}</div>
      </div></details>`
      + faqBox(pay)
      + (coupons ? `<details class="group coupon-box" id="coupon-box"${madeCoupon ? ' open' : ''}><summary>coupons — discount codes<small>${coupons.filter((k) => couponState(k)[1] === 'on').length ? `<b>${coupons.filter((k) => couponState(k)[1] === 'on').length} working now</b>` : coupons.length ? 'none working now' : 'none yet — press to make one'}</small></summary>
      <div style="padding:4px 20px 22px;">
        <p class="lede" style="margin-top:16px;">a coupon is a code a learner types on the payment page to pay less. you choose what it is worth and when it works — the code itself is made for you.</p>
        ${madeCoupon ? `<div class="coupon-made"><span>your new coupon — send this code to your learners</span><code>${esc(madeCoupon)}</code><button type="button" class="btn btn--solid" data-copy-code="${esc(madeCoupon)}">copy the code</button></div>` : ''}
        <form id="coupon-form" class="card" style="margin-top:14px;"><h2 class="card-title">make a coupon</h2>
          <div class="field"><span>what is it worth?</span>${choice('kind', [['percent', 'a percentage off', 'for example 20% off the fee', '%'], ['amount', 'an amount of money off', `for example ${money(100)} off the fee`, cur]], 'percent', 'choice--2')}</div>
          <label class="field field--short"><span data-when="kind=percent">how many percent off? (1 to 99)</span><span data-when="kind=amount">how much money off? (in ${esc(cur)})</span><input name="value" inputmode="decimal" required placeholder="20" autocomplete="off"></label>
          <div class="field"><span>when does it start working?</span>${choice('start', [['now', 'straight away', 'as soon as it is made'], ['date', 'on a date', 'you choose the day and time']], 'now', 'choice--2')}</div>
          <label class="field field--short" data-when="start=date"><span>the day and time it starts</span><input name="starts_at" type="datetime-local"></label>
          <div class="field"><span>when does it stop working?</span>${choice('stop', [['never', 'when i switch it off', 'it keeps working until then'], ['date', 'on a date', 'it stops by itself']], 'never', 'choice--2')}</div>
          <label class="field field--short" data-when="stop=date"><span>the day and time it stops</span><input name="ends_at" type="datetime-local"></label>
          <label class="field"><span>what can it be used on?</span><select name="course_id"><option value="">every paid course, program and webinar</option>${paidOnes.map((c) => `<option value="${esc(c.id)}">only: ${esc(c.title)}</option>`).join('')}</select></label>
          <label class="field"><span>a note for yourself (optional)</span><input name="note" maxlength="200" placeholder="e.g. eid offer, for the first 20 students" autocomplete="off"></label>
          <div class="editor-foot"><button class="btn btn--solid" type="submit">make the coupon</button><span class="foot-note">a code like “K7QM2XPA” is made for you.</span></div></form>
        <div class="h2" style="margin-top:28px;"><span>your coupons <small>${coupons.length}</small></span></div>
        <div class="rows">${coupons.map((k) => { const [state, tone] = couponState(k); return `<div class="row row--plain" data-coupon="${esc(k.code)}">
            <div><strong style="text-transform:none;"><code class="coupon-code">${esc(k.code)}</code></strong>
              <span class="pills"><span class="badge${tone === 'on' ? ' badge--on' : ''}"${tone === 'wait' ? ' style="border-color:#f2b42e;color:#f2b42e;"' : ''}>${esc(state)}</span><span class="badge badge--on">${esc(worth(k))}</span>${usedRows.data ? `<span class="badge">used ${used(k.code)} time${used(k.code) === 1 ? '' : 's'}</span>` : ''}</span>
              <span class="sub">${k.course_id ? 'only for: ' + esc((courses.find((c) => c.id === k.course_id) || {}).title || k.course_id) : 'for every paid course, program and webinar'}${k.note ? ' · ' + esc(k.note) : ''}</span></div>
            <div class="row-actions"><button class="btn btn--sm" data-copy-code="${esc(k.code)}">copy</button><button class="btn btn--sm" data-coupon-off>${k.is_off ? 'switch on' : 'switch off'}</button><button class="btn btn--sm btn--danger" data-coupon-del>delete</button></div>
          </div>`; }).join('') || '<p class="empty">no coupons yet. fill in the form above and press “make the coupon”.</p>'}</div>
      </div></details>` : '')
      + Object.keys(TYPES).map((type) => `<div class="h2"><span>${TYPES[type]} <small>${rowsOf(type).length}</small></span></div>
      <div class="rows">${rowsOf(type).map((c) => { const f = feeOf(pay, c.id); return `<div class="row row--plain row--entry" data-id="${esc(c.id)}">
          <div><strong>${esc(c.title)}</strong>
            <span class="pills"><span class="badge${c.status === 'published' ? ' badge--on' : ''}">${c.status === 'published' ? 'on the website' : 'draft'}</span><span class="badge${f.priced ? ' badge--on' : ''}"${f.priced ? '' : ' style="border-color:#f2b42e;color:#f2b42e;"'}>${esc(f.label)}</span>${f.away ? `<span class="badge badge--on" style="text-transform:none;">↗ on ${esc(f.host)}</span>` : ''}${c.featured ? '<span class="badge badge--on">★ featured</span>' : ''}</span>
            <span class="sub">${c.starts_at ? whenText(c.starts_at) + ' · ' : ''}${f.away ? 'on another website' : `${count(c.id)} lesson${count(c.id) === 1 ? '' : 's'}`} · ${esc(c.category)} · ${esc(c.level)}</span></div>
          <div class="row-actions"><button class="btn btn--sm btn--solid" data-open>edit</button><button class="btn btn--sm" data-toggle title="${c.status === 'published' ? 'take it off the website (it stays here as a draft)' : 'put it on the academy page'}">${c.status === 'published' ? 'unpublish' : 'publish'}</button>
            <details class="menu"><summary class="btn btn--sm" aria-label="more actions">more ▾</summary><div class="menu-in">
              <a href="${A.root}academy/${encodeURIComponent(c.id)}" target="_blank" rel="noopener">see it on the site ↗</a>
              ${f.away ? '' : `<button type="button" data-fee title="${f.paid ? 'let anyone with an account enrol without paying' : 'send learners to the payment page before they can enrol'}">${f.paid ? 'make free' : 'make paid'}</button>`}
              <button type="button" data-feature title="${c.featured ? 'take it out of the featured card' : 'show it in the large featured card at the top of the academy page'}">${c.featured ? '★ featured' : '☆ feature'}</button>
            </div></details></div>
        </div>`; }).join('') || `<p class="empty">no ${TYPES[type]} yet — press “+ new ${one[type]}” at the top to make the first one.</p>`}</div>`).join('');
    $$('[data-new]', main).forEach((b) => b.addEventListener('click', () => courseEditor(null, null, b.dataset.new)));
    $('#bkash-form', main).addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target));
      let n = v.bkash.replace(/[^0-9]/g, ''); if (n.startsWith('880')) n = n.slice(2); if (n.length === 10 && n[0] === '1') n = '0' + n;
      if (n && !/^01[3-9]\d{8}$/.test(n)) return toast('that does not look like a bkash number — it should be 11 digits, like 017XXXXXXXX', true);
      if (n && n !== (ps.bkash || '') && !confirm(`learners will be told to send their fees to ${n.slice(0, 5)} ${n.slice(5)}.\n\ncheck every digit — money sent to a wrong number cannot be brought back.\n\nsave this number?`)) return;
      // read the settings again first, so nothing saved elsewhere in the meantime is lost
      const fresh = (await payLoad()).settings;
      if (await paySave('pay.settings', { ...fresh, bkash: n, bkash_type: v.bkash_type === 'merchant' ? 'merchant' : 'personal', note: v.note.trim() }, n ? 'bkash details saved' : 'saved — without a number, paid entries say “payment opens soon”')) coursesView();
    });
    syncShown($('#signin-form', main));
    $('#signin-form', main).addEventListener('submit', async (e) => {
      e.preventDefault();
      const on = new FormData(e.target).get('email_login') === '1';
      const fresh = (await payLoad()).settings;
      if (await paySave('pay.settings', { ...fresh, email_login: on }, on ? 'saved — learners can now also create an account with their email' : 'saved — learners sign in with google only')) coursesView();
    });
    $('#help-form', main).addEventListener('submit', async (e) => {
      e.preventDefault();
      let n = String(new FormData(e.target).get('whatsapp')).replace(/[^0-9]/g, '');
      if (/^01\d{9}$/.test(n)) n = '88' + n;          // a bangladesh number written the local way
      if (n.startsWith('00')) n = n.slice(2);
      if (n && (n.length < 10 || n.length > 15)) return toast('that does not look like a phone number — type it with its country code, like 8801712345678, or the local way, like 01712345678', true);
      // read the settings again first, so nothing saved elsewhere in the meantime is lost
      const fresh = (await payLoad()).settings;
      if (await paySave('pay.settings', { ...fresh, whatsapp: n }, n ? `saved — learners now see a whatsapp button for +${n}` : 'saved — the whatsapp button is gone; learners are told to email')) coursesView();
    });
    // ── questions & answers: add, change, remove, move ──
    $('#faq-form', main).addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target)), q = v.q.trim(), a = v.a.trim(), at = faqEdit;
      if (!q || !a) return toast('type both the question and its answer', true);
      if (await faqChange((list) => { if (at >= 0 && list[at]) list[at] = { q, a }; else list.push({ q, a }); return list; }, at >= 0 ? 'question saved' : 'question added — it is on the website now')) { faqOpen = true; faqEdit = -1; coursesView(); }
    });
    $('#faq-box', main).addEventListener('click', async (e) => {
      const place = e.target.closest('[data-faq-place]');
      if (place) { faqPlace = place.dataset.faqPlace; faqEdit = -1; faqOpen = true; return coursesView(); }
      if (e.target.closest('[data-faq-cancel]')) { faqEdit = -1; faqOpen = true; return coursesView(); }
      const row = e.target.closest('[data-faq]'); if (!row) return;
      const i = +row.dataset.faq, x = faqList(pay, faqPlace)[i]; if (!x) return;
      if (e.target.closest('[data-faq-edit]')) { faqEdit = i; faqOpen = true; await coursesView(); const f = $('#faq-form', main); if (f) { f.scrollIntoView({ block: 'center' }); f.q.focus(); } return; }
      const move = e.target.closest('[data-faq-up]') ? -1 : e.target.closest('[data-faq-down]') ? 1 : 0;
      if (move) { if (await faqChange((list) => { const j = i + move; if (j < 0 || j >= list.length) return null; [list[i], list[j]] = [list[j], list[i]]; return list; }, 'moved')) { faqOpen = true; faqEdit = -1; coursesView(); } return; }
      if (e.target.closest('[data-faq-del]')) {
        if (!confirm(`remove the question “${x.q}”?`)) return;
        if (await faqChange((list) => { list.splice(i, 1); return list; }, 'question removed')) { faqOpen = true; faqEdit = -1; coursesView(); }
      }
    });

    // ── teachers: add, change, remove ──
    const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    $('#teacher-form', main).addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target)), name = v.name.trim();
      if (!name) return toast('type the teacher’s name', true);
      // read the list again first, so a teacher saved from another screen in the meantime is not lost
      const list = (await payLoad()).teachers;
      if (list.some((t) => sameName(t.name, name)) && !sameName(v.was, name)) return toast(`${name} is already saved — press “change” beside their name to update them`, true);
      const next = list.filter((t) => !sameName(t.name, v.was || name));
      next.push({ name, role: v.role.trim(), img: v.img.trim() });
      next.sort((a, b) => a.name.localeCompare(b.name));
      if (await paySave('pay.teachers', next, v.was ? `${name} updated` : `${name} saved — they now appear under “who teaches it”`)) { teacherOpen = true; teacherEdit = null; coursesView(); }
    });
    const cform = $('#coupon-form', main);
    if (cform) {
      syncShown(cform);
      cform.addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = Object.fromEntries(new FormData(cform));
        const n = parseFloat(String(v.value).replace(/[^0-9.]/g, ''));
        if (!(n > 0)) return toast('type what the coupon is worth — a number', true);
        if (v.kind === 'percent' && !(n >= 1 && n <= 99)) return toast('a percentage coupon is between 1 and 99. to let someone in for free, use “let someone in without a bkash payment” on the learners screen.', true);
        const starts = v.start === 'date' ? fromLocalInput(v.starts_at) : null, ends = v.stop === 'date' ? fromLocalInput(v.ends_at) : null;
        if (v.start === 'date' && !starts) return toast('choose the day and time it starts — or pick “straight away”', true);
        if (v.stop === 'date' && !ends) return toast('choose the day and time it stops — or pick “when i switch it off”', true);
        if (ends && +new Date(ends) <= Math.max(Date.now(), starts ? +new Date(starts) : 0)) return toast('the stop time has to be after the start time, and in the future', true);
        // the fee it is used on must stay above zero
        if (v.kind === 'amount') {
          const prices = (v.course_id ? paidOnes.filter((c) => c.id === v.course_id) : paidOnes).map((c) => parseFloat(String((pay.course[c.id] || {}).price || pay.settings.price || '').replace(/[^0-9.]/g, ''))).filter((p) => p > 0);
          const tooBig = prices.filter((p) => p <= n).length;
          if (prices.length && tooBig === prices.length) return toast(`${money(n)} is the whole fee or more — a coupon has to leave something to pay. choose a smaller amount.`, true);
          if (tooBig && !confirm(`${money(n)} off is more than the fee of ${tooBig} of your paid entries, so the coupon will not work on ${tooBig === 1 ? 'that one' : 'those'}. make it anyway?`)) return;
        }
        // the code: 8 letters and numbers that are hard to mix up (no 0/O, 1/I)
        const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        for (let tries = 0; tries < 4; tries += 1) {
          const code = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => ABC[b % ABC.length]).join('');
          const { error } = await sb.from('coupons').insert({ code, kind: v.kind === 'amount' ? 'amount' : 'percent', value: n, starts_at: starts, ends_at: ends, course_id: v.course_id || null, note: v.note.trim() || null, created_by: user.email });
          if (!error) { madeCoupon = code; toast(`coupon ${code} made`); return coursesView(); }
          if (!/duplicate|coupons_pkey/i.test(error.message)) return toast(error.message, true);
        }
        toast('a code could not be made — try again', true);
      });
    }
    main.onclick = async (e) => {
      const copyCode = e.target.closest('[data-copy-code]');
      if (copyCode) { try { await navigator.clipboard.writeText(copyCode.dataset.copyCode); toast(`${copyCode.dataset.copyCode} copied — paste it wherever you tell your learners`); } catch (err) { prompt('copy this code', copyCode.dataset.copyCode); } return; }
      if (e.target.closest('[data-teacher-cancel]')) { teacherEdit = null; teacherOpen = true; return coursesView(); }
      const trow = e.target.closest('[data-saved-teacher]');
      if (trow) {
        const t = pay.teachers[+trow.dataset.savedTeacher];
        if (e.target.closest('[data-teacher-edit]')) { teacherEdit = t; teacherOpen = true; await coursesView(); const f = $('#teacher-form', main); if (f) { f.scrollIntoView({ block: 'center' }); f.name.focus(); } return; }
        if (e.target.closest('[data-teacher-del]')) {
          if (!confirm(`remove ${t.name} from your saved teachers?\n\ncourses that already show ${t.name} keep them — this only takes them off the list you pick from.`)) return;
          const next = (await payLoad()).teachers.filter((x) => !sameName(x.name, t.name));
          if (await paySave('pay.teachers', next, `${t.name} removed from the saved teachers`)) { teacherOpen = true; teacherEdit = null; coursesView(); }
        }
        return;
      }
      const krow = e.target.closest('[data-coupon]');
      if (krow) {
        const k = coupons.find((x) => x.code === krow.dataset.coupon);
        if (e.target.closest('[data-coupon-off]')) { if (await run(sb.from('coupons').update({ is_off: !k.is_off }).eq('code', k.code), k.is_off ? `${k.code} is switched on again` : `${k.code} is switched off — it no longer lowers the fee`)) { madeCoupon = ''; coursesView(); } return; }
        if (e.target.closest('[data-coupon-del]')) { if (!confirm(`delete the coupon ${k.code}? learners who type it will be told it is not one of ours. payments already made with it are not changed.`)) return; if (await run(sb.from('coupons').delete().eq('code', k.code), `${k.code} deleted`)) { madeCoupon = ''; coursesView(); } return; }
        return;
      }
      const row = e.target.closest('.row'); if (!row) return;
      const c = courses.find((x) => x.id === row.dataset.id);
      if (e.target.closest('[data-open]')) return go('courses', c.id);
      if (e.target.closest('[data-fee]')) {
        const own = pay.course[c.id] || {}, toPaid = own.paid === false;
        if (await paySave('pay.course.' + c.id, { ...own, paid: toPaid }, toPaid ? (own.price || ps.price ? 'now paid' : 'now paid — open it with “edit” to set its price') : 'now free')) coursesView();
        return;
      }
      if (e.target.closest('[data-feature]')) {
        const note = c.featured ? 'no longer featured' : c.status === 'published' ? 'featured — it now has the large card at the top of the academy page' : 'featured — it will appear in the large card once it is published';
        if (await run(sb.from('courses').update({ featured: !c.featured }).eq('id', c.id), note)) coursesView();
        return;
      }
      if (e.target.closest('[data-toggle]')) {
        const status = c.status === 'published' ? 'draft' : 'published';
        if (await run(sb.from('courses').update({ status }).eq('id', c.id), status === 'published' ? 'published — now on the academy page' : 'moved back to draft')) coursesView();
      }
    };
  }

  // quiz ⇄ a plain-text format that is quick to type:
  //   ? question      - wrong option      * correct option      > explanation
  const quizToText = (quiz) => (quiz || []).map((q) => [`? ${q.q}`, ...q.options.map((o, i) => `${i === q.answer ? '*' : '-'} ${o}`), ...(q.why ? [`> ${q.why}`] : [])].join('\n')).join('\n\n');
  function textToQuiz(text) {
    const out = []; let cur = null;
    text.split('\n').map((l) => l.trim()).filter(Boolean).forEach((l) => {
      const body = l.slice(1).trim();
      if (l[0] === '?') { cur = { q: body, options: [], answer: 0 }; out.push(cur); }
      else if (!cur) return;
      else if (l[0] === '*') { cur.answer = cur.options.length; cur.options.push(body); }
      else if (l[0] === '-') cur.options.push(body);
      else if (l[0] === '>') cur.why = body;
    });
    return out.filter((q) => q.q && q.options.length >= 2);
  }

  async function courseEditor(id, openLesson, newKind) {
    await checkAcademy();
    let course = { id: '', title: '', kind: TYPES[newKind] ? newKind : 'course', category: 'general', level: 'beginner', access: 'account', status: 'draft', outcomes: [], sort_order: 0 };
    let modules = [], lessons = [];
    if (id) {
      const [c, m, l] = await Promise.all([
        run(sb.from('courses').select('*').eq('id', id).maybeSingle()),
        run(sb.from('course_modules').select('*').eq('course_id', id).order('sort_order')),
        run(sb.from('course_lessons').select('*').eq('course_id', id).order('sort_order')),
      ]);
      if (!c || c === true || !m || !l) { if (c === true) toast('that course no longer exists', true); return go('courses'); }
      course = c; modules = m === true ? [] : m; lessons = l === true ? [] : l;
    }
    const noun = typeOf(course);
    const needs = academyReady ? '' : ' — needs setup';
    const pay = await payLoad();
    const own = pay.course[id] || {};
    const opt = (value, list) => list.map((o) => `<option${o === value ? ' selected' : ''}>${o}</option>`).join('');
    let content = null;
    // 'new:<module id>' means a blank form for a lesson that doesn't exist yet
    if (openLesson && !openLesson.startsWith('new:')) {
      const got = await run(sb.from('lesson_content').select('*').eq('lesson_id', openLesson).maybeSingle());
      content = got && got !== true ? got : {};
    }

    // A lesson is made in two steps: choose what kind it is, then fill in the few boxes that
    // kind needs. Boxes for other kinds stay hidden (data-for lists the kinds a box belongs to).
    const lessonForm = (l, moduleId) => {
      const c = content || {};
      const files = c.resources || [];
      const isPdf = (l.kind || 'article') === 'article' && !c.video_url && !(c.body || '').trim() && files.some((r) => /\.pdf($|[?#])/i.test(String(r.url || '')));
      const ui = !l.id ? '' : isPdf ? 'pdf' : (UI_KIND[l.kind] ? l.kind : 'article');
      return `<form class="editor lesson-form" data-lesson="${esc(l.id || '')}" data-module="${esc(moduleId)}" data-ui="${ui}" data-was="${esc(l.kind || '')}">
      <div class="step"><span class="step-n">1</span><div class="step-in">
        <h3>${l.id ? 'what kind of lesson this is' : 'what kind of lesson do you want to add?'}</h3>
        <div class="choice choice--cards" data-choice="kind" data-types>${LESSON_TYPES.map(([u, k, title, text, icon]) => `<button type="button" data-ui="${u}" data-value="${k}" aria-pressed="false"><i aria-hidden="true">${icon}</i><b>${title}</b><small>${text}</small></button>`).join('')}</div>
        <select name="kind" hidden>${[['article', 'reading'], ['video', 'video'], ['live', 'live class'], ['quiz', 'quiz'], ['form', 'test or assignment']].map(([k, t]) => `<option value="${k}"${(l.kind || 'article') === k ? ' selected' : ''}>${t}</option>`).join('')}</select>
      </div></div>

      <div class="step" data-for="video article pdf live quiz form"><span class="step-n">2</span><div class="step-in">
        <h3>fill it in</h3>

        <div class="field" data-for="video"><div class="field-top"><span>the video — paste a youtube link</span><label class="linkish" style="cursor:pointer;">or upload a video file<input type="file" accept="video/mp4,video/webm,video/quicktime,video/*" hidden data-video-upload></label></div>
          <input name="video_url" value="${esc(c.video_url || '')}" placeholder="https://youtu.be/…">
          <small class="hint" data-video-status>any youtube link works and plays inside the lesson. for long videos, upload to youtube as “unlisted” and paste the link here. an uploaded file must be .mp4 and under 50 MB.</small></div>

        <label class="field"><span data-word="title">lesson title</span><input name="title" value="${esc(l.title || '')}">
          <small class="hint" data-for="video">you can leave this empty — it is filled in from the youtube video. change it if you want different wording.</small>
          <small class="hint" data-for="article pdf live quiz form">people can read this before they enrol or pay, so say clearly what it is.</small></label>

        <label class="field" data-for="live"><span>date and time of the class${needs}</span><input name="live_at" type="datetime-local" value="${toLocalInput(l.live_at)}">
          <small class="hint">use your own clock — each learner sees it in their own time. at that time, open this lesson while signed in here and press “start teaching”; learners press “enter the live class”. no date yet? leave it empty and it says “date to be announced”.</small></label>

        <label class="field" data-for="form"><span>the google form link</span><input name="form_url" value="${esc(c.form_url || '')}" placeholder="https://docs.google.com/forms/…">
          <small class="hint">in google forms press “send”, choose the link, and paste it here. the form shows inside the lesson; answers arrive in google forms.</small></label>

        <div class="field" data-for="quiz"><span>the questions</span>
          <div class="quiz-build" data-quiz></div>
          <small class="hint">learners pass when they get 70% right.</small></div>

        <div data-slot="main"></div>

        <div class="field" data-for="video article pdf live quiz form"><span data-word="files">files for learners to download (optional)</span>
          <div class="files" data-files></div>
          <div class="file-add">
            <label class="btn btn--sm btn--solid" data-for="pdf">upload a pdf<input type="file" accept="application/pdf,.pdf" hidden data-attach="resources" data-pdf></label>
            <label class="btn btn--sm" data-for="video article live quiz form">upload a pdf<input type="file" accept="application/pdf,.pdf" hidden data-attach="resources" data-pdf></label>
            <label class="btn btn--sm">upload another file<input type="file" hidden data-attach="resources"></label>
            <span class="file-link"><input data-fname placeholder="or add a link: its name"><input data-furl placeholder="https://…"><button type="button" class="btn btn--sm" data-fadd>add link</button></span>
          </div>
          <textarea name="resources" hidden>${esc(files.map((r) => `${r.label} | ${r.url}`).join('\n'))}</textarea>
          <small class="hint" data-pdf-status data-for="pdf">learners read the pdf on the lesson page itself, page by page — they can zoom, go full screen and download it. up to 50 MB.</small>
          <small class="hint" data-for="video article live quiz form">these appear under the lesson’s “resources” tab. up to 50 MB each.</small></div>

        <label class="field field--short"><span data-word="minutes">length in minutes</span><input name="duration_min" type="number" min="1" value="${l.duration_min || 5}"></label>

        <details class="more"><summary>more options</summary><div class="more-in">
          <div data-slot="more"></div>
          <label class="field" data-for="live"><span>recording of the class — paste a youtube link after it has happened (optional)</span><input data-recording placeholder="https://youtu.be/…" value="${esc(l.kind === 'live' ? (c.video_url || '') : '')}">
            <small class="hint">shown under the room once the class is over, so people who missed it can watch.</small></label>
          <label class="field" data-for="live"><span>a link to another meeting app, only if you want one (optional)${needs}</span><input name="live_url" value="${esc(c.live_url || '')}" placeholder="leave empty — the class runs inside the site">
            <small class="hint">the class already runs on this lesson page with video, sound, screen share and chat. a google meet or zoom link here is only shown as a second way in.</small></label>
          <label class="field"${modules.length > 1 ? '' : ' hidden'}><span>which section this lesson is in</span><select name="module_id">${modules.map((m) => `<option value="${m.id}"${m.id === moduleId ? ' selected' : ''}>${esc(m.title)}</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" name="is_preview"${l.is_preview ? ' checked' : ''}> let people open this lesson without an account, as a free sample <small>(only works when the ${noun} is free)</small></label>
          <label class="check"><input type="checkbox" name="is_hidden"${l.is_hidden ? ' checked' : ''}> hide this lesson for now — learners will not see it</label>
        </div></details>

        <label class="field" data-body><span data-word="body">lesson text</span><textarea name="body" rows="${ui === 'article' ? 12 : 4}">${esc(c.body || '')}</textarea>
          <small class="hint">leave an empty line to start a new paragraph. for a heading, start the line with ## · for a list, start each line with - · for bold, put **two stars** around the words.</small></label>
      </div></div>

      <div class="editor-foot"><button class="btn btn--solid" type="submit" data-save-lesson data-for="video article pdf live quiz form">${l.id ? 'save lesson' : 'add lesson'}</button><button class="btn" type="button" data-cancel>cancel</button></div>
    </form>`;
    };

    main.innerHTML = head(id ? esc(course.title) : 'new ' + noun, id ? `<span class="badge${course.status === 'published' ? ' badge--on' : ''}" style="margin:0;">${course.status === 'published' ? 'on the website' : 'draft — not on the website yet'}</span>` : 'three short steps: fill in the basics, press create, then add lessons.',
      `<button class="btn" data-back>← back to academy</button>${id ? `<a class="btn" href="${A.root}academy/${encodeURIComponent(id)}" target="_blank" rel="noopener">see it on the site ↗</a>` : ''}`)
      + setupNote()
      + `<form id="course-form" class="course-form">
        <section class="card">
          <h2 class="card-title">the basics</h2>
          <div class="field"><span>what is it?${needs}</span>${choice('kind', [['course', 'course', 'lessons people take at their own pace', '▤'], ['program', 'program', 'a longer guided track with a start date', '◈'], ['webinar', 'webinar', 'one live session on a date', '◉']], noun, 'choice--cards choice--3')}</div>
          <div class="field"><span>where do people take it?</span>${choice('where', [['here', 'on this website', 'you add the lessons, prices and live classes here', '⌂'], ['out', 'on another website', 'a partner’s or subsidiary’s — the card sends people there', '↗']], own.external ? 'out' : 'here', 'choice--2')}</div>
          <label class="field" data-when="where=out"><span>the link to it on the other website</span><input name="external" inputmode="url" autocomplete="off" value="${esc(own.external || '')}" placeholder="https://their-website.com/the-course">
            <small class="hint">open their course in your browser, copy the address from the top, and paste it here. the name, picture and price are read from their website for you.</small></label>
          <input type="hidden" name="filled" value="0">
          <div class="ext-read" id="ext-read" data-when="where=out" aria-live="polite">${own.external ? `<button class="btn btn--sm" type="button" data-read-link>read it again from their website</button><small class="hint">use this when they change the name, picture or price on their side.</small>` : ''}</div>
          <label class="field" data-when="where=out&filled=0"><span>whose is it? — shown on its card (optional)</span><input name="external_by" autocomplete="off" maxlength="60" value="${esc(own.external_by || '')}" placeholder="e.g. simplespeek"></label>
          <label class="field" data-when="where=here|filled=0"><span>its name</span><input name="title" required value="${esc(course.title)}" placeholder="e.g. canva for beginners"></label>
          <label class="field" data-when="where=here|filled=0"><span>one sentence about it — shown on its card</span><input name="tagline" value="${esc(course.tagline || '')}" placeholder="e.g. design posts, posters and slides from zero"></label>
          <label class="field" data-when="kind=program,webinar"><span>when does it start?${needs}</span><input name="starts_at" type="datetime-local" value="${toLocalInput(course.starts_at)}">
            <small class="hint">use your own clock — each visitor sees it in their own time. leave it empty if there is no date yet.</small></label>
          <div class="field" data-when="where=here|filled=0"><span>the picture on its card (a wide picture works best)</span>${imageField('cover', course.cover)}</div>
        </section>

        <section class="card" data-when="where=here|filled=0">
          <h2 class="card-title">the price</h2>
          <div class="field" data-when="where=here"><span>is it free or paid?</span>${choice('pay_paid', [['1', 'paid', 'learners pay by bkash and you confirm it', '৳'], ['0', 'free', 'anyone with an account can enrol', '✓']], own.paid === false && !own.external ? '0' : '1', 'choice--2')}</div>
          <p class="lede" data-when="where=out" style="margin:14px 0 0;">people pay on the other website, not here. if you type a price it is only shown on the card, so visitors know what to expect. leave both boxes empty to show no price.</p>
          <div class="form-grid" data-when="pay_paid=1|where=out">
            <label class="field"><span data-when="where=here">the price learners pay</span><span data-when="where=out">the price on their website (optional)</span><input name="pay_price" inputmode="decimal" value="${esc(own.price || '')}" placeholder="${esc(pay.settings.price || '500')}">
              <small class="hint">type the number only — “${esc(pay.settings.currency || '৳')}” is added for you.${pay.settings.price ? ` empty means ${esc(pay.settings.currency || '৳')}${esc(pay.settings.price)}.` : ''}</small></label>
            <label class="field"><span>the old price, to show a discount (optional)</span><input name="pay_was" inputmode="decimal" value="${esc(own.was || '')}" placeholder="e.g. 800">
              <small class="hint">shown crossed out beside the price, with “% off”. it must be higher than the price. leave it empty for no discount.</small></label>
          </div>
        </section>

        <section class="card">
          <h2 class="card-title">is it on the website?</h2>
          <div class="field">${choice('status', [['draft', 'not yet — draft', 'only you can see it, here', '○'], ['published', 'yes — published', 'visitors can see it on the academy page', '●']], course.status === 'published' ? 'published' : 'draft', 'choice--2')}</div>
        </section>

        <details class="group"${id ? '' : ''}><summary>what people read on its page<small>description, what they will learn, who it is for</small></summary><div class="group-body">
          <label class="field field--wide"><span>description</span><textarea name="description" rows="4" placeholder="a few sentences about what this is and why someone should take it">${esc(course.description || '')}</textarea></label>
          <label class="field field--wide"><span>what learners will be able to do — one per line</span><textarea name="outcomes" rows="4">${esc((course.outcomes || []).join('\n'))}</textarea></label>
          <label class="field field--wide"><span>skills they gain — one per line</span><textarea name="tags" rows="3">${esc((course.tags || []).join('\n'))}</textarea></label>
          <label class="field"><span>what they need before starting — one per line</span><textarea name="requirements" rows="4">${esc((course.requirements || []).join('\n'))}</textarea></label>
          <label class="field"><span>who it is for — one per line</span><textarea name="audience" rows="4">${esc((course.audience || []).join('\n'))}</textarea></label>
          <label class="field"><span>subject (used by the filter on the academy page)</span><input name="category" required value="${esc(course.category)}"></label>
          <label class="field"><span>level</span><select name="level">${opt(course.level, ['beginner', 'intermediate', 'advanced', 'all levels'])}</select></label>
          <label class="field"><span>how long it takes, in your words — e.g. 6 weeks</span><input name="duration" value="${esc(course.duration || '')}"></label>
          <label class="field"><span>language</span><input name="language" value="${esc(course.language || 'english')}"></label>
          <label class="field field--wide"><span>a short introduction video — youtube link (optional)</span><input name="trailer_url" value="${esc(course.trailer_url || '')}" placeholder="https://youtu.be/…"></label>
          <div class="field field--wide"><div class="field-top"><span>the “this ${noun} includes” box — one per line, as: name | value</span><button type="button" class="linkish" data-fill-includes>fill it in for me</button></div>
            <textarea name="includes" rows="5" placeholder="video lessons | 12&#10;certificate | yes">${esc((course.includes || []).map((r) => `${r.label} | ${r.value}`).join('\n'))}</textarea>
            <small class="hint">you can leave this empty: the box then counts the lessons by itself.</small></div>
        </div></details>

        <section class="card" id="teacher-group">
          <h2 class="card-title">who teaches it</h2>
          <div class="field" id="teacher-pick"></div>
          <div id="teacher-fields" hidden>
            <div class="form-grid">
              <label class="field"><span>teacher’s name</span><input name="instructor_name" value="${esc(course.instructor_name || '')}" autocomplete="off"></label>
              <label class="field"><span>their role or organisation</span><input name="instructor_role" value="${esc(course.instructor_role || '')}" autocomplete="off"></label>
              <div class="field field--wide"><span>their photo (optional)</span>${imageField('instructor_img', course.instructor_img)}</div>
            </div>
            <p class="teacher-ask" id="teacher-ask" hidden></p>
            <label class="check" id="teacher-keep" hidden><input type="checkbox" name="remember_teacher" checked> <span></span></label>
          </div>
        </section>

        <details class="group"><summary>more options<small>featured card, lesson order, who can read</small></summary><div class="group-body">
          <label class="check field--wide"><input type="checkbox" name="featured"${course.featured ? ' checked' : ''}> ★ feature it — give it the large card at the top of the academy page</label>
          <label class="check field--wide"><input type="checkbox" name="sequential"${course.sequential ? ' checked' : ''}> lessons must be done in order — the next one opens when the one before is finished</label>
          <label class="field"><span>who can read the lessons of a free ${noun}</span><select name="access"><option value="account"${course.access === 'account' ? ' selected' : ''}>people who made a free account</option><option value="open"${course.access === 'open' ? ' selected' : ''}>everyone, no account needed</option></select></label>
          <label class="field"><span>its place in the list — a smaller number comes first</span><input name="sort_order" type="number" value="${course.sort_order || 0}"></label>
        </div></details>

        <div class="editor-foot editor-foot--stick"><button class="btn btn--solid btn--lg" type="submit">${id ? 'save' : 'create this ' + noun}</button>${id ? `<button class="btn btn--danger" type="button" data-delete-course>delete this ${noun}</button>` : '<span class="foot-note">you can fill in the rest and add lessons after it is created.</span>'}</div></form>`
      + (id && own.external ? `<div class="h2"><span>lessons</span></div><p class="empty">this ${noun} is on another website, so there are no lessons to add here. people press its card and go to <b style="color:var(--fg);text-transform:none;">${esc(own.external)}</b>.${lessons.length ? ` the ${lessons.length} lesson${lessons.length === 1 ? '' : 's'} it had here are kept, and come back if you switch it to “on this website”.` : ''}</p>` : '')
      + (id && !own.external ? `<div class="h2"><span>lessons <small>${lessons.length} in ${modules.length} section${modules.length === 1 ? '' : 's'}</small></span><button class="btn btn--sm btn--solid" data-add-module>+ add a section</button></div>
        <p class="lede">lessons are grouped into sections, like chapters in a book. add a section first, then put lessons inside it.</p>
        <div id="module-new"></div>
        ${modules.map((m, mi) => {
          const ls = lessons.filter((l) => l.module_id === m.id);
          return `<div class="module-box" data-module="${m.id}">
            <header><div><strong><small>section ${mi + 1}</small>${esc(m.title)}${m.is_hidden ? '<span class="badge">hidden</span>' : ''}</strong>${m.summary ? `<span class="sub" style="display:block;margin-top:4px;font-size:13px;color:var(--muted);">${esc(m.summary)}</span>` : ''}</div>
              <div class="row-actions"><button class="btn btn--sm" data-medit>rename</button><button class="btn btn--sm" data-mmove="-1"${mi === 0 ? ' disabled' : ''} title="move this section up" aria-label="move this section up">↑</button><button class="btn btn--sm" data-mmove="1"${mi === modules.length - 1 ? ' disabled' : ''} title="move this section down" aria-label="move this section down">↓</button><button class="btn btn--sm" data-mhide>${m.is_hidden ? 'show' : 'hide'}</button><button class="btn btn--sm btn--danger" data-mdel>delete</button></div></header>
            <div class="rows">${ls.map((l, li) => (l.id === openLesson ? lessonForm(l, m.id) : `<div class="row row--lesson" data-lesson="${l.id}">
              <i class="kind kind--${esc(l.kind)}" aria-hidden="true">${{ video: '▶', article: '▤', quiz: '☑', form: '✎', live: '◉' }[l.kind] || '•'}</i>
              <div><strong>${esc(l.title)}${l.is_preview ? '<span class="badge badge--on">free sample</span>' : ''}${l.is_hidden ? '<span class="badge">hidden</span>' : ''}</strong><span class="sub">${{ video: 'video', article: 'reading', quiz: 'quiz', form: 'test', live: 'live class' }[l.kind] || esc(l.kind)} · ${l.kind === 'live' ? (l.live_at ? whenText(l.live_at) + ' · ' : 'no date yet · ') : ''}${l.duration_min} min</span></div>
              <div class="row-actions"><button class="btn btn--sm btn--solid" data-ledit>edit</button><button class="btn btn--sm" data-lmove="-1"${li === 0 ? ' disabled' : ''} title="move up" aria-label="move this lesson up">↑</button><button class="btn btn--sm" data-lmove="1"${li === ls.length - 1 ? ' disabled' : ''} title="move down" aria-label="move this lesson down">↓</button><button class="btn btn--sm" data-lhide>${l.is_hidden ? 'show' : 'hide'}</button><button class="btn btn--sm btn--danger" data-ldel>delete</button></div>
            </div>`)).join('') || '<p class="empty" style="border:0;padding:20px 0;">no lessons in this section yet — press “add a lesson”.</p>'}
            ${openLesson === 'new:' + m.id ? lessonForm({}, m.id) : ''}</div>
            <footer><button class="btn btn--solid" data-add-lesson>+ add a lesson</button></footer>
          </div>`;
        }).join('') || '<p class="empty">no sections yet. press “add a section” above, give it a name (for example “week 1”), then add lessons to it.</p>'}
        <div id="course-extras"><p class="empty">loading announcements, reviews and questions…</p></div>` : '');

    const reload = (lesson) => courseEditor(id, lesson);
    // moves one item, then renumbers 1..n writing only the rows that changed
    function moved(list, from, delta) {
      const order = list.slice(); const [item] = order.splice(from, 1); order.splice(from + delta, 0, item);
      return order;
    }
    async function writeOrder(table, order, base = 0) {
      const results = await Promise.all(order.map((r, i) => (r.sort_order === base + i + 1 ? null : sb.from(table).update({ sort_order: base + i + 1 }).eq('id', r.id))).filter(Boolean));
      const failed = results.find((x) => x.error); if (failed) toast(failed.error.message, true);
    }
    // lessons are numbered across the whole course, module by module
    async function renumberLessons(mods, byModule) {
      const flat = mods.flatMap((m) => byModule(m.id));
      await writeOrder('course_lessons', flat);
    }

    $('[data-back]', main).addEventListener('click', () => go('courses'));
    syncShown($('#course-form', main));

    // ── on another website: paste the link, and its card is read from their website ──
    {
      const form = $('#course-form', main), box = $('#ext-read', main), link = form.elements.external, unit = String(pay.settings.currency || '৳').trim();
      const isLink = (x) => /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(x);
      const put = (name, value) => { const el = form.elements[name]; el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
      const byHand = (note) => {
        form.elements.filled.value = '0'; syncShown(form);
        box.innerHTML = `${note ? `<p class="ext-note">${esc(note)}</p>` : ''}<button class="btn btn--sm" type="button" data-read-link>read it from their website</button>`;
      };
      let last = own.external || '', turn = 0;
      const read = async () => {
        const url = link.value.trim();
        if (!isLink(url)) return;
        last = url; const mine = ++turn;
        box.innerHTML = `<p class="ext-note ext-note--busy">reading their website…</p>`;
        let found = null;
        try { const { data } = await sb.functions.invoke('read-link', { body: { url } }); found = data; } catch (e) {}
        if (mine !== turn) return;
        if (!found || found.error || !found.title) return byHand('we could not read that page by ourselves — fill in the boxes below instead.');
        const about = String(found.about || ''), short = about.length > 150 ? about.slice(0, 150).replace(/\s+\S*$/, '') + '…' : about;
        put('title', found.title); put('tagline', short); put('cover', found.image || '');
        put('pay_price', found.free ? '' : found.price || ''); put('pay_was', found.free ? '' : found.was || '');
        if (found.by) put('external_by', found.by);
        if (about) put('description', about);
        if (found.duration) put('duration', found.duration);
        form.elements.filled.value = '1'; syncShown(form);
        const price = found.free ? 'free' : found.price ? `${esc(unit)}${esc(found.price)}${found.was ? ` <s>${esc(unit)}${esc(found.was)}</s>` : ''}` : '';
        box.innerHTML = `<p class="ext-note ext-note--ok">✓ read from their website — this is the card people will see</p>
          <div class="ext-card"><div class="ext-pic">${found.image ? `<img src="${esc(found.image)}" alt="">` : 'no picture'}</div>
            <div class="ext-body"><b>${esc(found.title)}</b>${short ? `<span>${esc(short)}</span>` : ''}<small>${[price, found.duration && esc(found.duration), found.by && 'by ' + esc(found.by)].filter(Boolean).join(' · ')}</small></div></div>
          <div class="ext-acts"><button class="btn btn--sm" type="button" data-by-hand>change something by hand</button><button class="btn btn--sm" type="button" data-read-link>read it again</button></div>`;
      };
      box.addEventListener('click', (e) => {
        if (e.target.closest('[data-read-link]')) { if (isLink(link.value.trim())) read(); else toast('paste the link first — it starts with https://', true); }
        if (e.target.closest('[data-by-hand]')) byHand('');
      });
      // a pasted or changed link is read straight away
      const changed = () => { const url = link.value.trim(); if (form.elements.where.value === 'out' && isLink(url) && url !== last) read(); };
      link.addEventListener('change', changed);
      link.addEventListener('paste', () => setTimeout(changed, 50));
    }

    // ── saved teachers: press one and the three boxes are filled in ──
    const cf = $('#course-form', main);
    let teachers = pay.teachers.slice();
    const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    const savedAs = (name) => teachers.find((t) => same(t.name, name));
    // the section always asks the same question: one of the saved teachers, or a new one?
    // the three boxes appear once that is answered (or straight away when a teacher is already set)
    let typingNew = false;
    function drawTeachers() {
      const name = cf.instructor_name.value, known = savedAs(name);
      $('#teacher-fields', main).hidden = !name.trim() && !typingNew;
      $('#teacher-pick', main).innerHTML = `<span>${teachers.length ? 'choose a saved teacher, or add a new one' : 'add the teacher'}</span>
        <div class="teachers">${teachers.map((t, i) => `<div class="teacher${same(t.name, name) ? ' is-on' : ''}">
            <button type="button" class="teacher-use" data-teacher="${i}"><span class="thumb">${t.img ? `<img src="${esc(img(t.img))}" alt="" data-fallback="${esc(t.name.trim()[0] || '?')}">` : esc(t.name.trim()[0] || '?')}</span><b>${esc(t.name)}</b><small>${esc(t.role || 'no role saved')}</small></button></div>`).join('')}
          <div class="teacher teacher--new${(name.trim() && !known) || (typingNew && !name.trim()) ? ' is-on' : ''}"><button type="button" class="teacher-use" data-teacher="new"><span class="thumb">+</span><b>a new teacher</b><small>type their name, role and photo</small></button></div></div>
        ${teachers.length ? '' : '<small class="hint">no teachers are saved yet. add one here and tick “remember” — or save them all at once on the academy screen, under “teachers”. next time they are one press away.</small>'}`;
      // someone new is being typed in: offer to remember them
      const keep = $('#teacher-keep', main), changed = known && (!same(known.role, cf.instructor_role.value) || (known.img || '') !== cf.instructor_img.value.trim());
      keep.hidden = !name.trim() || (known && !changed);
      $('span', keep).textContent = known ? `update what is saved for ${known.name}, so the new role and photo are used next time` : `remember ${name.trim() || 'this teacher'} — next time you only press their name`;
    }
    function useTeacher(t) {
      cf.instructor_name.value = t.name; cf.instructor_role.value = t.role || ''; cf.instructor_img.value = t.img || '';
      cf.instructor_img.dispatchEvent(new Event('input', { bubbles: true }));   // redraws the small picture
      $('#teacher-ask', main).hidden = true; typingNew = false;
      drawTeachers();
      toast(`${t.name} filled in — press save at the bottom to keep it`);
    }
    drawTeachers();
    $('#teacher-group', main).addEventListener('input', (e) => {
      if (!e.target.matches('[name=instructor_name], [name=instructor_role], [name=instructor_img]')) return;
      drawTeachers();
      // typing the start of a saved name: ask whether to fill in the rest
      const ask = $('#teacher-ask', main), typed = cf.instructor_name.value.trim().toLowerCase();
      const guess = e.target.name === 'instructor_name' && typed.length >= 2 ? teachers.find((t) => t.name.toLowerCase().startsWith(typed) && (!same(t.role, cf.instructor_role.value) || (t.img || '') !== cf.instructor_img.value.trim() || !same(t.name, typed))) : null;
      ask.hidden = !guess;
      if (guess) ask.innerHTML = `<b>${esc(guess.name)}</b> is saved${guess.role ? ` as “${esc(guess.role)}”` : ''}. fill in their details? <button type="button" class="btn btn--sm btn--solid" data-teacher="${teachers.indexOf(guess)}">yes, fill them in</button><button type="button" class="btn btn--sm" data-ask-no>no</button>`;
    });
    $('#teacher-group', main).addEventListener('click', async (e) => {
      if (e.target.closest('[data-ask-no]')) { $('#teacher-ask', main).hidden = true; return; }
      const use = e.target.closest('[data-teacher]');
      if (use) {
        if (use.dataset.teacher !== 'new') return useTeacher(teachers[+use.dataset.teacher]);
        cf.instructor_name.value = ''; cf.instructor_role.value = ''; cf.instructor_img.value = '';
        typingNew = true;
        cf.instructor_img.dispatchEvent(new Event('input', { bubbles: true }));
        drawTeachers(); cf.instructor_name.focus();
        return;
      }
      const forget = e.target.closest('[data-forget]');
      if (forget) {
        const t = teachers[+forget.dataset.forget];
        if (!confirm(`take ${t.name} off the saved list?\n\ncourses that already show ${t.name} keep them — this only removes the shortcut.`)) return;
        const fresh = (await payLoad()).teachers.filter((x) => !same(x.name, t.name));
        if (await paySave('pay.teachers', fresh, `${t.name} is no longer on the saved list`)) { teachers = fresh; drawTeachers(); }
      }
    });
    // fills the "includes" box with what the page would show on its own, ready to edit
    $('[data-fill-includes]', main).addEventListener('click', () => {
      const shown = lessons.filter((l) => !l.is_hidden && !(modules.find((m) => m.id === l.module_id) || {}).is_hidden);
      const n = (k) => shown.filter((l) => l.kind === k).length;
      const access = $('#course-form [name=access]', main).value === 'open' ? 'open to everyone' : 'free account';
      $('#course-form [name=includes]', main).value = [
        n('video') && `video lessons | ${n('video')}`, n('article') && `readings | ${n('article')}`, n('quiz') && `quizzes | ${n('quiz')}`, n('form') && `tests & assignments | ${n('form')}`, n('live') && `live classes | ${n('live')}`,
        'notes & q&a | on every lesson', n('live') ? 'pace | live, on set dates' : 'pace | your own', `access | ${access}`, 'certificate | verifiable',
      ].filter(Boolean).join('\n');
    });
    $('#course-form', main).addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target));
      const lines = (text) => text.split('\n').map((x) => x.trim()).filter(Boolean);
      const row = {
        title: v.title.trim(), tagline: v.tagline || null, description: v.description || null, category: v.category.trim().toLowerCase(), level: v.level,
        duration: v.duration || null, sort_order: +v.sort_order || 0, access: v.access, status: v.status, featured: !!v.featured,
        outcomes: lines(v.outcomes), tags: lines(v.tags), requirements: lines(v.requirements), audience: lines(v.audience),
        includes: lines(v.includes).map((line) => line.split('|').map((x) => x.trim())).filter((x) => x[0]).map(([label, ...rest]) => ({ label, value: rest.join('|') })),
        trailer_url: v.trailer_url.trim() || null, language: v.language.trim().toLowerCase() || 'english', sequential: !!v.sequential, updated_at: new Date().toISOString(),
        instructor_name: v.instructor_name || null, instructor_role: v.instructor_role || null, instructor_img: v.instructor_img || null, cover: v.cover || null,
      };
      if (academyReady) { row.kind = TYPES[v.kind] ? v.kind : 'course'; row.starts_at = fromLocalInput(v.starts_at); }
      else if (v.kind !== 'course' || v.starts_at) toast('saved as a course without a date — run seed/website-backend-05-academy.sql in supabase to switch programs, webinars and dates on', true);
      const num = (x) => parseFloat(String(x).replace(/[^0-9.]/g, ''));
      const nowPrice = v.pay_price.trim(), wasPrice = v.pay_was.trim();
      if (wasPrice && !(num(wasPrice) > num(nowPrice || (v.where === 'out' ? '' : pay.settings.price)))) return toast('the previous price has to be higher than the price learners pay now — or leave it empty', true);
      // on another website: the link has to be a real address, and nothing is paid for here
      const away = v.where === 'out', link = (v.external || '').trim();
      if (away && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(link)) return toast('paste the full link to it on the other website — it starts with https://', true);
      if (away && wasPrice && !nowPrice) return toast('to show an old price, type the price it costs now as well', true);
      if (away && id && lessons.length && own.external === undefined && !confirm(`this ${noun} has ${lessons.length} lesson${lessons.length === 1 ? '' : 's'} here. once it points to another website, learners can no longer open them (they are kept, and come back if you switch it to “on this website” again). continue?`)) return;
      const fee = away ? { paid: false, price: nowPrice, was: wasPrice, external: link, external_by: (v.external_by || '').trim() } : { paid: v.pay_paid !== '0', price: nowPrice, was: wasPrice };
      // remember the teacher for next time (a new one is added; a known one gets the new role and photo)
      if (row.instructor_name && v.remember_teacher && !$('#teacher-keep', main).hidden) {
        const list = (await payLoad()).teachers.filter((t) => !same(t.name, row.instructor_name));
        list.push({ name: row.instructor_name.trim(), role: (row.instructor_role || '').trim(), img: (row.instructor_img || '').trim() });
        list.sort((a, b) => a.name.localeCompare(b.name));
        await paySave('pay.teachers', list);
      }
      if (id) { if ((await run(sb.from('courses').update(row).eq('id', id))) && (await paySave('pay.course.' + id, fee, 'saved'))) reload(); return; }
      let newId = slug(row.title);
      if (!newId) return toast('give the course a title first', true);
      if (['course', 'learn', 'pay', 'my', 'my-learning', 'certificate', 'index', 'sample'].includes(newId)) newId += '-' + noun;
      const { data: clash } = await sb.from('courses').select('id').eq('id', newId).maybeSingle();
      if (clash) return toast('there is already a course with that title — choose a different one', true);
      if ((await run(sb.from('courses').insert({ ...row, id: newId }))) && (await paySave('pay.course.' + newId, fee, 'created — now add a module'))) go('courses', newId);
    });
    if (!id) return;
    // an entry on another website has no lessons, reviews or questions here — but it can still be deleted
    if (!own.external) courseExtras($('#course-extras', main), id, lessons);

    main.onsubmit = async (e) => {
      const f = e.target; if (!f.matches('[data-mform]')) return;
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f)), title = v.title.trim(); if (!title) return;
      const ok = f.dataset.mform === 'new'
        ? await run(sb.from('course_modules').insert({ course_id: id, title, sort_order: modules.length + 1 }), 'section added — now add a lesson to it')
        : await run(sb.from('course_modules').update({ title, summary: (v.summary || '').trim() || null }).eq('id', f.dataset.mform), 'section saved');
      if (ok) reload();
    };
    main.onclick = async (e) => {
      const t = e.target;
      if (t.closest('[data-cancel]')) return reload();
      if (t.closest('[data-delete-course]')) {
        if (!confirm(own.external
          ? `remove “${course.title}” from your academy? it stays on the other website — only its card here is deleted.`
          : `delete “${course.title}” with all its lessons and every learner's progress in it? this cannot be undone.`)) return;
        if (await run(sb.from('courses').delete().eq('id', id), noun + ' deleted')) {
          // its price and link go with it, so a new entry with the same name starts clean
          await sb.from('site_text').delete().eq('key', 'pay.course.' + id);
          go('courses');
        }
        return;
      }
      if (t.closest('[data-add-module]')) {
        const slot = $('#module-new', main);
        slot.innerHTML = `<form class="editor mini" data-mform="new"><label class="field"><span>name of the new section</span><input name="title" required placeholder="e.g. week 1 — getting started"></label>
          <div class="editor-foot"><button class="btn btn--solid" type="submit">add section</button><button class="btn" type="button" data-mcancel>cancel</button></div></form>`;
        $('input', slot).focus();
        return;
      }
      if (t.closest('[data-mcancel]')) return reload();
      const box = t.closest('.module-box'); if (!box) return;
      const m = modules.find((x) => x.id === box.dataset.module), mi = modules.indexOf(m);
      const inModule = (mid) => lessons.filter((l) => l.module_id === mid);
      if (t.closest('[data-add-lesson]')) return reload('new:' + m.id);
      if (t.closest('[data-mhide]')) {
        if (await run(sb.from('course_modules').update({ is_hidden: !m.is_hidden }).eq('id', m.id), m.is_hidden ? 'section shown' : 'section hidden — its lessons are hidden with it')) reload();
        return;
      }
      if (t.closest('[data-medit]')) {
        $('header', box).outerHTML = `<form class="editor mini" data-mform="${m.id}"><div class="form-grid"><label class="field"><span>name of the section</span><input name="title" required value="${esc(m.title)}"></label>
          <label class="field"><span>one line about it (optional)</span><input name="summary" value="${esc(m.summary || '')}"></label></div>
          <div class="editor-foot"><button class="btn btn--solid" type="submit">save</button><button class="btn" type="button" data-mcancel>cancel</button></div></form>`;
        $('form.mini input', box).focus();
        return;
      }
      if (t.closest('[data-mdel]')) {
        if (!confirm(`delete the section “${m.title}” and the ${inModule(m.id).length} lessons inside it? this cannot be undone.`)) return;
        if (await run(sb.from('course_modules').delete().eq('id', m.id), 'section deleted')) reload();
        return;
      }
      const mmove = t.closest('[data-mmove]');
      if (mmove) {
        const order = moved(modules, mi, +mmove.dataset.mmove);
        await writeOrder('course_modules', order);
        await renumberLessons(order, inModule);
        return reload();
      }
      const row = t.closest('[data-lesson]'); if (!row || row.tagName === 'FORM') return;
      const l = lessons.find((x) => x.id === row.dataset.lesson);
      if (t.closest('[data-ledit]')) return reload(l.id);
      if (t.closest('[data-lhide]')) {
        if (await run(sb.from('course_lessons').update({ is_hidden: !l.is_hidden }).eq('id', l.id), l.is_hidden ? 'lesson shown' : 'lesson hidden')) reload();
        return;
      }
      if (t.closest('[data-ldel]')) {
        if (!confirm(`delete the lesson “${l.title}”?`)) return;
        if (await run(sb.from('course_lessons').delete().eq('id', l.id), 'lesson deleted')) reload();
        return;
      }
      const lmove = t.closest('[data-lmove]');
      if (lmove) {
        const own = inModule(m.id);
        const order = moved(own, own.indexOf(l), +lmove.dataset.lmove);
        await renumberLessons(modules, (mid) => (mid === m.id ? order : inModule(mid)));
        return reload();
      }
    };

    const lf = $('form[data-lesson]', main);
    if (lf) {
      $('[data-quiz]', lf)._qs = ((content && content.quiz) || []).map((q) => ({ q: q.q || '', options: (q.options || []).slice(), answer: q.answer || 0, why: q.why || '' }));
      if (!$('[data-quiz]', lf)._qs.length) $('[data-quiz]', lf)._qs.push({ q: '', options: ['', ''], answer: 0 });
      drawQuiz(lf); drawFiles(lf); syncLesson(lf);
      lf.scrollIntoView({ block: lf.dataset.lesson ? 'center' : 'start' });
      lf.addEventListener('submit', async (e) => {
        e.preventDefault();
        const ui = lf.dataset.ui;
        if (!ui) return toast('first choose what kind of lesson this is', true);
        // a live class keeps its recording in the video box
        const rec = $('[data-recording]', lf);
        if (ui === 'live' && rec && rec.value.trim() !== (lf.video_url.defaultValue || '').trim() && lf.video_url.value.trim() === (lf.video_url.defaultValue || '').trim()) lf.video_url.value = rec.value.trim();
        // saving straight after pasting a link: wait for the video's title to arrive first
        if (ui === 'video') await titleFromVideo(lf.querySelector('[name=video_url]'));
        const v = Object.fromEntries(new FormData(lf));
        const resources = fileLines(v.resources);
        const quiz = readQuiz(lf);
        if (ui === 'video' && !v.video_url.trim()) return toast('paste the youtube link of the video — or upload a video file', true);
        if (!v.title.trim()) return toast(ui === 'video' ? 'give the lesson a title — or wait a moment for it to be filled in from the video' : 'give it a title', true);
        if (ui === 'article' && !v.body.trim()) return toast('write the lesson in the big box — or choose “pdf” if you want to upload a document instead', true);
        if (ui === 'pdf' && !resources.some((r) => /\.pdf($|[?#])/i.test(r.url))) return toast('upload the pdf first — press “upload a pdf”', true);
        if (ui === 'form' && !v.form_url.trim()) return toast('paste the google form link for this test', true);
        if (ui === 'quiz' && !quiz.length) return toast('a quiz needs at least one question with two answers', true);
        if (ui === 'live' && !academyReady) toast('the live class is saved, but its date and link need seed/website-backend-05-academy.sql to be run in supabase first', true);
        // what belongs to another kind of lesson is not carried along when the kind changes
        const changed = (lf.dataset.was || '') !== v.kind || !lf.dataset.lesson;
        const keep = (name, kinds) => (!changed || kinds.includes(ui) ? (v[name] || '').trim() || null : null);
        const video_url = ui === 'pdf' || ui === 'article' ? (changed ? null : (v.video_url || '').trim() || null) : keep('video_url', ['video', 'live']);
        const row = { course_id: id, module_id: v.module_id || lf.dataset.module, title: v.title.trim(), kind: v.kind, duration_min: Math.max(1, +v.duration_min || 5), is_preview: !!v.is_preview, is_hidden: !!v.is_hidden };
        if (academyReady) row.live_at = v.kind === 'live' ? fromLocalInput(v.live_at) : null;
        let lessonId = lf.dataset.lesson;
        if (lessonId) { if (!(await run(sb.from('course_lessons').update(row).eq('id', lessonId)))) return; }
        else {
          const made = await run(sb.from('course_lessons').insert({ ...row, sort_order: lessons.length + 1 }).select('id').single());
          if (!made) return;
          lessonId = made.id;
        }
        const keptQuiz = ui === 'quiz' ? quiz : (!changed && content && content.quiz ? content.quiz : []);
        if (await run(sb.from('lesson_content').upsert({ lesson_id: lessonId, video_url, form_url: keep('form_url', ['form']), body: v.body || null, quiz: keptQuiz.length ? keptQuiz : null, resources, ...(academyReady ? { live_url: keep('live_url', ['live']) } : {}) }), LESSON_WORDS.save[ui] + ' saved')) {
          // keep numbering contiguous section by section, including the new lesson
          const fresh = await run(sb.from('course_lessons').select('*').eq('course_id', id).order('sort_order'));
          if (fresh && fresh !== true) { lessons = fresh; await renumberLessons(modules, (mid) => fresh.filter((x) => x.module_id === mid)); }
          reload();
        }
      });
    }
  }

  // Everything learners add to a course, plus announcements — below the curriculum.
  async function courseExtras(el, id, lessons) {
    const opt = async (q) => { const { data, error } = await q; return error ? null : (data || []); };
    const [news, reviews, posts, certs] = await Promise.all([
      opt(sb.from('course_announcements').select('*').eq('course_id', id).order('created_at', { ascending: false })),
      opt(sb.from('course_reviews').select('*').eq('course_id', id).order('created_at', { ascending: false })),
      opt(sb.from('lesson_comments').select('*').eq('course_id', id).order('created_at', { ascending: false }).limit(300)),
      opt(sb.from('certificates').select('*').eq('course_id', id).order('issued_at', { ascending: false })),
    ]);
    if (!news || !reviews || !posts || !certs) {
      el.innerHTML = '<p class="empty">announcements, reviews, questions and certificates switch on after <b>seed/website-backend-02-lms.sql</b> has been run in the supabase sql editor.</p>';
      return;
    }
    const when = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const lessonTitle = Object.fromEntries(lessons.map((l) => [l.id, l.title]));
    const questions = posts.filter((c) => !c.parent_id);
    const avg = reviews.length ? (reviews.reduce((t, r) => t + r.rating, 0) / reviews.length).toFixed(1) : '—';

    el.innerHTML = `
      <div class="h2"><span>announcements <small>${news.length}</small></span></div>
      <p class="lede">a message every learner of this one sees on their lesson pages.</p>
      <form class="editor" data-form="news" style="border-color:var(--line);">
        <div class="form-grid"><label class="field field--wide"><span>new announcement — title</span><input name="title" required></label>
        <label class="field field--wide"><span>message (optional)</span><textarea name="body" rows="3"></textarea></label></div>
        <div class="editor-foot"><button class="btn btn--solid" type="submit">post to learners</button></div>
      </form>
      <div class="rows">${news.map((n) => `<div class="row row--plain" data-kind="news" data-id="${n.id}"><div><strong>${esc(n.title)}</strong><span class="sub">${when(n.created_at)}${n.body ? ' · ' + esc(n.body.slice(0, 90)) : ''}</span></div><div class="row-actions"><button class="btn btn--sm btn--danger" data-x="del">delete</button></div></div>`).join('') || '<p class="empty">nothing posted yet.</p>'}</div>

      <div class="h2"><span>reviews <small>${reviews.length} · average ${avg}</small></span></div>
      <div class="rows">${reviews.map((r) => `<div class="row row--plain" data-kind="review" data-id="${r.user_id}"><div><strong>${'★'.repeat(r.rating)} ${esc(r.author_name)}${r.is_hidden ? '<span class="badge">hidden</span>' : ''}</strong><span class="sub" style="white-space:normal;">${when(r.created_at)}${r.body ? ' · ' + esc(r.body) : ''}</span></div>
        <div class="row-actions"><button class="btn btn--sm" data-x="hide">${r.is_hidden ? 'show' : 'hide'}</button><button class="btn btn--sm btn--danger" data-x="del">delete</button></div></div>`).join('') || '<p class="empty">no reviews yet.</p>'}</div>

      <div class="h2"><span>questions from learners <small>${questions.length}</small></span></div>
      <div class="rows">${questions.map((q) => {
        const replies = posts.filter((c) => c.parent_id === q.id).reverse();
        return `<div class="row row--plain" data-kind="post" data-id="${q.id}" data-lesson="${q.lesson_id}" style="align-items:start;"><div>
            <strong style="white-space:normal;">${esc(q.body)}</strong><span class="sub">${esc(q.author_name)} · ${when(q.created_at)} · ${esc(lessonTitle[q.lesson_id] || 'lesson')}${replies.some((r) => r.is_staff) ? '' : ' · <b style="color:var(--green);font-weight:400;">unanswered</b>'}</span>
            ${replies.map((r) => `<span class="sub" style="white-space:normal;margin-top:8px;padding-left:14px;border-left:1px solid var(--line);" data-reply="${r.id}">${r.is_staff ? '<b style="color:var(--green);font-weight:400;">instructor</b> · ' : ''}${esc(r.author_name)}: ${esc(r.body)} <button class="linkish" data-x="del-reply" data-rid="${r.id}">delete</button></span>`).join('')}
            <form data-form="reply" style="display:flex;gap:8px;margin-top:12px;"><input name="body" required placeholder="type your answer…" style="flex:1;min-width:0;padding:9px 12px;background:var(--bg);color:var(--fg);border:1px solid var(--line);font:400 14px/1.4 var(--font-sans);"><button class="btn btn--sm" type="submit">reply</button></form>
          </div><div class="row-actions"><button class="btn btn--sm btn--danger" data-x="del">delete</button></div></div>`;
      }).join('') || '<p class="empty">no questions yet.</p>'}</div>

      <div class="h2"><span>certificates given <small>${certs.length}</small></span></div>
      <div class="rows">${certs.map((c) => `<div class="row row--plain" data-kind="cert" data-id="${esc(c.id)}"><div><strong style="text-transform:none;">${esc(c.learner_name)}</strong><span class="sub" style="text-transform:none;">${esc(c.id)} · ${when(c.issued_at)}</span></div>
        <div class="row-actions"><a class="btn btn--sm" href="${A.root}academy/certificate/${encodeURIComponent(c.id)}" target="_blank" rel="noopener">view ↗</a><button class="btn btn--sm btn--danger" data-x="del">revoke</button></div></div>`).join('') || '<p class="empty">none yet.</p>'}</div>`;

    const again = () => courseExtras(el, id, lessons);
    el.onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target, v = Object.fromEntries(new FormData(form));
      if (form.dataset.form === 'news') {
        if (await run(sb.from('course_announcements').insert({ course_id: id, title: v.title.trim(), body: v.body.trim() || null }), 'announcement posted')) again();
      } else if (form.dataset.form === 'reply') {
        const row = form.closest('.row');
        if (await run(sb.from('lesson_comments').insert({ course_id: id, lesson_id: row.dataset.lesson, user_id: user.id, parent_id: row.dataset.id, author_name: 'amaze consortium', is_staff: true, body: v.body.trim() }), 'reply posted')) again();
      }
    };
    el.onclick = async (e) => {
      const b = e.target.closest('[data-x]'); if (!b) return;
      e.stopPropagation();
      const row = b.closest('.row'), kind = row.dataset.kind, key = row.dataset.id, act = b.dataset.x;
      if (act === 'del-reply') { if (confirm('delete this reply?') && await run(sb.from('lesson_comments').delete().eq('id', b.dataset.rid), 'reply deleted')) again(); return; }
      if (kind === 'review' && act === 'hide') {
        const r = reviews.find((x) => x.user_id === key);
        if (await run(sb.from('course_reviews').update({ is_hidden: !r.is_hidden }).eq('user_id', key).eq('course_id', id), r.is_hidden ? 'review shown' : 'review hidden')) again();
        return;
      }
      if (act !== 'del') return;
      const jobs = {
        news: ['delete this announcement?', () => sb.from('course_announcements').delete().eq('id', key), 'announcement deleted'],
        review: ['delete this review permanently? the learner will be able to post a new one.', () => sb.from('course_reviews').delete().eq('user_id', key).eq('course_id', id), 'review deleted'],
        post: ['delete this question and its replies?', () => sb.from('lesson_comments').delete().eq('id', key), 'question deleted'],
        cert: ['revoke this certificate? its link will stop working.', () => sb.from('certificates').delete().eq('id', key), 'certificate revoked'],
      }[kind];
      if (confirm(jobs[0]) && await run(jobs[1](), jobs[2])) again();
    };
  }

  // ── learners ───────────────────────────────────────────────────────────────
  // The number on the "learners" button: payments waiting to be checked.
  async function payBadge() {
    const btn = $('.admin-nav [data-view=learners]', app); if (!btn) return;
    let n = 0;
    try { const { data } = await sb.from('payments').select('id').eq('status', 'pending'); n = Array.isArray(data) ? data.length : 0; } catch (e) {}
    $('span', btn).innerHTML = n ? `learners & payments<b class="count" title="${n} payment${n === 1 ? '' : 's'} to check">${n} to check</b>` : 'learners & payments';
  }

  async function learnersView() {
    const [en, pr, courses, lessons, mods, pay, pm, profs] = await Promise.all([
      run(sb.from('enrollments').select('*').order('enrolled_at', { ascending: false })),
      run(sb.from('lesson_progress').select('user_id,course_id,lesson_id')),
      run(sb.from('courses').select('id,title')),
      run(sb.from('course_lessons').select('id,course_id,module_id,is_hidden')),
      run(sb.from('course_modules').select('id,is_hidden')),
      payLoad(),
      run(sb.from('payments').select('*').order('created_at', { ascending: false })),
      // names and phone numbers learners keep on their page; the screen works without them
      (async () => { try { const r = await sb.from('profiles').select('id,full_name,phone'); return r && !r.error && Array.isArray(r.data) ? r.data : []; } catch (e) { return []; } })(),
    ]);
    if (!en || !pr || !courses || !lessons || !mods) return;
    // the name and phone number a learner keeps on their own page
    const profile = Object.fromEntries(profs.map((x) => [x.id, x]));
    const phoneOf = (u) => (profile[u] && profile[u].phone ? ` · <a href="tel:${esc(profile[u].phone)}" style="color:var(--green)">${esc(profile[u].phone)}</a>` : '');
    const nameOf = (u, fallback) => (profile[u] && profile[u].full_name) || fallback;
    const list = (x) => (x === true || !x ? [] : x);
    const payments = list(pm);
    const title = Object.fromEntries(list(courses).map((c) => [c.id, c.title]));
    const hiddenModule = new Set(list(mods).filter((m) => m.is_hidden).map((m) => m.id));
    const visible = new Set(list(lessons).filter((l) => !l.is_hidden && !hiddenModule.has(l.module_id)).map((l) => l.id));
    const total = (id) => list(lessons).filter((l) => l.course_id === id && visible.has(l.id)).length;
    const done = (u, c) => list(pr).filter((p) => p.user_id === u && p.course_id === c && visible.has(p.lesson_id)).length;
    const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
    const at = (d) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
    const isPaid = (cid) => feeOf(pay, cid).paid;
    // newest payment for a learner in an entry (the list is newest first)
    const payOf = (u, c) => payments.find((p) => p.user_id === u && p.course_id === c);
    const waiting = payments.filter((p) => p.status === 'pending').reverse();   // oldest first: first come, first checked
    const decided = payments.filter((p) => p.status !== 'pending').slice(0, 40);
    const rows = list(en);
    const who = (p) => `<strong style="text-transform:none;">${esc(nameOf(p.user_id, p.learner_name) || '—')}</strong><span class="sub" style="text-transform:none;">${esc(p.learner_email || '')}${phoneOf(p.user_id)}</span>`;
    const what = (p) => `${esc(title[p.course_id] || p.course_id)}${p.amount ? ` · <b style="color:var(--fg)">${esc(p.amount)}</b>` : ''}${p.coupon ? ` · <b style="color:var(--green)">coupon ${esc(p.coupon)}</b>${p.list_amount ? ` (full fee ${esc(p.list_amount)})` : ''}` : ''}`;
    const paidOpts = list(courses).filter((c) => isPaid(c.id)).map((c) => `<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('');

    main.innerHTML = head('learners & payments', 'when a learner pays by bkash they send you two things: the number they paid from and the transaction id. find that payment in your bkash app, then press “confirm” here — their lessons open straight away.')
      + `<div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));"><div><b>${waiting.length}</b><span>payments to check</span></div><div><b>${new Set(rows.map((r) => r.user_id)).size}</b><span>learners</span></div><div><b>${rows.length}</b><span>enrolments</span></div><div><b>${rows.filter((r) => r.completed_at).length}</b><span>completed</span></div></div>`

      + `<div class="h2"><span>payments to check <small>${waiting.length}</small></span></div>
      <div class="rows">${waiting.map((p) => `<div class="row row--plain row--pay" data-pid="${p.id}" style="align-items:center;">
          <div>${who(p)}<span class="sub">${what(p)} · sent ${at(p.created_at)}</span></div>
          <div class="pay-check"><div><small>transaction id</small><code>${esc(p.trx_id)}</code><button class="linkish" data-copy="${esc(p.trx_id)}">copy</button></div><div><small>paid from</small><code>${esc(p.sender)}</code></div></div>
          <div class="row-actions"><button class="btn btn--sm btn--solid" data-review="confirmed">confirm</button><button class="btn btn--sm btn--danger" data-review="rejected">reject</button></div>
        </div>`).join('') || '<p class="empty">nothing waiting. when a learner submits a bkash transaction id, it appears here.</p>'}</div>
      <p class="lede" style="margin-top:14px;">confirm only when all three match what you see in bkash: the transaction id, the amount and the number it came from. if something does not match, press “reject” — the learner is told why and can try again.</p>`

      + `<details class="group" style="margin-top:28px;"><summary>let someone in without a bkash payment<small>cash, a scholarship, or a team member</small></summary>
      <form id="grant-form" style="padding:4px 20px 22px;"><div class="form-grid">
        <label class="field"><span>the learner's email (they must have signed in on the site once)</span><input name="email" type="email" required placeholder="name@gmail.com"></label>
        <label class="field"><span>to which course, program or webinar</span><select name="course" required>${paidOpts || '<option value="">no paid entries</option>'}</select></label>
      </div><div class="editor-foot"><button class="btn btn--solid" type="submit"${paidOpts ? '' : ' disabled'}>give access</button></div></form></details>`

      + (decided.length ? `<div class="h2"><span>already decided <small>the last ${decided.length}</small></span></div>
      <div class="rows">${decided.map((p) => `<div class="row row--plain row--pay" data-pid="${p.id}" style="align-items:center;">
          <div>${who(p)}<span class="sub">${what(p)}</span></div>
          <div class="pay-check"><div><small>${p.method === 'manual' ? 'given by hand' : 'transaction id'}</small><code>${p.method === 'manual' ? '—' : esc(p.trx_id)}</code></div>
            <div><small>${p.status} ${p.reviewed_at ? at(p.reviewed_at) : ''}</small><span style="font-size:12px;color:var(--muted);text-transform:none;">${esc(p.reviewed_by || '')}${p.note ? ' — “' + esc(p.note) + '”' : ''}</span></div></div>
          <div class="row-actions"><span class="badge${p.status === 'confirmed' ? ' badge--on' : ''}" style="margin:0 6px 0 0;">${p.status}</span>${p.status === 'confirmed' ? '<button class="btn btn--sm" data-review="rejected">take back</button>' : '<button class="btn btn--sm" data-review="confirmed">confirm after all</button>'}</div>
        </div>`).join('')}</div>` : '')

      + `<div class="h2"><span>everyone enrolled <small>${rows.length}</small></span></div>`
      + (rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>learner</th><th>enrolled in</th><th>since</th><th>payment</th><th>progress</th><th>finished</th><th></th></tr></thead><tbody>${rows.map((r) => {
        const t = total(r.course_id), d = Math.min(done(r.user_id, r.course_id), t), pct = t ? Math.round((d / t) * 100) : 0;
        const p = payOf(r.user_id, r.course_id);
        const state = !isPaid(r.course_id) ? '<span class="badge">free</span>' : !p ? '<span class="badge">no payment</span>' : `<span class="badge${p.status === 'confirmed' ? ' badge--on' : ''}">${p.status === 'confirmed' ? (p.method === 'manual' ? 'given by hand' : 'paid') : p.status === 'pending' ? 'to check' : 'rejected'}</span>`;
        return `<tr><td><strong>${esc(nameOf(r.user_id, r.learner_name) || '—')}</strong><br><span style="color:var(--muted)">${esc(r.learner_email || '')}${phoneOf(r.user_id)}</span></td><td>${esc(title[r.course_id] || r.course_id)}</td><td>${day(r.enrolled_at)}</td><td>${state}</td><td>${d} / ${t} · ${pct}%<div class="progress"><i style="width:${pct}%"></i></div></td><td>${day(r.completed_at)}</td><td><button class="btn btn--sm btn--danger" data-unenrol="${r.user_id}|${esc(r.course_id)}">remove</button></td></tr>`;
      }).join('')}</tbody></table></div>` : '<p class="empty">no one has enrolled yet.</p>');

    $('#grant-form', main).addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target));
      if (!confirm(`give ${v.email.trim()} full access to “${title[v.course] || v.course}” without a bkash payment?`)) return;
      if (await run(sb.rpc('grant_course_access', { p_email: v.email.trim(), p_course: v.course }), 'access given — their lessons are unlocked')) { payBadge(); learnersView(); }
    });
    main.onclick = async (e) => {
      const copy = e.target.closest('[data-copy]');
      if (copy) { try { await navigator.clipboard.writeText(copy.dataset.copy); toast('transaction id copied'); } catch (err) { prompt('copy this', copy.dataset.copy); } return; }
      const rv = e.target.closest('[data-review]');
      if (rv) {
        const p = payments.find((x) => x.id === rv.closest('[data-pid]').dataset.pid), to = rv.dataset.review;
        let note = null;
        if (to === 'rejected') {
          note = prompt(p.status === 'confirmed' ? 'this closes the lessons for this learner again. reason (they will see it):' : 'reason — the learner will see this, so they know what to fix:',
            p.status === 'confirmed' ? 'this payment could not be verified after all. please contact us.' : 'we could not find this transaction id in our bkash account. please check it and enter it again.');
          if (note === null) return;
        } else if (!confirm(`confirm ${p.amount || 'this payment'} from ${p.sender} (${p.trx_id}) for ${p.learner_name || p.learner_email}?\n\nonly confirm if you can see this transaction in bkash. their lessons unlock immediately.`)) return;
        rv.disabled = true;
        const { error } = await sb.rpc('review_payment', { p_payment: p.id, p_status: to, p_note: note });
        if (error) { rv.disabled = false; return toast(/payments_trx_once/.test(error.message) ? 'another payment is already using this transaction id, so this one cannot be confirmed as well.' : /payments_one_open/.test(error.message) ? 'this learner already has a newer payment for this entry — decide on that one instead.' : error.message, true); }
        toast(to === 'confirmed' ? 'confirmed — the lessons are unlocked for this learner' : 'rejected — the learner will see your reason');
        payBadge(); learnersView();
        return;
      }
      const b = e.target.closest('[data-unenrol]'); if (!b) return;
      const [uid, cid] = b.dataset.unenrol.split('|');
      if (!confirm('remove this learner from the entry\'s list? their lesson progress is kept. (this does not change a payment — use “take back” above for that.)')) return;
      if (await run(sb.from('enrollments').delete().eq('user_id', uid).eq('course_id', cid), 'removed from the list')) learnersView();
    };
  }

  // ── reports ────────────────────────────────────────────────────────────────
  // One screen that answers "how is the academy doing?": the headline numbers for a period
  // (each compared with the period before), money and enrolments over time, the path from a
  // visit to a confirmed payment, every course side by side, where learners stop inside a
  // course, coupons, and a log of everything that happened. All of it is worked out by the
  // database (academy_report); this only draws it.
  const PERIODS = [['7', 'last 7 days'], ['30', 'last 30 days'], ['month', 'this month'], ['90', 'last 90 days'], ['year', 'this year'], ['all', 'all time']];
  let reportPeriod = '30', reportCourse = '', logKind = '', logShown = 30, reportTab = 'academy';
  function periodRange(key) {
    const now = new Date(), start = new Date(now); start.setHours(0, 0, 0, 0);
    if (key === 'all') return [null, null];
    if (key === 'month') start.setDate(1);
    else if (key === 'year') start.setMonth(0, 1);
    else start.setDate(start.getDate() - (+key - 1));
    return [start.toISOString(), now.toISOString()];
  }
  const NUM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
  const num = (v) => NUM.format(+v || 0);
  // a round number at or above the largest value, so the scale ends on something readable
  function niceTop(max) {
    if (!(max > 0)) return 4;
    const p = Math.pow(10, Math.floor(Math.log10(max))), f = max / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 4 ? 4 : f <= 5 ? 5 : 10) * p;
  }
  // one measure over time, as thin columns. every column can be pointed at or tabbed to for its value,
  // and the same numbers are in a table underneath.
  function columnChart(points, o) {
    const top = niceTop(Math.max(...points.map((p) => p.value), 0)), any = points.some((p) => p.value > 0);
    const every = Math.max(1, Math.ceil(points.length / 7));
    return `<figure class="chart"><figcaption><strong>${o.title}</strong><span>${o.sub || ''}</span></figcaption>
      <div class="chart-plot${any ? '' : ' is-empty'}" style="--n:${points.length}">
        <div class="chart-y" aria-hidden="true"><span>${o.fmt(top)}</span><span>${o.fmt(top / 2)}</span><span>${o.fmt(0)}</span></div>
        <div class="chart-bars" role="img" aria-label="${esc(o.title)} — the numbers are in the table below">
          ${points.map((p, i) => `<div class="chart-col" tabindex="0"><i style="height:${top ? Math.max(p.value > 0 ? 1.5 : 0, (p.value / top) * 100) : 0}%"></i><b class="chart-tip"><strong>${o.fmt(p.value)}</strong><span>${esc(p.full)}</span></b>${i % every === 0 ? `<small>${esc(p.label)}</small>` : ''}</div>`).join('')}
        </div>
        ${any ? '' : `<p class="chart-none">${o.none || 'nothing in this period yet.'}</p>`}
      </div>
      <details class="chart-table"><summary>show the numbers</summary><div class="table-wrap"><table class="table"><thead><tr><th>${o.stepName}</th><th>${o.title}</th></tr></thead><tbody>${points.map((p) => `<tr><td>${esc(p.full)}</td><td>${o.fmt(p.value)}</td></tr>`).join('')}</tbody></table></div></details>
    </figure>`;
  }
  // a small line of the same measure, for a headline number
  function spark(values) {
    if (values.length < 2 || !values.some((v) => v > 0)) return '';
    const max = Math.max(...values), w = 96, h = 26, x = (i) => (i / (values.length - 1)) * (w - 4) + 2, y = (v) => h - 3 - (v / max) * (h - 6);
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/><circle cx="${x(values.length - 1).toFixed(1)}" cy="${y(values[values.length - 1]).toFixed(1)}" r="3"/></svg>`;
  }
  function downloadCsv(name, rows) {
    const cell = (v) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const blob = new Blob(['\ufeff' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }


  // ── reports: the website ───────────────────────────────────────────────────
  // Visitors, countries, popular pages and the buttons people press, on every page of the
  // website. js/track.js counts, the database adds up (site_report); this only draws it.
  const REPORT_TABS = [['academy', 'the academy', 'money, enrolments, learners'], ['site', 'the website', 'visitors, countries, pages, buttons']];
  const reportTabs = () => `<div class="rtabs" role="tablist">${REPORT_TABS.map(([k, t, s]) => `<button type="button" role="tab" class="rtab${k === reportTab ? ' is-active' : ''}" data-rtab="${k}" aria-selected="${k === reportTab}"><b>${t}</b><small>${s}</small></button>`).join('')}</div>`;
  const PAGE_NAMES = { '/': 'home page', '/academy': 'academy — all courses', '/academy/my-learning': 'my learning', '/academy/certificate': 'a certificate', '/apprenticeship': 'apprenticeship', '/structure': 'structure', '/tos': 'terms of service', '/privacy': 'privacy', '/code': 'code of conduct' };
  function pageName(p) {
    if (PAGE_NAMES[p]) return PAGE_NAMES[p];
    const m = /^\/academy\/([^/]+)(?:\/(learn|pay))?$/.exec(p);
    if (m) return `${m[1].replace(/-/g, ' ')} — ${m[2] === 'learn' ? 'lessons' : m[2] === 'pay' ? 'payment page' : 'course page'}`;
    return p.replace(/^\//, '').replace(/[-_]/g, ' ').replace(/\//g, ' › ') || p;
  }
  function countryName(code) {
    if (!/^[A-Z]{2}$/.test(code)) return ['', 'unknown'];
    let name = code; try { name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code; } catch (e) {}
    return [String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)), name.toLowerCase()];
  }
  async function siteReportView() {
    const [from, to] = periodRange(reportPeriod);
    const ymd = (iso) => { const d = new Date(iso), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
    const old = $('.reports', main); if (old) old.classList.add('is-loading');
    const rep = await sb.rpc('site_report', { p_from: from ? ymd(from) : null, p_to: to ? ymd(to) : null });
    const wire = (extra) => { main.onchange = null; main.onclick = (e) => {
      const t = e.target.closest('[data-period], [data-rtab], [data-csv]'); if (!t) return;
      if (t.dataset.rtab) { reportTab = t.dataset.rtab; return reportsView(); }
      if (t.dataset.period) { reportPeriod = t.dataset.period; return reportsView(); }
      if (t.dataset.csv && extra) extra();
    }; };
    if (rep.error || !rep.data || !rep.data.now) {
      const missing = /does not exist|schema cache|could not find|404/i.test((rep.error && rep.error.message) || '');
      main.innerHTML = head('reports', 'how the website is doing.') + `<div class="reports">${reportTabs()}<p class="empty">${missing ? 'one step left to switch website statistics on: open supabase → sql editor, paste the file <b>seed/website-backend-12-site-stats.sql</b> and press run (once). counting starts the moment it is done.' : esc(plain((rep.error && rep.error.message) || 'the report could not be loaded — try again.'))}</p></div>`;
      return wire();
    }
    const S = rep.data, now = S.now, was = S.before;
    const periodName = (PERIODS.find(([k]) => k === reportPeriod) || [])[1];
    const beforeName = { 7: 'the 7 days before', 30: 'the 30 days before', 90: 'the 90 days before', month: 'the same stretch before', year: 'the same stretch before' }[reportPeriod];
    const byMonth = S.step === 'month', stepName = byMonth ? 'month' : 'day';
    const label = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', byMonth ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' }).toLowerCase();
    const full = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', byMonth ? { month: 'long', year: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).toLowerCase();
    const pts = (key) => S.series.map((x) => ({ label: label(x.d), full: full(x.d), value: +x[key] || 0 }));
    const delta = (key) => {
      if (!was) return `<em class="delta">${S.since ? 'no earlier period to compare with' : ''}</em>`;
      const a = +now[key] || 0, b = +was[key] || 0;
      if (a === b) return `<em class="delta">the same as ${beforeName}</em>`;
      if (!b) return `<em class="delta is-up"><i aria-hidden="true">▲</i> up from none in ${beforeName}</em>`;
      const pct = Math.round(((a - b) / b) * 100), up = a > b;
      return `<em class="delta ${up ? 'is-up' : 'is-down'}"><i aria-hidden="true">${up ? '▲' : '▼'}</i> ${Math.abs(pct)}% ${up ? 'more' : 'less'} than ${beforeName}</em>`;
    };
    const tile = (label, value, key, hint) => `<div class="kpi"><span>${label}</span><strong>${value}</strong>${key ? delta(key) : ''}${key ? spark(S.series.map((x) => +x[key] || 0)) : ''}${hint ? `<small>${hint}</small>` : ''}</div>`;
    // a list from most to least: the name, a bar, the count and its share of the whole
    const rank = (rows, name, o = {}) => {
      const total = rows.reduce((a, r) => a + (+r.n || 0), 0), top = Math.max(...rows.map((r) => +r.n || 0), 1);
      return rows.length ? `<ol class="funnel ranks${o.tight ? ' ranks--tight' : ''}">${rows.slice(0, o.max || rows.length).map((r, i) => `<li><span title="${esc(o.title ? o.title(r.key) : r.key)}">${o.numbered ? `<small>${i + 1}</small>` : ''}${name(r.key)}</span><div class="meter"><i style="width:${(r.n / top) * 100}%"></i></div><b>${num(r.n)}</b><small>${total ? Math.round((r.n / total) * 100) : 0}%</small></li>`).join('')}</ol>` : `<p class="empty">${o.none || 'nothing counted in this period yet.'}</p>`;
    };
    const sinceText = S.since ? new Date(S.since + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).toLowerCase() : '';
    const quiet = !(+now.views || +now.visitors);
    const click = (key) => { const [words, where] = key.split('  ·  '); return [words || key, where || '']; };
    const best = S.pages[0], land = S.countries[0];

    main.innerHTML = head('reports', 'how the website is doing. choose a period — every number, chart and list below follows it.',
      '<button class="btn" data-csv="site">download as a spreadsheet</button>')
      + `<div class="reports">
        ${reportTabs()}
        <div class="period" role="group" aria-label="period">${PERIODS.map(([k, t]) => `<button type="button" class="chip${k === reportPeriod ? ' is-active' : ''}" data-period="${k}" aria-pressed="${k === reportPeriod}">${t}</button>`).join('')}</div>
        ${quiet ? `<p class="notice-soft"><b>${S.since ? `nobody was counted in ${periodName}.` : 'counting has just been switched on.'}</b> every visitor from now on is counted by itself — there is nothing to set up. your own visits are left out on the browser where you use this admin panel.</p>` : ''}

        <div class="kpis">
          ${tile('visitors', num(now.visitors), 'visitors', `people, counted once a day each${+now.visitors ? ` · ${Math.round((now.fresh / now.visitors) * 100)}% here for the first time` : ''}`)}
          ${tile('visits', num(now.visits), 'visits', +now.visitors ? `${num(now.visits / now.visitors)} visit${now.visits / now.visitors === 1 ? '' : 's'} per visitor` : 'each time someone opens the website')}
          ${tile('pages opened', num(now.views), 'views', +now.visits ? `${num(now.views / now.visits)} pages in a visit, on average` : 'every page, every time')}
          ${tile('buttons and links pressed', num(now.clicks), 'clicks', +now.views ? `${num(now.clicks / now.views)} for every page opened` : 'every press, on every page')}
          ${tile('most popular page', best ? esc(pageName(best.key)) : '—', '', best ? `opened ${num(best.n)} time${best.n === 1 ? '' : 's'}` : 'no page opened yet')}
          ${tile('most visitors are from', land ? `${countryName(land.key)[0]} ${esc(countryName(land.key)[1])}` : '—', '', land ? `${num(land.n)} of ${num(S.countries.reduce((a, r) => a + r.n, 0))} visitors` : 'no visitor counted yet')}
        </div>

        <div class="charts">
          ${columnChart(pts('visitors'), { title: 'visitors', sub: `people on the website, per ${stepName}`, fmt: num, stepName, none: 'no visitors counted in this period.' })}
          ${columnChart(pts('views'), { title: 'pages opened', sub: `how much was looked at, per ${stepName}`, fmt: num, stepName, none: 'no pages opened in this period.' })}
          ${columnChart(pts('visits'), { title: 'visits', sub: `times the website was opened, per ${stepName}`, fmt: num, stepName, none: 'no visits counted in this period.' })}
          ${columnChart(pts('clicks'), { title: 'buttons and links pressed', sub: `how much people did, per ${stepName}`, fmt: num, stepName, none: 'nothing was pressed in this period.' })}
        </div>

        <div class="h2"><span>most popular pages <small>${S.pages.length}</small></span></div>
        <p class="lede">every page of the website, from the most opened to the least. the percentage is its share of all pages opened.</p>
        ${rank(S.pages, (k) => esc(pageName(k)), { numbered: true, title: (k) => k, none: 'no page has been opened in this period.' })}

        <div class="h2"><span>buttons and links people press <small>${S.clicks.length}</small></span></div>
        <p class="lede">the words on the button or link, and the page it is on. this shows what people actually want from each page.</p>
        ${rank(S.clicks, (k) => { const [w, p] = click(k); return `“${esc(w)}”<em class="on-page">on ${esc(pageName(p))}</em>`; }, { numbered: true, none: 'nothing has been pressed in this period.' })}

        <div class="rank-grid">
          <section><div class="h2"><span>where visitors are <small>${S.countries.length}</small></span></div>
            ${rank(S.countries, (k) => { const [flag, name] = countryName(k); return `${flag ? `<i class="flag" aria-hidden="true">${flag}</i>` : ''}${esc(name)}`; }, { tight: true, none: 'no visitor counted yet.' })}</section>
          <section><div class="h2"><span>how they found the website <small>${S.refs.length}</small></span></div>
            ${rank(S.refs, (k) => esc(k), { tight: true, none: 'no visit counted yet.' })}</section>
          <section><div class="h2"><span>phone or computer</span></div>
            ${rank(S.devices, (k) => esc(k), { tight: true, none: 'no visit counted yet.' })}</section>
          <section><div class="h2"><span>browser</span></div>
            ${rank(S.browsers, (k) => esc(k), { tight: true, none: 'no visit counted yet.' })}</section>
        </div>

        <div class="h2"><span>the first page people land on</span></div>
        <p class="lede">where a visit begins — the page a link, a search or a post brought them to.</p>
        ${rank(S.entries, (k) => esc(pageName(k)), { numbered: true, title: (k) => k, none: 'no visit counted yet.' })}

        <p class="lede how-counted"><b>how this is counted.</b> ${sinceText ? `counting started on ${sinceText}. ` : ''}a visitor is one browser, counted once a day; a visit is one time the website is opened. only totals are kept — no names, no ip addresses, no cookies — so nobody is followed around, and this cannot show what one particular person did. the admin panel is never counted, and neither is the browser you use it from. the academy tab has the detail for learners, enrolments and money.</p>
      </div>`;
    wire(() => {
      const list = (title, rows, f = (k) => [k]) => [[title], ...rows.map((r) => [...f(r.key), r.n]), []];
      downloadCsv(`website-report-${reportPeriod === 'all' ? 'all-time' : reportPeriod}-${new Date().toISOString().slice(0, 10)}.csv`, [
        ['amaze consortium website — ' + periodName], [],
        ['visitors', now.visitors], ['first-time visitors', now.fresh], ['visits', now.visits], ['pages opened', now.views], ['buttons and links pressed', now.clicks], [],
        [stepName, 'visitors', 'visits', 'pages opened', 'buttons pressed'], ...S.series.map((x) => [x.d, x.visitors, x.visits, x.views, x.clicks]), [],
        ...list('page, address, times opened', S.pages, (k) => [pageName(k), k]),
        ...list('button or link, page, times pressed', S.clicks, (k) => { const [w, p] = click(k); return [w, pageName(p)]; }),
        ...list('country, code, visitors', S.countries, (k) => [countryName(k)[1], k]),
        ...list('found the website through, visits', S.refs), ...list('device, visits', S.devices), ...list('browser, visits', S.browsers),
        ...list('first page of a visit, address, visits', S.entries, (k) => [pageName(k), k]),
      ]);
      toast('the spreadsheet was saved to your downloads');
    });
  }

  async function reportsView() {
    if (reportTab === 'site') return siteReportView();
    const [from, to] = periodRange(reportPeriod);
    let tz = 'Asia/Dhaka'; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch (e) {}
    // while a new period loads, what is on screen stays (dimmed) instead of jumping
    const old = $('.reports', main); if (old) old.classList.add('is-loading');
    const [rep, logRes] = await Promise.all([
      sb.rpc('academy_report', { p_from: from, p_to: to, p_tz: tz }),
      (logKind ? sb.from('activity_log').select('*').eq('kind', logKind) : sb.from('activity_log').select('*')).order('at', { ascending: false }).limit(logShown + 1),
    ]);
    if (rep.error || !rep.data || !rep.data.now) {
      main.onclick = (e) => { const t = e.target.closest('[data-rtab]'); if (t) { reportTab = t.dataset.rtab; reportsView(); } };
      main.innerHTML = head('reports', 'how the academy is doing.') + reportTabs() + `<p class="empty">${/does not exist|schema cache|404/i.test((rep.error && rep.error.message) || '') ? 'one step left to switch reports on: open supabase → sql editor, paste the file <b>seed/website-backend-11-reports.sql</b> and press run (once).' : esc(plain((rep.error && rep.error.message) || 'the report could not be loaded — try again.'))}</p>`;
      return;
    }
    const R = rep.data, now = R.now, was = R.before, cur = R.currency || '৳';
    const log = Array.isArray(logRes.data) ? logRes.data : [];
    const money = (v) => (/^[a-z]/i.test(cur) ? `${cur} ${num(v)}` : cur + num(v));
    const periodName = (PERIODS.find(([k]) => k === reportPeriod) || [])[1];
    const beforeName = { 7: 'the 7 days before', 30: 'the 30 days before', 90: 'the 90 days before', month: 'the same stretch before', year: 'the same stretch before' }[reportPeriod];
    // points along the time axis
    const byMonth = R.step === 'month';
    const label = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', byMonth ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' }).toLowerCase();
    const full = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', byMonth ? { month: 'long', year: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).toLowerCase();
    const pts = (key) => R.series.map((x) => ({ label: label(x.d), full: full(x.d), value: +x[key] || 0 }));
    // "▲ 12% more than the 30 days before"
    const delta = (key, goodUp = true) => {
      if (!was) return '<em class="delta">since the academy opened</em>';
      const a = +now[key] || 0, b = +was[key] || 0;
      if (a === b) return `<em class="delta">the same as ${beforeName}</em>`;
      if (!b) return `<em class="delta is-up"><i aria-hidden="true">▲</i> up from none in ${beforeName}</em>`;
      const pct = Math.round(((a - b) / b) * 100), up = a > b;
      return `<em class="delta ${up === goodUp ? 'is-up' : 'is-down'}"><i aria-hidden="true">${up ? '▲' : '▼'}</i> ${Math.abs(pct)}% ${up ? 'more' : 'less'} than ${beforeName}</em>`;
    };
    const tile = (label, value, key, series, hint) => `<div class="kpi"><span>${label}</span><strong>${value}</strong>${key ? delta(key) : ''}${series ? spark(R.series.map((x) => +x[series] || 0)) : ''}${hint ? `<small>${hint}</small>` : ''}</div>`;

    const courses = R.courses || [];
    const live = courses.filter((c) => c.status === 'published');
    if (!courses.some((c) => c.id === reportCourse)) reportCourse = (courses.find((c) => c.enrolled > 0) || live[0] || courses[0] || {}).id || '';
    const pick = courses.find((c) => c.id === reportCourse);
    const steps = (pick && R.steps[pick.id]) || [];
    // where the biggest share of learners stops between one lesson and the next
    let worst = -1, worstDrop = 0;
    steps.forEach((st, i) => { const before = i ? steps[i - 1].done : (pick ? pick.enrolled : 0); const drop = before - st.done; if (before > 0 && drop > worstDrop && drop / before >= 0.2) { worstDrop = drop; worst = i; } });
    const F = R.funnel, fmax = Math.max(F.course_views, F.pay_views, F.sent, F.confirmed, 1);
    const frow = (name, n, prev, note) => `<li><span>${name}</span><div class="meter"><i style="width:${(n / fmax) * 100}%"></i></div><b>${num(n)}</b><small>${prev > 0 ? `${Math.round((n / prev) * 100)}% of the step before` : note || ''}</small></li>`;
    const T = R.todo;
    const todo = [
      T.payments_waiting ? [`${num(T.payments_waiting)} payment${T.payments_waiting === 1 ? ' is' : 's are'} waiting to be checked${T.payments_late ? ` — ${num(T.payments_late)} for more than a day` : ''}`, 'learners', 'check them'] : null,
      T.unanswered ? [`${num(T.unanswered)} question${T.unanswered === 1 ? '' : 's'} from learners ${T.unanswered === 1 ? 'has' : 'have'} no answer yet`, 'courses', 'open the academy'] : null,
      T.not_started ? [`${num(T.not_started)} learner${T.not_started === 1 ? '' : 's'} enrolled more than 3 days ago and ${T.not_started === 1 ? 'has' : 'have'} not done a single lesson`, 'learners', 'see who'] : null,
    ].filter(Boolean);
    const LOG = [['', 'everything'], ['money', 'money'], ['learner', 'learners'], ['content', 'courses & lessons'], ['admin', 'admins']];
    const LOG_ICON = { money: '৳', learner: '☺', content: '▤', admin: '⚿' };
    const when = (d) => { const t = new Date(d), s = (Date.now() - t) / 1000; return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).toLowerCase(); };
    const exact = (d) => new Date(d).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
    const quiet = !(+now.enrolments || +now.revenue || +now.lessons_done || +now.visits || +now.signups);

    main.innerHTML = head('reports', 'how the academy is doing. choose a period — every number, chart and table below follows it.',
      '<button class="btn" data-csv="courses">download as a spreadsheet</button>')
      + `<div class="reports">
        ${reportTabs()}
        <div class="period" role="group" aria-label="period">${PERIODS.map(([k, t]) => `<button type="button" class="chip${k === reportPeriod ? ' is-active' : ''}" data-period="${k}" aria-pressed="${k === reportPeriod}">${t}</button>`).join('')}</div>
        ${quiet ? `<p class="notice-soft"><b>nothing has happened in ${periodName} yet.</b> once learners visit, enrol and pay, this screen fills in by itself — there is nothing to set up.</p>` : ''}

        ${todo.length ? `<div class="todo"><strong>waiting for you</strong><ul>${todo.map(([text, view, go]) => `<li><span>${text}</span><button type="button" class="btn btn--sm" data-go="${view}">${go} →</button></li>`).join('')}</ul></div>` : ''}

        <div class="kpis">
          ${tile('money received', money(now.revenue), 'revenue', 'revenue', `${num(now.paid)} payment${+now.paid === 1 ? '' : 's'} confirmed${+now.paid ? ` · ${money(now.revenue / now.paid)} each on average` : ''}`)}
          ${tile('enrolments', num(now.enrolments), 'enrolments', 'enrolments', `${num(now.new_learners)} of them from people enrolling for the first time`)}
          ${tile('visits to course pages', num(now.visits), 'visits', 'visits', +now.visits ? `${Math.round((now.enrolments / now.visits) * 100)} of every 100 visits ended in an enrolment` : (F.tracking_since ? 'one count per visitor, each time they come back' : 'counting starts with the next visitor'))}
          ${tile('learners who studied', num(now.active), 'active', 'lessons', `${num(now.lessons_done)} lesson${+now.lessons_done === 1 ? '' : 's'} finished between them`)}
          ${tile('finished a course', num(now.finished), 'finished', '', `${num(now.certificates)} certificate${+now.certificates === 1 ? '' : 's'} given`)}
          ${tile('new accounts', num(now.signups), 'signups', '', 'people who signed in with google for the first time')}
        </div>
        <ul class="facts">
          <li><span>given away through coupons</span><b>${money(now.discounts)}</b></li>
          <li><span>questions asked</span><b>${num(now.questions)}</b></li>
          <li><span>reviews</span><b>${num(now.reviews)}${now.rating ? ` · ${now.rating} out of 5` : ''}</b></li>
          <li><span>time to check a payment (typical)</span><b>${T.hours_to_confirm == null ? '—' : T.hours_to_confirm < 1 ? 'under an hour' : num(T.hours_to_confirm) + ' h'}</b></li>
        </ul>

        <div class="charts">
          ${columnChart(pts('revenue'), { title: 'money received', sub: `confirmed bkash payments, per ${byMonth ? 'month' : 'day'}`, fmt: money, stepName: byMonth ? 'month' : 'day', none: 'no payment was confirmed in this period.' })}
          ${columnChart(pts('enrolments'), { title: 'enrolments', sub: `people joining a course, program or webinar, per ${byMonth ? 'month' : 'day'}`, fmt: num, stepName: byMonth ? 'month' : 'day', none: 'nobody enrolled in this period.' })}
          ${columnChart(pts('visits'), { title: 'visits to course pages', sub: F.tracking_since ? `counted since ${new Date(F.tracking_since + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).toLowerCase()}` : 'counting starts with the next visitor', fmt: num, stepName: byMonth ? 'month' : 'day', none: 'no visits counted in this period.' })}
          ${columnChart(pts('lessons'), { title: 'lessons finished', sub: `how much studying happened, per ${byMonth ? 'month' : 'day'}`, fmt: num, stepName: byMonth ? 'month' : 'day', none: 'no lesson was finished in this period.' })}
        </div>

        <div class="h2"><span>from a visit to a paid place</span></div>
        <p class="lede">how many people reach each step on the way to paying. a big fall between two steps shows where people give up.</p>
        <ol class="funnel">
          ${frow('opened a course page', F.course_views, 0, 'the start')}
          ${frow('opened the payment page', F.pay_views, F.course_views)}
          ${frow('sent a payment', F.sent, F.pay_views)}
          ${frow('payment confirmed', F.confirmed, F.sent)}
        </ol>

        <div class="h2"><span>every course, side by side <small>${courses.length}</small></span></div>
        <div class="table-wrap"><table class="table table--courses"><thead><tr><th>name</th><th>visits</th><th>joined in this period</th><th>enrolled in all</th><th>payments</th><th>money</th><th>how far learners get</th><th>finished</th><th>rating</th></tr></thead>
          <tbody>${courses.map((c) => `<tr><td><strong>${esc(c.title)}</strong><span class="sub">${esc(c.kind)}${c.status === 'published' ? '' : ' · draft'}${c.price ? ' · ' + money(c.price) : ' · free'}</span></td>
            <td>${num(c.views)}</td><td>${num(c.joined)}</td><td>${num(c.enrolled)}</td><td>${num(c.paid)}${c.waiting ? `<span class="sub">${num(c.waiting)} waiting</span>` : ''}</td><td>${money(c.revenue)}</td>
            <td>${c.progress == null ? '<span class="sub" style="margin:0;">nobody enrolled</span>' : `<div class="meter" title="on average, learners have done ${c.progress}% of the lessons"><i style="width:${c.progress}%"></i></div><span class="sub">${c.progress}% of the lessons</span>`}</td>
            <td>${c.enrolled ? `${num(c.finished)}<span class="sub">${Math.round((c.finished / c.enrolled) * 100)}% of those enrolled</span>` : '—'}</td>
            <td>${c.rating ? `${c.rating}<span class="sub">${num(c.reviews)} review${c.reviews === 1 ? '' : 's'}</span>` : '—'}</td></tr>`).join('') || '<tr><td colspan="9">no courses yet.</td></tr>'}</tbody></table></div>

        <div class="h2"><span>where learners stop</span>${courses.length > 1 ? `<label class="pick"><span>course</span><select id="rep-course">${courses.map((c) => `<option value="${esc(c.id)}"${c.id === reportCourse ? ' selected' : ''}>${esc(c.title)}</option>`).join('')}</select></label>` : ''}</div>
        <p class="lede">${pick ? `the lessons of <b style="color:var(--fg)">${esc(pick.title)}</b> in order, and how many of its ${num(pick.enrolled)} enrolled learner${pick.enrolled === 1 ? '' : 's'} finished each one (all time). a sudden drop means that lesson, or the one before it, is losing people.` : 'no course to show yet.'}</p>
        ${pick && steps.length ? `<ol class="dropoff">${steps.map((st, i) => { const base = Math.max(pick.enrolled, st.done, 1); return `<li class="${i === worst ? 'is-worst' : ''}"><span><small>${i + 1}</small>${esc(st.title)}</span><div class="meter"><i style="width:${(st.done / base) * 100}%"></i></div><b>${num(st.done)}</b><small>${pick.enrolled ? Math.round((st.done / pick.enrolled) * 100) + '% of enrolled' : ''}${i === worst ? ' · <em>most learners stop before this one</em>' : ''}</small></li>`; }).join('')}</ol>` : pick ? '<p class="empty">this one has no lessons yet.</p>' : ''}

        <div class="h2"><span>coupons <small>${(R.coupons || []).length}</small></span></div>
        ${(R.coupons || []).length ? `<div class="table-wrap"><table class="table"><thead><tr><th>code</th><th>worth</th><th>used in this period</th><th>money it brought in</th><th>discount given</th></tr></thead><tbody>${R.coupons.map((k) => `<tr><td><code class="coupon-code" style="font-size:14px;">${esc(k.code)}</code></td><td>${esc(k.worth)} off</td><td>${num(k.used)}</td><td>${money(k.revenue)}</td><td>${money(k.given)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">no coupons have been made. you make them on the academy screen, under “coupons”.</p>'}

        <div class="h2"><span>what happened</span><button class="btn btn--sm" data-csv="log">download this list</button></div>
        <p class="lede">a line for everything that happens in the academy — written by the database itself, so it cannot be edited. this list is not cut by the period above.</p>
        <div class="period" role="group" aria-label="what to show">${LOG.map(([k, t]) => `<button type="button" class="chip${k === logKind ? ' is-active' : ''}" data-log="${k}" aria-pressed="${k === logKind}">${t}</button>`).join('')}</div>
        <ul class="log">${log.slice(0, logShown).map((x) => `<li class="log--${esc(x.kind)}"><i aria-hidden="true">${LOG_ICON[x.kind] || '•'}</i><div><b></b> <span></span></div><time datetime="${esc(x.at)}" title="${esc(exact(x.at))}">${when(x.at)}</time></li>`).join('') || `<li class="log-none">${logKind ? 'nothing of this kind has happened yet.' : 'nothing has happened yet. from now on, every enrolment, payment and change is written here.'}</li>`}</ul>
        ${log.length > logShown ? '<button class="btn" data-log-more>show earlier ones</button>' : ''}
      </div>`;
    // names and descriptions come from learners and admins: they are put in as plain text
    $$('.log li:not(.log-none)', main).forEach((li, i) => { $('b', li).textContent = log[i].actor; $('span', li).textContent = log[i].what; });

    main.onchange = (e) => { if (e.target.id === 'rep-course') { reportCourse = e.target.value; reportsView(); } };
    main.onclick = (e) => {
      const t = e.target.closest('[data-period], [data-log], [data-log-more], [data-csv], [data-go], [data-rtab]'); if (!t) return;
      if (t.dataset.rtab) { reportTab = t.dataset.rtab; return reportsView(); }
      if (t.dataset.go) return go(t.dataset.go);
      if (t.dataset.period) { reportPeriod = t.dataset.period; return reportsView(); }
      if (t.dataset.log !== undefined && !t.dataset.csv && !t.hasAttribute('data-log-more')) { logKind = t.dataset.log; logShown = 30; return reportsView(); }
      if (t.hasAttribute('data-log-more')) { logShown += 50; return reportsView(); }
      if (t.dataset.csv === 'courses') {
        downloadCsv(`academy-report-${reportPeriod === 'all' ? 'all-time' : reportPeriod}-${new Date().toISOString().slice(0, 10)}.csv`, [
          ['amaze consortium academy — ' + periodName], [],
          ['money received', now.revenue], ['payments confirmed', now.paid], ['enrolments', now.enrolments], ['first-time learners', now.new_learners], ['visits to course pages', now.visits], ['learners who studied', now.active], ['lessons finished', now.lessons_done], ['finished a course', now.finished], ['certificates', now.certificates], ['new accounts', now.signups], ['given away through coupons', now.discounts], [],
          ['course', 'kind', 'on the website', 'price', 'visits', 'joined in this period', 'enrolled in all', 'payments confirmed', 'money', 'average progress %', 'finished', 'rating', 'reviews'],
          ...courses.map((c) => [c.title, c.kind, c.status === 'published' ? 'yes' : 'no', c.price ?? 'free', c.views, c.joined, c.enrolled, c.paid, c.revenue, c.progress ?? '', c.finished, c.rating ?? '', c.reviews]), [],
          [byMonth ? 'month' : 'day', 'money received', 'enrolments', 'visits', 'lessons finished'], ...R.series.map((x) => [x.d, x.revenue, x.enrolments, x.visits, x.lessons]),
        ]);
        return toast('the spreadsheet was saved to your downloads');
      }
      if (t.dataset.csv === 'log') {
        downloadCsv(`academy-activity-${new Date().toISOString().slice(0, 10)}.csv`, [['when', 'who', 'what', 'kind'], ...log.slice(0, logShown).map((x) => [new Date(x.at).toLocaleString('en-GB'), x.actor, x.what, x.kind])]);
        return toast('the list was saved to your downloads');
      }
    };
  }

  // ── admins ─────────────────────────────────────────────────────────────────
  async function adminsView(editing) {
    const [rows, setting, auth] = await Promise.all([
      run(sb.from('admins').select('*').order('added_at')),
      sb.from('site_settings').select('value').eq('key', 'auto_admin').maybeSingle(),
      fetch(`${A.url}/auth/v1/settings`, { headers: { apikey: A.key } }).then((r) => r.json()).catch(() => null),
    ]);
    if (!rows) return;
    const list = rows === true ? [] : rows;
    const hasSwitch = !setting.error;
    let auto = hasSwitch && !!setting.data && setting.data.value === true;

    // Automatic access tells a dashboard-added account from a website sign-up by
    // one thing: website sign-ups are confirmed through an emailed link. If the
    // project stops requiring that link, or lets people in through another
    // provider, the two look the same — so the rule is switched off on the spot.
    // (Google is how learners sign in, and the database already treats every Google account
    // as a learner — it can never be given admin access — so it does not count here.)
    const others = auth && auth.external ? Object.keys(auth.external).filter((k) => auth.external[k] && k !== 'email' && k !== 'google') : [];
    const unsafe = auth ? [auth.mailer_autoconfirm && '“confirm email” is turned off', others.length && `sign-in with ${others.join(', ')} is turned on`].filter(Boolean) : [];
    if (auto && unsafe.length) {
      const { error } = await sb.from('site_settings').update({ value: false }).eq('key', 'auto_admin');
      if (!error) auto = false;
    }

    // one person's role, as a form: main admin, or limited with the parts ticked
    const roleForm = (r) => `<div class="field"><span>what can they do?</span>${choice('role', [['limited', 'limited admin', 'only the parts you tick below', '◐'], ['main', 'main admin', 'everything — including adding and removing admins', '●']], r.role === 'main' ? 'main' : 'limited', 'choice--2')}</div>
      <div class="field" data-when="role=limited"><span>which parts can they open?</span>
        <div class="areas">${AREAS.map(([k, label, text]) => `<label class="area"><input type="checkbox" name="access" value="${k}"${(r.access || []).includes(k) ? ' checked' : ''}><b>${label}</b><small>${text}</small></label>`).join('')}</div>
        <small class="hint">nothing ticked means they can sign in but cannot open or change anything. a limited admin never sees this “admins” screen.</small></div>`;
    const says = (r) => (r.role === 'main' ? 'main admin — everything' : (r.access || []).length ? 'limited — ' + AREAS.filter(([k]) => r.access.includes(k)).map(([, label]) => label).join(', ') : 'limited — nothing opened yet');
    const mains = list.filter((r) => r.role === 'main').length;
    const mineRow = (r) => r.email.toLowerCase() === user.email.toLowerCase();

    main.innerHTML = head('admins', 'the people who can sign in to this panel. a main admin can do everything; a limited admin can open only the parts you tick for them.')
      + `<div class="h2"><span>admins now <small>${list.length} · ${mains} main</small></span></div>
        <div class="rows">${list.map((r) => (r.email === editing ? `<form class="editor" data-aform="${esc(r.email)}"><p class="lede" style="padding-top:18px;margin-bottom:0;">changing what <b style="color:var(--fg);text-transform:none;">${esc(r.email)}</b> can do</p>${roleForm(r)}
            <div class="editor-foot"><button class="btn btn--solid" type="submit">save</button><button class="btn" type="button" data-acancel>cancel</button></div></form>`
          : `<div class="row row--plain" data-email="${esc(r.email)}"><div><strong style="text-transform:none;">${esc(r.email)}${mineRow(r) ? '<span class="badge badge--on">you</span>' : ''}</strong>
            <span class="pills"><span class="badge${r.role === 'main' ? ' badge--on' : ''}"${r.role !== 'main' && !(r.access || []).length ? ' style="border-color:#f2b42e;color:#f2b42e;"' : ''}>${says(r)}</span></span></div>
          <div class="row-actions">${mineRow(r) ? '' : '<button class="btn btn--sm btn--solid" data-aedit>change what they can do</button><button class="btn btn--sm btn--danger" data-remove>remove</button>'}</div></div>`)).join('')}</div>
        <div class="h2"><span>add an admin</span></div>
        <form class="editor" id="add-admin" style="border-color:var(--line);">
          <p class="lede" style="padding-top:18px;">make a login for them here, then tell them the email and password. use an email that has not signed in on the website as a learner.</p>
          <div class="form-grid"><label class="field"><span>their email</span><input name="email" type="email" required autocomplete="off" placeholder="name@example.com"></label>
          <label class="field"><span>a password for them — at least 8 letters or numbers</span><input name="password" type="text" required minlength="8" autocomplete="off"></label></div>
          ${roleForm({ role: 'limited', access: [] })}
          <div class="editor-foot"><button class="btn btn--solid" type="submit">create admin login</button></div></form>`
      + (hasSwitch ? `<details class="group" style="margin-top:28px;"${unsafe.length ? ' open' : ''}><summary>advanced: accounts added in supabase<small>${unsafe.length ? '<b style="color:#ff6b5e;">switched off for safety</b>' : auto ? 'on' : 'off'}</small></summary><div style="padding:18px 20px 22px;">
          <label class="check" style="margin-top:0;"><input type="checkbox" id="auto-admin"${auto ? ' checked' : ''}${unsafe.length ? ' disabled' : ''}> anyone i add in supabase becomes an admin automatically</label>
          <p style="margin-top:12px;font-size:13px;line-height:1.6;color:var(--muted);">${unsafe.length
            ? `<b style="color:#ff6b5e;">switched off for safety:</b> ${unsafe.join(' and ')} in this supabase project, so a website sign-up can no longer be told apart from an account you added. turn that setting back, or add admins with the form above.`
            : 'a person added under <b>authentication → users → add user</b> can sign in here — as a limited admin with nothing opened, until you choose above what they can do. people who sign up on the website stay learners.'}</p>
        </div></details>` : '');
    $$('form', main).forEach(syncShown);
    const picked = (f) => { const v = new FormData(f); const role = v.get('role') === 'main' ? 'main' : 'limited'; return { role, access: role === 'main' ? [] : v.getAll('access') }; };
    const sw = $('#auto-admin', main);
    if (sw) sw.addEventListener('change', async () => {
      if (!(await run(sb.from('site_settings').update({ value: sw.checked }).eq('key', 'auto_admin'), sw.checked ? 'on — people you add in supabase can sign in here' : 'off — add admins with the form on this screen'))) sw.checked = !sw.checked;
    });
    main.onsubmit = async (e) => {
      const f = e.target; e.preventDefault();
      if (f.id === 'add-admin') {
        const v = new FormData(f), email = v.get('email').trim(), give = picked(f);
        if (give.role === 'main' && !confirm(`make ${email} a main admin?\n\nthey will be able to do everything you can — including removing you.`)) return;
        // the login is made first (with nothing opened); what it may do is set straight after
        if (!(await run(sb.rpc('create_admin', { p_email: email, p_password: v.get('password') })))) return;
        if (await run(sb.from('admins').update(give).eq('email', email.toLowerCase()), give.role === 'main' ? 'main admin created — they can sign in now' : give.access.length ? 'limited admin created — they can sign in now' : 'admin created, with nothing opened yet')) adminsView();
        else adminsView();
        return;
      }
      if (f.dataset.aform) {
        const email = f.dataset.aform, give = picked(f), was = list.find((r) => r.email === email) || {};
        if (give.role === 'main' && was.role !== 'main' && !confirm(`make ${email} a main admin?\n\nthey will be able to do everything you can — including removing you.`)) return;
        if (await run(sb.from('admins').update(give).eq('email', email), 'saved — it applies the next time they open the panel')) adminsView();
      }
    };
    main.onclick = async (e) => {
      if (e.target.closest('[data-acancel]')) return adminsView();
      const row = e.target.closest('.row'); if (!row) return;
      const email = row.dataset.email;
      if (e.target.closest('[data-aedit]')) return adminsView(email);
      if (!e.target.closest('[data-remove]')) return;
      if (!confirm(`remove ${email} as an admin? they lose access to this panel straight away. (the login itself stays in supabase until you delete it there.)`)) return;
      if (await run(sb.from('admins').delete().eq('email', email), 'removed')) adminsView();
    };
  }

  boot();
})();
