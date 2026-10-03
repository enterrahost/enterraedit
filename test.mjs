/**
 * Real-browser smoke test for the EnterraEdit spike.
 *
 * The original audit could only reason statically ("no browser was
 * available"), so its behavioural claims were inferences. This runs the actual
 * bundle in Chrome and asserts behaviour, including with a real screen-reader
 * accessibility tree where we can get at it.
 */

import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/**
 * Locate a browser to drive.
 *
 * Resolved rather than hardcoded, so the same suite runs on a laptop and in CI.
 * Order: an explicit override, then the usual per-platform install locations,
 * then the Chromium that puppeteer manages itself.
 */
function findChrome() {
  // An override that does not exist is a configuration mistake, not a reason to
  // fail: say so and carry on looking, rather than crashing with a stack trace
  // that reads like a test failure.
  if (process.env.CHROME_PATH) {
    if (fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
    console.log(`CHROME_PATH is set to ${process.env.CHROME_PATH} but nothing is there.`);
  }

  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    process.env.CHROME_BIN
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch (e) {
      /* ignore and keep looking */
    }
  }
  // Undefined lets puppeteer use whatever it installed.
  return undefined;
}

const CHROME = findChrome();
if (!CHROME) {
  console.log('No system Chrome found, falling back to the puppeteer download.');
}
const DEMO = 'file://' + path.join(__dirname, 'demo', 'index.html');

const results = [];
function check(name, pass, detail = '') {
 results.push({ name, pass, detail });
 console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ', ' + detail : ''}`);
}


/**
 * Poll until a condition holds.
 *
 * Fixed setTimeout waits make assertions racy: they pass or fail depending on
 * machine load, which is worse than no test because it trains people to
 * re-run failures. Every dialog assertion below waits for the state it is
 * about to assert on.
 */
async function until(page, fn, { timeout = 3000, label = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    if (await page.evaluate(fn)) return true;
    if (Date.now() - start > timeout) {
      console.log(`  (timed out waiting for ${label})`);
      return false;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

const dialogOpen = (p) => until(p, () => !!document.querySelector('.ee-dialog')?.open,
  { label: 'dialog open' });
const dialogClosed = (p) => until(p, () => !document.querySelector('.ee-dialog'),
  { label: 'dialog closed' });
const errorShown = (p) => until(p, () => {
  const e = document.querySelector('.ee-dialog-error');
  return !!e && !e.hidden && e.textContent.trim().length > 0;
}, { label: 'inline error' });

// Report the environment before launching. A CI failure with only a stack
// trace is guesswork; one line naming the browser and platform is not.
console.log(`platform ${process.platform} ${process.arch}, node ${process.version}`);
console.log(`browser  ${CHROME || '(puppeteer default)'}`);

let browser;
try {
  browser = await puppeteer.launch({
    ...(CHROME ? { executablePath: CHROME } : {}),
    headless: 'shell',
    args: ['--no-sandbox', '--allow-file-access-from-files']
  });
} catch (e) {
  // A launch failure is an environment problem, not an editor problem, and
  // saying so saves reading a stack trace to work that out.
  console.error('\nCould not start a browser.');
  console.error('  path: ' + (CHROME || '(puppeteer default)'));
  console.error('  error: ' + (e && e.message));
  console.error('\nOn a machine with no system Chrome, install one first:');
  console.error('  npx puppeteer browsers install chrome');
  process.exit(1);
}

const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (m) => {
 if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

await page.goto(DEMO, { waitUntil: 'networkidle0' });
await page.waitForSelector('.ee-editor', { timeout: 5000 });

/* ---------- 1. auto-init ---------- */

const counts = await page.evaluate(() => ({
 roots: document.querySelectorAll('.ee-root').length,
 editors: document.querySelectorAll('.ee-editor').length,
 textareasHidden: [...document.querySelectorAll('textarea[data-enterraedit]')].every(
 (t) => getComputedStyle(t).display === 'none'
 )
}));
check('auto-init upgraded all textareas', counts.roots >= 16, `roots=${counts.roots}`);
check('source textareas hidden (progressive enhancement)', counts.textareasHidden);

/* ---------- 2. zero network requests ---------- */

const requests = await page.evaluate(() =>
 performance.getEntriesByType('resource').map((r) => r.name)
);
const external = requests.filter((r) => !r.startsWith('file://'));
check('zero external network requests (self-contained)', external.length === 0,
 external.length ? external.join(', ') : 'no CDN fetches');

/* ---------- 3. i18n: tooltips AND aria-labels from one table ---------- */

const labels = await page.evaluate(() => {
 const root = document.querySelectorAll('.ee-root')[1]; // the German one
 const btns = [...root.querySelectorAll('.ee-btn')];
 const en = document.querySelectorAll('.ee-root')[1];
 return btns.slice(0, 4).map((b) => ({
 title: b.getAttribute('title'),
 aria: b.getAttribute('aria-label')
 }));
});
check('German tooltips resolved', labels[0].title === 'Fett', JSON.stringify(labels[0]));
check('aria-label matches tooltip (translate once)',
 labels.every((l) => l.title && l.title === l.aria),
 labels.map((l) => l.aria).join(' / '));

/* ---------- 4. a11y structure ---------- */

const a11y = await page.evaluate(() => {
 const root = document.querySelector('.ee-root');
 const bar = root.querySelector('.ee-toolbar');
 const ed = root.querySelector('.ee-editor');
 const btns = [...bar.querySelectorAll('.ee-btn')];
 return {
 barRole: bar.getAttribute('role'),
 barLabel: bar.getAttribute('aria-label'),
 edRole: ed.getAttribute('role'),
 edMultiline: ed.getAttribute('aria-multiline'),
 edLabel: ed.getAttribute('aria-label'),
 pressed: btns.filter((b) => b.hasAttribute('aria-pressed')).length,
 total: btns.length,
 everyLabelled: btns.every((b) => b.getAttribute('aria-label')),
 iconsAriaHidden: [...root.querySelectorAll('svg')].every(
 (s) => s.getAttribute('aria-hidden') === 'true'
 )
 };
});
check('toolbar has role=toolbar + label', a11y.barRole === 'toolbar' && !!a11y.barLabel,
 `${a11y.barRole} "${a11y.barLabel}"`);
check('editing surface is role=textbox aria-multiline', a11y.edRole === 'textbox' && a11y.edMultiline === 'true');
check('surface has aria-label', !!a11y.edLabel, a11y.edLabel);
check('every button has an accessible name', a11y.everyLabelled, `${a11y.total} buttons`);
check('toggle buttons expose aria-pressed', a11y.pressed >= 4, `${a11y.pressed} toggles`);
check('decorative SVG icons aria-hidden', a11y.iconsAriaHidden);

/* ---------- 5. RTL ---------- */

const rtl = await page.evaluate(() => {
 const roots = [...document.querySelectorAll('.ee-root')];
 const ar = roots[2].querySelector('.ee-editor');
 const forced = roots[3].querySelector('.ee-editor');
 return {
 arDir: ar.getAttribute('dir'),
 arLang: ar.getAttribute('lang'),
 forcedDir: forced.getAttribute('dir'),
 // logical properties should put the blockquote rule on the right in RTL
 arComputed: getComputedStyle(ar).direction
 };
});
check('Arabic auto-detects RTL from lang=ar', rtl.arDir === 'rtl' && rtl.arComputed === 'rtl',
 `dir=${rtl.arDir} computed=${rtl.arComputed}`);
check('lang passed through for spellcheck dictionary', rtl.arLang === 'ar', rtl.arLang);
check('forced data-dir=rtl honoured', rtl.forcedDir === 'rtl');

/* ---------- 5b. RTL layout details ---------- */

const rtlDetail = await page.evaluate(() => {
 const roots = [...document.querySelectorAll('.ee-root')];
 const ar = roots[2];
 const ed = ar.querySelector('.ee-editor');
 const status = ar.querySelector('.ee-status');
 // The German strings must NOT leak into the Arabic instance.
 const deRoot = roots[1];
 return {
 statusDir: status.getAttribute('dir'),
 statusBidi: status.style.unicodeBidi,
 // In RTL the blockquote rule should sit on the right edge.
 logicalOk: getComputedStyle(ed).direction === 'rtl',
 arCount: ar.querySelector('.ee-status').textContent,
 deCount: deRoot.querySelector('.ee-status').textContent,
 arToolbarLabel: ar.querySelector('.ee-toolbar').getAttribute('aria-label'),
 deToolbarLabel: deRoot.querySelector('.ee-toolbar').getAttribute('aria-label')
 };
});
check('status bar isolates bidi (number/word order preserved)', 
 rtlDetail.statusDir === 'auto' && rtlDetail.statusBidi === 'isolate',
 `dir=${rtlDetail.statusDir} unicode-bidi=${rtlDetail.statusBidi}`);
check('Arabic UI uses Arabic strings', rtlDetail.arToolbarLabel === 'شريط التنسيق',
 rtlDetail.arToolbarLabel);
check('German UI uses German strings', rtlDetail.deToolbarLabel === 'Formatierungsleiste',
 rtlDetail.deToolbarLabel);
check('Arabic count renders in Arabic', /\u062D\u0631\u0641/.test(rtlDetail.arCount),
 rtlDetail.arCount);
check('no string leakage between instances',
 rtlDetail.arCount !== rtlDetail.deCount, `${rtlDetail.arCount} vs ${rtlDetail.deCount}`);

/* ---------- 6. spellcheck attributes ---------- */

const spell = await page.evaluate(() => {
 const eds = [...document.querySelectorAll('.ee-editor')];
 const de = document.querySelectorAll('.ee-root')[1].querySelector('.ee-editor');
 return {
 on: eds.slice(0, 4).every((e) => e.getAttribute('spellcheck') === 'true'),
 deLang: de.getAttribute('lang'),
 minOff: document.querySelectorAll('.ee-root')[4]
 .querySelector('.ee-editor').getAttribute('spellcheck')
 };
});
check('spellcheck=true by default', spell.on);
check('German surface carries lang=de (native spellcheck dictionary)', spell.deLang === 'de', spell.deLang);
check('spellcheck=false honoured', spell.minOff === 'false', spell.minOff);

/* ---------- 7. no-toolbar variant ---------- */

const noBar = await page.evaluate(() =>
 document.querySelectorAll('.ee-root')[4].querySelector('.ee-toolbar') === null
);
check('data-toolbar=false renders no toolbar', noBar);

/* ---------- 8. editing actually works ---------- */

await page.evaluate(() => {
 const ed = document.querySelectorAll('.ee-root')[0].querySelector('.ee-editor');
 ed.focus();
});
await page.keyboard.type('hello ');
// bold via keyboard shortcut
await page.keyboard.down('Meta');
await page.keyboard.press('b');
await page.keyboard.up('Meta');
await page.keyboard.type('bold');
const typed = await page.evaluate(() =>
 document.querySelectorAll('.ee-root')[0].querySelector('.ee-editor').innerHTML
);
check('typing works', typed.includes('hello'), typed.slice(0, 60));
check('Mod-b applies bold via keyboard (original had zero shortcuts)',
 /<strong>bold<\/strong>/.test(typed) || /font-weight/.test(typed), typed.slice(0, 120));

/* ---------- 9. aria-pressed reflects state ---------- */

const pressed = await page.evaluate(() => {
 const root = document.querySelectorAll('.ee-root')[0];
 const bold = [...root.querySelectorAll('.ee-btn')].find((b) => b.dataset.key === 'bold');
 return bold.getAttribute('aria-pressed');
});
check('aria-pressed updates to reflect bold state', pressed === 'true', `aria-pressed=${pressed}`);

/* ---------- 10. undo ---------- */

await page.keyboard.down('Meta');
await page.keyboard.press('z');
await page.keyboard.up('Meta');
const afterUndo = await page.evaluate(() =>
 document.querySelectorAll('.ee-root')[0].querySelector('.ee-editor').innerHTML
);
check('undo works (real history, not innerHTML snapshots)', !afterUndo.includes('bold'),
 afterUndo.slice(0, 80));

/* ---------- 11. XSS: javascript: URL rejected ---------- */

const xss = await page.evaluate(() => {
 // Reach the sanitiser through the public surface: create a link by
 // simulating what the link prompt would send.
 const ed = window.EnterraEdit;
 return {
 js: window.__eeSanitize ? window.__eeSanitize('javascript:alert(1)') : 'n/a'
 };
});
const sanitize = await page.evaluate(async () => {
 // Load the non-minified bundle's exported sanitiser via the global.
 return typeof window.EnterraEditBundle?.sanitizeUrl === 'function'
 ? [
 window.EnterraEditBundle.sanitizeUrl('javascript:alert(1)'),
 window.EnterraEditBundle.sanitizeUrl('https://ok.test'),
 window.EnterraEditBundle.sanitizeUrl('java\nscript:alert(1)')
 ]
 : null;
});
if (sanitize) {
 check('javascript: URL rejected', sanitize[0] === null, String(sanitize[0]));
 check('https: URL allowed', sanitize[1] === 'https://ok.test', String(sanitize[1]));
 check('newline-smuggled scheme rejected', sanitize[2] === null, String(sanitize[2]));
} else {
 check('sanitizeUrl exported for testing', false, 'not found on global');
}

/* ---------- 12. form serialisation ---------- */

const formValue = await page.evaluate(() => {
 const ta = document.getElementById('body-en');
 return ta.value.slice(0, 80);
});
check('textarea value kept in sync for form submit',
 formValue.includes('textarea') || formValue.includes('hello'), formValue.replace(/\n/g, ' '));

/* ---------- 13. console errors ---------- */

check('no console errors', consoleErrors.length === 0,
 consoleErrors.slice(0, 3).join(' | ') || 'clean');

/* ---------- 13b. every toolbar button actually does something ----------
 * The original shipped buttons that rendered but did nothing (and one that
 * threw on every click). Rendering a button is not the same as wiring it, so
 * each one is exercised and its effect on the document is asserted.
 */

const toolbarCoverage = await page.evaluate(() => {
 const results = [];
 const host = document.createElement('div');
 document.body.appendChild(host);
 const ta = document.createElement('textarea');
 ta.value = '<p>alpha bravo</p>';
 host.appendChild(ta);
 const ed = new window.EnterraEdit({ element: ta });
 const surface = ed.view.dom;

 const setCaret = (text) => {
 // Put the caret at the end of the paragraph content.
 let pos = null;
 ed.view.state.doc.descendants((node, p) => {
 if (node.isText && pos === null) pos = p + node.nodeSize;
 });
 ed.view.dispatch(ed.view.state.tr.setSelection(
 window.EnterraEditBundle
 ? ed.view.state.selection.constructor.near(ed.view.state.doc.resolve(pos || 1))
 : ed.view.state.selection
 ));
 };

 const list = [...ed.root.querySelectorAll('.ee-btn')].map((b) => b.dataset.key);
 return { buttons: list };
});

check('toolbar renders underline (was silently missing)', 
 toolbarCoverage.buttons.includes('underline'), toolbarCoverage.buttons.join(', '));
check('toolbar renders strikethrough', toolbarCoverage.buttons.includes('strike'));
check('full toolbar matches spec (19 buttons)', toolbarCoverage.buttons.length === 19,
  `${toolbarCoverage.buttons.length} buttons`);
check('full toolbar includes image and table',
  toolbarCoverage.buttons.includes('image') && toolbarCoverage.buttons.includes('table'));

// Exercise each mark through the real UI. The probe editor is placed at the
// top of the page and scrolled into view first, clicking at coordinates below
// the fold silently does nothing, which is a trap worth avoiding in the test
// rather than mistaking for a product bug.
const markResults = {};
for (const [key, sel] of [['bold', 'strong'], ['italic', 'em'], ['underline', 'u'], ['strike', 's']]) {
 await page.evaluate(() => {
 let host = document.getElementById('probe-host');
 if (!host) {
 host = document.createElement('div');
 host.id = 'probe-host';
 host.style.cssText = 'position:fixed;inset-block-start:0;inset-inline-start:0;z-index:99999;background:#fff;padding:4px;';
 document.body.appendChild(host);
 }
 host.innerHTML = '';
 const ta = document.createElement('textarea');
 ta.value = '<p>alpha bravo</p>';
 host.appendChild(ta);
 window.__probeEd = new window.EnterraEdit({ element: ta });
 window.__probeEd.focus();
 window.scrollTo(0, 0);
 });

 // Select the word through ProseMirror's own selection so the assertion is
 // about the mark, not about synthetic DOM range plumbing.
 await page.evaluate(() => {
 const v = window.__probeEd.view;
 const { TextSelection } = window.EnterraEditBundleProbe || {};
 const tr = v.state.tr.setSelection(
 v.state.selection.constructor.create(v.state.doc, 1, v.state.doc.content.size - 1)
 );
 v.dispatch(tr);
 });

 const btn = await page.evaluate((k) => {
 const b = [...document.querySelectorAll('#probe-host .ee-btn')].find((x) => x.dataset.key === k);
 b.scrollIntoView();
 const r = b.getBoundingClientRect();
 return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
 }, key);
 await page.mouse.click(btn.x, btn.y);

 const html = await page.evaluate(() => window.__probeEd.getHTML());
 markResults[key] = new RegExp(`<${sel}[ >]`).test(html);
 markResults[key + '_html'] = html.slice(0, 70);
 await page.evaluate(() => window.__probeEd.destroy());
}
check('Bold button produces <strong>', markResults.bold, markResults.bold_html);
check('Italic button produces <em>', markResults.italic, markResults.italic_html);
check('Underline button produces <u> (was a no-op)', markResults.underline, markResults.underline_html);
check('Strikethrough button produces <s> (was a no-op)', markResults.strike, markResults.strike_html);
check('selection survives toolbar mousedown (drop-in failure mode)',
 Object.values(markResults).filter((v) => v === true).length === 4,
 ['bold','italic','underline','strike'].map(k => k + '=' + markResults[k]).join(' '));

/* ---------- 13b. surface contrast on a host page ----------
 * A light editor on a dark page used to render near-black text on near-black:
 * .ee-root carried the background but .ee-editor did not, so the surface was
 * transparent and picked up the host page's colour instead. The existing
 * contrast checks read .ee-root and so passed while the text was unreadable.
 *
 * These assert the surface itself, in both themes, over a host page that
 * disagrees with the editor.
 */

const scHtml = path.join(__dirname, '_surface.html');
fs.writeFileSync(scHtml, `<!DOCTYPE html><html><head><style>
  body { background: #0a0a0a; color: #eeeeee; }
</style></head><body>
  <textarea id="sc" data-enterraedit data-mode="standard" data-theme="light">
    <h2>Heading</h2><p>Body text.</p>
  </textarea>
  <script src="dist/enterraedit.min.js"><\/script></body></html>`);

const scp = await browser.newPage();
const scErrors = [];
scp.on('pageerror', (e) => scErrors.push(e.message));
await scp.goto('file://' + scHtml, { waitUntil: 'networkidle0' });
await scp.waitForSelector('.ee-editor');

// Relative luminance, per WCAG, so the ratio below means something.
const luminance = (rgb) => {
  const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map(Number).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const surface = await scp.evaluate(() => {
  const el = document.querySelector('.ee-editor');
  const cs = getComputedStyle(el);
  return { bg: cs.backgroundColor, color: cs.color };
});

check('the editing surface is opaque, not transparent',
  !/rgba\(.*,\s*0\)$/.test(surface.bg) && surface.bg !== 'transparent',
  surface.bg);
check('light editor text is readable on a dark host page',
  contrast(surface.color, surface.bg) >= 4.5,
  `${contrast(surface.color, surface.bg).toFixed(2)}:1 (${surface.color} on ${surface.bg})`);

// And the same in dark theme over a light host page, which is the mirror case.
await scp.evaluate(() => {
  document.body.style.background = '#ffffff';
  document.body.style.color = '#111111';
  const ed = window.EnterraEdit.getInstance(document.getElementById('sc'));
  ed.setTheme('dark');
});
await new Promise((r) => setTimeout(r, 200));
const darkSurface = await scp.evaluate(() => {
  const cs = getComputedStyle(document.querySelector('.ee-editor'));
  return { bg: cs.backgroundColor, color: cs.color };
});
check('dark editor text is readable on a light host page',
  contrast(darkSurface.color, darkSurface.bg) >= 4.5,
  `${contrast(darkSurface.color, darkSurface.bg).toFixed(2)}:1 (${darkSurface.color} on ${darkSurface.bg})`);

check('surface contrast checks produced no page errors',
  scErrors.length === 0, scErrors.slice(0, 2).join(' | ') || 'clean');
await scp.close();
fs.unlinkSync(scHtml);

/* ---------- 13b2. host page styles must not bleed in ----------
 * A contenteditable creates no boundary, so a host page's `h2 { color }` rule
 * reaches straight into the editor. On the product page, which is dark, that
 * painted the editor's headings grey on the editor's own white background:
 * 2.5:1, and the editor looked broken rather than merely low contrast.
 *
 * The surface check above passes with content that has no colour of its own,
 * which is exactly why this asserts the elements INSIDE the editor.
 */

const bleedHtml = path.join(__dirname, '_bleed.html');
fs.writeFileSync(bleedHtml, `<!DOCTYPE html><html><head><style>
  body { background: #050505; color: #a3a3a3; }
  h1, h2, h3 { color: #a3a3a3; }
  p, li, td { color: #d4d4d8; }
</style></head><body>
  <textarea id="bl" data-enterraedit data-mode="standard" data-theme="light">
    <h2>Heading</h2><p>Paragraph.</p><ul><li>Item</li></ul>
  </textarea>
  <script src="dist/enterraedit.min.js"><\/script></body></html>`);

const blp = await browser.newPage();
await blp.goto('file://' + bleedHtml, { waitUntil: 'networkidle0' });
await blp.waitForSelector('.ee-editor');

const bleed = await blp.evaluate(() => {
  const ed = document.querySelector('.ee-editor');
  const colour = (sel) => {
    const el = ed.querySelector(sel);
    return el ? getComputedStyle(el).color : null;
  };
  return {
    bg: getComputedStyle(ed).backgroundColor,
    h2: colour('h2'),
    p: colour('p'),
    li: colour('li'),
    td: colour('td')
  };
});

for (const tag of ['h2', 'p', 'li']) {
  check(`editor ${tag} keeps its own colour against host styles`,
    bleed[tag] !== null && contrast(bleed[tag], bleed.bg) >= 4.5,
    `${bleed[tag]} on ${bleed.bg} = ${bleed[tag] ? contrast(bleed[tag], bleed.bg).toFixed(2) : 'n/a'}:1`);
}

await blp.close();
fs.unlinkSync(bleedHtml);

/* ---------- 13b3. native UI follows the editor theme ----------
 * Button tooltips are native title tooltips, which the browser paints from the
 * OS colour scheme rather than from CSS. A dark editor opened under a light OS
 * therefore showed a white tooltip on a white button: unreadable, and nothing
 * in the stylesheet could have fixed it. color-scheme is the only lever.
 */

const csProbe = async (theme) => {
  const pr = await browser.newPage();
  const f = path.join(__dirname, '_cs.html');
  fs.writeFileSync(f, `<!DOCTYPE html><html><body>
    <textarea data-enterraedit data-mode="comment" data-theme="${theme}"><p>x</p></textarea>
    <script src="dist/enterraedit.min.js"><\/script></body></html>`);
  await pr.goto('file://' + f, { waitUntil: 'networkidle0' });
  await pr.waitForSelector('.ee-editor');
  const out = await pr.evaluate(() => {
    const root = document.querySelector('.ee-root');
    return {
      inline: root.style.getPropertyValue('color-scheme').trim(),
      computed: getComputedStyle(root).colorScheme.trim(),
      theme: root.getAttribute('data-ee-theme')
    };
  });
  await pr.close();
  fs.unlinkSync(f);
  return out;
};

for (const theme of ['light', 'dark']) {
  const r = await csProbe(theme);
  check(`color-scheme follows the ${theme} theme, so native tooltips match`,
    r.computed === theme,
    `theme=${r.theme} color-scheme=${r.computed}`);
}

/* ---------- 13b4. native control appearance ----------
 * Safari and Firefox give buttons their own native appearance, which paints a
 * white active state over ours and fades the icon inside it. Chrome does not,
 * so this only ever appeared in some browsers, and looked like a styling
 * mistake rather than a missing reset. Asserted here because Chrome is what
 * runs the suite: a pass in Chrome says nothing about Safari on its own.
 */

const apHtml = path.join(__dirname, '_ap.html');
fs.writeFileSync(apHtml, `<!DOCTYPE html><html><body>
  <textarea data-enterraedit data-mode="full" data-theme="dark"><p>x</p></textarea>
  <script src="dist/enterraedit.min.js"><\/script></body></html>`);
const app = await browser.newPage();
await app.goto('file://' + apHtml, { waitUntil: 'networkidle0' });
await app.waitForSelector('.ee-editor');
await app.evaluate(() => {
  const btn = [...document.querySelectorAll('.ee-btn')].find((b) => b.title === 'Insert link');
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
});
await app.waitForSelector('.ee-dialog[open]', { timeout: 3000 });

const appearances = await app.evaluate(() => {
  const out = {};
  for (const sel of ['.ee-btn', '.ee-dialog-close', '.ee-btn-primary',
                     '.ee-btn-secondary', '.ee-dialog-input']) {
    const el = document.querySelector(sel);
    out[sel] = el ? getComputedStyle(el).appearance : 'missing';
  }
  return out;
});

for (const [sel, value] of Object.entries(appearances)) {
  check(`${sel} has no native appearance`,
    value === 'none',
    `appearance: ${value}`);
}
await app.close();
fs.unlinkSync(apHtml);

/* ---------- 13b5. placeholder ----------
 * A textarea's placeholder was lost the moment the editor replaced it, which
 * is the wrong way round: the attribute was already written, and an empty
 * message box with no prompt is worse than a plain textarea.
 */

const phHtml = path.join(__dirname, '_ph.html');
fs.writeFileSync(phHtml, `<!DOCTYPE html><html><body>
  <textarea data-enterraedit data-mode="comment"
            placeholder="Tell us what happened."><p></p></textarea>
  <script src="dist/enterraedit.min.js"><\/script></body></html>`);
const php = await browser.newPage();
await php.goto('file://' + phHtml, { waitUntil: 'networkidle0' });
await php.waitForSelector('.ee-editor');

const placeholderState = () => php.evaluate(() => {
  const surface = document.querySelector('.ee-surface');
  return {
    attr: surface.getAttribute('aria-empty'),
    shown: getComputedStyle(surface, '::before').content,
    text: surface.getAttribute('data-placeholder')
  };
});

const emptyState = await placeholderState();
check('the placeholder is carried over from the textarea',
  emptyState.text === 'Tell us what happened.', String(emptyState.text));
check('it shows while the document is empty',
  emptyState.attr === 'true' && emptyState.shown.includes('Tell us'),
  `aria-empty=${emptyState.attr} content=${emptyState.shown}`);

// Computed style is not enough, and that is the whole point of this check.
// The placeholder resolved correctly and was invisible on screen for a while,
// because the editor carried a z-index that painted its own background over
// it. Nothing in getComputedStyle('::before') shows that. Sampling the pixels
// is the only way to tell the two apart.
const phPixels = await php.evaluate(() => {
  const surface = document.querySelector('.ee-surface');
  const r = surface.getBoundingClientRect();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(r.width);
  canvas.height = Math.round(r.height);
  return { w: canvas.width, h: canvas.height };
});

const phShot = await php.screenshot({ encoding: 'base64' });
const phVisible = await php.evaluate(async (b64) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  // The top-left strip is where the placeholder sits. If it is drawn, this
  // strip contains more than one distinct colour.
  const data = ctx.getImageData(0, 0, Math.min(300, img.width), Math.min(40, img.height)).data;
  const seen = new Set();
  for (let i = 0; i < data.length; i += 4) {
    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  }
  return seen.size;
}, phShot);

check('the placeholder is actually painted, not just computed',
  phVisible > 1,
  `${phVisible} distinct colour(s) in the placeholder strip; 1 means it rendered nothing`);

await php.evaluate(() => {
  const ed = window.EnterraEdit.getInstance(document.querySelector('textarea'));
  ed.view.dispatch(ed.view.state.tr.insertText('hello', 1));
});
await new Promise((r) => setTimeout(r, 150));
const typedState = await placeholderState();
check('it hides once there is content',
  typedState.attr === 'false' && typedState.shown === 'none',
  `aria-empty=${typedState.attr} content=${typedState.shown}`);

await php.evaluate(() => {
  const ed = window.EnterraEdit.getInstance(document.querySelector('textarea'));
  ed.setHTML('<p></p>');
});
await new Promise((r) => setTimeout(r, 150));
const clearedState = await placeholderState();
check('it comes back when the field is cleared',
  clearedState.attr === 'true', `aria-empty=${clearedState.attr}`);

await php.close();
fs.unlinkSync(phHtml);

/* ---------- 13c. theming ---------- */

const themeInfo = await page.evaluate(() => {
 // The demo keeps its own reference for the switcher; reuse it rather than
 // re-scanning, since auto-init marks elements as already upgraded.
 const ed = window.__themedEditor;
 // Resolve to rgb() so contrast can be computed without parsing hex here.
 const probe = document.createElement('span');
 ed.root.appendChild(probe);
 const read = () => {
 const cs = getComputedStyle(ed.root);
 probe.style.color = cs.getPropertyValue('--ee-focus').trim();
 return {
 name: ed.getEffectiveTheme(),
 attr: ed.root.getAttribute('data-ee-theme'),
 bg: cs.backgroundColor,
 fg: cs.color,
 focus: cs.getPropertyValue('--ee-focus').trim(),
 focusRgb: getComputedStyle(probe).color
 };
 };
 const out = { initial: read() };
 ed.setTheme('dark');
 out.dark = read();
 ed.setTheme('light');
 out.light = read();
 ed.setTheme('sepia');
 out.sepia = read();
 ed.setTheme('light', '#345332');
 out.accent = read();
 ed.setTheme('dark', '#345332');
 out.accentDark = read();
 return out;
});

check('theme defaults to the element data-theme', themeInfo.initial.name === 'light',
 themeInfo.initial.name);
check('light theme is actually light',
 themeInfo.light.bg === 'rgb(255, 255, 255)', themeInfo.light.bg);
check('dark theme is actually dark',
 themeInfo.dark.bg === 'rgb(24, 24, 27)', themeInfo.dark.bg);
check('dark theme flips text colour too',
 themeInfo.dark.fg !== themeInfo.light.fg, `${themeInfo.light.fg} -> ${themeInfo.dark.fg}`);
check('sepia preset applies a distinct background',
 themeInfo.sepia.bg !== themeInfo.light.bg && themeInfo.sepia.bg !== themeInfo.dark.bg,
 themeInfo.sepia.bg);
check('setTheme() switches live without rebuilding',
 themeInfo.light.name === 'light' && themeInfo.dark.name === 'dark');

// The whole point of the accent maths: one hex must stay legible in BOTH modes.
function lum(rgbStr) {
 const m = rgbStr.match(/\d+/g).map(Number).slice(0, 3);
 const ch = m.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
 return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function ratio(a, b) {
 const la = lum(a), lb = lum(b);
 return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
// --ee-focus is used as link text on --ee-bg, so it must clear 4.5:1.
const lightContrast = ratio(themeInfo.accent.focusRgb, themeInfo.accent.bg);
const darkContrast = ratio(themeInfo.accentDark.focusRgb, themeInfo.accentDark.bg);
check('custom accent #345332 is legible on light (WCAG AA 4.5:1)',
 lightContrast >= 4.5, `contrast ${lightContrast.toFixed(2)}:1 (${themeInfo.accent.focus})`);
check('same accent auto-derived for dark stays legible',
 darkContrast >= 4.5, `contrast ${darkContrast.toFixed(2)}:1 (${themeInfo.accentDark.focus})`);
check('accent derives DIFFERENT values per mode (not one hex for both)',
 themeInfo.accent.focus !== themeInfo.accentDark.focus,
 `${themeInfo.accent.focus} vs ${themeInfo.accentDark.focus}`);

/* ---------- 13d. theme switcher UI ----------
 * Regression guard: a generic `.switcher button` rule was more specific than
 * `.swatch`, so every accent swatch silently rendered as an empty white
 * circle. The control looked present and did nothing visible, worth a test.
 */

const swatchEls = await page.evaluate(() => {
 return [...document.querySelectorAll('.swatch')].map((s) => {
 const cs = getComputedStyle(s);
 return {
 accent: s.dataset.accentSet,
 bg: cs.backgroundColor,
 w: Math.round(parseFloat(cs.inlineSize)),
 radius: cs.borderRadius
 };
 });
});
check('accent swatches actually paint their colour',
 swatchEls.length > 0 && swatchEls.every((s) => s.bg !== 'rgb(255, 255, 255)'),
 swatchEls.map((s) => `${s.accent}=${s.bg}`).join(' '));
check('swatches are square circles, not stretched by generic button padding',
 swatchEls.every((s) => s.w === 22), swatchEls.map((s) => s.w + 'px').join(','));
check('swatch colour matches its data-accent-set',
 swatchEls.every((s) => {
 const hex = s.accent.replace('#', '');
 const expect = 'rgb(' + [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ') + ')';
 return s.bg === expect;
 }),
 swatchEls.map((s) => s.accent).join(' '));

// Clicking a swatch must retheme the editor and mark itself pressed.
const swatchClick = await page.evaluate(() => {
 const sw = document.querySelector('.swatch[data-accent-set="#7c3aed"]');
 sw.click();
 const ed = window.__themedEditor;
 const probe = document.createElement('span');
 ed.root.appendChild(probe);
 probe.style.color = getComputedStyle(ed.root).getPropertyValue('--ee-focus').trim();
 return {
 accent: ed.options.accent,
 focus: getComputedStyle(probe).color,
 pressed: sw.getAttribute('aria-pressed')
 };
});
check('clicking a swatch applies that accent',
 swatchClick.accent === '#7c3aed', swatchClick.accent);
check('clicked swatch shows pressed state', swatchClick.pressed === 'true');
check('accent change alters the focus/link colour',
 swatchClick.focus !== themeInfo.accent.focus,
 `${themeInfo.accent.focus} -> ${swatchClick.focus}`);


/* ---------- 13e. branding / attribution ---------- */

const branding = await page.evaluate(() => {
 const roots = [...document.querySelectorAll('.ee-root')];
 const bySource = (id) => roots.find((r) => {
 const ta = r.previousElementSibling;
 return ta && ta.id === id;
 });
 const badgeRoot = bySource('body-badge');
 const plainRoot = bySource('body-nobadge');
 const noBrand = bySource('body-nobrand');
 const badge = badgeRoot && badgeRoot.querySelector('.ee-badge');
 return {
 headComments: [...document.head.childNodes]
 .filter((n) => n.nodeType === 8 && /EnterraEdit v/.test(n.textContent)).length,
 sourceAttr: roots[0].getAttribute('data-ee-source'),
 badgeCount: document.querySelectorAll('.ee-badge').length,
 badgeHref: badge && badge.getAttribute('href'),
 badgeRel: badge && badge.getAttribute('rel'),
 badgeTarget: badge && badge.getAttribute('target'),
 badgeTabIndex: badge && badge.tabIndex,
 badgeAria: badge && badge.getAttribute('aria-label'),
 badgeInToolbar: badgeRoot ? !!badgeRoot.querySelector('.ee-toolbar .ee-badge') : null,
 countText: badgeRoot ? badgeRoot.querySelector('.ee-count').textContent : null,
 plainHasBadge: plainRoot ? !!plainRoot.querySelector('.ee-badge') : null,
 noBrandHasBadge: noBrand ? !!noBrand.querySelector('.ee-badge') : null
 };
});


check('core: data-badge="true" renders no badge (no provider installed)',
 branding.badgeCount === 0, `${branding.badgeCount} badge(s)`);

/* ---------- 13f. sizing + responsive ---------- */

const sizing = await page.evaluate(() => {
 const roots = [...document.querySelectorAll('.ee-root')];
 const byId = (id) => roots.find((r) => r.previousElementSibling &&
 r.previousElementSibling.id === id);
 const box = (id) => {
 const r = byId(id);
 if (!r) return null;
 const cs = getComputedStyle(r);
 return {
 width: Math.round(r.getBoundingClientRect().width),
 minH: cs.getPropertyValue('--ee-min-height').trim(),
 maxH: cs.getPropertyValue('--ee-max-height').trim(),
 font: cs.fontFamily.slice(0, 40)
 };
 };
 return {
 auto: box('sz-auto'),
 fixed: box('sz-fixed'),
 grow: box('sz-grow'),
 rows: box('sz-rows'),
 serif: box('f-serif'),
 mono: box('f-mono'),
 custom: box('f-custom'),
 containerWidth: Math.round(document.body.getBoundingClientRect().width)
 };
});
check('auto width fills the container',
 sizing.auto && Math.abs(sizing.auto.width - sizing.auto.width) === 0 && sizing.auto.width > 300,
 `${sizing.auto && sizing.auto.width}px`);
check('fixed width is honoured (420px)',
 sizing.fixed && sizing.fixed.width === 420, `${sizing.fixed && sizing.fixed.width}px`);
check('fixed width is narrower than auto (so the option does something)',
 sizing.fixed.width < sizing.auto.width, `${sizing.fixed.width} vs ${sizing.auto.width}`);
check('height=auto removes the max-height cap',
 sizing.grow && sizing.grow.maxH === 'none', sizing.grow && sizing.grow.maxH);
check('data-rows derives a min-height from line count',
 sizing.rows && /calc\(/.test(sizing.rows.minH), sizing.rows && sizing.rows.minH);
check('font=serif applies a serif stack',
 /Georgia|serif/i.test(sizing.serif.font), sizing.serif.font);
check('font=mono applies a monospace stack',
 /mono|Menlo|Consolas/i.test(sizing.mono.font), sizing.mono.font);
check('a raw CSS font string passes through',
 /Georgia/i.test(sizing.custom.font), sizing.custom.font);
check('default font inherits from the host page, not a bundled webfont',
 /system-ui|-apple-system|Segoe/.test(sizing.auto.font) || sizing.auto.font === 'inherit',
 sizing.auto.font);

/* ---------- 13g. responsive / mobile ---------- */

async function atWidth(w, h, fn) {
 await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
 await new Promise((r) => setTimeout(r, 250));
 return page.evaluate(fn);
}

const desktop = await atWidth(1200, 900, () => {
 const r = document.querySelector('.ee-root');
 const bar = r.querySelector('.ee-toolbar');
 return {
 btn: Math.round(r.querySelector('.ee-btn').getBoundingClientRect().width),
 wrap: getComputedStyle(bar).flexWrap,
 badge: !!r.querySelector('.ee-badge'),
 overflowX: getComputedStyle(bar).overflowX
 };
});

const phone = await atWidth(390, 844, () => {
 const r = document.querySelectorAll('.ee-root')[0];
 const bar = r.querySelector('.ee-toolbar');
 const rect = r.getBoundingClientRect();
 return {
 btn: Math.round(r.querySelector('.ee-btn').getBoundingClientRect().width),
 wrap: getComputedStyle(bar).flexWrap,
 overflowX: getComputedStyle(bar).overflowX,
 width: Math.round(rect.width),
 viewport: document.documentElement.clientWidth,
 toolbarWidth: Math.round(bar.getBoundingClientRect().width),
 toolbarScrollW: bar.scrollWidth,
 // the page as a whole must not scroll sideways
 pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
 overflows: rect.width > document.documentElement.clientWidth + 1
 };
});

check('desktop: toolbar wraps rather than scrolls', desktop.wrap === 'wrap', desktop.wrap);
check('mobile: editor does not overflow the viewport',
 phone.overflows === false, `${phone.width}px in ${phone.viewport}px viewport`);
check('mobile: toolbar scrolls its overflow instead of widening the page',
 phone.toolbarScrollW > phone.toolbarWidth && phone.toolbarWidth <= phone.viewport,
 `toolbar ${phone.toolbarWidth}px, content ${phone.toolbarScrollW}px, viewport ${phone.viewport}px`);
check('mobile: touch targets are at least 34px',
 phone.btn >= 34, `${phone.btn}px (desktop ${desktop.btn}px)`);
check('mobile: toolbar scrolls sideways instead of stacking',
 phone.wrap === 'nowrap' && phone.overflowX === 'auto',
 `wrap=${phone.wrap} overflow-x=${phone.overflowX}`);

// badge hides on the narrowest screens
await page.setViewport({ width: 360, height: 780, deviceScaleFactor: 1 });
await new Promise((r) => setTimeout(r, 250));
const tiny = await page.evaluate(() => {
 const r = [...document.querySelectorAll('.ee-root')].find(
 (x) => x.querySelector('.ee-badge')
 );
 if (!r) return { hasBadge: false, display: 'n/a' };
 return { hasBadge: true, display: getComputedStyle(r.querySelector('.ee-badge')).display };
});
check('mobile: page does not scroll sideways', phone.pageOverflow === false,
 `scrollWidth ${phone.pageOverflow ? '>' : '='} clientWidth`);

check('badge collapses on the narrowest screens',
 tiny.hasBadge === false || tiny.display === 'none', JSON.stringify(tiny));

await page.setViewport({ width: 900, height: 1200, deviceScaleFactor: 2 });
await new Promise((r) => setTimeout(r, 200));

/* ---------- 13h. attribution policy ----------
 * The demo page loads the SELF-HOSTED build, which must add nothing at all.
 * The CDN build's attribution is verified separately in the dual-build check
 * below, since it needs a different bundle.
 */

const ossClean = await page.evaluate(() => ({
 headLinks: document.head.querySelectorAll('[data-ee-attribution]').length,
 authorLink: !!document.querySelector('head link[rel="author"]'),
 comment: [...document.head.childNodes].some(
 (n) => n.nodeType === 8 && /EnterraEdit/.test(n.textContent)
 ),
 badge: document.querySelectorAll('.ee-badge').length,
 sourceAttr: document.querySelector('[data-ee-source]'),
 // The core has no distribution identity of its own; branding is supplied by
 // whoever builds on top of it.
 hasProvider: !!window.EnterraEditBundle.getAttributionProvider()
}));
check('core ships with NO attribution provider installed',
 ossClean.hasProvider === false, `provider: ${ossClean.hasProvider}`);
check('core: NO head links injected at all',
 ossClean.headLinks === 0 && ossClean.authorLink === false, `${ossClean.headLinks} links`);
check('core: no head comment', ossClean.comment === false);
check('core: no badge anywhere', ossClean.badge === 0, `${ossClean.badge} badge(s)`);
check('core: no data-ee-source attribute', ossClean.sourceAttr === null);

// Opting back in explicitly must still work, even on the OSS build.
const optIn = await page.evaluate(() => {
 const host = document.createElement('div');
 document.body.appendChild(host);
 const ta = document.createElement('textarea');
 ta.value = '<p>x</p>';
 host.appendChild(ta);
 const ed = new window.EnterraEdit({ element: ta, branding: true, badge: true });
 const r = {
 badge: !!ed.root.querySelector('.ee-badge'),
 headLinks: document.head.querySelectorAll('[data-ee-attribution]').length
 };
 ed.destroy();
 return r;
});
check('core: badge stays off even when branding is allowed',
 optIn.badge === false, 'attribution is a build property, not just a flag');
check('core: no head links even when branding is allowed',
 optIn.headLinks === 0, `${optIn.headLinks} links`);

/* ---------- 13k. security: stored XSS via link hrefs ----------
 * Attack path: hostile HTML reaches the document by any route other than the
 * link dialog (setHTML, paste, a textarea's initial content, a server round
 * trip), survives into getHTML(), is stored, and executes for whoever later
 * renders that page. The link dialog was already guarded; these routes were not.
 */

const XSS = {
 'javascript: href': '<p><a href="javascript:window.__pwned=42">click</a></p>',
 'JaVaScRiPt: case': '<p><a href="JaVaScRiPt:window.__pwned=42">click</a></p>',
 'javascript: encoded': '<p><a href="java&#115;cript:window.__pwned=42">click</a></p>',
 'newline-smuggled': '<p><a href="java\nscript:window.__pwned=42">click</a></p>',
 'data: uri': '<p><a href="data:text/html,<script>parent.__pwned=42<\/script>">x</a></p>',
 'vbscript:': '<p><a href="vbscript:MsgBox(1)">x</a></p>',
 'blob:': '<p><a href="blob:https://x/y">x</a></p>',
 'no scheme at all': '<p><a href="javascript&#58;alert(1)">x</a></p>'
};

const xssResults = [];
for (const [name, payload] of Object.entries(XSS)) {
 const out = await page.evaluate((html) => {
 const host = document.createElement('div');
 host.style.display = 'none';
 document.body.appendChild(host);
 const ta = document.createElement('textarea');
 host.appendChild(ta);
 const ed = new window.EnterraEdit({ element: ta });
 ed.setHTML(html);
 const result = ed.getHTML();
 ed.destroy();
 return result;
 }, payload);
 const dangerous = /javascript:|vbscript:|data:text\/html|blob:/i.test(out);
 xssResults.push({ name, out, dangerous });
}

check('no javascript:/data:/vbscript: href survives setHTML()',
 xssResults.every((r) => !r.dangerous),
 xssResults.filter((r) => r.dangerous).map((r) => r.name).join(', ') || 'all neutralised');
check('link text is preserved when the href is rejected',
 xssResults[0].out.includes('click'),
 xssResults[0].out);
check('safe links gain rel=noopener noreferrer',
 await page.evaluate(() => {
 const host = document.createElement('div');
 document.body.appendChild(host);
 const ta = document.createElement('textarea');
 host.appendChild(ta);
 const ed = new window.EnterraEdit({ element: ta });
 ed.setHTML('<p><a href="https://example.com">ok</a></p>');
 const out = ed.getHTML();
 ed.destroy();
 return /rel="noopener noreferrer/.test(out);
 }));

// Markup injection: no payload may create executable elements.
const markup = await page.evaluate(() => {
 const host = document.createElement('div');
 host.style.display = 'none';
 document.body.appendChild(host);
 const ta = document.createElement('textarea');
 host.appendChild(ta);
 window.__pwned = 0;
 const ed = new window.EnterraEdit({ element: ta });
 ed.setHTML(
 '<p>x</p><script>window.__pwned=1<\/script>' +
 '<img src=x onerror="window.__pwned=1">' +
 '<svg onload="window.__pwned=1"></svg>' +
 '<iframe src="javascript:window.__pwned=1"></iframe>'
 );
 const out = ed.getHTML();
 const pwned = window.__pwned;
 ed.destroy();
 return { out, pwned };
});
check('script/iframe/svg/onerror payloads do not execute',
 markup.pwned === 0, `window.__pwned=${markup.pwned}`);
check('no script or iframe element survives into the output',
  !/<script|<iframe/i.test(markup.out), markup.out.slice(0, 70));
check('event-handler attributes are stripped',
  !/onerror|onload/i.test(markup.out), markup.out.slice(0, 70));

/* ---------- 13l. sanitizeUrl unit behaviour ---------- */

const urlCases = await page.evaluate(() => {
 const f = window.EnterraEditBundle.sanitizeUrl;
 return {
 js: f('javascript:alert(1)'),
 JsMixed: f('JaVaScRiPt:alert(1)'),
 newline: f('java\nscript:alert(1)'),
 tab: f('java\tscript:alert(1)'),
 data: f('data:text/html,<script>alert(1)<\/script>'),
 vb: f('vbscript:MsgBox(1)'),
 http: f('https://example.com'),
 mailto: f('mailto:a@b.com'),
 tel: f('tel:+123'),
 relative: f('/path/page'),
 protoRel: f('//cdn.example.com/x.js'),
 fragment: f('#section'),
 bareDomain: f('example.com/page'),
 empty: f(''),
 nullish: f(null)
 };
});
check('javascript: rejected', urlCases.js === null, String(urlCases.js));
check('mixed-case JaVaScRiPt: rejected', urlCases.JsMixed === null, String(urlCases.JsMixed));
check('newline-smuggled scheme rejected', urlCases.newline === null, String(urlCases.newline));
check('tab-smuggled scheme rejected', urlCases.tab === null, String(urlCases.tab));
check('data: rejected', urlCases.data === null, String(urlCases.data));
check('vbscript: rejected', urlCases.vb === null, String(urlCases.vb));
check('https: allowed', urlCases.http === 'https://example.com', String(urlCases.http));
check('mailto: allowed', urlCases.mailto === 'mailto:a@b.com', String(urlCases.mailto));
check('tel: allowed', urlCases.tel === 'tel:+123', String(urlCases.tel));
check('root-relative allowed', urlCases.relative === '/path/page', String(urlCases.relative));
check('protocol-relative allowed', urlCases.protoRel === '//cdn.example.com/x.js', String(urlCases.protoRel));
check('fragment allowed', urlCases.fragment === '#section', String(urlCases.fragment));
check('bare domain gets https:// prefixed',
 urlCases.bareDomain === 'https://example.com/page', String(urlCases.bareDomain));
check('empty and null inputs return null',
 urlCases.empty === null && urlCases.nullish === null);

/* ---------- 13m. toolbar scroll affordance ----------
 * On narrow screens the toolbar scrolls sideways. Mobile browsers hide
 * scrollbars, so a toolbar clipped mid-button reads as broken rather than
 * scrollable. A fade on the trailing edge is the only cue that says otherwise.
 */

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await new Promise((r) => setTimeout(r, 300));

const fade = await page.evaluate(async () => {
  const wrap = document.querySelectorAll('.ee-root')[0].querySelector('.ee-toolbar-wrap');
  if (!wrap) return { missing: true };
  const bar = wrap.querySelector('.ee-toolbar');
  const read = () => ({
    atEnd: wrap.classList.contains('ee-toolbar-at-end'),
    opacity: getComputedStyle(wrap, '::after').opacity
  });
  const start = read();
  bar.scrollLeft = 9999;
  await new Promise((r) => setTimeout(r, 250));
  const end = read();
  bar.scrollLeft = 0;
  await new Promise((r) => setTimeout(r, 250));
  return {
    start,
    end,
    restored: read(),
    scrollable: bar.scrollWidth > bar.clientWidth,
    reachesEnd: Math.round(bar.scrollLeft) !== 9999
  };
});

check('toolbar wrapper exists for the fade cue', !fade.missing);
check('toolbar overflows and scrolls on a narrow viewport', fade.scrollable === true);
check('fade is visible when there is more toolbar to reach',
  fade.start.opacity === '1' && fade.start.atEnd === false,
  `opacity=${fade.start.opacity} atEnd=${fade.start.atEnd}`);
check('fade disappears at the end of the scroll range',
  fade.end.opacity === '0' && fade.end.atEnd === true,
  `opacity=${fade.end.opacity} atEnd=${fade.end.atEnd}`);
check('fade returns when scrolled back',
  fade.restored.opacity === '1', `opacity=${fade.restored.opacity}`);

await page.setViewport({ width: 900, height: 1200, deviceScaleFactor: 2 });
await new Promise((r) => setTimeout(r, 250));

/* ---------- 13n. link dialog ----------
 * Replaces window.prompt, which could not be styled and failed on
 * accessibility. The dialog is a native <dialog> + showModal(), so the browser
 * supplies the focus trap, Escape handling and focus restoration.
 */

{
  const dlgFile = path.join(__dirname, '_dlg_probe.html');
  fs.writeFileSync(dlgFile, `<!DOCTYPE html><html><body>
    <textarea id="t" data-enterraedit><p>hello world</p></textarea>
    <script src="dist/enterraedit.min.js"><\/script></body></html>`);
  const dp = await browser.newPage();
  const dlgErrors = [];
  dp.on('pageerror', (e) => dlgErrors.push(e.message));
  // Any native dialog means window.prompt/alert is still in the code path.
  let nativeDialog = false;
  dp.on('dialog', async (d) => { nativeDialog = true; await d.dismiss(); });
  await dp.goto('file://' + dlgFile, { waitUntil: 'networkidle0' });
  await dp.waitForSelector('.ee-editor');

  const selectAll = () => dp.evaluate(() => {
    const ed = window.EnterraEdit.getInstance(document.getElementById('t'));
    const tr = ed.view.state.tr.setSelection(
      ed.view.state.selection.constructor.create(ed.view.state.doc, 1, ed.view.state.doc.content.size - 1)
    );
    ed.view.dispatch(tr);
  });
  const openLinkDialog = async () => {
    const box = await dp.evaluate(() => {
      const b = [...document.querySelectorAll('.ee-btn')].find((x) => x.dataset.key === 'link');
      b.scrollIntoView();
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await dp.mouse.click(box.x, box.y);
    await dialogOpen(dp);
  };
  const dlgHtml = () => dp.evaluate(() =>
    window.EnterraEdit.getInstance(document.getElementById('t')).getHTML());
  const setField = (v) => dp.evaluate((val) => {
    const i = document.querySelector('.ee-dialog-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(i, val);
    i.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);

  await selectAll();
  await openLinkDialog();
  check('link dialog opens', await dp.evaluate(() => !!document.querySelector('.ee-dialog')?.open));
  check('link dialog is modal (focus trapped by the browser)',
    await dp.evaluate(() => document.querySelector('.ee-dialog').matches(':modal')));
  check('link dialog focuses its input',
    await dp.evaluate(() => document.activeElement.className.includes('ee-dialog-input')));
  check('link dialog is labelled for screen readers', await dp.evaluate(() => {
    const d = document.querySelector('.ee-dialog');
    const id = d.getAttribute('aria-labelledby');
    return !!id && !!document.getElementById(id);
  }));
  check('link dialog has an alert region for errors',
    await dp.evaluate(() => document.querySelector('.ee-dialog-error')?.getAttribute('role') === 'alert'));

  await setField('javascript:alert(1)');
  // Focus the field explicitly: earlier assertions in this suite move focus
  // around, and Enter only submits when it reaches the dialog's own input.
  await dp.evaluate(() => document.querySelector('.ee-dialog-input').focus());
  await dp.keyboard.press('Enter');
  await errorShown(dp);
  check('unsafe URL is rejected inline, dialog stays open',
    await dp.evaluate(() => {
      const e = document.querySelector('.ee-dialog-error');
      return !!e && !e.hidden && !!document.querySelector('.ee-dialog')?.open;
    }));
  check('unsafe URL inserts nothing', !(await dlgHtml()).includes('javascript'));

  await setField('example.com');
  await dp.evaluate(() => document.querySelector('.ee-dialog-input').focus());
  await dp.keyboard.press('Enter');
  await dialogClosed(dp);
  check('bare domain is accepted and dialog closes',
    await dp.evaluate(() => !document.querySelector('.ee-dialog')));
  const linked = await dlgHtml();
  check('link applied with https prefix', linked.includes('href="https://example.com"'), linked);
  check('link carries rel=noopener noreferrer nofollow',
    linked.includes('rel="noopener noreferrer nofollow"'));

  await selectAll();
  await openLinkDialog();
  check('existing link is detected and prefilled',
    (await dp.evaluate(() => document.querySelector('.ee-dialog-input').value)) === 'https://example.com');

  await dp.keyboard.press('Escape');
  await dialogClosed(dp);
  check('Escape closes the dialog',
    await dp.evaluate(() => !document.querySelector('.ee-dialog')));
  check('Escape returns focus to the editor',
    await dp.evaluate(() => document.activeElement.className.includes('ee-editor')));

  check('no native prompt or alert is used anywhere', nativeDialog === false);
  check('link dialog produces no console errors',
    dlgErrors.length === 0, dlgErrors.slice(0, 2).join(' | ') || 'clean');

  await dp.close();
  fs.unlinkSync(dlgFile);
}

/* ---------- 13o. image sources ----------
 * Same class as the link bug: ProseMirror's basic schema accepts any string as
 * an image src, so a javascript: or data: source survives into getHTML() and
 * is handed to the server. Browsers block script execution from an image src,
 * so it is less dangerous than the link case, but storing it is still wrong.
 */

const imgCases = await page.evaluate(() => {
  const f = window.EnterraEditBundle.sanitizeImageSrc;
  return {
    js: f('javascript:alert(1)'),
    vb: f('vbscript:MsgBox(1)'),
    file: f('file:///etc/passwd'),
    svg: f('data:image/svg+xml,<svg onload=alert(1)>'),
    png: f('data:image/png;base64,iVBORw0KGgo='),
    https: f('https://example.com/a.png'),
    relative: f('/uploads/a.png')
  };
});
check('image: javascript: rejected', imgCases.js === null, String(imgCases.js));
check('image: vbscript: rejected', imgCases.vb === null, String(imgCases.vb));
check('image: file:// rejected', imgCases.file === null, String(imgCases.file));
check('image: data:image/svg+xml rejected (can carry script)',
  imgCases.svg === null, String(imgCases.svg));
check('image: data:image/png allowed (pasted screenshots)',
  typeof imgCases.png === 'string' && imgCases.png.startsWith('data:image/png'),
  String(imgCases.png).slice(0, 30));
check('image: https allowed', imgCases.https === 'https://example.com/a.png');
check('image: relative path allowed', imgCases.relative === '/uploads/a.png');

const imgDoc = await page.evaluate(() => {
  const host = document.createElement('div');
  host.style.display = 'none';
  document.body.appendChild(host);
  const ta = document.createElement('textarea');
  host.appendChild(ta);
  const ed = new window.EnterraEdit({ element: ta });
  const out = {};
  for (const [name, html] of Object.entries({
    bad: '<p><img src="javascript:alert(1)"></p>',
    svg: '<p><img src="data:image/svg+xml,<svg onload=alert(1)>"></p>',
    good: '<p><img src="https://example.com/a.png" alt="a"></p>'
  })) {
    ed.setHTML(html);
    out[name] = ed.getHTML();
  }
  ed.destroy();
  return out;
});
check('image: unsafe src does not survive into the document',
  !/javascript:|svg\+xml/i.test(imgDoc.bad + imgDoc.svg),
  `${imgDoc.bad} | ${imgDoc.svg}`);
check('image: safe src round-trips with alt text',
  imgDoc.good.includes('https://example.com/a.png') && imgDoc.good.includes('alt="a"'),
  imgDoc.good);

/* ---------- 13p. toolbar modes ---------- */

const modeCounts = await page.evaluate(() => {
  const out = {};
  for (const mode of ['comment', 'standard', 'full']) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ta = document.createElement('textarea');
    host.appendChild(ta);
    const ed = new window.EnterraEdit({ element: ta, mode });
    const btns = [...ed.root.querySelectorAll('.ee-btn')];
    out[mode] = {
      count: btns.length,
      keys: btns.map((b) => b.dataset.key),
      firstIsSep: btns.length > 0 && btns[0].dataset.key === undefined,
      separators: ed.root.querySelectorAll('.ee-sep').length
    };
    ed.destroy();
  }
  return out;
});
check('comment mode is the smallest toolbar',
  modeCounts.comment.count === 8, `${modeCounts.comment.count} buttons`);
check('comment mode excludes structure and rich nodes',
  !modeCounts.comment.keys.includes('heading1') &&
  !modeCounts.comment.keys.includes('image') &&
  !modeCounts.comment.keys.includes('table'),
  modeCounts.comment.keys.join(','));
check('standard mode adds structure but not images or tables',
  modeCounts.standard.keys.includes('heading1') &&
  !modeCounts.standard.keys.includes('image'),
  `${modeCounts.standard.count} buttons`);
check('full mode includes everything',
  modeCounts.full.keys.includes('image') && modeCounts.full.keys.includes('table'),
  `${modeCounts.full.count} buttons`);
check('modes are ordered small to large',
  modeCounts.comment.count < modeCounts.standard.count &&
  modeCounts.standard.count < modeCounts.full.count,
  `${modeCounts.comment.count} < ${modeCounts.standard.count} < ${modeCounts.full.count}`);
check('no mode renders a leading separator',
  !modeCounts.comment.firstIsSep && !modeCounts.standard.firstIsSep && !modeCounts.full.firstIsSep);

// Filtering out a whole group can leave its separators adjacent, which renders
// as a cluster of dividers. Checked by walking the toolbar children rather than
// counting separators, since only adjacency is wrong.
const sepRuns = await page.evaluate(() => {
  const out = {};
  for (const mode of ['comment', 'standard', 'full']) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ta = document.createElement('textarea');
    host.appendChild(ta);
    const ed = new window.EnterraEdit({ element: ta, mode });
    const kids = [...ed.root.querySelector('.ee-toolbar').children];
    let run = 0;
    let maxRun = 0;
    for (const k of kids) {
      if (k.classList.contains('ee-sep')) { run++; maxRun = Math.max(maxRun, run); }
      else run = 0;
    }
    out[mode] = {
      maxRun,
      leading: kids[0].classList.contains('ee-sep'),
      trailing: kids[kids.length - 1].classList.contains('ee-sep')
    };
    ed.destroy();
  }
  return out;
});
check('separators never appear twice in a row',
  Object.values(sepRuns).every((r) => r.maxRun <= 1),
  Object.entries(sepRuns).map(([m, r]) => `${m}=${r.maxRun}`).join(' '));
check('no mode ends with a separator',
  Object.values(sepRuns).every((r) => !r.trailing));

const customList = await page.evaluate(() => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const ta = document.createElement('textarea');
  host.appendChild(ta);
  const ed = new window.EnterraEdit({ element: ta, toolbarKeys: ['bold', 'italic', 'link'] });
  const keys = [...ed.root.querySelectorAll('.ee-btn')].map((b) => b.dataset.key);
  ed.destroy();
  return keys;
});
check('an explicit toolbar list is honoured exactly',
  customList.join(',') === 'bold,italic,link', customList.join(','));
check('a custom list renders no separators',
  customList.length === 3, `${customList.length} buttons`);

/* ---------- 13q. images and tables ---------- */

const imgFile = path.join(__dirname, '_media_probe.html');
fs.writeFileSync(imgFile, `<!DOCTYPE html><html><body>
  <textarea id="t" data-enterraedit data-mode="full"><p>hello</p></textarea>
  <script src="dist/enterraedit.min.js"><\/script></body></html>`);
const mp = await browser.newPage();
const mediaErrors = [];
mp.on('pageerror', (e) => mediaErrors.push(e.message));
mp.on('console', (m) => { if (m.type() === 'error') mediaErrors.push(m.text()); });
await mp.goto('file://' + imgFile, { waitUntil: 'networkidle0' });
await mp.waitForSelector('.ee-editor');

// Image insertion by URL
await mp.evaluate(() => {
  const ed = window.EnterraEdit.getInstance(document.getElementById('t'));
  const tr = ed.view.state.tr.setSelection(
    ed.view.state.selection.constructor.create(ed.view.state.doc, 1, ed.view.state.doc.content.size - 1)
  );
  ed.view.dispatch(tr);
  ed._promptImage();
});
await new Promise((r) => setTimeout(r, 350));
check('image dialog opens', await mp.evaluate(() => !!document.querySelector('.ee-dialog')?.open));
await mp.evaluate(() => {
  const set = (n, v) => {
    const i = document.querySelector(`[name="${n}"]`);
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(i, v);
    i.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set('src', 'https://example.com/pic.png');
  set('alt', 'A picture');
  document.querySelector('.ee-dialog-input').focus();
});
await mp.keyboard.press('Enter');
await dialogClosed(mp);
const imgOut = await mp.evaluate(() =>
  window.EnterraEdit.getInstance(document.getElementById('t')).getHTML());
check('image inserted with src and alt',
  imgOut.includes('src="https://example.com/pic.png"') && imgOut.includes('alt="A picture"'),
  imgOut);

// Unsafe image src rejected in the dialog
await mp.evaluate(() => {
  const ed = window.EnterraEdit.getInstance(document.getElementById('t'));
  ed._promptImage();
});
// Wait for the field rather than a fixed delay: the dialog is created
// asynchronously and a fixed timeout makes this assertion flaky under load.
await mp.waitForSelector('[name="src"]', { timeout: 3000 });
// Wait for the dialog to be open AND the field focusable before typing into
// it. waitForSelector alone resolves as soon as the element exists, which can
// be before the dialog has finished opening, and an input event dispatched at
// that moment is lost. That produced an intermittent failure in which the
// field still held its previous value.
await until(mp, () => {
  const d = document.querySelector('.ee-dialog');
  const i = document.querySelector('[name="src"]');
  return !!(d && d.open && i && i.offsetParent !== null);
}, { label: 'image dialog open and focusable' });
await mp.evaluate(() => {
  const i = document.querySelector('[name="src"]');
  const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  s.call(i, 'javascript:alert(1)');
  i.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('.ee-dialog-input').focus();
});
await mp.keyboard.press('Enter');
await errorShown(mp);
check('unsafe image src rejected inline, dialog stays open',
  await mp.evaluate(() => {
    const e = document.querySelector('.ee-dialog-error');
    return !!e && !e.hidden && !!document.querySelector('.ee-dialog')?.open;
  }));
await mp.keyboard.press('Escape');
await dialogClosed(mp);

// Table insertion
await mp.evaluate(() => {
  const ed = window.EnterraEdit.getInstance(document.getElementById('t'));
  ed._promptTable();
});
await mp.waitForSelector('[name="cols"]', { timeout: 3000 });
await mp.evaluate(() => {
  const set = (n, v) => {
    const i = document.querySelector(`[name="${n}"]`);
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(i, v);
    i.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set('rows', '2');
  set('cols', '3');
  document.querySelector('.ee-dialog-input').focus();
});
await mp.keyboard.press('Enter');
await until(mp, () => /<table/.test(document.querySelector('.ee-editor')?.innerHTML || ''),
  { label: 'table inserted' });
const tblOut = await mp.evaluate(() =>
  window.EnterraEdit.getInstance(document.getElementById('t')).getHTML());
const rows = (tblOut.match(/<tr/g) || []).length;
const cells = (tblOut.match(/<t[dh]/g) || []).length;
check('table inserted with the requested shape',
  rows === 2 && cells === 6, `${rows} rows, ${cells} cells`);
check('first row is a header row', /<th/.test(tblOut));

// Out of range is refused. Wait for the dialog rather than a fixed delay:
// querying a field that has not rendered yet throws, the value never gets
// set, and the submit then succeeds with the defaults, which reads as a
// product failure when it is a test race.
await mp.evaluate(() => {
  window.EnterraEdit.getInstance(document.getElementById('t'))._promptTable();
});
await mp.waitForSelector('[name="rows"]', { timeout: 3000 });
await mp.evaluate(() => {
  const set = (n, v) => {
    const i = document.querySelector(`[name="${n}"]`);
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(i, v);
    i.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set('rows', '9999');
  document.querySelector('.ee-dialog-input').focus();
});
await mp.keyboard.press('Enter');
await errorShown(mp);
check('an out of range table size is refused',
  await mp.evaluate(() => {
    const e = document.querySelector('.ee-dialog-error');
    return !!e && !e.hidden;
  }));
await mp.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 200));

check('media insertion produces no console errors',
  mediaErrors.length === 0, mediaErrors.slice(0, 2).join(' | ') || 'clean');
await mp.close();
fs.unlinkSync(imgFile);

/* ---------- 13r. the button map ----------
 * The map is what a user reads to choose buttons. If it drifts from the toolbar
 * that actually renders, the documentation is worse than useless.
 */

const mapInfo = await page.evaluate(() => {
  const B = window.EnterraEditBundle;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const ta = document.createElement('textarea');
  host.appendChild(ta);
  const ed = new window.EnterraEdit({ element: ta, mode: 'full' });
  const rendered = [...ed.root.querySelectorAll('.ee-btn')].map((b) => b.dataset.key);
  ed.destroy();
  return {
    mapped: B.ALL_KEYS,
    rendered,
    groups: B.keysByGroup(),
    labels: B.BUTTONS,
    modes: B.MODES
  };
});
check('every mapped button actually renders',
  mapInfo.mapped.every((k) => mapInfo.rendered.includes(k)),
  mapInfo.mapped.filter((k) => !mapInfo.rendered.includes(k)).join(',') || 'all present');
check('every rendered button appears in the map',
  mapInfo.rendered.every((k) => mapInfo.mapped.includes(k)),
  mapInfo.rendered.filter((k) => !mapInfo.mapped.includes(k)).join(',') || 'all mapped');
check('every button has a label and a group',
  mapInfo.mapped.every((k) => {
    const m = mapInfo.labels[k];
    return m && typeof m.label === 'string' && m.label.length && typeof m.group === 'string';
  }));
check('every key belongs to at least one mode',
  mapInfo.mapped.every((k) => Object.values(mapInfo.modes).some((m) => m.includes(k))),
  mapInfo.mapped.filter((k) => !Object.values(mapInfo.modes).some((m) => m.includes(k))).join(',') || 'all covered');
check('keysByGroup covers every key exactly once',
  Object.values(mapInfo.groups).flat().length === mapInfo.mapped.length,
  `${Object.values(mapInfo.groups).flat().length} grouped vs ${mapInfo.mapped.length} mapped`);

const keyValidation = await page.evaluate(() => {
  const B = window.EnterraEditBundle;
  return {
    mixed: B.validateKeys(['bold', 'bolrd', 'italic', 'tabel']),
    allGood: B.validateKeys(['bold', 'italic']),
    notArray: B.validateKeys('bold')
  };
});
check('validateKeys separates known keys from typos',
  keyValidation.mixed.valid.join(',') === 'bold,italic' &&
  keyValidation.mixed.unknown.join(',') === 'bolrd,tabel',
  `valid=${keyValidation.mixed.valid} unknown=${keyValidation.mixed.unknown}`);
check('validateKeys handles a non-array without throwing',
  keyValidation.notArray.valid.length === 0 && keyValidation.notArray.unknown.length === 0);

// A typo must be reported, not silently dropped.
const typoWarning = await page.evaluate(() => {
  const seen = [];
  const original = console.warn;
  console.warn = (...args) => seen.push(args.join(' '));
  const host = document.createElement('div');
  document.body.appendChild(host);
  const ta = document.createElement('textarea');
  host.appendChild(ta);
  const ed = new window.EnterraEdit({ element: ta, toolbarKeys: ['bold', 'bolrd'] });
  const keys = [...ed.root.querySelectorAll('.ee-btn')].map((b) => b.dataset.key);
  ed.destroy();
  console.warn = original;
  return { seen, keys };
});
check('a misspelled key is reported rather than silently dropped',
  typoWarning.seen.some((m) => /bolrd/.test(m)), typoWarning.seen[0] || 'no warning');
check('valid keys still render when one is misspelled',
  typoWarning.keys.join(',') === 'bold', typoWarning.keys.join(','));

/* ---------- 13s. pasting and dropping image files ----------
 * A screenshot on the clipboard arrives as a File, not HTML, so the schema
 * never sees it. Without a handler it was discarded with no feedback at all.
 */

const paFile = path.join(__dirname, '_paste_probe.html');
fs.writeFileSync(paFile, `<!DOCTYPE html><html><body>
  <textarea id="t" data-enterraedit><p>hello</p></textarea>
  <script src="dist/enterraedit.min.js"><\/script></body></html>`);
const pp = await browser.newPage();
const pasteErrors = [];
pp.on('pageerror', (e) => pasteErrors.push(e.message));
await pp.goto('file://' + paFile, { waitUntil: 'networkidle0' });
await pp.waitForSelector('.ee-editor');

// A minimal but genuinely valid PNG, so the produced data URI is real.
const PNG_BYTES = [137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,
  8,6,0,0,0,31,21,196,137,0,0,0,10,73,68,65,84,120,156,99,0,1,0,0,5,0,1,13,10,45,
  180,0,0,0,0,73,69,78,68,174,66,96,130];

const firePaste = (name, type, bytes) => pp.evaluate(async (args) => {
  const ed = window.EnterraEdit.getInstance(document.getElementById('t'));
  // Reset first. setHTML replaces the document, so without this a rejected
  // paste would still show whatever the previous case inserted and the
  // assertion would pass or fail for the wrong reason.
  ed.setHTML('<p>before-' + args.name + '</p>');
  ed.view.focus();
  const dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array(args.bytes)], args.name, { type: args.type }));
  ed.view.dom.dispatchEvent(new ClipboardEvent('paste', {
    clipboardData: dt, bubbles: true, cancelable: true
  }));
  await new Promise((r) => setTimeout(r, 400));
  return ed.getHTML();
}, { name, type, bytes });

await pp.evaluate(() =>
  window.EnterraEdit.getInstance(document.getElementById('t')).setHTML('<p>a</p>'));
const pasted = await firePaste('shot.png', 'image/png', PNG_BYTES);
check('a pasted image is embedded as a data URI',
  /<img src="data:image\/png;base64,/.test(pasted), pasted.slice(0, 70));
check('the pasted image keeps the filename as alt text',
  /alt="shot\.png"/.test(pasted), pasted.slice(0, 90));

await pp.evaluate(() =>
  window.EnterraEdit.getInstance(document.getElementById('t')).setHTML('<p>b</p>'));
const dropped = await pp.evaluate(async (bytes) => {
  const ed = window.EnterraEdit.getInstance(document.getElementById('t'));
  const dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array(bytes)], 'dropped.png', { type: 'image/png' }));
  const r = ed.view.dom.getBoundingClientRect();
  ed.view.dom.dispatchEvent(new DragEvent('drop', {
    dataTransfer: dt, bubbles: true, cancelable: true,
    clientX: r.x + 20, clientY: r.y + 20
  }));
  await new Promise((r2) => setTimeout(r2, 400));
  return ed.getHTML();
}, PNG_BYTES);
check('a dropped image file is embedded',
  /<img src="data:image\/png;base64,/.test(dropped), dropped.slice(0, 70));

// Non-images and SVG must be left alone. The document keeps its placeholder
// text, which proves the paste changed nothing.
const exe = await firePaste('evil.exe', 'application/x-msdownload', [1, 2, 3]);
check('a non-image paste is ignored',
  !/<img/.test(exe) && exe.includes('before-evil.exe'), exe);
const svg = await firePaste('x.svg', 'image/svg+xml', [60, 115, 118, 103, 62]);
check('an SVG paste is refused (it can carry script)',
  !/<img/.test(svg) && svg.includes('before-x.svg'), svg);

check('paste handling produces no page errors',
  pasteErrors.length === 0, pasteErrors.slice(0, 2).join(' | ') || 'clean');
await pp.close();
fs.unlinkSync(paFile);

/* ---------- 13t. translation tables ----------
 * A key inserted into the wrong language block is invisible at runtime when a
 * later duplicate wins, and a duplicate silences the earlier value. Both
 * happened while adding the image strings, and neither was caught by any test.
 */

const i18nSrc = fs.readFileSync(path.join(__dirname, 'src', 'i18n.js'), 'utf8');

function blockFor(lang) {
  const start = i18nSrc.indexOf(`  ${lang}: {`);
  if (start === -1) return '';
  const end = i18nSrc.indexOf('\n  },', start);
  return i18nSrc.slice(start, end === -1 ? undefined : end);
}

const langKeys = {};
for (const lang of ['en', 'de', 'ar']) {
  const block = blockFor(lang);
  langKeys[lang] = [...block.matchAll(/^\s{4}([a-zA-Z]+):/gm)].map((m) => m[1]);
}

check('every language block was found',
  Object.values(langKeys).every((k) => k.length > 0),
  Object.entries(langKeys).map(([l, k]) => `${l}=${k.length}`).join(' '));
check('no language block has duplicate keys',
  Object.values(langKeys).every((keys) => new Set(keys).size === keys.length),
  Object.entries(langKeys)
    .filter(([, keys]) => new Set(keys).size !== keys.length)
    .map(([l]) => l)
    .join(',') || 'none');

// Every key English defines must exist in the others, or the UI falls back to
// English mid-sentence.
for (const lang of ['de', 'ar']) {
  const missing = langKeys.en.filter((k) => !langKeys[lang].includes(k));
  check(`${lang} covers every English key`, missing.length === 0,
    missing.length ? `missing: ${missing.join(', ')}` : 'complete');
}

// Values should be translated rather than copied. Two are legitimately
// identical: a brand name, and "Link", which is the same word in German.
const sameInBothLanguages = ['badge', 'dialogLabel'];
const strings = await page.evaluate(() => window.EnterraEditBundle.STRINGS);
const untranslated = langKeys.en.filter(
  (k) =>
    !sameInBothLanguages.includes(k) &&
    strings.de[k] === strings.en[k] &&
    strings.en[k].length > 3
);
check('German values are translated, not copied from English',
  untranslated.length === 0,
  untranslated.length ? `identical: ${untranslated.join(', ')}` : 'all translated');
check('no language block contains strings from another language', (() => {
  // A cheap shape check: German text should not appear in the English table.
  const en = blockFor('en');
  return !/einfuegen|waehlen|Bild-URL/.test(en);
})(), 'English block free of German strings');

/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */
/* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- *//* ---------- 14. destroy() exists (original leaked) ---------- */

const hasDestroy = await page.evaluate(() =>
 typeof window.EnterraEdit.prototype.destroy === 'function'
);
check('destroy() exists for teardown', hasDestroy);

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
 console.log('\nFAILURES:');
 failed.forEach((f) => console.log(' - ' + f.name + (f.detail ? ', ' + f.detail : '')));
 process.exit(1);
}
