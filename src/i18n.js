/**
 * i18n string table.
 *
 * One table drives three things at once:
 *   1. the button tooltip        (title)
 *   2. the accessible name       (aria-label)
 *   3. the spellcheck language   (via the `lang` attribute)
 *
 * That is the whole point: translate once, get all three.
 */

export const STRINGS = {
  en: {
    bold: 'Bold',
    italic: 'Italic',
    underline: 'Underline',
    strike: 'Strikethrough',
    heading1: 'Heading 1',
    heading2: 'Heading 2',
    heading3: 'Heading 3',
    paragraph: 'Paragraph',
    bulletList: 'Bulleted list',
    orderedList: 'Numbered list',
    blockquote: 'Quote',
    codeBlock: 'Code block',
    link: 'Insert link',
    unlink: 'Remove link',
    undo: 'Undo',
    redo: 'Redo',
    horizontalRule: 'Horizontal rule',
    editingArea: 'Rich text editing area',
    toolbar: 'Formatting toolbar',
    linkPrompt: 'Enter URL',
    linkApply: 'Apply',
    linkCancel: 'Cancel',
    linkRemove: 'Remove link',
    linkInvalid: 'That does not look like a safe web address. Use http, https, mailto or tel.',
    close: 'Close',
    dialogLabel: 'Link',
    image: 'Bild einfuegen',
    imageUrl: 'Bild-URL',
    imageAlt: 'Beschreibung (fuer Screenreader)',
    imagePick: 'Datei waehlen',
    imageTooBig: 'Dieses Bild ist {size}. Eingebettet wuerde es dem Formular etwa {encoded} hinzufuegen, was die meisten Server ablehnen. Bitte extern hosten und die URL einfuegen.',
    imageBadType: 'Dieser Dateityp ist kein Bild.',
    table: 'Tabelle einfuegen',
    tableRows: 'Zeilen',
    tableCols: 'Spalten',
    tableHeader: 'Kopfzeile',
    tableSize: 'Bitte eine Zahl zwischen 1 und {max} eingeben.',
    yes: 'Ja',
    no: 'Nein',
    image: 'Insert image',
    imageUrl: 'Image URL',
    imageAlt: 'Description (for screen readers)',
    imagePick: 'Choose a file',
    imageTooBig: 'That image is {size}. Embedding it would add roughly {encoded} to the form, which most servers reject. Host it elsewhere and paste the URL instead.',
    imageBadType: 'That file type is not an image.',
    table: 'Insert table',
    tableRows: 'Rows',
    tableCols: 'Columns',
    tableHeader: 'Header row',
    tableSize: 'Enter a number between 1 and {max}.',
    yes: 'Yes',
    no: 'No',
    characterCount: '{n} characters',
    badge: 'EnterraEdit'
  },

  de: {
    bold: 'Fett',
    italic: 'Kursiv',
    underline: 'Unterstrichen',
    strike: 'Durchgestrichen',
    heading1: 'Überschrift 1',
    heading2: 'Überschrift 2',
    heading3: 'Überschrift 3',
    paragraph: 'Absatz',
    bulletList: 'Aufzählung',
    orderedList: 'Nummerierte Liste',
    blockquote: 'Zitat',
    codeBlock: 'Codeblock',
    link: 'Link einfügen',
    unlink: 'Link entfernen',
    undo: 'Rückgängig',
    redo: 'Wiederholen',
    horizontalRule: 'Horizontale Linie',
    editingArea: 'Rich-Text-Bearbeitungsbereich',
    toolbar: 'Formatierungsleiste',
    linkPrompt: 'URL eingeben',
    linkApply: 'Anwenden',
    linkCancel: 'Abbrechen',
    linkRemove: 'Link entfernen',
    linkInvalid: 'Das sieht nicht nach einer sicheren Webadresse aus. Verwenden Sie http, https, mailto oder tel.',
    close: 'Schliessen',
    dialogLabel: 'Link',
    characterCount: '{n} Zeichen',
    badge: 'EnterraEdit'
  },

  ar: {
    bold: 'غامق',
    italic: 'مائل',
    underline: 'تسطير',
    strike: 'يتوسطه خط',
    heading1: 'عنوان ١',
    heading2: 'عنوان ٢',
    heading3: 'عنوان ٣',
    paragraph: 'فقرة',
    bulletList: 'قائمة نقطية',
    orderedList: 'قائمة مرقمة',
    blockquote: 'اقتباس',
    codeBlock: 'كتلة تعليمات برمجية',
    link: 'إدراج رابط',
    unlink: 'إزالة الرابط',
    undo: 'تراجع',
    redo: 'إعادة',
    horizontalRule: 'خط أفقي',
    editingArea: 'منطقة تحرير النص المنسق',
    toolbar: 'شريط التنسيق',
    linkPrompt: 'أدخل عنوان URL',
    linkApply: 'تطبيق',
    linkCancel: 'إلغاء',
    linkRemove: 'إزالة الرابط',
    linkInvalid: 'يبدو أن هذا ليس عنوان ويب آمنًا. استخدم http أو https أو mailto أو tel.',
    close: 'إغلاق',
    dialogLabel: 'رابط',
    image: 'إدراج صورة',
    imageUrl: 'رابط الصورة',
    imageAlt: 'الوصف (لقارئات الشاشة)',
    imagePick: 'اختر ملفًا',
    imageTooBig: 'حجم هذه الصورة {size}. تضمينها سيضيف نحو {encoded} إلى النموذج، وهو ما ترفضه معظم الخوادم. استضفها في مكان آخر والصق الرابط.',
    imageBadType: 'نوع هذا الملف ليس صورة.',
    table: 'إدراج جدول',
    tableRows: 'صفوف',
    tableCols: 'أعمدة',
    tableHeader: 'صف العنوان',
    tableSize: 'أدخل رقمًا بين ١ و {max}.',
    yes: 'نعم',
    no: 'لا',
    characterCount: '{n} حرفًا',
    badge: 'EnterraEdit'
  }
};

/** Languages written right-to-left. */
export const RTL_LANGS = ['ar', 'he', 'fa', 'ur', 'yi', 'dv', 'ps', 'sd'];

/** Fallback chain used when nothing is specified explicitly. */
export const DEFAULT_LANG = 'en';

/**
 * Normalise a tag like "de-AT" or "ar-EG" down to a base we have strings for.
 * Falls back to English rather than throwing, so an unsupported locale still
 * yields a working editor.
 */
export function normalizeLang(tag) {
  if (!tag || typeof tag !== 'string') return null;
  const base = tag.toLowerCase().split('-')[0].trim();
  return base || null;
}

export function isRtl(lang) {
  return RTL_LANGS.indexOf(normalizeLang(lang)) !== -1;
}

/**
 * Resolve the language for an instance, in priority order:
 *
 *   1. the `lang` / `data-lang` attribute on the element being enhanced
 *   2. explicit option passed to the constructor
 *   3. `lang` / `data-lang` on the script tag that loaded us
 *   4. document.documentElement.lang
 *   5. navigator.language
 *   6. English
 *
 * Returns a tag we actually have strings for, plus the raw requested tag so
 * `lang` can be set faithfully on the editing surface (the browser needs the
 * *real* tag to pick the right spellcheck dictionary).
 */
export function resolveLang(explicit, element) {
  const requested =
    elementLang(element) ||
    explicit ||
    scriptLang() ||
    (typeof document !== 'undefined' && document.documentElement.lang) ||
    (typeof navigator !== 'undefined' && (navigator.language || navigator.languages?.[0])) ||
    DEFAULT_LANG;

  const base = normalizeLang(requested) || DEFAULT_LANG;
  return {
    requested: requested || DEFAULT_LANG,
    base: STRINGS[base] ? base : DEFAULT_LANG
  };
}

/**
 * Find the nearest language declaration at or above the element.
 *
 * `<fieldset lang="de"><textarea data-enterraedit>` is the natural way to write
 * this in HTML, and it matches how `lang` inherits everywhere else on the web.
 * Nearest ancestor wins, so an element can still override its container.
 */
function elementLang(element) {
  let node = element;
  while (node && node.getAttribute) {
    const attr = node.getAttribute('lang') || node.getAttribute('data-lang');
    if (attr) return attr;
    node = node.parentElement;
  }
  return null;
}

function scriptLang() {
  if (typeof document === 'undefined') return null;
  const scripts = document.getElementsByTagName('script');
  for (let i = 0; i < scripts.length; i++) {
    const s = scripts[i];
    // Match on a stable marker rather than the filename: the filename is
    // something integrators rename, the marker is part of the contract.
    const marker = s.getAttribute && s.getAttribute('data-enterraedit');
    if (marker === null || marker === undefined) continue;
    const attr = s.getAttribute('data-lang');
    if (attr) return attr;
    try {
      const url = new URL(s.src, location.href);
      const q = url.searchParams.get('lang');
      if (q) return q;
    } catch (e) {
      /* ignore malformed src */
    }
  }
  return null;
}

/**
 * Look up a string, interpolating {placeholders}.
 * Unknown keys fall back to English, then to the key itself, so a missing
 * translation degrades to something readable instead of "undefined".
 */
export function t(strings, key, vars) {
  let s = (strings && strings[key]) ?? STRINGS[DEFAULT_LANG][key] ?? key;
  if (vars) {
    s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  }
  return s;
}
