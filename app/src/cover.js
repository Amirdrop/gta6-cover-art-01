// GTA-style cover art engine.
// Draws the whole cover onto a 2D context with pure canvas drawing. Everything is deterministic from a state
// object so the live preview and the export render identically.

// Layout definitions: each panel is a normalized [x, y, w, h] rect within the artwork photo area.
const LAYOUTS = {
  grid3: [
    [0.0, 0.0, 1 / 3, 0.36], [1 / 3, 0.0, 1 / 3, 0.36], [2 / 3, 0.0, 1 / 3, 0.36],
    [0.0, 0.36, 1 / 3, 0.28], [1 / 3, 0.36, 1 / 3, 0.28], [2 / 3, 0.36, 1 / 3, 0.28],
    [0.0, 0.64, 1 / 3, 0.36], [1 / 3, 0.64, 1 / 3, 0.36], [2 / 3, 0.64, 1 / 3, 0.36],
  ],
  hero3: [
    [0.0, 0.0, 0.62, 0.58],
    [0.62, 0.0, 0.38, 0.29], [0.62, 0.29, 0.38, 0.29],
    [0.0, 0.58, 0.34, 0.42], [0.34, 0.58, 0.33, 0.42], [0.67, 0.58, 0.33, 0.42],
  ],
  filmstrip: [
    [0.0, 0.0, 0.34, 1.0],
    [0.34, 0.0, 0.33, 1.0],
    [0.67, 0.0, 0.33, 1.0],
  ],
  duo: [
    [0.0, 0.0, 0.5, 0.55],
    [0.5, 0.0, 0.5, 0.55],
    [0.0, 0.55, 0.5, 0.45], [0.5, 0.55, 0.5, 0.45],
  ],
  full: [
    [0.0, 0.0, 1.0, 1.0],
  ],
};

const PANEL_PHOTO_COUNT = {
  grid3: 9,
  hero3: 6,
  filmstrip: 3,
  duo: 4,
  full: 1,
};

const GRADES = {
  sunset: {
    name: 'Sunset',
    overlay: [
      [0.0, 'rgba(255, 92, 40, 0.20)'],
      [0.45, 'rgba(255, 140, 60, 0.12)'],
      [0.7, 'rgba(220, 60, 160, 0.28)'],
      [1.0, 'rgba(120, 30, 160, 0.42)'],
    ],
    halftone: 'rgba(255, 200, 120, 1)',
  },
  neon: {
    name: 'Neon',
    overlay: [
      [0.0, 'rgba(120, 20, 220, 0.30)'],
      [0.5, 'rgba(255, 30, 120, 0.20)'],
      [1.0, 'rgba(20, 220, 255, 0.26)'],
    ],
    halftone: 'rgba(120, 255, 255, 1)',
  },
  mono: {
    name: 'Mono',
    grayscale: true,
    overlay: [
      [0.0, 'rgba(20, 20, 30, 0.10)'],
      [1.0, 'rgba(0, 0, 5, 0.30)'],
    ],
    halftone: 'rgba(255, 255, 255, 1)',
  },
  teal: {
    name: 'Teal-Orange',
    overlay: [
      [0.0, 'rgba(0, 120, 150, 0.18)'],
      [0.5, 'rgba(20, 70, 90, 0.16)'],
      [1.0, 'rgba(230, 120, 40, 0.28)'],
    ],
    halftone: 'rgba(255, 200, 120, 1)',
  },
};

// Draws a photo into a destination rect using cover-fit plus pan (fraction, -1..1) and zoom (0.5..3).
export function drawPanel(ctx, photo, x, y, w, h, panX = 0, panY = 0, zoom = 1) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  if (photo) {
    const scale = Math.max(w / photo.naturalWidth, h / photo.naturalHeight) * zoom;
    const pw = photo.naturalWidth * scale;
    const ph = photo.naturalHeight * scale;
    const maxX = (pw - w) / 2;
    const maxY = (ph - h) / 2;
    const dx = (w - pw) / 2 - panX * maxX;
    const dy = (h - ph) / 2 - panY * maxY;
    ctx.drawImage(photo, x + dx, y + dy, pw, ph);
  } else {
    ctx.fillStyle = '#12131a';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.font = 'bold 24px Anton, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NO IMAGE', x + w / 2, y + h / 2);
  }
  ctx.restore();
}

// Applies a color grade: optional grayscale plus a vertical gradient overlay across a rect.
export function applyGrade(ctx, x, y, w, h, grade) {
  ctx.save();
  if (grade.grayscale) {
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = 'rgba(128,128,128,1)';
    ctx.fillRect(x, y, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
  const overlay = ctx.createLinearGradient(x, y, x, y + h);
  for (const [t, c] of grade.overlay) overlay.addColorStop(t, c);
  ctx.fillStyle = overlay;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

// Subtle halftone dot grid over a rect.
export function drawHalftone(ctx, x, y, w, h, grade, spacing, radius) {
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = (grade && grade.halftone) || 'rgba(255,255,255,1)';
  const sp = spacing || Math.max(7, Math.min(w, h) * 0.022);
  const rad = radius || sp * 0.34;
  for (let cy = y + sp; cy < y + h; cy += sp) {
    for (let cx = x + sp; cx < x + w; cx += sp) {
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// Film grain: random scattered translucent specks.
export function drawGrain(ctx, x, y, w, h, amount) {
  ctx.save();
  ctx.globalAlpha = amount == null ? 0.05 : amount;
  for (let i = 0; i < Math.floor((w * h) / 900); i++) {
    const px = x + Math.random() * w;
    const py = y + Math.random() * h;
    const r = 0.5 + Math.random() * 1.4;
    ctx.fillStyle = Math.random() > 0.5 ? '#ffffff' : '#000000';
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Radial vignette darkening the edges.
export function drawVignette(ctx, x, y, w, h, strength) {
  ctx.save();
  const g = ctx.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.22, x + w / 2, y + h / 2, Math.max(w, h) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength == null ? 0.42 : strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

// Draws the double-line Anton title block with slight skew and drop shadow.
export function drawTitleBlock(ctx, x, y, w, line1, line2, size, color) {
  if (!line1 && !line2) return;
  const lines = [line1 || '', line2 || ''].filter((l) => l.trim());
  if (!lines.length) return;
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  const skew = -0.05;
  const px = x + w / 2;
  const lh = size;

  // drop shadow layer
  ctx.save();
  ctx.translate(px, y);
  ctx.transform(1, 0, skew, 1, 0, 0);
  ctx.font = `900 ${size}px Anton, 'Arial Black', sans-serif`;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = size * 0.18;
  ctx.shadowOffsetY = size * 0.08;
  lines.forEach((line, i) => ctx.fillText(line, 0, i * lh * 0.92));
  ctx.restore();

  // main layer
  ctx.translate(px, y);
  ctx.transform(1, 0, skew, 1, 0, 0);
  ctx.font = `900 ${size}px Anton, 'Arial Black', sans-serif`;
  ctx.fillStyle = color;
  ctx.lineWidth = size * 0.02;
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  lines.forEach((line, i) => {
    const ty = i * lh * 0.92;
    ctx.strokeText(line, 0, ty);
    ctx.fillText(line, 0, ty);
  });
  ctx.restore();
  ctx.restore();
}

// Pacifico script tagline under the title.
export function drawTagline(ctx, x, y, w, text, size, color) {
  if (!text || !text.trim()) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${size}px Pacifico, cursive`;
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = size * 0.2;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = color;
  ctx.fillText(text, x + w / 2, y);
  ctx.restore();
}

// Bottom caption band: dark gradient with the caption in white Anton.
export function drawCaptionBand(ctx, x, y, w, h, text, color) {
  ctx.save();
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, 'rgba(0,0,0,0.05)');
  g.addColorStop(0.35, 'rgba(0,0,0,0.82)');
  g.addColorStop(1, 'rgba(0,0,0,0.95)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const txt = (text || '').toUpperCase();
  if (!txt) { ctx.restore(); return; }
  let size = 0.6 * h;
  ctx.font = `900 ${size}px Anton, sans-serif`;
  while (ctx.measureText(txt).width > w * 0.8 && size > 12) {
    size -= 1;
    ctx.font = `900 ${size}px Anton, sans-serif`;
  }
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 6;
  ctx.fillText(txt, x + w / 2, y + h / 2 + h * 0.04);
  ctx.restore();
}

// Thin art-deco double frame border around the whole artwork.
export function drawFrame(ctx, x, y, w, h, color) {
  ctx.save();
  ctx.strokeStyle = color;
  const outer = Math.min(w, h) * 0.012;
  const gap = outer * 1.1;
  ctx.lineWidth = outer;
  ctx.strokeRect(x + outer / 2, y + outer / 2, w - outer, h - outer);
  ctx.lineWidth = outer * 0.6;
  ctx.strokeRect(x + outer + gap, y + outer + gap, w - 2 * (outer + gap), h - 2 * (outer + gap));
  ctx.restore();
}

// Star/price-badge logo: an invented game badge (a starburst with a star in a disc) in a corner.
export function drawBadge(ctx, cx, cy, size, bg, fg, label) {
  ctx.save();
  ctx.translate(cx, cy);
  const points = 5;
  // starburst behind
  ctx.fillStyle = bg;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? size : size * 0.7;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const px = Math.cos(a) * rad;
    const py = Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = size * 0.04;
  ctx.strokeStyle = fg;
  ctx.stroke();

  // inner disc
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.46, 0, Math.PI * 2);
  ctx.fillStyle = fg;
  ctx.fill();
  ctx.strokeStyle = bg;
  ctx.lineWidth = size * 0.05;
  ctx.stroke();

  // 5-point star
  ctx.fillStyle = bg;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? size * 0.42 : size * 0.19;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const px = Math.cos(a) * rad;
    const py = Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // price label under the badge
  if (label) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `bold ${size * 0.3}px Anton, sans-serif`;
    ctx.fillStyle = fg;
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 4;
    ctx.fillText(label, cx, cy + size * 0.98);
    ctx.restore();
  }
}

// The top-level draw. `state` holds everything: layout, grade, photos, panels, texts, toggles.
// `ctx` is a canvas context; the cover fills its whole area.
export function drawCover(ctx, state) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const margin = state.frame ? Math.min(w, h) * 0.02 : 0;
  const ax = margin, ay = margin, aw = w - margin * 2, ah = h - margin * 2;

  ctx.fillStyle = '#0c0d12';
  ctx.fillRect(0, 0, w, h);

  const titleH = ah * 0.21;
  const capH = ah * 0.13;
  const px = ax, py = ay + titleH, pw = aw, ph = ah - titleH - capH;

  const layout = state.layout || 'hero3';
  const grade = GRADES[state.grade] || GRADES.sunset;
  const rects = LAYOUTS[layout] || LAYOUTS.hero3;
  const count = PANEL_PHOTO_COUNT[layout] != null ? PANEL_PHOTO_COUNT[layout] : rects.length;

  for (let i = 0; i < count; i++) {
    const r = rects[i % rects.length];
    const pan = state.panels[i] || {};
    const photo = pan.photo || state.photos[0] || null;
    const rx = px + r[0] * pw;
    const ry = py + r[1] * ph;
    const rw = r[2] * pw;
    const rh = r[3] * ph;
    drawPanel(ctx, photo, rx, ry, rw, rh, pan.panX || 0, pan.panY || 0, pan.zoom || 1);
  }

  applyGrade(ctx, px, py, pw, ph, grade);
  if (state.halftone) drawHalftone(ctx, px, py, pw, ph, grade);
  if (state.grain) drawGrain(ctx, 0, 0, w, h, 0.05);
  if (state.vignette) drawVignette(ctx, 0, 0, w, h, 0.45);

  const base = Math.min(aw, ah);
  drawTitleBlock(ctx, ax, ay + ah * 0.04, aw, state.title1, state.title2, base * 0.115, '#ffffff');

  const tagTop = ay + ah * 0.04 + (state.title2 ? 0.115 : 0.075) * base + base * 0.03;
  drawTagline(ctx, ax, tagTop, aw, state.tagline, base * 0.05, '#ffd97a');

  drawCaptionBand(ctx, ax, ay + ah - capH + capH * 0.02, aw, capH, state.caption, '#ffffff');

  if (state.frame) drawFrame(ctx, 0, 0, w, h, '#e8e4da');

  drawBadge(ctx, w - aw * 0.1, h - ah * 0.125, base * 0.09, '#ff3b30', '#ffffff', state.price);
}

// Default state used to seed the UI and for a fresh start.
export function createDefaultState(photo) {
  return {
    layout: 'hero3',
    grade: 'sunset',
    title1: 'VICE',
    title2: 'CITY',
    tagline: 'The sun never sets on the heist.',
    caption: 'Sunset Heist',
    price: '$59.99',
    frame: true,
    grain: true,
    halftone: true,
    vignette: true,
    photos: photo ? [photo] : [],
    panels: [],
  };
}

// Number of photo panels a layout draws.
export function getLayoutPanels(layout) {
  return PANEL_PHOTO_COUNT[layout] != null ? PANEL_PHOTO_COUNT[layout] : (LAYOUTS[layout] || LAYOUTS.hero3).length;
}

export { LAYOUTS, GRADES };