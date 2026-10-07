// ── SAVED PAGE TEXT ─────────────────────────────────────────────────────────
// Applies whatever has been edited in the admin panel on top of the page's
// built-in wording. A page shows its own HTML untouched unless a value has
// been saved for a field; if the request fails, nothing changes.
// Usage: <script src="js/site-text.js" data-page="home"></script> (in <head>,
// after site-config.js and site-fields.js). Exposes window.siteContentReady,
// which the motion script waits on so it animates the final wording.
(function () {
  const pageId = document.currentScript.dataset.page;
  const page = (window.AMAZE_PAGES || []).find((p) => p.id === pageId);

  // ── value helpers, shared with the admin panel ─────────────────────────────
  const DECOR_BEFORE = 'i, svg';
  const DECOR_AFTER = '.btn-arrow, .aca-arrow, .hero-link > b';
  const ALLOWED = { EM: [], STRONG: [], B: [], I: [], BR: [], SPAN: ['class'], A: ['href', 'class', 'target', 'rel'] };

  // keeps only simple inline formatting; anything else becomes plain text
  function sanitize(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    (function walk(node) {
      [...node.childNodes].forEach((child) => {
        if (child.nodeType !== 1) return;
        walk(child);
        const allowed = ALLOWED[child.tagName];
        if (!allowed) { child.replaceWith(...child.childNodes); return; }
        [...child.attributes].forEach((a) => { if (!allowed.includes(a.name)) child.removeAttribute(a.name); });
        if (child.tagName === 'A' && /^\s*(javascript|data|vbscript):/i.test(child.getAttribute('href') || '')) child.removeAttribute('href');
      });
    })(tpl.content);
    return tpl.innerHTML;
  }

  function read(el, type) {
    if (!el) return '';
    if (type === 'visible') return el.hasAttribute('hidden') ? '0' : '1';
    if (type === 'href') return el.getAttribute('href') || '';
    if (type === 'src') return el.getAttribute('src') || '';
    if (type === 'pre') return el.textContent;   // exactly as written, nothing collapsed
    if (type === 'html') return el.innerHTML.trim().replace(/\s+/g, ' ');
    const copy = el.cloneNode(true);
    copy.querySelectorAll(`${DECOR_BEFORE}, .btn-arrow, .aca-arrow`).forEach((n) => n.remove());
    if (el.matches('.hero-link')) copy.querySelectorAll('b').forEach((n) => n.remove());
    return copy.textContent.trim().replace(/\s+/g, ' ');
  }

  function write(el, type, value) {
    if (!el) return;
    if (type === 'visible') { el.hidden = value === '0'; return; }
    if (type === 'pre') {   // plain text, kept character for character; the page then sets it out
      el.textContent = value;
      el.dispatchEvent(new CustomEvent('amaze:text', { bubbles: true }));
      return;
    }
    if (type === 'href') {
      // an edited link may be a web, mail or phone link, or a path on this site — never script
      const u = String(value).trim();
      if (!/^[a-z][a-z0-9+.-]*:/i.test(u) || /^(https?:|mailto:|tel:)/i.test(u)) el.setAttribute('href', u);
      return;
    }
    if (type === 'src') { el.setAttribute('src', value); return; }
    if (type === 'html') { el.innerHTML = sanitize(value); return; }
    if (type === 'stat') {
      // "25+" → a counting number followed by its suffix; "∞" stays as text
      const m = /^(\d+)(.*)$/.exec(value.trim());
      el.textContent = '';
      if (!m) { el.textContent = value; return; }
      const n = document.createElement('span');
      n.setAttribute('data-count', '');
      n.textContent = m[1];
      el.append(n, m[2]);
      return;
    }
    const before = [...el.children].filter((c) => c.matches(DECOR_BEFORE));
    const after = [...el.children].filter((c) => c.matches(DECOR_AFTER));
    el.replaceChildren(...before, document.createTextNode(value + (after.length ? ' ' : '')), ...after);
  }

  window.AMAZE_text = { read, write, sanitize };
  if (!page || !window.AMAZE) { window.siteContentReady = Promise.resolve(); return; }

  const parsed = new Promise((res) => {
    if (document.readyState !== 'loading') return res();
    document.addEventListener('readystatechange', () => res(), { once: true });
  });
  const saved = window.AMAZE.get(`site_text?select=key,value&key=like.${page.id}.*`).catch(() => []);

  const apply = Promise.all([saved, parsed]).then(([rows]) => {
    if (!rows.length) return;
    const values = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    window.AMAZE_resolveFields(page, document).forEach((f) => {
      if (f.key in values) write(f.el, f.type, values[f.key]);
    });
  }).catch(() => {});

  // never hold the page up for long: after 1.8s it carries on with built-in text
  window.siteContentReady = Promise.race([apply, new Promise((r) => setTimeout(r, 1800))]);
})();
