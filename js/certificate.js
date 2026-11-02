// amaze academy — certificate renderer
//
// Draws a certificate onto a canvas: the blank template (img/certificate-template.jpg) plus the three
// things that change — the learner's name, the course title and the date — and a small reference line.
// The same canvas is what the page shows, what "download image" saves and what "download pdf" wraps,
// so all three always match.
//
//   AmazeCert.render({ name, title, date, ref }) -> Promise<HTMLCanvasElement>
//   AmazeCert.png(canvas)  -> Promise<Blob>
//   AmazeCert.pdf(canvas)  -> Promise<Blob>      (one A4 landscape page, no library needed)
//   AmazeCert.save(blob, filename)
//
// Positions are in pixels of the 1748 x 1240 template and were measured from the approved draft.
// If the template is ever swapped for one of a different size, only the numbers in LAYOUT change.
(function () {
  'use strict';

  var TEMPLATE = '/img/certificate-template.jpg';
  var W = 1748, H = 1240;      // template size
  var SCALE = 2;               // drawn at 2x so the text stays sharp when printed
  var FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
  var GREEN = '#23f391';       // the template's own green

  var LAYOUT = {
    cx: 874,                                   // the centre line of the certificate
    // `track` is letter-spacing in em; the draft's typeface is a little tighter than Arial/Helvetica
    name:  { baseline: 524, size: 104, min: 30, maxWidth: 1000, color: GREEN, weight: 700, track: -0.02 },
    title: { baseline: 629, size: 34,  min: 22, maxWidth: 900,  color: '#ffffff', weight: 700, track: -0.03,
             // titles too long for one line at the minimum size break onto two
             two: { size: 27, baselines: [611, 643] } },
    date:  { baseline: 710, size: 34, color: '#ffffff', weight: 700, track: -0.015, dx: 5 },
    ref:   { baseline: 1186, size: 17, color: 'rgba(255,255,255,0.5)', show: true }
  };

  var MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

  // "1 november, 2026"
  function formatDate(d) {
    var x = d instanceof Date ? d : new Date(d);
    if (isNaN(x)) x = new Date();
    return x.getDate() + ' ' + MONTHS[x.getMonth()] + ', ' + x.getFullYear();
  }

  var templateReady = null;
  function loadTemplate() {
    if (!templateReady) {
      templateReady = new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { templateReady = null; reject(new Error('the certificate template could not be loaded')); };
        img.src = TEMPLATE;
      });
    }
    return templateReady;
  }

  // letter-spacing is set along with the font (browsers without ctx.letterSpacing simply skip it)
  var tracking = 0;
  function setFont(ctx, weight, size) {
    ctx.font = weight + ' ' + size + 'px ' + FONT;
    if ('letterSpacing' in ctx) ctx.letterSpacing = (tracking * size).toFixed(2) + 'px';
  }

  // the largest size, from `size` down to `min`, at which `text` fits in `maxWidth`
  function fit(ctx, text, spec) {
    var size = spec.size;
    tracking = spec.track || 0;
    setFont(ctx, spec.weight, size);
    while (size > spec.min && ctx.measureText(text).width > spec.maxWidth) { size -= 1; setFont(ctx, spec.weight, size); }
    return size;
  }

  // split a long title into two lines of about equal width, at a space
  function twoLines(ctx, text) {
    var words = text.split(/\s+/);
    if (words.length < 2) return [text, ''];
    var best = null, bestGap = Infinity;
    for (var i = 1; i < words.length; i++) {
      var a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
      var gap = Math.abs(ctx.measureText(a).width - ctx.measureText(b).width);
      if (gap < bestGap) { bestGap = gap; best = [a, b]; }
    }
    return best;
  }

  function line(ctx, text, y, spec, size) {
    tracking = spec.track || 0;
    setFont(ctx, spec.weight, size);
    ctx.fillStyle = spec.color;
    ctx.fillText(text, LAYOUT.cx + (spec.dx || 0), y);
  }

  function render(o) {
    o = o || {};
    var name = String(o.name || '').trim().replace(/\s+/g, ' ').toLowerCase();
    var title = String(o.title || '').trim().replace(/\s+/g, ' ').toLowerCase();
    var date = formatDate(o.date || new Date());
    var ref = String(o.ref || '').trim();

    return loadTemplate().then(function (img) {
      var canvas = document.createElement('canvas');
      canvas.width = W * SCALE; canvas.height = H * SCALE;
      var ctx = canvas.getContext('2d');
      ctx.scale(SCALE, SCALE);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, W, H);
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';

      // name
      if (name) {
        var nameSize = fit(ctx, name, LAYOUT.name);
        line(ctx, name, LAYOUT.name.baseline, LAYOUT.name, nameSize);
      }

      // course title — one line if it fits, otherwise two
      if (title) {
        var t = LAYOUT.title;
        var size = fit(ctx, title, t);
        if (ctx.measureText(title).width <= t.maxWidth) {
          line(ctx, title, t.baseline, t, size);
        } else {
          tracking = t.track || 0;
          setFont(ctx, t.weight, t.two.size);
          var parts = twoLines(ctx, title);
          var s2 = t.two.size;
          // very long halves are shrunk a little more rather than run off the page
          while (s2 > 18 && Math.max(ctx.measureText(parts[0]).width, ctx.measureText(parts[1]).width) > t.maxWidth) { s2 -= 1; setFont(ctx, t.weight, s2); }
          line(ctx, parts[0], t.two.baselines[0], t, s2);
          line(ctx, parts[1], t.two.baselines[1], t, s2);
        }
      }

      // date
      line(ctx, date, LAYOUT.date.baseline, LAYOUT.date, LAYOUT.date.size);

      // reference, so anyone can check the certificate is genuine
      if (ref && LAYOUT.ref.show) {
        var r = LAYOUT.ref;
        tracking = 0;
        setFont(ctx, 400, r.size);
        ctx.fillStyle = r.color;
        ctx.fillText('certificate id ' + ref + '   ·   verify at amazeconsortium.org/academy/certificate/' + ref, LAYOUT.cx, r.baseline);
      }
      return canvas;
    });
  }

  function toBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('could not make the file')); }, type, quality);
    });
  }

  function png(canvas) { return toBlob(canvas, 'image/png'); }

  // A one-page PDF with the certificate as a full-page JPEG. Written by hand: a PDF this simple is a
  // handful of objects, so no library is needed (and nothing extra for the page's CSP to allow).
  function pdf(canvas) {
    return toBlob(canvas, 'image/jpeg', 0.93).then(function (jpg) { return jpg.arrayBuffer(); }).then(function (jpeg) {
      var enc = new TextEncoder();
      var pw = 841.89, ph = 595.28;                       // A4 landscape, in points
      var parts = [], offsets = [], size = 0;
      function push(x) { var b = typeof x === 'string' ? enc.encode(x) : new Uint8Array(x); parts.push(b); size += b.length; }
      function obj(n, body) { offsets[n] = size; push(n + ' 0 obj\n'); push(body); push('\nendobj\n'); }

      push('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');
      obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
      obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
      obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw + ' ' + ph + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
      // object 4 is the image stream
      offsets[4] = size;
      push('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + canvas.width + ' /Height ' + canvas.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.byteLength + ' >>\nstream\n');
      push(jpeg);
      push('\nendstream\nendobj\n');
      var content = 'q ' + pw + ' 0 0 ' + ph + ' 0 0 cm /Im0 Do Q';
      obj(5, '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
      obj(6, '<< /Title (amaze academy certificate) /Producer (amaze academy) >>');

      var xref = size;
      var table = 'xref\n0 7\n0000000000 65535 f \n';
      for (var i = 1; i <= 6; i++) table += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
      push(table + 'trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
      return new Blob(parts, { type: 'application/pdf' });
    });
  }

  function save(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  window.AmazeCert = { render: render, png: png, pdf: pdf, save: save, formatDate: formatDate, layout: LAYOUT };
})();
