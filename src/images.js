/**
 * Pasting and dropping image files.
 *
 * A screenshot copied to the clipboard arrives as a File on the paste event,
 * and a dragged image arrives the same way on drop. Neither carries HTML, so
 * the schema never sees them and they were previously discarded without a word.
 *
 * Both are turned into a data URI and inserted through the same path the image
 * dialog uses, so validation and the size warning stay in one place.
 */

import { sanitizeImageSrc } from './url.js';

/** Types we are willing to read. SVG is excluded: it can carry script. */
const ALLOWED = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp'
];

/**
 * Read a File as a data URI.
 *
 * FileReader rather than File.arrayBuffer + btoa: it is available everywhere,
 * handles large blobs without building a huge intermediate string, and needs no
 * chunking for the sizes involved here.
 */
export function fileToDataUri(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/** True when the file looks like an image we are prepared to embed. */
export function isAllowedImage(file) {
  return !!file && ALLOWED.includes((file.type || '').toLowerCase());
}

/** Human-readable byte size, for the messages the caller shows. */
export function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' bytes';
  const kb = bytes / 1024;
  if (kb < 1024) return Math.round(kb) + ' KB';
  return (kb / 1024).toFixed(1) + ' MB';
}

/**
 * Files carried by a clipboard or drag event.
 *
 * `items` is preferred because it includes files on a paste in browsers where
 * `files` is empty. Both are checked since support varies.
 */
export function filesFrom(dataTransfer) {
  if (!dataTransfer) return [];
  const out = [];
  if (dataTransfer.files && dataTransfer.files.length) {
    for (const f of dataTransfer.files) out.push(f);
  }
  if (!out.length && dataTransfer.items) {
    for (const item of dataTransfer.items) {
      if (item.kind === 'file') {
        const f = item.getAsFile && item.getAsFile();
        if (f) out.push(f);
      }
    }
  }
  return out.filter(isAllowedImage);
}
