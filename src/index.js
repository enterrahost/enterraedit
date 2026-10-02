/**
 * Public entry point.
 *
 * Re-exports the pieces a consumer or a distribution needs. Everything the
 * editor does internally stays internal; this is the supported surface.
 */

export { EnterraEdit, initEditors, SELECTOR } from './editor.js';
export { openDialog } from './dialog.js';
export {
  MODES,
  MODE_NAMES,
  BUTTONS,
  ALL_KEYS,
  resolveToolbar,
  validateKeys,
  keysByGroup,
  describeMode
} from './modes.js';
export { sanitizeUrl, sanitizeImageSrc, isSafeUrl, SAFE_SCHEMES } from './url.js';
export { STRINGS, RTL_LANGS, isRtl, resolveLang, normalizeLang } from './i18n.js';
export { THEMES, buildTokens, accentTokens, resolveTheme, isDark } from './themes.js';
export {
  setAttributionProvider,
  getAttributionProvider,
  attributionEnabled,
  PRODUCT
} from './branding.js';
export { FONT_STACKS, resolveFont, fontForLang, sizeTokens } from './sizing.js';
export { VERSION } from './version.js';
