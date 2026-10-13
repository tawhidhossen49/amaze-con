// Website statistics — counts only, nothing about the person.
//
// What is counted, and how often:
//   every page opened ............ the page                                   (view)
//   once per visit ............... a visit, where it came from, the first page (visit, ref, entry),
//                                  phone / tablet / computer, the browser      (device, browser)
//   once a day per browser ....... a visitor, the country, new or returning    (visitor, country, new)
//   every press of a button/link . its words and the page it is on             (click)
//
// No cookie is set, no ip address or name is sent, and nobody is followed from page to page:
// the database only adds one to a count (see seed/website-backend-12-site-stats.sql).
// The admin panel is never counted, and neither is a browser that has opened it.
(function () {
  'use strict';
  var A = window.AMAZE || {};
  var URL_ = A.url || 'https://muaxisgstxpoyfhzdgcm.supabase.co', KEY = A.key || 'sb_publishable_TD7rs8S7wF9a6-PmzMH-YA_vd0N0mSx';
  var TEST = Array.isArray(window.__track);   // the automatic checks collect what would be sent instead of sending it
  var store = function (box, k, v) { try { if (v === undefined) return box.getItem(k); box.setItem(k, v); } catch (e) {} return null; };

  var path = location.pathname.replace(/\/index\.html$/i, '/').replace(/\.html$/i, '').toLowerCase();
  if (/^\/admin(\/|$)/.test(path)) { store(localStorage, 'amaze.notrack', '1'); return; }
  if (store(localStorage, 'amaze.notrack') === '1' && !TEST) return;
  if (!TEST && (/^(localhost|127\.|192\.168\.|10\.|\[::1\])/.test(location.hostname) || location.protocol === 'file:' || navigator.webdriver)) return;
  if (!TEST && /bot|crawl|spider|slurp|preview|lighthouse|headless|pingdom|monitor/i.test(navigator.userAgent || '')) return;

  // one name per page: a lesson or a certificate is the same page whichever one is open
  var page = path.replace(/\/+$/, '') || '/';
  page = page.replace(/^(\/academy\/[^/]+\/learn)\/.+$/, '$1').replace(/^\/academy\/certificate\/.+$/, '/academy/certificate').slice(0, 90);
  if (document.title && /page not found|404/i.test(document.title)) page = '(page not found)';

  var queue = [], timer = 0, country = '';
  function flush() {
    clearTimeout(timer); timer = 0;
    if (!queue.length) return;
    var events = queue.splice(0, 12), body = JSON.stringify({ p_events: events, p_country: country });
    if (TEST) { window.__track.push.apply(window.__track, events); if (queue.length) flush(); return; }
    try {
      fetch(URL_ + '/rest/v1/rpc/site_seen', { method: 'POST', keepalive: true, headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: body }).catch(function () {});
    } catch (e) {}
    if (queue.length) flush();
  }
  function count(k, v) { queue.push({ k: k, v: v || '' }); if (!timer) timer = setTimeout(flush, 1500); }

  // ── this page ──
  count('view', page);

  // ── this visit (a tab that was opened, until it is closed) ──
  if (!store(sessionStorage, 'amaze.visit')) {
    store(sessionStorage, 'amaze.visit', '1');
    count('visit');
    count('entry', page);
    var from = 'came directly';
    try {
      var tag = new URLSearchParams(location.search).get('utm_source');
      var host = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : '';
      if (tag) from = tag.toLowerCase().slice(0, 40);
      else if (host && host !== location.hostname.replace(/^www\./, '')) from = host.replace(/^(l|lm|m|web)\.facebook\.com$/, 'facebook.com').replace(/^([a-z]+\.)?google\.[a-z.]+$/, 'google').replace(/^t\.co$/, 'x (twitter)').replace(/^(out\.|old\.)?reddit\.com$/, 'reddit.com');
    } catch (e) {}
    count('ref', from);
    var ua = navigator.userAgent || '', wide = Math.min(screen.width || 0, screen.height || 0);
    count('device', /ipad|tablet/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua)) || (navigator.maxTouchPoints > 1 && /macintosh/i.test(ua)) ? 'tablet' : /mobi|iphone|android/i.test(ua) || (wide && wide < 500) ? 'phone' : 'computer');
    count('browser', /FBAN|FBAV|FB_IAB/i.test(ua) ? 'facebook app' : /Instagram/i.test(ua) ? 'instagram app' : /Edg\//.test(ua) ? 'edge' : /OPR\/|Opera/.test(ua) ? 'opera' : /SamsungBrowser/.test(ua) ? 'samsung internet' : /Firefox\/|FxiOS/.test(ua) ? 'firefox' : /Chrome\/|CriOS/.test(ua) ? 'chrome' : /Safari\//.test(ua) ? 'safari' : 'another browser');
  }

  // ── this visitor, once a day ──
  var now = new Date(), today = now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate();
  if (store(localStorage, 'amaze.day') !== today) {
    var known = !!store(localStorage, 'amaze.day');
    store(localStorage, 'amaze.day', today);
    count('visitor');
    count('new', known ? 'returning' : 'new');
    // the country: asked of our own host (it knows it from the network, nothing is looked up about the person)
    clearTimeout(timer); timer = 0;
    var go = function (cc) { country = /^[A-Za-z]{2}$/.test(cc || '') ? cc.toUpperCase() : ''; count('country', country); };
    if (TEST) go('BD');
    else {
      var done = false, once = function (cc) { if (!done) { done = true; go(cc); } };
      setTimeout(function () { once(''); }, 2500);
      try { fetch('/api/geo', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : {}; }).then(function (j) { once(j && j.country); }, function () { once(''); }); } catch (e) { once(''); }
    }
  }

  // ── buttons and links people press ──
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('a, button, [role="button"], summary, input[type="submit"]');
    if (!el || el.closest('[data-notrack]')) return;
    var words = (el.getAttribute('data-track') || el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!words && el.querySelector && el.querySelector('img[alt]')) words = el.querySelector('img[alt]').alt.trim().toLowerCase();
    // words written by a visitor or a name (a comment, an account) are not button names
    if (!words || el.closest('.comment, .thread, [data-private]')) return;
    if (el.id === 'lms-account' || el.closest('#lms-account, .nav-signin.is-in')) words = 'my account';
    count('click', words.slice(0, 60) + '  ·  ' + page);
  }, true);

  // nothing is lost when the page is left
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });
})();
