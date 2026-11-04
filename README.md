# dsh-rtl-bidi

RTL + mixed-direction layer for the DSH Harness Web UI (`http://127.0.0.1:3080`).
One client plugin; the same bundle serves the Desktop GUI window.

The page ships `<html lang="en">` with no `dir` attribute: every element computes
`ltr`, and the body font stack (`-apple-system, "Segoe UI", "PingFang SC"`) has no
Arabic family, so Arabic text falls back per glyph and mixed Arabic/Latin
paragraphs resolve with a left-to-right base direction.

[![test](https://github.com/faresrafat3/dsh-rtl-bidi/actions/workflows/test.yml/badge.svg)](https://github.com/faresrafat3/dsh-rtl-bidi/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Install it alone

Nothing else is required: no other plugin, no build step, no runtime dependency.
The package carries its own patch (`cordis.patch.yml`) and one client module.

```bash
git clone https://github.com/faresrafat3/dsh-rtl-bidi.git
cd dsh-rtl-bidi
dsh plugin --profile web add link:$PWD
```

Then list it as a bundle in `~/.dsh/profiles/web/package.json`:

```json
{
  "dependencies": { "@fares/dsh-rtl-bidi": "link:/absolute/path/to/dsh-rtl-bidi" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@fares/dsh-rtl-bidi"] } }
}
```

Restart the backend (`dsh web`) and the layer is on. Remove it with
`dsh plugin --profile web remove @fares/dsh-rtl-bidi` plus dropping the name from
`bundles`; or keep it installed and disable only the row with the plugin
manager's `set_bundle { enabled: false }`.

Verify it on the live page with `verify/rtl-probe.js` (see `verify/README.md`);
`npm test` covers the module behaviour with no Harness running.

## Compatibility

| Harness | Status |
|---|---|
| dsh 0.2.1 (`web` profile, Desktop GUI window) | measured — all numbers above |
| dsh 0.2.x older profiles | untested; the surfaces used (`settings.general.item`, `ctx.effect`, `__ModuleLoader__`) are the 0.2 ones |
| Node | 20+ (test suite and CI matrix) |

The plugin is a bundle, not a patch of the host: it inserts one loader row and
owns nothing outside it. If the host changes a surface it uses, the row states
it (`data-dsh-rtl-bidi-row="skipped:…"`) instead of failing silently.


## Two guarantees

**The layer is unconditional.** It is installed when the bundle script executes —
`dir`/`lang` on `<html>`, the stylesheet, the Arabic font stack and the Alt+R
shortcut — before the module system reads the factory at all. Nothing in that
path touches a service, React or a slot.

That placement removes a proven risk; it is not a proven cause. **Proven:** the
client module loader materializes a factory lazily — its own contract
(`@deepseek-ai/dsh-client-modules/lib/client.js`, lines 16-31) states the import
resolution order (a bundle that executes only *registers* its factory; the
exports appear on the first import/require), `arrive(row)` returns early when
`factories.has(id)`, and a factory registered through the real
`window.__ModuleLoader__.load` was observed never to run in the live page. So
materialization is not guaranteed: a row that is still arriving or never imported
never gets there, and invalidation drops the factory until a later import
re-materializes it. A page-wide side effect living inside the factory can
therefore be absent with no residue and no error. **Not proven:** that laziness is
what made *this* plugin absent. The row materializes today, both versions shared
the same loader row, and the older version's factory opened with an unguarded
`require('react')` — a throw there aborts materialization before anything is
installed, which fits the same symptom. Installing from the script removes that
class of risk for every bundle the host actually serves (it cannot cover one that
is never served).

**The row is optional.** It declares `inject: ['slots']`. On this cordis, reading
`ctx.slots` without that declaration throws, and the declaration also parks the
fiber until the provider is active; `ctx.get('slots')` is the un-gated optional
lookup and can transiently return nothing while the provider initializes
(measured: `undefined`, then the service 60 ms later as the provider's fiber moved
from state 1 to 2). Before the declaration existed, `apply()` ran and the row was
skipped silently, recorded as `data-dsh-rtl-bidi-row="skipped:no-slots"`. A
missing React or a missing slot service now costs the row and nothing else, and
the layer states which of the two happened in that attribute.

`ctx.effect` runs its callback immediately and keeps the callback's **return
value** as the disposer (`cordis/lib/index.js:1142`), so the row's cleanup is
returned, not passed. A fiber teardown drops the row; the layer outlives it, so a
hot reload cannot blink the user's choice off. Use
`window.__dshRtlBidiLayer.dispose()` to take the layer down.

## What it does

Sets `dir="rtl"` and `lang="ar"` on `<html>`, adds Arabic-capable families to the
font stack, gives each text block its own base direction
(`unicode-bidi: plaintext`), and pins code/terminal/editor surfaces back to
`direction: ltr; unicode-bidi: isolate`. A `MutationObserver` re-asserts the root
attributes and re-installs the stylesheet if the app rewrites either (measured: it
resets `lang="en"` on boot).

## The control

**Settings → General → "Right-to-left layout"** registers one row into the host's
additive seat (`settings.general.item`, order 13), so it allocates its own space
inside the host's own column and cannot cover anything.

**Alt+R** toggles the same state from anywhere. Both write one store and the row
subscribes to it, so the shortcut and the switch can never disagree.

The choice persists in `localStorage` under `dsh:rtl-bidi` (`"on"` / `"off"`);
the default is on, and reading storage is guarded, so a page that blocks it still
gets the layer.

To remove it for the whole profile:

    plugin_manager { action: remove_bundle, target: "@fares/dsh-rtl-bidi" }

or disable the row without unlinking it: `set_bundle` with `enabled: false`.

## Measured

Live app, 2026-10-17, 1198x1417 viewport; the last five rows were measured after
the v2.0 rewrite.

| Measurement | Result |
|---|---|
| Elements before | 818, all computed `ltr`, zero carrying a `dir` attribute |
| Elements fixing their own direction | none |
| After the flip | 3333/3339 `rtl`; the 6 exceptions are exactly `code`/`pre` |
| Horizontal overflow introduced | 0 (`scrollWidth - clientWidth`) |
| Sidebar title mirror | first Arabic title `x=40` → `x=963` |
| Composer mirror | `x=380` → `x=105` |
| Code surfaces | `pre`/`code` = `ltr` + `isolate`, `pre` `text-align: left` |
| Composer | `direction: rtl`, `unicode-bidi: plaintext` |
| App rewrite of `<html>` | re-asserted within 250 ms |
| Layer installed from the factory | absent: `dir: null`, `lang: "en"`, no marker/handle/sheet |
| Same factory, run standalone in the page | applied: `dir: rtl`, `lang: ar`, sheet + handle present |
| Layer installed from the script | `dir: rtl`, `lang: ar`, marker `on`, sheet present (1209 chars) |
| Row, after declaring `inject: ['slots']` | `data-dsh-rtl-bidi-row="registered"`, rendered `559x56` at `x=228`, `unicode-bidi: isolate` |
| Switch, on | `36x20`, `role="switch"`, `aria-checked="true"`, track `#f9fafb` (brand), knob `#151517` |
| Switch, off | track `#2c2c2e` (layer-2), knob `#cfd3d6` (label-secondary) |
| The host's own switch | `36x20`; its OFF switch is a subtle track with a light knob |
| Knob travel | `margin-inline-start` 16px on / 0 off, so it mirrors correctly in RTL and LTR |
| Click the switch off | `dir` removed, `lang` back to `en`, store `off`, `aria-checked="false"`, body `ltr` |
| Alt+R after that | `dir: rtl`, `lang: ar`, store `on`, `aria-checked="true"`, body `rtl` |

## No floating toggle button, on purpose

Every viewport corner is occupied by another control. A floating pill at the
bottom-end corner was measured overlapping a 260x42 app trigger by 748 px2 out of
its own 770 px2, and the other corners collide too (top-end 256/300/616 px2). A
fixed overlay therefore cannot be placed safely across views, so the layer adds
zero pixels of its own and exposes the control through the settings row and Alt+R
instead.

## Surfaces that are documents of their own

The layer is document-scoped, and a plugin surface rendered in an iframe is a
separate document: its own url, its own `dir`/`lang`, its own CSS, and on a
different origin a `contentDocument` the browser refuses to hand over. Measured
on the Documents panel (`http://127.0.0.1:8890/`): `contentDocument === null`, and
with the layer off the shell went `ltr` while the frame kept its own direction —
the control could not reach it at all. The layer now does both things an iframe
allows:

| Frame | What the layer does |
|---|---|
| same origin, `contentDocument` reachable | enters it: root `dir`/`lang`, the same sheet, and Alt+R bound inside it |
| any frame | posts `{type:'dsh-rtl-bidi', on, lang}` on every change and on every load |

A page that wants to follow answers `{type:'dsh-rtl-bidi:hello'}` (asking for the
current state) and confirms with `{type:'dsh-rtl-bidi:ack', on, dir}`. The layer
answers the ask and records the ack; it never takes its own state from a message,
and it ignores anything not carrying its own type. Measured live on the Documents
frame after that handshake: told `{on:false, lang:'ar'}` -> acked
`{on:false, dir:'ltr'}` while the shell went `ltr`. `docserve` carries the ~15-line
listener that makes it cooperative; a page that never answers simply keeps its own
default, which is why `window.__dshRtlBidiLayer.frames()` reports every frame as
`{src, entered, dir, told, ack}` — "it follows" is then a reading, not a claim.

## Verification

    npm test          # 22 tests, node --test tests/, no Harness required

That suite is a module-behaviour suite over the real `client.js` in a `node:vm`
sandbox, not evidence about the loader: some of its assertions exercise only
fixture logic and would still pass under a wrong model of the loader. The loader
claims above rest on the cited source lines and on live probes, not on the tests.

`verify/rtl-probe.js` is the probe the live numbers above came from: paste it into
the page console (or evaluate it over CDP) and compare with `verify/README.md`.
Nothing here is claimed from a screenshot — this model cannot read images, so
every visual statement is a computed style or an element rectangle.

## Files

| File | Role |
|---|---|
| `package.json` | bundle manifest; `dsh.client.immediately = true`, empty `inject` |
| `cordis.patch.yml` | inserts loader row `rtl-bidi` |
| `index.js` | host half, `apply()` is intentionally empty |
| `client.js` | the whole feature: layer, row, shortcut, frame bridge, ~600 lines with comments |
| `tests/client.test.mjs` | 22 tests: loader contract, fault isolation, store, watcher, row, frames |
| `verify/rtl-probe.js` | the live-page probe, read-only |

## Repo layout

| Path | Purpose |
|---|---|
| `client.js` | the product: layer, row, shortcut, frame bridge |
| `index.js` | host half, `apply()` is intentionally empty |
| `cordis.patch.yml` | the one loader row the bundle inserts |
| `package.json` | manifest: `dsh.bundle.patch`, `dsh.client`, `files`, exports |
| `tests/` | `node --test` suite, no dependencies |
| `verify/` | live-page probe and the expected values it is compared against |
| `.github/workflows/test.yml` | CI: Node 20 / 22 / 24, `npm test` |
| `CHANGELOG.md` | Keep a Changelog, SemVer |
| `CONTRIBUTING.md` | the loop, and the five properties a change must keep |
| `LICENSE` | MIT |
