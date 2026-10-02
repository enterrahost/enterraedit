/**
 * Toolbar modes.
 *
 * A comment box and a page editor want different toolbars, and asking an
 * integrator to name every button is a poor trade. Three named modes cover the
 * common cases, and an explicit list is available for anything else.
 *
 *   comment   short replies, ticket updates, contact forms
 *   standard  article or page body: adds structure and code
 *   full      everything the editor can do, including images and tables
 *
 * A mode is only a default for which buttons appear. It never changes what the
 * document model will accept, so content pasted into a `comment` field is
 * parsed by the same schema as a `full` one. Restricting the toolbar hides the
 * controls, it does not sandbox the input.
 */

/** Every toolbar key, grouped by the mode that first includes it. */
const GROUPS = {
  // Inline formatting and links: useful almost everywhere.
  base: ['bold', 'italic', 'underline', 'strike', 'link', 'unlink', 'undo', 'redo'],

  // Block structure for anything longer than a sentence or two.
  structure: [
    'heading1',
    'heading2',
    'heading3',
    'paragraph',
    'bulletList',
    'orderedList',
    'blockquote',
    'codeBlock',
    'horizontalRule'
  ],

  // Things that change the shape of a page rather than a paragraph.
  rich: ['image', 'table']
};

export const MODES = {
  comment: [...GROUPS.base],

  standard: [...GROUPS.base, ...GROUPS.structure],

  full: [...GROUPS.base, ...GROUPS.structure, ...GROUPS.rich]
};

export const MODE_NAMES = Object.keys(MODES);

/**
 * Resolve the toolbar selection for an instance.
 *
 * Accepts a mode name, an array of keys, a comma-separated string, or nothing
 * (which means full, preserving the previous behaviour).
 *
 * Returns null to mean "every button", which is the pre-existing default.
 */
export function resolveToolbar(mode, explicit) {
  const wanted = explicit !== undefined && explicit !== null ? explicit : mode;

  if (wanted === undefined || wanted === null || wanted === '' || wanted === true) {
    return null;
  }
  if (wanted === false) return [];

  if (typeof wanted === 'string') {
    const trimmed = wanted.trim();
    if (MODES[trimmed]) return MODES[trimmed];
    // A comma-separated list, so data-toolbar="bold,italic,link" works.
    if (trimmed.includes(',')) {
      return trimmed
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
    }
    // An unknown single word is most likely a typo for a mode. Fall back to
    // full rather than silently rendering an empty toolbar.
    return null;
  }

  if (Array.isArray(wanted)) return wanted.filter((k) => typeof k === 'string');
  return null;
}

/** Human-readable summary of what a mode includes, for docs and errors. */
export function describeMode(name) {
  const keys = MODES[name];
  return keys ? `${name}: ${keys.join(', ')}` : `unknown mode "${name}"`;
}
