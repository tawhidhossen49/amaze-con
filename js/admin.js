// ── ADMIN PANEL ─────────────────────────────────────────────────────────────
// Edits everything the public site shows:
//   pages     every heading, paragraph, button, link and image on the static
//             pages (the field list is js/site-fields.js; values → site_text)
//   lists     schools, subsidiaries, executives, advisors, partners (site_content)
//   courses   courses, modules, lessons (video / reading / quiz / form), files,
//             announcements, reviews, questions and certificates
//   learners  who is enrolled and how far along they are (read-only)
//   admins    who may use this panel
//
// This page is only a form. What a visitor is ALLOWED to change is enforced
// by Row Level Security in the database (seed/website-backend.sql): every
// write below is rejected unless the signed-in, email-confirmed user is
// listed in the `admins` table. Hiding or bypassing this page changes nothing.
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
    if (kind.value === 'article') kind.value = 'video';
    status.textContent = `uploaded: ${file.name}. save the lesson to publish it.`;
    toast('video uploaded');
  });
  // "attach a file" on a lesson: uploads it and adds a "name | link" line
  document.addEventListener('change', async (e) => {
    const input = e.target.closest('[data-attach]');
    if (!input || !input.files[0]) return;
    toast('uploading…');
    const file = input.files[0];
    const url = await upload(file);
    if (!url) return;
    const box = document.querySelector(`[name="${input.dataset.attach}"]`);
    box.value = (box.value.trim() ? box.value.trim() + '\n' : '') + `${file.name} | ${url}`;
    input.value = '';
    toast('attached');
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
    shell();
  }

  // ── shell ──────────────────────────────────────────────────────────────────
  const VIEWS = { pages: ['pages', pagesView], lists: ['lists', listsView], courses: ['courses', coursesView], learners: ['learners', learnersView], admins: ['admins', adminsView] };
  let main, savebar, dirtyGuard = () => false;

  function shell() {
    app.innerHTML = `<div class="admin-shell">
      <aside class="admin-side">
        <a class="admin-brand" href="${A.root}index.html" target="_blank" rel="noopener"><img src="${A.root}img/amazelogo.png" alt=""><span>site admin</span></a>
        <nav class="admin-nav">${Object.entries(VIEWS).map(([k, [label]]) => `<button data-view="${k}">${label}</button>`).join('')}</nav>
        <div class="admin-user">${esc(user.email)}<button class="linkish" id="signout">sign out</button></div>
      </aside>
      <main class="admin-main"></main>
    </div>
    <div class="savebar"><span></span><div class="admin-actions"><button class="btn" data-save="discard">discard</button><button class="btn btn--solid" data-save="save">save changes</button></div></div>`;
    main = $('.admin-main', app); savebar = $('.savebar', app);
    $('#signout', app).addEventListener('click', async () => { await sb.auth.signOut(); boot(); });
    $$('.admin-nav button', app).forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
    window.addEventListener('beforeunload', (e) => { if (dirtyGuard()) { e.preventDefault(); e.returnValue = ''; } });
    // back / forward and typed #links switch screens too (go() itself uses replaceState, which doesn't fire this)
    // back / forward and typed #links switch screens too
    window.onhashchange = () => { const [v, arg] = route(); if (v in VIEWS) go(v, arg); };
    const [v, arg] = route();
    go(v in VIEWS ? v : 'pages', arg);
  }

  // '#courses/web-development-fundamentals' → ['courses', 'web-development-fundamentals']
  const route = () => { const [v, ...rest] = location.hash.slice(1).split('/'); return [v, rest.length ? decodeURIComponent(rest.join('/')) : undefined]; };

  function go(view, arg) {
    if (dirtyGuard() && !confirm('you have unsaved changes on this screen. leave without saving?')) return;
    dirtyGuard = () => false;
    main.onclick = null; main.oninput = null; savebar.onclick = null;
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
    const hints = { html: 'you can use &lt;em&gt;word&lt;/em&gt; for the green accent, &lt;a href="…"&gt; for a link and &lt;br&gt; for a line break.', stat: 'a number, optionally followed by a symbol — e.g. 25+' };

    main.innerHTML = head('pages', 'every piece of wording, every button link and every image on the static pages. a field outlined in green differs from what is saved.',
      `<a class="btn" href="${A.root + page.file}" target="_blank" rel="noopener">view page ↗</a>`)
      + `<div class="tabs">${window.AMAZE_PAGES.map((p) => `<button class="chip${p.id === page.id ? ' is-active' : ''}" data-page="${p.id}">${esc(p.title)}</button>`).join('')}</div>`
      + groups.map((g, gi) => {
        const fs = fields.filter((f) => f.group === g);
        const edited = fs.filter((f) => f.key in stored).length;
        return `<details class="group"${gi === 0 ? ' open' : ''}><summary>${esc(g)}<small>${fs.length} fields${edited ? ` · <b>${edited} edited</b>` : ''}</small></summary><div class="group-body">${fs.map((f) => {
          const long = f.type === 'html' || f.value.length > 70 || f.builtIn.length > 70;
          const control = f.type === 'src' ? imageField(f.key, f.value)
            : f.type === 'visible' ? `<select name="${f.key}"><option value="1"${f.value === '1' ? ' selected' : ''}>shown</option><option value="0"${f.value === '0' ? ' selected' : ''}>hidden</option></select>`
            : long ? `<textarea name="${f.key}" rows="${Math.min(8, Math.max(2, Math.ceil(f.value.length / 80)))}">${esc(f.value)}</textarea>`
              : `<input name="${f.key}" value="${esc(f.value)}">`;
          const tag = f.type === 'src' ? 'div' : 'label';   // the image control has its own <label>
          return `<${tag} class="field${long || f.type === 'src' ? ' field--wide' : ''}" data-key="${f.key}">
            <div class="field-top"><span>${esc(f.label)}</span>${f.key in stored ? '<button type="button" class="linkish" data-reset>restore original</button>' : ''}</div>
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
      $('span', savebar).textContent = `${list.length} unsaved change${list.length === 1 ? '' : 's'} on “${page.title}”`;
    }
    dirtyGuard = () => changed().length > 0;
    main.oninput = refresh;
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
      toast(`saved — ${list.length} change${list.length === 1 ? '' : 's'} are live`);
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
        ${cfg.url ? `<label class="field"><span>link (optional)</span><input name="url" type="url" value="${esc(r.url || '')}" placeholder="https://"></label>` : ''}
        <label class="field"><span>initials (shown if there is no image)</span><input name="initials" maxlength="6" value="${esc(r.initials || '')}"></label>
        ${cfg.desc ? `<label class="field field--wide"><span>description</span><textarea name="description" rows="3">${esc(r.description || '')}</textarea></label>` : ''}
        <div class="field field--wide"><span>${currentList === 'executive' || currentList === 'advisor' ? 'photo' : 'logo'}</span>${imageField('img', r.img)}</div>
      </div>
      <div class="editor-foot"><button class="btn btn--solid" type="submit">${r.id ? 'save' : 'add'}</button><button class="btn" type="button" data-cancel>cancel</button></div>
    </form>`;

    main.innerHTML = head('lists', 'the repeating sections of the home page. changes are live as soon as you save.',
      '<button class="btn btn--solid" data-new>+ add</button>')
      + `<div class="tabs">${Object.entries(LISTS).map(([k, v]) => `<button class="chip${k === currentList ? ' is-active' : ''}" data-list="${k}">${v.title}</button>`).join('')}</div>`
      + `<p style="margin:-8px 0 20px;font-size:13px;color:var(--muted);">${cfg.note} ${rows.length} item${rows.length === 1 ? '' : 's'}, shown in this order.</p>`
      + (editId === 'new' ? form({}) : '')
      + `<div class="rows">${rows.map((r, i) => (r.id === editId ? form(r) : `<div class="row" data-id="${esc(r.id)}">
          <div class="thumb">${r.img ? `<img src="${esc(img(r.img))}" alt="" data-fallback="${esc(r.initials || '—')}">` : esc(r.initials || '—')}</div>
          <div><strong>${esc(r.name)}${r.hidden ? '<span class="badge">hidden</span>' : ''}</strong>${r.subtitle || r.url ? `<span class="sub">${esc(r.subtitle || r.url)}</span>` : ''}</div>
          <div class="row-actions"><button class="btn btn--sm" data-hide>${r.hidden ? 'show' : 'hide'}</button><button class="btn btn--sm" data-move="-1"${i === 0 ? ' disabled' : ''} aria-label="move up">↑</button><button class="btn btn--sm" data-move="1"${i === rows.length - 1 ? ' disabled' : ''} aria-label="move down">↓</button><button class="btn btn--sm" data-edit>edit</button><button class="btn btn--sm btn--danger" data-del>delete</button></div>
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

  // ── courses ────────────────────────────────────────────────────────────────
  async function coursesView(courseId) {
    if (courseId) return courseEditor(courseId);
    const [courses, lessons] = await Promise.all([
      run(sb.from('courses').select('*').order('sort_order').order('created_at')),
      run(sb.from('course_lessons').select('course_id')),
    ]);
    if (!courses || !lessons) return;
    const count = (id) => lessons.filter((l) => l.course_id === id).length;
    main.innerHTML = head('courses', 'draft courses are only visible here. publish one to put it in the catalogue.',
      '<button class="btn btn--solid" data-new>+ new course</button>')
      + `<div class="rows">${courses.map((c) => `<div class="row row--plain" data-id="${esc(c.id)}">
          <div><strong>${esc(c.title)}<span class="badge${c.status === 'published' ? ' badge--on' : ''}">${esc(c.status)}</span>${c.featured ? '<span class="badge">featured</span>' : ''}</strong>
            <span class="sub">${esc(c.category)} · ${esc(c.level)} · ${count(c.id)} lessons · ${c.access === 'open' ? 'open to everyone' : 'free account'}</span></div>
          <div class="row-actions"><a class="btn btn--sm" href="${A.root}courses/course.html?c=${encodeURIComponent(c.id)}" target="_blank" rel="noopener">view ↗</a><button class="btn btn--sm" data-toggle>${c.status === 'published' ? 'unpublish' : 'publish'}</button><button class="btn btn--sm btn--solid" data-open>edit</button></div>
        </div>`).join('') || '<p class="empty">no courses yet — create the first one.</p>'}</div>`;
    $('[data-new]', main).addEventListener('click', () => courseEditor(null));
    main.onclick = async (e) => {
      const row = e.target.closest('.row'); if (!row) return;
      const c = courses.find((x) => x.id === row.dataset.id);
      if (e.target.closest('[data-open]')) return go('courses', c.id);
      if (e.target.closest('[data-toggle]')) {
        const status = c.status === 'published' ? 'draft' : 'published';
        if (await run(sb.from('courses').update({ status }).eq('id', c.id), status === 'published' ? 'published — now in the catalogue' : 'moved back to draft')) coursesView();
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

  async function courseEditor(id, openLesson) {
    let course = { id: '', title: '', category: 'general', level: 'beginner', access: 'account', status: 'draft', outcomes: [], sort_order: 0 };
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
    const opt = (value, list) => list.map((o) => `<option${o === value ? ' selected' : ''}>${o}</option>`).join('');
    let content = null;
    // 'new:<module id>' means a blank form for a lesson that doesn't exist yet
    if (openLesson && !openLesson.startsWith('new:')) {
      const got = await run(sb.from('lesson_content').select('*').eq('lesson_id', openLesson).maybeSingle());
      content = got && got !== true ? got : {};
    }

    const lessonForm = (l, moduleId) => `<form class="editor" data-lesson="${esc(l.id || '')}" data-module="${esc(moduleId)}" style="margin:12px 0;">
      <div class="form-grid">
        <label class="field field--wide"><span>lesson title</span><input name="title" required value="${esc(l.title || '')}"></label>
        <label class="field field--wide"><span>module</span><select name="module_id">${modules.map((m) => `<option value="${m.id}"${m.id === moduleId ? ' selected' : ''}>${esc(m.title)}</option>`).join('')}</select></label>
        <label class="field"><span>type</span><select name="kind">${[['article', 'reading'], ['video', 'video'], ['quiz', 'quiz (built in)'], ['form', 'test / assignment (google form)']].map(([k, t]) => `<option value="${k}"${(l.kind || 'article') === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="field"><span>length in minutes</span><input name="duration_min" type="number" min="1" value="${l.duration_min || 5}"></label>
        <div class="field field--wide"><div class="field-top"><span>video — paste a youtube link, or upload your own video file</span><label class="linkish" style="cursor:pointer;">upload a video file<input type="file" accept="video/mp4,video/webm,video/quicktime,video/*" hidden data-video-upload></label></div>
          <input name="video_url" value="${esc((content && content.video_url) || '')}" placeholder="https://youtu.be/…  or  https://www.youtube.com/watch?v=…">
          <small class="hint" data-video-status>any youtube link works (long videos included) and plays inside the lesson. vimeo and google drive links work too. uploaded files should be .mp4, up to 50 MB on supabase's free plan.</small></div>
        <label class="field field--wide"><span>form link — for test / assignment lessons</span><input name="form_url" value="${esc((content && content.form_url) || '')}" placeholder="https://docs.google.com/forms/d/e/…/viewform">
          <small class="hint">paste the google form's share link. it is shown inside the lesson; learners mark it as submitted themselves, so check the responses in google forms.</small></label>
        <label class="field field--wide"><span>lesson text</span><textarea name="body" rows="12">${esc((content && content.body) || '')}</textarea>
          <small class="hint">blank line = new paragraph · ## heading · - list item · **bold** · \`code\` · three backticks on their own line start and end a code block · [text](https://link)</small></label>
        <label class="field field--wide"><span>quiz questions — for quiz lessons</span><textarea name="quiz" rows="8" placeholder="? what does html describe?&#10;- how a page looks&#10;* what is on a page&#10;- how a page behaves&#10;> html is content and structure.">${esc(quizToText(content && content.quiz))}</textarea>
          <small class="hint">? starts a question · - is a wrong option · * is the correct option · > is the explanation shown after answering. learners pass at 70%.</small></label>
      </div>
      <div class="field"><div class="field-top"><span>files and links for this lesson — one per line, as: name | link</span><label class="linkish" style="cursor:pointer;">attach a file<input type="file" hidden data-attach="resources"></label></div>
        <textarea name="resources" rows="3" placeholder="lecture slides | https://…">${esc(((content && content.resources) || []).map((r) => `${r.label} | ${r.url}`).join('\n'))}</textarea></div>
      <label class="check"><input type="checkbox" name="is_preview"${l.is_preview ? ' checked' : ''}> free preview — readable without an account</label>
      <label class="check"><input type="checkbox" name="is_hidden"${l.is_hidden ? ' checked' : ''}> hidden — keep this lesson out of the course for now</label>
      <div class="editor-foot"><button class="btn btn--solid" type="submit">${l.id ? 'save lesson' : 'add lesson'}</button><button class="btn" type="button" data-cancel>cancel</button></div>
    </form>`;

    main.innerHTML = head(id ? esc(course.title) : 'new course', id ? `<span class="badge${course.status === 'published' ? ' badge--on' : ''}" style="margin:0;">${esc(course.status)}</span>` : 'fill in the details, save, then add modules and lessons.',
      `<button class="btn" data-back>← all courses</button>${id ? `<a class="btn" href="${A.root}courses/course.html?c=${encodeURIComponent(id)}" target="_blank" rel="noopener">view ↗</a>` : ''}`)
      + `<form id="course-form"><div class="form-grid">
        <label class="field field--wide"><span>title</span><input name="title" required value="${esc(course.title)}"></label>
        <label class="field field--wide"><span>one-line summary</span><input name="tagline" value="${esc(course.tagline || '')}"></label>
        <label class="field field--wide"><span>description</span><textarea name="description" rows="4">${esc(course.description || '')}</textarea></label>
        <label class="field"><span>category</span><input name="category" required value="${esc(course.category)}"></label>
        <label class="field"><span>level</span><select name="level">${opt(course.level, ['beginner', 'intermediate', 'advanced', 'all levels'])}</select></label>
        <label class="field"><span>duration (as shown, e.g. 6 weeks)</span><input name="duration" value="${esc(course.duration || '')}"></label>
        <label class="field"><span>position in the catalogue (lower = earlier)</span><input name="sort_order" type="number" value="${course.sort_order || 0}"></label>
        <label class="field"><span>who can read the lessons</span><select name="access"><option value="account"${course.access === 'account' ? ' selected' : ''}>anyone with a free account</option><option value="open"${course.access === 'open' ? ' selected' : ''}>everyone, no account needed</option></select></label>
        <label class="field"><span>status</span><select name="status">${opt(course.status, ['draft', 'published'])}</select></label>
        <label class="field field--wide"><span>what learners will be able to do — one per line</span><textarea name="outcomes" rows="4">${esc((course.outcomes || []).join('\n'))}</textarea></label>
        <label class="field field--wide"><span>skills learners gain — one per line</span><textarea name="tags" rows="3">${esc((course.tags || []).join('\n'))}</textarea></label>
        <label class="field"><span>before you start (requirements) — one per line</span><textarea name="requirements" rows="4">${esc((course.requirements || []).join('\n'))}</textarea></label>
        <label class="field"><span>who this course is for — one per line</span><textarea name="audience" rows="4">${esc((course.audience || []).join('\n'))}</textarea></label>
        <label class="field"><span>introduction video link (optional)</span><input name="trailer_url" value="${esc(course.trailer_url || '')}" placeholder="https://"></label>
        <label class="field"><span>language</span><input name="language" value="${esc(course.language || 'english')}"></label>
        <div class="field field--wide"><div class="field-top"><span>“this course includes” box — one line each, as: label | value</span><button type="button" class="linkish" data-fill-includes>start from the automatic list</button></div>
          <textarea name="includes" rows="6" placeholder="video lessons | 12&#10;downloadable files | 5&#10;pace | your own&#10;certificate | verifiable">${esc((course.includes || []).map((r) => `${r.label} | ${r.value}`).join('\n'))}</textarea>
          <small class="hint">leave this empty and the box fills itself in from the lessons (how many videos, readings, quizzes and tests) plus pace, access and certificate. write your own lines to replace it completely.</small></div>
        <label class="field"><span>“taught by” — instructor name</span><input name="instructor_name" value="${esc(course.instructor_name || '')}"></label>
        <label class="field"><span>“taught by” — role or organisation</span><input name="instructor_role" value="${esc(course.instructor_role || '')}"></label>
        <div class="field"><span>“taught by” — photo (the first letter of the name is shown without one)</span>${imageField('instructor_img', course.instructor_img)}</div>
        <div class="field"><span>course image — the picture at the top of its card (wide, 16:9 works best)</span>${imageField('cover', course.cover)}</div>
      </div>
      <label class="check"><input type="checkbox" name="featured"${course.featured ? ' checked' : ''}> feature this course at the top of the catalogue</label>
      <label class="check"><input type="checkbox" name="sequential"${course.sequential ? ' checked' : ''}> lock the order — a lesson opens only after the ones before it are complete</label>
      <div class="editor-foot"><button class="btn btn--solid" type="submit">${id ? 'save course details' : 'create course'}</button>${id ? '<button class="btn btn--danger" type="button" data-delete-course>delete course</button>' : ''}</div></form>`
      + (id ? `<div class="h2"><span>// curriculum — ${modules.length} modules, ${lessons.length} lessons</span><button class="btn btn--sm btn--solid" data-add-module>+ add module</button></div>
        ${modules.map((m, mi) => {
          const ls = lessons.filter((l) => l.module_id === m.id);
          return `<div class="module-box" data-module="${m.id}">
            <header><div><strong>${String(mi + 1).padStart(2, '0')} — ${esc(m.title)}${m.is_hidden ? '<span class="badge">hidden</span>' : ''}</strong>${m.summary ? `<span class="sub" style="display:block;margin-top:4px;font-size:13px;color:var(--muted);">${esc(m.summary)}</span>` : ''}</div>
              <div class="row-actions"><button class="btn btn--sm" data-mmove="-1"${mi === 0 ? ' disabled' : ''}>↑</button><button class="btn btn--sm" data-mmove="1"${mi === modules.length - 1 ? ' disabled' : ''}>↓</button><button class="btn btn--sm" data-mhide>${m.is_hidden ? 'show' : 'hide'}</button><button class="btn btn--sm" data-medit>rename</button><button class="btn btn--sm btn--danger" data-mdel>delete</button></div></header>
            <div class="rows">${ls.map((l, li) => (l.id === openLesson ? lessonForm(l, m.id) : `<div class="row row--plain" data-lesson="${l.id}">
              <div><strong>${esc(l.title)}${l.is_preview ? '<span class="badge badge--on">preview</span>' : ''}${l.is_hidden ? '<span class="badge">hidden</span>' : ''}</strong><span class="sub">${{ video: '▶ video', article: '▤ reading', quiz: '☑ quiz', form: '✎ test' }[l.kind] || esc(l.kind)} · ${l.duration_min} min</span></div>
              <div class="row-actions"><button class="btn btn--sm" data-lmove="-1"${li === 0 ? ' disabled' : ''}>↑</button><button class="btn btn--sm" data-lmove="1"${li === ls.length - 1 ? ' disabled' : ''}>↓</button><button class="btn btn--sm" data-lhide>${l.is_hidden ? 'show' : 'hide'}</button><button class="btn btn--sm" data-ledit>edit</button><button class="btn btn--sm btn--danger" data-ldel>delete</button></div>
            </div>`)).join('') || '<p class="empty" style="border:0;padding:20px 0;">no lessons in this module yet.</p>'}
            ${openLesson === 'new:' + m.id ? lessonForm({}, m.id) : ''}</div>
            <footer><button class="btn btn--sm" data-add-lesson>+ add lesson</button></footer>
          </div>`;
        }).join('') || '<p class="empty">no modules yet. a module is a chapter — add one, then put lessons inside it.</p>'}
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
    // fills the "includes" box with what the page would show on its own, ready to edit
    $('[data-fill-includes]', main).addEventListener('click', () => {
      const shown = lessons.filter((l) => !l.is_hidden && !(modules.find((m) => m.id === l.module_id) || {}).is_hidden);
      const n = (k) => shown.filter((l) => l.kind === k).length;
      const access = $('#course-form [name=access]', main).value === 'open' ? 'open to everyone' : 'free account';
      $('#course-form [name=includes]', main).value = [
        n('video') && `video lessons | ${n('video')}`, n('article') && `readings | ${n('article')}`, n('quiz') && `quizzes | ${n('quiz')}`, n('form') && `tests & assignments | ${n('form')}`,
        'notes & q&a | on every lesson', 'pace | your own', `access | ${access}`, 'certificate | verifiable',
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
      if (id) { if (await run(sb.from('courses').update(row).eq('id', id), 'course saved')) reload(); return; }
      const newId = slug(row.title);
      if (!newId) return toast('give the course a title first', true);
      const { data: clash } = await sb.from('courses').select('id').eq('id', newId).maybeSingle();
      if (clash) return toast('there is already a course with that title — choose a different one', true);
      if (await run(sb.from('courses').insert({ ...row, id: newId }), 'course created — now add a module')) go('courses', newId);
    });
    if (!id) return;
    courseExtras($('#course-extras', main), id, lessons);

    main.onclick = async (e) => {
      const t = e.target;
      if (t.closest('[data-cancel]')) return reload();
      if (t.closest('[data-delete-course]')) {
        if (!confirm(`delete “${course.title}” with all its lessons and every learner's progress in it? this cannot be undone.`)) return;
        if (await run(sb.from('courses').delete().eq('id', id), 'course deleted')) go('courses');
        return;
      }
      if (t.closest('[data-add-module]')) {
        const title = prompt('module title'); if (!title) return;
        if (await run(sb.from('course_modules').insert({ course_id: id, title: title.trim(), sort_order: modules.length + 1 }), 'module added')) reload();
        return;
      }
      const box = t.closest('.module-box'); if (!box) return;
      const m = modules.find((x) => x.id === box.dataset.module), mi = modules.indexOf(m);
      const inModule = (mid) => lessons.filter((l) => l.module_id === mid);
      if (t.closest('[data-add-lesson]')) return reload('new:' + m.id);
      if (t.closest('[data-mhide]')) {
        if (await run(sb.from('course_modules').update({ is_hidden: !m.is_hidden }).eq('id', m.id), m.is_hidden ? 'module shown' : 'module hidden — its lessons are hidden with it')) reload();
        return;
      }
      if (t.closest('[data-medit]')) {
        const title = prompt('module title', m.title); if (title === null) return;
        const summary = prompt('one-line summary (optional)', m.summary || ''); if (summary === null) return;
        if (await run(sb.from('course_modules').update({ title: title.trim() || m.title, summary: summary.trim() || null }).eq('id', m.id), 'module saved')) reload();
        return;
      }
      if (t.closest('[data-mdel]')) {
        if (!confirm(`delete the module “${m.title}” and its ${inModule(m.id).length} lessons?`)) return;
        if (await run(sb.from('course_modules').delete().eq('id', m.id), 'module deleted')) reload();
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
      lf.scrollIntoView({ block: 'center' });
      lf.addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = Object.fromEntries(new FormData(lf));
        const quiz = textToQuiz(v.quiz);
        const resources = v.resources.split('\n').map((line) => line.split('|').map((x) => x.trim())).filter((x) => x.length >= 2 && x[1]).map(([label, ...rest]) => ({ label: label || rest.join('|'), url: rest.join('|') }));
        if (v.kind === 'form' && !v.form_url.trim()) return toast('paste the form link for this test', true);
        if (v.kind === 'quiz' && !quiz.length) return toast('a quiz needs at least one question with two options — see the format note under the box', true);
        const row = { course_id: id, module_id: v.module_id || lf.dataset.module, title: v.title.trim(), kind: v.kind, duration_min: Math.max(1, +v.duration_min || 5), is_preview: !!v.is_preview, is_hidden: !!v.is_hidden };
        let lessonId = lf.dataset.lesson;
        if (lessonId) { if (!(await run(sb.from('course_lessons').update(row).eq('id', lessonId)))) return; }
        else {
          const made = await run(sb.from('course_lessons').insert({ ...row, sort_order: lessons.length + 1 }).select('id').single());
          if (!made) return;
          lessonId = made.id;
        }
        if (await run(sb.from('lesson_content').upsert({ lesson_id: lessonId, video_url: v.video_url.trim() || null, form_url: v.form_url.trim() || null, body: v.body || null, quiz: quiz.length ? quiz : null, resources }), 'lesson saved')) {
          // keep numbering contiguous module by module, including the new lesson
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
      <div class="h2"><span>// announcements — ${news.length}</span></div>
      <form class="editor" data-form="news" style="border-color:var(--line);">
        <div class="form-grid"><label class="field field--wide"><span>new announcement — title</span><input name="title" required></label>
        <label class="field field--wide"><span>message (optional)</span><textarea name="body" rows="3"></textarea></label></div>
        <div class="editor-foot"><button class="btn btn--solid" type="submit">post to learners</button></div>
      </form>
      <div class="rows">${news.map((n) => `<div class="row row--plain" data-kind="news" data-id="${n.id}"><div><strong>${esc(n.title)}</strong><span class="sub">${when(n.created_at)}${n.body ? ' · ' + esc(n.body.slice(0, 90)) : ''}</span></div><div class="row-actions"><button class="btn btn--sm btn--danger" data-x="del">delete</button></div></div>`).join('') || '<p class="empty">nothing posted yet.</p>'}</div>

      <div class="h2"><span>// reviews — ${reviews.length}, average ${avg}</span></div>
      <div class="rows">${reviews.map((r) => `<div class="row row--plain" data-kind="review" data-id="${r.user_id}"><div><strong>${'★'.repeat(r.rating)} ${esc(r.author_name)}${r.is_hidden ? '<span class="badge">hidden</span>' : ''}</strong><span class="sub" style="white-space:normal;">${when(r.created_at)}${r.body ? ' · ' + esc(r.body) : ''}</span></div>
        <div class="row-actions"><button class="btn btn--sm" data-x="hide">${r.is_hidden ? 'show' : 'hide'}</button><button class="btn btn--sm btn--danger" data-x="del">delete</button></div></div>`).join('') || '<p class="empty">no reviews yet.</p>'}</div>

      <div class="h2"><span>// questions from learners — ${questions.length}</span></div>
      <div class="rows">${questions.map((q) => {
        const replies = posts.filter((c) => c.parent_id === q.id).reverse();
        return `<div class="row row--plain" data-kind="post" data-id="${q.id}" data-lesson="${q.lesson_id}" style="align-items:start;"><div>
            <strong style="white-space:normal;">${esc(q.body)}</strong><span class="sub">${esc(q.author_name)} · ${when(q.created_at)} · ${esc(lessonTitle[q.lesson_id] || 'lesson')}${replies.some((r) => r.is_staff) ? '' : ' · <b style="color:var(--green);font-weight:400;">unanswered</b>'}</span>
            ${replies.map((r) => `<span class="sub" style="white-space:normal;margin-top:8px;padding-left:14px;border-left:1px solid var(--line);" data-reply="${r.id}">${r.is_staff ? '<b style="color:var(--green);font-weight:400;">instructor</b> · ' : ''}${esc(r.author_name)}: ${esc(r.body)} <button class="linkish" data-x="del-reply" data-rid="${r.id}">delete</button></span>`).join('')}
            <form data-form="reply" style="display:flex;gap:8px;margin-top:12px;"><input name="body" required placeholder="answer as instructor…" style="flex:1;min-width:0;padding:9px 12px;background:var(--bg);color:var(--fg);border:1px solid var(--line);font:400 14px/1.4 var(--font-sans);"><button class="btn btn--sm" type="submit">reply</button></form>
          </div><div class="row-actions"><button class="btn btn--sm btn--danger" data-x="del">delete</button></div></div>`;
      }).join('') || '<p class="empty">no questions yet.</p>'}</div>

      <div class="h2"><span>// certificates issued — ${certs.length}</span></div>
      <div class="rows">${certs.map((c) => `<div class="row row--plain" data-kind="cert" data-id="${esc(c.id)}"><div><strong style="text-transform:none;">${esc(c.learner_name)}</strong><span class="sub" style="text-transform:none;">${esc(c.id)} · ${when(c.issued_at)}</span></div>
        <div class="row-actions"><a class="btn btn--sm" href="${A.root}courses/certificate.html?id=${encodeURIComponent(c.id)}" target="_blank" rel="noopener">view ↗</a><button class="btn btn--sm btn--danger" data-x="del">revoke</button></div></div>`).join('') || '<p class="empty">none yet.</p>'}</div>`;

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
  async function learnersView() {
    const [en, pr, courses, lessons, mods] = await Promise.all([
      run(sb.from('enrollments').select('*').order('enrolled_at', { ascending: false })),
      run(sb.from('lesson_progress').select('user_id,course_id,lesson_id')),
      run(sb.from('courses').select('id,title')),
      run(sb.from('course_lessons').select('id,course_id,module_id,is_hidden')),
      run(sb.from('course_modules').select('id,is_hidden')),
    ]);
    if (!en || !pr || !courses || !lessons || !mods) return;
    const list = (x) => (x === true ? [] : x);
    const title = Object.fromEntries(list(courses).map((c) => [c.id, c.title]));
    const hiddenModule = new Set(list(mods).filter((m) => m.is_hidden).map((m) => m.id));
    const visible = new Set(list(lessons).filter((l) => !l.is_hidden && !hiddenModule.has(l.module_id)).map((l) => l.id));
    const total = (id) => list(lessons).filter((l) => l.course_id === id && visible.has(l.id)).length;
    const done = (u, c) => list(pr).filter((p) => p.user_id === u && p.course_id === c && visible.has(p.lesson_id)).length;
    const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
    const rows = list(en);
    main.innerHTML = head('learners', 'everyone who has enrolled in a course, most recent first.')
      + `<div class="tiles"><div><b>${new Set(rows.map((r) => r.user_id)).size}</b><span>learners</span></div><div><b>${rows.length}</b><span>enrolments</span></div><div><b>${rows.filter((r) => r.completed_at).length}</b><span>courses completed</span></div></div>`
      + (rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>learner</th><th>course</th><th>enrolled</th><th>progress</th><th>completed</th><th></th></tr></thead><tbody>${rows.map((r) => {
        const t = total(r.course_id), d = Math.min(done(r.user_id, r.course_id), t), pct = t ? Math.round((d / t) * 100) : 0;
        return `<tr><td><strong>${esc(r.learner_name || '—')}</strong><br><span style="color:var(--muted)">${esc(r.learner_email || '')}</span></td><td>${esc(title[r.course_id] || r.course_id)}</td><td>${day(r.enrolled_at)}</td><td>${d} / ${t} · ${pct}%<div class="progress"><i style="width:${pct}%"></i></div></td><td>${day(r.completed_at)}</td><td><button class="btn btn--sm btn--danger" data-unenrol="${r.user_id}|${esc(r.course_id)}">remove</button></td></tr>`;
      }).join('')}</tbody></table></div>` : '<p class="empty">no one has enrolled yet.</p>');
    main.onclick = async (e) => {
      const b = e.target.closest('[data-unenrol]'); if (!b) return;
      const [uid, cid] = b.dataset.unenrol.split('|');
      if (!confirm('remove this learner from the course? their lesson progress is kept, so re-enrolling restores it.')) return;
      if (await run(sb.from('enrollments').delete().eq('user_id', uid).eq('course_id', cid), 'removed from the course')) learnersView();
    };
  }

  // ── admins ─────────────────────────────────────────────────────────────────
  async function adminsView() {
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
    const others = auth && auth.external ? Object.keys(auth.external).filter((k) => auth.external[k] && k !== 'email') : [];
    const unsafe = auth ? [auth.mailer_autoconfirm && '“confirm email” is turned off', others.length && `sign-in with ${others.join(', ')} is turned on`].filter(Boolean) : [];
    if (auto && unsafe.length) {
      const { error } = await sb.from('site_settings').update({ value: false }).eq('key', 'auto_admin');
      if (!error) auto = false;
    }

    main.innerHTML = head('admins', 'people who can sign in here and change the site.')
      + (hasSwitch ? `<div class="editor" style="border-color:${unsafe.length ? '#ff6b5e' : 'var(--line)'};padding-top:20px;">
          <label class="check" style="margin-top:0;"><input type="checkbox" id="auto-admin"${auto ? ' checked' : ''}${unsafe.length ? ' disabled' : ''}> anyone i add in supabase becomes an admin automatically</label>
          <p style="margin-top:12px;font-size:13px;line-height:1.6;color:var(--muted);">${unsafe.length
            ? `<b style="color:#ff6b5e;">switched off for safety:</b> ${unsafe.join(' and ')} in this supabase project, so a website sign-up can no longer be told apart from an account you added. turn that setting back, or add admins by email below.`
            : 'add a person under <b>authentication → users → add user</b> (or send them an invitation) and they can sign in here straight away — nothing else to do. people who sign up on the website stay learners. removing someone below takes their access away for good; it is only granted at the moment they are added.'}</p>
        </div>` : '')
      + `<form class="editor" id="add-admin" style="border-color:var(--line);">
          <p style="padding-top:18px;font-size:13px;line-height:1.6;color:var(--muted);">or create an admin login here. it is a new, separate account: an email that already has a learner account can't be used, and admin logins don't enrol in courses.</p>
          <div class="form-grid"><label class="field"><span>email for the new admin</span><input name="email" type="email" required autocomplete="off" placeholder="name@example.com"></label>
          <label class="field"><span>password (at least 8 characters)</span><input name="password" type="text" required minlength="8" autocomplete="off"></label></div>
          <div class="editor-foot"><button class="btn btn--solid" type="submit">create admin login</button></div></form>`
      + `<div class="rows">${list.map((r) => `<div class="row row--plain" data-email="${esc(r.email)}"><div><strong style="text-transform:none;">${esc(r.email)}${r.email.toLowerCase() === user.email.toLowerCase() ? '<span class="badge badge--on">you</span>' : ''}</strong></div>
        <div class="row-actions">${r.email.toLowerCase() === user.email.toLowerCase() ? '' : '<button class="btn btn--sm btn--danger" data-remove>remove</button>'}</div></div>`).join('')}</div>`;
    const sw = $('#auto-admin', main);
    if (sw) sw.addEventListener('change', async () => {
      if (!(await run(sb.from('site_settings').update({ value: sw.checked }).eq('key', 'auto_admin'), sw.checked ? 'on — people you add in supabase become admins' : 'off — add admins by email below'))) sw.checked = !sw.checked;
    });
    $('#add-admin', main).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      // creates the login and its admin access together, in the database
      if (await run(sb.rpc('create_admin', { p_email: f.get('email').trim(), p_password: f.get('password') }), 'admin login created — they can sign in now')) adminsView();
    });
    main.onclick = async (e) => {
      const b = e.target.closest('[data-remove]'); if (!b) return;
      const email = b.closest('.row').dataset.email;
      if (!confirm(`remove ${email} as an admin? they lose access to this panel straight away. (the login itself stays in supabase until you delete it there.)`)) return;
      if (await run(sb.from('admins').delete().eq('email', email), 'removed')) adminsView();
    };
  }

  boot();
})();
