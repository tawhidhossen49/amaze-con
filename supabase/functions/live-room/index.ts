// ── LIVE CLASS ROOM ─────────────────────────────────────────────────────────
// Lets someone into the video room of a live class — but only if they are
// allowed to be there. The website calls this when "enter the live class" is
// pressed on a live-class lesson; it answers with the room's address and a
// one-person pass for it.
//
// The rooms themselves are provided by Daily (daily.co): video, audio, screen
// share, chat and raised hands, shown inside the lesson page. This function is
// the only place that knows the Daily key, so the key never reaches a browser.
//
// Who gets in:
//   an admin        — any time, as the host (can mute or remove people, share the screen)
//   a learner       — only if the entry is open to them (it is free, or their payment was
//                     confirmed), and only from 15 minutes before the class until it is over
//   anyone else     — refused
//
// Needs one secret in Supabase → Edge Functions → Secrets:  DAILY_API_KEY
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const answer = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const OPENS_BEFORE_MIN = 15;   // learners can come in this long before the start
const STAYS_AFTER_MIN = 30;    // …and the room stays open this long after the planned end
const DAILY = "https://api.daily.co/v1";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return answer({ error: "method", message: "use POST" }, 405);

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const { lesson_id } = await req.json().catch(() => ({}));
    if (!lesson_id || typeof lesson_id !== "string") return answer({ error: "bad_request", message: "which lesson?" }, 400);

    // everything below is asked of the database AS THE PERSON CALLING, so its own rules decide
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const { data: who } = await db.auth.getUser();
    const user = who?.user;
    if (!user) return answer({ error: "signed_out", message: "sign in to join the live class." }, 401);

    const { data: lesson } = await db.from("course_lessons")
      .select("id, course_id, title, kind, live_at, duration_min, is_hidden").eq("id", lesson_id).maybeSingle();
    if (!lesson || lesson.kind !== "live" || lesson.is_hidden) return answer({ error: "not_found", message: "that live class does not exist." }, 404);

    const { data: isAdmin } = await db.rpc("is_admin");
    const host = isAdmin === true;

    if (!host) {
      const { data: open } = await db.rpc("course_open_to_me", { p_course: lesson.course_id });
      if (open !== true) return answer({ error: "not_enrolled", message: "this live class is for learners whose enrolment is confirmed." }, 403);
      if (!lesson.live_at) return answer({ error: "no_date", message: "the date of this class has not been set yet." }, 409);
      const start = new Date(lesson.live_at).getTime();
      const end = start + Math.max(15, lesson.duration_min || 60) * 60_000;
      const now = Date.now();
      if (now < start - OPENS_BEFORE_MIN * 60_000) return answer({ error: "too_early", message: `the room opens ${OPENS_BEFORE_MIN} minutes before the class starts.`, opens_at: new Date(start - OPENS_BEFORE_MIN * 60_000).toISOString() }, 409);
      if (now > end + STAYS_AFTER_MIN * 60_000) return answer({ error: "ended", message: "this class has ended." }, 409);
    }

    const key = Deno.env.get("DAILY_API_KEY");
    if (!key) return answer({ error: "not_configured", message: "live rooms are not switched on yet." }, 503);
    const daily = (path: string, init: RequestInit = {}) =>
      fetch(DAILY + path, { ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" } });

    // one private room per live class, made the first time anyone is let in
    const name = "class-" + lesson.id;
    let room = await daily(`/rooms/${name}`).then((r) => (r.ok ? r.json() : null));
    if (!room) {
      const made = await daily("/rooms", {
        method: "POST",
        body: JSON.stringify({
          name, privacy: "private",
          properties: {
            enable_prejoin_ui: true,      // a camera and microphone check before going in
            enable_chat: true, enable_screenshare: true, enable_people_ui: true,
            enable_hand_raising: true, enable_network_ui: true,
            start_audio_off: true, start_video_off: true,
          },
        }),
      });
      room = made.ok ? await made.json() : await daily(`/rooms/${name}`).then((r) => (r.ok ? r.json() : null));   // (someone else may have just made it)
      if (!room) return answer({ error: "room", message: "the room could not be opened. try again in a moment." }, 502);
    }

    // the pass: good for this room and this person only, and it runs out
    const meta = (user.user_metadata ?? {}) as Record<string, string>;
    const display = String(meta.full_name || meta.name || (user.email ?? "").split("@")[0] || "learner").slice(0, 60);
    const until = lesson.live_at
      ? Math.max(Date.now() + 60 * 60_000, new Date(lesson.live_at).getTime() + (Math.max(15, lesson.duration_min || 60) + STAYS_AFTER_MIN) * 60_000)
      : Date.now() + 3 * 60 * 60_000;
    const pass = await daily("/meeting-tokens", {
      method: "POST",
      body: JSON.stringify({
        properties: {
          room_name: name,
          user_id: user.id,
          user_name: host ? `${display} (teacher)` : display,
          is_owner: host,
          exp: Math.floor(until / 1000),
          eject_at_token_exp: true,
          enable_screenshare: host,          // the teacher shares their screen; learners talk, show video, chat and raise a hand
          start_audio_off: true,
          start_video_off: !host,
          enable_prejoin_ui: true,
        },
      }),
    });
    if (!pass.ok) return answer({ error: "pass", message: "the room is there but you could not be let in. try again in a moment." }, 502);
    const { token } = await pass.json();

    return answer({ url: room.url, token, host, name: display });
  } catch (e) {
    return answer({ error: "server", message: "something went wrong opening the room." }, 500);
  }
});
