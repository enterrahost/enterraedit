/**
 * Verify the CSP style hash documented in the READMEs matches the CSS the
 * editor actually injects.
 *
 * A wrong hash is worse than no hash. Without it, `style-src 'self'` simply
 * leaves the editor unstyled and the cause is obvious. With a stale one, the
 * documented CSP looks correct, the page renders as a plain textarea, and
 * nothing explains why.
 *
 * That makes this worth a test rather than a note. The hash changes whenever
 * styles.js changes, which is exactly the kind of edit nobody remembers to
 * follow up.
 *
 *   node scripts/check-csp-hash.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];
  return candidates.find((c) => fs.existsSync(c)) || undefined;
}

const bundle = path.join(root, 'dist', 'enterraedit.min.js');
if (!fs.existsSync(bundle)) {
  console.error('No build found. Run `npm run build` first.');
  process.exit(1);
}

const browser = await puppeteer.launch({
  ...(findChrome() ? { executablePath: findChrome() } : {}),
  headless: 'shell',
  args: ['--no-sandbox', '--allow-file-access-from-files']
});
const page = await browser.newPage();

const probe = path.join(root, '_csp_probe.html');
fs.writeFileSync(probe, `<!DOCTYPE html><html><body>
<textarea id="t" data-enterraedit><p>x</p></textarea>
<script src="dist/enterraedit.min.js"></script></body></html>`);

await page.goto('file://' + probe, { waitUntil: 'networkidle0' });
await page.waitForSelector('.ee-editor');

// One <style> element is injected. If that ever becomes several, the hashes
// must be joined in a single style-src source list, so assert the count rather
// than silently hashing only the first.
const styles = await page.evaluate(() =>
  [...document.querySelectorAll('style')].map((e) => e.textContent)
);
await browser.close();
fs.unlinkSync(probe);

if (styles.length !== 1) {
  console.error(
    `Expected exactly one injected <style>, found ${styles.length}. ` +
      'The documented CSP hash covers one element; update this check first.'
  );
  process.exit(1);
}

const hash = crypto.createHash('sha256').update(styles[0], 'utf8').digest('base64');
const documentedAs = `sha256-${hash}`;

const targets = [
  path.join(root, 'README.md'),
  path.join(root, '..', 'enterraedit-cdn', 'public', 'index.html')
];

let failed = false;
let checked = 0;

for (const file of targets) {
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  const found = [...text.matchAll(/sha256-[A-Za-z0-9+/=]{20,}/g)].map((m) => m[0]);
  if (!found.length) continue;
  checked++;
  for (const f of found) {
    if (f !== documentedAs) {
      console.error(`STALE    ${path.relative(root, file)}`);
      console.error(`         documents ${f}`);
      console.error(`         actual    ${documentedAs}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error('\nThe injected CSS changed. Update the hash in the files above.');
  process.exit(1);
}

console.log(`CSP hash check passed (${checked} file(s), ${documentedAs}).`);
