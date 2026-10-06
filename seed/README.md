# Seed folder — not for deployment

This folder holds `seed-members.js`, the one-time data used to originally
populate the `members` and `credits` tables in Supabase.

## ⚠ Switching login to Supabase Auth (email + password)

Members now log in with **email + password**, checked by Supabase Auth
itself, instead of a membership ID checked against a plaintext value in
the browser. Logins are created and managed **by hand** in the Supabase
dashboard — the app never creates, resets, or deletes an Auth account
itself, it only needs to know which email goes with which member.

**One-time setup:**

1. Run `migration-supabase-auth.sql` in the Supabase SQL editor. It just
   enforces that every member's email is unique. Idempotent.
2. Deploy the updated site.

**For every existing member**, in the Supabase dashboard go to
**Authentication → Users → Add user**, and create one with:
- **Email:** their existing email from the `members` table (check
  `seed/seed-members.js` or the table itself if you're not sure)
- **Password:** whatever you want their starting password to be
- Tick **Auto Confirm User** so they don't need to click a verification
  email

They can now log in with that email + password.

**For every new member going forward**, do it in this order:
1. Supabase dashboard → **Authentication → Users → Add user** — create
   their login first.
2. Portal → admin panel → **add member** — fill in the same email so the
   app can match their login to their roster row.

**Changing someone's email or password later** also happens in
**Authentication → Users** — find them, and use "Send password recovery"
or edit their email directly. If you change their email there, update it
to match in the admin panel too (**edit member**), or the two will fall
out of sync and they won't be able to log in.

**Removing a member** from the admin panel deletes their roster row, but
does **not** delete their Supabase Auth login — do that separately in
**Authentication → Users** if you want them fully locked out, otherwise
they can still sign in (just without any member data attached).

Two things worth knowing about this design:
- The **administrator** login (`ADMIN_ID` in `js/auth.js`) can now
  *also* use a real Supabase Auth account (see the `migration-site-content.sql`
  section below) — recommended, and required for admin to write to the
  new public-website content table — but still falls back to the old
  hardcoded `ADMIN_PWD` if that account hasn't been created, so nothing
  breaks if you skip it for now.
- Because there's no automation tying the two systems together, the
  admin panel can't stop you from adding a member whose email doesn't
  actually have a matching Auth account yet (or from letting the two
  drift apart later) — it's on whoever manages the roster to keep them
  matched.

## ⚠ Run this first: `migration-permissions-and-logs.sql`

The portal now supports delegated section permissions, an activity log,
credit-log attribution, and "excused means not counted" attendance. Those
need three small database changes. Open the Supabase dashboard for the
project the portal points at → **SQL Editor → New query**, paste the whole
of `migration-permissions-and-logs.sql`, and run it once. It is idempotent,
so running it twice is harmless.

It adds:

- `members.permissions` — the JSON array of sections a member may administer
- `credit_log.actor_id` / `credit_log.actor_name` — who applied each credit change
- the `activity_log` table — the audit trail behind the new activity log section
- a backfill that excuses every member from attendance events dated before
  they joined

Until it is run, the portal keeps working, but permissions cannot be saved,
the activity log stays empty, and new credit entries show "by —".
`schema.sql` already includes all of this for a fresh project.

## ⚠ Run this too: `migration-open-tasks.sql`

The portal now has an **open tasks** section — optional bounty-style tasks
any member can claim for credits, reviewed by the administrator, anyone
holding the global "tasks" permission, or the specific staff a task is
assigned to. This needs two new tables. Open the Supabase dashboard for
the project the portal points at → **SQL Editor → New query**, paste the
whole of `migration-open-tasks.sql`, and run it once. It is idempotent.

It adds:

- `open_tasks` — the tasks themselves (title, description, credit reward,
  category, repeatable flag, open/closed status, and `assigned_staff`)
- `task_claims` — one row per member's attempt at a task (claimed →
  submitted → approved/rejected)

Until it is run, the "open tasks" nav item still shows, but the section
will fail to load any data. `schema.sql` already includes both tables for
a fresh project.

## ⚠ Run this too: `migration-site-content.sql` (connects the public website)

The public website (the "Amaze Con 1" site, deployed separately from this
portal) now reads **five of its sections** live from this same Supabase
project, instead of hardcoded lists baked into its HTML:
executive members, "the people we learn from" (advisors), "run by
students from" (school logos), "our subsidiaries", and "trusted by our
partners". Open the Supabase dashboard for the project the portal points
at → **SQL Editor → New query**, paste the whole of
`migration-site-content.sql`, and run it once. It is idempotent, and
seeds everything that was already hardcoded on the public site so nobody
and nothing disappears when you switch this on.

It adds:

- one `site_content` table for all five of the above (a `type` column
  tells them apart), with **Row Level Security turned on**: anyone can
  read it (that's the point — it's public website content), but only a
  signed-in portal user can write to it — see the "real security" note
  below
- a new **`website`** permission in `js/permissions.js` — the
  administrator, or any member granted this permission, gets a **public
  website** section in the portal sidebar with a tab per content type, to
  add, edit, reorder, and remove entries
- read access from the public site's own `index.html`, using the same
  publishable/anon key already used everywhere else in this project

**Until it is run**, the "public website" nav item still shows for admins
and any member with the permission, but the section will fail to load any
data, and the public site keeps showing its old hardcoded fallback lists
(the `FALLBACK_*` constants near each section's script block) rather than
breaking.

**Photos/logos:** the "photo / logo URL" field takes any public image
link (e.g. an Imgur link, or a link already uploaded to Supabase
Storage). The portal itself doesn't upload files anywhere — it only
stores the URL you paste. Leave it blank to fall back to the initials
badge, same as the public site already does today.

### About the Supabase URL/key showing up in the public site's HTML

This is expected and is **not** the same thing as the plaintext-password
issue described further down. The `SITE_SB_KEY` value is a Supabase
**publishable/anon key** — it's designed to be shipped to every visitor's
browser, the same way a Stripe publishable key or a Google Maps API key
is. It doesn't grant anything by itself; what it's *allowed to do* is
controlled entirely by each table's Row Level Security policy. This exact
key was already sitting inside the members portal's own JS bundle before
`site_content` existed, so adding it to the public site doesn't expose
anything that wasn't already effectively public — it's the same key,
reused, not a new secret.

What genuinely matters is that `site_content` now has real RLS: anon can
only `select`, never write. Writing requires an authenticated Supabase
session — that's what `sbAuthedInsert/Update/Delete` in
`js/supabase-client.js` send instead of the shared anon key.

**One required step this depends on:** the administrator login
(`ADMIN_ID` in `js/auth.js`) needs a **real Supabase Auth account**, or
admin won't be able to save anything in the new "public website" section
(RLS will reject the write, since the hardcoded login has no session to
prove it's a real signed-in user). Set it up once, the same way you
already do for members:
1. Supabase dashboard → **Authentication → Users → Add user**
2. Email: `admin@internal.amazeconsortium.org` (matches `ADMIN_AUTH_EMAIL`
   in `js/auth.js` — change both together if you'd rather use a different
   address)
3. Password: whatever you want the admin password to actually be from now
   on. Tick **Auto Confirm User**.
4. Log into the portal as `admin` with that password. `js/auth.js` will
   try this Supabase account first and fall back to the old hardcoded
   `ADMIN_PWD` only if that account doesn't exist yet — so nothing breaks
   if you haven't done this step, but writes to `site_content` will fail
   with a "make sure you are signed in" message until you do.

Once that account exists, you can (and should) delete the `ADMIN_PWD`
fallback line in `js/auth.js` — at that point the admin password lives
only in Supabase's own auth system, not in plaintext in a file every
visitor's browser downloads.

If you'd rather skip this for now and keep every table's security model
exactly as-is (anon can read *and* write, matching every other table in
this schema), `migration-site-content.sql` has a commented-out fallback
policy at the bottom — swap it in and admin will work immediately without
the Auth account, at the cost of the write protection described above.

## Why this was moved here

The original `index.html` had this data (real member IDs, **plaintext
passwords**, emails, and phone numbers for everyone in the consortium)
hardcoded directly inside the `<script>` tag that ships to every visitor's
browser. Anyone who opened dev tools, viewed page source, or inspected the
network tab on the login page could read every member's real password.
This is separate from — and more serious than — the Supabase key question;
it doesn't matter how well the API key is protected if the passwords
themselves are sitting in plain text in the HTML you serve to the public.

## What changed

- `seed-members.js` is **no longer referenced by `index.html`** and is not
  loaded by the deployed site at all.
- `initDB()` in `js/state.js` no longer auto-seeds the `members` table from
  this file. It only logs a warning if the table is empty. Since your
  production database is already populated, this doesn't change how the
  live app behaves.

## What you should still do

1. **Rotate every password in `seed-members.js`.** Because this data was
   already shipped in the public bundle (likely already deployed to
   `autodarkmode.amazeconsortium.org` / wherever this portal is hosted),
   treat all of it as compromised, including the admin password in
   `js/auth.js`.
2. **Never store passwords in plaintext going forward.** Long term, member
   login should be checked server-side (e.g. a Supabase Edge Function or
   Postgres RPC) against a hashed password column, not compared in the
   browser against a value fetched into `_members`.
3. **Check your Supabase RLS policies.** The publishable/anon key in
   `js/supabase-client.js` is meant to be public, but only if RLS policies
   restrict what each table allows over the REST API. If RLS is off or too
   open, anyone can read/write these tables directly, independent of
   anything in this codebase.
4. If you ever need to re-seed a *new* Supabase project from scratch, run
   this file locally (e.g. with `node`) or paste its contents into the
   Supabase SQL editor — just don't upload it anywhere public.
