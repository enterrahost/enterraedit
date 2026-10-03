/**
 * Build the distributable bundle.
 *
 * esbuild on its own is not enough here, for one reason: the licence notice has
 * to be prepended to the output, and --banner:js only accepts literal text. A
 * multi-line banner passed through an npm script loses its newlines to shell
 * quoting, and a single-line banner of that length is unreadable. So the build
 * runs esbuild, then prepends the notice itself.
 *
 * WHY THE NOTICE MATTERS
 * EnterraEdit compiles ProseMirror into this file. ProseMirror is MIT licensed,
 * which permits that freely, on the condition that its copyright notice travels
 * with the software. Minification strips every banner, so without this step a
 * redistributed enterraedit.min.js gave no indication that ProseMirror is
 * inside it. See THIRD-PARTY.md for the full text.
 *
 *   node scripts/build.mjs            minified, for publishing
 *   node scripts/build.mjs --dev      unminified, for debugging
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');

const outfile = path.join(root, 'dist', dev ? 'enterraedit.js' : 'enterraedit.min.js');

const NOTICE = `/*!
 * EnterraEdit, MIT licensed. https://enterrahost.com/enterraedit
 *
 * Contains ProseMirror, Copyright (C) 2015-2017 by Marijn Haverbeke
 * <marijn@haverbeke.berlin> and others, also MIT licensed.
 * See THIRD-PARTY.md for the full notice.
 */`;

const args = [
  'src/index.js',
  '--bundle',
  '--format=iife',
  '--global-name=EnterraEditBundle',
  // Keeps any licence comments the dependencies ship, in case a future one
  // adds a banner esbuild would otherwise drop.
  '--legal-comments=inline',
  `--outfile=${path.relative(root, outfile)}`
];

// --minify-whitespace and --minify-identifiers rather than --minify: the full
// flag also strips the licence comments that --legal-comments just preserved.
if (!dev) {
  args.push('--minify-whitespace', '--minify-identifiers', '--minify-syntax');
}

execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), args, {
  cwd: root,
  stdio: ['ignore', 'inherit', 'inherit']
});

// Prepend the notice. Done after the build so it survives minification, and
// skipped if it is somehow already the first thing in the file.
const built = fs.readFileSync(outfile, 'utf8');
if (!built.startsWith('/*!')) {
  fs.writeFileSync(outfile, NOTICE + '\n' + built);
}

const kb = (fs.statSync(outfile).size / 1024).toFixed(1);
console.log(`  ${path.relative(root, outfile)}  ${kb}kb${dev ? ' (unminified)' : ''}`);
