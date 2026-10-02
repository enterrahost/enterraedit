/**
 * Attribution, as a host-provided extension point rather than a built-in
 * feature.
 *
 * The core editor carries **no branding of its own**. A distribution that wants
 * attribution installs a provider before any editor is constructed:
 *
 * setAttributionProvider({
 * product: 'EnterraEdit',
 * homepage: 'https://enterrahost.com/enterraedit',
 * badgeByDefault: true,
 * head(version) { ... return [elements] }, // added to <head> once
 * badge(strings, version) { ... return element }
 * });
 *
 * With no provider installed the core adds nothing: no badge, no backlink, no
 * head comment, no data attribute. A downloaded copy leaves the host page
 * byte-for-byte as the integrator wrote it, which is the honest deal for a
 * self-hosted MIT build.
 */

let provider = null;
let attributionInjected = false;

/** Product name used by providers and the default head comment. */
export const PRODUCT = 'EnterraEdit';

/** Install (or clear) the attribution provider. Called by distributions. */
export function setAttributionProvider(p) {
 provider = p || null;
 // A new provider means a fresh document state.
 attributionInjected = false;
}

/** Read the installed provider, mostly for tests and debugging. */
export function getAttributionProvider() {
 return provider;
}

/** Whether anything will be added to the page at all. */
export function attributionEnabled() {
 return provider !== null;
}

/** Badge default when the host page has not stated a preference. */
export function badgeDefault() {
 return !!(provider && provider.badgeByDefault);
}

/**
 * Inject the provider's head elements, once per document.
 *
 * Guarded by a module-level flag rather than an element id: `getElementById`
 * does not match comment nodes, so an id-based check silently fails and every
 * instance appends another copy.
 *
 * If the provider supplies no `head()` we fall back to a plain comment naming
 * the product and licence, which is the least intrusive useful default.
 */
export function injectAttribution(version) {
 if (typeof document === 'undefined' || !provider) return;
 if (attributionInjected) return;
 attributionInjected = true;

 if (typeof provider.head === 'function') {
 const nodes = provider.head(version) || [];
 nodes.forEach((n) => n && document.head.appendChild(n));
 return;
 }

 if (provider.homepage) {
 document.head.appendChild(
 document.createComment(
 ` ${provider.product || PRODUCT} v${version}(${provider.homepage})MIT licensed `
 )
 );
 }
}

/** Build the badge element, if the provider supplies one. */
export function buildBadge(strings, version) {
 if (!provider || typeof provider.badge !== 'function') return null;
 return provider.badge(strings, version);
}

/**
 * Attributes to place on each editor root, e.g. a source URL.
 * Returns null when there is no provider, so callers can skip entirely.
 */
export function rootAttributionAttrs() {
 return (provider && provider.rootAttrs) || null;
}

/** Remove everything the provider injected. Used on full teardown. */
export function removeAttribution() {
 if (typeof document === 'undefined') return;
 document
 .querySelectorAll('[data-ee-attribution]')
 .forEach((n) => n.parentNode && n.parentNode.removeChild(n));
}

/**
 * Read the branding preference for one instance.
 *
 * Precedence: explicit option, then the element's `data-branding`, then on when
 * a provider is installed. Only an explicit falsey value disables it, so a typo
 * never silently turns attribution off.
 */
export function resolveBranding(explicit, element) {
 if (explicit !== undefined) return explicit !== false;
 const attr = element && element.getAttribute && element.getAttribute('data-branding');
 if (attr === 'false' || attr === 'off' || attr === '0') return false;
 return true;
}
