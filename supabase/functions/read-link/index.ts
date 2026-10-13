// read-link — reads a course on another website, so an admin only has to paste its link.
//
//   POST { url }   →   { title, about, image, price, was, free, duration, by }
//
// Only an admin who may change courses can ask. The page is fetched here, on the server,
// because a browser is not allowed to read another website's pages.
//
// Two ways of reading, the best one that works wins:
//   1. a sister website built like ours (its page loads js/supabase-config.js and keeps its
//      courses in a public list called courses_safe): the course is read from that list
//   2. any other website: the title, sentence and picture it gives for sharing (open graph)
//
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const answer = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MAX_BYTES = 700_000, WAIT_MS = 8000;

// only ordinary public websites: no addresses made of numbers, nothing inside a private network
function publicAddress(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password || (u.port && u.port !== "443" && u.port !== "80")) return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h.includes(":") || /^[0-9.]+$/.test(h)) return null;
  if (/(^|\.)(localhost|local|internal|lan|home|corp|test|invalid|example)$/.test(h)) return null;
  return u;
}

async function fetchText(u: URL, headers: Record<string, string> = {}): Promise<string> {
  let at = u;
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(at, { headers: { "User-Agent": "amaze-academy link reader", Accept: "text/html,application/json,*/*", ...headers }, redirect: "manual", signal: AbortSignal.timeout(WAIT_MS) });
    if (res.status >= 300 && res.status < 400) {
      const next = publicAddress(new URL(res.headers.get("location") ?? "", at).href);
      await res.body?.cancel();
      if (!next) throw new Error("redirect");
      at = next; continue;
    }
    if (!res.ok) { await res.body?.cancel(); throw new Error("status " + res.status); }
    const reader = res.body!.getReader(), parts: Uint8Array[] = [];
    let size = 0;
    while (size < MAX_BYTES) { const { done, value } = await reader.read(); if (done) break; parts.push(value); size += value.length; }
    await reader.cancel().catch(() => {});
    const all = new Uint8Array(size); let o = 0;
    for (const p of parts) { all.set(p.subarray(0, Math.min(p.length, size - o)), o); o += p.length; }
    return new TextDecoder().decode(all);
  }
  throw new Error("redirects");
}

const unescape = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const tidy = (s: unknown, max: number) => unescape(String(s ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim().slice(0, max);
function meta(html: string, ...names: string[]): string {
  for (const name of names) {
    for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
      const key = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
      const value = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
      if (key === name && value) { const v = tidy(value[1] ?? value[2], 2000); if (v) return v; }
    }
  }
  return "";
}
const money = (x: unknown) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? String(n) : ""; };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return answer({ error: "method", message: "use POST" }, 405);
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false },
    });
    const { data: who } = await db.auth.getUser();
    if (!who?.user) return answer({ error: "signed_out", message: "sign in first." }, 401);
    const { data: may } = await db.rpc("admin_can", { p_area: "courses" });
    if (may !== true) return answer({ error: "not_allowed", message: "only an admin who looks after courses can do this." }, 403);

    const { url } = await req.json().catch(() => ({}));
    const page = typeof url === "string" ? publicAddress(url.trim()) : null;
    if (!page) return answer({ error: "bad_link", message: "that is not a link to a website." }, 400);

    let html = "";
    try { html = await fetchText(page); } catch { return answer({ error: "unreachable", message: "that page could not be opened." }, 200); }

    // 2. what any website says about its page
    const pageTitle = tidy(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1], 200);
    const out = {
      title: meta(html, "og:title", "twitter:title"),
      about: meta(html, "og:description", "twitter:description"),
      image: meta(html, "og:image", "og:image:url", "twitter:image"),
      price: money(meta(html, "product:price:amount", "og:price:amount")), was: "", free: false, duration: "",
      by: meta(html, "og:site_name"),
      from: "page",
    };
    // "course name — site name": the last part is whose it is
    const cut = pageTitle.split(/\s+[—–|·-]\s+/);
    if (!out.by && cut.length > 1 && cut[cut.length - 1].length <= 40) out.by = cut[cut.length - 1];
    if (out.image) { try { out.image = new URL(out.image, page).href; } catch { out.image = ""; } }

    // 1. a sister website: read the course from its own public list
    const config = /<script\b[^>]*\bsrc\s*=\s*["']([^"']*supabase-config\.js[^"']*)["']/i.exec(html)?.[1];
    const slug = (page.searchParams.get("id") || page.searchParams.get("c") || page.searchParams.get("course") || page.pathname.split("/").filter(Boolean).pop() || "").replace(/\.html?$/i, "");
    if (config && /^[a-z0-9][a-z0-9_-]{0,150}$/i.test(slug)) {
      try {
        const at = publicAddress(new URL(config, page).href);
        const js = at && at.hostname === page.hostname ? await fetchText(at) : "";
        const base = /https:\/\/[a-z0-9]{10,40}\.supabase\.co/.exec(js)?.[0];
        const key = /["'](eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_publishable_[A-Za-z0-9_-]+)["']/.exec(js)?.[1];
        if (base && key) {
          const rows = JSON.parse(await fetchText(new URL(`${base}/rest/v1/courses_safe?slug=eq.${encodeURIComponent(slug)}&select=*&limit=1`), { apikey: key, Authorization: `Bearer ${key}` }));
          const c = Array.isArray(rows) ? rows[0] : null;
          if (c) {
            const price = money(c.price_bdt), was = money(c.old_price_bdt);
            out.title = tidy(c.title_bn || c.title_en, 200) || out.title;
            out.about = tidy(c.description_bn || c.description_en, 2000) || out.about;
            out.image = typeof c.thumbnail_url === "string" && publicAddress(c.thumbnail_url) ? c.thumbnail_url : out.image;
            out.free = c.is_free === true;
            out.price = out.free ? "" : price;
            out.was = !out.free && price && was && Number(was) > Number(price) ? was : "";
            out.duration = tidy(c.duration_bn || c.duration_en, 60);
            out.from = "list";
          }
        }
      } catch { /* not built like ours after all: keep what the page itself said */ }
    }

    // a page that builds itself in the browser often only has a general title: that is not the course
    if (out.from === "page" && !out.title) return answer({ error: "nothing", message: "that page does not say enough about itself." }, 200);
    if (out.image && !publicAddress(out.image)) out.image = "";
    return answer(out);
  } catch (err) {
    return answer({ error: "server", message: String((err as Error)?.message ?? err) }, 500);
  }
});
