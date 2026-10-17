/**
 * Tests for the Client half, run with `node --test tests/` (no dependencies).
 *
 * The module is evaluated inside a vm sandbox with a stub DOM, and `require` is
 * supplied by the test, so a fault can be injected where the live page cannot be
 * forced into one: React missing from the module table, the slots service
 * absent, storage refusing to answer.
 *
 * The property under test is the one the plugin exists for: the layer applies
 * and survives, whatever else is missing.
 */
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const STYLE_ID = 'dsh-rtl-bidi-style';

function element(tag) {
  const attrs = new Map();
  const node = {
    tagName: tag.toUpperCase(),
    id: '',
    textContent: '',
    dataset: {},
    children: [],
    parent: null,
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => attrs.set(name, String(value)),
    removeAttribute: (name) => attrs.delete(name),
    appendChild(child) {
      child.parent = node;
      node.children.push(child);
      return child;
    },
    removeChild(child) {
      node.children.splice(node.children.indexOf(child), 1);
      return child;
    },
    remove() {
      if (node.parent) node.parent.removeChild(node);
      node.removed = true;
    },
  };
  return node;
}

function fakeReact() {
  const seen = { setValue: [], cleanup: null };
  return {
    seen,
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => {
      let current = initial;
      return [current, (next) => {
        current = typeof next === 'function' ? next(current) : next;
        seen.setValue.push(current);
      }];
    },
    useEffect: (fn) => { seen.cleanup = fn(); },
  };
}

function makeDom({ storageThrows = false, stored = null, htmlLang = null } = {}) {
  const html = element('html');
  if (htmlLang !== null) html.setAttribute('lang', htmlLang);
  const head = element('head');
  const document = {
    documentElement: html,
    head,
    createElement: (tag) => element(tag),
    getElementById: (id) => head.children.find((child) => child.id === id) || null,
  };
  const store = new Map();
  if (stored !== null) store.set('dsh:rtl-bidi', stored);
  const localStorage = {
    getItem(key) {
      if (storageThrows) throw new Error('storage blocked');
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      if (storageThrows) throw new Error('storage blocked');
      store.set(key, String(value));
    },
  };
  const observers = [];
  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = [];
      this.disconnected = false;
      observers.push(this);
    }
    observe(target) { this.targets.push(target); }
    disconnect() { this.disconnected = true; }
    fire() { if (!this.disconnected) this.callback([]); }
  }
  const handlers = { keydown: [] };
  let loaded = null;
  const window = {
    __ModuleLoader__: { load: (mod) => { loaded = mod; } },
    addEventListener: (type, fn) => handlers[type]?.push(fn),
    removeEventListener: (type, fn) => {
      const list = handlers[type] || [];
      const index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    },
    handlers,
  };
  return { window, document, localStorage, MutationObserver, observers, html, head, store, handlers, get loaded() { return loaded; } };
}

function boot(options = {}) {
  const dom = makeDom(options);
  const sandbox = {
    window: dom.window,
    document: dom.document,
    localStorage: dom.localStorage,
    MutationObserver: dom.MutationObserver,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  assert.ok(dom.loaded, 'the module registered itself with __ModuleLoader__');
  return dom;
}

/** Ctx stub; `slots: true` records the registration instead of providing it. */
function makeCtx({ slots = false, locale = null } = {}) {
  const disposers = [];
  const registered = [];
  const injected = [];
  const ctx = {
    // Mirrors the harness: effect() runs the callback now and keeps its RETURN
    // value as the disposer (cordis/lib/index.js:1142). A stub that stores the
    // callback itself would pass code that never cleans anything up.
    effect: (fn) => { const disposer = fn(); if (typeof disposer === 'function') disposers.push(disposer); },
    get: (name) => {
      if (name === 'slots' && slots) {
        return {
          inject: (key, cb) => injected.push({ key, cb }),
          register: (options, component) => { registered.push({ options, component }); return { options, component }; },
        };
      }
      if (name === 'locale' && locale) return locale;
      return undefined;
    },
  };
  return { ctx, disposers, registered, injected, dispose: () => disposers.forEach((fn) => fn()) };
}

const reactRequire = () => { const react = fakeReact(); const stub = () => react; stub.react = react; return stub; };
const noReactRequire = () => () => { throw new Error('Cannot find module react'); };

function altR(window) {
  const event = { altKey: true, ctrlKey: false, metaKey: false, code: 'KeyR', key: 'r', prevented: false, preventDefault() { event.prevented = true; } };
  for (const handler of window.handlers.keydown) handler(event);
  return event;
}

test('the layer is up before the module face is read, so inject cannot gate it', () => {
  const dom = boot();
  assert.equal(Object.keys(dom.loaded).sort().join(','), 'factory,id', 'the registration carries nothing else');
  assert.equal(dom.html.getAttribute('dir'), 'rtl');
  const face = dom.loaded.factory(reactRequire());
  assert.equal(face.inject.join(','), 'slots', 'the row declares the one service it needs');
  assert.equal(dom.html.getAttribute('dir'), 'rtl', 'reading the face changed nothing');
});

test('the layer is installed when the bundle script executes, before any factory call', () => {
  const dom = boot();
  // No factory call, no apply, no React and no service: the script alone must
  // be enough. This is the regression the live page produced: installed from
  // inside the factory, the layer was absent because the loader materializes
  // factories lazily and an invalidated row never materializes at all.
  assert.equal(dom.html.getAttribute('dir'), 'rtl');
  assert.equal(dom.html.getAttribute('lang'), 'ar');
  assert.equal(dom.html.dataset.dshRtlBidi, 'on');
  assert.ok(dom.document.getElementById(STYLE_ID), 'the style sheet is installed');
  assert.match(dom.document.getElementById(STYLE_ID).textContent, /unicode-bidi: plaintext/);
  assert.equal(typeof dom.window.__dshRtlBidiLayer.setOn, 'function');
  assert.equal(dom.window.handlers.keydown.length, 1, 'the shortcut is armed');
});

test('a missing React costs the row and nothing else', () => {
  const dom = boot();
  const mod = dom.loaded.factory(noReactRequire());
  const state = makeCtx({ slots: true });
  mod.apply(state.ctx);
  assert.equal(dom.html.getAttribute('dir'), 'rtl');
  assert.equal(state.registered.length, 0, 'no row without React');
});

test('a missing slots service costs the row and nothing else', () => {
  const dom = boot();
  const mod = dom.loaded.factory(reactRequire());
  const state = makeCtx({ slots: false });
  assert.doesNotThrow(() => mod.apply(state.ctx));
  assert.equal(dom.html.getAttribute('dir'), 'rtl');
  assert.equal(state.registered.length, 0);
});

test('with slots the row registers into the settings seat and is inert until the slot asks', () => {
  const dom = boot();
  const mod = dom.loaded.factory(reactRequire());
  const state = makeCtx({ slots: true });
  mod.apply(state.ctx);
  assert.equal(state.injected.length, 1);
  assert.equal(state.injected[0].key, 'settings.general.item');
  assert.equal(state.registered.length, 0, 'registration is lazy');
  state.injected[0].cb();
  assert.equal(state.registered.length, 1);
  // Field by field: the options object is made inside the vm realm, so a
  // deep-equal across realms fails on prototypes rather than on values.
  const options = state.registered[0].options;
  assert.equal(options.name, 'settings.general.item');
  assert.equal(options.id, 'rtl-bidi');
  assert.equal(options.order, 13);
  assert.equal(typeof state.registered[0].component, 'function');
});

test('the row mounts when the harness binds services on ctx instead of ctx.get', () => {
  const dom = boot();
  const mod = dom.loaded.factory(reactRequire());
  const registered = [];
  const injected = [];
  const ctx = {
    effect: () => {},
    // No ctx.get at all: only the bound member, which is the shape a declared
    // inject gives. This is the live regression: the row was absent with no
    // error anywhere while the plugin called ctx.get('slots') alone.
    slots: {
      inject: (key, cb) => injected.push({ key, cb }),
      register: (options, component) => { registered.push({ options, component }); return {}; },
    },
  };
  mod.apply(ctx);
  assert.equal(injected.length, 1, 'the row reached the slot through ctx.slots');
  injected[0].cb();
  assert.equal(registered.length, 1);
  assert.equal(registered[0].options.id, 'rtl-bidi');
});

test('blocked storage does not stop the layer', () => {
  const dom = boot({ storageThrows: true });
  dom.loaded.factory(reactRequire());
  assert.equal(dom.html.getAttribute('dir'), 'rtl');
  assert.equal(dom.html.dataset.dshRtlBidi, 'on');
});

test('Alt+R toggles, persists, and restores the original markup', () => {
  const dom = boot();
  dom.loaded.factory(reactRequire());
  assert.equal(altR(dom.window).prevented, true);
  assert.equal(dom.html.getAttribute('dir'), null);
  assert.equal(dom.html.getAttribute('lang'), null);
  assert.equal(dom.html.dataset.dshRtlBidi, 'off');
  assert.equal(dom.store.get('dsh:rtl-bidi'), 'off');
  altR(dom.window);
  assert.equal(dom.html.getAttribute('dir'), 'rtl');
  assert.equal(dom.html.dataset.dshRtlBidi, 'on');
});

test('an earlier "off" choice is honoured on the next boot', () => {
  const dom = boot({ stored: 'off' });
  dom.loaded.factory(reactRequire());
  assert.equal(dom.html.getAttribute('dir'), null);
  assert.equal(dom.html.dataset.dshRtlBidi, 'off');
  assert.ok(dom.document.getElementById(STYLE_ID), 'the sheet still loads, it just is not applied');
});

test('the watcher re-asserts whatever the app rewrites, and re-installs the sheet', () => {
  const dom = boot();
  dom.loaded.factory(reactRequire());
  const watcher = dom.observers.at(-1);
  dom.html.setAttribute('lang', 'en');
  dom.html.setAttribute('dir', 'ltr');
  dom.document.getElementById(STYLE_ID).remove();
  watcher.fire();
  assert.equal(dom.html.getAttribute('dir'), 'rtl');
  assert.equal(dom.html.getAttribute('lang'), 'ar');
  assert.ok(dom.document.getElementById(STYLE_ID), 'the sheet came back');
});

test('the declared language follows an RTL locale and ignores a Latin one', () => {
  const dom = boot();
  const mod = dom.loaded.factory(reactRequire());
  const locale = { register: () => () => {}, bind: () => (key) => key, getLocale: () => 'he-IL' };
  mod.apply(makeCtx({ slots: false, locale }).ctx);
  assert.equal(dom.html.getAttribute('lang'), 'he');
  const dom2 = boot();
  dom2.loaded.factory(reactRequire()).apply(
    makeCtx({ locale: { register: () => () => {}, bind: () => (key) => key, getLocale: () => 'en-US' } }).ctx
  );
  assert.equal(dom2.html.getAttribute('lang'), 'ar', 'a Latin locale keeps the Arabic default');
});

test('the row subscribes to the same state the shortcut writes', () => {
  const dom = boot();
  const require = reactRequire();
  const mod = dom.loaded.factory(require);
  const state = makeCtx({ slots: true });
  mod.apply(state.ctx);
  state.injected[0].cb();
  const react = require.react;
  const tree = state.registered[0].component();
  assert.equal(tree.props['data-rtl-bidi-row'], '');
  const button = tree.children[1];
  assert.equal(button.props.role, 'switch');
  assert.equal(button.props['aria-checked'], true);
  assert.equal(button.props['data-rtl-bidi-switch'], 'on');
  button.props.onClick();
  assert.equal(button.props['data-rtl-bidi-switch'], 'on', 'props are from the last render');
  // [true, false]: the mount resyncs, then the click reports the new state.
  assert.deepEqual(react.seen.setValue, [true, false]);
  assert.equal(react.seen.setValue.at(-1), false, 'the row was told about the new state');
  assert.equal(dom.html.dataset.dshRtlBidi, 'off');
});

test('a fiber teardown keeps the layer and drops only its own row', () => {
  const dom = boot();
  const mod = dom.loaded.factory(reactRequire());
  const state = makeCtx({ slots: true });
  mod.apply(state.ctx);
  assert.equal(dom.html.getAttribute('dir'), 'rtl');
  assert.equal(state.disposers.length, 1, 'effect kept the returned disposer, not the callback itself');
  state.dispose();
  assert.equal(dom.html.getAttribute('dir'), 'rtl', 'the layer outlives the plugin fiber');
  assert.equal(dom.html.dataset.dshRtlBidi, 'on');
  assert.ok(dom.document.getElementById(STYLE_ID), 'the sheet survives an invalidation');
  assert.equal(dom.window.handlers.keydown.length, 1, 'the shortcut survives too');
});

test('the layer has its own dispose, and it puts the page back', () => {
  const dom = boot({ htmlLang: 'en' });
  assert.equal(dom.html.getAttribute('dir'), 'rtl');
  dom.window.__dshRtlBidiLayer.dispose();
  assert.equal(dom.html.getAttribute('dir'), null);
  assert.equal(dom.html.getAttribute('lang'), 'en');
  assert.equal(dom.html.dataset.dshRtlBidi, undefined);
  assert.equal(dom.document.getElementById(STYLE_ID), null);
  assert.equal(dom.window.handlers.keydown.length, 0);
});