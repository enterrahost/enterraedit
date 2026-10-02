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
  exitCode
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
import { sanitizeUrl } from './url.js';
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

function toolbarFor(lang) {
  const { schema: s } = { schema };
  return [
    {
      key: 'bold',
      icon: ICONS.bold,
      run: toggleMark(s.marks.strong),
      isActive: (state) => !!s.marks.strong.isInSet(state.styles ? [] : state.selection.$from.marks())
    },
    {
      key: 'italic',
      icon: ICONS.italic,
      run: toggleMark(s.marks.em),
      isActive: (state) => !!s.marks.em.isInSet(state.selection.$from.marks())
    },
    {
      key: 'underline',
      icon: ICONS.underline,
      run: toggleMark(s.marks.underline),
      isActive: (state) => !!s.marks.underline.isInSet(state.selection.$from.marks())
    },
    {
      key: 'strike',
      icon: ICONS.strike,
      run: toggleMark(s.marks.strikethrough),
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
export { sanitizeUrl };

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
      toolbar: options.toolbar !== false,
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
      strings: Object.assign({}, STRINGS[lang.base], options.strings || {}),
      onChange: options.onChange || null,
      name: el.getAttribute('data-name') || el.getAttribute('name') || null
    };

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
    const built = buildTokens(this.options.theme, this.options.accent, null);
    this.themeName = built.name;
    this.root.setAttribute('data-ee-theme', built.name);
    for (const [prop, value] of Object.entries(built.tokens)) {
      this.root.style.setProperty(prop, value);
    }
    // Let the host style around the theme if it wants to.
    this.root.classList.toggle('ee-theme-dark', this.getEffectiveTheme() === 'dark');
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
    if (typeof window === 'undefined' || !window.matchMedia) return;
    this._mq = window.matchMedia('(prefers-color-scheme: dark)');
    this._mqHandler = () => this._applyTheme();
    // addEventListener is the modern API; older Safari only has addListener.
    if (this._mq.addEventListener) this._mq.addEventListener('change', this._mqHandler);
    else if (this._mq.addListener) this._mq.addListener(this._mqHandler);
  }

  /** Which preset is actually in effect right now. */
  getEffectiveTheme() {
    return resolveTheme(this.options.theme);
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
      history(),
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
        'Mod-Enter': exitCode,
        Enter: chainCommands(exitCode)
      }),
      // Enter inside a list item should split; this is the one list behaviour
      // worth wiring explicitly.
      keymap({
        Enter: (state, dispatch) => {
          const { $from, empty } = state.selection;
          if (!empty) return false;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type === s.nodes.list_item) {
              return splitListItem(s.nodes.list_item)(state, dispatch);
            }
          }
          return false;
        },
        Tab: sinkListItem(s.nodes.list_item),
        'Shift-Tab': liftListItem(s.nodes.list_item)
      })
    ];
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

    toolbarFor(this.options.lang).forEach((item) => {
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

  _promptLink() {
    const { from, to } = this.view.state.selection;
    const existing = this.view.state.doc.rangeHasMark(
      from,
      to,
      schema.marks.link
    )
      ? schema.marks.link.isInSet(this.view.state.doc.resolve(from).marks())
      : null;
    const answer = window.prompt(t(this.strings, 'linkPrompt'), (existing && existing.attrs.href) || '');
    if (answer === null) return;
    const url = sanitizeUrl(answer);
    if (!url) {
      window.alert(t(this.strings, 'linkPrompt'));
      return;
    }
    const mark = schema.marks.link.create({ href: url });
    const tr = this.view.state.tr;
    if (from === to) {
      tr.addStoredMark(mark);
    } else {
      tr.addMark(from, to, mark);
    }
    this.view.dispatch(tr);
    this.view.focus();
  }

  /* -------- state reflection -------- */

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
  const go = () => initEditors(document);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', go);
  } else {
    go();
  }
}

if (typeof window !== 'undefined') {
  window.EnterraEdit = EnterraEdit;
  window.EnterraEdit.initEditors = initEditors;
  autoInitWhenReady();
}
