// Regenerates the entry's screenshots from shots.json by loading the app's ?shot=
// scenes headlessly (the same scenes the dossier ships), and reports any page or
// console error so a broken app can never ship silently. Run:
//   node serve.ts --port 8123 &  then  node scripts/shoot.mjs
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outDir = join(root, 'screenshots');
mkdirSync(outDir, { recursive: true });

const BASE = process.env.SHOT_BASE || 'http://127.0.0.1:8123';
const CHROME = process.env.CHROME_PATH || '/opt/hermes-browser/chromium-1208/chrome-linux64/chrome';
const shots = JSON.parse(readFileSync(join(root, 'shots.json'), 'utf8'));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  defaultViewport: { width: 1280, height: 800 },
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--password-store=basic', '--use-mock-keychain'],
});

let failed = false;
try {
  for (const s of shots) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
    await page.setViewport({ width: s.w, height: s.h });
    await page.goto(BASE + '/' + (s.query || ''), { waitUntil: 'networkidle0' });
    // The cover scene draws to an offscreen canvas asynchronously; give it a beat.
    await new Promise((r) => setTimeout(r, 1200));
    await page.screenshot({ path: join(outDir, s.name), type: 'jpeg', quality: 88 });
    if (errors.length) {
      failed = true;
      console.error(`JS errors for ${s.name}:`);
      for (const e of errors) console.error('  ' + e);
    } else {
      console.log(`saved ${s.name} — no JS errors`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
