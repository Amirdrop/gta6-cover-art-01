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
    [0.0, 0.0, 0.58, 1.0],
    [0.58, 0.0, 0.42, 0.5],
    [0.58, 0.5, 0.42, 0.5],
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

// Default per-panel framing. Pan Y is biased slightly upward so photos show their
// upper-middle region (faces) by default instead of centring (which can clip heads).
export const DEFAULT_PAN = { panX: 0, panY: -0.5, zoom: 1 };

const PANEL_PHOTO_COUNT = {
  grid3: 9,
  hero3: 3,
  filmstrip: 3,
  duo: 4,
  full: 1,
};

// Clamp a channel to 0..255.
function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// Vice City sunset: shadow lift toward deep purple/teal, highlights toward hot
// orange/magenta, ~20% saturation up and ~15% contrast up.
function gradeSunset(r, g, b) {
  r = (r - 128) * 1.15 + 128;
  g = (g - 128) * 1.15 + 128;
  b = (b - 128) * 1.15 + 128;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  r = lum + (r - lum) * 1.2;
  g = lum + (g - lum) * 1.2;
  b = lum + (b - lum) * 1.2;
  const t = (lum - 128) / 128;
  r += t * 58 + (1 - t) * 6;
  b += (1 - t) * 46 - t * 12;
  g += (1 - t) * 14;
  return [clamp255(r), clamp255(g), clamp255(b)];
}

// Neon duotone: shadows bleed magenta, highlights bleed cyan.
function gradeNeon(r, g, b) {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const s = lum / 255;
  let nr = (1 - s) * 255;
  let ng = s * 255;
  const nb = 255;
  nr = (nr - 128) * 1.2 + 128;
  ng = (ng - 128) * 1.2 + 128;
  return [clamp255(nr), clamp255(ng), clamp255(nb)];
}

// High-contrast black & white with a warm paper tint.
function gradeMono(r, g, b) {
  let lum = 0.299 * r + 0.587 * g + 0.114 * b;
  lum = (lum - 128) * 1.55 + 128;
  lum = clamp255(lum);
  return [clamp255(lum * 1.03), clamp255(lum), clamp255(lum * 0.86)];
}

const GRADES = {
  sunset: {
    name: 'Sunset',
    pixel: gradeSunset,
    halftone: 'rgba(255, 200, 120, 1)',
  },
  neon: {
    name: 'Neon',
    pixel: gradeNeon,
    halftone: 'rgba(120, 255, 255, 1)',
  },
  mono: {
    name: 'Mono',
    pixel: gradeMono,
    halftone: 'rgba(255, 244, 224, 1)',
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

// Applies a color grade. Grades with a `pixel` transform run a per-pixel pass (getImageData /
// putImageData) on the rect, then any overlay gradient is layered on topain. Panels are graded one
// rect at a time before compositing so the pass stays fast even at export size.
export function applyGrade(ctx, x, y, w, h, grade) {
  ctx.save();
  if (grade && grade.pixel) {
    const img = ctx.getImageData(x, y, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const o = grade.pixel(d[i], d[i + 1], d[i + 2]);
      d[i] = o[0];
      d[i + 1] = o[1];
      d[i + 2] = o[2];
    }
    ctx.putImageData(img, x, y);
  } else if (grade && grade.grayscale) {
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = 'rgba(128,128,128,1)';
    ctx.fillRect(x, y, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
  if (grade && grade.overlay) {
    const overlay = ctx.createLinearGradient(x, y, x, y + h);
    for (const [t, c] of grade.overlay) overlay.addColorStop(t, c);
    ctx.fillStyle = overlay;
    ctx.fillRect(x, y, w, h);
  }
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

// Draws a letterspaced (tracked) line of Anton text centered at cx, with its top at `top`.
function drawTracked(ctx, text, cx, top, size, tracking, color) {
  ctx.font = `900 ${size}px Anton, 'Arial Black', sans-serif`;
  ctx.fillStyle = color;
  const trk = tracking == null ? size * 0.28 : tracking;
  const letters = [...text];
  let total = 0;
  for (const ch of letters) total += ctx.measureText(ch).width + trk;
  total -= trk;
  let x = cx - total / 2;
  for (const ch of letters) {
    ctx.fillText(ch, x, top);
    x += ctx.measureText(ch).width + trk;
  }
}

// Draws the GTA-style title group: a letterspaced kicker, the double-line Anton title (huge,
// filled white with a thin black outline and hard offset shadow, skewed -4deg, line height 0.86x
// so lines never overlap), and the Pacifico tagline. The whole group is vertically centred inside
// the `maxH` band. Auto-fits so the wider title line spans 78% of the cover width)Skip and clamps
// each line to 15% of the cover height. Returns { top, bottom, size } so the caller can prove the
// group stays inside the frame's inner rect.
export function drawTitleBlock(ctx, x, y, w, line1, line2, kicker, tagline, coverW, coverH, maxH) {
  const lines = [line1 || '', line2 || ''].filter((l) => l.trim());
  if (!lines.length) return { top: y, bottom: y, size: 0 };
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const skew = -4 * Math.PI / 180;
  const px = x + w / 2;
  const fontFor = (s) => `900 ${s}px Anton, 'Arial Black', sans-serif`;

  // Auto-fit the title font: wider line spans 78% of the cover width, capped at 15% of height.
  ctx.font = fontFor(100);
  const widestRef = Math.max(...lines.map((l) => ctx.measureText(l).width));
  let fs = 100 * (w * 0.78) / Math.max(1, widestRef);
  fs = Math.min(fs, coverH * 0.15);
  fs = Math.max(6, fs);

  const hasK = !!(kicker && kicker.trim());
  const hasT = !!(tagline && tagline.trim());
  const kickerH = hasK ? Math.max(6, coverH * 0.022) : 0;
  const tagH = hasT ? Math.max(10, coverH * 0.045) : 0;
  const lh = fs * 0.86;
  const gap1 = hasK ? fs * 0.16 : 0;
  const gap2 = hasT ? fs * 0.28 : 0;
  const titleH = lh * lines.length;
  const groupH = kickerH + gap1 + titleH + gap2 + tagH;

  // Shrink the title font so the whole group fits the band (kicker/tagline stay fixed size).
  if (maxH != null && groupH > maxH) {
    const perFs = lh / fs * lines.length + gap1 / fs + gap2 / fs;
    const availForFs = Math.max(1, maxH - kickerH - tagH);
    fs = Math.max(6, Math.min(fs, availForFs / perFs));
  }
  fs = Math.max(6, fs);

  // Recompute dependent sizes after any font rescale.
  const lh2 = fs * 0.86;
  const gap12 = hasK ? fs * 0.16 : 0;
  const gap22 = hasT ? fs * 0.28 : 0;
  const titleH2 = lh2 * lines.length;
  const groupH2 = kickerH + gap12 + titleH2 + gap22 + tagH;

  // Vertically centre the whole group inside the band.
  let top = y;
  if (maxH != null) top = y + Math.max(0, (maxH - groupH2) / 2);
  let cursor = top;

  // Kicker, letterspaced, above the title.
  if (hasK) {
    drawTracked(ctx, kicker.trim(), px, cursor, kickerH, kickerH * 0.22, '#f7e6b0');
    cursor += kickerH + gap12;
  }

  // Title lines: white fill, thin black outline, hard offset shadow, skewed -4deg.
  lines.forEach((line, i) => {
    const ty = cursor + i * lh2;
    ctx.save();
    ctx.translate(px, ty);
    ctx.transform(1, 0, skew, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillText(line, fs * 0.045, fs * 0.055);
    ctx.restore();
    ctx.save();
    ctx.translate(px, ty);
    ctx.transform(1, 0, skew, 1, 0, 0);
    ctx.lineWidth = Math.max(1, fs * 0.024);
    ctx.strokeStyle = 'rgba(0,0,0,0.92)';
    ctx.strokeText(line, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(line, 0, 0);
    ctx.restore();
  });

  // Tagline, Pacifico, under the title.
  if (hasT) {
    const ty = cursor + titleH2 + gap22;
    ctx.font = `${tagH}px Pacifico, cursive`;
    ctx.fillStyle = '#ffd97a';
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = tagH * 0.3;
    ctx.shadowOffsetY = 2;
    ctx.fillText(tagline, px, ty);
  }

  ctx.restore();
  return { top, bottom: top + groupH2, size: fs };
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

// "DAY ONE" price sticker badge: a circular white disc with a thin dark ring, an orange sunburst of
// triangular rays behind it, '9.99' on a black bar across the middle, and a small 'DAY ONE' caption
// above. No star shape anywhere.
export function drawBadge(ctx, cx, cy, size, bg, fg, label) {
  ctx.save();
  ctx.translate(cx, cy);

  // Orange sunburst of triangular rays behind the disc.
  const rays = 16;
  ctx.fillStyle = '#ff8c1a';
  ctx.beginPath();
  for (let i = 0; i < rays; i++) {
    const a0 = (i / rays) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 1) / rays) * Math.PI * 2 - Math.PI / 2;
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a0) * size * 1.5, Math.sin(a0) * size * 1.5);
    ctx.lineTo(Math.cos(a1) * size * 1.5, Math.sin(a1) * size * 1.5);
    ctx.closePath();
  }
  ctx.fill();

  // White disc with a thin dark ring.
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = size * 0.05;
  ctx.strokeStyle = '#16161a';
  ctx.stroke();

  // Black bar across the middle.
  ctx.fillStyle = '#101014';
  ctx.fillRect(-size * 1.35, -size * 0.3, size * 2.7, size * 0.6);

  // Price on the bar.
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 ${size * 0.62}px Anton, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('9.99', 0, size * 0.02);

  // Small "DAY ONE" caption above the disc.
  ctx.fillStyle = '#16161a';
  ctx.font = `900 ${size * 0.34}px Anton, sans-serif`;
  ctx.fillText('DAY ONE', 0, -size * 0.98);
  ctx.restore();
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
  const base = Math.min(aw, ah);

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
    drawPanel(ctx, photo, rx, ry, rw, rh,
      pan.panX ?? DEFAULT_PAN.panX,
      pan.panY ?? DEFAULT_PAN.panY,
      pan.zoom ?? DEFAULT_PAN.zoom);
    // Grade each panel rect right after it is drawn (before compositing) so the
    // per-pixel pass stays cheap even at full export resolution.
    applyGrade(ctx, rx, ry, rw, rh, grade);
  }

  if (state.halftone) drawHalftone(ctx, px, py, pw, ph, grade);
  if (state.grain) drawGrain(ctx, 0, 0, w, h, 0.05);
  if (state.vignette) drawVignette(ctx, 0, 0, w, h, 0.45);

  const titleTop = ay + ah * 0.03;
  const titleAvail = titleH - ah * 0.06;
  drawTitleBlock(ctx, ax, titleTop, aw, state.title1, state.title2, state.kicker, state.tagline, aw, ah, titleAvail);

  drawCaptionBand(ctx, ax, ay + ah - capH + capH * 0.02, aw, capH, state.caption, '#ffffff');

  if (state.frame) drawFrame(ctx, 0, 0, w, h, '#e8e4da');

  drawBadge(ctx, w - aw * 0.1, h - ah * 0.125, base * 0.09, '#ff3b30', '#ffffff', state.price);
}

// Assigns photos across a layout's panels, seeding each panel with the default upper-middle pan.
// For the default hero3 layout, the first photo becomes the big hero panel and the second fills
// the two stacked side panels, so the default cover is a real multi-photo collage.
function seedPanels(panels, photos, layout) {
  const lay = layout || 'hero3';
  const count = getLayoutPanels(lay);
  const n = Math.max(1, photos.length);
  for (let i = 0; i < count; i++) {
    let photo = photos[0] || null;
    if (n > 1) {
      if (i === 0) photo = photos[0];
      else if (i === 1 || i === 2) photo = photos[1];
      else photo = photos[(i - 1) % n];
    }
    panels[i] = { ...DEFAULT_PAN, photo };
  }
}

// Default state used to seed the UI and for a fresh start. Accepts one photo or an array.
export function createDefaultState(photos) {
  const arr = Array.isArray(photos) ? photos : (photos ? [photos] : []);
  const panels = [];
  seedPanels(panels, arr);
  return {
    layout: 'hero3',
    grade: 'sunset',
    title1: 'NEON',
    title2: 'COAST',
    kicker: 'PALM BEACH, 1986',
    tagline: 'The sun never sets on the heist.',
    caption: 'HEIST SEASON',
    price: '$9.99',
    frame: true,
    grain: true,
    halftone: true,
    vignette: true,
    photos: arr,
    panels,
  };
}

// Number of photo panels a layout draws.
export function getLayoutPanels(layout) {
  return PANEL_PHOTO_COUNT[layout] != null ? PANEL_PHOTO_COUNT[layout] : (LAYOUTS[layout] || LAYOUTS.hero3).length;
}

export { LAYOUTS, GRADES, seedPanels };