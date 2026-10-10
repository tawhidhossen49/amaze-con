// ── SITE BACKEND ────────────────────────────────────────────────────────────
// The website's own Supabase project ("Amaze-con"). This is the project's
// PUBLISHABLE key: it is designed to be shipped to the browser. What it is
// allowed to do is decided by Row Level Security in the database
// (seed/website-backend.sql) — anyone can read published content, only
// signed-in admins can change it — not by hiding this string.
window.AMAZE = {
  url: 'https://muaxisgstxpoyfhzdgcm.supabase.co',
  key: 'sb_publishable_TD7rs8S7wF9a6-PmzMH-YA_vd0N0mSx',
  // absolute URL of the site root, worked out from where this file was loaded
  root: (document.currentScript ? document.currentScript.src : location.href).replace(/js\/site-config\.js.*$/, ''),
};

// Plain REST read, used by pages that don't need accounts.
window.AMAZE.get = async function (path) {
  const res = await fetch(`${window.AMAZE.url}/rest/v1/${path}`, {
    headers: { apikey: window.AMAZE.key, Authorization: `Bearer ${window.AMAZE.key}` },
  });
  if (!res.ok) throw new Error('request failed: ' + res.status);
  return res.json();
};

// ── "sign in" in the nav remembers you ──────────────────────────────────────
// Signing in happens on the academy pages, and the browser keeps that session.
// The other pages (home, structure, the legal pages…) don't load the account
// code, so here they simply look for the kept session and, if there is one,
// show the person's first name where "sign in" would be. The link goes to "my
// learning" either way; that page checks the session properly.
(function () {
  function who() {
    try {
      const ref = new URL(window.AMAZE.url).hostname.split('.')[0];
      const kept = JSON.parse(localStorage.getItem('sb-' + ref + '-auth-token') || 'null');
      const user = kept && kept.refresh_token && kept.user;
      if (!user) return '';
      const meta = user.user_metadata || {};
      return String(meta.full_name || meta.name || user.email || '').trim().split(/[\s@]/)[0].toLowerCase().slice(0, 18) || 'account';
    } catch (e) { return ''; }
  }
  function show() {
    const name = who();
    document.querySelectorAll('a.nav-signin').forEach(function (a) {
      a.textContent = name || 'sign in';
      a.title = name ? 'signed in — open my learning' : '';
    });
    // on the academy pages the account button is filled in properly once the data has loaded;
    // until then it shows the name too, instead of "sign in" for a second
    const account = document.getElementById('lms-account');
    if (account && name && account.textContent.trim() === 'sign in') account.textContent = name;
    document.querySelectorAll('.mobile-nav a[href$="academy/my.html"]').forEach(function (a) {
      a.textContent = name ? 'my learning — ' + name : 'sign in / my learning';
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
  // the nav is near the top of the page: fill it in as soon as it exists, rather than
  // waiting for every script further down to arrive
  (function early() {
    if (document.querySelector('a.nav-signin, #lms-account')) show();
    else if (document.readyState === 'loading') requestAnimationFrame(early);
  })();
  // signing in or out in another tab shows up here without a reload
  window.addEventListener('storage', function (e) { if (e.key && /^sb-.*-auth-token$/.test(e.key)) show(); });
  window.addEventListener('pageshow', show);
})();
