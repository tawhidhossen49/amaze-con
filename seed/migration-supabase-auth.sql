-- ════════════════════════════════════════════════
-- Migration: Supabase Auth login (email + password)
-- ════════════════════════════════════════════════
-- Run this once in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Members now log in with email + password, checked by Supabase Auth
-- itself (Authentication → Users in the dashboard), not compared in the
-- browser. This app links a signed-in Auth user back to a `members` row
-- purely by matching email — no extra column needed — so all this
-- migration does is make sure every member's email is unique.
--
-- Before running the "create unique index" line below, check for members
-- missing an email, or two members sharing one — both will fail it:
--   select id, name, email from members where email is null or email = '';
--   select email, count(*) from members group by email having count(*) > 1;
-- Fix those (via the admin panel, or directly in the table) first.

create unique index if not exists idx_members_email_lower
  on members (lower(email));
