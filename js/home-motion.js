// ── HOME PAGE MOTION ────────────────────────────────────────────────────────
// Presentation only: preloader, 3D crest, smooth scroll and scroll reveals.
// Nothing in here fetches or writes data — the content scripts inline in
// index.html stay the single source of truth for what's on the page.
// If GSAP/Lenis fail to load (offline, blocked CDN) or the visitor prefers
// reduced motion, the page falls back to its static, fully visible state.
(function () {
  const root = document.documentElement;
  const pre = document.getElementById('preloader');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasGsap = !!(window.gsap && window.ScrollTrigger);

  const stage = document.querySelector('.crest-stage');
  const crest = document.querySelector('.crest');
  const nodes = [...document.querySelectorAll('.orbit-node')];

  // ── 3D crest: stack copies of the flat mark along Z to extrude it ──────────
  const DEPTH_LAYERS = 18;
  const LAYER_STEP = 2;
  function buildCrest() {
    if (!crest) return;
    const face = crest.querySelector('.crest-layer--face');
    for (let i = DEPTH_LAYERS; i >= 1; i--) {
      const layer = face.cloneNode(true);
      layer.setAttribute('class', i === DEPTH_LAYERS ? 'crest-layer--back' : 'crest-layer--side');
      layer.style.transform = `translateZ(${-i * LAYER_STEP}px)`;
      crest.insertBefore(layer, face);
    }
  }

  // ── orbit: nodes travel the same tilted ellipses the SVG rings draw ────────
  // rx/ry are fractions of the stage size and must match the ring paths
  // (viewBox 0 0 1000 1000) in index.html.
  const RINGS = [
    { rx: 0.46, ry: 0.14, speed: 0.16 },
    { rx: 0.37, ry: 0.11, speed: -0.22 },
  ];
  const TILT = (-14 * Math.PI) / 180;
  const cosT = Math.cos(TILT), sinT = Math.sin(TILT);
  function placeNodes(time) {
    if (!stage) return;
    const size = stage.clientWidth;
    nodes.forEach((node) => {
      const ring = RINGS[+node.dataset.ring] || RINGS[0];
      const t = parseFloat(node.dataset.phase) + time * ring.speed;
      const ex = ring.rx * Math.cos(t), ey = ring.ry * Math.sin(t);
      const x = (ex * cosT - ey * sinT) * size;
      const y = (ex * sinT + ey * cosT) * size;
      const depth = Math.sin(t);                 // > 0 = near side of the ring
      const near = (depth + 1) / 2;
      const lift = node.dataset.ring === '1' ? 34 : 6;   // keeps the dot, not the label, on the ring
      node.style.transform = `translate(calc(-50% + ${x.toFixed(1)}px), calc(${y.toFixed(1)}px - ${lift}px)) scale(${(0.82 + near * 0.18).toFixed(3)})`;
      node.style.opacity = (0.3 + near * 0.7).toFixed(3);
      node.style.zIndex = depth > 0 ? 5 : 2;
    });
  }

  function dropPreloader() {
    if (pre) pre.remove();
    root.classList.remove('is-loading');
  }

  buildCrest();
  placeNodes(0);

  if (!hasGsap || reduce) {
    if (crest) crest.style.transform = 'rotateY(-22deg) rotateX(6deg)';
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

  // ── crest idle motion + pointer tilt ───────────────────────────────────────
  gsap.ticker.add((time) => placeNodes(time));
  gsap.set('.crest', { rotateX: 6, rotateY: -30 });
  gsap.to('.crest', { rotateY: 30, duration: 7, ease: 'sine.inOut', repeat: -1, yoyo: true });
  gsap.to('.crest-tilt', { y: -12, duration: 3.6, ease: 'sine.inOut', repeat: -1, yoyo: true });

  if (stage && window.matchMedia('(pointer: fine)').matches) {
    const tiltX = gsap.quickTo('.crest-spin', 'rotateX', { duration: 0.9, ease: 'power3.out' });
    const tiltY = gsap.quickTo('.crest-spin', 'rotateY', { duration: 0.9, ease: 'power3.out' });
    const hero = document.getElementById('hero');
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      tiltY(((e.clientX - r.left) / r.width - 0.5) * 26);
      tiltX(-((e.clientY - r.top) / r.height - 0.5) * 18);
    });
    hero.addEventListener('pointerleave', () => { tiltX(0); tiltY(0); });
  }

  // ── preloader → hero intro ─────────────────────────────────────────────────
  const heroLines = gsap.utils.toArray('#hero .line > span');
  const heroFades = gsap.utils.toArray('[data-hero-fade]');
  gsap.set(heroLines, { yPercent: 115 });
  gsap.set(heroFades, { autoAlpha: 0, y: 26 });
  gsap.set('.crest-stage', { autoAlpha: 0, scale: 0.82 });
  gsap.set('#navbar', { yPercent: -140 });

  const intro = gsap.timeline({
    paused: true,
    onComplete: () => {
      gsap.set('#navbar', { clearProps: 'transform' });
      ScrollTrigger.refresh();
    },
  });
  intro
    .to('.crest-stage', { autoAlpha: 1, scale: 1, duration: 1.8, ease: 'expo.out' }, 0)
    .to(heroLines, { yPercent: 0, duration: 1.25, ease: 'expo.out', stagger: 0.09 }, 0.1)
    .to(heroFades, { autoAlpha: 1, y: 0, duration: 1.1, ease: 'power3.out', stagger: 0.08 }, 0.35)
    .to('#navbar', { yPercent: 0, duration: 1.1, ease: 'expo.out' }, 0.3);

  let released = false;
  function release() {
    if (released) return;
    released = true;
    root.classList.remove('is-loading');
    if (lenis) lenis.start();
    intro.play();
  }

  if (pre) {
    const strokes = pre.querySelectorAll('path');
    const counter = pre.querySelector('.preloader__count');
    const count = { v: 0 };
    strokes.forEach((p) => {
      const len = p.getTotalLength();
      gsap.set(p, { strokeDasharray: len, strokeDashoffset: len });
    });
    gsap.timeline()
      .to(strokes, { strokeDashoffset: 0, duration: 1.3, ease: 'power2.inOut' }, 0)
      .to(count, {
        v: 100, duration: 1.4, ease: 'power2.inOut',
        onUpdate: () => { counter.textContent = String(Math.round(count.v)).padStart(3, '0'); },
      }, 0)
      .to(strokes, { fill: 'rgba(46,242,162,1)', duration: 0.4, ease: 'power2.out' }, 1.2)
      .to(pre, { yPercent: -100, duration: 0.95, ease: 'expo.inOut', onStart: release, onComplete: () => pre.remove() }, 1.65);
  } else {
    release();
  }

  // ── hero scroll-out ────────────────────────────────────────────────────────
  const heroOut = { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: true };
  gsap.to('.hero-copy', { yPercent: -14, opacity: 0.1, ease: 'none', scrollTrigger: heroOut });
  gsap.to('.crest-drift', { yPercent: 16, scale: 1.14, ease: 'none', scrollTrigger: heroOut });
  // children, not .hero-meta itself: the intro already fades that element in
  gsap.fromTo('.hero-meta > *', { opacity: 1 }, { opacity: 0, ease: 'none', scrollTrigger: { trigger: '#hero', start: 'top top', end: '30% top', scrub: true } });

  // ── nav: hide on the way down, return on the way up ────────────────────────
  const nav = document.getElementById('navbar');
  ScrollTrigger.create({
    start: 0, end: 'max',
    onUpdate: (self) => nav.classList.toggle('is-hidden', self.direction === 1 && self.scroll() > 400),
  });

  gsap.to('.scroll-progress', { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0.3 } });

  // ── headings: line-mask reveal ─────────────────────────────────────────────
  gsap.utils.toArray('[data-lines]').forEach((el) => {
    if (el.closest('#hero')) return;
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

  // ── imagery ────────────────────────────────────────────────────────────────
  gsap.utils.toArray('[data-parallax] img').forEach((img) => {
    gsap.fromTo(img, { scale: 1.18, yPercent: -5 }, {
      scale: 1.02, yPercent: 5, ease: 'none',
      scrollTrigger: { trigger: img.closest('[data-parallax]'), start: 'top bottom', end: 'bottom top', scrub: true },
    });
  });
  const teamMedia = document.querySelector('.team-media');
  if (teamMedia) {
    gsap.fromTo(teamMedia, { clipPath: 'inset(9% 11% 9% 11% round 28px)' }, {
      clipPath: 'inset(0% 0% 0% 0% round 28px)', ease: 'none',
      scrollTrigger: { trigger: teamMedia, start: 'top 92%', end: 'top 22%', scrub: true },
    });
  }

  // ── footer wordmark ────────────────────────────────────────────────────────
  gsap.from('.footer-wordmark span', {
    yPercent: 100, duration: 1.3, ease: 'expo.out', stagger: 0.06,
    scrollTrigger: { trigger: '.footer-wordmark', start: 'top 96%', once: true },
  });

  // ── magnetic buttons ───────────────────────────────────────────────────────
  if (window.matchMedia('(pointer: fine)').matches) {
    document.querySelectorAll('[data-magnetic]').forEach((btn) => {
      const mx = gsap.quickTo(btn, 'x', { duration: 0.5, ease: 'power3.out' });
      const my = gsap.quickTo(btn, 'y', { duration: 0.5, ease: 'power3.out' });
      btn.addEventListener('pointermove', (e) => {
        const r = btn.getBoundingClientRect();
        mx((e.clientX - r.left - r.width / 2) * 0.22);
        my((e.clientY - r.top - r.height / 2) * 0.3);
      });
      btn.addEventListener('pointerleave', () => { mx(0); my(0); });
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
})();
