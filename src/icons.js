/**
 * Inline SVG icons.
 *
 * The original shipped 32 Font Awesome `<i>` tags loaded from a CDN. Offline,
 * every single toolbar icon vanished with no text fallback. These are inline,
 * so a single-file drop-in is genuinely self-contained and makes zero network
 * requests.
 *
 * All paths are stroke-based on a 24x24 grid, inherited `currentColor`.
 */

const wrap = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;

export const ICONS = {
  bold: wrap('<path d="M6 4h7a4 4 0 0 1 0 8H6z"/><path d="M6 12h8a4 4 0 0 1 0 8H6z"/>'),
  italic: wrap('<path d="M19 4h-9M14 20H5M15 4L9 20"/>'),
  underline: wrap('<path d="M6 4v6a6 6 0 0 0 12 0V4"/><path d="M4 20h16"/>'),
  strike: wrap('<path d="M4 12h16"/><path d="M17.5 7A4 4 0 0 0 14 4h-2a3.5 3.5 0 0 0-1.6 6.6"/><path d="M7 17a4 4 0 0 0 3.5 3h2a3.5 3.5 0 0 0 1.7-6.6"/>'),
  heading1: wrap('<path d="M4 6v12M12 6v12M4 12h8"/><path d="M17 18v-7l-2 1.5"/>'),
  heading2: wrap('<path d="M4 6v12M12 6v12M4 12h8"/><path d="M16 11a2 2 0 1 1 3 1.7L16 18h4"/>'),
  heading3: wrap('<path d="M4 6v12M12 6v12M4 12h8"/><path d="M16 10h3l-2 3a2 2 0 1 1-1.5 3.3"/>'),
  paragraph: wrap('<path d="M13 4v16M17 4v16M8 4h5a4 4 0 0 1 0 8H8z"/>'),
  bulletList: wrap('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none"/>'),
  orderedList: wrap('<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 5h1v3M3.5 8h2"/><path d="M3.6 11.5a1 1 0 1 1 1.7.7L3.5 14h2M3.5 17h2l-1.2 1.5a1 1 0 1 1-1.3 1.4"/>'),
  blockquote: wrap('<path d="M6 17h3l2-4V7H5v6h3z"/><path d="M16 17h3l2-4V7h-6v6h3z"/>'),
  codeBlock: wrap('<path d="M8 6l-5 6 5 6M16 6l5 6-5 6"/>'),
  link: wrap('<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>'),
  unlink: wrap('<path d="M9 15l-1 1a5 5 0 0 1-7-7l2-2"/><path d="M15 9l1-1a5 5 0 0 1 7 7l-2 2"/><path d="M3 3l18 18"/>'),
  undo: wrap('<path d="M3 8h11a5 5 0 0 1 0 10H8"/><path d="M7 4L3 8l4 4"/>'),
  redo: wrap('<path d="M21 8H10a5 5 0 0 0 0 10h6"/><path d="M17 4l4 4-4 4"/>'),
  horizontalRule: wrap('<path d="M4 12h16"/>')
};
