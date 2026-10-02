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
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readme = path.join(root, 'README.md');
const text = fs.readFileSync(readme, 'utf8');

const referenced = new Set(
 [...text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1])
);

let failed = false;

for (const ref of referenced) {
 if (/^https?:/.test(ref)) continue;
 const file = path.join(root, ref);
 if (!fs.existsSync(file)) {
 console.error(`MISSING ${ref}, referenced in README.md but does not exist`);
 failed = true;
 }
}

const shotsDir = path.join(root, 'shots');
if (fs.existsSync(shotsDir)) {
 for (const name of fs.readdirSync(shotsDir)) {
 const rel = `shots/${name}`;
 if (!referenced.has(rel)) {
 console.warn(`UNUSED ${rel}, present but not referenced in README.md`);
 }
 }
}

if (failed) process.exit(1);
console.log(`README image check passed (${referenced.size} reference(s)).`);
