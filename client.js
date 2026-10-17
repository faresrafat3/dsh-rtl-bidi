/**
 * RTL + bidi layer for the Harness Web UI.
 *
 * Three properties, in this order of priority:
 *
 *  1. The layer always applies. It needs no service, no React and no slot: the
 *     style sheet, the root direction and the Alt+R shortcut are installed when
 *     the bundle script executes, before the module system materializes the
 *     factory. A missing service or an invalidated row may cost you the settings
 *     row; it can never cost you the layer.
 *  2. One state, two faces. Settings -> General -> "Right-to-left layout" and
 *     Alt+R write the same `dsh:rtl-bidi` value, and the row subscribes to it,
 *     so the switch and the shortcut cannot disagree.
 *  3. General and self-healing. It tracks whichever right-to-left language the
 *     page is actually in, re-asserts dir/lang/style if the app rewrites them,
 *     and puts the original markup back when disposed.
 *
 * Measured on the live page (2026-10-17, 1198x1417): <html lang="en"> with no
 * dir attribute, every element computing ltr and none fixing direction on its
 * own, so the root attribute mirrors the shell with no per-component override:
 * the first Arabic sidebar title moved x=40 -> x=963, the composer 380 -> 105,
 * overflowX stayed 0. A floating toggle was measured and rejected (the
 * bottom-end corner overlapped a 260x42 app trigger by 748 px^2), so the
 * additive settings row is the only seat that costs no pixels.
 */
const ID = '@fares/dsh-rtl-bidi';
const STORE_KEY = 'dsh:rtl-bidi';
const STYLE_ID = 'dsh-rtl-bidi-style';
const NS = 'fares-rtl-bidi';
const ROW_ORDER = 13; // between font-size (11) and developer-tools (15)
const DEFAULT_LANG = 'ar';
// Languages the layer will declare when the page is already in one of them.
const RTL_LANGS = ['ar', 'he', 'fa', 'ur', 'yi', 'dv', 'ps', 'sd', 'ug', 'ckb'];
const HANDLE = '__dshRtlBidiLayer';

const CSS = `html[dir="rtl"] { direction: rtl; }

html[dir="rtl"] body,
html[dir="rtl"] input,
html[dir="rtl"] textarea,
html[dir="rtl"] button {
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue",
    "Noto Naskh Arabic", "Noto Kufi Arabic", "Noto Sans Arabic", Tahoma, Arial, sans-serif;
}

/* Mixed Arabic/Latin: every block takes its base direction from its own first
   strong character, so an English paragraph stays LTR inside an RTL shell. */
html[dir="rtl"] :where(div, p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote) {
  unicode-bidi: plaintext;
}

/* Code, terminals and editors are never mirrored. */
html[dir="rtl"] :where(pre, code, kbd, samp, var, .monaco-editor, .cm-editor, .xterm, .CodeMirror) {
  direction: ltr !important;
  unicode-bidi: isolate !important;
}
html[dir="rtl"] :where(pre, .monaco-editor, .cm-editor, .xterm, .CodeMirror) {
  text-align: left !important;
}

/* The preference row keeps its column direction whatever language its copy is
   in; the html[dir] prefix is load-bearing, because :where() carries no weight
   and the rule above would otherwise outrank a bare attribute selector. */
html[dir="rtl"] [data-rtl-bidi-row] { unicode-bidi: isolate; }
`;

/** Install the layer. Services are not touched here, on purpose. */
function startLayer() {
  const existing = window[HANDLE];
  if (existing) return existing; // HMR re-evaluated the module: keep one layer

  const html = document.documentElement;
  const original = { dir: html.getAttribute('dir'), lang: html.getAttribute('lang') };
  const listeners = new Set();
  let lang = DEFAULT_LANG;
  let on = true;
  try {
    on = localStorage.getItem(STORE_KEY) !== 'off';
  } catch (err) {
    on = true; // storage blocked: the layer still works, it just cannot persist
  }

  const host = () => document.head || html;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  // Pre-tagged, the way a preset-emitted tag arrives: the module system's census
  // claims every untagged <style> for whichever plugin happens to materialize
  // next, and would then delete this one when that unrelated plugin is
  // invalidated. Claiming it ourselves keeps it out of that cross-fire; the
  // watcher below re-appends it if the loader removes it for us.
  style.setAttribute('data-plugin', ID);
  style.textContent = CSS;
  host().appendChild(style);

  const put = (el, name, value) => {
    if (value === null) el.removeAttribute(name);
    else el.setAttribute(name, value);
  };

  function paint() {
    if (on) {
      if (html.getAttribute('dir') !== 'rtl') html.setAttribute('dir', 'rtl');
      if (html.getAttribute('lang') !== lang) html.setAttribute('lang', lang);
    } else {
      put(html, 'dir', original.dir);
      put(html, 'lang', original.lang);
    }
    html.dataset.dshRtlBidi = on ? 'on' : 'off'; // machine-checkable marker
    if (!document.getElementById(STYLE_ID)) host().appendChild(style);
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
    paint();
    for (const listener of Array.from(listeners)) {
      try {
        listener(on);
      } catch (err) {
        /* a broken listener must not break the layer */
      }
    }
  }

  // The locale service decides which RTL language to declare, when the page is
  // already in one. An English UI keeps the Arabic default.
  function setLang(next) {
    const base = String(next || '').split('-')[0].toLowerCase();
    if (!RTL_LANGS.includes(base) || base === lang) return;
    lang = base;
    paint();
  }

  function onKey(event) {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.code === 'KeyR' || event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      setOn(!on);
    }
  }

  // The app is free to rewrite <html> (it resets lang="en" on boot) and to drop
  // our style sheet; re-assert both whenever either drifts.
  const watcher = new MutationObserver(() => {
    if ((html.getAttribute('dir') || null) !== (on ? 'rtl' : original.dir) ||
        (html.getAttribute('lang') || null) !== (on ? lang : original.lang) ||
        !document.getElementById(STYLE_ID)) {
      paint();
    }
  });
  watcher.observe(html, { attributes: true, attributeFilter: ['dir', 'lang'] });
  const head = document.head;
  if (head) watcher.observe(head, { childList: true });
  window.addEventListener('keydown', onKey, true);
  paint();

  const layer = {
    get on() {
      return on;
    },
    setOn,
    setLang,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      watcher.disconnect();
      window.removeEventListener('keydown', onKey, true);
      listeners.clear();
      style.remove();
      put(html, 'dir', original.dir);
      put(html, 'lang', original.lang);
      delete html.dataset.dshRtlBidi;
      delete window[HANDLE];
    },
  };
  window[HANDLE] = layer;
  return layer;
}

/** Record what the optional row did on <html>, so the state stays readable from
 *  outside the page even when the row itself never renders. */
function mark(value) {
  try {
    document.documentElement.dataset.dshRtlBidiRow = value;
  } catch (err) {
    /* nothing to record */
  }
}

/** Read a client service however this harness hands it over: as a bound ctx
 *  member (what a declared inject resolves to) or through ctx.get. Accepting
 *  both is what keeps the row independent of the injection style. */
function service(ctx, name) {
  try {
    if (ctx && ctx[name]) return ctx[name];
    if (ctx && typeof ctx.get === 'function') return ctx.get(name);
  } catch (err) {
    /* treat as absent */
  }
  return null;
}

/** The optional UI contribution: a preference row. Every step is guarded, so a
 *  missing React, locale or slots service costs the row and nothing else. */
function mountRow(layer, require, ctx) {
  let React;
  try {
    React = require('react');
  } catch (err) {
    mark('skipped:no-react');
    return false; // no React in this page's module table: skip the row only
  }
  if (!React || typeof React.createElement !== 'function') {
    mark('skipped:no-react');
    return false;
  }

  const slots = service(ctx, 'slots');
  if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
    mark('skipped:no-slots');
    return false;
  }

  const h = React.createElement;
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

  let t = (key) => TEXT.en[key] || key;
  const locale = service(ctx, 'locale');
  if (locale && typeof locale.register === 'function' && typeof locale.bind === 'function') {
    try {
      const dispose = Object.keys(TEXT).map((id) => locale.register(NS, id, TEXT[id]));
      layer.onDispose.push(() => dispose.forEach((fn) => { try { fn(); } catch (err) {} }));
      const bound = locale.bind(NS);
      t = (key) => {
        const text = bound(key);
        return text === key ? TEXT.en[key] || key : text;
      };
    } catch (err) {
      /* keep the English fallback */
    }
  }

  // Measured against the host's own switches in the dark theme: 36x20, ON track
  // = brand-primary (#f9fafb), and the host's OFF switch is a subtle track with
  // a light knob. These token pairs reproduce that instead of inventing
  // contrast; the row's own unicode-bidi stays inline, because the layer's
  // :where(div) rule would otherwise base the row on its label's language.
  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 40,
    padding: '8px 0',
    textAlign: 'start',
    unicodeBidi: 'isolate',
  };
  const copyStyle = { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 };
  const labelStyle = { color: 'var(--dsw-alias-label-primary)', fontSize: 13, lineHeight: '18px' };
  const hintStyle = { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: '16px' };
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
    background: active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-layer-2)',
    border: '1px solid var(--dsw-alias-border-l2)',
  });
  const knob = (active) => ({
    width: 14,
    height: 14,
    borderRadius: '50%',
    background: active ? 'var(--dsw-alias-bg-base)' : 'var(--dsw-alias-label-secondary)',
    marginInlineStart: active ? 16 : 0, // logical: correct in RTL and LTR
  });

  function Row() {
    const [value, setValue] = React.useState(layer.on);
    React.useEffect(() => {
      setValue(layer.on); // resync if the shortcut moved the state before mount
      return layer.subscribe(setValue);
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
          onClick: () => layer.setOn(!layer.on),
          style: track(value),
        },
        h('span', { style: knob(value) })
      )
    );
  }

  slots.inject('settings.general.item', () =>
    slots.register({ name: 'settings.general.item', id: 'rtl-bidi', order: ROW_ORDER }, Row)
  );
  mark('registered');
  return true;
}

// The layer is installed when this script executes, not when the module system
// materializes the factory. Measured on the live page: the loader calls a
// factory lazily, so a row that is invalidated, still arriving, or waiting for
// activation never materializes — installed from inside the factory the layer
// was simply absent, with no residue explaining why. Executing the script is the
// one event that always happens, so it is the only safe place for a page-wide
// preference the user set once and expects to hold.
const layer = startLayer();
layer.onDispose = [];

window.__ModuleLoader__.load({
  id: ID,
  factory(require) {
    return {
      // Declared for the row only. Measured: in this harness the slot service is
      // reachable as ctx.slots only when the module declares it, and the row
      // cannot mount without it. The layer is installed before this face is read,
      // so a dependency that never resolves costs the row and nothing else.
      inject: ['slots'],
      apply(ctx) {
        mark('applying');
        // Which language to declare is a property of the layer, not of the row:
        // it follows the page's own locale even when no row can be mounted.
        try {
          const locale = service(ctx, 'locale');
          if (locale && typeof locale.getLocale === 'function') layer.setLang(locale.getLocale());
        } catch (err) {
          /* the layer keeps its default language */
        }
        try {
          mountRow(layer, require, ctx);
        } catch (err) {
          mark('error');
          /* the row is optional; the layer does not depend on it */
        }
        // This fiber owns the row alone: the layer outlives an invalidation, so
        // a hot reload cannot blink the user's choice off. Use the layer's own
        // dispose() to take the layer down.
        const teardown = () => {
          for (const dispose of layer.onDispose) {
            try {
              dispose();
            } catch (err) {
              /* already gone */
            }
          }
          layer.onDispose.length = 0;
        };
        // ctx.effect runs this callback immediately and keeps its RETURN value as
        // the disposer (cordis/lib/index.js:1142), so the cleanup has to be
        // returned, not passed: passing it runs the teardown on the spot and
        // registers no disposer at all.
        if (ctx && typeof ctx.effect === 'function') ctx.effect(() => teardown, 'dsh-rtl-bidi');
        else return teardown;
      },
    };
  },
});