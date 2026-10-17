# dsh-rtl-bidi

RTL + mixed-direction layer for the DSH Harness Web UI (`http://127.0.0.1:3080`).

The page ships `<html lang="en">` with no `dir` attribute: every element computes
`ltr`, and the body font stack (`-apple-system, "Segoe UI", "PingFang SC"`) has no
Arabic family, so Arabic text falls back per glyph and mixed Arabic/Latin
paragraphs resolve with a left-to-right base direction.

## What it does

One client plugin, installed into the `web` profile. It sets `dir="rtl"` and
`lang="ar"` on `<html>`, adds Arabic-capable families to the font stack, gives
each text block its own base direction (`unicode-bidi: plaintext`), and pins
code/terminal/editor surfaces back to `direction: ltr; unicode-bidi: isolate`.

It registers no slot and renders nothing, so it cannot disturb the app layout.
A `MutationObserver` re-asserts both attributes if the app rewrites `<html>`
(measured: it resets `lang="en"` on boot).

## Toggle

**Alt+R** turns it off and on. The choice persists in `localStorage` under
`dsh:rtl-bidi` (`"on"` / `"off"`); default is on.

To remove it for the whole profile:

    plugin_manager { action: remove_bundle, target: "@fares/dsh-rtl-bidi" }

or disable the row without unlinking it: `set_bundle` with `enabled: false`.

## Why the root attribute is enough

Measured on the live app (2026-10-17, 1198x1417 viewport):

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

## No floating toggle button, on purpose

Every viewport corner is occupied by another control. A floating pill at the
bottom-end corner was measured overlapping a 260x42 app trigger by 748 px² out
of its own 770 px², and the other corners collide too (top-end 256/300/616 px²).
A fixed overlay therefore cannot be placed safely across views, so the layer
ships with a keyboard toggle and zero added pixels.

## Verification

`verify/rtl-probe.js` is the probe the numbers above came from: paste it into the
page console (or evaluate it over CDP) and compare the result with the expected
values in `verify/README.md`. Nothing in this repository is claimed from a
screenshot — this model cannot read images, so every visual statement is a
computed style or an element rectangle.

## Files

| File | Role |
|---|---|
| `package.json` | bundle manifest; `dsh.client.immediately = true`, empty `inject` |
| `cordis.patch.yml` | inserts loader row `rtl-bidi` |
| `index.js` | host half, `apply()` is intentionally empty |
| `client.js` | the whole feature: CSS layer + root attributes + Alt+R |