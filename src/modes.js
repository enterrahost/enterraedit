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

/**
 * The canonical toolbar map.
 *
 * Every key the editor understands, with a label and a group. This is the
 * single source for three things: which buttons a mode includes, what the
 * documentation lists, and whether an integrator's key list contains a typo.
 *
 * Adding a button means adding an entry here and a matching item in the
 * toolbar definition in editor.js. A test asserts the two stay in step, so a
 * key cannot exist in one and not the other.
 */
export const BUTTONS = {
  bold: { label: 'Bold', group: 'inline', icon: 'bold' },
  italic: { label: 'Italic', group: 'inline', icon: 'italic' },
  underline: { label: 'Underline', group: 'inline', icon: 'underline' },
  strike: { label: 'Strikethrough', group: 'inline', icon: 'strike' },
  link: { label: 'Insert link', group: 'inline', icon: 'link' },
  unlink: { label: 'Remove link', group: 'inline', icon: 'unlink' },

  heading1: { label: 'Heading 1', group: 'block', icon: 'heading1' },
  heading2: { label: 'Heading 2', group: 'block', icon: 'heading2' },
  heading3: { label: 'Heading 3', group: 'block', icon: 'heading3' },
  paragraph: { label: 'Paragraph', group: 'block', icon: 'paragraph' },
  bulletList: { label: 'Bulleted list', group: 'block', icon: 'bulletList' },
  orderedList: { label: 'Numbered list', group: 'block', icon: 'orderedList' },
  blockquote: { label: 'Quote', group: 'block', icon: 'blockquote' },
  codeBlock: { label: 'Code block', group: 'block', icon: 'codeBlock' },
  horizontalRule: { label: 'Horizontal rule', group: 'block', icon: 'horizontalRule' },

  image: { label: 'Insert image', group: 'insert', icon: 'image' },
  table: { label: 'Insert table', group: 'insert', icon: 'table' },

  undo: { label: 'Undo', group: 'history', icon: 'undo' },
  redo: { label: 'Redo', group: 'history', icon: 'redo' }
};

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
    // An unknown single word is a typo for a mode or a key. Render the full
    // toolbar rather than nothing, and let the caller warn about it.
    if (trimmed) return null;
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

/** All known keys, in toolbar order. */
export const ALL_KEYS = Object.keys(BUTTONS);

/** Keys grouped by their `group`, for building a picker or docs table. */
export function keysByGroup() {
  const out = {};
  for (const [key, meta] of Object.entries(BUTTONS)) {
    (out[meta.group] = out[meta.group] || []).push(key);
  }
  return out;
}

/**
 * Split a requested key list into ones we know and ones we do not.
 *
 * A typo previously meant the button silently vanished, which is confusing
 * because the toolbar still renders and simply lacks the control you asked
 * for. Callers can log the difference instead of guessing.
 */
export function validateKeys(keys) {
  if (!Array.isArray(keys)) return { valid: [], unknown: [] };
  return {
    valid: keys.filter((k) => k in BUTTONS),
    unknown: keys.filter((k) => !(k in BUTTONS))
  };
}
