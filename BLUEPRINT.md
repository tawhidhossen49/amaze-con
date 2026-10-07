# Site redesign — blueprint

Scope: `index.html`, `academy/index.html`, `structure/index.html`. Presentation layer and motion; no change to data, links, routes or the Supabase content pipeline.

## Direction

- **Concept**: the seal. The crest is cut into black stone and a single band of light crosses it; the visitor moves the light with the scroll. The hero text sits centred on top.
- **Style**: Swiss / International typographic. Type-led hierarchy, hairline rules, flat colour, no glow, no glass, no gradients.
- **Palette**: `#050606` base · `#2ef2a2` accent (unchanged brand green) · `#ecece6` bone · `#0a7a52` accent on light.
- **Type**: Helvetica only (`'Helvetica Neue', Helvetica, Arial, sans-serif`), 700 for display and 400 for text. No serif, no mono, no webfont download. Small labels are the same face at 10–11px with wide tracking.
- **Shape**: zero radius everywhere — buttons, cards, arrows, markers and photo frames are all square-cornered.
- **Motion**: `expo.out` / `power3.out`, 1–1.3s, small staggers. Lenis smooth scroll + GSAP ScrollTrigger.
- **Hero mode**: cinematic video. `raw-video/amaze logo 169.mp4` (16:9) and `raw-video/amaze hero 916.mp4` (9:16) are extracted to 120 WebP frames each in `sequences/hero/` and scrubbed on a canvas — forwards on scroll down, backwards on scroll up, never autoplaying.

## Home sections

| # | Section (id) | Component | Motion | Content kept |
|---|---|---|---|---|
| 0 | Preloader | large counter + progress rule | counts while the first pass of hero frames loads → slide up (4s failsafe) | new |
| 1 | Nav (`#navbar`) | logo · text links · block CTA | hides on scroll down, returns on scroll up | all links, dropdown, mobile menu |
| 2 | Hero (`#hero`) | sticky stage with a frame-sequence canvas; headline block and numbers block scroll over it as normal content, 80vh apart | frames mapped to scroll distance through the hero (280vh), both directions; text scrolls natively at 1:1; line-mask intro on load | tag, h1, sub, both CTAs, stats |
| 3 | Schools (`#marquee-strip`) | logo ticker | infinite scroll, pause on hover | Supabase `school` |
| 4 | About (`#about`, light) | split heading/copy, manifesto, stat row | line mask, word-by-word highlight, counters | all copy + 4 stats |
| 5 | Subsidiaries (`#divisions`) | logo row + detail panel with outline number | reveal, panel swap on hover | Supabase `subsidiary` |
| 6 | Founder (`#founder`) | portrait + pull quote | image parallax, reveals | quote, bio, link |
| 7 | Executives (`#executives`) | portrait card rail | drag / arrows / dots, B&W → colour on hover | Supabase `executive` |
| 8 | Advisors (`#advisors`) | roster: one row per advisor beside a pinned portrait | portrait wipes to the hovered/focused row | Supabase `advisor` |
| 9 | Opportunities (`#opportunities`, light) | numbered editorial rows | ink fill on hover | 4 items + form links |
| 10 | Team (`#team`) | wide photo + two-column copy | inset → full clip reveal | photo, copy |
| 11 | Partners (`#partners`) | ruled logo directory ending in a "become a partner" cell | hover colour | Supabase `partner` |
| 12 | Contact (`#contact`) | giant CTA type, email, ruled social row | line mask | email, WhatsApp, 5 socials |
| 13 | Footer | logo, links, copyright line | — | all links |

### Count-proof sections

- **Advisors**: rows, not cards. With few advisors the rows stretch to share the portrait's height; with many, the list runs long and the portrait stays pinned. Below 1100px the pinned portrait is dropped and every row carries its own thumbnail.
- **Partners**: `auto-fill` grid. The closing "become a partner" cell spans whatever is left of the last row (`fitPartnerGrid()` in `index.html`, re-run on resize), so the grid is always a complete rectangle.

## Inner pages (academy, structure)

Same nav, tokens, buttons, labels and footer as the home page via `css/home.css`, plus `css/subpage.css` for the page hero, ruled grids, org chart and closing CTA. All copy is unchanged.

## Files

- Changed: `index.html`, `academy/index.html`, `structure/index.html`, `css/home.css`, `js/home-motion.js` (now shared by all three pages).
- Added: `css/subpage.css`, `sequences/hero/` (frames, poster, manifest).
- To swap the clip: replace the files in `raw-video/`, then run `python <skill>/scripts/extract_frames.py "raw-video/amaze logo 169.mp4" --name hero --out sequences --frames 120 --width 1600 --mobile-src "raw-video/amaze hero 916.mp4" --mobile-width 720`. If the frame count changes, update `data-frames` on `.hero-canvas`.
- Not touched: `fetchSiteContent()`, Supabase URL/key, fallback data, analytics, `learn.html`, `apply/`, `donate/`, `code/`, `guidebook/`, `privacy/`, `tos/`, `simplespeek/`, `seed/`.

## Courses (`/courses`)

A small learning platform on the site's own Supabase project (`seed/website-backend.sql`).

| Page | What it does |
|---|---|
| `courses/index.html` | catalogue: featured course, category filter, search, "continue learning" for returning learners, why-learn-here, FAQ |
| `courses/course.html?c=` | one course: facts, outcomes, curriculum accordion, instructor, enrol / continue |
| `courses/learn.html?c=&l=` | lesson player: outline with ticks, video / article / quiz lessons, progress bar, complete-and-continue |
| `courses/certificate.html?c=` | printable completion certificate |

- **Structure**: course → modules → lessons. Lesson outlines are public; lesson content sits in its own table so it can be gated.
- **Access**: a course is either `open` (anyone) or `account` (free sign-up). Preview lessons are always open. Enforced by Row Level Security, not by the page.
- **Progress**: stored per account (`enrollments`, `lesson_progress`); without an account, on the device. Quizzes pass at 70%.
- **Fallback**: if the database can't be reached the pages show `courses/sample.json` in a labelled preview mode.
- Code: `js/lms.js`, `css/courses.css`. `learn.html` at the site root now redirects to `/courses`.

### Learning-platform features (part 2 — needs `seed/website-backend-02-lms.sql`)

- **Lesson types**: video (YouTube, Vimeo, Google Drive, .mp4), reading, built-in quiz, and test / assignment (an embedded Google Form the learner marks as submitted).
- **In the player**: private notes, files and links per lesson, Q&A with instructor replies, course announcements, optional locked lesson order.
- **Course page**: introduction video, skills, requirements, audience, learner count, ratings and reviews (one per enrolled learner).
- **Learner dashboard**: `courses/my.html`.
- **Certificates**: issued by the database only when every lesson is complete; each has a reference anyone can check at `courses/certificate.html?id=`.
- **Admin**: everything above is edited under courses; lessons, modules and list items can be hidden without deleting; every page section has a shown / hidden switch under pages.
- Each feature is left out of the page, not broken, if its table isn't there yet.

## Admin panel (`/admin`)

Sign-in with a Supabase account whose confirmed email is in the `admins` table. Five screens: **pages** (every heading, paragraph, button, link and image on the home, academy, structure, courses and legal pages), **lists** (schools, subsidiaries, executives, advisors, partners), **courses** (courses, modules, lessons, quizzes, publish), **learners** (read-only), **admins**.

- `js/site-fields.js` is the single list of editable fields (key, label, selector, type). The admin builds its forms from it and reads each field's built-in wording from the page itself; `js/site-text.js` applies saved values on the public pages. To make something new editable, add one line there.
- A page shows its own HTML unless a value has been saved for a field, so the site still works with the database offline.
- Code: `admin/index.html`, `js/admin.js`, `css/admin.css`, `js/site-config.js`.

