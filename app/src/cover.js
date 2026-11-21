// GTA-style cover art engine.
// Draws the whole cover onto a 2D context with pure canvas drawing. Everything is deterministic from a state
// object so the live preview and the export render identically.

// Layout definitions: each panel is a normalized [x, y, w, h] rect within the artwork photo area.
const LAYOUTS = {
  grid3: [
    [0.0, 0.0, 0.330667, 0.35712], [0.334667, 0.0, 0.330667, 0.35712], [0.669333, 0.0, 0.330667, 0.35712],
    [0.0, 0.36112, 0.330667, 0.27776], [0.334667, 0.36112, 0.330667, 0.27776], [0.669333, 0.36112, 0.330667, 0.27776],
    [0.0, 0.64288, 0.330667, 0.35712], [0.334667, 0.64288, 0.330667, 0.35712], [0.669333, 0.64288, 0.330667, 0.35712],
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
    [0.0, 0.0, 0.498, 0.5478],
    [0.502, 0.0, 0.498, 0.5478],
    [0.0, 0.5518, 0.498, 0.4482], [0.502, 0.5518, 0.498, 0.4482],
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

// Neon duotone: shadows bleed magenta, highlights bleed cyan grams, with a
// little of the source channel preserved so edges don't posterize.
function gradeNeon(r, g, b) {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const s = lum / 255;
  // Blend the duotone ramp with the source (~18%) to keep fine detail alive.
  let nr = ((1 - s) * 255) * 0.82 + r * 0.18;
  let ng = (s * 196 + 30) * 0.82 + g * 0.18;
  let nb = 255 * 0.82 + b * 0.18;
  nr = (nr - 128) * 1.2 + 128;
  ng = (ng - 128) * 1.2 + 128;
  return [clamp255(nr), clamp255(ng), clamp255(nb)];
}

// Vice duotone: hot-magenta shadows through violet midtones to cyan-highlighted
// brights — the classic GTA VI Vice palette push. Saturation up ~35%.
function gradeVice(r, g, b) {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const s = lum / 255;
  // Duotone ramp: magenta (#ff2d9b) shadows -> violet (#8a3cff) mids -> cyan (#3ee6ff) highlights.
  const stops = [
    [0.0, 40, 4, 60],
    [0.35, 255, 45, 155],
    [0.7, 138, 60, 255],
    [1.0, 62, 230, 255],
  ];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (s >= stops[i][0] && s <= stops[i + 1][0]) { lo = stops[i]; hi = stops[i + 1]; break; }
  }
  const t = hi[0] === lo[0] ? 0 : (s - lo[0]) / (hi[0] - lo[0]);
  let nr = lo[1] + (hi[1] - lo[1]) * t;
  let ng = lo[2] + (hi[2] - lo[2]) * t;
  let nb = lo[3] + (hi[3] - lo[3]) * t;
  // Head toward a soft-light blend with the source so fine detail survives. The
  // ramp still dominates the mix, so the grade reads unmistakably as Vice while
  // keeping 100% of texture and not flattening faces.
  const blended = blendSoftLight(r, g, b, nr, ng, nb, 0.38);
  nr = blended[0];
  ng = blended[1];
  nb = blended[2];
  nr = (nr - 128) * 1.15 + 128;
  nb = (nb - 128) * 1.15 + 128;
  return [clamp255(nr), clamp255(ng), clamp255(nb)];
}

// W3C soft-light blend of a graded colour (g) over a source colour (s) at strength
// `blend`, applied per channel. blend 0 = source unchanged, 1 = fully graded.
function blendSoftLight(r, g, b, gr, gg, gb, blend) {
  const a = Math.max(0, Math.min(1, blend));
  const ch = (s, gv) => {
    const x = s / 255;
    const y = clamp255(gv) / 255;
    let v;
    if (y <= 0.5) {
      v = x - (1 - 2 * y) * x * (1 - x);
    } else {
      const d = x <= 0.25 ? ((16 * x - 12) * x + 4) * x : Math.sqrt(x);
      v = x + (2 * y - 1) * (d - x);
    }
    return clamp255((x * (1 - a) + v * a) * 255);
  };
  return [ch(r, gr), ch(g, gg), ch(b, gb)];
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
    accent: 'orange',
  },
  neon: {
    name: 'Neon',
    pixel: gradeNeon,
    halftone: 'rgba(120, 255, 255, 1)',
    accent: 'magenta',
  },
  vice: {
    name: 'Vice Duotone',
    pixel: gradeVice,
    halftone: 'rgba(62, 230, 255, 1)',
    accent: 'magenta',
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

// Subtle CRT scanline FX: very faint horizontal lines every few px, plus a slow
// vertical luminance roll so the photo zone reads like a 1980s video signal.
// Kept low-alpha so it never fights the type or the photo detail.
export function drawScanlines(ctx, x, y, w, hys, intensity) {
  ctx.save();
  const alpha = intensity == null ? 0.05 : intensity;
  const pitch = Math.max(3, Math.round(hys * 0.004));
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#000000';
  for (let gy = y; gy < y + hys; gy += pitch) {
    ctx.fillRect(x, gy, w, Math.max(1, pitch * 0.45));
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
  const lines = [line1 || '', line2 || ''].filter((l) => l.trim()).map((l) => l.toUpperCase());
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

  // Band-fit auto-fit: the width-based font size is kept unless the whole group
  // (kicker + title + tagline) would overflow the band height — then the whole
  // group scales down so it always fits its zone. Guarantees no vertical clipping.
  const fs2 = fs;
  const lh2 = fs2 * 0.86;
  const gap12 = hasK ? fs2 * 0.16 : 0;
  const gap22 = hasT ? fs2 * 0.28 : 0;
  const titleH2 = lh2 * lines.length;
  let kickerH2 = kickerH, tagH2 = tagH;
  let groupH2 = kickerH2 + gap12 + titleH2 + gap22 + tagH2;
  if (maxH != null && groupH2 > maxH) {
    const factor = maxH / groupH2;
    fs = Math.max(6, fs2 * factor);
    kickerH2 = Math.max(4, kickerH2 * factor);
    tagH2 = Math.max(6, tagH2 * factor);
    const lh3 = fs * 0.86;
    const gap13 = hasK ? fs * 0.16 : 0;
    const gap23 = hasT ? fs * 0.28 : 0;
    groupH2 = kickerH2 + gap13 + lh3 * lines.length + gap23 + tagH2;
    var lhFinal = lh3, gap1Final = gap13, gap2Final = gap23;
  } else {
    var lhFinal = lh2, gap1Final = gap12, gap2Final = gap22;
  }

  // Vertically centre the whole group inside the band.
  let top = y;
  if (maxH != null) top = y + Math.max(0, (maxH - groupH2) / 2);
  let cursor = top;

  // Kicker, letterspaced, above the title.
  if (hasK) {
    drawTracked(ctx, kicker.trim().toUpperCase(), px, cursor, kickerH2, kickerH2 * 0.22, '#f7e6b0');
    cursor += kickerH2 + gap1Final;
  }

  // Title lines: white fill, thin black outline, hard offset shadow, skewed -4deg.
  lines.forEach((line, i) => {
    const ty = cursor + i * lhFinal;
    ctx.font = fontFor(fs);
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
    const ty = cursor + lhFinal * lines.length + gap2Final;
    const tag = tagline.trim();
    let tagSize = tagH2;
    ctx.font = `${tagSize}px Pacifico, cursive`;
    let textW = ctx.measureText(tag).width;
    // Fit-check: shrink the tagline so it never exceeds the band width.
    while (textW > w * 0.86 && tagSize > 6) {
      tagSize -= 1;
      ctx.font = `${tagSize}px Pacifico, cursive`;
      textW = ctx.measureText(tag).width;
    }
    const tagX = px - textW / 2;

    // Soft dark shadow so it stays legible over bright photo areas.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 3;
    ctx.shadowOffsetX = 3;
    ctx.fillStyle = '#ffd97a';
    ctx.fillText(tag, px, ty);
    ctx.restore();

    // Subtle dark rounded scrim pill behind the tagline text.
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    const padX = tagSize * 0.55;
    const padY = tagSize * 0.18;
    const pillW = textW + padX * 2;
    const pillH = tagSize + padY * 2;
    const rx = Math.min(pillH * 0.6, pillH);
    ctx.roundRect(tagX - padX, ty - tagSize * 0.25 - padY, pillW, pillH, rx);
    ctx.fill();
    ctx.restore();

    // Draw the tagline on top of the scrim.
    ctx.font = `${tagSize}px Pacifico, cursive`;
    ctx.fillStyle = '#ffd97a';
    ctx.fillText(tag, px, ty);
  }

  ctx.restore();
  // Measured box of the whole title group, so the caller's overlap guard can prove
  // it never intersects the lockup, caption or badge boxes. The widest title line
  // plus a margin for the skew/shadow bounds the horizontal extent.
  let widest = 0;
  ctx.font = fontFor(fs);
  for (const l of lines) widest = Math.max(widest, ctx.measureText(l).width);
  const pad = fs * 0.12;
  return {
    top: Math.max(0, top - pad),
    bottom: Math.min(ctx.canvas.height, top + groupH2 + pad),
    left: Math.max(0, px - widest / 2 - pad),
    right: Math.min(ctx.canvas.width, px + widest / 2 + pad),
    size: fs,
  };
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
export function drawCaptionBand(ctx, x, y, w, h, text, color, accent) {
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
  if (accent) drawCaptionGlow(ctx, x, y, w, h, accent);
  let size = 0.6 * h;
  ctx.font = `900 ${size}px Anton, sans-serif`;
  while (ctx.measureText(txt).width > w * 0.58 && size > 12) {
    size -= 1;
    ctx.font = `900 ${size}px Anton, sans-serif`;
  }
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 6;
  ctx.fillText(txt, x + w / 2, y + h / 2 + h * 0.04);
  // Measured caption text box for the caller's overlap guard (fit-check: the text
  // is already shrunk to ≤ 70% of the band width below, and the badge sits outside
  // that budget).
  const textW = ctx.measureText(txt).width;
  ctx.restore();
  return {
    top: y + h / 2 - size * 0.65,
    bottom: y + h / 2 + size * 0.85,
    left: x + w / 2 - textW / 2 - size * 0.1,
    right: x + w / 2 + textW / 2 + size * 0.1,
    size,
  };
}

// Bottom caption band glow: a subtle gradient glow in the grade's accent color, behind the
// caption text. Band spans 1.5x the caption height and fades upward at 12% alpha.
function drawCaptionGlow(ctx, x, y, w, h, accent) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const gy = y + h - h * 1.5;
  const gg = ctx.createLinearGradient(x, gy, x, y + h);
  gg.addColorStop(0, `rgba(255, 128, 40, 0)`);
  gg.addColorStop(1, accent === 'magenta' ? 'rgba(255, 0, 230, 0.12)' : 'rgba(255, 128, 40, 0.12)');
  ctx.fillStyle = gg;
  ctx.fillRect(x, gy, w, h * 1.5);
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
// triangular rays behind it, the price on a rounded pill across the middle, and a small 'DAY ONE'
// caption above. No star shape anywhere.
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

  // Price pill: rounded black capsule centred over the disc, holding the price text.
  const pill = label || '9.99';
  ctx.fillStyle = '#101014';
  ctx.font = `900 ${size * 0.6}px Anton, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const pillW = Math.min(size * 2.0, ctx.measureText(pill).width + size * 0.5);
  const pillH = size * 0.58;
  const pillX = -pillW / 2;
  const pillY = -pillH / 2;
  ctx.beginPath();
  const pillR = pillH / 2;
  ctx.moveTo(pillX + pillR, pillY);
  ctx.lineTo(pillX + pillW - pillR, pillY);
  ctx.arc(pillX + pillW - pillR, pillY + pillH / 2, pillR, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(pillX + pillR, pillY + pillH);
  ctx.arc(pillX + pillR, pillY + pillH / 2, pillR, Math.PI / 2, Math.PI * 1.5);
  ctx.closePath();
  ctx.fill();

  // Price text inside the pill.
  ctx.fillStyle = '#ffffff';
  ctx.fillText(pill, 0, size * 0.02);

  // Small "DAY ONE" caption above the disc.
  ctx.fillStyle = '#16161a';
  ctx.font = `900 ${size * 0.34}px Anton, sans-serif`;
  ctx.fillText('DAY ONE', 0, -size * 0.98);
  ctx.restore();
  // Measured badge box for the caller's overlap guard: the ray disc plus the
  // DAY ONE caption above it (badge fills are decor, but the caption is text).
  return {
    top: cy - size * 1.25,
    bottom: cy + size * 1.55,
    left: cx - size * 1.55,
    right: cx + size * 1.55,
    size,
  };
}

// GTA VI-style logo lockup: small-caps letterspaced "GRAND THEFT AUTO" over a huge neon "VI".
// Centred horizontally at cx with its top at `top`, inside a width budget w. Auto-fits so
// "GRAND THEFT AUTO" spans ~60% of w and "VI" spans ~46% of w, and clamps the whole group so the
// total lockup height fits the remaining canvas. Draws a soft glow (accent color) behind the
// numerals so it pops over any photo.
export function drawLogoLockup(ctx, cx, top, w, accent, maxH) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const viText = 'VI';
  const kickerText = 'GRAND THEFT AUTO';
  // Measure the "VI" at a reference size so we can scale it to a target width.
  const refSize = 100;
  ctx.font = `900 ${refSize}px Anton, 'Arial Black', sans-serif`;
  const viW = ctx.measureText(viText).width;
  const availZone = maxH != null ? Math.max(1, maxH) : Math.max(1, ctx.canvas.height - top);

  // Smarter lockup sizing: take the larger of the width-driven VI and a
  // height-driven VI that fills ~92% of the zone, then let the zone be the hard
  // ceiling. This keeps a big centred VI on portrait covers while still filling
  // short landscape bands instead of leaving dead space.
  const KICKER_RATIO = 0.20; // kicker size relative to the VI size
  const GAP_RATIO = 0.22;    // gap between kicker and VI as a fraction of the VI size
  const CAP_RATIO = 0.72;    // Anton cap-height as a fraction of the font size
  const perUnit = CAP_RATIO + GAP_RATIO + CAP_RATIO * KICKER_RATIO;
  const widthVi = refSize * (w * 0.46) / Math.max(1, viW);
  const heightVi = (availZone * 0.92) / perUnit;
  const growCapVi = refSize * (w * 0.60) / Math.max(1, viW);
  // Start width-driven; if the zone is generous let it grow (capped at 60% of w).
  let viSize = widthVi;
  if (widthVi * perUnit < availZone * 0.92) viSize = Math.min(heightVi, growCapVi);
  viSize = Math.max(6, Math.min(viSize, heightVi));

  // Kicker is letterspaced; fit it so the tracked line spans ~60% of w.
  let kSize = viSize * KICKER_RATIO;
  const kTrack = kSize * 0.34;
  const kickerW = measureTracked(ctx, kickerText, kSize, kTrack);
  kSize *= (w * 0.60) / Math.max(1, kickerW);

  const gap = viSize * 0.22;
  const totalH = kSize + gap + viSize;

  // Clamp the whole lockup as a unit so it fits its own zone height (never bleeds
  // into the title band below).
  const avail = maxH != null ? Math.max(1, maxH) : Math.max(1, ctx.canvas.height - top);
  const scale = totalH > avail ? avail / totalH : 1;
  const vSize = viSize * scale;
  const kkSize = kSize * scale;
  const kkTrack = kTrack * scale;
  const gGap = gap * scale;

  const kickerTop = top;
  const viTop = top + kkSize + gGap;

  // "GRAND THEFT AUTO": letterspaced small caps, cream/white fill, thin dark outline. Drawn first so
  // the VI's glow stacks over it. Drawn per-letter so tracking and outline apply together.
  ctx.save();
  ctx.font = `900 ${kkSize}px Anton, 'Arial Black', sans-serif`;
  const kkLine = kkSize * 0.05;
  const letters = [...kickerText];
  let kkTotal = 0;
  for (const ch of letters) kkTotal += ctx.measureText(ch).width + kkTrack;
  kkTotal -= kkTrack;
  let kx = cx - kkTotal / 2;
  ctx.lineWidth = Math.max(1, kkLine);
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.fillStyle = '#f4f0e8';
  for (const ch of letters) {
    ctx.strokeText(ch, kx, kickerTop);
    ctx.fillText(ch, kx, kickerTop);
    kx += ctx.measureText(ch).width + kkTrack;
  }
  ctx.restore();

  // "VI" numerals. Three passes so it reads over any photo: soft glow, hard shadow, then outline + fill.
  ctx.font = `900 ${vSize}px Anton, 'Arial Black', sans-serif`;

  // Soft glow in the accent color behind the numerals.
  ctx.save();
  ctx.shadowColor = accent || '#ff3fae';
  ctx.shadowBlur = vSize * 0.22;
  ctx.fillStyle = '#ff3fae';
  ctx.fillText(viText, cx, viTop);
  ctx.restore();

  // Hard offset dark shadow.
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillText(viText, cx + vSize * 0.05, viTop + vSize * 0.055);
  ctx.restore();

  // Thick dark outline, then neon gradient fill on top.
  ctx.save();
  ctx.lineWidth = Math.max(2, vSize * 0.045);
  ctx.strokeStyle = 'rgba(0,0,0,0.92)';
  ctx.strokeText(viText, cx, viTop);
  const grad = ctx.createLinearGradient(0, viTop, 0, viTop + vSize);
  grad.addColorStop(0, '#ff3fae');
  grad.addColorStop(0.55, '#ff8c1a');
  grad.addColorStop(1, '#41e6ff');
  ctx.fillStyle = grad;
  ctx.fillText(viText, cx, viTop);
  ctx.restore();

  // Measured lockup box for the caller's overlap guard: kicker width bounds the
  // horizontal extent; the glow/shadow pad the vertical and horizontal extents.
  const lockupW = Math.min(w, measureTracked(ctx, kickerText, kkSize, kkTrack) * 1.15);
  const lockupH = kkSize + gGap + vSize * 1.12;
  ctx.restore();
  return {
    top: Math.max(0, top - vSize * 0.05),
    bottom: Math.min(ctx.canvas.height, top + lockupH),
    left: Math.max(0, cx - lockupW / 2),
    right: Math.min(ctx.canvas.width, cx + lockupW / 2),
    size: vSize,
  };
}

// Helper: width of a string drawn with letterspacing (tracking) at the given font size.
function measureTracked(ctx, text, size, tracking) {
  ctx.font = `900 ${size}px Anton, 'Arial Black', sans-serif`;
  let total = 0;
  for (const ch of text) total += ctx.measureText(ch).width + tracking;
  return total - tracking;
}

// Palm frond silhouette accent: a curved trunk with tapered frond strokes, drawn
// as a dark silhouette. Decorative only (never part of the text-overlap guard).
export function drawPalm(ctx, x, baseY, size, alpha, flip) {
  ctx.save();
  ctx.globalAlpha = alpha == null ? 0.32 : alpha;
  ctx.strokeStyle = '#0a0812';
  ctx.fillStyle = '#0a0812';
  ctx.lineCap = 'round';
  const dir = flip ? -1 : 1;
  // Trunk: gentle curve leaning inward.
  ctx.lineWidth = size * 0.055;
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  ctx.quadraticCurveTo(x + dir * size * 0.18, baseY - size * 0.45, x + dir * size * 0.34, baseY - size * 0.72);
  ctx.stroke();
  const crownX = x + dir * size * 0.34;
  const crownY = baseY - size * 0.72;
  // Fronds: 7 tapered arcs radiating from the crown.
  const angles = [-2.5, -2.0, -1.4, -0.8, -0.25, 0.3, 0.85];
  for (const a of angles) {
    const len = size * (0.38 + Math.abs(Math.cos(a)) * 0.12);
    const ex = crownX + Math.cos(a + (dir > 0 ? 0 : Math.PI)) * len * dir;
    const ey = crownY + Math.sin(a) * len;
    ctx.lineWidth = size * 0.045;
    ctx.beginPath();
    ctx.moveTo(crownX, crownY);
    ctx.quadraticCurveTo(crownX + (ex - crownX) * 0.5, ey - size * 0.18, ex, ey);
    ctx.stroke();
    // Droop tip.
    ctx.lineWidth = size * 0.028;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.quadraticCurveTo(ex + dir * size * 0.06, ey + size * 0.06, ex + dir * size * 0.12, ey + size * 0.14);
    ctx.stroke();
  }
  ctx.restore();
}

// Render-time guard: asserts no two text boxes intersect. Throws on any violation
// so an overlapping cover can never ship — the shoot script surfaces the throw.
export function assertNoTextOverlap(boxes) {
  const names = Object.keys(boxes).filter((k) => boxes[k] && boxes[k].bottom != null);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = boxes[names[i]], b = boxes[names[j]];
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlapX > 1 && overlapY > 1) {
        throw new Error(
          `text-overlap guard: "${names[i]}" intersects "${names[j]}" by ` +
          `${Math.round(overlapX)}x${Math.round(overlapY)}px ` +
          `(a=[${Math.round(a.left)},${Math.round(a.top)},${Math.round(a.right)},${Math.round(a.bottom)}] ` +
          `b=[${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)}])`,
        );
      }
    }
  }
  return true;
}

// The top-level draw. `state` holds everything: layout, grade, photos, panels, texts, toggles.
// `ctx` is a canvas context; the cover fills its whole area.
export function drawCover(ctx, state) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const margin = state.frame ? Math.min(w, h) * 0.02 : 0;
  const ax = margin, ay = margin, aw = w - margin * 2, ah = h - margin * 2;
  const base = Math.min(aw, ah);

  ctx.fillStyle = '#0c0d12';
  ctx.fillRect(0, 0, w, h);

  // ---- Strict poster zones: every text element owns a dedicated band and never
  // crosses into another's. From top to bottom: logo zone, title band, photo zone,
  // caption band. The badge lives in the caption band's right margin, outside the
  // caption text's fit budget, so it can never collide with anything.
  const hasLogo = !!state.logo;
  const logoH = hasLogo ? ah * 0.28 : 0;
  const titleH = hasLogo ? ah * 0.20 : ah * 0.30;
  const capH = ah * 0.12;
  const photoH = ah - logoH - titleH - capH - (hasLogo ? ah * 0.02 : 0);

  const logoZoneY = ay;
  const titleY = logoZoneY + logoH + (hasLogo ? ah * 0.02 : 0);
  const photoY = titleY + titleH;
  const photoHh = photoH;
  const capY = photoY + photoHh;

  const layout = state.layout || 'hero3';
  const grade = GRADES[state.grade] || GRADES.sunset;
  const rects = LAYOUTS[layout] || LAYOUTS.hero3;
  const count = PANEL_PHOTO_COUNT[layout] != null ? PANEL_PHOTO_COUNT[layout] : rects.length;

  for (let i = 0; i < count; i++) {
    const r = rects[i % rects.length];
    const pan = state.panels[i] || {};
    const photo = pan.photo || state.photos[0] || null;
    const rx = ax + r[0] * aw;
    const ry = photoY + r[1] * photoHh;
    const rw = r[2] * aw;
    const rh = r[3] * photoHh;
    drawPanel(ctx, photo, rx, ry, rw, rh,
      pan.panX ?? DEFAULT_PAN.panX,
      pan.panY ?? DEFAULT_PAN.panY,
      pan.zoom ?? DEFAULT_PAN.zoom);
    // Grade each panel rect right after it is drawn (before compositing) so the
    // per-pixel pass stays cheap even at full export resolution.
    applyGrade(ctx, rx, ry, rw, rh, grade);
    // Duo and grid layouts: crisp 2px dark border around each panel against the gutters.
    if (layout === 'duo' || layout === 'grid3') {
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(rx + 1, ry + 1, rw - 2, rh - 2);
      ctx.restore();
    }
  }

  // Vice treatment on the photo zone: halftone, vignette, scanlines and palm silhouettes.
  if (state.halftone) drawHalftone(ctx, ax, photoY, aw, photoHh, grade);
  if (state.grain) drawGrain(ctx, 0, 0, w, h, 0.05);
  if (state.vignette) drawVignette(ctx, ax, photoY, aw, photoHh, 0.45);
  if (state.scanlines) drawScanlines(ctx, ax, photoY, aw, photoHh, 0.05);
  // Palm accents in the photo zone's lower corners, leaning inward.
  drawPalm(ctx, ax + aw * 0.075, photoY + photoHh * 0.99, base * 0.30, 0.30, false);
  drawPalm(ctx, ax + aw * 0.925, photoY + photoHh * 0.99, base * 0.30, 0.30, true);

  // Title group: strictly inside its own band (band-fit auto-fit inside drawTitleBlock).
  const titleBox = drawTitleBlock(
    ctx, ax, titleY + ah * 0.01, aw,
    state.title1, state.title2, state.kicker, state.tagline,
    aw, ah, titleH - ah * 0.02,
  );

  const captionBox = drawCaptionBand(ctx, ax, capY, aw, capH, state.caption, '#ffffff', grade.accent);

  if (state.frame) drawFrame(ctx, 0, 0, w, h, '#e8e4da');

  // Price badge: bottom-right of the caption band, in the band's right margin. The
  // caption text is fit-checked to ≤70% of the band width (centred), so the badge's
  // right 25% is guaranteed free of caption text.
  const badgeSize = base * 0.055;
  const badgeCx = ax + aw - badgeSize * 1.6;
  const badgeCy = capY + capH / 2 - badgeSize * 0.4;
  const badgeBox = drawBadge(ctx, badgeCx, badgeCy, badgeSize, '#ff3b30', '#ffffff', state.price);

  // GTA VI logo lockup: owns the top zone exclusively, centred, clamped to the zone
  // height so it can never bleed into the title band.
  let logoBox = null;
  if (hasLogo) {
    logoBox = drawLogoLockup(ctx, w / 2, logoZoneY + ah * 0.015, aw * 0.62, grade.accent, logoH - ah * 0.03);
  }

  // Render-time guard: no two text boxes may intersect. Throws on violation.
  assertNoTextOverlap({ logo: logoBox, title: titleBox, caption: captionBox, badge: badgeBox });
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
    grade: 'vice',
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
    logo: true,
    photos: arr,
    panels,
  };
}

// Number of photo panels a layout draws.
export function getLayoutPanels(layout) {
  return PANEL_PHOTO_COUNT[layout] != null ? PANEL_PHOTO_COUNT[layout] : (LAYOUTS[layout] || LAYOUTS.hero3).length;
}

export { LAYOUTS, GRADES, seedPanels };