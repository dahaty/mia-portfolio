/* mía · схемы к статьям дней 1–14 (перенос ios/Mia/UI/ArticleFigures.swift): к каждому дню — картинка механизма
   из текста, нарисованная кодом в палитре mía. figureFor(day, {still}) отдаёт разметку <figure> с inline SVG
   или '' для дней без схемы. Поле рисунка — 300×200 (как кадр iOS высотой 200), SVG тянется по ширине карточки.
   Анимации — CSS-классы fx-*: базовое состояние = итоговый кадр, keyframes идут от начального. Поэтому при
   «Меньше движения» / prefers-reduced-motion (анимации выключены) сразу виден итог, как на iOS. Классы fx
   работают только внутри .wa-fig.anim и стоят на паузе, пока webapp.js не добавит .play (фигура в зоне видимости).
   fit(root) подгоняет подложки подписей под реальную ширину текста. Комментарии только блочные (check-webapp.cjs). */
(function (root) {
'use strict';
const W = 300, H = 200;
const ink = '#292131', muted = '#65566F', violet = '#7540BC', lilacSoft = '#E8DCFB', lime = '#DFFF70', night = '#2D213C';
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = v => Math.round(v * 10) / 10;

/* Текст по центру точки (x, y); переносы строк через \n, как в SwiftUI-подписях. */
function text(x, y, str, o) {
  o = o || {};
  const size = o.size || 12, lines = String(str).split('\n'), lh = size * 1.22, anchor = o.anchor || 'middle';
  const top = y - (lines.length - 1) * lh / 2;
  const attrs = 'x="' + n(x) + '" y="' + n(top) + '" font-size="' + size + '" font-weight="' + (o.weight || 600) + '" fill="' + (o.color || ink) + '" text-anchor="' + anchor + '" dominant-baseline="central"' +
    (o.italic ? ' font-style="italic"' : '') + (o.opacity != null ? ' fill-opacity="' + o.opacity + '"' : '') + (o.cls ? ' class="' + o.cls + '"' : '') + (o.style ? ' style="' + o.style + '"' : '');
  return '<text ' + attrs + '>' + lines.map((l, i) => '<tspan x="' + n(x) + '" dy="' + (i ? n(lh) : 0) + '">' + esc(l) + '</tspan>').join('') + '</text>';
}
/* Подпись на подложке (белая плашка, капсула). Ширина — оценка, точную ставит fit() после вставки в DOM. */
function pill(x, y, str, o) {
  o = o || {};
  const size = o.size || 12, lines = String(str).split('\n'), px = o.padX == null ? 10 : o.padX, py = o.padY == null ? 7 : o.padY;
  const w = Math.max(...lines.map(l => l.length)) * size * 0.56 + px * 2, h = lines.length * size * 1.22 + py * 2;
  const r = o.capsule ? h / 2 : (o.radius == null ? 12 : o.radius);
  return '<g data-pill="' + px + ',' + py + ',' + (o.capsule ? 'c' : r) + '"' + (o.cls ? ' class="' + o.cls + '"' : '') + (o.style ? ' style="' + o.style + '"' : '') + '>' +
    '<rect x="' + n(x - w / 2) + '" y="' + n(y - h / 2) + '" width="' + n(w) + '" height="' + n(h) + '" rx="' + n(r) + '" fill="' + (o.bg || '#fff') + '"' + (o.shadow ? ' filter="url(#' + o.shadow + ')"' : '') + '/>' +
    text(x, y, str, o) + '</g>';
}
function shadow(id) {
  return '<filter id="' + id + '" x="-20%" y="-30%" width="140%" height="170%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000" flood-opacity="0.07"/></filter>';
}
/* Плавное «прорисовывание» линии слева направо: клип-прямоугольник растёт по ширине (кривые монотонны по x). */
function reveal(id, d, delay) {
  return '<clipPath id="' + id + '"><rect class="fx fx-draw" x="-10" y="-20" width="' + (W + 20) + '" height="' + (H + 40) + '" style="--d:' + d + 's' + (delay != null ? ';--dl:' + delay + 's' : '') + '"/></clipPath>';
}
const lucide = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  'message-circle': '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  'arrow-right': '<path d="M5 12h14M12 5l7 7-7 7"/>'
};
function icon(name, x, y, size, color, width) {
  const s = size / 24;
  return '<g transform="translate(' + n(x) + ' ' + n(y) + ') scale(' + n(s * 100) / 100 + ')" fill="none" stroke="' + color + '" stroke-width="' + (width || 2) + '" stroke-linecap="round" stroke-linejoin="round">' + lucide[name] + '</g>';
}

/* ---------- 1, 10 — круг ---------- */
function cycle(id, labels, center, accent, still) {
  const cx = W / 2, cy = H / 2, rx = Math.min(W / 2 - 62, 108), ry = H / 2 - 34;
  const pt = turn => { const a = turn * 2 * Math.PI - Math.PI / 2; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; };
  const path = 'M' + cx + ' ' + (cy - ry) + 'A' + rx + ' ' + ry + ' 0 1 1 ' + cx + ' ' + (cy + ry) + 'A' + rx + ' ' + ry + ' 0 1 1 ' + cx + ' ' + (cy - ry) + 'Z';
  const p0 = pt(0.1);
  const dot = still
    ? '<circle cx="' + n(p0[0]) + '" cy="' + n(p0[1]) + '" r="6" fill="' + accent + '"/>'
    : '<circle r="6" fill="' + accent + '"><animateMotion dur="7s" repeatCount="indefinite" path="' + path + '"/></circle>';
  return '<defs>' + shadow(id + 's') + '</defs>' +
    '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="none" stroke="' + accent + '" stroke-opacity=".45" stroke-width="1.6" stroke-dasharray="3 6"/>' + dot +
    text(cx, cy, center, { size: 15, color: accent, italic: true }) +
    labels.map((l, i) => { const p = pt(i / labels.length); return pill(p[0], p[1], l, { shadow: id + 's' }); }).join('');
}

/* ---------- 2 — волна ---------- */
function wave(id) {
  const b = H - 30, curve = 'M0 ' + b + 'C' + W * 0.3 + ' ' + b + ' ' + W * 0.36 + ' 46 ' + W * 0.5 + ' 46C' + W * 0.64 + ' 46 ' + W * 0.7 + ' ' + b + ' ' + W + ' ' + b;
  return '<defs>' + reveal(id + 'r', 1.4) + '</defs>' +
    '<path d="' + curve + '" fill="none" stroke="' + lime + '" stroke-width="3" stroke-linecap="round" clip-path="url(#' + id + 'r)"/>' +
    '<line x1="0" y1="' + b + '" x2="' + W + '" y2="' + b + '" stroke="#fff" stroke-opacity=".2"/>' +
    '<circle class="fx fx-fade" style="--d:1.4s" cx="' + W / 2 + '" cy="46" r="7" fill="' + lime + '"/>' +
    pill(W / 2, 16, 'пик: ничего не делать', { size: 13, color: night, bg: lime, capsule: true, padY: 6, cls: 'fx fx-fade', style: '--d:1.4s' }) +
    text(0, H - 10, 'накрыло', { color: '#fff', opacity: 0.7, anchor: 'start' }) +
    text(W, H - 10, 'отпустило', { color: '#fff', opacity: 0.7, anchor: 'end' });
}

/* ---------- 3 — громкость днём и ночью ---------- */
function volume() {
  const heights = [18, 30, 22, 34, 20], bottom = H - 30;
  const column = (cx, title, ic, scale, color) => {
    const x0 = cx - (5 * 9 + 4 * 6) / 2;
    const bars = heights.map((h, i) => {
      const hh = h * scale;
      return '<rect' + (scale > 1 ? ' class="fx fx-grow" style="--d:1.4s;--s0:' + n(1 / scale * 100) / 100 + '"' : '') + ' x="' + (x0 + i * 15) + '" y="' + n(bottom - hh) + '" width="9" height="' + n(hh) + '" rx="4.5" fill="' + color + '"/>';
    }).join('');
    const tw = title.length * 13 * 0.56, lx = cx - (tw + 18) / 2;
    return bars + icon(ic, lx, H - 15.5, 13, '#fff') + text(lx + 18, H - 9, title, { size: 13, color: '#fff', anchor: 'start' });
  };
  return column(W / 2 - 48, 'Днём', 'sun', 1, '#DDC9EE') + column(W / 2 + 48, 'Ночью', 'moon', 3.6, lime);
}

/* ---------- 4 — качели вместо лестницы ---------- */
function zigzag(id) {
  const pts = [[0.03, 0.86], [0.16, 0.6], [0.27, 0.78], [0.4, 0.46], [0.5, 0.66], [0.63, 0.34], [0.74, 0.52], [0.86, 0.2], [0.97, 0.3]].map(p => [W * p[0], H * p[1]]);
  const p4 = pts[4];
  return '<defs>' + reveal(id + 'r', 1.8) + '</defs>' +
    '<line x1="' + W * 0.03 + '" y1="' + H * 0.86 + '" x2="' + W * 0.97 + '" y2="' + H * 0.12 + '" stroke="' + muted + '" stroke-opacity=".5" stroke-width="1.5" stroke-dasharray="4 6"/>' +
    '<polyline points="' + pts.map(p => n(p[0]) + ',' + n(p[1])).join(' ') + '" fill="none" stroke="' + violet + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#' + id + 'r)"/>' +
    text(W * 0.3, H * 0.2, 'как кажется,\nчто должно быть', { size: 11, weight: 500, color: muted }) +
    text(W * 0.76, H * 0.78, 'как бывает', { size: 13, color: violet }) +
    '<circle class="fx fx-fade" style="--d:1.8s" cx="' + p4[0] + '" cy="' + p4[1] + '" r="5.5" fill="' + lime + '" stroke="#748E36"/>' +
    text(p4[0] + 8, p4[1] + 18, 'волна ≠ откат', { size: 11, color: '#415626', cls: 'fx fx-fade', style: '--d:1.8s' });
}

/* ---------- 5 — я, мы, он ---------- */
function venn() {
  const cy = H / 2, cx = W / 2, d = 2.2;
  return '<circle cx="' + (cx - 42) + '" cy="' + cy + '" r="75" fill="' + violet + '" fill-opacity=".85"/>' +
    '<g class="fx fx-slide" style="--d:' + d + 's;--x0:-32px">' +
      '<circle class="fx fx-fill" style="--d:' + d + 's" cx="' + (cx + 74) + '" cy="' + cy + '" r="74" fill="#F4AD8A" fill-opacity=".12"/>' +
      '<circle class="fx fx-out" style="--d:' + d + 's" cx="' + (cx + 74) + '" cy="' + cy + '" r="74" fill="none" stroke="#814D37" stroke-width="2" opacity="0"/>' +
      '<circle class="fx fx-fade" style="--d:' + d + 's" cx="' + (cx + 74) + '" cy="' + cy + '" r="74" fill="none" stroke="#814D37" stroke-width="2" stroke-dasharray="4 6"/>' +
      text(cx + 116, cy, 'он', { size: 22, color: '#814D37', cls: 'fx fx-dim', style: '--d:' + d + 's;opacity:.5' }) +
    '</g>' +
    text(cx - 80, cy, 'я', { size: 34, color: '#fff', italic: true }) +
    text(cx, cy, 'мы', { size: 22, color: '#fff', cls: 'fx fx-out', style: '--d:' + d + 's;opacity:0' }) +
    text(cx + 12, cy, 'пустые\nстрочки', { size: 12, color: '#492F29', cls: 'fx fx-fade', style: '--d:' + d + 's' });
}

/* ---------- 6 — двое дышат в одном ритме ---------- */
function pair() {
  const cy = H / 2, x1 = W / 2 - 96, x2 = W / 2 + 96;
  const person = (x, label, fill, color, s0, jitter) =>
    '<g' + (jitter ? ' class="fx fx-loop fx-jitter" style="--d:2.6s"' : '') + '>' +
    '<circle class="fx fx-loop fx-breathe" style="--d:2.6s;--s0:' + s0 + ';transform:scale(1.06)" cx="' + x + '" cy="' + cy + '" r="59" fill="' + fill + '" fill-opacity=".25"/>' +
    '<circle cx="' + x + '" cy="' + cy + '" r="42" fill="' + fill + '"/>' + text(x, cy, label, { size: 13, color }) + '</g>';
  const bars = [0, 1, 2].map(i => '<rect class="fx fx-loop fx-widen" style="--d:2.6s" x="' + (W / 2 - 15) + '" y="' + (cy - 9 - 2 + i * 9) + '" width="30" height="4" rx="2" fill="' + violet + '" fill-opacity="' + (0.25 + i * 0.2) + '"/>').join('');
  return person(x1, 'ты', violet, '#fff', 0.92, true) + bars + person(x2, 'спокойный\nчеловек', lime, '#2F3824', 0.94, false);
}

/* ---------- 7 — маятник ---------- */
function pendulum() {
  const cx = W / 2, green = '#4D5C37';
  return text(6, 137, 'больно', { size: 15, color: green, anchor: 'start' }) + text(W - 6, 137, 'живу', { size: 15, color: green, anchor: 'end' }) +
    '<g class="fx fx-loop fx-swing" style="--d:2.4s;transform:rotate(-32deg);transform-origin:' + cx + 'px 0px">' +
      '<rect x="' + (cx - 1) + '" y="0" width="2" height="120" fill="#2F3824"/><circle cx="' + cx + '" cy="140" r="20" fill="' + night + '"/>' +
      text(cx, 140, 'я', { size: 16, color: lime, italic: true }) +
    '</g>' +
    '<circle cx="' + cx + '" cy="0.5" r="4.5" fill="#2F3824"/>' +
    text(cx, 184, 'оба конца нужны', { size: 12, weight: 500, color: green });
}

/* ---------- 8 — плёнка ---------- */
function film() {
  const top = 35, gap = 6, fw = (W - 16 - gap * 5) / 6;
  const frames = [0, 1, 2, 3, 4, 5].map(i => {
    const best = [0, 2, 5].includes(i), x = 8 + i * (fw + gap), y = top + 12;
    return '<g' + (best ? ' class="fx fx-zoom" style="--d:1.6s;transform:scale(1.06)"' : ' class="fx fx-dim" style="--d:1.6s;opacity:.45"') + '>' +
      '<rect x="' + n(x) + '" y="' + y + '" width="' + n(fw) + '" height="78" rx="8" fill="' + (best ? lime : '#fff') + '"' + (best ? '' : ' fill-opacity=".12"') + '/>' +
      text(x + fw / 2, y + 39, best ? '★' : '—', { size: best ? 20 : 14, weight: 700, color: best ? night : '#fff', opacity: best ? null : 0.4 }) + '</g>';
  }).join('');
  return '<rect x="0" y="' + top + '" width="' + W + '" height="102" rx="14" fill="#000" fill-opacity=".35"/>' + frames +
    text(0, top + 102 + 12 + 9, '★ это показывает память', { size: 12, color: lime, anchor: 'start' }) +
    text(W, top + 102 + 12 + 9, '— а это тоже было', { size: 12, weight: 500, color: '#DDC9EE', anchor: 'end' });
}

/* ---------- 9 — сеть связей ---------- */
function network() {
  const nodes = [[0.16, 0.26, 30], [0.3, 0.8, 24], [0.62, 0.84, 28], [0.5, 0.14, 22], [0.72, 0.48, 26]];
  const me = [W * 0.42, H * 0.5], him = [W * 0.88, H * 0.22];
  return '<line x1="' + me[0] + '" y1="' + me[1] + '" x2="' + him[0] + '" y2="' + him[1] + '" stroke="' + muted + '" stroke-opacity=".5" stroke-width="1.5" stroke-dasharray="3 5"/>' +
    nodes.map(p => { const x = W * p[0], y = H * p[1]; return '<line class="fx fx-dash" style="--d:1.6s" pathLength="1" stroke-dasharray="1 1" x1="' + me[0] + '" y1="' + me[1] + '" x2="' + n(x) + '" y2="' + n(y) + '" stroke="' + violet + '" stroke-opacity=".6" stroke-width="1.6"/>'; }).join('') +
    nodes.map(p => '<circle class="fx fx-pop" style="--d:1.6s" cx="' + n(W * p[0]) + '" cy="' + n(H * p[1]) + '" r="' + (p[2] / 2 - 0.5) + '" fill="' + lime + '" stroke="#748E36"/>').join('') +
    '<circle cx="' + him[0] + '" cy="' + him[1] + '" r="28.25" fill="none" stroke="' + muted + '" stroke-opacity=".6" stroke-width="1.5" stroke-dasharray="4 5"/>' + text(him[0], him[1], 'он', { size: 13, weight: 500, color: muted }) +
    '<circle cx="' + me[0] + '" cy="' + me[1] + '" r="28" fill="' + violet + '"/>' + text(me[0], me[1], 'ты', { size: 15, color: '#fff' });
}

/* ---------- 11 — десять минут ---------- */
function tenMinutes(id) {
  const brown = '#714B3E', y0 = 25, barY = y0 + 32 + 14, split = W * 0.36;
  return '<defs><clipPath id="' + id + 'c"><rect x="0" y="' + barY + '" width="' + W + '" height="46" rx="23"/></clipPath></defs>' +
    '<g data-pill="12,8,c"><rect x="0" y="' + y0 + '" width="140" height="32" rx="16" fill="#fff"/>' + icon('message-circle', 12, y0 + 8.5, 15, '#492F29') + text(33, y0 + 16, 'сообщение от него', { size: 13, color: '#492F29', anchor: 'start' }) + '</g>' +
    '<rect x="0" y="' + barY + '" width="' + W + '" height="46" rx="23" fill="' + lime + '"/>' +
    '<rect x="0" y="' + barY + '" width="' + split + '" height="46" rx="23" fill="#E5744D"/>' +
    '<g clip-path="url(#' + id + 'c)"><rect class="fx fx-shrink" style="--d:1.8s;--s0:' + n(W / (split - 23) * 100) / 100 + '" x="0" y="' + barY + '" width="' + (split - 23) + '" height="46" fill="#E5744D"/></g>' +
    text(split / 2, barY + 23, 'решает тревога', { size: 11, color: '#fff' }) +
    text(split + (W - split) / 2, barY + 23, 'решаешь ты', { size: 13, color: '#2F3824', cls: 'fx fx-fade', style: '--d:1.8s' }) +
    text(0, barY + 46 + 14 + 7, '0 мин', { size: 11, weight: 500, color: brown, anchor: 'start' }) +
    text(split, barY + 46 + 14 + 7, '10 мин', { size: 11, weight: 500, color: brown }) +
    text(W, barY + 46 + 14 + 7, 'завтра', { size: 11, weight: 500, color: brown, anchor: 'end' }) +
    text(0, barY + 46 + 14 + 14 + 14 + 8, 'План пишется сейчас — на холодную голову.', { size: 13, weight: 500, color: '#492F29', anchor: 'start' });
}

/* ---------- 12 — петля привычки ---------- */
function habit(id) {
  const bw = (W - 2 * 13 - 4 * 6) / 3, top = (H - 96) / 2, cy = top + 48;
  const box = (x, title, note, fill, color, cls, style) =>
    '<g' + (cls ? ' class="' + cls + '"' : '') + (style ? ' style="' + style + '"' : '') + '><rect x="' + n(x) + '" y="' + top + '" width="' + n(bw) + '" height="96" rx="18" fill="' + fill + '" filter="url(#' + id + 's)"/>' +
    text(x + bw / 2, cy - 15, title, { size: 13, weight: 700, color }) + text(x + bw / 2, cy + 12, note, { size: 11, weight: 400, color }) + '</g>';
  const x1 = 0, a1 = bw + 6, x2 = a1 + 13 + 6, a2 = x2 + bw + 6, x3 = a2 + 13 + 6;
  return '<defs>' + shadow(id + 's') + '</defs>' +
    box(x1, 'Крючок', 'момент,\nкогда тянет', '#fff', ink) +
    icon('arrow-right', a1, cy - 6.5, 13, violet, 2.6) +
    box(x2, 'Действие', 'открыть\nего страницу', '#fff', muted, 'fx fx-out', '--d:1.6s;opacity:0') +
    box(x2, 'Замена', 'вода, пауза,\nподруга', lime, '#2F3824', 'fx fx-swap', '--d:1.6s') +
    icon('arrow-right', a2, cy - 6.5, 13, violet, 2.6) +
    box(x3, 'Облегчение', 'пик прошёл', '#fff', ink);
}

/* ---------- 13 — две колонки ---------- */
function columns() {
  const then = [0.5, 0, 0.35, 0.6, 0, 0.3, 0.7, 0], now = [0.7, 0.55, 0.5, 0.75, 0.4, 0.6, 0.45, 0.65], cw = (W - 16) / 2;
  const column = (x, title, values, color, animate) => {
    const inner = cw - 28;
    return '<rect x="' + x + '" y="0" width="' + cw + '" height="' + H + '" rx="18" fill="#fff" fill-opacity=".7"/>' +
      text(x + 14, 14 + 7, title, { size: 11, weight: 700, color: '#714B3E', anchor: 'start' }) +
      values.map((v, i) => {
        const w = inner * (v === 0 ? 0.25 : v), y = 14 + 14 + 9 + i * 18;
        return '<rect' + (animate && v ? ' class="fx fx-bar" style="--d:1.6s;--s0:' + n(0.1 / v * 100) / 100 + '"' : '') + ' x="' + (x + 14) + '" y="' + y + '" width="' + n(w) + '" height="8" rx="4" fill="' + (v === 0 ? '#714B3E' : color) + '"' + (v === 0 ? ' fill-opacity=".15"' : '') + '/>';
      }).join('');
  };
  return column(0, 'ДЕНЬ 5', then, '#C99A84', false) + column(cw + 16, 'СЕГОДНЯ', now, '#492F29', true);
}

/* ---------- 14 — две линии ---------- */
function twoLines(id) {
  const b = H - 26, curve = s => 'M0 ' + b + 'L' + n(W * s) + ' ' + b + 'C' + n(W * (s + 0.22)) + ' ' + b + ' ' + n(W * (s + 0.3)) + ' 26 ' + W + ' 26';
  const green = '#4D5C37', here = W * 0.46;
  return '<defs>' + reveal(id + 'r', 2) + '</defs>' +
    '<line x1="0" y1="' + b + '" x2="' + W + '" y2="' + b + '" stroke="' + green + '" stroke-opacity=".25"/>' +
    '<g clip-path="url(#' + id + 'r)"><path d="' + curve(0.05) + '" fill="none" stroke="' + night + '" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="' + curve(0.4) + '" fill="none" stroke="' + violet + '" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 7"/></g>' +
    text(W * 0.3, H * 0.3, 'действия', { size: 13, color: night }) +
    text(W * 0.84, H * 0.62, 'чувства', { size: 13, color: violet }) +
    pill(here, H - 10, 'ты здесь', { size: 11, color: '#2F3824', capsule: true, padX: 8, padY: 5 }) +
    '<line x1="' + here + '" y1="20" x2="' + here + '" y2="' + b + '" stroke="' + green + '" stroke-opacity=".4" stroke-dasharray="3 4"/>';
}

/* Подпись, фон карточки, тёмная ли она и сам рисунок — как в ArticleFigure (iOS). */
const FIGURES = {
  1: ['Круг, который крутится сам', lilacSoft, false, (id, o) => cycle(id, ['Плохо', 'Проверила', 'Легче\nна 10 минут', 'Хуже,\nчем было'], 'тоска', violet, o.still)],
  2: ['У импульса есть форма', night, true, id => wave(id)],
  3: ['Те же мысли — разная громкость', night, true, () => volume()],
  4: ['Не лестница, а качели', lilacSoft, false, id => zigzag(id)],
  5: ['Что остаётся, когда «мы» распадается', '#FFE5D6', false, () => venn()],
  6: ['Рядом со спокойным телу легче', lilacSoft, false, () => pair()],
  7: ['Между «больно» и «живу»', '#EEF8C9', false, () => pendulum()],
  8: ['Фильм из лучших сцен', night, true, () => film()],
  9: ['Сеть, а не одна ниточка', lilacSoft, false, () => network()],
  10: ['Где у круга дверь', '#EEF8C9', false, (id, o) => cycle(id, ['Лежу', 'Меньше сил', 'Хуже\nнастроение', 'Не хочу\nвставать'], 'дверь —\nтело', '#546D2D', o.still)],
  11: ['Первые десять минут', '#FFE5D6', false, id => tenMinutes(id)],
  12: ['Меняем только середину', lilacSoft, false, id => habit(id)],
  13: ['Две записи рядом', '#FFE5D6', false, () => columns()],
  14: ['Сначала действия, потом чувства', '#EEF8C9', false, id => twoLines(id)]
};

function figureFor(day, o) {
  const f = FIGURES[Number(day)]; if (!f) return '';
  o = o || {};
  const id = 'wf' + Number(day), caption = f[0];
  return '<figure class="wa-fig' + (f[2] ? ' dark' : '') + (o.still ? '' : ' anim') + '" data-fig="' + Number(day) + '" style="--fig-bg:' + f[1] + '" role="img" aria-label="Иллюстрация: ' + esc(caption) + '">' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" aria-hidden="true" focusable="false">' + f[3](id, o) + '</svg>' +
    '<figcaption aria-hidden="true"><span>✳&#xFE0E;</span>' + esc(caption) + '</figcaption></figure>';
}

/* Подложки подписей по реальной ширине текста (оценка в pill() грубая для разных шрифтов). */
function fit(scope) {
  if (!scope || !scope.querySelectorAll) return;
  scope.querySelectorAll('.wa-fig [data-pill]').forEach(g => {
    const t = g.querySelector('text'), r = g.querySelector('rect'); if (!t || !r || typeof t.getBBox !== 'function') return;
    let b; try { b = t.getBBox(); } catch (e) { return; }
    if (!b || !b.width) return;
    const parts = g.getAttribute('data-pill').split(','), px = Number(parts[0]), py = Number(parts[1]);
    const w = b.width + px * 2, h = b.height + py * 2;
    const anchor = t.getAttribute('text-anchor');
    const x = anchor === 'start' ? Number(r.getAttribute('x')) : b.x - px, y = b.y - py;
    if (anchor === 'start') { r.setAttribute('width', n(b.x + b.width + px - x)); return; }
    r.setAttribute('x', n(x)); r.setAttribute('y', n(y)); r.setAttribute('width', n(w)); r.setAttribute('height', n(h));
    r.setAttribute('rx', parts[2] === 'c' ? n(h / 2) : parts[2]);
  });
}

const api = { figureFor, fit, days: Object.keys(FIGURES).map(Number), captions: Object.fromEntries(Object.entries(FIGURES).map(([k, v]) => [k, v[0]])) };
root.MiaFigures = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
