// ── OUR JOURNEY ─────────────────────────────────────────────────────────────
// Draws the "our journey" timeline from the milestones kept in the admin panel
// (table: journey). It reads from top to bottom: one spine down the middle, a
// station for every year in which something happened (quiet years are left out,
// so 2021 runs straight on to 2023), and each milestone branching off to the left
// or the right as it scrolls into view. The spine fills in as the reader goes
// down; this year is marked live, and past it the spine turns dashed into the
// years still to come. A new row in the admin panel is a new branch on the line.
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

  const line = $('#journey-line'), track = $('#journey-track'), filter = $('#journey-filter'), yearList = $('#journey-years');
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
    // only the years in which something happened, and always this one: the line is live here
    if (!byYear.has(NOW)) byYear.set(NOW, []);
    const years = [...byYear.keys()].sort((a, b) => a - b);
    const last = years[years.length - 1];

    let n = 0;
    const item = (r) => {
      const side = n++ % 2 ? 'right' : 'left', kind = KIND[r.kind] ? r.kind : 'milestone', link = safeLink(r.link);
      return `<li class="jr-item jr-item--${side}" data-kind="${kind}">
          <span class="jr-node" aria-hidden="true"></span><span class="jr-stem" aria-hidden="true"></span>
          ${r.month ? `<span class="jr-when" aria-hidden="true">${MONTH[r.month - 1]}</span>` : ''}
          <article class="jr-card">
            <small>${KIND[kind]}${r.month ? `<b>${MONTH[r.month - 1]} ${r.year}</b>` : ''}${r.year > NOW ? '<em class="jr-soon">coming up</em>' : ''}</small>
            <h3>${esc(r.title)}</h3>
            ${r.body ? `<p>${esc(r.body)}</p>` : ''}
            ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">read more <span aria-hidden="true">↗</span></a>` : ''}
          </article>
        </li>`;
    };
    let html = '<span class="jr-rail" aria-hidden="true"><i class="jr-fill"></i></span><ol class="jr-years">';
    years.forEach((y) => {
      const here = byYear.get(y), today = y === NOW;
      // a year still to come with something already planned sits on the dashed part of the line
      html += `<li class="jr-year${today ? ' jr-today' : ''}${y > NOW ? ' jr-ahead' : ''}" data-year="${y}">
          <span class="jr-big" aria-hidden="true"><b>${y}</b></span>
          <div class="jr-head"><span class="jr-num">${y}</span>${here.length ? `<small class="jr-count">${here.length} ${here.length === 1 ? 'milestone' : 'milestones'}</small>` : ''}</div>
          ${here.length ? `<ul class="jr-items">${here.map(item).join('')}</ul>` : ''}
          ${today ? '<div class="jr-now"></div>' : ''}
        </li>`;
    });
    // the years that have not happened yet
    html += `<li class="jr-year jr-future" aria-hidden="true"><div class="jr-head"><span class="jr-num">${last + 1}</span></div></li>`;
    html += `<li class="jr-year jr-future jr-future--far" aria-hidden="true"><div class="jr-head"><span class="jr-num">${last + 2}</span></div></li></ol>`;
    track.innerHTML = html;
    const nowSrc = $('#journey-now');
    if (nowSrc) { const box = $('.jr-now', track); [...nowSrc.childNodes].forEach((c) => box.appendChild(c)); nowSrc.remove(); }

    // ── year by year: the same story as a list, for reading at leisure ──
    if (yearList) {
      const desc = (r) => { const kind = KIND[r.kind] ? r.kind : 'milestone', link = safeLink(r.link); return `<li data-kind="${kind}"><small>${KIND[kind]}${r.month ? ` · ${MONTH[r.month - 1]}` : ''}</small><h3>${esc(r.title)}</h3>${r.body ? `<p>${esc(r.body)}</p>` : ''}${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">read more ↗</a>` : ''}</li>`; };
      const nowTitle = ($('.jr-now-title', track) || {}).textContent || 'the line keeps going.';
      const nowSub = ($('.jr-now-sub', track) || {}).textContent || '';
      yearList.innerHTML = years.filter((y) => byYear.get(y).length).map((y) => `<div class="jy-year reveal" data-year="${y}"><div class="jy-num">${y}</div><ul class="jy-items">${byYear.get(y).map(desc).join('')}</ul></div>`).join('')
        + `<div class="jy-year jy-year--now reveal"><div class="jy-num">next<span>after ${NOW}</span></div><div class="jy-items jy-next"><h3>${esc(nowTitle)}</h3>${nowSub ? `<p>${esc(nowSub)}</p>` : ''}</div></div>`;
      $$('.reveal', yearList).forEach((el) => {
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
        if (b.dataset.only === 'all') line.removeAttribute('data-only'); else line.dataset.only = b.dataset.only;
      });
    }

    motion();
  }

  // ── movement ──
  function motion() {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const groups = $$('.jr-year:not(.jr-future)', track), items = $$('.jr-item', track), fill = $('.jr-fill', track), rail = $('.jr-rail', track);
    // the solid spine ends with this year; below it the years to come are dashed
    const today = $('.jr-today', track);
    const endRail = () => { if (today) track.style.setProperty('--rail-end', `${Math.max(0, track.offsetHeight - (today.offsetTop + today.offsetHeight))}px`); };
    endRail();
    if ('ResizeObserver' in window) new ResizeObserver(endRail).observe(track);
    if (reduce || !('IntersectionObserver' in window)) {
      items.forEach((i) => i.classList.add('is-in'));
      groups.forEach((g) => g.classList.add('is-reached'));
      return;
    }
    line.classList.add('is-moving');
    // each milestone branches out as it comes up the screen. everything above the point reached is
    // shown too, so a jump down the page (a link, the End key, a reload half way) leaves nothing hidden
    const catchUp = () => items.forEach((i) => { if (!i.classList.contains('is-in') && i.getBoundingClientRect().top < innerHeight * 0.86) { i.classList.add('is-in'); pop.unobserve(i); } });
    const pop = new IntersectionObserver((es) => { es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); pop.unobserve(e.target); } }); catchUp(); }, { rootMargin: '0px 0px -14% 0px', threshold: 0.2 });
    items.forEach((i) => pop.observe(i));
    groups.forEach((g) => new IntersectionObserver(catchUp).observe(g));
    catchUp();
    // the year at the middle of the screen is the one being read
    const reading = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      groups.forEach((g) => g.classList.toggle('is-active', g === e.target));
      e.target.classList.add('is-reached');
    }), { rootMargin: '-48% 0px -48% 0px' });
    groups.forEach((g) => reading.observe(g));
    // the spine fills in with the scroll (smoothly, through the page's own scroll engine)
    const gsap = window.gsap, ST = window.ScrollTrigger;
    if (gsap && ST && fill) {
      gsap.registerPlugin(ST);
      gsap.fromTo(fill, { scaleY: 0 }, { scaleY: 1, ease: 'none', scrollTrigger: { trigger: rail, start: 'top 60%', end: 'bottom 60%', scrub: 0.6, invalidateOnRefresh: true } });
      ST.refresh();
    } else if (fill) fill.style.transform = 'none';
  }
})();
