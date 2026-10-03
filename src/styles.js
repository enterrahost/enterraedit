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
/* --- preventing a flash of source markup ------------------------------
 *
 * The editor is one script tag, and the script necessarily runs after the
 * fields it upgrades have been parsed and painted. On a slow load that shows
 * the raw value as plain text: a page whose field contains
 * <h2>Try the editor</h2> briefly displays exactly that string.
 *
 * A host page can close the gap by putting this rule in a stylesheet in its
 * head, which is parsed before any content is painted:
 *
 *   [data-enterraedit] { visibility: hidden; }
 *
 * Nothing here can do it on the host's behalf, because the editor's own
 * stylesheet arrives with the script, long after first paint. What the editor
 * does instead is remove the attribute's hiding once it has built, and leave
 * the field visible untouched if it could not. visibility is specified
 * rather than display so the element keeps its box: a display:none textarea
 * is skipped by some form serialisers, and the field has to remain submittable
 * whether or not the editor ever initialises.
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
  /* Column gap of 1px rather than 2. At 2px the standard mode came to 588px
     against a 576px content box, so the last button wrapped and dragged a row
     with it. The separators already provide visual division, which is what the
     wider gap was standing in for. */
  column-gap: 1px;
  row-gap: 3px;
  /* 5px rather than 6px: enough that the first and last buttons do not touch
     the border, without costing a column of width. */
  padding: 5px;
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
  /* flex: 0 0 auto keeps the 1px width from being squeezed, and the 3px
     margin is the whole of the separation. It used to be 4px, which together
     with the toolbar's own gap came to 10px per separator and 40px across the
     four in standard mode. That was enough to push them past the last button
     and onto a second line, where four invisible dividers took a row. */
  flex: 0 0 auto;
  inline-size: 1px;
  block-size: 20px;
  background: var(--ee-border);
  margin-inline: 3px;
}

/* ---------- editing surface ---------- */

.ee-surface { position: relative; }

/* Placeholder.
 *
 * Drawn as a ::before on the surface rather than written into the document, so
 * it never becomes content: nothing to strip on paste, nothing to serialise,
 * nothing a screen reader reads as text the visitor wrote.
 *
 * Shown only while the document is empty. The editor sets aria-empty on the
 * surface from ProseMirror's own emptiness rather than by measuring text,
 * because a document containing one empty paragraph is empty to a reader but
 * its textContent is an empty string either way, and an <img> alone is not.
 *
 * Outside .ee-editor, so it does not inherit the content colour or participate
 * in the editable region at all.
 */
.ee-surface { position: relative; }

.ee-surface[data-placeholder]:not([data-placeholder=''])[aria-empty='true']::before {
  content: attr(data-placeholder);
  position: absolute;
  inset-block-start: 12px;
  inset-inline-start: 14px;
  /* Match the surface padding so it sits exactly where typing would start. */
  max-inline-size: calc(100% - 28px);
  color: var(--ee-muted);
  pointer-events: none;
  /* Never announced: the description is the host page's job, and a placeholder
     read aloud twice is worse than not read at all. */
  user-select: none;
}

/* The caret still has to reach the first line, so the placeholder must not
   swallow a click meant to focus the field. pointer-events: none handles that.
   The editor deliberately gets no z-index: giving it one creates a stacking
   context that paints its opaque background over the placeholder, which then
   exists in the computed style and nowhere on screen. */
.ee-surface > .ee-editor { position: static; }

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
  /* The surface carries its own background rather than inheriting the one on
     .ee-root. It was transparent, so wherever the editor theme and the host
     page disagreed the text sat on the page colour instead: light theme on a
     dark site rendered near-black text on near-black. */
  background: var(--ee-bg);
  color: var(--ee-fg);
}

.ee-editor:focus-visible { outline: 2px solid var(--ee-focus); outline-offset: -2px; }

.ee-editor > * + * { margin-block-start: 0.75em; }

/* The content needs its own colour, not the one it inherits.
 *
 * A host page almost always styles h2 and p, and those rules reach straight
 * into the editor because contenteditable does not create a boundary. On the
 * product page, which is dark, its h2 rule painted the editor's headings grey
 * on the editor's own white background: measured at 2.5:1, and invisible
 * enough that the editor simply looked broken.
 *
 * Setting colour here rather than relying on inheritance means the editor
 * looks the same wherever it is dropped, which is the whole premise of a
 * drop-in. Specificity is also deliberately higher than a bare element
 * selector, so a plain p { color: ... } on the host page loses. */
.ee-editor,
.ee-editor p,
.ee-editor li,
.ee-editor h1,
.ee-editor h2,
.ee-editor h3,
.ee-editor h4,
.ee-editor h5,
.ee-editor h6,
.ee-editor blockquote,
.ee-editor td,
.ee-editor th {
  color: var(--ee-fg);
}

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

/* ---------- images and tables ---------- */

.ee-editor img {
  max-inline-size: 100%;
  block-size: auto;
  border-radius: 4px;
}

/* Selected images and cells need a visible state, or drag and selection
   look like nothing happened. */
.ee-editor img.ProseMirror-selectednode {
  outline: 2px solid var(--ee-focus);
  outline-offset: 2px;
}

.ee-editor table {
  border-collapse: collapse;
  inline-size: 100%;
  margin-block: 0.75em;
  table-layout: fixed;
  overflow: hidden;
}

.ee-editor th,
.ee-editor td {
  border: 1px solid var(--ee-border);
  padding: 6px 10px;
  vertical-align: top;
  position: relative;
}

.ee-editor th {
  background: var(--ee-toolbar-bg);
  font-weight: 600;
  text-align: start;
}

/* prosemirror-tables marks selected cells; without this, selecting a column
   is invisible. */
.ee-editor .selectedCell::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--ee-focus);
  opacity: .12;
  pointer-events: none;
}

.ee-editor .column-resize-handle {
  position: absolute;
  inset-block: 0;
  inset-inline-end: -2px;
  inline-size: 4px;
  background: var(--ee-focus);
  pointer-events: none;
}

.ee-editor .tableWrapper { overflow-x: auto; }

.ee-editor .resize-cursor { cursor: col-resize; }

/* ---------- dialog ----------
 *
 * Uses the same tokens as the editor, so it follows light, dark, sepia and a
 * custom accent with no extra work. Custom properties inherit into the top
 * layer, which is why no theme values are repeated here.
 */

.ee-dialog {
  padding: 0;
  border: 1px solid var(--ee-border);
  border-radius: var(--ee-radius);
  background: var(--ee-bg);
  color: var(--ee-fg);
  font-family: var(--ee-font);
  font-size: var(--ee-font-size);
  inline-size: min(440px, calc(100vw - 2rem));
  box-shadow: 0 12px 32px rgba(0, 0, 0, .18);
  box-sizing: border-box;
}

/* The reset above is scoped to .ee-root, and the dialog sits on <body>
   instead, to be in the top layer. Without this its controls fall back to
   content-box, so a width:100% input plus its padding overflows the dialog
   and the right edge no longer lines up with the buttons. */
.ee-dialog,
.ee-dialog *,
.ee-dialog *::before,
.ee-dialog *::after {
  box-sizing: border-box;
}

.ee-dialog::backdrop {
  background: rgba(0, 0, 0, .45);
}

.ee-dialog-form {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px;
}

.ee-dialog-title {
  margin: 0 32px 6px 0;
  font-size: 1rem;
  font-weight: 600;
}

/* Logical position keeps the close button on the correct side in RTL. */
.ee-dialog-close {
  position: absolute;
  inset-block-start: 12px;
  inset-inline-end: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: 30px;
  block-size: 30px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ee-muted);
  cursor: pointer;
}

.ee-dialog-close svg { inline-size: 16px; block-size: 16px; }
.ee-dialog-close:hover { background: var(--ee-hover); color: var(--ee-fg); }

.ee-dialog-label {
  font-size: .8rem;
  color: var(--ee-muted);
}

.ee-dialog-input {
  inline-size: 100%;
  padding: 8px 10px;
  border: 1px solid var(--ee-border-strong);
  border-radius: 4px;
  background: var(--ee-bg);
  color: var(--ee-fg);
  font: inherit;
  font-size: .92rem;
}

.ee-dialog-input:focus-visible {
  outline: 2px solid var(--ee-focus);
  outline-offset: 0;
  border-color: var(--ee-focus);
}

.ee-dialog-error {
  margin: 2px 0 0;
  color: #b91c1c;
  font-size: .82rem;
}

.ee-dialog-error[hidden] { display: none; }

@media (prefers-color-scheme: dark) {
  .ee-theme-dark .ee-dialog-error { color: #fca5a5; }
}

.ee-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-block-start: 12px;
}

.ee-btn-primary,
.ee-btn-secondary {
  padding: 7px 14px;
  border-radius: 4px;
  font: inherit;
  font-size: .88rem;
  cursor: pointer;
  border: 1px solid transparent;
}

/* One reset for every control the editor builds itself.
 *
 * Safari and Firefox give buttons and inputs their own native appearance, which
 * paints a white active state over ours and fades the icon inside it. Chrome
 * does not, so the fault only appeared in some browsers and looked like a
 * styling mistake rather than a missing reset. appearance: none makes the rules
 * above the whole of a control's look, and also stops the native focus ring
 * from fighting the one the editor draws.
 */
.ee-btn,
.ee-dialog-close,
.ee-btn-primary,
.ee-btn-secondary,
.ee-dialog-input {
  appearance: none;
  -webkit-appearance: none;
}

.ee-btn-primary {
  background: var(--ee-focus);
  /* Text on the accent has to contrast with it, not with the page, so this is
     not a theme token. White reads correctly on every preset accent we ship. */
  color: #fff;
}

.ee-btn-secondary {
  background: transparent;
  color: var(--ee-fg);
  border-color: var(--ee-border-strong);
}

.ee-btn-secondary:hover { background: var(--ee-hover); }

.ee-btn-primary:focus-visible,
.ee-btn-secondary:focus-visible {
  outline: 2px solid var(--ee-focus);
  outline-offset: 1px;
}

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

  /* Scrolling is not discoverable on its own. Mobile browsers hide
     scrollbars, so a toolbar clipped mid-button reads as broken rather than
     as scrollable. A fade on the trailing edge shows there is more to reach.
     The wrapper exists purely to carry this pseudo-element, since a scrolling
     element cannot position one over its own overflow. */
  .ee-toolbar-wrap { position: relative; }
  .ee-toolbar-wrap::after {
    content: '';
    position: absolute;
    inset-block: 0;
    inset-inline-end: 0;
    inline-size: 28px;
    pointer-events: none;
    background: linear-gradient(to right, transparent, var(--ee-toolbar-bg) 75%);
    opacity: 1;
    transition: opacity .15s linear;
  }

  /* At the end of the scroll range there is nothing more to reveal, so the
     fade goes away rather than promising content that is not there. */
  .ee-toolbar-at-end::after { opacity: 0; }

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
