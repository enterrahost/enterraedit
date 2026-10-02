/**
 * Document schema.
 *
 * Small on purpose: headings, paragraphs, lists, blockquote, code and links,
 * with bold/italic/underline/strike marks. This covers the common case the
 * product is pitched at.
 *
 * Note what we get for free by using a real document model instead of
 * contenteditable + execCommand: every mutation below is a transaction, so
 * undo, selection, serialisation and bidi are all correct by construction.
 */

import { Schema } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';
import { sanitizeUrl, sanitizeImageSrc } from './url.js';

const nodes = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block');

/**
 * `prosemirror-schema-basic` ships only `em`, `strong`, `link` and `code`.
 * Underline and strikethrough have to be added, otherwise their toolbar
 * buttons render and do nothing, which is exactly the class of silent
 * no-op the original editor was full of.
 */
const underline = {
  parseDOM: [
    { tag: 'u' },
    {
      style: 'text-decoration',
      getAttrs: (value) => (value === 'underline' ? null : false)
    }
  ],
  toDOM() {
    return ['u', 0];
  }
};

const strikethrough = {
  parseDOM: [
    { tag: 's' },
    { tag: 'del' },
    {
      style: 'text-decoration',
      getAttrs: (value) => (value === 'line-through' ? null : false)
    }
  ],
  toDOM() {
    return ['s', 0];
  }
};

/**
 * An image node that validates its own src, for the same reason the link mark
 * does. ProseMirror's basic schema accepts any string, so a `javascript:` or
 * `data:` source loaded through setHTML() or a paste would be stored by
 * getHTML() and handed to the server.
 *
 * Browsers currently block script execution from an image src, so this is less
 * dangerous than the equivalent link bug, but storing it is still wrong and a
 * downstream renderer may be less careful than a browser.
 *
 * `data:` images are permitted for image types only. That allows pasted
 * screenshots, which arrive as data URIs, while excluding `image/svg+xml`,
 * which can carry script.
 */
const image = {
  inline: true,
  attrs: {
    src: {},
    alt: { default: null },
    title: { default: null }
  },
  group: 'inline',
  draggable: true,
  parseDOM: [
    {
      tag: 'img[src]',
      getAttrs(dom) {
        const src = sanitizeImageSrc(dom.getAttribute('src'));
        if (!src) return false;
        return {
          src,
          alt: dom.getAttribute('alt'),
          title: dom.getAttribute('title')
        };
      }
    }
  ],
  toDOM(node) {
    const src = sanitizeImageSrc(node.attrs.src);
    // An unusable source loses the image rather than emitting a broken one.
    if (!src) return ['span', 0];
    const attrs = { src };
    if (node.attrs.alt) attrs.alt = node.attrs.alt;
    if (node.attrs.title) attrs.title = node.attrs.title;
    return ['img', attrs];
  }
};

/**
 * A link mark that validates its own href.
 *
 * `prosemirror-schema-basic` accepts any string as an href, so a `javascript:`
 * URL pasted in, loaded via setHTML(), or parsed out of a textarea would be
 * stored by getHTML() and execute on whatever page later renders it.
 *
 * Validating in `parseDOM` and `toDOM` covers every entry and exit point rather
 * than just the link dialog, which is the only path the UI controls.
 *
 * An unsafe href is dropped rather than the whole mark, so the text survives
 * and simply stops being a link. Silently keeping the text is friendlier than
 * losing the user's content, and it cannot be exploited.
 */
const link = {
  attrs: { href: {}, title: { default: null } },
  inclusive: false,
  parseDOM: [
    {
      tag: 'a[href]',
      getAttrs(dom) {
        const href = sanitizeUrl(dom.getAttribute('href'));
        if (!href) return false;
        return { href, title: dom.getAttribute('title') };
      }
    }
  ],
  toDOM(node) {
    const href = sanitizeUrl(node.attrs.href);
    if (!href) return ['span', 0];
    const attrs = { href, rel: 'noopener noreferrer nofollow' };
    if (node.attrs.title) attrs.title = node.attrs.title;
    return ['a', attrs, 0];
  }
};

export const schema = new Schema({
  nodes: nodes
    .update('image', image)
    .update('heading', {
      attrs: { level: { default: 1 }, dir: { default: null } },
      content: 'inline*',
      group: 'block',
      defining: true,
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
        tag: `h${level}`,
        attrs: { level, dir: null }
      })),
      toDOM(node) {
        const attrs = {};
        if (node.attrs.dir) attrs.dir = node.attrs.dir;
        return [`h${node.attrs.level}`, attrs, 0];
      }
    })
    .update('paragraph', {
      attrs: { dir: { default: null } },
      content: 'inline*',
      group: 'block',
      parseDOM: [{ tag: 'p', attrs: { dir: null } }],
      toDOM(node) {
        const attrs = {};
        if (node.attrs.dir) attrs.dir = node.attrs.dir;
        return ['p', attrs, 0];
      }
    }),
  marks: basicSchema.spec.marks
    .addBefore('code', 'underline', underline)
    .addBefore('code', 'strikethrough', strikethrough)
    .update('link', link)
});
