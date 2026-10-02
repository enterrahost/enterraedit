/**
 * Styles.
 *
 * Two things shape this file:
 *
 * 1. It is injected by JS, so the drop-in really is ONE file. No second <link>
 *    to forget, no CDN round-trip for a stylesheet.
 *
 * 2. Logical properties throughout (margin-inline-start, not margin-left).
 *    The original set `direction: rtl` and left every physical margin as-is,
 *    which broke the toolbar and dialogs in RTL. Logical properties mean the
 *    same rule is correct in both directions with no direction-specific CSS.
 */

export const STYLES = `
/*
 * Tokens carry fallbacks so the editor still renders correctly if a host page
 * pulls in the stylesheet without the JS that applies a theme. The JS sets the
 * same properties inline on .ee-root, which wins over these.
 *
 * There is no prefers-color-scheme block here. Theme
 * selection is the instance's job (see themes.js), because a media query would
 * override an explicit light theme chosen on a dark-mode machine.
 */
.ee-root {
  /* Sizing. Defaults here; JS overrides per instance. */
  --ee-width: 100%;
  --ee-max-width: 100%;
  --ee-min-height: 180px;
  --ee-max-height: 60vh;
  --ee-font: inherit;
  --ee-font-size: 1rem;
  --ee-radius: 6px;

  --ee-border: #d4d4d8;
  --ee-border-strong: #a1a1aa;
  --ee-bg: #ffffff;
  --ee-fg: #18181b;
  --ee-muted: #71717a;
  --ee-hover: #f4f4f5;
  --ee-active: #e4e4e7;
  --ee-focus: #2563eb;
  --ee-toolbar-bg: #fafafa;
  --ee-code-bg: #f4f4f5;
  --ee-shadow: none;

  /* inline-size, not width, so the control mirrors in RTL. max-inline-size
     keeps 'auto' from stretching to an unreadable measure in a wide column. */
  inline-size: var(--ee-width);
  max-inline-size: var(--ee-max-width);
  /* Fieldsets and flex parents default to min-width:auto, which lets a wide
     child push the container out rather than shrinking. */
  min-inline-size: 0;
  border: 1px solid var(--ee-border);
  border-radius: var(--ee-radius);
  background: var(--ee-bg);
  color: var(--ee-fg);
  box-shadow: var(--ee-shadow);
  font-family: var(--ee-font);
  font-size: var(--ee-font-size);
  overflow: hidden;
  box-sizing: border-box;
}

.ee-root *,
.ee-root *::before,
.ee-root *::after { box-sizing: border-box; }

/* ---------- toolbar ---------- */

.ee-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 6px;
  border-block-end: 1px solid var(--ee-border);
  background: var(--ee-toolbar-bg);
}

.ee-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: 32px;
  block-size: 32px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.ee-btn svg { inline-size: 18px; block-size: 18px; display: block; }

.ee-btn:hover { background: var(--ee-active); }

/* Visible focus is a WCAG requirement, not decoration. Never remove this
   without providing an equally visible replacement. */
.ee-btn:focus-visible {
  outline: 2px solid var(--ee-focus);
  outline-offset: 1px;
}

.ee-btn.is-active {
  background: var(--ee-active);
  border-color: var(--ee-border-strong);
}

.ee-sep {
  inline-size: 1px;
  block-size: 20px;
  background: var(--ee-border);
  margin-inline: 4px;
}

/* ---------- editing surface ---------- */

.ee-surface { position: relative; }

.ee-editor {
  /* Long unbroken strings (URLs, code) must wrap rather than widen the box. */
  overflow-wrap: anywhere;
  word-break: break-word;
  min-inline-size: 0;
  min-block-size: var(--ee-min-height);
  max-block-size: var(--ee-max-height);
  overflow-y: auto;
  padding: 12px 14px;
  outline: none;
  line-height: 1.6;
}

.ee-editor:focus-visible { outline: 2px solid var(--ee-focus); outline-offset: -2px; }

.ee-editor > * + * { margin-block-start: 0.75em; }

.ee-editor h1 { font-size: 1.6em; font-weight: 700; }
.ee-editor h2 { font-size: 1.35em; font-weight: 700; }
.ee-editor h3 { font-size: 1.15em; font-weight: 600; }

.ee-editor blockquote {
  /* Logical: in RTL the rule moves to the right edge automatically. */
  border-inline-start: 3px solid var(--ee-border-strong);
  padding-inline-start: 12px;
  margin-inline: 0;
  color: var(--ee-muted);
}

.ee-editor pre {
  background: var(--ee-code-bg);
  border: 1px solid var(--ee-border);
  border-radius: 4px;
  padding: 10px 12px;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
}

.ee-editor code {
  background: var(--ee-code-bg);
  border-radius: 3px;
  padding: 1px 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
}

.ee-editor pre code { background: none; padding: 0; }

.ee-editor a { color: var(--ee-focus); text-decoration: underline; }

.ee-editor hr {
  border: none;
  border-block-start: 1px solid var(--ee-border-strong);
  margin-block: 1em;
}

.ee-editor ul, .ee-editor ol { padding-inline-start: 1.5em; margin-block: 0.5em; }

/* ProseMirror's gap cursor, shown when the caret sits between blocks. */
.ee-editor .ProseMirror-gapcursor::after { border-block-start-color: var(--ee-fg); }

/* ---------- status ---------- */

.ee-status {
  display: flex;
  align-items: center;
  /* Count first, badge pushed to the far end. Logical properties mean this
     mirrors correctly in RTL without a direction-specific rule. */
  justify-content: flex-end;
  gap: 10px;
  padding: 4px 12px;
  border-block-start: 1px solid var(--ee-border);
  background: var(--ee-toolbar-bg);
  color: var(--ee-muted);
  font-size: 12px;
}

.ee-count { unicode-bidi: isolate; }

/* Attribution badge. Muted by default so it never competes with the content;
   full opacity on hover or keyboard focus. */
.ee-badge {
  color: var(--ee-muted);
  text-decoration: none;
  opacity: .75;
  border-radius: 3px;
  padding: 1px 2px;
  white-space: nowrap;
}

.ee-badge:hover { opacity: 1; text-decoration: underline; }

.ee-badge:focus-visible {
  opacity: 1;
  outline: 2px solid var(--ee-focus);
  outline-offset: 1px;
}

/* ---------- responsive ----------
 *
 * Sizing values are set as inline custom properties by JS, which normally wins
 * over stylesheet rules. A media query CAN still override a custom property
 * when it re-declares the property itself, so these blocks re-declare rather
 * than fight inline styles with !important.
 */

/* Small screens: tighter padding, a shorter minimum, and a taller cap so the
   editor uses the space it actually has. */
@media (max-width: 600px) {
  .ee-root {
    --ee-max-width: 100%;
    --ee-radius: 4px;
  }

  .ee-editor {
    padding: 10px 12px;
    min-block-size: min(var(--ee-min-height), 140px);
    max-block-size: min(var(--ee-max-height), 70vh);
  }

  .ee-toolbar {
    padding: 4px;
    gap: 1px;
  }

  .ee-btn {
    inline-size: 34px;   /* slightly larger tap targets */
    block-size: 34px;
  }

  .ee-status {
    padding: 3px 10px;
  }
}

/* Very small screens: let the toolbar scroll sideways instead of wrapping into
   four rows and eating the viewport. */
@media (max-width: 420px) {
  .ee-toolbar {
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: thin;
    /* Without this the flex container reports its *content* width (the sum of
       every button), which stretches the whole editor past the viewport
       instead of scrolling inside it. min-inline-size: 0 lets it shrink. */
    min-inline-size: 0;
    max-inline-size: 100%;
  }

  .ee-toolbar::-webkit-scrollbar { block-size: 4px; }
  .ee-toolbar::-webkit-scrollbar-thumb {
    background: var(--ee-border-strong);
    border-radius: 2px;
  }

  .ee-sep { flex: 0 0 auto; }
  .ee-btn { flex: 0 0 auto; }

  /* The badge is the first thing to go when space is tight. */
  .ee-badge { display: none; }

  .ee-editor { max-block-size: min(var(--ee-max-height), 60vh); }
}

/* Touch devices: a 32px target is below the 44px recommendation, so bump it
   when we can tell the primary input is coarse. */
@media (pointer: coarse) {
  .ee-btn {
    inline-size: 40px;
    block-size: 40px;
  }

  .ee-btn svg { inline-size: 20px; block-size: 20px; }
}

/* Landscape phones: viewport height is the scarce resource. */
@media (max-height: 480px) and (orientation: landscape) {
  .ee-editor { max-block-size: 50vh; }
}

/* Motion sensitivity: honour the OS setting rather than animating anyway. */
@media (prefers-reduced-motion: reduce) {
  .ee-root *, .ee-root *::before, .ee-root *::after {
    transition: none !important;
    animation: none !important;
  }
}
`;
