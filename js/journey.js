// ── OUR JOURNEY ─────────────────────────────────────────────────────────────
// Draws the "our journey" page from the milestones kept in the admin panel
// (table: journey). Every year from the first milestone to today gets a slot on
// the line, empty years included, so the reader feels the time pass; the line
// then runs on past today. A new row in the admin panel is a new point on the
// line, the year list and the counts at the top: nothing here needs changing.
//
// On a wide screen with motion allowed, the line is pinned and scrolls sideways
// as the page is scrolled. Otherwise it is a sideways strip you can swipe
// (or, on a phone, a list that runs down the page).
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KIND = { milestone: 'milestone', partnership: 'partnership', subsidiary: 'new subsidiary', program: 'program', recognition: 'recognition', launch: 'launch' };
  const MANY = { milestone: 'milestones', partnership: 'partnerships', subsidiary: 'subsidiaries', program: 'programs', recognition: 'recognition', launch: 'launches' };
  const MONTH = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const NOW = new Date().getFullYear();
  const safeLink = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');

  const line = $('#journey-line'), track = $('#journey-track'), years = $('#journey-years'), filter = $('#journey-filter');
  if (!line || !track) return;

  const parsed = new Promise((res) => (document.readyState !== 'loading' ? res() : document.addEventListener('DOMContentLoaded', res, { once: true })));
  const rows = window.AMAZE && window.AMAZE.get
    ? window.AMAZE.get('journey?select=id,year,month,title,body,kind,link&year=not.is.null&order=year.asc,month.asc.nullsfirst,sort_order.asc,created_at.asc').catch(() => null)
    : Promise.resolve(null);

  Promise.all([rows, window.siteContentReady || Promise.resolve(), parsed]).then(([list]) => {
    if (!Array.isArray(list)) { track.innerHTML = '<p class="jr-loading">the timeline could not be loaded just now. refresh the page to try again.</p>'; return; }
    draw(list.filter((r) => r && r.year && r.title));
  });

  function draw(list) {
    const byYear = new Map();
    list.forEach((r) => { if (!byYear.has(r.year)) byYear.set(r.year, []); byYear.get(r.year).push(r); });
    const first = list.length ? list[0].year : NOW;
    const last = Math.max(NOW, list.length ? list[list.length - 1].year : NOW);

    // the numbers at the top of the page
    const put = (k, v) => { const el = $(`[data-journey="${k}"]`); if (el) el.textContent = v; };
    put('since', first);
    put('count', list.length);
    put('partners', list.filter((r) => r.kind === 'partnership').length);

    // ── the line ──
    let n = 0;
    const item = (r) => {
      const side = n++ % 2 ? 'down' : 'up', kind = KIND[r.kind] ? r.kind : 'milestone', link = safeLink(r.link);
      return `<li class="jr-item jr-item--${side}" data-kind="${kind}">
          <span class="jr-node" aria-hidden="true"></span><span class="jr-stem" aria-hidden="true"></span>
          <div class="jr-card">
            <small>${KIND[kind]}${r.month ? ` <b>${MONTH[r.month - 1]} ${r.year}</b>` : ''}</small>
            <h3>${esc(r.title)}</h3>
            ${r.body ? `<p>${esc(r.body)}</p>` : ''}
            ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">read more <span aria-hidden="true">↗</span></a>` : ''}
          </div>
        </li>`;
    };
    let html = '<span class="jr-rail" aria-hidden="true"><i class="jr-fill"></i></span><ol class="jr-years">';
    for (let y = first; y <= last; y++) {
      const here = byYear.get(y) || [], today = y === NOW;
      // this year is the live end of the line: its milestones, then the open end
      html += `<li class="jr-year${here.length || today ? '' : ' is-quiet'}${today ? ' jr-today' : ''}" data-year="${y}">
          <span class="jr-num${today ? ' jr-num--now' : ''}">${y}</span>${today ? '<span class="jr-pulse" aria-hidden="true"></span>' : ''}
          ${here.length ? `<ul class="jr-items">${here.map(item).join('')}</ul>` : ''}
          ${today ? '<div class="jr-now"></div>' : ''}
        </li>`;
    }
    // the years that have not happened yet
    html += `<li class="jr-year jr-future" aria-hidden="true"><span class="jr-num">${last + 1}</span></li><li class="jr-year jr-future jr-future--far" aria-hidden="true"><span class="jr-num">${last + 2}</span></li></ol>`;
    track.innerHTML = html;
    const nowSrc = $('#journey-now');
    if (nowSrc) { const box = $('.jr-now', track); [...nowSrc.childNodes].forEach((c) => box.appendChild(c)); nowSrc.remove(); }
    line.classList.toggle('is-empty', !list.length);

    // ── year by year ──
    if (years) {
      const desc = (r) => { const kind = KIND[r.kind] ? r.kind : 'milestone', link = safeLink(r.link); return `<li data-kind="${kind}"><small>${KIND[kind]}${r.month ? ` · ${MONTH[r.month - 1]}` : ''}</small><h3>${esc(r.title)}</h3>${r.body ? `<p>${esc(r.body)}</p>` : ''}${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">read more ↗</a>` : ''}</li>`; };
      const nowTitle = ($('.jr-now-title', track) || {}).textContent || 'the line keeps going.';
      const nowSub = ($('.jr-now-sub', track) || {}).textContent || '';
      years.innerHTML = [...byYear.keys()].map((y) => `<div class="jy-year reveal" data-year="${y}"><div class="jy-num">${y}</div><ul class="jy-items">${byYear.get(y).map(desc).join('')}</ul></div>`).join('')
        + `<div class="jy-year jy-year--now reveal"><div class="jy-num">next<span>after ${NOW}</span></div><div class="jy-items jy-next"><h3>${esc(nowTitle)}</h3>${nowSub ? `<p>${esc(nowSub)}</p>` : ''}</div></div>`;
      $$('.reveal', years).forEach((el) => {
        if (!('IntersectionObserver' in window)) return el.classList.add('visible');
        new IntersectionObserver((es, ob) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('visible'); ob.disconnect(); } }), { threshold: 0.1 }).observe(el);
      });
    }

    // ── show one kind at a time ──
    const kinds = Object.keys(KIND).filter((k) => list.some((r) => r.kind === k));
    if (filter && kinds.length > 1) {
      filter.innerHTML = [['all', 'everything']].concat(kinds.map((k) => [k, MANY[k]])).map(([k, t]) => `<button type="button" class="jr-chip${k === 'all' ? ' is-on' : ''}" data-only="${k}" aria-pressed="${k === 'all'}">${t}<span>${k === 'all' ? list.length : list.filter((r) => r.kind === k).length}</span></button>`).join('');
      filter.hidden = false;
      filter.addEventListener('click', (e) => {
        const b = e.target.closest('[data-only]'); if (!b) return;
        $$('.jr-chip', filter).forEach((x) => { const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', String(on)); });
        [line, years].forEach((el) => { if (el) { if (b.dataset.only === 'all') el.removeAttribute('data-only'); else el.dataset.only = b.dataset.only; } });
      });
    }

    motion();
  }

  // ── movement ──
  function motion() {
    const stage = $('.jr-stage', line), ghost = $('.jr-ghost', line), fill = $('.jr-fill', track);
    const slots = $$('.jr-year:not(.jr-future)', track);
    let active = null;
    const mark = (y) => {
      if (y === active) return;
      active = y;
      slots.forEach((s) => s.classList.toggle('is-active', s.dataset.year === String(y)));
      if (ghost) { ghost.classList.remove('is-in'); void ghost.offsetWidth; ghost.textContent = y; ghost.classList.add('is-in'); }
    };
    // measured on screen: where something is, from the left edge of the strip
    const leftOf = (el) => el.getBoundingClientRect().left - stage.getBoundingClientRect().left;
    // the year whose slot has reached the middle of the screen
    const yearAt = () => {
      let y = slots.length ? slots[0].dataset.year : '';
      slots.forEach((s) => { if (leftOf(s) <= stage.clientWidth * 0.4) y = s.dataset.year; });
      return y;
    };
    // the solid line ends at today; past it the years to come are dashed
    const today = $('.jr-today', track);
    const endRail = () => { if (today) track.style.setProperty('--rail-end', `${Math.max(0, track.scrollWidth - (today.offsetLeft + today.offsetWidth) - (today.offsetParent === track ? 0 : today.offsetParent.offsetLeft))}px`); };
    endRail();
    const wide = window.matchMedia('(min-width: 901px)').matches;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const gsap = window.gsap, ST = window.ScrollTrigger;
    const distance = () => Math.max(0, track.scrollWidth - stage.clientWidth);

    if (wide && !reduce && gsap && ST && distance() > 40) {
      // pinned: scrolling down moves the line sideways
      gsap.registerPlugin(ST);
      line.classList.add('is-pinned');
      // each milestone rises into place once it reaches the screen
      const items = $$('.jr-item', track);
      const reveal = () => items.forEach((it) => { if (!it.classList.contains('is-in') && leftOf(it) < stage.clientWidth * 0.9) it.classList.add('is-in'); });
      // everything that depends on where the line is follows the (smoothed) movement itself
      const follow = function () { if (fill) fill.style.transform = `scaleX(${this.progress()})`; mark(yearAt()); reveal(); };
      gsap.to(track, {
        x: () => -distance(), ease: 'none', onUpdate: follow,
        scrollTrigger: { trigger: line, start: 'top top', end: () => `+=${distance()}`, pin: true, scrub: 0.8, anticipatePin: 1, invalidateOnRefresh: true, onRefresh: endRail },
      });
      ST.refresh();
      mark(yearAt());
      reveal();
      return;
    }
    // not pinned: a strip to swipe (wide screens) or a list down the page (phones)
    if (wide) {
      const sync = () => { if (fill) fill.style.transform = `scaleX(${distance() ? stage.scrollLeft / distance() : 1})`; mark(yearAt()); };
      stage.addEventListener('scroll', sync, { passive: true });
      sync();
    } else if (fill) fill.style.transform = 'none';
  }
})();
