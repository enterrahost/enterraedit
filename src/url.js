/**
 * URL sanitisation.
 *
 * Every href in the document passes through here. There are three ways a URL
 * can enter the editor: the link dialog, `setHTML()`, and paste or initial
 * content parsed out of a textarea. Only the first is under our control, so the
 * check belongs in the schema's link mark rather than at the call sites.
 *
 * Leaving this to the dialog alone is not enough. A `javascript:` href accepted
 * by any other path ends up in `getHTML()`, gets posted to the server, and
 * executes for whoever later views that page.
 */

const SAFE_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

/**
 * Return a usable href, or null if the input is not safe to store.
 *
 * Allows absolute http(s)/mailto/tel URLs, protocol-relative, root-relative and
 * fragment URLs. Bare domains get https:// prefixed. Everything else is
 * rejected, which includes javascript:, data:, vbscript: and blob:.
 */
export function sanitizeUrl(input) {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  // Control characters and embedded newlines are the classic way to smuggle
  // "java\nscript:" past a filter that only looks at the start of the string.
  // Browsers strip these before dispatching, so the check has to happen here.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;

  // Scheme-relative, root-relative and fragment URLs are safe by construction.
  if (/^\/\//.test(raw) || /^\//.test(raw) || /^[#?]/.test(raw)) return raw;

  // Anything carrying a scheme must be on the allowlist.
  const m = raw.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (m) {
    const scheme = m[1].toLowerCase() + ':';
    return SAFE_SCHEMES.includes(scheme) ? raw : null;
  }

  // Bare domain-ish input: assume https rather than treating it as a path.
  if (/^[\w-]+(\.[\w-]+)+/.test(raw)) return 'https://' + raw;

  return raw;
}

/** True when the value would survive sanitisation unchanged. */
export function isSafeUrl(input) {
  const clean = sanitizeUrl(input);
  return clean !== null && clean === String(input).trim();
}

export { SAFE_SCHEMES };

/**
 * Image sources, which have a different rule from links.
 *
 * Same scheme allowlist, plus one addition: `data:` URIs are accepted for
 * raster image types only. Pasting a screenshot produces a data URI and
 * rejecting those would break a common workflow, but `data:image/svg+xml` can
 * carry script and is excluded.
 */
const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,[a-z0-9+/=\s]+$/i;

export function sanitizeImageSrc(input) {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  if (DATA_IMAGE.test(raw)) return raw;
  return sanitizeUrl(raw);
}
