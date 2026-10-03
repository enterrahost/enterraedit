/**
 * Fail if the README references an image that does not exist.
 *
 * A missing image renders as a broken-icon box on GitHub, which is the first
 * thing a visitor sees on the repository page. It is invisible when editing
 * locally in a plain editor, so it needs a check rather than care.
 *
 * Also reports images that exist but are not referenced, since unreferenced
 * screenshots bloat the repository for no reader benefit.
 */

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readme = path.join(root, 'README.md');
const text = fs.readFileSync(readme, 'utf8');

const referenced = new Set(
 [...text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1])
);

// Images are referenced by absolute raw.githubusercontent.com URL so that they
// render on the npm package page, where a relative path resolves against npm
// rather than this repository. The local file still has to exist, so a remote
// reference is mapped back to its path here. Without this the unused-file check
// below would report every image as unreferenced.
const RAW_PREFIX =
 'https://raw.githubusercontent.com/enterrahost/enterraedit/main/';

const referencedLocally = new Set(
 [...referenced].map((ref) =>
  ref.startsWith(RAW_PREFIX) ? ref.slice(RAW_PREFIX.length) : ref
 )
);

let failed = false;

for (const ref of referenced) {
 if (/^https?:/.test(ref) && !ref.startsWith(RAW_PREFIX)) continue;
 const local = ref.startsWith(RAW_PREFIX) ? ref.slice(RAW_PREFIX.length) : ref;
 const file = path.join(root, local);
 if (!fs.existsSync(file)) {
  console.error(`MISSING ${local}, referenced in README.md but does not exist`);
  failed = true;
 }
}

const shotsDir = path.join(root, 'shots');
if (fs.existsSync(shotsDir)) {
 for (const name of fs.readdirSync(shotsDir)) {
 const rel = `shots/${name}`;
 if (!referencedLocally.has(rel)) {
 // A warning rather than a failure: a screenshot is often captured
 // before the README links it. But three were committed by accident while
 // fixing other things, so once one is actually tracked it is an error.
 let strayTracked = false;
 try {
   execFileSync('git', ['ls-files', '--error-unmatch', rel], {
     cwd: root,
     stdio: 'ignore'
   });
   strayTracked = true;
 } catch {
   strayTracked = false;
 }
 if (strayTracked) {
   console.error(`STRAY    ${rel} is committed but nothing references it.`);
   console.error('         Remove it, or link it from README.md.');
   failed = true;
 } else {
   console.warn(`UNUSED ${rel}, present but not referenced in README.md`);
 }
 }
 }
}

// The test count is quoted in two places and went stale twice. Compare it
// against the assertions the suite actually defines, so the README cannot
// claim a number the tests do not produce.
const testSrc = fs.readFileSync(path.join(root, 'test.mjs'), 'utf8');
const assertions = (testSrc.match(/^\s*check\(/gm) || []).length;
const claimed = [...text.matchAll(/(\d{2,4})\s+([a-z-]*\s*)(?:browser tests|assertions)/g)]
  .map((m) => Number(m[1]));

// Run the suite and compare against what it actually reports, rather than
// against the source count. The previous version only failed when the README
// claimed MORE than the source defined, so a figure that had fallen behind
// passed silently: the README sat at 168 for two commits while the suite ran
// 182, and the same check let '100 real-browser assertions' through untouched.
let actual = null;
try {
  const out = execFileSync('node', ['test.mjs'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  const m = out.match(/(\d+)\/\d+ passed/);
  if (m) actual = Number(m[1]);
} catch {
  // A failing suite reports its own failure; this check only guards the README.
}

for (const n of claimed) {
  if (actual !== null && n !== actual) {
    console.error(
      `STALE    README claims ${n} tests; the suite reports ${actual}.`
    );
    console.error('         Update every count, including the layout block.');
    failed = true;
  } else if (actual === null && n > assertions) {
    console.error(
      `STALE    README claims ${n} tests but test.mjs defines only ${assertions} check() calls`
    );
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(
  `README check passed (${referenced.size} image reference(s), ` +
    `${claimed.length} test count(s) consistent).`
);
