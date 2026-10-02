/**
 * Sizing, responsiveness and fonts.
 *
 * These three concerns are related: a fixed pixel height that works on a
 * desktop is a trap on a phone, and a font chosen for Latin text breaks Arabic.
 * Everything here degrades to "use whatever the host page already has".
 */

/* ------------------------------------------------------------------ *
 * Sizing
 * ------------------------------------------------------------------ */

/**
 * Resolve the size options into CSS custom properties.
 *
 * Width:
 *   'auto' (default) → fills the container, capped at a readable measure
 *   '100%' / '640px' → any CSS length, or 'auto'
 *
 * Height: any CSS length, or 'auto' to grow with content.
 *
 * The values land as custom properties rather than direct styles so that a
 * media query can still override them on small screens, because an inline
 * height
 * would win over any stylesheet rule and be un-fixable.
 */
export function sizeTokens(opts = {}) {
  const tokens = {};
  const w = opts.width;
  const h = opts.height;

  if (w === undefined || w === null || w === 'auto' || w === 'fill') {
    // Fill the parent, but never stretch a single line of text to 1400px.
    tokens['--ee-width'] = '100%';
    tokens['--ee-max-width'] = '100%';
  } else if (typeof w === 'number') {
    tokens['--ee-width'] = w + 'px';
    tokens['--ee-max-width'] = '100%';
  } else {
    tokens['--ee-width'] = w;
    tokens['--ee-max-width'] = '100%';
  }

  if (h === undefined || h === null) {
    tokens['--ee-min-height'] = '180px';
    tokens['--ee-max-height'] = '60vh';
  } else if (h === 'auto') {
    // Grow with the content instead of scrolling inside a box.
    tokens['--ee-min-height'] = '120px';
    tokens['--ee-max-height'] = 'none';
  } else if (typeof h === 'number') {
    tokens['--ee-min-height'] = h + 'px';
    tokens['--ee-max-height'] = h + 'px';
  } else {
    tokens['--ee-min-height'] = h;
    tokens['--ee-max-height'] = h;
  }

  if (opts.minHeight) tokens['--ee-min-height'] = cssLen(opts.minHeight);
  if (opts.maxHeight) tokens['--ee-max-height'] = cssLen(opts.maxHeight);
  if (opts.rows) tokens['--ee-min-height'] = `calc(${opts.rows} * 1.6em + 24px)`;

  return tokens;
}

function cssLen(v) {
  return typeof v === 'number' ? v + 'px' : v;
}

/* ------------------------------------------------------------------ *
 * Fonts
 *
 * No webfonts are bundled.
 *
 * An editor that ships fonts forces a download, a licence obligation, and a
 * font that is probably wrong for the site it lands in. The right default is
 * the host page's own font, inherited. Options exist for when that's not
 * wanted.
 * ------------------------------------------------------------------ */

/**
 * Named stacks. All system fonts or already-common web fonts, so none of these
 * require a download from us.
 *
 * `system` is the default and resolves to `inherit`, which is the honest
 * answer: use whatever the surrounding page uses.
 */
export const FONT_STACKS = {
  system: 'inherit',

  // Generic families the OS already has, per script.
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, Cambria, "Times New Roman", Times, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',

  // Arabic and Hebrew need script-appropriate faces, or the browser falls back
  // to something that renders diacritics badly.
  arabic: '"Noto Naskh Arabic", "Segoe UI", "Traditional Arabic", "Amiri", serif',
  hebrew: '"Noto Sans Hebrew", "Segoe UI", Arial, sans-serif',

  // A rounded, friendly option that is usually present on modern systems.
  rounded: 'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", Quicksand, Comfortaa, Manrope, sans-serif'
};

/**
 * Resolve a font option to a CSS font-family value.
 *
 * Accepts a preset name, any raw CSS stack, or nothing (= inherit from the
 * page, which is the default).
 */
export function resolveFont(font) {
  if (!font) return FONT_STACKS.system;
  if (typeof font === 'string' && FONT_STACKS[font]) return FONT_STACKS[font];
  return font;
}

/**
 * When the language is RTL, prefer a script-appropriate stack *unless* the
 * caller asked for something specific. Falling back to a Latin-first stack for
 * Arabic produces poor shaping.
 */
export function fontForLang(lang, requested) {
  if (requested) return resolveFont(requested);
  const base = (lang || '').toLowerCase().split('-')[0];
  if (base === 'ar' || base === 'fa' || base === 'ur' || base === 'ps' || base === 'sd') {
    return FONT_STACKS.arabic;
  }
  if (base === 'he' || base === 'yi') return FONT_STACKS.hebrew;
  return FONT_STACKS.system;
}
