// ── SITE MOTION ─────────────────────────────────────────────────────────────
// Presentation only: preloader, hero intro, smooth scroll and scroll reveals.
// Shared by the home page and apprenticeship / structure pages — every block
// checks for its own elements, so a page only gets the motion it has markup for.
// Nothing in here fetches or writes data — the content scripts inline in
// index.html stay the single source of truth for what's on the page.
// If GSAP/Lenis fail to load (offline, blocked CDN) or the visitor prefers
// reduced motion, the page falls back to its static, fully visible state.
// It waits for js/site-text.js to apply any wording saved from the admin panel
// (capped at 1.8s there), so headings are animated with their final text.
(window.siteContentReady || Promise.resolve()).then(function () {
  const root = document.documentElement;
  const pre = document.getElementById('preloader');
  const hero = document.getElementById('hero');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasGsap = !!(window.gsap && window.ScrollTrigger);

  function dropPreloader() {
    if (pre) pre.remove();
    root.classList.remove('is-loading');
  }

  if (!hasGsap || reduce) {
    dropPreloader();
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  // ScrollTrigger measures by jumping the page to the top and back. With CSS
  // smooth scrolling that jump is animated, so it would measure mid-page and
  // leave the hero stuck in its scrolled-away state. Lenis does the smoothing.
  root.style.scrollBehavior = 'auto';

  // ── smooth scroll ──────────────────────────────────────────────────────────
  let lenis = null;
  if (window.Lenis) {
    lenis = new Lenis({ lerp: 0.09, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
    lenis.stop();
    window.AMAZE_lenis = lenis;   // for page scripts that need to move the page themselves

    // in-page anchors go through Lenis so they don't fight the smooth scroll
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const id = a.getAttribute('href');
      if (id.length < 2) return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target, { duration: 1.4 });
      history.pushState(null, '', id);
    });
  }

  // ── frame sequence: a clip exported as numbered images, drawn to a canvas ──
  // (scrubbing a <video> stutters between keyframes; images do not).
  // Portrait viewports get the 9:16 set, everything else the 16:9 one.
  function createSequence(canvas) {
    const count = +canvas.dataset.frames;
    const dir = window.matchMedia('(orientation: portrait) and (max-width: 900px)').matches ? 'mobile' : 'desktop';
    const url = (i) => `${canvas.dataset.seq}/${dir}/${String(i + 1).padStart(4, '0')}.webp`;
    const ctx = canvas.getContext('2d');
    const images = new Array(count);
    const state = { frame: 0 };
    const OVERSCAN = 1.03;   // trims a stray pixel on the clip's edge

    const ready = (img) => img && img.complete && img.naturalWidth > 0;
    // if the exact frame hasn't arrived yet, draw the nearest one that has
    function nearest(i) {
      for (let d = 0; d < count; d++) {
        if (ready(images[i - d])) return images[i - d];
        if (ready(images[i + d])) return images[i + d];
      }
      return null;
    }
    function render() {
      const img = nearest(Math.round(state.frame));
      if (!img) return;
      const cw = canvas.width, ch = canvas.height;
      const k = Math.max(cw / img.naturalWidth, ch / img.naturalHeight) * OVERSCAN;   // object-fit: cover
      const w = img.naturalWidth * k, h = img.naturalHeight * k;
      ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
    }
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      render();
    }
    function load(i) {
      return new Promise((res) => {
        if (images[i]) return res();
        const img = new Image();
        img.decoding = 'async';
        img.onload = img.onerror = () => res();
        img.src = url(i);
        images[i] = img;
      });
    }
    // coarse-to-fine: every 16th frame first so scrubbing works early
    async function pass(stride) {
      const batch = [];
      for (let i = 0; i < count; i += stride) batch.push(load(i));
      await Promise.all(batch);
      render();
    }
    const firstPass = load(0).then(render).then(() => pass(16));
    firstPass.then(async () => { for (const stride of [8, 4, 2, 1]) await pass(stride); });

    window.addEventListener('resize', resize);
    resize();
    return { state, count, render, firstPass };
  }

  const heroCanvas = hero && hero.querySelector('.hero-canvas');
  const seq = heroCanvas ? createSequence(heroCanvas) : null;

  // ── intro: page-top lines and fades ────────────────────────────────────────
  const top = hero || document.querySelector('.page-hero');
  const introLines = top ? gsap.utils.toArray(top.querySelectorAll('.line > span')) : [];
  const introFades = top ? gsap.utils.toArray(top.querySelectorAll('[data-hero-fade]')) : [];
  if (introLines.length) gsap.set(introLines, { yPercent: 115 });
  if (introFades.length) gsap.set(introFades, { autoAlpha: 0, y: 26 });
  gsap.set('#navbar', { yPercent: -140 });

  const intro = gsap.timeline({
    paused: true,
    onComplete: () => {
      gsap.set('#navbar', { clearProps: 'transform' });
      ScrollTrigger.refresh();
    },
  });
  if (introLines.length) intro.to(introLines, { yPercent: 0, duration: 1.25, ease: 'expo.out', stagger: 0.09 }, 0.1);
  if (introFades.length) intro.to(introFades, { autoAlpha: 1, y: 0, duration: 1.1, ease: 'power3.out', stagger: 0.08 }, 0.35);
  intro.to('#navbar', { yPercent: 0, duration: 1.1, ease: 'expo.out' }, 0.3);

  let released = false;
  function release() {
    if (released) return;
    released = true;
    root.classList.remove('is-loading');
    if (lenis) lenis.start();
    intro.play();
  }

  if (pre) {
    // The crest outline is traced in step with the counter. Both run to 90 on
    // a timer, then finish when the first pass of hero frames is in (or after
    // a short cap) — nobody waits on all 120. Then the mark fills, the frame
    // clears, and the two panels part along the centre line.
    const counter = pre.querySelector('.preloader__count');
    const draw = pre.querySelector('.preloader__draw');
    const count = { v: 0 };
    const show = () => {
      counter.textContent = String(Math.round(count.v)).padStart(3, '0');
      draw.style.strokeDashoffset = 1 - count.v / 100;
    };
    const framesIn = seq ? Promise.race([seq.firstPass, new Promise((r) => setTimeout(r, 2600))]) : Promise.resolve();
    gsap.to(count, { v: 90, duration: 1.3, ease: 'power2.inOut', onUpdate: show });
    Promise.all([framesIn, new Promise((r) => setTimeout(r, 1300))]).then(() => {
      gsap.timeline()
        .to(count, { v: 100, duration: 0.35, ease: 'power2.out', onUpdate: show }, 0)
        .to(draw, { fillOpacity: 1, duration: 0.4, ease: 'power2.out' }, 0.3)
        .to('.preloader__frame', { autoAlpha: 0, scale: 0.96, duration: 0.45, ease: 'power2.in' }, 0.8)
        .to('.preloader__panel--top', { yPercent: -100, duration: 1, ease: 'expo.inOut', onStart: release }, 1.1)
        .to('.preloader__panel--bottom', { yPercent: 100, duration: 1, ease: 'expo.inOut', onComplete: () => pre.remove() }, 1.1);
    });
  } else {
    release();
  }

  // ── hero: the clip follows the scroll, both directions ─────────────────────
  // The stage is held in place by position: sticky and the text scrolls over
  // it natively; all this does is map scroll distance through the hero onto
  // the frame number, so the light and the text move together.
  if (seq) {
    gsap.to(seq.state, {
      frame: seq.count - 1, snap: 'frame', ease: 'none', onUpdate: seq.render,
      scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom bottom', scrub: 0.5 },
    });
  }

  // ── nav: hide on the way down, return on the way up ────────────────────────
  const nav = document.getElementById('navbar');
  if (nav) {
    ScrollTrigger.create({
      start: 0, end: 'max',
      onUpdate: (self) => nav.classList.toggle('is-hidden', self.direction === 1 && self.scroll() > 400),
    });
  }

  if (document.querySelector('.scroll-progress')) {
    gsap.to('.scroll-progress', { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0.3 } });
  }

  // ── headings: line-mask reveal ─────────────────────────────────────────────
  gsap.utils.toArray('[data-lines]').forEach((el) => {
    if (top && top.contains(el)) return;
    gsap.from(el.querySelectorAll('.line > span'), {
      yPercent: 115, duration: 1.2, ease: 'expo.out', stagger: 0.09,
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
    });
  });

  // ── manifesto: words light up with scroll ──────────────────────────────────
  const manifesto = document.querySelector('.manifesto');
  if (manifesto) {
    const words = manifesto.textContent.trim().split(/\s+/);
    manifesto.setAttribute('aria-label', words.join(' '));
    manifesto.innerHTML = words.map((w) => `<span class="w" aria-hidden="true">${w}</span>`).join(' ');
    gsap.fromTo(manifesto.querySelectorAll('.w'), { opacity: 0.14 }, {
      opacity: 1, stagger: 0.06, ease: 'none',
      scrollTrigger: { trigger: manifesto, start: 'top 82%', end: 'bottom 55%', scrub: true },
    });
  }

  // ── stat counters ──────────────────────────────────────────────────────────
  gsap.utils.toArray('[data-count]').forEach((el) => {
    gsap.from(el, {
      textContent: 0, duration: 1.8, ease: 'power2.out', snap: { textContent: 1 },
      scrollTrigger: { trigger: el, start: 'top 90%', once: true },
    });
  });

  // ── rules that draw across (org chart connectors, dividers) ────────────────
  gsap.utils.toArray('[data-rule]').forEach((el) => {
    gsap.from(el, {
      scaleX: el.dataset.rule === 'y' ? 1 : 0, scaleY: el.dataset.rule === 'y' ? 0 : 1,
      transformOrigin: el.dataset.rule === 'y' ? 'top' : 'left', duration: 1.2, ease: 'expo.out',
      scrollTrigger: { trigger: el, start: 'top 90%', once: true },
    });
  });

  // ── imagery ────────────────────────────────────────────────────────────────
  gsap.utils.toArray('[data-parallax] img').forEach((img) => {
    gsap.fromTo(img, { scale: 1.18, yPercent: -5 }, {
      scale: 1.02, yPercent: 5, ease: 'none',
      scrollTrigger: { trigger: img.closest('[data-parallax]'), start: 'top bottom', end: 'bottom top', scrub: true },
    });
  });
  const teamMedia = document.querySelector('.team-media');
  if (teamMedia) {
    gsap.fromTo(teamMedia, { clipPath: 'inset(9% 11% 9% 11%)' }, {
      clipPath: 'inset(0% 0% 0% 0%)', ease: 'none',
      scrollTrigger: { trigger: teamMedia, start: 'top 92%', end: 'top 22%', scrub: true },
    });
  }

  // Sections fill in asynchronously (Supabase content, images), which moves
  // everything below them — re-measure triggers whenever the page height changes.
  let refreshTimer = null, lastHeight = 0;
  new ResizeObserver(() => {
    const h = document.body.scrollHeight;
    if (h === lastHeight) return;
    lastHeight = h;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => ScrollTrigger.refresh(), 200);
  }).observe(document.body);
});
