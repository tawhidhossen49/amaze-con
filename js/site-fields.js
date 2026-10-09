// ── EDITABLE FIELDS ─────────────────────────────────────────────────────────
// The single list of everything the admin panel can edit on the static pages.
// Each field is [key, label, selector, type]:
//   key       where the value is stored (site_text.key)
//   selector  the element on the page it controls
//   type      text  plain text (decorative icons/arrows inside are kept)
//             html  text that may contain <em>, <span class="accent">, <a>, <br>
//             stat  a number shown with a count-up, e.g. "25+"
//             href  a link address
//             src   an image
//             visible  a whole section, shown or hidden
//             pre   a long text shown exactly as typed: every line break and space kept
// js/site-text.js applies saved values on the public pages; the admin panel
// reads this same list to build its forms and pulls each field's current
// built-in wording straight from the page. To make something new editable,
// add a line here — nothing else needs to change.
(function () {
  const line = (scope, n) => `${scope} .line:nth-child(${n}) > span`;
  // label + heading lines for a standard section header
  const head = (key, scope, lines, titleSel = '.section-title') => [
    [`${key}.label`, 'small label', `${scope} .section-label`],
    ...Array.from({ length: lines }, (_, i) => [`${key}.title${i + 1}`, `heading — line ${i + 1}`, line(`${scope} ${titleSel}`, i + 1), 'html']),
  ];
  const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

  const home = {
    id: 'home', title: 'home', file: 'index.html',
    groups: [
      { name: 'show / hide sections', fields: [
        ['home.show.schools', 'schools strip', '#marquee-strip', 'visible'],
        ['home.show.about', 'about', '#about', 'visible'],
        ['home.show.subs', 'subsidiaries', '#divisions', 'visible'],
        ['home.show.founder', 'founder', '#founder', 'visible'],
        ['home.show.execs', 'executives', '#executives', 'visible'],
        ['home.show.advisors', 'advisors', '#advisors', 'visible'],
        ['home.show.opps', 'opportunities', '#opportunities', 'visible'],
        ['home.show.team', 'team', '#team', 'visible'],
        ['home.show.partners', 'partners', '#partners', 'visible'],
        ['home.show.contact', 'contact', '#contact', 'visible'],
      ] },
      { name: 'navigation', fields: [
        ['home.nav.cta', 'button text', '#navbar .nav-cta'],
        ['home.nav.cta.href', 'button link', '#navbar .nav-cta', 'href'],
      ] },
      { name: 'hero — headline', fields: [
        ['home.hero.tag', 'small label', '#hero .cap--lead .hero-tag'],
        ...range(3).map((i) => [`home.hero.line${i}`, `headline — line ${i}`, line('#hero .hero-h1', i), 'html']),
        ['home.hero.sub', 'paragraph', '#hero .hero-sub'],
        ['home.hero.cta1', 'first button text', '#hero .hero-buttons a:nth-child(1)'],
        ['home.hero.cta1.href', 'first button link', '#hero .hero-buttons a:nth-child(1)', 'href'],
        ['home.hero.cta2', 'second button text', '#hero .hero-buttons a:nth-child(2)'],
        ['home.hero.cta2.href', 'second button link', '#hero .hero-buttons a:nth-child(2)', 'href'],
      ] },
      { name: 'hero — numbers', fields: [
        ['home.hero.facts.tag', 'small label', '#hero .cap--facts .hero-tag'],
        ...range(4).flatMap((i) => [
          [`home.hero.stat${i}.num`, `number ${i}`, `#hero .hero-stats li:nth-child(${i}) b`],
          [`home.hero.stat${i}.label`, `number ${i} — caption`, `#hero .hero-stats li:nth-child(${i}) span`],
        ]),
        ['home.hero.link', 'link text', '#hero .hero-link'],
        ['home.hero.link.href', 'link address', '#hero .hero-link', 'href'],
      ] },
      { name: 'schools strip', fields: [['home.schools.label', 'label', '.mq-head span']] },
      { name: 'about', fields: [
        ...head('home.about', '#about', 3),
        ['home.about.text', 'text — paste the whole thing here', '#about .about-right .about-text', 'pre'],
        ['home.about.manifesto', 'large statement', '.manifesto'],
        ...range(4).flatMap((i) => [
          [`home.about.stat${i}.num`, `stat ${i}`, `.about-stats .stat:nth-child(${i}) .stat-num`, 'stat'],
          [`home.about.stat${i}.label`, `stat ${i} — caption`, `.about-stats .stat:nth-child(${i}) .stat-label`],
        ]),
      ] },
      { name: 'subsidiaries', fields: [...head('home.subs', '#divisions', 2), ['home.subs.sub', 'intro text', '.divisions-sub']] },
      { name: 'founder', fields: [
        ['home.founder.label', 'small label', '#founder .section-label'],
        ['home.founder.photo', 'photo', '.founder-img', 'src'],
        ['home.founder.link', 'photo link', '.founder-img-wrap a', 'href'],
        ['home.founder.quote', 'quote', '.founder-quote', 'html'],
        ['home.founder.bio1', 'paragraph 1', '.founder-content .founder-bio:nth-of-type(1)'],
        ['home.founder.bio2', 'paragraph 2', '.founder-content .founder-bio:nth-of-type(2)'],
        ['home.founder.name', 'name', '.founder-sign .founder-name'],
        ['home.founder.role', 'title', '.founder-sign .founder-title'],
        ['home.founder.overlay.name', 'name on photo', '.founder-name-overlay strong'],
        ['home.founder.overlay.role', 'title on photo', '.founder-name-overlay small'],
      ] },
      { name: 'executives', fields: head('home.execs', '#executives', 2) },
      { name: 'advisors', fields: [...head('home.advisors', '#advisors', 2), ['home.advisors.sub', 'intro text', '#advisors .section-sub']] },
      { name: 'opportunities', fields: [
        ...head('home.opps', '#opportunities', 1),
        ['home.opps.sub', 'intro text', '.opps-sub'],
        // rows are addressed by data-opp, not by position, so saved text stays with
        // its own row when one is removed (2 was "ambassador & representative")
        ...[1, 3, 4].flatMap((i, n) => [
          [`home.opps.${i}.name`, `item ${n + 1} — title`, `.opp-row[data-opp="${i}"] .opp-name`],
          [`home.opps.${i}.desc`, `item ${n + 1} — description`, `.opp-row[data-opp="${i}"] .opp-desc`],
          [`home.opps.${i}.action`, `item ${n + 1} — button word`, `.opp-row[data-opp="${i}"] .opp-action b`],
          [`home.opps.${i}.href`, `item ${n + 1} — link`, `.opp-row[data-opp="${i}"]`, 'href'],
        ]),
      ] },
      { name: 'team', fields: [
        ['home.team.label', 'small label', '#team .section-label'],
        ['home.team.photo', 'photo', '.team-img', 'src'],
        ['home.team.caption', 'photo caption', '.team-caption'],
        ['home.team.title1', 'heading — line 1', line('.team-title', 1), 'html'],
        ['home.team.title2', 'heading — line 2', line('.team-title', 2), 'html'],
        ['home.team.p1', 'paragraph 1', '.team-desc:nth-of-type(1)'],
        ['home.team.p2', 'paragraph 2', '.team-desc:nth-of-type(2)'],
      ] },
      { name: 'partners', fields: [...head('home.partners', '#partners', 2), ['home.partners.sub', 'intro text', '#partners .section-sub']] },
      { name: 'contact', fields: [
        ['home.contact.title1', 'heading — line 1', line('.contact-title', 1), 'html'],
        ['home.contact.title2', 'heading — line 2', line('.contact-title', 2), 'html'],
        ['home.contact.email.label', 'email label', '.contact-email small'],
        ['home.contact.email', 'email shown', '.contact-email a.mail'],
        ['home.contact.email.href', 'email link (mailto:…)', '.contact-email a.mail', 'href'],
        ['home.contact.wa', 'whatsapp text', '.contact-email a.wa'],
        ['home.contact.wa.href', 'whatsapp link', '.contact-email a.wa', 'href'],
        ['home.contact.socials.label', 'socials label', '.socials-label'],
        ...['instagram', 'youtube', 'facebook', 'whatsapp group', 'linkedin'].map((n, i) => [`home.contact.social${i + 1}.href`, `${n} link`, `.socials a:nth-child(${i + 1})`, 'href']),
      ] },
      { name: 'footer', fields: [
        ['home.footer.tagline', 'tagline', '.footer-logo span:last-child'],
        ['home.footer.copy', 'copyright line', '.footer-copy'],
      ] },
    ],
  };

  // the apprenticeship / structure / academy pages share one skeleton.
  // (page ids and keys keep their first names — 'academy' is the apprenticeship page,
  // 'courses' is the academy page — because saved text is stored under them.)
  const sect = (n) => `section:nth-of-type(${n})`;
  const pageHero = (key, metaCount) => ({ name: 'page top', fields: [
    [`${key}.hero.tag`, 'small label', '.page-hero .hero-tag'],
    [`${key}.hero.title1`, 'headline — line 1', line('.page-h1', 1), 'html'],
    [`${key}.hero.title2`, 'headline — line 2', line('.page-h1', 2), 'html'],
    [`${key}.hero.sub`, 'paragraph', '.page-sub'],
    ...range(metaCount).flatMap((i) => [
      [`${key}.hero.meta${i}.label`, `fact ${i} — label`, `.page-meta li:nth-child(${i}) small`],
      [`${key}.hero.meta${i}.value`, `fact ${i} — value`, `.page-meta li:nth-child(${i}) span`],
    ]),
  ] });
  const sectHead = (key, n) => [
    [`${key}.label`, 'small label', `${sect(n)} .section-label`],
    [`${key}.title1`, 'heading — line 1', line(`${sect(n)} .sect-title`, 1), 'html'],
    [`${key}.title2`, 'heading — line 2', line(`${sect(n)} .sect-title`, 2), 'html'],
  ];
  const cells = (key, n, count, what) => range(count).flatMap((i) => [
    [`${key}.${i}.name`, `${what} ${i} — title`, `${sect(n)} .cell:nth-child(${i}) .cell-name`],
    [`${key}.${i}.desc`, `${what} ${i} — description`, `${sect(n)} .cell:nth-child(${i}) .cell-desc`],
  ]);
  const cta = (key) => ({ name: 'closing call to action', fields: [
    [`${key}.cta.title1`, 'heading — line 1', line('.page-cta-title', 1), 'html'],
    [`${key}.cta.title2`, 'heading — line 2', line('.page-cta-title', 2), 'html'],
    [`${key}.cta.button`, 'button text', '.page-cta .btn-primary'],
    [`${key}.cta.href`, 'button link', '.page-cta .btn-primary', 'href'],
  ] });

  const academy = {
    id: 'academy', title: 'apprenticeship', file: 'apprenticeship/index.html',
    groups: [
      { name: 'show / hide sections', fields: [
        ['academy.show.why', 'why it exists', sect(2), 'visible'],
        ['academy.show.how', 'how it works', sect(3), 'visible'],
        ['academy.show.get', 'what you get', sect(4), 'visible'],
        ['academy.show.cta', 'closing call to action', '.page-cta', 'visible'],
      ] },
      pageHero('academy', 3),
      { name: 'why it exists', fields: [...sectHead('academy.why', 2),
        ['academy.why.p1', 'paragraph 1', `${sect(2)} .sect-copy p:nth-child(1)`],
        ['academy.why.p2', 'paragraph 2', `${sect(2)} .sect-copy p:nth-child(2)`]] },
      { name: 'how it works', fields: [...sectHead('academy.how', 3), ...cells('academy.how', 3, 4, 'stage')] },
      { name: 'what you get', fields: [...sectHead('academy.get', 4), ...cells('academy.get', 4, 4, 'benefit')] },
      cta('academy'),
    ],
  };

  const structure = {
    id: 'structure', title: 'our structure', file: 'structure/index.html',
    groups: [
      { name: 'show / hide sections', fields: [
        ['structure.show.model', 'the model and chart', sect(2), 'visible'],
        ['structure.show.pillars', 'what the parent provides', sect(3), 'visible'],
        ['structure.show.cta', 'closing call to action', '.page-cta', 'visible'],
      ] },
      pageHero('structure', 3),
      { name: 'the model', fields: [...sectHead('structure.model', 2),
        ['structure.model.p1', 'paragraph 1', `${sect(2)} .sect-copy p:nth-child(1)`, 'html'],
        ['structure.model.p2', 'paragraph 2', `${sect(2)} .sect-copy p:nth-child(2)`],
        ['structure.org.parent', 'chart — parent name', '.org-parent-name'],
        ['structure.org.parent.tag', 'chart — parent caption', '.org-parent-tag'],
        ...range(5).flatMap((i) => [
          [`structure.org.${i}.name`, `chart — subsidiary ${i}`, `.org-child:nth-child(${i}) .org-child-name`],
          [`structure.org.${i}.tag`, `chart — subsidiary ${i} caption`, `.org-child:nth-child(${i}) .org-child-tag`],
        ])] },
      { name: 'what the parent provides', fields: [...sectHead('structure.pillars', 3), ...cells('structure.pillars', 3, 6, 'pillar')] },
      cta('structure'),
    ],
  };

  const courses = {
    id: 'courses', title: 'academy', file: 'academy/index.html',
    groups: [
      { name: 'show / hide sections', fields: [
        ['courses.show.why', 'why learn here', sect(3), 'visible'],
        ['courses.show.faq', 'questions', '#faq', 'visible'],
        ['courses.show.cta', 'closing call to action', '.page-cta', 'visible'],
      ] },
      { name: 'page top', fields: [
        ['courses.hero.tag', 'small label', '.page-hero .hero-tag'],
        ['courses.hero.title1', 'headline — line 1', line('.page-h1', 1), 'html'],
        ['courses.hero.title2', 'headline — line 2', line('.page-h1', 2), 'html'],
      ] },
      // which entries are featured is chosen on the academy screen (the ★ button, or the tick box in an entry)
      { name: 'featured card', fields: [
        ['courses.feat.show', 'show the featured card at the top of the page', '#aca-feature-wrap', 'visible'],
        ['courses.feat.label', 'small label above the card', '#aca-feature .feat-label'],
      ] },
      // the three sections of the academy; what is listed in each comes from the courses screen
      ...[['courses', 'courses'], ['programs', 'programs'], ['webinars', 'webinars']].map(([id, name]) => ({ name: `section — ${name}`, fields: [
        [`courses.sec.${id}.show`, 'show this section', `#${id}`, 'visible'],
        [`courses.sec.${id}.title`, 'heading', `#${id} .aca-title`],
        [`courses.sec.${id}.all`, '“all …” link text', `#${id} .aca-all`],
        [`courses.sec.${id}.empty`, 'shown while there is nothing in it', `#${id} .aca-empty`],
      ] })),
      { name: 'why learn here', fields: [...sectHead('courses.why', 3), ...cells('courses.why', 3, 4, 'reason')] },
      { name: 'questions', fields: [...sectHead('courses.faq', 4),
        ...range(5).flatMap((i) => [
          [`courses.faq.${i}.q`, `question ${i}`, `.faq-item:nth-child(${i}) .faq-q span`],
          [`courses.faq.${i}.a`, `answer ${i}`, `.faq-item:nth-child(${i}) .faq-a p`],
        ])] },
      cta('courses'),
    ],
  };

  // Legal pages: every text block is editable, addressed by its position.
  const legal = (id, title, file) => ({
    id, title, file,
    auto: '.page-h1, .page-sub, .meta-item span, .doc-highlight p, .sec-title, .doc-p, .doc-ul li',
  });

  window.AMAZE_PAGES = [
    home, academy, structure, courses,
    legal('tos', 'terms & conditions', 'tos/index.html'),
    legal('privacy', 'privacy policy', 'privacy/index.html'),
    legal('code', 'code of conduct', 'code/index.html'),
  ];

  // Resolves a page definition into a flat list of { key, label, type, el }
  // against a document (the live page, or a copy the admin panel fetched).
  window.AMAZE_resolveFields = function (page, doc) {
    const out = [];
    if (page.auto) {
      doc.querySelectorAll(page.auto).forEach((el, i) => {
        const kind = el.className.split(' ')[0] || el.tagName.toLowerCase();
        out.push({ key: `${page.id}.b${i}`, label: `${kind.replace(/^doc-|^sec-|^page-/, '')} ${i + 1}`, type: 'html', el, group: 'page text' });
      });
      return out;
    }
    page.groups.forEach((g) => g.fields.forEach(([key, label, selector, type = 'text']) => {
      out.push({ key, label, type, el: doc.querySelector(selector), group: g.name });
    }));
    return out;
  };
})();
