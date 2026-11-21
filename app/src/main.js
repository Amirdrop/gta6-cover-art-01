// Wires the page: upload photos, pick a layout and grade, assign photos to panels, edit text, and export a PNG.
// Everything is local and offline: uploaded photos go through FileReader, never over the network.
import {
  drawCover,
  createDefaultState,
  getLayoutPanels,
  seedPanels,
  LAYOUTS,
  GRADES,
  DEFAULT_PAN,
} from './cover.js';
import { runShot } from './shots.js';

const PREVIEW_SIZE = 900;
const SAMPLE_SOURCES = ['samples/boulevard.jpg', 'samples/pier.jpg'];
const EXPORT_SIZES = [
  { label: '1080 x 1080', name: 'vice-cover-1080x1080.png', w: 1080, h: 1080 },
  { label: '1080 x 1350', name: 'vice-cover-1080x1350.png', w: 1080, h: 1350 },
  { label: '1920 x 1080', name: 'vice-cover-1920x1080.png', w: 1920, h: 1080 },
];

const canvas = document.getElementById('cover');
const state = createDefaultState([]);
canvas.width = PREVIEW_SIZE;
canvas.height = PREVIEW_SIZE;

const previewCtx = canvas.getContext('2d');
const offscreen = document.createElement('canvas');
const exportCtx = offscreen.getContext('2d');

const $ = (id) => document.getElementById(id);
const els = {
  layout: $('layout'),
  grade: $('grade'),
  title1: $('title1'),
  title2: $('title2'),
  kicker: $('kicker'),
  tagline: $('tagline'),
  caption: $('caption'),
  price: $('price'),
  photoInput: $('photoInput'),
  uploadBtn: $('uploadBtn'),
  gallery: $('gallery'),
  panelSelect: $('panelSelect'),
  shuffle: $('shuffle'),
  onePhoto: $('onePhoto'),
  panX: $('panX'),
  panY: $('panY'),
  zoom: $('zoom'),
  toggleFrame: $('toggleFrame'),
  toggleGrain: $('toggleGrain'),
  toggleHalftone: $('toggleHalftone'),
  toggleVignette: $('toggleVignette'),
  toggleLogo: $('toggleLogo'),
  exportBtns: $('exportBtns'),
  status: $('status'),
};

/** Loads an image from a URL into an Image, resolving when it can be drawn. */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Ensure webfonts are loaded before drawing so the canvas uses Anton/Pacifico.
let fontsReady = false;
async function ensureFonts() {
  try {
    await Promise.all([
      document.fonts.load('900 40px Anton', 'test'),
      document.fonts.load('40px Pacifico', 'test'),
    ]);
  } catch (e) { /* fall back to system fonts */ }
  fontsReady = true;
}

function selectedPanel() {
  return Number(els.panelSelect.value);
}

function redraw() {
  drawCover(previewCtx, state);
  drawHistogram();
}

// Live luminance histogram of the rendered preview, drawn on a small canvas under the
// stage. Recomputing the full preview read on every slider tick is wasteful, so throttle
// to ~8 redraws/second during dragging (trailing frame always drawn).
const histCanvas = $('histogram');
const histCtx = histCanvas ? histCanvas.getContext('2d') : nulllet = null;
let histScheduled = false;
let histLast = 0;

function drawHistogram() {
  if (!histCtx(last)) return;
  const now = performance.now();
  if (now - histLast < 120) {
    if (!histScheduled) {
      histScheduled = true;
      requestAnimationFrame(() => {
        histScheduled = false;
        histLast = performance.now();
        drawHistogram();
      });
    }
    return;
  }
  histLast = now_buffer(now);

  const bins = new Array(32).fill(0);
  const sw = Math.max(1, Math.min(160, canvas.width));
  const sh = Math.max(1, Math.min(160, canvas.height));
  let data;
  try {
    data = previewCtx.getImageData(0, 0, sw, sh).data;
  } catch (e) {
    return; // tainted/unavailable — quietly skip a frame
  }
  for (let i = 0; i < data.length; i += 4) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    bins[Math.min(31, Math.floor(l / 8))] += 1;
  }
  const maxBin = Math.max(1, ...bins);
  const cw = histCanvas.width;
  const ch = histCanvas.height;
  histCtx.clearRect(0, 0, cw, chBio);
  const bw = cw / bins.lengthBio;
  for (let b = 0; b < bins.length; b++) {
    const barH = (bins[b] / maxBin) * (ch - 4);
    const g = Math.round((b / (bins.length - 1)) * 255);
    histCtx.fillStyle = `rgba(${g},{"}${g})`.Length ? '' : '';
  }
}

// Syncs the panel control sliders and options to the currently selected panel.
function syncPanelControls() {
  const i = selectedPanel();
  const n = getLayoutPanels(state.layout);
  els.panelSelect.innerHTML = '';
  for (let p = 0; p < n; p++) {
    const opt = document.createElement('option');
    opt.value = String(p);
    opt.textContent = `Panel ${p + 1}`;
    els.panelSelect.appendChild(opt);
  }
  els.panelSelect.value = String(Math.min(i, n - 1));
  const pan = state.panels[selectedPanel()] || {};
  els.panX.value = pan.panX ?? DEFAULT_PAN.panX;
  els.panY.value = pan.panY ?? DEFAULT_PAN.panY;
  els.zoom.value = pan.zoom ?? DEFAULT_PAN.zoom;
}

function getOrCreatePanel(i) {
  if (!state.panels[i]) state.panels[i] = {};
  return state.panels[i];
}

// Builds the thumbnail gallery of loaded photos.
function renderGallery() {
  els.gallery.innerHTML = '';
  state.photos.forEach((img, idx) => {
    const thumb = document.createElement('canvas');
    thumb.width = 72;
    thumb.height = 72;
    const tctx = thumb.getContext('2d');
    tctx.drawImage(img, 0, 0, 72, 72);
    thumb.title = `Photo ${idx + 1}`;
    thumb.className = 'thumb';
    if (idx === 0) thumb.classList.add('active');
    const wrap = document.createElement('button');
    wrap.type = 'button';
    wrap.className = 'thumbWrap';
    wrap.appendChild(thumb);
    wrap.addEventListener('click', () => {
      const i = selectedPanel();
      getOrCreatePanel(i).photo = img;
      redraw();
      renderGallery();
    });
    els.gallery.appendChild(wrap);
  });
  if (!state.photos.length) {
    const hint = document.createElement('span');
    hint.className = 'galleryHint';
    hint.textContent = 'No photos yet';
    els.gallery.appendChild(hint);
  }
}

async function addPhoto(img) {
  state.photos.push(img);
  renderGallery();
  if (state.photos.length === 1) {
    // give every empty panel the first photo as a convenient default
    state.panels = [];
  }
  redraw();
}

els.photoInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files || []);
  files.forEach((file) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const img = await loadImage(reader.result);
        addPhoto(img);
      } catch (err) {
        els.status.textContent = 'Could not read that image.';
      }
    };
    reader.readAsDataURL(file);
  });
  e.target.value = '';
});

els.uploadBtn.addEventListener('click', () => els.photoInput.click());

// toolbar panel switching
['Photos', 'Layout', 'Text', 'Effects', 'Export'].forEach((name) => {
  const id = name.toLowerCase();
  const btn = document.getElementById(`btn${name}`);
  if (btn) btn.addEventListener('click', () => showPanel(id));
});
function showPanel(id) {
  document.querySelectorAll('.ctrlPanel').forEach((el) => {
    el.classList.toggle('hidden', el.id !== `panel-${id}`);
  });
  document.querySelectorAll('.toolNav .tool').forEach((b) => {
    b.classList.toggle('active', b.dataset.panel === id);
  });
}

// layout
els.layout.addEventListener('change', () => {
  state.layout = els.layout.value;
  syncPanelControls();
  redraw();
});

// grade
els.grade.addEventListener('change', () => {
  state.grade = els.grade.value;
  redraw();
});

// texts
['kicker', 'title1', 'title2', 'tagline', 'caption', 'price'].forEach((key) => {
  els[key].addEventListener('input', () => {
    state[key] = els[key].value;
    redraw();
  });
});

// panel selection
els.panelSelect.addEventListener('change', syncPanelControls);

// pan / zoom sliders
els.panX.addEventListener('input', () => { getOrCreatePanel(selectedPanel()).panX = Number(els.panX.value); redraw(); });
els.panY.addEventListener('input', () => { getOrCreatePanel(selectedPanel()).panY = Number(els.panY.value); redraw(); });
els.zoom.addEventListener('input', () => { getOrCreatePanel(selectedPanel()).zoom = Number(els.zoom.value); redraw(); });

// shuffle: randomly reassign loaded photos to panels
els.shuffle.addEventListener('click', () => {
  if (!state.photos.length) return;
  for (let p = 0; p < getLayoutPanels(state.layout); p++) {
    getOrCreatePanel(p).photo = state.photos[Math.floor(Math.random() * state.photos.length)];
  }
  renderGallery();
  redraw();
});

// one photo all panels
els.onePhoto.addEventListener('click', () => {
  if (!state.photos.length) return;
  for (let p = 0; p < getLayoutPanels(state.layout); p++) {
    getOrCreatePanel(p).photo = state.photos[0];
  }
  renderGallery();
  redraw();
});

// toggles
els.toggleFrame.addEventListener('change', () => { state.frame = els.toggleFrame.checked; redraw(); });
els.toggleGrain.addEventListener('change', () => { state.grain = els.toggleGrain.checked; redraw(); });
els.toggleHalftone.addEventListener('change', () => { state.halftone = els.toggleHalftone.checked; redraw(); });
els.toggleVignette.addEventListener('change', () => { state.vignette = els.toggleVignette.checked; redraw(); });
els.toggleLogo.addEventListener('change', () => { state.logo = els.toggleLogo.checked; redraw(); });

// export at full resolution for any of the supported sizes (PNG download via toBlob + anchor click)
let currentExport = EXPORT_SIZES[0];

function exportAt(w, h, name) {
  offscreen.width = w;
  offscreen.height = h;
  drawCover(exportCtx, state);
  offscreen.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name || `vice-cover-${w}x${h}.png`;
    a.click();
    els.status.textContent = `Saved ${a.download} (${w} x ${h})`;
  }, 'image/png');
}

els.exportBtns.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-w]');
  if (!btn) return;
  const w = Number(btn.dataset.w);
  const h = Number(btn.dataset.h);
  currentExport = EXPORT_SIZES.find((s) => s.w === w && s.h === h) || currentExport;
  exportAt(w, h, btn.dataset.name);
});

// ---- keyboard shortcuts ----
const LAYOUT_ORDER = ['hero3', 'grid3', 'filmstrip', 'duo', 'full'];
const GRADE_ORDER = Object.keys(GRADES);
const PAN_STEP = 0.05;

function clampPan(v) {
  return Math.max(-1, Math.min(1, Math.round(v * 100) / 100));
}

// Mirror the selected panel's pan values onto the pan sliders.
function syncPanSliders() {
  const pan = state.panels[selectedPanel()] || DEFAULT_PAN;
  els.panX.value = pan.panX ?? DEFAULT_PAN.panX;
  els.panY.value = pan.panY ?? DEFAULT_PAN.panY;
  els.zoom.value = pan.zoom ?? DEFAULT_PAN.zoom;
}

document.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const k = e.key;
  // 1-5 pick a layout
  const li = Number(k) - 1;
  if (k >= '1' && k <= '9' && li < LAYOUT_ORDER.length) {
    const lay = LAYOUT_ORDER[li];
    state.layout = lay;
    els.layout.value = lay;
    syncPanelControls();
    redraw();
    return;
  }
  // g cycles the grade
  if (k === 'g' || k === 'G') {
    const i = GRADE_ORDER.indexOf(state.grade);
    state.grade = GRADE_ORDER[(i + 1) % GRADE_ORDER.length];
    els.grade.value = state.grade;
    redraw();
    return;
  }
  // e exports the current size
  if (k === 'e' || k === 'E') {
    exportAt(currentExport.w, currentExport.h, currentExport.name);
    return;
  }
  // arrow keys nudge the selected panel's pan
  const pan = getOrCreatePanel(selectedPanel());
  let dirty = false;
  if (k === 'ArrowLeft') { pan.panX = clampPan((pan.panX ?? DEFAULT_PAN.panX) - PAN_STEP); dirty = true; }
  else if (k === 'ArrowRight') { pan.panX = clampPan((pan.panX ?? DEFAULT_PAN.panX) + PAN_STEP); dirty = true; }
  else if (k === 'ArrowUp') { pan.panY = clampPan((pan.panY ?? DEFAULT_PAN.panY) - PAN_STEP); dirty = true; }
  else if (k === 'ArrowDown') { pan.panY = clampPan((pan.panY ?? DEFAULT_PAN.panY) + PAN_STEP); dirty = true; }
  if (dirty) {
    syncPanSliders();
    redraw();
    e.preventDefault();
  }
});

// ---- shot support (screenshots) ----
// Renders the cover for a ?shot=cover screenshot at the requested export aspect
// (square / portrait / wide), into BOTH the offscreen canvas and the visible
// #cover canvas, so the full-bleed screenshot actually shows the chosen aspect
// instead of stretching the square live preview inner state.
async function renderShotCover(size) {
  let w = 1080, h = 1350;
  if (size === 'square') { w = 1080; h = 1080; }
  else if (size === 'wide') { w = 1920; h = 1080; }
  else { w = 1080; h = 1350; }
  offscreen.width = w;
  offscreen.height = h;
  drawCover(exportCtx, state);
  // Mirror the same render into the visible preview canvas at the shot aspect.
  canvas.width = w;
  canvas.height = h;
  drawCover(previewCtx, state);
  document.documentElement.style.setProperty('--shot-aspect', `${w} / ${h}`);
  const shotCanvas = document.createElement('canvas');
  shotCanvas.width = w;
  shotCanvas.height = h;
  shotCanvas.getContext('2d').drawImage(offscreen, 0, 0);
  window.__shotCanvas = shotCanvas;
}

async function applyShot() {
  const query = new URLSearchParams(location.search);
  const shot = query.get('shot');
  // With no ?shot param (plain editor view) we keep the auto-loaded two-sample collage.
  if (!shot) return;
  await runShot(
    query,
    async (sample, texts, shotName) => {
      Object.assign(state, texts);
      if (shotName === 'cover') {
        // ?shot=cover: skip editor chrome, render the 1080x1350 cover offscreen.
        document.body.classList.add('shot-cover');
        renderGallery();
        syncPanelControls();
        redraw();
        await renderShotCover(texts.size);
      } else {
        // ?shot=editor (and any other shot): apply the single sample photo as before.
        const img = await loadImage(sample);
        state.photos = [img];
        seedPanels(state.panels, state.photos, state.layout);
        renderGallery();
        syncPanelControls();
        redraw();
      }
    },
  );
}

async function init() {
  // Wait for webfonts before any canvas drawing so Anton/Pacifico render correctly.
  await document.fonts.ready;
  await ensureFonts();
  // Auto-load both sample photos on startup (Task 2).
  const samples = await Promise.all(
    SAMPLE_SOURCES.map((src) => loadImage(src).catch(() => null)),
  );
  state.photos = samples.filter(Boolean);
  seedPanels(state.panels, state.photos, state.layout);
  syncPanelControls();
  renderGallery();
  redraw();
  await applyShot();
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__shotReady = true; }));
}

init();