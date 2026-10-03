/**
 * EnterraEdit: drop-in layer over ProseMirror.
 *
 * The whole product thesis lives in this file:
 *
 *   <script src="enterraedit.min.js" data-enterraedit data-lang="de"></script>
 *   <textarea name="body" data-enterraedit></textarea>
 *
 * No build step for the integrator, no framework, no npm, no GPL.
 *
 * Everything below the drop-in layer (selection, input rules, undo, bidi,
 * paste, IME, focus handling) is ProseMirror's, which is why this file can
 * stay small and still be correct.
 */

import { EditorState, Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { DOMParser as PMDOMParser, DOMSerializer } from 'prosemirror-model';
import {
  toggleMark,
  setBlockType,
  chainCommands,
  exitCode,
  splitBlock
} from 'prosemirror-commands';
import {
  wrapInList,
  liftListItem,
  sinkListItem,
  splitListItem
} from 'prosemirror-schema-list';
import { keymap } from 'prosemirror-keymap';
import { history, undo, redo } from 'prosemirror-history';
import { schema } from './schema.js';
import { STRINGS, resolveLang, isRtl, t } from './i18n.js';
import { ICONS } from './icons.js';
import { STYLES } from './styles.js';
import { VERSION } from './version.js';
import { sizeTokens, fontForLang, FONT_STACKS } from './sizing.js';
import { sanitizeUrl, sanitizeImageSrc } from './url.js';
import { filesFrom, fileToDataUri, isAllowedImage, formatSize } from './images.js';
import { openDialog } from './dialog.js';
import { resolveToolbar, validateKeys, ALL_KEYS } from './modes.js';
import {
  tableEditing,
  columnResizing,
  tableNodes,
  goToNextCell,
  addRowAfter,
  addColumnAfter,
  deleteRow,
  deleteColumn,
  deleteTable,
  isInTable
} from 'prosemirror-tables';
import { buildTokens, resolveTheme, THEMES } from './themes.js';
import {
  buildBadge,
  injectAttribution,
  removeAttribution,
  resolveBranding,
  badgeDefault,
  rootAttributionAttrs
} from './branding.js';

const instances = [];

/* ------------------------------------------------------------------ *
 * Toolbar definition
 *
 * Each entry is data, not code. The tooltip and the aria-label both come
 * from the same i18n key, so translation happens once.
 * ------------------------------------------------------------------ */

/**
 * Toggle a mark, applying it to the word under the cursor when nothing is
 * selected.
 *
 * Plain toggleMark only sets storedMarks for a collapsed selection, which
 * affects the next character typed and leaves the existing word alone. That is
 * correct ProseMirror behaviour and useless as a button: a cursor inside bold
 * text, clicking Bold, appears to do nothing at all. The command returns true,
 * the document does not change, and the mark is still there, so it reads as a
 * broken control rather than as a subtlety.
 *
 * Every editor a person has used resolves this the same way, by treating a
 * cursor inside a word as a selection of that word. This does that, and falls
 * back to toggleMark when there is no word to expand to, such as an empty
 * paragraph or a cursor between two marks.
 */
function toggleMarkAtWord(markType) {
  return (state, dispatch, view) => {
    const { empty, $from, from } = state.selection;
    if (!empty || !markType) return toggleMark(markType)(state, dispatch, view);

    const offset = $from.parentOffset;
    const text = $from.parent.textContent;
    const isWord = (ch) => !!ch && /[\p{L}\p{N}_'-]/u.test(ch);

    // The run of word characters around the caret. When the caret sits between
    // two characters, prefer the one it follows: after typing a word that is
    // where it lands, and clicking Bold there should affect that word rather
    // than the space or the word after it.
    let start = offset;
    let end = offset;
    if (isWord(text[offset - 1])) {
      while (start > 0 && isWord(text[start - 1])) start--;
      while (end < text.length && isWord(text[end])) end++;
    } else if (isWord(text[offset])) {
      while (end < text.length && isWord(text[end])) end++;
    }

    // Nothing to widen to: an empty paragraph, or a caret between two
    // non-word characters such as a space. Fall back rather than guessing.
    if (start === end) return toggleMark(markType)(state, dispatch, view);

    const base = from - offset;
    const widened = state.apply(
      state.tr.setSelection(
        state.selection.constructor.create(state.doc, base + start, base + end)
      )
    );
    if (dispatch) {
      toggleMark(markType)(widened, view.dispatch, view);
      // Put the caret back where the person left it. Widening the selection
      // moved it, and leaving it moved is how the button ended up still lit:
      // the caret landed back inside the very text it had just unbolded, so
      // the next click read as "already bold" and appeared to do nothing.
      const settled = view.state.selection;
      const back = Math.min(base + offset, view.state.doc.content.size);
      view.dispatch(
        view.state.tr.setSelection(
          settled.constructor.create(view.state.doc, back, back)
        )
      );
    }
    return true;
  };
}

function toolbarFor(lang) {
  const { schema: s } = { schema };
  return [
    {
      key: 'bold',
      icon: ICONS.bold,
      run: toggleMarkAtWord(s.marks.strong),
      isActive: (state) => !!s.marks.strong.isInSet(state.styles ? [] : state.selection.$from.marks())
    },
    {
      key: 'italic',
      icon: ICONS.italic,
      run: toggleMarkAtWord(s.marks.em),
      isActive: (state) => !!s.marks.em.isInSet(state.selection.$from.marks())
    },
    {
      key: 'underline',
      icon: ICONS.underline,
      run: toggleMarkAtWord(s.marks.underline),
      isActive: (state) => !!s.marks.underline.isInSet(state.selection.$from.marks())
    },
    {
      key: 'strike',
      icon: ICONS.strike,
      run: toggleMarkAtWord(s.marks.strikethrough),
      isActive: (state) => !!s.marks.strikethrough.isInSet(state.selection.$from.marks())
    },
    { type: 'sep' },
    {
      key: 'heading1',
      icon: ICONS.heading1,
      run: setBlockType(s.nodes.heading, { level: 1 }),
      isActive: (state) => isHeading(state, 1)
    },
    {
      key: 'heading2',
      icon: ICONS.heading2,
      run: setBlockType(s.nodes.heading, { level: 2 }),
      isActive: (state) => isHeading(state, 2)
    },
    {
      key: 'heading3',
      icon: ICONS.heading3,
      run: setBlockType(s.nodes.heading, { level: 3 }),
      isActive: (state) => isHeading(state, 3)
    },
    {
      key: 'paragraph',
      icon: ICONS.paragraph,
      run: setBlockType(s.nodes.paragraph),
      isActive: (state) => state.selection.$from.parent.type === s.nodes.paragraph
    },
    { type: 'sep' },
    {
      key: 'bulletList',
      icon: ICONS.bulletList,
      run: wrapInList(s.nodes.bullet_list),
      isActive: (state) => inList(state, 'bullet_list')
    },
    {
      key: 'orderedList',
      icon: ICONS.orderedList,
      run: wrapInList(s.nodes.ordered_list),
      isActive: (state) => inList(state, 'ordered_list')
    },
    {
      key: 'blockquote',
      icon: ICONS.blockquote,
      run: setBlockType(s.nodes.blockquote),
      isActive: (state) => state.selection.$from.parent.type === s.nodes.blockquote
    },
    {
      key: 'codeBlock',
      icon: ICONS.codeBlock,
      run: setBlockType(s.nodes.code_block),
      isActive: (state) => state.selection.$from.parent.type === s.nodes.code_block
    },
    { type: 'sep' },
    { key: 'link', icon: ICONS.link, action: 'link' },
    {
      key: 'unlink',
      icon: ICONS.unlink,
      run: (state, dispatch) => {
        if (!s.marks.link.isInSet(state.selection.$from.marks())) return false;
        if (dispatch) dispatch(state.tr.removeStoredMark(s.marks.link).addStoredMark(null));
        return true;
      }
    },
    { key: 'horizontalRule', icon: ICONS.horizontalRule, run: insertRule },
    { type: 'sep' },
    { key: 'image', icon: ICONS.image, action: 'image' },
    { key: 'table', icon: ICONS.table, action: 'table' },
    { type: 'sep' },
    { key: 'undo', icon: ICONS.undo, run: undo },
    { key: 'redo', icon: ICONS.redo, run: redo }
  ];
}

/**
 * Some host scripts assign `textarea.value` directly. That does not fire an
 * `input` event, so the editor would never notice. Patching the prototype
 * setter once per document fixes this for every instance at a stroke.
 */
let valuePatched = false;
function patchValueSetter() {
  if (valuePatched || typeof window === 'undefined') return;
  valuePatched = true;

  for (const [Proto, prop] of [
    [window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype, 'value'],
    [window.HTMLInputElement && window.HTMLInputElement.prototype, 'value']
  ]) {
    if (!Proto) continue;
    const desc = Object.getOwnPropertyDescriptor(Proto, prop);
    if (!desc || !desc.set) continue;
    Object.defineProperty(Proto, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set(value) {
        const before = desc.get.call(this);
        desc.set.call(this, value);
        if (before !== value) {
          // Defer so the value is fully committed before listeners read it.
          setTimeout(() => {
            this.dispatchEvent(new Event('input', { bubbles: true }));
          }, 0);
        }
      }
    });
  }
}

function numAttr(el, name) {
  const v = el.getAttribute && el.getAttribute(name);
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

function isHeading(state, level) {
  const p = state.selection.$from.parent;
  return p.type === schema.nodes.heading && p.attrs.level === level;
}

function inList(state, name) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === schema.nodes[name]) return true;
  }
  return false;
}

function insertRule(state, dispatch) {
  if (dispatch) {
    const { from, to } = state.selection;
    dispatch(state.tr.replaceWith(from, to, schema.nodes.horizontal_rule.create()));
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * The editor
 * ------------------------------------------------------------------ */

// Re-exported so existing consumers importing it from the entry point still work.
export { sanitizeUrl, sanitizeImageSrc };

/**
 * Shift+Enter: a line break inside the current block, not a new block.
 *
 * The installed prosemirror-commands does not export insertLineBreak, so this
 * is the documented pattern written out. It only applies where a hard_break is
 * allowed and the selection is a plain cursor; anywhere else it returns false
 * and the next command in the chain gets its turn.
 */
function insertLineBreak(state, dispatch) {
  const { hard_break } = state.schema.nodes;
  if (!hard_break) return false;
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type === state.schema.nodes.code_block) return false;
  // Only where the node will actually be accepted. Asking the schema rather
  // than listing the node types means a custom schema works unchanged.
  if (!$from.parent.canReplaceWith($from.index(), $from.index(), hard_break)) {
    return false;
  }
  if (dispatch) dispatch(state.tr.replaceSelectionWith(hard_break.create()).scrollIntoView());
  return true;
}

export class EnterraEdit {
  constructor(options = {}) {
    const el =
      typeof options.element === 'string'
        ? document.getElementById(options.element)
        : options.element ||
          (options.elementId ? document.getElementById(options.elementId) : null);

    if (!el) {
      console.error('[EnterraEdit] Target element not found.');
      return;
    }

    const lang = resolveLang(options.lang, el);

    this.options = {
      element: el,
      lang: lang.base,
      requestedLang: lang.requested,
      // Precedence: explicit option, then the element's own dir, then the
      // language's natural direction.
      dir: options.dir || el.getAttribute('dir') || (isRtl(lang.requested) ? 'rtl' : 'ltr'),
      // `toolbar` stays a boolean switch for backwards compatibility, while
      // `mode` or an explicit list selects which buttons appear.
      toolbar: options.toolbar !== false,
      mode: options.mode || el.getAttribute('data-mode') || null,
      toolbarKeys: resolveToolbar(
        options.mode || el.getAttribute('data-mode') || null,
        options.toolbarKeys !== undefined
          ? options.toolbarKeys
          : el.getAttribute('data-toolbar-keys')
      ),
      spellcheck: options.spellcheck !== false,
      // Theme precedence: explicit option, then the element's own data-theme,
      // then 'auto' (follow the OS).
      theme:
        options.theme !== undefined
          ? options.theme
          : el.getAttribute('data-theme') || 'auto',
      accent: options.accent || el.getAttribute('data-accent') || null,
      // Badge: explicit option wins, then the element attribute, then the
      // provider's own default. With no provider installed there is no badge
      // to show, whatever these say.
      badge:
        options.badge !== undefined
          ? options.badge === true
          : el.getAttribute('data-badge') !== null
            ? el.getAttribute('data-badge') === 'true'
            : badgeDefault(),
      // Sizing: read from options first, then the element's data-* attributes,
      // so the drop-in path can set everything in markup.
      width: options.width || el.getAttribute('data-width') || 'auto',
      height: options.height || el.getAttribute('data-height') || null,
      rows: options.rows || numAttr(el, 'data-rows'),
      minHeight: options.minHeight || el.getAttribute('data-min-height') || null,
      maxHeight: options.maxHeight || el.getAttribute('data-max-height') || null,
      font: options.font || el.getAttribute('data-font') || null,
      fontSize: options.fontSize || el.getAttribute('data-font-size') || null,
      branding: resolveBranding(options.branding, el),
      // A textarea's placeholder is visible until the editor replaces it, and
      // was then lost. Reading it here means the attribute an integrator
      // already wrote keeps working.
      placeholder:
        options.placeholder !== undefined
          ? options.placeholder
          : el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || null,
      strings: Object.assign({}, STRINGS[lang.base], options.strings || {}),
      onChange: options.onChange || null,
      name: el.getAttribute('data-name') || el.getAttribute('name') || null
    };

    // A misspelled key used to vanish without a word: the toolbar rendered, it
    // just lacked the button you asked for. Say so instead.
    if (this.options.toolbarKeys) {
      const { unknown } = validateKeys(this.options.toolbarKeys);
      if (unknown.length) {
        console.warn(
          `[EnterraEdit] Unknown toolbar key(s): ${unknown.join(', ')}. ` +
            `Known keys: ${ALL_KEYS.join(', ')}`
        );
      }
    }

    this.strings = this.options.strings;
    this.el = el;
    this._injectStyles();
    // Attribution is injected once per document, and only if this instance
    // wants it. If any instance opts out we leave the page's own head alone.
    if (this.options.branding) injectAttribution(VERSION);
    this._build();
    this._applyTheme();
    this._applyLayout();
    this._watchColorScheme();
    this._syncFromSource();
    this._bind();
    instances.push(this);
  }

  /* -------- theming -------- */

  /**
   * Write the resolved theme onto the root element as inline custom
   * properties. Inline wins over the stylesheet's fallbacks, and because these
   * are plain CSS variables a host page can still override any single token
   * with its own rule.
   */
  _applyTheme() {
    const built = buildTokens(this.options.theme, this.options.accent, null, this.el);
    this.themeName = built.name;
    // Kept so overlays rendered outside .ee-root can carry the same theme.
    this.themeTokens = built.tokens;
    this.root.setAttribute('data-ee-theme', built.name);
    for (const [prop, value] of Object.entries(built.tokens)) {
      this.root.style.setProperty(prop, value);
    }
    // Let the host style around the theme if it wants to.
    const effective = this.getEffectiveTheme();
    this.root.classList.toggle('ee-theme-dark', effective === 'dark');

    // Tell the browser which way round the editor is, so the interface it draws
    // itself matches. Button tooltips are the visible case: a native title
    // tooltip is painted from the OS colour scheme, not from CSS, so on a dark
    // editor under a light OS it came out white on white and the label was
    // unreadable. This also corrects scrollbars and the caret.
    this.root.style.setProperty(
      'color-scheme',
      effective === 'dark' || effective === 'light' ? effective : 'light dark'
    );
  }

  /**
   * Apply sizing and font choices as custom properties.
   *
   * Set on the root as variables rather than inline width/height so the
   * responsive media queries can still re-declare them on small screens; an
   * inline `height` would beat every stylesheet rule and be un-overridable.
   */
  _applyLayout() {
    const tokens = sizeTokens({
      width: this.options.width,
      height: this.options.height,
      rows: this.options.rows,
      minHeight: this.options.minHeight,
      maxHeight: this.options.maxHeight
    });

    const font = fontForLang(this.options.requestedLang, this.options.font);
    tokens['--ee-font'] = font;
    if (this.options.fontSize) {
      tokens['--ee-font-size'] =
        typeof this.options.fontSize === 'number'
          ? this.options.fontSize + 'px'
          : this.options.fontSize;
    }

    for (const [prop, value] of Object.entries(tokens)) {
      this.root.style.setProperty(prop, value);
    }
  }

  /** Change size at runtime: editor.setSize({ width: '640px' }). */
  setSize(opts = {}) {
    for (const k of ['width', 'height', 'rows', 'minHeight', 'maxHeight']) {
      if (k in opts) this.options[k] = opts[k];
    }
    this._applyLayout();
  }

  /** Change font at runtime: editor.setFont('serif', '1.05rem'). */
  setFont(font, size) {
    if (font !== undefined) this.options.font = font;
    if (size !== undefined) this.options.fontSize = size;
    this._applyLayout();
  }

  /**
   * When the theme is `auto`, follow the OS live rather than only reading it
   * once at construction.
   */
  _watchColorScheme() {
    if (this.options.theme !== 'auto' && this.options.theme !== undefined) return;

    // Watch the ancestor that declares a theme, so a toggle in the host
    // application moves the editor with it. Without this the editor keeps
    // whatever it resolved at construction, and a user flipping the page to
    // light is left with a dark editor sitting in the middle of it.
    if (typeof MutationObserver === 'function' && this.el && this.el.parentElement) {
      this._themeObserver = new MutationObserver(() => this._applyTheme());
      let node = this.el.parentElement;
      while (node) {
        this._themeObserver.observe(node, {
          attributes: true,
          attributeFilter: ['data-theme', 'class']
        });
        node = node.parentElement;
      }
    }

    if (typeof window === 'undefined' || !window.matchMedia) return;
    this._mq = window.matchMedia('(prefers-color-scheme: dark)');
    this._mqHandler = () => this._applyTheme();
    // addEventListener is the modern API; older Safari only has addListener.
    if (this._mq.addEventListener) this._mq.addEventListener('change', this._mqHandler);
    else if (this._mq.addListener) this._mq.addListener(this._mqHandler);
  }

  /** Which preset is actually in effect right now. */
  getEffectiveTheme() {
    return resolveTheme(this.options.theme, this.el);
  }

  /**
   * Switch theme at runtime.
   *
   *   editor.setTheme('dark')
   *   editor.setTheme('light', '#345332')
   *   editor.setTheme({ '--ee-bg': '#fff' })   // full custom
   */
  setTheme(theme, accent) {
    this.options.theme = theme;
    if (accent !== undefined) this.options.accent = accent;
    this._applyTheme();
  }

  /* -------- lifecycle -------- */

  _injectStyles() {
    if (document.getElementById('enterraedit-styles')) return;
    const style = document.createElement('style');
    style.id = 'enterraedit-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  _build() {
    const dir = this.options.dir;
    const strings = this.options.strings;
    const el = this.el;

    this.root = document.createElement('div');
    this.root.className = 'ee-root';
    this.root.setAttribute('dir', dir);
    this.root.setAttribute('lang', this.options.requestedLang);
    // Whatever the installed provider wants on the root, or nothing at all
    // when no provider is set.
    const rootAttrs = this.options.branding ? rootAttributionAttrs() : null;
    if (rootAttrs) {
      for (const [k, v] of Object.entries(rootAttrs)) this.root.setAttribute(k, v);
    }

    if (this.options.toolbar) {
      // The toolbar itself scrolls on narrow screens. The wrapper exists so a
      // fade can sit over the trailing edge, which is the only cue that there
      // is more to reach once the browser hides the scrollbar.
      this.toolbarWrap = document.createElement('div');
      this.toolbarWrap.className = 'ee-toolbar-wrap';
      this.toolbarWrap.appendChild(this._buildToolbar());
      this.root.appendChild(this.toolbarWrap);
    }

    this.editorHost = document.createElement('div');
    this.editorHost.className = 'ee-surface';
    this.root.appendChild(this.editorHost);

    // The placeholder lives on the surface rather than the contenteditable, so
    // it shows through only while the document is empty and never becomes part
    // of the content. CSS does the showing and hiding from data attributes,
    // which keeps it out of ProseMirror's model entirely: nothing to strip on
    // paste, nothing to serialise, nothing a screen reader reads twice.
    // Set as an attribute whether or not one was given, because the CSS keys
    // off its presence and an empty value keeps the two paths identical.
    this.editorHost.setAttribute('data-placeholder', this.options.placeholder || '');

    this.status = document.createElement('div');
    this.status.className = 'ee-status';
    // The count is a number inside a localised sentence. In RTL the surrounding
    // direction otherwise reorders the two ("حرفًا 56" instead of "56 حرفًا"),
    // so isolate the text and let the string's own direction govern it.
    this.status.setAttribute('dir', 'auto');
    this.status.style.unicodeBidi = 'isolate';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'off');

    // The status bar holds the count plus, optionally, the badge. Splitting
    // them into two elements keeps the count's bidi isolation intact and stops
    // the badge inheriting `dir=auto` weirdness.
    this.count = document.createElement('span');
    this.count.className = 'ee-count';
    this.status.appendChild(this.count);

    // The badge only exists if the installed provider supplies one, so this is
    // a no-op otherwise and identical markup behaves the same either way.
    if (this.options.badge && this.options.branding) {
      const badge = buildBadge(this.strings, VERSION);
      if (badge) {
        this.status.appendChild(badge);
        this.badgeEl = badge;
      }
    }

    this.root.appendChild(this.status);

    // Hide the source field now that the editor owns the space. display:none
    // rather than visibility, because the editor is fully built at this point
    // and the field no longer needs a box. A host page that pre-hid the field
    // with `visibility: hidden` is undone here, or it would stay invisible if
    // it were ever unhidden by something else.
    // Marks the field as upgraded, so a host page rule like
    // `[data-enterraedit]:not(.ee-ready) { visibility: hidden }` stops applying.
    // The inline style below is what actually hides it from here on.
    el.classList.add('ee-ready');
    el.style.visibility = '';
    el.removeAttribute('aria-hidden');
    el.style.display = 'none';
    el.parentNode.insertBefore(this.root, el.nextSibling);

    this.view = new EditorView(this.editorHost, {
      state: EditorState.create({
        schema,
        plugins: this._plugins()
      }),
      // ProseMirror renders a contenteditable div; these attributes are what
      // make it usable by assistive tech and give the browser enough
      // information to run its native spellchecker.
      attributes: {
        'aria-label': t(strings, 'editingArea'),
        role: 'textbox',
        'aria-multiline': 'true',
        dir: dir,
        lang: this.options.requestedLang,
        spellcheck: this.options.spellcheck ? 'true' : 'false',
        autocorrect: 'on',
        autocapitalize: 'sentences'
      },
      dispatchTransaction: (tr) => {
        const next = this.view.state.apply(tr);
        this.view.updateState(next);
        if (tr.docChanged) {
          this._syncToSource();
          this._refresh();
          if (this.options.onChange) this.options.onChange(this.getHTML());
        }
      }
    });

    this.view.dom.classList.add('ee-editor');
    this._refresh();
    // Now that everything is in the document, measure the toolbar for real.
    if (this._fadeSync) this._fadeSync();
  }

  _plugins() {
    const s = schema;
    const mod = (e) => (e.metaKey || e.ctrlKey);
    return [
      // Clipboard and drop handling for image files, which arrive as File
      // objects rather than HTML and would otherwise be discarded silently.
      this._imagePlugin(),
      history(),
      // Column resizing and cell selection. The plugin is what makes tables
      // behave like tables rather than a grid of paragraphs.
      columnResizing({ handleWidth: 5, cellMinWidth: 60 }),
      tableEditing(),
      keymap({
        'Mod-b': toggleMark(s.marks.strong),
        'Mod-i': toggleMark(s.marks.em),
        'Mod-u': toggleMark(s.marks.underline),
        'Mod-z': undo,
        'Mod-y': redo,
        'Shift-Mod-z': redo,
        'Mod-k': () => {
          this._promptLink();
          return true;
        },
        'Mod-Enter': exitCode
      }),
      /* Enter, in the order the cases have to be tried.
       *
       * ProseMirror runs keymaps in order and the first handler returning true
       * wins, so these cannot be merged carelessly. The list case has to come
       * before the paragraph case, or Enter inside a list item is handled as an
       * ordinary split and produces a second paragraph inside the same item
       * instead of a new item.
       *
       * Within the chain: exitCode only acts in a code block and returns false
       * elsewhere, splitListItem only in a list, and splitBlock and the newline
       * case cover the rest. exitCode first so Enter leaves a code block rather
       * than inserting a blank line inside it.
       */
      keymap({
        Enter: chainCommands(
          exitCode,
          splitListItem(s.nodes.list_item),
          splitBlock,
          insertLineBreak
        ),
        'Shift-Enter': insertLineBreak,
        // Inside a table, Tab belongs to the table. Elsewhere it indents a
        // list item, which is the existing behaviour.
        Tab: (state, dispatch) => {
          if (isInTable(state)) return goToNextCell(1)(state, dispatch);
          return sinkListItem(s.nodes.list_item)(state, dispatch);
        },
        'Shift-Tab': (state, dispatch) => {
          if (isInTable(state)) return goToNextCell(-1)(state, dispatch);
          return liftListItem(s.nodes.list_item)(state, dispatch);
        }
      })
    ];
  }

  /**
   * Intercept image files on paste and drop.
   *
   * Returns true so ProseMirror stops processing the event: an image file in
   * the clipboard has no usable HTML alongside it, and letting the default
   * handler run would insert nothing.
   */
  _imagePlugin() {
    const insert = (files, view) => {
      const usable = files.filter(isAllowedImage);
      if (!usable.length) return false;

      // Several files at once paste in order. Each is awaited so a slow read
      // cannot reorder them relative to one another.
      (async () => {
        for (const file of usable) {
          try {
            const uri = await fileToDataUri(file);
            const safe = sanitizeImageSrc(uri);
            if (!safe) continue;
            const node = schema.nodes.image.create({
              src: safe,
              alt: file.name || null
            });
            view.dispatch(view.state.tr.replaceSelectionWith(node));
            this._notifyImage(file);
          } catch (e) {
            console.warn('[EnterraEdit] Could not read pasted image:', e && e.message);
          }
        }
      })();

      return true;
    };

    return new Plugin({
      props: {
        handlePaste: (view, event) => {
          const files = filesFrom(event.clipboardData);
          if (!files.length) return false;
          return insert(files, view);
        },
        handleDrop: (view, event) => {
          const files = filesFrom(event.dataTransfer);
          if (!files.length) return false;
          // Put the caret where the file was dropped, so the image lands at the
          // pointer rather than wherever the selection happened to be.
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (at) {
            view.dispatch(view.state.tr.setSelection(
              view.state.selection.constructor.near(view.state.doc.resolve(at.pos))
            ));
          }
          event.preventDefault();
          return insert(files, view);
        }
      }
    });
  }

  /**
   * Tell the user when an embedded image is large enough to matter.
   *
   * Silence would be wrong here: the size lands in the form value, so the
   * person pasting a 4 MB photograph needs to know before they submit.
   */
  _notifyImage(file) {
    const warning = this._dataUriWarning('data:image/png;base64,' + 'x'.repeat(
      Math.ceil((file.size * 4) / 3)
    ));
    if (!warning) return;
    console.warn(`[EnterraEdit] Large pasted image (${formatSize(file.size)}): ${warning}`);
    if (this.status && this.count) {
      this.count.textContent = `${formatSize(file.size)} image embedded`;
    }
  }

  _buildToolbar() {
    const bar = document.createElement('div');
    bar.className = 'ee-toolbar';
    // role=toolbar makes AT announce "Formatting toolbar" and enables the
    // arrow-key navigation pattern. Without it this is an anonymous div full
    // of unlabelled buttons.
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', t(this.strings, 'toolbar'));
    bar.setAttribute('aria-orientation', 'horizontal');

    this.buttons = [];

    // Filter by key, then re-derive separators so a mode never renders a
    // divider with nothing before or after it.
    const allowed = this.options.toolbarKeys;
    const items = toolbarFor(this.options.lang).filter(
      (item) => item.type === 'sep' || !allowed || allowed.includes(item.key)
    );

    // A filtered-out group can leave its separators adjacent, which renders as
    // a cluster of dividers. Collapse runs of separators down to one, and drop
    // any that end up leading or trailing.
    const trimmed = [];
    items.forEach((item, i) => {
      if (item.type !== 'sep') {
        trimmed.push(item);
        return;
      }
      const prev = trimmed[trimmed.length - 1];
      const next = items.slice(i + 1).find((x) => x.type !== 'sep');
      const alreadySeparated = prev && prev.type === 'sep';
      if (prev && next && !alreadySeparated) trimmed.push(item);
    });

    trimmed.forEach((item) => {
      if (item.type === 'sep') {
        const sep = document.createElement('span');
        sep.className = 'ee-sep';
        sep.setAttribute('aria-hidden', 'true');
        bar.appendChild(sep);
        return;
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ee-btn';
      btn.dataset.key = item.key;
      // One i18n lookup drives both the visible tooltip and the accessible
      // name. This is the "translate once" payoff.
      const label = t(this.strings, item.key);
      btn.title = label;
      btn.setAttribute('aria-label', label);
      btn.innerHTML = item.icon;

      const isToggle = !!item.isActive;
      if (isToggle) {
        // Toggle buttons must expose state, otherwise a screen reader user
        // cannot tell whether bold is currently on.
        btn.setAttribute('aria-pressed', 'false');
        btn.setAttribute('tabindex', '-1');
      } else {
        btn.setAttribute('tabindex', '-1');
      }

      btn.addEventListener('mousedown', (e) => {
        // Keep focus in the editor so the selection survives the click.
        e.preventDefault();
        if (item.action === 'link') {
          this._promptLink();
          return;
        }
        if (item.action === 'image') {
          this._promptImage();
          return;
        }
        if (item.action === 'table') {
          this._promptTable();
          return;
        }
        this._run(item);
        this.view.focus();
      });

      this.buttons.push({ el: btn, item });
      bar.appendChild(btn);
    });

    this._wireToolbarKeys(bar);
    this._wireToolbarFade(bar);
    return bar;
  }

  /**
   * Hide the trailing fade once the toolbar is scrolled to its end.
   *
   * The fade promises content beyond the edge. Leaving it visible at the end
   * would be a lie, so it is driven by scroll position rather than being
   * always on. RTL reverses the sign of scrollLeft in some browsers, hence
   * comparing absolute distances rather than raw values.
   */
  _wireToolbarFade(bar) {
    const update = () => {
      const max = bar.scrollWidth - bar.clientWidth;
      const atEnd = Math.abs(bar.scrollLeft) >= max - 2;
      if (this.toolbarWrap) {
        this.toolbarWrap.classList.toggle('ee-toolbar-at-end', atEnd);
      }
    };
    bar.addEventListener('scroll', update, { passive: true });
    // Also on resize, since the overflow can appear or vanish with width.
    if (typeof window !== 'undefined') {
      this._fadeResize = update;
      window.addEventListener('resize', update, { passive: true });
    }
    // Deferred: this runs while the toolbar is still detached, so clientWidth
    // is 0 and every measurement would be wrong. By the next frame the element
    // is in the document and has real dimensions.
    this._fadeSync = update;
    requestAnimationFrame(update);
  }

  /**
   * WAI-ARIA toolbar keyboard pattern: the toolbar is a single tab stop and
   * arrow keys move between buttons. Without this, tabbing into the editor
   * means 17 tab presses to get past the toolbar.
   */
  _wireToolbarKeys(bar) {
    bar.addEventListener('keydown', (e) => {
      const buttons = this.buttons.map((b) => b.el);
      const i = buttons.indexOf(document.activeElement);
      if (i === -1) return;
      let next = null;
      if (e.key === 'ArrowRight') next = buttons[(i + 1) % buttons.length];
      else if (e.key === 'ArrowLeft') next = buttons[(i - 1 + buttons.length) % buttons.length];
      else if (e.key === 'Home') next = buttons[0];
      else if (e.key === 'End') next = buttons[buttons.length - 1];
      if (next) {
        e.preventDefault();
        next.focus();
      }
    });
    // Roving tabindex: first button is reachable by tab.
    if (this.buttons[0]) this.buttons[0].el.setAttribute('tabindex', '0');
    bar.addEventListener('focusin', (e) => {
      this.buttons.forEach((b) => b.el.setAttribute('tabindex', b.el === e.target ? '0' : '-1'));
    });
  }

  /* -------- commands -------- */

  _run(item) {
    const state = this.view.state;
    const dispatch = this.view.dispatch;
    if (typeof item.run === 'function') {
      item.run(state, dispatch, this.view);
    }
    this._refresh();
  }

  /**
   * Insert or edit a link.
   *
   * The dialog is only UI. Validation still happens twice: here for immediate
   * feedback, and again in the schema's link mark, which is the guard that
   * actually matters because setHTML and paste bypass this path entirely.
   */
  async _promptLink() {
    const { from, to } = this.view.state.selection;

    // Look for the mark on the nodes actually covered by the selection, rather
    // than on the position itself. `$from.marks()` reports nothing at a mark
    // boundary, so probing the resolved position alone misses a link that
    // starts exactly at the selection start, which is the common case when the
    // whole paragraph is selected.
    let existing = null;
    this.view.state.doc.nodesBetween(from, to, (node) => {
      if (existing || !node.isText) return;
      const mark = schema.marks.link.isInSet(node.marks);
      if (mark) existing = mark;
    });
    // Fall back to the cursor position, for a collapsed selection inside a link.
    if (!existing) {
      existing = schema.marks.link.isInSet(this.view.state.doc.resolve(from).marks());
    }
    const currentHref = (existing && existing.attrs.href) || '';

    const { action, values } = await openDialog({
      strings: this.strings,
      title: t(this.strings, 'link'),
      fields: [
        {
          name: 'href',
          label: t(this.strings, 'linkPrompt'),
          value: currentHref,
          // Deliberately type="text", not type="url". Native URL validation
          // rejects a bare domain like "example.com", which blocks form
          // submission entirely, so the submit event never fires and our own
          // sanitiser never runs. The dialog would appear frozen. sanitizeUrl
          // accepts bare domains and prefixes https, so it does the job better
          // than the browser's stricter rule.
          type: 'text',
          placeholder: 'https://'
        }
      ],
      submit: t(this.strings, 'linkApply'),
      // Only offer removal when there is something to remove.
      extra: existing ? t(this.strings, 'linkRemove') : null,
      dir: this.options.dir,
      tokens: this.themeTokens,
      onSubmit: ({ href }) => {
        const trimmed = (href || '').trim();
        // An empty box on an existing link means remove it, which is what
        // clearing the field implies.
        if (!trimmed) return existing ? null : t(this.strings, 'linkInvalid');
        return sanitizeUrl(trimmed) ? null : t(this.strings, 'linkInvalid');
      }
    });

    if (action === 'extra') {
      this._removeLink();
      this.view.focus();
      return;
    }

    if (action !== 'submit') {
      this.view.focus();
      return;
    }

    const raw = ((values && values.href) || '').trim();

    // Clearing the field on an existing link removes it rather than doing
    // nothing, which is what the empty submit was allowed through for.
    if (!raw) {
      this._removeLink();
      this.view.focus();
      return;
    }

    const href = sanitizeUrl(raw);
    if (!href) {
      this.view.focus();
      return;
    }

    const mark = schema.marks.link.create({ href });
    const tr = this.view.state.tr;
    if (from === to) tr.addStoredMark(mark);
    else tr.addMark(from, to, mark);
    this.view.dispatch(tr);
    this.view.focus();
  }

  /**
   * Insert an image by URL.
   *
   * A file cannot be embedded inline here without a server to receive it, so
   * the dialog offers a URL. A file picker is available and produces a data
   * URI, which is convenient for a small pasted screenshot but bloats the form
   * field badly for a photograph, so it warns above a threshold.
   */
  async _promptImage() {
    const { action, values } = await openDialog({
      strings: this.strings,
      title: t(this.strings, 'image'),
      dir: this.options.dir,
      tokens: this.themeTokens,
      fields: [
        {
          name: 'src',
          label: t(this.strings, 'imageUrl'),
          value: '',
          type: 'text',
          placeholder: 'https://'
        },
        { name: 'alt', label: t(this.strings, 'imageAlt'), value: '', type: 'text' }
      ],
      submit: t(this.strings, 'linkApply'),
      onSubmit: ({ src, alt }) => {
        const trimmed = (src || '').trim();
        if (!trimmed) return t(this.strings, 'imageUrl');
        const safe = sanitizeImageSrc(trimmed);
        if (!safe) return t(this.strings, 'linkInvalid');
        if (safe.startsWith('data:')) {
          const warning = this._dataUriWarning(safe);
          if (warning) return warning;
        }
        return null;
      }
    });

    if (action !== 'submit') {
      this.view.focus();
      return;
    }

    const src = sanitizeImageSrc(((values && values.src) || '').trim());
    if (!src) {
      this.view.focus();
      return;
    }

    const node = schema.nodes.image.create({
      src,
      alt: ((values && values.alt) || '').trim() || null
    });
    const tr = this.view.state.tr.replaceSelectionWith(node);
    this.view.dispatch(tr);
    this.view.focus();
  }

  /**
   * Warn when a data URI would make the field unreasonably large.
   *
   * Base64 costs about a third more than the original bytes, and the encoded
   * string travels inside the form value, so it lands in the database, any
   * email notification and every server request body.
   */
  _dataUriWarning(src) {
    const bytes = Math.round((src.length * 3) / 4);
    const kb = Math.round(bytes / 1024);
    if (kb < 200) return null;
    return t(this.strings, 'imageTooBig', {
      size: kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`,
      encoded: `${Math.round(src.length / 1024)} KB`
    });
  }

  /** Insert a table with a chosen size. */
  async _promptTable() {
    const MAX = 20;
    const { action, values } = await openDialog({
      strings: this.strings,
      title: t(this.strings, 'table'),
      dir: this.options.dir,
      tokens: this.themeTokens,
      fields: [
        { name: 'rows', label: t(this.strings, 'tableRows'), value: '3', type: 'number' },
        { name: 'cols', label: t(this.strings, 'tableCols'), value: '3', type: 'number' }
      ],
      submit: t(this.strings, 'linkApply'),
      onSubmit: ({ rows, cols, header }) => {
        const r = parseInt(rows, 10);
        const c = parseInt(cols, 10);
        const rOk = Number.isInteger(r) && r >= 1 && r <= MAX;
        const cOk = Number.isInteger(c) && c >= 1 && c <= MAX;
        if (!rOk || !cOk) return t(this.strings, 'tableSize', { max: MAX });
        return null;
      }
    });

    if (action !== 'submit') {
      this.view.focus();
      return;
    }

    const rows = Math.min(MAX, Math.max(1, parseInt(values.rows, 10) || 1));
    const cols = Math.min(MAX, Math.max(1, parseInt(values.cols, 10) || 1));
    this._insertTable(rows, cols);
    this.view.focus();
  }

  _insertTable(rows, cols) {
    const { schema: sch } = this.view.state;
    const cell = () => sch.nodes.table_cell.createAndFill();
    const headerCell = () => sch.nodes.table_header.createAndFill();
    const rowNodes = [];
    for (let r = 0; r < rows; r++) {
      const cells = [];
      for (let c = 0; c < cols; c++) {
        // First row is a header, which is both correct semantics and what
        // prosemirror-tables expects for column-wide selection to behave.
        cells.push(r === 0 ? headerCell() : cell());
      }
      rowNodes.push(sch.nodes.table_row.create(null, cells));
    }
    const table = sch.nodes.table.create(null, rowNodes);
    this.view.dispatch(this.view.state.tr.replaceSelectionWith(table));
  }

  /** Strip the link mark from the current selection. */
  _removeLink() {
    const { from, to } = this.view.state.selection;
    const tr = this.view.state.tr;
    if (from === to) {
      tr.removeStoredMark(schema.marks.link);
    } else {
      tr.removeMark(from, to, schema.marks.link);
    }
    this.view.dispatch(tr);
  }

  _refresh() {
    const state = this.view.state;
    // `buttons` is absent on a toolbar-less instance, and dispatchTransaction
    // can fire before the toolbar is built, so guard rather than assume.
    (this.buttons || []).forEach(({ el, item }) => {
      if (typeof item.isActive === 'function') {
        const active = item.isActive(state);
        el.classList.toggle('is-active', active);
        el.setAttribute('aria-pressed', active ? 'true' : 'false');
      }
    });
    this._updateCount();
    this._updatePlaceholder(state);
  }

  /**
   * Tell the stylesheet whether the document is empty.
   *
   * ProseMirror knows this properly: a document with one empty paragraph is
   * empty to a reader, and so is one holding a single empty text node, while
   * textContent of either is the empty string. Measuring the DOM would be
   * coincidentally right today and wrong the moment a node has no text, such as
   * an image on its own.
   */
  _updatePlaceholder(state) {
    if (!this.editorHost.hasAttribute('data-placeholder')) return;
    const doc = state.doc;
    const empty =
      doc.childCount === 0 ||
      (doc.childCount === 1 && doc.firstChild.isTextblock && doc.firstChild.content.size === 0);
    this.editorHost.setAttribute('aria-empty', empty ? 'true' : 'false');
  }

  _updateCount() {
    const n = this.view.state.doc.textContent.length;
    this.count.textContent = t(this.strings, 'characterCount', { n });
  }

  /* -------- source sync -------- */

  _syncFromSource() {
    const raw = this._normalizeSource(this._rawValue());
    this._lastSynced = this._rawValue();
    if (!raw) return;
    const dom = new DOMParser().parseFromString(`<div>${raw}</div>`, 'text/html');
    const doc = PMDOMParser.fromSchema(schema).parse(dom.body.firstChild);
    this.view.updateState(EditorState.create({ doc, plugins: this._plugins() }));
    this._syncToSource();
    this._refresh();
  }

  /** Reset the editor to an empty document. */
  _clear() {
    this.view.updateState(
      EditorState.create({ schema, plugins: this._plugins() })
    );
    this._syncToSource();
    this._refresh();
  }

  _rawValue() {
    const el = this.el;
    if (!el) return '';
    if (el.tagName === 'TEXTAREA') return el.value || '';
    return el.innerHTML || '';
  }

  _syncToSource() {
    const el = this.el;
    if (!el) return;
    const html = this.getHTML();
    // Guard against re-entrancy: writing the value fires no `input` event by
    // itself, but a host page's patched setter might dispatch one.
    this._settingValue = true;
    if (el.tagName === 'TEXTAREA') el.value = html;
    else el.innerHTML = html;
    this._lastSynced = html;
    this._settingValue = false;
  }

  /* -------- form integration -------- */

  _bind() {
    const form = this.el.form;
    // A textarea inside a form holds the serialised value, so it stays the
    // single source of truth for submission: the editor is progressive
    // enhancement over the existing field, not a replacement for it. The value
    // is written on every keystroke (see dispatchTransaction), so a plain form
    // POST, an AJAX read of the field, or a capture-phase listener all see
    // current data.
    if (form) {
      form.addEventListener('submit', () => this._syncToSource());
      // form.reset() restores the field's DEFAULT value, not empty. Read it
      // after the reset has actually happened, otherwise we would re-read the
      // pre-reset value and the editor would keep showing it.
      form.addEventListener('reset', () => {
        setTimeout(() => {
          const def = this.el.tagName === 'TEXTAREA'
            ? (this.el.defaultValue || '')
            : (this._defaultHtml || '');
          this._settingValue = true;
          this._lastSynced = def;
          this._settingValue = false;
          if (def.trim()) this._syncFromSource();
          else this._clear();
        }, 0);
      });
    }

    // Detect the value being changed from outside (React, jQuery, another
    // script). We cannot observe a textarea's value directly, so patch the
    // prototype setter once and dispatch a normal `input` event, which is what
    // every framework listens for anyway.
    patchValueSetter();

    this._onExternalInput = () => {
      if (this._settingValue) return;
      if (this._rawValue() !== this._lastSynced) this._syncFromSource();
    };
    this.el.addEventListener('input', this._onExternalInput);
    this.el.addEventListener('change', this._onExternalInput);
  }

  /**
   * Also accept plain-text content.
   *
   * A contact form's textarea usually contains text, not HTML. Feeding that
   * straight into the parser would treat `<` and newlines as markup. When the
   * source has no block-level markup we convert newlines to paragraphs first.
   */
  _normalizeSource(raw) {
    if (!raw) return '';
    const hasBlocks = /<(p|div|h[1-6]|ul|ol|li|blockquote|pre|br)\b/i.test(raw);
    if (hasBlocks) return raw;
    // Escape, then split on blank lines / single newlines.
    const escaped = raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return escaped
      .split(/\n\s*\n/)
      .map((chunk) => '<p>' + chunk.replace(/\n/g, '<br>') + '</p>')
      .join('');
  }

  /* -------- public API -------- */

  getHTML() {
    const fragment = DOMSerializer.fromSchema(schema).serializeFragment(
      this.view.state.doc.content
    );
    const div = document.createElement('div');
    div.appendChild(fragment);
    return div.innerHTML;
  }

  getText() {
    return this.view.state.doc.textContent;
  }

  setHTML(html) {
    const dom = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const doc = PMDOMParser.fromSchema(schema).parse(dom.body.firstChild);
    this.view.updateState(EditorState.create({ doc, plugins: this._plugins() }));
    this._syncToSource();
    this._refresh();
  }

  focus() {
    this.view.focus();
  }

  /** Explicit teardown. The original had none, so timers and listeners leaked. */
  destroy() {
    // Detach the OS colour-scheme listener, or a destroyed instance keeps
    // reacting to system theme changes.
    if (this._mq && this._mqHandler) {
      if (this._mq.removeEventListener) this._mq.removeEventListener('change', this._mqHandler);
      else if (this._mq.removeListener) this._mq.removeListener(this._mqHandler);
    }
    if (this._onExternalInput) {
      this.el.removeEventListener('input', this._onExternalInput);
      this.el.removeEventListener('change', this._onExternalInput);
    }
    if (this._fadeResize) window.removeEventListener('resize', this._fadeResize);
    this.view.destroy();
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.el.style.display = '';
    const i = instances.indexOf(this);
    if (i !== -1) instances.splice(i, 1);
    // Last instance gone? Take the head links with it, so a torn-down editor
    // does not leave attribution behind in someone's document.
    if (instances.length === 0) removeAttribution();
  }
}

/* ------------------------------------------------------------------ *
 * Declarative auto-init
 *
 * This is the part worth keeping from the original: scan for markup, upgrade
 * in place, no JS required from the integrator.
 * ------------------------------------------------------------------ */

export const SELECTOR =
  'textarea[data-enterraedit], div[data-enterraedit], [data-enterraedit]:not(script)';

export function initEditors(root = document) {
  const created = [];
  const candidates = root.querySelectorAll(SELECTOR);
  candidates.forEach((el) => {
    if (el.tagName === 'SCRIPT' || el.__enterraEdit) return;
    el.__enterraEdit = true;
    created.push(
      new EnterraEdit({
        element: el,
        lang: el.getAttribute('data-lang') || undefined,
        dir: el.getAttribute('data-dir') || undefined,
        toolbar: el.getAttribute('data-toolbar') !== 'false',
        spellcheck: el.getAttribute('data-spellcheck') !== 'false'
      })
    );
  });
  return created;
}

export function autoInitWhenReady() {
  if (typeof document === 'undefined') return;

  // Hide the source fields and inject the stylesheet now, before waiting for
  // DOMContentLoaded.
  //
  // The script is loaded with defer, so it runs after the HTML is parsed and
  // the browser has already painted. Auto-init then waited for
  // DOMContentLoaded, and the textarea was hidden at the end of construction.
  // Between first paint and that moment the raw markup was on screen as plain
  // text: a page with <h2>Try the editor</h2> in a textarea showed exactly
  // that, then replaced it. The wait is what makes it visible, and on a cold
  // load or a slow connection it lasts long enough to read.
  //
  // Doing these two things here closes it. Neither depends on the DOM being
  // ready: the stylesheet is appended to head, and the rule itself is what
  // hides the fields, so nothing has to be found or measured first.
  primeAutoInit();

  const go = () => initEditors(document);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', go);
  } else {
    go();
  }
}

/**
 * Hide marked fields and install the stylesheet ahead of the upgrade.
 *
 * Deliberately tolerant: if this throws, the editor should still initialise,
 * just with the flash it had before. A missing hint is better than a dead page.
 */
function primeAutoInit() {
  try {
    if (!document.getElementById('enterraedit-styles')) {
      const style = document.createElement('style');
      style.id = 'enterraedit-styles';
      style.textContent = STYLES;
      (document.head || document.documentElement).appendChild(style);
    }

    // A class added one element at a time, because querySelectorAll is useless
    // until the elements are parsed and the rule has to cover whatever exists
    // now plus whatever the parser produces next. The stylesheet carries a rule
    // for the attribute itself as well, so a field parsed after this line is
    // still hidden on arrival.
    const marked = document.querySelectorAll(SELECTOR);
    for (const el of marked) el.classList.add('ee-pending');
  } catch (e) {
    // Nothing here is worth breaking initialisation over.
  }
}

if (typeof window !== 'undefined') {
  window.EnterraEdit = EnterraEdit;
  window.EnterraEdit.initEditors = initEditors;
  // Auto-init gives the integrator no handle on the instance it created, which
  // makes the public API unreachable from a host page. These close that gap.
  window.EnterraEdit.instances = instances;
  window.EnterraEdit.getInstance = (target) => {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    return instances.find((i) => i.el === el) || null;
  };

  // The bundle also exposes a named global, from the esbuild --global-name
  // flag, and that is what a bundler consumer or the demo page reaches for.
  // Mirror the helpers onto it once it exists, so the two globals are
  // interchangeable rather than subtly different.
  const publish = () => {
    const B = window.EnterraEditBundle;
    if (!B || B.getInstance) return;
    B.EnterraEdit = EnterraEdit;
    B.initEditors = initEditors;
    B.instances = instances;
    B.getInstance = window.EnterraEdit.getInstance;
  };
  publish();
  // The IIFE global is assigned after this module body runs, so try again on
  // the next tick rather than assuming it is already there.
  if (typeof setTimeout === 'function') setTimeout(publish, 0);

  autoInitWhenReady();
}
