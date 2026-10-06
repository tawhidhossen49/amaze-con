# Home page redesign — blueprint

Scope: `index.html` only. Presentation layer and motion; no change to data, links, routes or the Supabase content pipeline.

## Direction

- **Concept**: the crest is the institution. The shield mark becomes a 3D object with the subsidiaries' domains in orbit around it — one parent, many ventures.
- **Archetype**: Bold Performance (near-black, one accent, glass) with Editorial restraint. Two light "bone" sections break the dark rhythm.
- **Palette**: `#050606` base · `#2ef2a2` accent (unchanged brand green) · `#ecece6` bone · `#0a7a52` accent on light.
- **Type**: Manrope (display + body, lowercase, tight tracking) · Instrument Serif italic (accent words) · JetBrains Mono (labels).
- **Shape**: pill buttons, 10 / 18 / 28px radii, 1px hairlines.
- **Motion**: `expo.out` / `power3.out`, 1–1.3s, small staggers. Lenis smooth scroll + GSAP ScrollTrigger.
- **Hero mode**: no video for now. `.crest-stage` + `.hero-bg` are the stand-in; a clip replaces them later and the copy stays.

## Sections

| # | Section (id) | Component | Motion | Content kept |
|---|---|---|---|---|
| 0 | Preloader | crest stroke draw + counter | draw → fill → slide up (4s failsafe) | new |
| 1 | Nav (`#navbar`) | logo · glass pill links · pill CTA | hides on scroll down, returns on scroll up | all links, dropdown, mobile menu |
| 2 | Hero (`#hero`) | oversized type + extruded 3D crest with orbit nodes, stat bar | line-mask intro, idle spin, pointer tilt, scroll-out | tag, h1, sub, both CTAs |
| 3 | Schools (`#marquee-strip`) | masked logo ticker | infinite scroll, pause on hover | Supabase `school` |
| 4 | About (`#about`, light) | split heading/copy, manifesto, stat row | line mask, word-by-word highlight, counters | all copy + 4 stats |
| 5 | Subsidiaries (`#divisions`) | logo row + glass detail panel with outline number | reveal, panel swap on hover | Supabase `subsidiary` |
| 6 | Founder (`#founder`) | arched portrait + serif pull quote | image parallax, reveals | quote, bio, link |
| 7 | Executives (`#executives`) | portrait card rail | drag / arrows / dots, B&W → colour on hover | Supabase `executive` |
| 8 | Advisors (`#advisors`) | sticky heading + portrait cards | reveal, hover | Supabase `advisor` |
| 9 | Opportunities (`#opportunities`, light) | numbered editorial rows | ink fill on hover | 4 items + form links |
| 10 | Team (`#team`) | wide photo + two-column copy | inset → full clip reveal | photo, copy |
| 11 | Partners (`#partners`) | hairline logo grid | hover colour | Supabase `partner` |
| 12 | Contact (`#contact`) | giant CTA type, email, social pills | line mask | email, WhatsApp, 5 socials |
| 13 | Footer | links + giant wordmark | letters rise | all links |

## Files

- Changed: `index.html` (markup, render templates moved from inline styles to classes).
- Added: `css/home.css`, `js/home-motion.js`.
- Not touched: `fetchSiteContent()`, Supabase URL/key, fallback data, the ventures script, analytics, every other page, `seed/`.
