/**
 * Copy the version from package.json into src/version.js.
 *
 * Without this, package.json and the runtime VERSION constant drift apart and
 * the badge advertises a version nobody published. package.json is the single
 * source; this generates the other.
 *
 * Runs automatically on `prebuild`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const target = path.join(root, 'src', 'version.js');

const body = `/**
 * Product version.
 *
 * GENERATED from package.json by scripts/sync-version.mjs on prebuild.
 * Do not edit by hand, edit package.json instead.
 */
export const VERSION = ${JSON.stringify(pkg.version)};
`;

const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
if (current !== body) {
 fs.writeFileSync(target, body);
 console.log(`[enterraedit] version.js set to ${pkg.version}`);
}
