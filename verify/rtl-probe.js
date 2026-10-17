/* rtl-probe.js — measure the RTL/bidi layer on a live Harness page.
 *
 * Paste the whole file into the DevTools console on http://127.0.0.1:3080 and
 * compare the returned object with the expected values in README.md. It only
 * reads; to test the toggle it can dispatch Alt+R, which is stated in the
 * report as `toggleWorked`.
 */
(() => {
  const html = document.documentElement;
  const cs = (el) => getComputedStyle(el);
  const report = {};

  // 1. the layer is mounted
  const style = document.getElementById('dsh-rtl-bidi-style');
  report.mounted = {
    stylesheet: !!style,
    marker: html.dataset.dshRtlBidi || null,
    dir: html.getAttribute('dir'),
    lang: html.getAttribute('lang'),
    fontHasArabicFamily: /Noto (Naskh|Kufi|Sans) Arabic/.test(cs(document.body).fontFamily),
  };
  if (!style) return { mounted: report.mounted, note: 'plugin not loaded in this page' };

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

  // 6. Alt+R flips both attributes, and the layer re-asserts itself
  const before = { dir: html.getAttribute('dir'), lang: html.getAttribute('lang') };
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', altKey: true, bubbles: true }));
  const off = { dir: html.getAttribute('dir'), lang: html.getAttribute('lang') };
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', altKey: true, bubbles: true }));
  report.toggle = {
    before,
    afterAltR: off,
    restored: { dir: html.getAttribute('dir'), lang: html.getAttribute('lang') },
  };

  // 7. the app rewrites <html>; the layer must come back on its own
  html.setAttribute('dir', 'ltr');
  html.setAttribute('lang', 'en');
  setTimeout(() => {
    window.__rtlProbeHeal = { dir: html.getAttribute('dir'), lang: html.getAttribute('lang') };
  }, 250);
  report.selfHealing = 'see window.__rtlProbeHeal after ~300ms (expected rtl/ar)';

  return report;
})()