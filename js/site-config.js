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
