/* rtl-probe.js — measure the RTL/bidi layer on a live Harness page.
 *
 * Paste the whole file into the DevTools console on http://127.0.0.1:3080 and
 * compare the returned object with the expected values in README.md. It only
 * reads; to test the toggle it can dispatch Alt+R, which is stated in the
 * report as `toggleWorked`.
 *
 * The caller's own client (browser, CDP) needs no cooperation from the plugin:
 * the three markers below are the layer's whole observable surface.
 */
(() => {
  const html = document.documentElement;
  const cs = (el) => getComputedStyle(el);
  const report = {};

  // 1. the layer is mounted, and it says how far it got
  const style = document.getElementById('dsh-rtl-bidi-style');
  report.installed = {
    stylesheet: !!style,
    sheetOwner: style ? style.dataset.plugin || null : null, // expected '@fares/dsh-rtl-bidi'
    marker: html.dataset.dshRtlBidi || null, // 'on' / 'off'
    rowState: html.dataset.dshRtlBidiRow || null, // 'registered' / 'skipped:no-react' / 'skipped:no-slots'
    store: localStorage.getItem('dsh:rtl-bidi'), // 'on' / 'off' / null
    handle: !!window.__dshRtlBidiLayer,
    dir: html.getAttribute('dir'),
    lang: html.getAttribute('lang'),
    fontHasArabicFamily: /Noto (Naskh|Kufi|Sans) Arabic/.test(cs(document.body).fontFamily),
  };
  if (!style) return { installed: report.installed, note: 'plugin not loaded in this page' };

  // 2. the whole shell flipped, minus the surfaces that must not
  let ltr = 0;
  let rtl = 0;
  const ltrExamples = [];
  for (const el of document.querySelectorAll('*')) {
    if (cs(el).direction === 'rtl') rtl++;
    else {
      ltr++;
      if (ltrExamples.length < 5) {
        ltrExamples.push(el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).slice(0, 24) : ''));
      }
    }
  }
  report.direction = { rtl, ltr, ltrExamples, total: rtl + ltr };
  report.layout = { overflowX: html.scrollWidth - html.clientWidth, viewport: [innerWidth, innerHeight] };

  // 3. code and editors stay left-to-right
  report.codeSurfaces = [...document.querySelectorAll('pre, code')].slice(0, 4).map((el) => ({
    tag: el.tagName.toLowerCase(),
    direction: cs(el).direction,
    unicodeBidi: cs(el).unicodeBidi,
  }));

  // 4. the composer follows what you type, per paragraph
  const composer = document.querySelector('div[contenteditable="true"][role="textbox"]');
  report.composer = composer
    ? { direction: cs(composer).direction, unicodeBidi: cs(composer).unicodeBidi }
    : null;

  // 5. the plugin adds no element of its own (no overlay to collide with)
  report.addedElements = [...document.querySelectorAll('[id^="dsh-rtl"]')].map((el) => el.id);

  // 6. the settings row, when Settings is open. `rowState` above already tells
  //    you whether it registered; these are its live geometry and theme colors.
  const row = document.querySelector('[data-rtl-bidi-row]');
  const sw = document.querySelector('[data-rtl-bidi-switch]');
  report.settingsRow = row
    ? {
        unicodeBidi: cs(row).unicodeBidi,
        direction: cs(row).direction,
        rect: (r) => [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)](row.getBoundingClientRect()),
        label: (row.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      }
    : 'open Settings → General first';
  report.settingsSwitch = sw
    ? {
        role: sw.getAttribute('role'),
        ariaChecked: sw.getAttribute('aria-checked'),
        size: (() => { const r = sw.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
        track: cs(sw).backgroundColor,
        knob: cs(sw.firstElementChild).backgroundColor,
        knobTravel: cs(sw.firstElementChild).marginInlineStart,
      }
    : null;

  // 7. Alt+R flips both attributes, and the layer re-asserts itself
  const before = { dir: html.getAttribute('dir'), lang: html.getAttribute('lang') };
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', altKey: true, bubbles: true }));
  const off = { dir: html.getAttribute('dir'), lang: html.getAttribute('lang'), marker: html.dataset.dshRtlBidi };
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', altKey: true, bubbles: true }));
  report.toggle = {
    before,
    afterAltR: off,
    restored: { dir: html.getAttribute('dir'), lang: html.getAttribute('lang'), marker: html.dataset.dshRtlBidi },
  };

  // 8. the app rewrites <html>; the layer must come back on its own
  html.setAttribute('dir', 'ltr');
  html.setAttribute('lang', 'en');
  setTimeout(() => {
    window.__rtlProbeHeal = { dir: html.getAttribute('dir'), lang: html.getAttribute('lang') };
  }, 250);
  report.selfHealing = 'see window.__rtlProbeHeal after ~300ms (expected rtl/ar)';
  // Every frame the page holds: entered means the layer is inside it; told is the
  // state it was sent; ack is the state the frame itself confirmed. A cross-origin
  // plugin panel (the Documents panel serves from its own origin) can only ever
  // appear here as told+ack — that is the whole point of the bridge.
  const layer = window.__dshRtlBidiLayer;
  report.frames = layer && typeof layer.frames === 'function' ? layer.frames() : null;

  return report;
})()
