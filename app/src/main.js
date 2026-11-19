// Wires the page: upload photos, pick a layout and grade, assign photos to panels, edit text, and export a PNG.
// Everything is local and offline: uploaded photos go through FileReader, never over the network.
import {
  drawCover,
  createDefaultState,
  getLayoutPanels,
  LAYOUTS,
  GRADES,
} from './cover.js';
import { runShot } from './shots.js';

const PREVIEW_SIZE = 900;
const EXPORT_SIZE = 1800;

const canvas = document.getElementById('cover');
const state = createDefaultState(null)
canvas.width = PREVIEW_SIZE;
canvas.height = PREVIEW_SIZE;

const previewCtx = canvas.getContext('2d');
const offscreen = document.createElement('canvas');
offscreen.width = EXPORT_SIZE;
offscreen.height = EXPORT_SIZE;
const exportCtx = offscreen.getContext('2d');

const $ = (id) => document.getElementById(id);
const els = {
  layout: $('layout'),
  grade: $('grade'),
  title1: $('title1'),
  title2: $('title2'),
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
  exportBtn: $('exportBtn'),
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
  els.panX.value = pan.panX || 0;
  els.panY.value = pan.panY || 0;
  els.zoom.value = pan.zoom || 1;
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
['title1', 'title2', 'tagline', 'caption', 'price'].forEach((key) => {
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

// export at full resolution
els.exportBtn.addEventListener('click', () => {
  drawCover(exportCtx, state);
  offscreen.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'vice-cover.png';
    a.click();
    els.status.textContent = `Saved vice-cover.png (${EXPORT_SIZE} x ${EXPORT_SIZE})`;
  }, 'image/png');
});

// ---- shot support (screenshots) ----
async function applyShot() {
  const query = new URLSearchParams(location.search);
  await runShot(
    query,
    async (sample, texts, shot) => {
      const img = await loadImage(sample);
      state.photos = [img];
      Object.assign(state, texts);
      renderGallery();
      syncPanelControls();
      if (shot === 'cover') document.body.classList.add('shot-cover');
    },
  );
}

async function init() {
  await ensureFonts();
  await applyShot();
  syncPanelControls();
  renderGallery();
  redraw();
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__shotReady = true; }));
}

init();