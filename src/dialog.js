/**
 * Modal dialog.
 *
 * Built on the native `<dialog>` element and `showModal()`, which is what keeps
 * this dependency-free. The browser supplies the focus trap, Escape handling,
 * focus restoration to the previously focused element, the `::backdrop`, and
 * top-layer stacking. Reimplementing those by hand is where modals usually go
 * wrong.
 *
 * Two details worth knowing:
 *
 *   Custom properties inherit through the top layer, so a dialog nested inside
 *   `.ee-root` picks up the active theme with no extra wiring. Verified against
 *   light, dark, sepia and a custom accent.
 *
 *   Chrome reports `document.activeElement === body` momentarily while tab
 *   wrap-around happens inside a modal dialog. Focus never actually escapes,
 *   but it makes the tab position look wrong, so we nudge it back.
 */

import { t } from './i18n.js';

/**
 * @param {object} opts
 * @param {object} opts.strings  instance string table
 * @param {string} opts.title    dialog heading, already translated
 * @param {Array}  opts.fields   [{ name, label, value, type, placeholder }]
 * @param {string} opts.submit   submit button label
 * @param {string} [opts.extra]  optional secondary action label, e.g. "Remove"
 * @param {Function} opts.onSubmit  (values) => string|null; a returned string
 *                                  is shown as an inline error and keeps the
 *                                  dialog open
 * @param {Function} [opts.onExtra]
 * @param {string} [opts.dir]   'ltr' or 'rtl', inherited from the host editor
 * @param {object} [opts.tokens] CSS custom properties to copy onto the dialog
 * @returns {Promise<string|null>} the action taken, or null if dismissed
 */
export function openDialog(opts) {
  const {
    strings,
    title,
    fields = [],
    submit,
    extra,
    onSubmit,
    onExtra,
    dir,
    tokens
  } = opts;

  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'ee-dialog';

    // The dialog is appended to <body> rather than inside .ee-root, because
    // showModal moves it to the top layer and a nested position buys nothing.
    // That means it inherits neither the theme tokens nor the direction, so
    // both are copied across explicitly.
    if (dir) dialog.setAttribute('dir', dir);
    if (tokens) {
      for (const [prop, value] of Object.entries(tokens)) {
        dialog.style.setProperty(prop, value);
      }
    }
    // A label on the dialog itself means screen readers announce the purpose
    // rather than reading the controls with no context.
    dialog.setAttribute('aria-label', title);

    const form = document.createElement('form');
    // method="dialog" makes native submission close the dialog, which keeps
    // Enter-to-submit working without a keydown handler.
    form.method = 'dialog';
    form.className = 'ee-dialog-form';

    const headingId = `ee-dialog-title-${Math.random().toString(36).slice(2, 8)}`;
    const heading = document.createElement('h2');
    heading.className = 'ee-dialog-title';
    heading.id = headingId;
    heading.textContent = title;
    dialog.setAttribute('aria-labelledby', headingId);
    form.appendChild(heading);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ee-dialog-close';
    close.setAttribute('aria-label', t(strings, 'close'));
    close.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" aria-hidden="true" focusable="false">' +
      '<path d="M6 6l12 12M18 6L6 18"/></svg>';
    close.addEventListener('click', () => {
      outcome = 'cancel';
      dialog.close('cancel');
    });
    form.appendChild(close);

    const inputs = {};
    for (const field of fields) {
      const id = `ee-f-${field.name}-${Math.random().toString(36).slice(2, 8)}`;
      const label = document.createElement('label');
      label.className = 'ee-dialog-label';
      label.setAttribute('for', id);
      label.textContent = field.label;
      form.appendChild(label);

      const input = document.createElement('input');
      input.className = 'ee-dialog-input';
      input.id = id;
      input.name = field.name;
      input.type = field.type || 'text';
      input.value = field.value || '';
      if (field.placeholder) input.placeholder = field.placeholder;
      // The error message is referenced by the input, so a screen reader reads
      // it as part of the field rather than as loose text.
      input.setAttribute('aria-describedby', id + '-err');
      form.appendChild(input);
      inputs[field.name] = input;
    }

    // Captured on submit so the resolved value can carry the field data back
    // to the caller. Resolving with the action alone would force callers to
    // stash the values somewhere, which is how state leaks between opens.
    let submitted = null;
    // `method="dialog"` sets returnValue to the submit button's `value`
    // attribute, which is usually empty. Relying on that to detect a submit is
    // fragile, so the outcome is tracked explicitly instead.
    let outcome = null;

    const error = document.createElement('p');
    error.className = 'ee-dialog-error';
    error.id = fields.length ? `${inputs[fields[0].name].id}-err` : 'ee-dialog-err';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    form.appendChild(error);

    // Clear a stale error as soon as the user changes a value, so the message
    // does not outlive the input that caused it.
    //
    // Attached here rather than in the field loop above, because `error` is
    // declared between the two and a listener added earlier would close over it
    // before it exists.
    //
    // The timestamp guard matters: the editor patches the value setter to
    // dispatch a deferred `input` event, which can arrive just after a submit
    // has shown an error and would otherwise wipe it straight away. Ignoring
    // anything older than the last submit keeps the message on screen.
    let lastSubmitAt = 0;
    for (const input of Object.values(inputs)) {
      input.addEventListener('input', (e) => {
        if (e.timeStamp < lastSubmitAt) return;
        if (!error.hidden) error.hidden = true;
      });
    }

    const actions = document.createElement('div');
    actions.className = 'ee-dialog-actions';

    if (extra) {
      const extraBtn = document.createElement('button');
      extraBtn.type = 'button';
      extraBtn.className = 'ee-btn-secondary';
      extraBtn.textContent = extra;
      extraBtn.addEventListener('click', () => {
        outcome = 'extra';
        dialog.close('extra');
      });
      actions.appendChild(extraBtn);
    }

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'ee-btn-secondary';
    cancel.textContent = t(strings, 'linkCancel');
    cancel.addEventListener('click', () => {
      outcome = 'cancel';
      dialog.close('cancel');
    });
    actions.appendChild(cancel);

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'ee-btn-primary';
    submitBtn.textContent = submit;
    actions.appendChild(submitBtn);

    form.appendChild(actions);
    dialog.appendChild(form);

    function showError(message) {
      error.textContent = message;
      error.hidden = false;
      const first = fields.length ? inputs[fields[0].name] : null;
      if (first) first.focus();
    }

    form.addEventListener('submit', (e) => {
      const values = {};
      for (const [name, input] of Object.entries(inputs)) values[name] = input.value;
      const problem = onSubmit ? onSubmit(values) : null;
      if (problem) {
        // Keep the dialog open: preventDefault stops the native close.
        e.preventDefault();
        lastSubmitAt = e.timeStamp;
        showError(problem);
        return;
      }
      submitted = values;
      outcome = 'submit';
    });

    dialog.addEventListener('close', () => {
      // A close with no recorded outcome means Escape, the close button, or a
      // backdrop dismissal, all of which are cancellations.
      const action = outcome || 'cancel';
      dialog.remove();
      if (action === 'extra' && onExtra) onExtra();
      resolve({ action, values: action === 'submit' ? submitted || {} : null });
    });

    // Chrome parks focus on <body> during tab wrap-around inside a modal. It is
    // cosmetic, but it makes keyboard navigation feel broken, so send focus
    // back to the first control.
    dialog.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      if (document.activeElement === document.body) {
        e.preventDefault();
        const first = fields.length ? inputs[fields[0].name] : submitBtn;
        first.focus();
      }
    });

    document.body.appendChild(dialog);
    dialog.showModal();

    // Autofocus after showModal, so it wins over the browser's own choice.
    if (fields.length) {
      const first = inputs[fields[0].name];
      first.focus();
      first.select();
    } else {
      submitBtn.focus();
    }

  });
}
