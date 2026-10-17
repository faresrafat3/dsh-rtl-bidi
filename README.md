# dsh-rtl-bidi

RTL + mixed-direction layer for the DSH Harness Web UI (`http://127.0.0.1:3080`).
One client plugin; the same bundle serves the Desktop GUI window.

The page ships `<html lang="en">` with no `dir` attribute: every element computes
`ltr`, and the body font stack (`-apple-system, "Segoe UI", "PingFang SC"`) has no
Arabic family, so Arabic text falls back per glyph and mixed Arabic/Latin
paragraphs resolve with a left-to-right base direction.

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
`window.__ModuleLoader__.load` was observed never to run in the live page. So a
row that is invalidated, still arriving or never imported never materializes, and
a page-wide side effect living inside the factory can be absent with no residue
and no error. **Not proven:** that laziness is what made *this* plugin absent.
The row materializes today, both versions shared the same loader row, and the
older version's factory opened with an unguarded `require('react')` — a throw
there aborts materialization before anything is installed, which fits the same
symptom. Installing from the script retires the whole class of risk.

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

## Verification

    npm test          # 15 tests, node --test tests/, no Harness required

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
| `client.js` | the whole feature: layer, row, shortcut, ~400 lines with comments |
| `tests/client.test.mjs` | 15 tests: loader contract, fault isolation, store, watcher, row |
| `verify/rtl-probe.js` | the live-page probe, read-only |