-- ════════════════════════════════════════════════
-- Amaze Consortium academy — TEST CONTENT
-- One program and one webinar, to try the academy page, the admin panel and
-- live classes with something real in them.
--
-- How to use: Supabase → SQL editor → paste this whole file → Run.
-- Safe to run more than once (rows that already exist are left alone).
-- It also adds the four academy columns from website-backend-05-academy.sql,
-- so that file does not need to be run separately.
--
-- To remove it again: admin panel → academy → open each one → delete.
--
-- Things to change before using this for real:
--   * the join links are placeholders (https://meet.google.com/landing) — put
--     your own meeting links in from the admin panel
--   * the dates are in October 2026, Bangladesh time (+06)
--   * the videos are public YouTube tutorials by other creators, embedded as-is
-- ════════════════════════════════════════════════

-- ── the academy columns (same as part 5) ─────────────────────────────────────
alter table public.courses        add column if not exists kind      text not null default 'course';
alter table public.courses        add column if not exists starts_at timestamptz;
alter table public.course_lessons add column if not exists live_at   timestamptz;
alter table public.lesson_content add column if not exists live_url  text;
create index if not exists idx_courses_kind on public.courses (kind, sort_order);

-- ════════════════════════════════════════════════
-- PROGRAM — canva for beginners
-- ════════════════════════════════════════════════
insert into public.courses (id, kind, starts_at, title, tagline, description, category, level, duration, instructor_name, instructor_role,
                            outcomes, tags, requirements, audience, access, status, featured, sort_order, language, sequential)
values (
  'canva-for-beginners', 'program', '2026-10-17 20:00+06',
  'canva for beginners',
  'three weeks from a blank page to posters, posts and slides you are proud to share.',
  'a guided program for people who have never designed anything. each week you watch a short lesson, read one page of notes, make something real, and bring it to a live class for feedback. by the end you will have a small portfolio: a poster, a set of social posts and a presentation — all made in the free version of canva.',
  'design', 'beginner', '3 weeks',
  'amaze design desk', 'amaze consortium',
  '["find your way around the canva editor without getting lost", "build a poster from a blank page instead of only editing templates", "choose two fonts and three colours that work together, and explain why", "keep a set of posts looking like they belong to one brand", "export the right file type for print, for social media and for slides"]'::jsonb,
  '["canva", "layout", "typography", "colour", "social media design", "presentation design"]'::jsonb,
  '["a free canva account (canva.com) — you do not need canva pro", "a laptop or desktop is best; a phone works for the first week", "about three hours a week"]'::jsonb,
  '["students who make posters and posts for a club, event or campaign", "members joining a creative or outreach desk", "anyone who has opened canva, picked a template and felt stuck"]'::jsonb,
  'account', 'published', true, 20, 'english', false
) on conflict (id) do nothing;

insert into public.course_modules (id, course_id, title, summary, sort_order) values
  (md5('canva-m1')::uuid, 'canva-for-beginners', 'week 1 — finding your way around', 'the editor, templates, and your first design.', 1),
  (md5('canva-m2')::uuid, 'canva-for-beginners', 'week 2 — making it look good', 'fonts, colour, spacing and images.', 2),
  (md5('canva-m3')::uuid, 'canva-for-beginners', 'week 3 — make, share, present', 'a brand kit, exporting, and your final piece.', 3)
on conflict (id) do nothing;

insert into public.course_lessons (id, course_id, module_id, title, kind, duration_min, is_preview, sort_order, live_at) values
  (md5('canva-l1')::uuid, 'canva-for-beginners', md5('canva-m1')::uuid, 'welcome — how this program runs',        'article', 4,  true,  1, null),
  (md5('canva-l2')::uuid, 'canva-for-beginners', md5('canva-m1')::uuid, 'canva in 13 minutes: the whole editor',  'video',   13, true,  2, null),
  (md5('canva-l3')::uuid, 'canva-for-beginners', md5('canva-m1')::uuid, 'kick-off class: your first poster, live','live',    60, false, 3, '2026-10-17 20:00+06'),
  (md5('canva-l4')::uuid, 'canva-for-beginners', md5('canva-m2')::uuid, 'the four rules that fix most designs',   'article', 8,  false, 4, null),
  (md5('canva-l5')::uuid, 'canva-for-beginners', md5('canva-m2')::uuid, 'a full walkthrough, step by step',       'video',   17, false, 5, null),
  (md5('canva-l6')::uuid, 'canva-for-beginners', md5('canva-m2')::uuid, 'check yourself: design basics',          'quiz',    5,  false, 6, null),
  (md5('canva-l7')::uuid, 'canva-for-beginners', md5('canva-m2')::uuid, 'feedback class: bring your poster',      'live',    60, false, 7, '2026-10-24 20:00+06'),
  (md5('canva-l8')::uuid, 'canva-for-beginners', md5('canva-m3')::uuid, 'going further: brand kits, export, slides','video', 30, false, 8, null),
  (md5('canva-l9')::uuid, 'canva-for-beginners', md5('canva-m3')::uuid, 'final project brief',                    'article', 6,  false, 9, null),
  (md5('canva-l10')::uuid,'canva-for-beginners', md5('canva-m3')::uuid, 'showcase class: present your work',      'live',    75, false, 10,'2026-10-31 20:00+06')
on conflict (id) do nothing;

insert into public.lesson_content (lesson_id, video_url, body, quiz, resources, live_url) values
(md5('canva-l1')::uuid, null, $md$## welcome

this program is three weeks long, and every week has the same shape:

1. **watch** one short video lesson
2. **read** one page of notes
3. **make** something — the task is always at the end of the notes
4. **bring it** to the saturday live class for feedback

you do not need any design experience, and you do not need canva pro. everything here works in the free version.

## what you will make

- week 1 — a poster for a real or invented event
- week 2 — the same poster, redesigned using four simple rules
- week 3 — three matching social posts and a five-slide presentation

## before saturday

- create a free account at canva.com
- open any template, change the text, and download it once — just to see that you can
- write down one poster, post or slide you have seen recently and liked. bring it to the kick-off class.

## how to get help

use the **q&a** tab under any lesson. questions asked there are answered by the design desk, and everyone in the program can read the answers.$md$,
 null,
 '[{"label": "canva design school — free lessons from canva", "url": "https://www.canva.com/designschool/"}, {"label": "canva templates — browse by type", "url": "https://www.canva.com/templates/"}]'::jsonb, null),

(md5('canva-l2')::uuid, 'https://www.youtube.com/watch?v=6M8axhCQP7M', $md$## while you watch

this video goes through the whole editor quickly. do not try to remember everything — pause and try each thing yourself. look out for:

- the **side panel**: templates, elements, text, uploads
- how to **select, move and resize** something
- the **position** button: this is how you line things up properly instead of by eye
- **download** and the file types it offers

## your task this week

make a poster for an event — real or invented. it needs a title, a date, a place and one image. start from a template if you like, but change at least the fonts and the colours so it is yours.

bring it to the kick-off class.$md$,
 null,
 '[{"label": "video by skills factory on youtube", "url": "https://www.youtube.com/watch?v=6M8axhCQP7M"}]'::jsonb, null),

(md5('canva-l3')::uuid, null, $md$## what we will do

- a ten-minute tour of the editor, with the mistakes beginners usually make
- build a poster together from a blank page
- time for your questions

## bring

- canva open on your own screen
- the poster, post or slide you liked from the welcome lesson

a recording will be added to this lesson afterwards.$md$,
 null, '[]'::jsonb, 'https://meet.google.com/landing'),

(md5('canva-l4')::uuid, null, $md$## the four rules

almost every design that looks "off" is breaking one of these.

### 1. contrast
if two things are different, make them **very** different. a title that is slightly bigger than the body text looks like a mistake; a title three times bigger looks like a decision.

### 2. alignment
nothing should be placed "about there". every item should line up with something else on the page. in canva, watch for the pink guide lines as you drag — they are telling you when things line up.

### 3. repetition
use the same two fonts, the same three colours and the same spacing all the way through. repetition is what makes five posts look like one brand.

### 4. proximity
things that belong together sit close together; things that do not are given space. the date and the place belong together. the sponsor logos do not belong next to the title.

## fonts

- use **two** fonts at most: one for headings, one for everything else
- pair a strong heading font with a plain, readable body font
- never stretch a font to make it fit — change the size instead

## colour

- pick **one** main colour, **one** accent, and a dark and a light neutral
- use the accent for one thing only: the thing you most want people to see

## your task this week

redesign last week's poster using the four rules. keep the old one — you will show both at the feedback class.$md$,
 null,
 '[{"label": "canva colour wheel — find colours that go together", "url": "https://www.canva.com/colors/color-wheel/"}, {"label": "canva font combinations", "url": "https://www.canva.com/font-combinations/"}]'::jsonb, null),

(md5('canva-l5')::uuid, 'https://www.youtube.com/watch?v=XhHXbDDRW_U', $md$## while you watch

this is a slower, step-by-step walkthrough. this time, watch for the things from the notes:

- where are **alignment** and **spacing** controlled?
- how do you save a **colour** so you can reuse it?
- how do you **group** items so they move together?$md$,
 null,
 '[{"label": "video by skills factory on youtube", "url": "https://www.youtube.com/watch?v=XhHXbDDRW_U"}]'::jsonb, null),

(md5('canva-l6')::uuid, null, 'five quick questions on this week''s notes. you need 70% to pass, and you can retake it.',
 '[
   {"q": "a title is only slightly bigger than the text under it. which rule is being broken?", "options": ["proximity", "contrast", "repetition"], "answer": 1, "why": "contrast: if two things are different, make them very different."},
   {"q": "how many fonts should a beginner use in one design?", "options": ["as many as the design needs", "two at most", "exactly one"], "answer": 1, "why": "one for headings and one for everything else is enough for almost any design."},
   {"q": "the date and the venue of an event should be placed…", "options": ["close together", "in opposite corners", "in different colours"], "answer": 0, "why": "proximity: things that belong together sit close together."},
   {"q": "what makes five separate posts look like one brand?", "options": ["a different style for each, to keep it interesting", "the same fonts, colours and spacing in all of them", "a bigger logo"], "answer": 1, "why": "repetition is what ties a set together."},
   {"q": "what is the accent colour for?", "options": ["the background", "all of the text", "the one thing you most want people to notice"], "answer": 2, "why": "an accent only works if it is used sparingly."}
 ]'::jsonb, '[]'::jsonb, null),

(md5('canva-l7')::uuid, null, $md$## what we will do

a feedback session. a few posters are shown on screen and we fix them together, live, using the four rules.

## bring

- your week 1 poster and your redesigned one, side by side
- one thing you could not work out how to do

you can post your poster in the q&a tab before the class if you would like it to be one of the ones we look at.$md$,
 null, '[]'::jsonb, 'https://meet.google.com/landing'),

(md5('canva-l8')::uuid, 'https://www.youtube.com/watch?v=BLhoWAALKt0', $md$## while you watch

this is the longest video in the program. the parts that matter most for your final project:

- **resizing** one design into several sizes
- **downloading**: png for social media, pdf print for anything printed, and how to present slides straight from canva
- keeping your colours and fonts in one place so every design matches$md$,
 null,
 '[{"label": "video by kate hayes on youtube", "url": "https://www.youtube.com/watch?v=BLhoWAALKt0"}]'::jsonb, null),

(md5('canva-l9')::uuid, null, $md$## the brief

choose a real club, cause or event — yours or one you admire — and make:

1. **three social posts** that clearly belong together: an announcement, a reminder and a thank-you
2. **a five-slide presentation** introducing it: title, the problem, what you do, one number or story, how to join

## rules

- two fonts, three colours, used the same way everywhere
- every item lines up with something
- export the posts as png and the slides as a pdf

## how it is reviewed

at the showcase class you have three minutes to present. you will get feedback on four things: is it clear, is it consistent, is it readable from a distance, and does it look like yours rather than like the template.$md$,
 null,
 '[{"label": "canva design school — more to learn after the program", "url": "https://www.canva.com/designschool/"}]'::jsonb, null),

(md5('canva-l10')::uuid, null, $md$## the showcase

three minutes each: show your three posts and your slides, and say one thing you would do differently next time.

everyone who presents and has completed the lessons can claim the program certificate afterwards.$md$,
 null, '[]'::jsonb, 'https://meet.google.com/landing')
on conflict (lesson_id) do nothing;

insert into public.course_announcements (id, course_id, title, body) values
  (md5('canva-news-1')::uuid, 'canva-for-beginners', 'kick-off is saturday 17 october, 8 pm (bangladesh time)',
   'the first live class opens the program. finish the welcome lesson and the first video before then, and have canva open on your own screen.')
on conflict (id) do nothing;

-- ════════════════════════════════════════════════
-- WEBINAR — how to become a leader
-- ════════════════════════════════════════════════
insert into public.courses (id, kind, starts_at, title, tagline, description, category, level, duration, instructor_name, instructor_role,
                            outcomes, tags, requirements, audience, access, status, featured, sort_order, language, sequential)
values (
  'how-to-become-a-leader', 'webinar', '2026-10-16 20:00+06',
  'how to become a leader',
  'a live session on leading before anyone gives you the title.',
  'leadership is not a position you are handed — it is a way of behaving that people notice long before a title arrives. in this one-hour live session we look at what student leaders actually do differently: how they earn trust, how they give direction without giving orders, and what to do in your first month of leading a team. come with a question; the last twenty minutes are yours.',
  'leadership', 'all levels', '1 hour, live',
  'amaze leadership desk', 'amaze consortium',
  '["explain the difference between being in charge and being a leader", "name three habits you can start this week, with no title at all", "plan the first conversation to have with a team you have just been given", "give a clear reason — a why — for whatever you are asking people to do"]'::jsonb,
  '["leadership", "teamwork", "communication", "trust"]'::jsonb,
  '["nothing — just come curious", "optional: watch the two short talks under “before the session”"]'::jsonb,
  '["students who lead, or are about to lead, a club, team or project", "members moving into coordinator roles", "anyone who has been told to “show leadership” and wondered what that means"]'::jsonb,
  'account', 'published', true, 30, 'english', false
) on conflict (id) do nothing;

insert into public.course_modules (id, course_id, title, summary, sort_order) values
  (md5('lead-m1')::uuid, 'how-to-become-a-leader', 'before the session', 'two short talks worth watching first.', 1),
  (md5('lead-m2')::uuid, 'how-to-become-a-leader', 'the live session', 'friday 16 october, 8 pm bangladesh time.', 2),
  (md5('lead-m3')::uuid, 'how-to-become-a-leader', 'after the session', 'notes to keep.', 3)
on conflict (id) do nothing;

insert into public.course_lessons (id, course_id, module_id, title, kind, duration_min, is_preview, sort_order, live_at) values
  (md5('lead-l1')::uuid, 'how-to-become-a-leader', md5('lead-m1')::uuid, 'everyday leadership',                 'video',   6,  true,  1, null),
  (md5('lead-l2')::uuid, 'how-to-become-a-leader', md5('lead-m1')::uuid, 'how great leaders inspire action',    'video',   18, false, 2, null),
  (md5('lead-l3')::uuid, 'how-to-become-a-leader', md5('lead-m2')::uuid, 'live: how to become a leader',        'live',    60, false, 3, '2026-10-16 20:00+06'),
  (md5('lead-l4')::uuid, 'how-to-become-a-leader', md5('lead-m3')::uuid, 'your first 30 days leading a team',   'article', 7,  false, 4, null)
on conflict (id) do nothing;

insert into public.lesson_content (lesson_id, video_url, body, quiz, resources, live_url) values
(md5('lead-l1')::uuid, 'https://www.youtube.com/watch?v=uAy6EawKKME', $md$## why start here

six minutes, and the main idea of the whole session: leadership is mostly small moments, not grand ones.

## think about

- who did something small that changed things for you? did you ever tell them?
- when did you last do that for someone else?

bring one example to the live session.$md$,
 null,
 '[{"label": "talk by drew dudley (ted-ed) on youtube", "url": "https://www.youtube.com/watch?v=uAy6EawKKME"}]'::jsonb, null),

(md5('lead-l2')::uuid, 'https://www.youtube.com/watch?v=qp0HIF3SfI4', $md$## the idea

people do not follow **what** you ask for; they follow **why** you are asking.

## try it before the session

take one thing you need your team, class or club to do this month. write it three ways:

1. **what** — the task
2. **how** — the plan
3. **why** — the reason it matters to *them*

most of us only ever say the first one. bring your three lines to the session.$md$,
 null,
 '[{"label": "talk by simon sinek (ted) on youtube", "url": "https://www.youtube.com/watch?v=qp0HIF3SfI4"}, {"label": "another to watch: why good leaders make you feel safe", "url": "https://www.youtube.com/watch?v=lmyZMtPVodo"}]'::jsonb, null),

(md5('lead-l3')::uuid, null, $md$## the plan for the hour

- **0–10 min** — in charge vs. leading: what is actually different
- **10–25 min** — trust: how it is built, and the three fastest ways to lose it
- **25–40 min** — direction without orders: the what / how / why exercise, done live
- **40–60 min** — your questions

## how to take part

- join a few minutes early with the link above
- post questions in the q&a tab before or during the session — the ones posted in advance are answered first

a recording will be added here afterwards.$md$,
 null, '[]'::jsonb, 'https://meet.google.com/landing'),

(md5('lead-l4')::uuid, null, $md$## week 1 — listen

- meet every person on the team one to one, even for ten minutes
- ask three questions: what is working, what is not, what would you change if you were me?
- change nothing yet

## week 2 — say where you are going

- write one sentence that says what the team is for. test it on two people.
- tell the team what you heard in week 1 — including the uncomfortable parts
- agree on one thing you will all stop doing

## week 3 — make one thing better

- pick the smallest problem that annoys the most people, and fix it
- give the credit to whoever suggested it

## week 4 — hand something over

- give one real responsibility to someone else, with the authority to decide
- do not take it back when they do it differently from you

## the habits underneath

- say **why** before you say what
- be the last to speak in a meeting
- when it goes well, say "we"; when it goes badly, say "i"
- thank people for specific things, by name, in front of others$md$,
 null,
 '[{"label": "watch again: everyday leadership", "url": "https://www.youtube.com/watch?v=uAy6EawKKME"}]'::jsonb, null)
on conflict (lesson_id) do nothing;

-- make the new columns visible to the API straight away
notify pgrst, 'reload schema';
