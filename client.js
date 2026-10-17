/**
 * RTL + bidi layer for the Harness Web UI — one client plugin, two faces:
 *
 *   1. Settings → General gains a real preference row ("Right-to-left layout").
 *   2. Alt+R toggles the same preference from anywhere.
 *
 * Both write one state, so the row and the shortcut can never disagree.
 *
 * Measured on the live page (2026-10-17, 1198x1417 viewport, 818 elements):
 *   - <html lang="en"> with no dir attribute; every element computed ltr, and
 *     not one element fixes direction on its own, so flipping the root mirrors
 *     the shell with no per-component override: the first Arabic sidebar title
 *     moved x=40 -> x=963, the composer 380 -> 105, and overflowX stayed 0.
 *   - body's font stack carries no Arabic family, so Arabic fell back per glyph.
 *
 * A floating toggle button was measured and rejected: every viewport corner is
 * occupied by another control (the bottom-end spot overlapped a 260x42 trigger
 * by 748 px^2), so the previous version shipped with a keyboard toggle only.
 * The settings row is the additive seat that allocates its own space, which is
 * why this version can expose a control without covering anything.
 */
window.__ModuleLoader__.load({
  id: '@fares/dsh-rtl-bidi',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const STORE_KEY = 'dsh:rtl-bidi';
    const STYLE_ID = 'dsh-rtl-bidi-style';
    const NS = 'fares-rtl-bidi';
    const ROW_ORDER = 13; // between font-size (11) and developer-tools (15)

    const TEXT = {
      en: {
        label: 'Right-to-left layout',
        hint: 'Mirror the interface for Arabic and keep code left-to-right. Alt+R toggles it.',
      },
      ar: {
        label: 'الاتجاه من اليمين لليسار',
        hint: 'يعكس الواجهة للعربية ويسيب الكود من الشمال لليمين. Alt+R بيقلّبه.',
      },
    };

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

/* The preference row keeps its column direction whatever language its copy is
   in: the rule above would otherwise give an English label an LTR row inside an
   RTL panel and move the switch to the wrong edge. The html[dir] prefix is
   required: :where() carries no weight, so the attribute selector above still
   outranks a bare [data-rtl-bidi-row] rule. */
html[dir="rtl"] [data-rtl-bidi-row] { unicode-bidi: isolate; }
`;

    return {
      inject: ['slots'],
      apply(ctx) {
        const html = document.documentElement;
        const original = { dir: html.getAttribute('dir'), lang: html.getAttribute('lang') };

        let on = true;
        try {
          on = localStorage.getItem(STORE_KEY) !== 'off';
        } catch (err) {
          on = true; // storage blocked: keep the layer on, just not persistent
        }

        // One state, two faces: the shortcut and the settings row both call setOn.
        const listeners = new Set();

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

        function setOn(next) {
          const value = !!next;
          if (value === on) return;
          on = value;
          try {
            localStorage.setItem(STORE_KEY, on ? 'on' : 'off');
          } catch (err) {
            /* storage unavailable: the toggle still works for this page */
          }
          applyState();
          for (const listener of Array.from(listeners)) {
            try {
              listener(on);
            } catch (err) {
              /* a broken listener must not break the layer */
            }
          }
        }

        // Visible copy goes through the Client locale service, with English as
        // the fallback when that service or a dictionary is unavailable.
        let t = (key) => TEXT.en[key] || key;
        const locale = ctx.get('locale');
        if (locale && typeof locale.register === 'function' && typeof locale.bind === 'function') {
          try {
            const disposers = Object.keys(TEXT).map((id) => locale.register(NS, id, TEXT[id]));
            ctx.effect(() => () => {
              for (const dispose of disposers) {
                try {
                  dispose();
                } catch (err) {
                  /* already gone */
                }
              }
            }, 'rtl-bidi-locale');
            const bound = locale.bind(NS);
            t = (key) => {
              const text = bound(key);
              return text === key ? TEXT.en[key] || key : text;
            };
          } catch (err) {
            /* keep the English fallback */
          }
        }

        // ---- the preference row -------------------------------------------------
        // Measured against the host's own switches in the dark theme: 36x20, ON
        // track = brand-primary (#f9fafb), and the host's OFF switch ("Enable
        // Voice input") is a subtle track carrying a light knob. The token pairs
        // below reproduce that, so this control reads like a shipped one instead
        // of inventing its own contrast.
        const rowStyle = {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          minHeight: 40,
          padding: '8px 0',
          textAlign: 'start',
          // Must be inline: the layer's own `:where(div){unicode-bidi:plaintext}`
          // rule outranks a bare attribute selector, and without this the row's
          // base direction follows its label's language instead of the panel's.
          unicodeBidi: 'isolate',
        };
        const copyStyle = { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 };
        const labelStyle = {
          color: 'var(--dsw-alias-label-primary)',
          fontSize: 13,
          lineHeight: '18px',
        };
        const hintStyle = {
          color: 'var(--dsw-alias-label-secondary)',
          fontSize: 12,
          lineHeight: '16px',
        };
        const track = (active) => ({
          flex: '0 0 auto',
          boxSizing: 'border-box',
          width: 36,
          height: 20,
          padding: 2,
          borderRadius: 999,
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          background: active
            ? 'var(--dsw-alias-brand-primary)'
            : 'var(--dsw-alias-bg-layer-2)',
          border: '1px solid var(--dsw-alias-border-l2)',
        });
        const knob = (active) => ({
          width: 14,
          height: 14,
          borderRadius: '50%',
          // ON: the base background against the light brand track. OFF: the
          // secondary label colour — the light knob the host's OFF switch shows.
          background: active
            ? 'var(--dsw-alias-bg-base)'
            : 'var(--dsw-alias-label-secondary)',
          marginInlineStart: active ? 16 : 0, // logical: correct in RTL and LTR
        });

        function Row() {
          const [value, setValue] = React.useState(on);
          React.useEffect(() => {
            listeners.add(setValue);
            setValue(on); // resync if the shortcut moved the state before mount
            return () => listeners.delete(setValue);
          }, []);
          return h(
            'div',
            { 'data-rtl-bidi-row': '', style: rowStyle },
            h(
              'div',
              { style: copyStyle },
              h('span', { style: labelStyle }, t('label')),
              h('span', { style: hintStyle }, t('hint'))
            ),
            h(
              'button',
              {
                type: 'button',
                role: 'switch',
                'aria-checked': value,
                'aria-label': t('label'),
                title: t('hint'),
                'data-rtl-bidi-switch': value ? 'on' : 'off',
                onClick: () => setOn(!on),
                style: track(value),
              },
              h('span', { style: knob(value) })
            )
          );
        }

        const slots = ctx.slots;
        if (slots && typeof slots.inject === 'function' && typeof slots.register === 'function') {
          slots.inject('settings.general.item', () =>
            slots.register(
              { name: 'settings.general.item', id: 'rtl-bidi', order: ROW_ORDER },
              Row
            )
          );
        }

        // ---- the shortcut and the watcher --------------------------------------
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
            setOn(!on);
          }
        }

        window.addEventListener('keydown', onKey, true);
        watcher.observe(html, { attributes: true, attributeFilter: ['dir', 'lang'] });
        applyState();

        const teardown = () => {
          watcher.disconnect();
          window.removeEventListener('keydown', onKey, true);
          listeners.clear();
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