/* Studio M lighting package → branded PDF (US Letter, landscape).
   Needs jsPDF 2.5.x, jspdf-autotable 3.8.x, window.SM_PDF_FONTS (Jost 200–500, base64 TTF). */
window.buildStudioMPdf = function (pkg, BY, IMG, opts) {
  opts = opts || {};
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const F = window.SM_PDF_FONTS;
  for (const w of ['200', '300', '400', '500']) { doc.addFileToVFS(`Jost-${w}.ttf`, F[w]); doc.addFont(`Jost-${w}.ttf`, `J${w}`, 'normal'); }

  const W = 792, H = 612, M = 40, CW = W - M * 2, COL = (CW - 11 * 16) / 12;
  const cx = n => M + n * (COL + 16);               // left edge of column n (0-based)
  const span = n => n * COL + (n - 1) * 16;          // width of n columns
  const INK = [27, 27, 27], MUTE = [110, 109, 105], HAIR = [227, 225, 220], RED = [179, 20, 28];

  const font = (w, size, color) => { doc.setFont(`J${w}`, 'normal'); doc.setFontSize(size); doc.setTextColor(...(color || INK)); };
  const label = (t, x, y, color, align) => { font(500, 6.8, color || INK); txt(String(t).toUpperCase(), x, y, { charSpace: 1.6, align }); };
  const txt = (t, x, y, o) => {
    o = o || {};
    if (o.align === 'right' || o.align === 'center') {
      const w = doc.getTextWidth(t) + (o.charSpace || 0) * Math.max(0, t.length - 1);
      x = o.align === 'right' ? x - w : x - w / 2;
    }
    doc.text(t, x, y, { charSpace: o.charSpace || 0, baseline: 'alphabetic' });
  };
  const rule = (x1, y, x2, wt, c) => { doc.setDrawColor(...(c || INK)); doc.setLineWidth(wt || .5); doc.line(x1, y, x2, y); };
  const wrap = (t, w) => doc.splitTextToSize(String(t || ''), w);
  const para = (t, x, y, w, lh, maxLines) => {
    let lines = wrap(t, w);
    if (maxLines && lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].replace(/\s+\S*$/, '') + '…'; }
    lines.forEach((l, i) => doc.text(l, x, y + i * lh));
    return y + lines.length * lh;
  };
  const wordmark = (x, y, size, align) => {
    font(400, size); const cs = size * .32;
    const a = 'STUDIO', b = 'M';
    const wa = doc.getTextWidth(a) + cs * a.length, dot = size * .3, gap = size * .12, wb = doc.getTextWidth(b);
    const total = wa + dot + gap + wb;
    let x0 = align === 'center' ? x - total / 2 : x;
    doc.text(a, x0, y, { charSpace: cs });
    doc.setFillColor(...INK); doc.circle(x0 + wa + dot / 2 - cs * .3, y - size * .36, dot / 2, 'F');
    doc.text(b, x0 + wa + dot + gap - cs * .3, y);
  };
  const plate = (id, x, y, w, h, pad) => {
    const p = BY[id], src = IMG && IMG[id];
    doc.setFillColor(255, 255, 255); doc.rect(x, y, w, h, 'F');
    if (!src) return;
    pad = pad == null ? .08 : pad;
    const bw = w * (1 - pad * 2), bh = h * (1 - pad * 2), r = Math.min(bw / (p.iw || 1), bh / (p.ih || 1));
    const iw = (p.iw || 1) * r, ih = (p.ih || 1) * r;
    try { doc.addImage(src, 'JPEG', x + (w - iw) / 2, y + (h - ih) / 2, iw, ih, id, 'FAST'); } catch (e) { /* skip unreadable image */ }
  };

  const order = []; pkg.rooms.forEach(r => r.items.forEach(i => { if (!order.includes(i.id)) order.push(i.id); }));
  const num = id => String(order.indexOf(id) + 1).padStart(2, '0');
  const pieces = pkg.rooms.reduce((a, r) => a + r.items.reduce((b, i) => b + i.qty, 0), 0);
  const date = opts.date || new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  const title = pkg.title || 'Lighting Package';

  const chrome = () => {
    label('Design', M, 30, MUTE);
    wordmark(W / 2, 32, 11, 'center');
    label('Lighting Package', W - M, 30, MUTE, 'right');
    rule(M, 44, W - M, .5, HAIR);
  };
  const newPage = first => { if (!first) doc.addPage(); chrome(); };

  /* 1 · cover */
  newPage(true);
  rule(M, 64, W - M, 2.5);
  label('Lighting Package', M, 84);
  label(`${date}  ·  ${pkg.rooms.length} rooms  ·  ${pieces} fixtures`, W - M, 84, MUTE, 'right');
  const heroId = BY[pkg.hero] ? pkg.hero : order[0];
  const hx = cx(7), hw = span(5), hy = 104, hh = 400;
  plate(heroId, hx, hy, hw, hh, .06);
  font(500, 7.5, RED); txt(`PLATE ${num(heroId)}`, hx, hy + hh + 18, { charSpace: 1 });
  const hp = BY[heroId]; font(300, 8.5, MUTE); para(`${hp.coll}, ${hp.name} · ${hp.designer}`, hx + 58, hy + hh + 18, hw - 58, 11, 2);
  font(200, 46); let ty = para(title, M, 150, span(7) - 10, 46, 4);
  if (pkg.brief) {
    font(300, 12, INK); const lines = wrap(pkg.brief, span(6) - 20).slice(0, 6);
    const qy = ty + 24; doc.setFillColor(...INK); doc.rect(M, qy - 11, 2.5, lines.length * 16 + 4, 'F');
    lines.forEach((l, i) => doc.text(l, M + 16, qy + i * 16));
  }
  font(300, 8, MUTE); txt(opts.sourceNote || 'Composed from the Studio M collection.', M, hy + hh + 18);

  /* 2 · idea + palette */
  newPage();
  rule(M, 64, W - M, .75); label('The idea', M, 82);
  font(200, 19); let y = para(pkg.thesis, cx(3), 92, span(9), 25, 7) + 14;
  const pw = (span(9) - 32) / 3;
  (pkg.principles || []).slice(0, 3).forEach((p, i) => {
    const x = cx(3) + i * (pw + 16); rule(x, y, x + pw, 2.5);
    font(500, 9.5); doc.text(p.h, x, y + 18);
    font(300, 8.5, MUTE); para(p.t, x, y + 32, pw, 12, 5);
  });
  y += 110;
  rule(M, y, W - M, .75); label('Palette', M, y + 18);
  const sw = [...(pkg.palette.finishes || []).map(n => [n, 'Finish']), ...(pkg.palette.materials || []).map(n => [n, 'Material'])].slice(0, 8);
  const sz = 56, sg = (span(9) - sz * 8) / 7 + sz;
  sw.forEach(([n, k], i) => {
    const x = cx(3) + i * sg, c = hex(window.SM_SWATCH ? window.SM_SWATCH(n) : '#cfcac2');
    doc.setFillColor(...c); doc.setDrawColor(...HAIR); doc.setLineWidth(.5); doc.rect(x, y + 10, sz, sz, 'FD');
    font(400, 7.5); para(n, x, y + sz + 22, sz + 4, 9.5, 2);
    label(k, x, y + sz + 46, MUTE);
  });
  const ky = y + sz + 74;
  [[pkg.palette.cct || '2700K–3000K', 'Color temperature'], ['90+', 'CRI, integrated LED'], [String(order.length), 'Distinct pieces'], [String(pieces), 'Fixtures in total']].forEach(([a, b], i) => {
    const x = cx(3) + [0, .36, .62, .82][i] * span(9); font(200, 22); doc.text(a, x, ky + 4); font(300, 8, MUTE); doc.text(b, x, ky + 18);
  });

  /* 3 · collection sheet */
  const per = 12, cols = 6, cw = (CW - 5 * 16) / cols;
  for (let s = 0; s < order.length; s += per) {
    newPage(); rule(M, 64, W - M, .75); label(s ? 'The collection, continued' : 'The collection', M, 82);
    order.slice(s, s + per).forEach((id, k) => {
      const x = M + (k % cols) * (cw + 16), y0 = 98 + Math.floor(k / cols) * 236, p = BY[id];
      plate(id, x, y0, cw, cw);
      doc.setDrawColor(...HAIR); doc.setLineWidth(.5); doc.rect(x, y0, cw, cw, 'S');
      font(500, 7.5, RED); doc.text(num(id), x, y0 + cw + 15);
      label(p.coll, x + cw, y0 + cw + 15, MUTE, 'right');
      font(400, 8.5); para(p.name, x, y0 + cw + 29, cw, 10.5, 2);
      font(300, 7, MUTE); doc.text(p.designer.toUpperCase(), x, y0 + cw + 52, { charSpace: .8 });
    });
  }

  /* 4 · rooms */
  pkg.rooms.forEach((r, ri) => {
    const chunks = []; for (let i = 0; i < r.items.length; i += 3) chunks.push(r.items.slice(i, i + 3));
    chunks.forEach((items, ci) => {
      newPage(); rule(M, 64, W - M, .75);
      label(`Room ${ri + 1} of ${pkg.rooms.length}${ci ? ' · continued' : ''}`, M, 82, MUTE);
      font(200, 30); const ny = para(r.name, M, 118, span(4) - 8, 32, 3);
      if (!ci) { font(300, 9.5, MUTE); para(r.note, M, ny + 8, span(4) - 16, 13.5, 14); }
      const x0 = cx(4), rw = span(8), rowH = 160;
      items.forEach((it, k) => {
        const p = BY[it.id], y0 = 72 + k * rowH;
        if (k) rule(x0, y0 - 8, x0 + rw, .5, HAIR);
        plate(it.id, x0, y0, 130, 130); doc.setDrawColor(...HAIR); doc.rect(x0, y0, 130, 130, 'S');
        const ix = x0 + 150, iw = rw - 150;
        font(500, 7.5, RED); doc.text(num(it.id), ix, y0 + 10);
        label(it.role, ix + 22, y0 + 10);
        font(500, 6.3); const lt = it.layer.toUpperCase(), lw = doc.getTextWidth(lt) + 1.4 * (lt.length - 1) + 10;
        const lx = ix + 22 + doc.getTextWidth(String(it.role).toUpperCase()) * (6.8 / 6.3) + 1.6 * String(it.role).length + 12;
        doc.setDrawColor(...INK); doc.setLineWidth(.6); doc.rect(lx, y0 + 2, lw, 11, 'S'); doc.text(lt, lx + 5, y0 + 10, { charSpace: 1.4 });
        font(500, 8.5); doc.text(`× ${it.qty}`, lx + lw + 10, y0 + 10);
        font(400, 13); doc.text(p.coll, ix, y0 + 32);
        font(300, 9, MUTE); para(p.name, ix, y0 + 45, iw, 11, 1);
        font(300, 9.5); const wy = para(it.why, ix, y0 + 62, iw, 13, 4);
        font(300, 7.5, MUTE); const sy0 = Math.max(wy + 4, y0 + 116);
        para([p.designer, [p.finish, p.material].filter(Boolean).join(' / '), p.dims].filter(Boolean).join('   ·   '), ix, sy0, iw, 10, 1);
        para([p.lumens && p.lumens + ' lm', p.rating && p.rating + ' rated', p.id].filter(Boolean).join('   ·   '), ix, sy0 + 10, iw, 10, 1);
      });
    });
  });

  /* 5 · layers + schedule */
  newPage(); rule(M, 64, W - M, .75); label('How it layers', M, 82);
  const tbl = {
    theme: 'plain', rowPageBreak: 'avoid', margin: { left: M, right: M, top: 60, bottom: 50 },
    styles: { font: 'J300', fontSize: 8, textColor: INK, cellPadding: { top: 5, bottom: 5, left: 0, right: 8 }, lineColor: HAIR, lineWidth: { bottom: .5 } },
    headStyles: { font: 'J500', fontSize: 6.5, textColor: INK, lineColor: INK, lineWidth: { bottom: 1.5 } },
    didDrawPage: d => { if (d.pageNumber > 1) chrome(); }
  };
  const L = ['Ambient', 'Task', 'Accent'];
  doc.autoTable({ ...tbl, startY: 96,
    head: [['ROOM', ...L.map(l => l.toUpperCase())]],
    body: pkg.rooms.map(r => [r.name, ...L.map(l => r.items.filter(i => i.layer === l).map(i => `${num(i.id)}  ${BY[i.id].coll}`).join('\n') || '·')]),
    columnStyles: { 0: { font: 'J400', cellWidth: 150 } } });
  newPage(); const sy = 64;
  rule(M, sy, W - M, .75); label('Schedule', M, sy + 18);
  doc.autoTable({ ...tbl, startY: sy + 30,
    head: [['PLATE', 'ROOM', 'QTY', 'MODEL', 'COLLECTION', 'FIXTURE', 'FINISH', 'DIMENSIONS', 'LUMENS', 'RATING']],
    body: pkg.rooms.flatMap(r => r.items.map(i => { const p = BY[i.id]; return [num(i.id), r.name, String(i.qty), p.id, p.coll, p.name, p.finish, p.dims, p.lumens || '—', p.rating || '—']; })),
    columnStyles: { 0: { cellWidth: 34, font: 'J500', textColor: RED }, 2: { cellWidth: 28 } } });
  let fy = doc.lastAutoTable.finalY + 30;
  if (fy > H - 70) { newPage(); fy = 80; }
  rule(M, fy, W - M, 2.5);
  font(300, 8.5, MUTE); para('Selections are a starting point. Confirm sizing, mounting heights and lamping with your Studio M representative. Product details reflect the Studio M collection at the time of composition.', M, fy + 18, span(7), 12, 3);
  wordmark(W - M - 76, fy + 26, 12);

  /* footers */
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); rule(M, H - 34, W - M, .5, HAIR);
    label('design.studiomlighting.com', M, H - 20, MUTE);
    font(300, 7.5, MUTE); txt(title, W / 2, H - 20, { align: 'center' });
    label(`${String(i).padStart(2, '0')} / ${String(n).padStart(2, '0')}`, W - M, H - 20, MUTE, 'right');
  }
  return doc;

  function hex(h) { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); }
};
