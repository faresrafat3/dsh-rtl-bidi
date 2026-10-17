/**
 * RTL + bidi layer for the Harness Web UI.
 *
 * Measured on the live page (2026-10-17, 1198x1417 viewport, 818 elements):
 *   - <html lang="en"> with no dir attribute; every element computed ltr, and
 *     not one element fixes direction on its own, so flipping the root mirrors
 *     the shell with no per-component override: the first Arabic sidebar title
 *     moved x=40 -> x=963, the composer 380 -> 105, and overflowX stayed 0.
 *   - body's font stack carries no Arabic family, so Arabic fell back per glyph.
 *
 * The layout therefore needs only the root attribute; the rules below cover
 * fonts, mixed Arabic/Latin paragraphs, and the surfaces that must stay LTR.
 *
 * Alt+R toggles the layer. The choice persists in localStorage.
 * A floating toggle button was measured and rejected: every viewport corner is
 * occupied by another control (the bottom-end spot overlapped a 260x42 trigger
 * by 748 px^2), so the layer ships with a keyboard toggle and no overlay.
 */
window.__ModuleLoader__.load({
  id: '@fares/dsh-rtl-bidi',
  factory() {
    const STORE_KEY = 'dsh:rtl-bidi';
    const STYLE_ID = 'dsh-rtl-bidi-style';

    const CSS = `
html[dir="rtl"] { direction: rtl; }

html[dir="rtl"] body,
html[dir="rtl"] input,
html[dir="rtl"] textarea,
html[dir="rtl"] button {
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue",
    "Noto Naskh Arabic", "Noto Kufi Arabic", "Noto Sans Arabic", Tahoma, Arial, sans-serif;
}

/* Mixed Arabic/Latin: each block takes its base direction from its own first
   strong character, so an English paragraph stays LTR inside an RTL shell. */
html[dir="rtl"] :where(div, p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote) {
  unicode-bidi: plaintext;
}

/* Code, terminals and editors must never be mirrored. */
html[dir="rtl"] :where(pre, code, kbd, samp, var, .monaco-editor, .cm-editor, .xterm, .CodeMirror) {
  direction: ltr !important;
  unicode-bidi: isolate !important;
}
html[dir="rtl"] :where(pre, .monaco-editor, .cm-editor, .xterm, .CodeMirror) {
  text-align: left !important;
}
`;

    return {
      apply(ctx) {
        const html = document.documentElement;
        const original = { dir: html.getAttribute('dir'), lang: html.getAttribute('lang') };

        let on = true;
        try {
          on = localStorage.getItem(STORE_KEY) !== 'off';
        } catch (err) {
          on = true; // storage blocked: keep the layer on, just not persistent
        }

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        document.head.appendChild(style);

        function restore(el, name, value) {
          if (value === null) el.removeAttribute(name);
          else el.setAttribute(name, value);
        }

        function applyState() {
          if (on) {
            if (html.getAttribute('dir') !== 'rtl') html.setAttribute('dir', 'rtl');
            if (html.getAttribute('lang') !== 'ar') html.setAttribute('lang', 'ar');
          } else {
            restore(html, 'dir', original.dir);
            restore(html, 'lang', original.lang);
          }
          html.dataset.dshRtlBidi = on ? 'on' : 'off'; // machine-checkable marker
        }

        function toggle() {
          on = !on;
          try {
            localStorage.setItem(STORE_KEY, on ? 'on' : 'off');
          } catch (err) {
            /* storage unavailable: the toggle still works for this page */
          }
          applyState();
        }

        // The app is free to rewrite <html> (it resets lang="en" on boot);
        // re-assert the layer whenever either attribute drifts.
        const watcher = new MutationObserver(() => {
          const wantDir = on ? 'rtl' : original.dir;
          const wantLang = on ? 'ar' : original.lang;
          if ((html.getAttribute('dir') || null) !== wantDir ||
              (html.getAttribute('lang') || null) !== wantLang) applyState();
        });

        function onKey(event) {
          if (!event.altKey || event.ctrlKey || event.metaKey) return;
          if (event.code === 'KeyR' || event.key === 'r' || event.key === 'R') {
            event.preventDefault();
            toggle();
          }
        }

        window.addEventListener('keydown', onKey, true);
        watcher.observe(html, { attributes: true, attributeFilter: ['dir', 'lang'] });
        applyState();

        const teardown = () => {
          watcher.disconnect();
          window.removeEventListener('keydown', onKey, true);
          style.remove();
          restore(html, 'dir', original.dir);
          restore(html, 'lang', original.lang);
          delete html.dataset.dshRtlBidi;
        };

        if (ctx && typeof ctx.effect === 'function') ctx.effect(() => teardown, 'dsh-rtl-bidi');
        else return teardown;
      },
    };
  },
});