/**
 * Theming.
 *
 * Every colour the editor uses already flows through CSS custom properties, so
 * a theme is just a bag of values for those properties. Three ways to set one,
 * in increasing order of control:
 *
 *   1. a named preset        theme: 'dark'
 *   2. a custom accent       accent: '#345332'
 *   3. a full override       theme: { '--ee-bg': '#fff', ... }
 *
 * `theme: 'auto'` follows `prefers-color-scheme`. Because the presets are
 * applied as a class plus inline custom properties, a host page can restyle
 * the editor with plain CSS and no JS at all.
 */

/**
 * Presets. Each is a complete set of the tokens the stylesheet consumes, so a
 * theme that only overrides *some* tokens inherits the rest, which is how
 * `accent` works.
 */
export const THEMES = {
  light: {
    '--ee-border': '#d4d4d8',
    '--ee-border-strong': '#a1a1aa',
    '--ee-bg': '#ffffff',
    '--ee-fg': '#18181b',
    '--ee-muted': '#71717a',
    '--ee-hover': '#f4f4f5',
    '--ee-active': '#e4e4e7',
    '--ee-focus': '#2563eb',
    '--ee-toolbar-bg': '#fafafa',
    '--ee-code-bg': '#f4f4f5',
    '--ee-shadow': 'none'
  },

  dark: {
    '--ee-border': '#3f3f46',
    '--ee-border-strong': '#52525b',
    '--ee-bg': '#18181b',
    '--ee-fg': '#fafafa',
    '--ee-muted': '#a1a1aa',
    '--ee-hover': '#27272a',
    '--ee-active': '#3f3f46',
    '--ee-focus': '#60a5fa',
    '--ee-toolbar-bg': '#1f1f23',
    '--ee-code-bg': '#27272a',
    '--ee-shadow': 'none'
  },

  // A middle option: not pure white, easier on the eyes than stark light.
  sepia: {
    '--ee-border': '#e0d6c3',
    '--ee-border-strong': '#c4b59a',
    '--ee-bg': '#fbf7ef',
    '--ee-fg': '#3b3428',
    '--ee-muted': '#8a7f6b',
    '--ee-hover': '#f3ecdd',
    '--ee-active': '#e8dfc9',
    '--ee-focus': '#8a6d3b',
    '--ee-toolbar-bg': '#f3ecdd',
    '--ee-code-bg': '#f0e8d8',
    '--ee-shadow': 'none'
  },

  // An opinionated preset, for users who need maximum contrast.
  contrast: {
    '--ee-border': '#000000',
    '--ee-border-strong': '#000000',
    '--ee-bg': '#ffffff',
    '--ee-fg': '#000000',
    '--ee-muted': '#1a1a1a',
    '--ee-hover': '#e6e6e6',
    '--ee-active': '#cccccc',
    '--ee-focus': '#0000ee',
    '--ee-toolbar-bg': '#ffffff',
    '--ee-code-bg': '#f2f2f2',
    '--ee-shadow': 'none'
  }
};

/** Resolve `auto` against the OS setting. */
export function resolveTheme(theme) {
  if (theme === 'auto' || theme === undefined || theme === null) {
    if (typeof window === 'undefined' || !window.matchMedia) return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

/* ------------------------------------------------------------------ *
 * Colour maths for the accent
 *
 * A custom accent has to work as a *background* for active buttons and as a
 * *text* colour for links. Using the raw hex for both gives unreadable
 * results: a dark green like #345332 as link text on a dark background is
 * invisible. So we derive a readable tint per mode.
 * ------------------------------------------------------------------ */

export function parseHex(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  };
}

export function toHex({ r, g, b }) {
  const f = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return '#' + f(r) + f(g) + f(b);
}

/** Perceived luminance, 0 (black) to 1 (white). WCAG's formula. */
export function luminance({ r, g, b }) {
  const ch = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function isDark(hex) {
  const rgb = parseHex(hex);
  return rgb ? luminance(rgb) < 0.5 : false;
}

function mix(a, b, amount) {
  const A = parseHex(a);
  const B = parseHex(b);
  if (!A || !B) return a;
  return toHex({
    r: A.r + (B.r - A.r) * amount,
    g: A.g + (B.g - A.g) * amount,
    b: A.b + (B.b - A.b) * amount
  });
}

export function lighten(hex, amount) {
  return mix(hex, '#ffffff', amount);
}

export function darken(hex, amount) {
  return mix(hex, '#000000', amount);
}

/**
 * Turn a single accent colour into the handful of derived tokens a theme
 * needs, tuned for the mode it will be used in.
 *
 * In light mode the accent is darkened so it reads as text on white; in dark
 * mode it is lightened so it reads on a dark surface. Either way the result
 * is checked against the background and pushed further if it fails, so a
 * mid-tone accent like #345332 stays legible in both.
 */
export function accentTokens(accent, mode) {
  const base = parseHex(accent);
  if (!base) return {};

  const dark = mode === 'dark';

  // Pick a direction that guarantees separation from the surface.
  let focus = dark ? lighten(accent, 0.45) : darken(accent, 0.15);

  const bg = dark ? '#18181b' : '#ffffff';
  const bgLum = luminance(parseHex(bg));
  let fgLum = luminance(parseHex(focus));
  let contrast = (Math.max(bgLum, fgLum) + 0.05) / (Math.min(bgLum, fgLum) + 0.05);

  // Nudge until we clear the 4.5:1 threshold WCAG asks of body text.
  let step = 0;
  while (contrast < 4.5 && step < 10) {
    focus = dark ? lighten(focus, 0.08) : darken(focus, 0.08);
    fgLum = luminance(parseHex(focus));
    contrast = (Math.max(bgLum, fgLum) + 0.05) / (Math.min(bgLum, fgLum) + 0.05);
    step++;
  }

  return {
    '--ee-focus': focus,
    // A restrained tint for the active/pressed state.
    '--ee-active': dark ? mix(accent, '#18181b', 0.55) : mix(accent, '#ffffff', 0.82),
    '--ee-hover': dark ? mix(accent, '#18181b', 0.78) : mix(accent, '#ffffff', 0.92),
    '--ee-toolbar-bg': dark ? mix(accent, '#18181b', 0.86) : mix(accent, '#ffffff', 0.95),
    '--ee-border-strong': dark ? mix(accent, '#3f3f46', 0.5) : mix(accent, '#a1a1aa', 0.4)
  };
}

/**
 * Build the final custom-property map for an instance.
 *
 * Order matters: preset, then accent-derived tokens, then the caller's own
 * object, so an explicit per-token override always wins.
 */
export function buildTokens(theme, accent, overrides) {
  const name = resolveTheme(theme);
  const tokens = {};

  if (typeof name === 'string' && THEMES[name]) {
    Object.assign(tokens, THEMES[name]);
  } else if (name && typeof name === 'object') {
    // A bare object is a full custom theme; start from light so nothing is
    // left undefined.
    Object.assign(tokens, THEMES.light, name);
  } else {
    Object.assign(tokens, THEMES.light);
  }

  if (accent) {
    Object.assign(tokens, accentTokens(accent, isDark(tokens['--ee-bg']) ? 'dark' : 'light'));
  }

  if (overrides && typeof overrides === 'object') {
    Object.assign(tokens, overrides);
  }

  return { name: typeof name === 'string' ? name : 'custom', tokens };
}
