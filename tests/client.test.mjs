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

/** A frame is a document of its own, which is the whole point of these tests:
 *  a same-origin one can be entered, a different origin refuses the read. */
function frameDoc({ dir = null, lang = null } = {}) {
  const root = element('html');
  if (dir !== null) root.setAttribute('dir', dir);
  if (lang !== null) root.setAttribute('lang', lang);
  const head = element('head');
  const doc = {
    documentElement: root,
    head,
    createElement: (tag) => element(tag),
    getElementById: (id) => head.children.find((child) => child.id === id) || null,
  };
  return { doc, root, head };
}

function frameElement({ doc = null, crossOrigin = false, src = 'about:blank' } = {}) {
  const el = element('iframe');
  el.setAttribute('src', src);
  const posted = [];
  const frameHandlers = { keydown: [] };
  const win = {
    addEventListener: (type, fn) => frameHandlers[type]?.push(fn),
    removeEventListener: (type, fn) => {
      const list = frameHandlers[type] || [];
      const index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    },
    postMessage: (data) => posted.push(data),
  };
  let current = doc;
  Object.defineProperty(el, 'contentDocument', {
    get() {
      if (crossOrigin) throw new Error('cross-origin: refused');
      return current;
    },
  });
  Object.defineProperty(el, 'contentWindow', { get: () => win });
  el.posted = posted;
  el.frameHandlers = frameHandlers;
  el.win = win;
  el.navigate = (next) => { current = next; };
  return el;
}

function makeDom({ storageThrows = false, stored = null, htmlLang = null, frames = [] } = {}) {
  const html = element('html');
  if (htmlLang !== null) html.setAttribute('lang', htmlLang);
  const head = element('head');
  const document = {
    documentElement: html,
    head,
    createElement: (tag) => element(tag),
    getElementById: (id) => head.children.find((child) => child.id === id) || null,
    getElementsByTagName: (tag) => (tag === 'iframe' ? frames : []),
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
  const handlers = { keydown: [], message: [], load: [] };
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
  return { window, document, localStorage, MutationObserver, observers, html, head, store, handlers, frames, get loaded() { return loaded; } };
}

function boot(options = {}) {
  const dom = makeDom(options);
  const sandbox = {
    window: dom.window,
    document: dom.document,
    MutationObserver: dom.MutationObserver,
    console,
  };
  if (options.storageAccessThrows) {
    // A sandboxed iframe (sandbox without allow-same-origin) or a null-origin
    // document refuses the storage itself: reading localStorage throws a
    // SecurityError before any method on it can be reached. A throwing global
    // getter is not reachable by the bare identifier inside a node:vm context
    // (measured: `typeof localStorage` is undefined even with the accessor
    // present, though `"localStorage" in globalThis` is true), so the refusal
    // is modelled as a proxy that throws on every access — the same observable
    // contract for the code under test.
    const securityError = () => {
      const err = new Error("SecurityError: Failed to read the 'localStorage' property from 'Window': Access is denied for this document.");
      err.name = 'SecurityError';
      return err;
    };
    sandbox.localStorage = new Proxy({}, {
      get() { throw securityError(); },
      set() { throw securityError(); },
    });
  } else {
    sandbox.localStorage = dom.localStorage;
  }
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

test('a refused localStorage property (sandboxed frame, null origin) costs persistence and nothing else', () => {
  // A sandboxed iframe (sandbox without allow-same-origin) or a null-origin
  // document refuses the storage property itself, before getItem can be
  // reached. The layer must still install from its default, and the toggle
  // must still work without persisting: the refusal is on the read and on the
  // write alike.
  const dom = boot({ storageAccessThrows: true });
  dom.loaded.factory(reactRequire());
  assert.equal(dom.html.getAttribute('dir'), 'rtl');
  assert.equal(dom.html.getAttribute('lang'), 'ar');
  assert.equal(dom.html.dataset.dshRtlBidi, 'on');
  assert.ok(dom.document.getElementById(STYLE_ID), 'the sheet is installed');
  assert.doesNotThrow(() => altR(dom.window), 'the toggle survives a storage that refuses writes too');
  assert.equal(dom.html.dataset.dshRtlBidi, 'off');
  assert.equal(dom.html.getAttribute('dir'), null);
  assert.equal(dom.html.getAttribute('lang'), null);
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

test('a bound member that throws still falls through to the optional lookup', () => {
  const dom = boot();
  const mod = dom.loaded.factory(reactRequire());
  const registered = [];
  const ctx = {
    effect: () => {},
    // Real cordis throws exactly here when the module declares no inject, and
    // this must not swallow the ctx.get fallback with it.
    get slots() { throw new Error('cannot get property slots without inject'); },
    get: (name) => (name === 'slots'
      ? { inject: (key, cb) => cb(), register: (options, component) => { registered.push({ options, component }); return {}; } }
      : undefined),
  };
  mod.apply(ctx);
  assert.equal(registered.length, 1, 'the row mounted through ctx.get even though ctx.slots threw');
  assert.equal(dom.html.dataset.dshRtlBidiRow, 'registered');
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

// --- frames: a plugin surface rendered in an iframe is a document of its own --

test('a same-origin frame is entered and painted like the shell', () => {
  const frame = frameElement({ doc: frameDoc().doc, src: 'http://127.0.0.1:3080/preview' });
  const dom = boot({ frames: [frame] });
  const inner = frame.contentDocument;
  assert.equal(inner.documentElement.getAttribute('dir'), 'rtl', 'the frame root mirrors the shell');
  assert.equal(inner.documentElement.dataset.dshRtlBidi, 'on');
  assert.ok(inner.getElementById(STYLE_ID), 'the same sheet is installed inside the frame');
  assert.equal(dom.window.__dshRtlBidiLayer.frames()[0].entered, true);

  altR(dom.window); // the shell's shortcut turns the frame off with it
  assert.equal(inner.documentElement.getAttribute('dir'), null, 'the frame keeps its own original dir');
  // The sheet stays, exactly as it does in the shell: every rule in it is scoped
  // to html[dir="rtl"], so with the attribute gone it is inert, not wrong.
  assert.ok(inner.getElementById(STYLE_ID), 'the sheet stays installed and inert');
  assert.equal(inner.documentElement.dataset.dshRtlBidi, 'off');
});

test('the shortcut works from inside an entered frame', () => {
  const frame = frameElement({ doc: frameDoc({ dir: 'ltr', lang: 'en' }).doc });
  const dom = boot({ frames: [frame] });
  const inner = frame.contentDocument;
  assert.equal(inner.documentElement.getAttribute('dir'), 'rtl');
  const event = { altKey: true, ctrlKey: false, metaKey: false, code: 'KeyR', key: 'r', prevented: false, preventDefault() { event.prevented = true; } };
  for (const handler of frame.frameHandlers.keydown) handler(event);
  assert.equal(inner.documentElement.getAttribute('dir'), 'ltr', 'the frame is back to its own original');
  assert.equal(inner.documentElement.getAttribute('lang'), 'en');
  assert.equal(dom.html.getAttribute('dir'), null, 'and the shell followed: one state, both faces');
});

test('a cross-origin frame cannot be entered, so it is told instead', () => {
  const frame = frameElement({ crossOrigin: true, src: 'http://127.0.0.1:8890/' });
  const dom = boot({ frames: [frame] });
  const layer = dom.window.__dshRtlBidiLayer;
  // Cross-realm: the layer builds these inside the vm context, so compare values.
  const last = JSON.parse(JSON.stringify(frame.posted[frame.posted.length - 1]));
  assert.deepEqual(last, { type: 'dsh-rtl-bidi', on: true, lang: 'ar' }, 'the state is posted, not injected');
  assert.deepEqual(JSON.parse(JSON.stringify(layer.frames()[0])), {
    src: 'http://127.0.0.1:8890/', entered: false, dir: null, told: { on: true, lang: 'ar' }, ack: null,
  });
  frame.posted.length = 0;
  altR(dom.window);
  const off = JSON.parse(JSON.stringify(frame.posted.filter((m) => m.type === 'dsh-rtl-bidi')[0]));
  assert.deepEqual(off, { type: 'dsh-rtl-bidi', on: false, lang: 'ar' }, 'a toggle reaches the frame it cannot enter');
});

test('a frame may ask for the state, and the layer answers it', () => {
  const frame = frameElement({ crossOrigin: true, src: 'http://127.0.0.1:8890/' });
  const dom = boot({ frames: [frame] });
  frame.posted.length = 0;
  for (const handler of dom.window.handlers.message) handler({ data: { type: 'dsh-rtl-bidi:hello' }, source: frame.win });
  const answer = JSON.parse(JSON.stringify(frame.posted[frame.posted.length - 1]));
  assert.deepEqual(answer, { type: 'dsh-rtl-bidi', on: true, lang: 'ar' }, 'the answer carries the current state');
});

test('an ack is recorded, and a foreign message cannot move the layer', () => {
  const frame = frameElement({ crossOrigin: true, src: 'http://127.0.0.1:8890/' });
  const dom = boot({ frames: [frame] });
  const layer = dom.window.__dshRtlBidiLayer;
  for (const handler of dom.window.handlers.message) {
    handler({ data: { type: 'dsh-rtl-bidi:ack', on: false, dir: 'ltr' }, source: frame.win });
    handler({ data: { type: 'not-ours', on: false }, source: frame.win });
  }
  assert.deepEqual(JSON.parse(JSON.stringify(layer.frames()[0].ack)), { on: false, dir: 'ltr' }, 'the frame confirmed the state it applied');
  assert.equal(layer.on, true, 'a message never sets the layer state');
  assert.equal(dom.html.getAttribute('dir'), 'rtl');
});

test('a message whose data is null or not an object is ignored, and the listener stays live', () => {
  const frame = frameElement({ crossOrigin: true, src: 'http://127.0.0.1:8890/' });
  const dom = boot({ frames: [frame] });
  const layer = dom.window.__dshRtlBidiLayer;
  frame.posted.length = 0; // boot told the frame once; the rest is ours to read
  // Any window may post anything. None of these may reach data.type, and none
  // may move the layer or cost the listener its next event.
  const refused = [
    { data: null, source: frame.win },
    { data: 'dsh-rtl-bidi:hello', source: frame.win },
    { data: 42, source: frame.win },
    { data: undefined, source: frame.win },
    { source: frame.win },
  ];
  for (const event of refused) {
    assert.doesNotThrow(() => {
      for (const handler of dom.window.handlers.message) handler(event);
    });
  }
  assert.equal(layer.on, true, 'no refused message moved the layer');
  assert.equal(frame.posted.length, 0, 'and nothing was answered');
  // The listener is still live: a real hello gets the current state back.
  for (const handler of dom.window.handlers.message) {
    handler({ data: { type: 'dsh-rtl-bidi:hello' }, source: frame.win });
  }
  const answer = JSON.parse(JSON.stringify(frame.posted[frame.posted.length - 1]));
  assert.deepEqual(answer, { type: 'dsh-rtl-bidi', on: true, lang: 'ar' });
});

test('a frame that navigates or disappears is released, never left painted', () => {
  const first = frameDoc();
  const frame = frameElement({ doc: first.doc });
  const dom = boot({ frames: [frame] });
  assert.equal(first.root.getAttribute('dir'), 'rtl');

  const second = frameDoc({ dir: 'ltr' });
  frame.navigate(second.doc);
  altR(dom.window); // off
  altR(dom.window); // on again: the scan sees the new document
  assert.equal(first.root.getAttribute('dir'), null, 'the old document is put back');
  assert.equal(first.head.children.length, 0, 'and its sheet is removed');
  assert.equal(second.root.getAttribute('dir'), 'rtl', 'the new document is painted instead');

  dom.frames.length = 0; // the app removes the panel
  altR(dom.window);
  assert.equal(second.root.getAttribute('dir'), 'ltr', 'a removed frame goes back to its own original too');
  assert.equal(second.head.children.length, 0);
  assert.equal(frame.frameHandlers.keydown.length, 0, 'and its shortcut is unbound');
});

test('disposing the layer releases every frame it entered', () => {
  const inner = frameDoc({ dir: 'ltr', lang: 'en' });
  const frame = frameElement({ doc: inner.doc });
  const dom = boot({ frames: [frame] });
  assert.equal(inner.root.getAttribute('dir'), 'rtl');
  dom.window.__dshRtlBidiLayer.dispose();
  assert.equal(inner.root.getAttribute('dir'), 'ltr');
  assert.equal(inner.root.getAttribute('lang'), 'en');
  assert.equal(inner.head.children.length, 0);
  assert.equal(frame.frameHandlers.keydown.length, 0, 'the frame shortcut is unbound');
});
