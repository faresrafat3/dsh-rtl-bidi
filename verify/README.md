# Verification

The layer cannot be checked by reading the source: it acts on a live page whose
components are hashed CSS-module classes with no stable hooks. Everything below
is measured from the rendered page — computed styles and element rectangles, not
screenshots.

## Run the probe

1. Open the Harness Web UI (`http://127.0.0.1:3080`).
2. Open DevTools → Console, paste the contents of `rtl-probe.js`, press Enter.
3. Compare the returned object with the table below.

To drive it without DevTools, launch a debuggable Chrome on the same URL and
evaluate the same file over CDP:

```bash
google-chrome --user-data-dir="$HOME/.config/chromium" --remote-debugging-port=0 \
  --no-first-run "http://127.0.0.1:3080/?token=<token>"
# then read $HOME/.config/chromium/DevToolsActivePort for the port
```

Chrome refuses `--remote-debugging-port` on its default profile directory, so a
non-default `--user-data-dir` is required.

## Expected values

Measured 2026-10-17 on a 1198x1417 viewport, light and dark themes, 3339 elements
in a loaded session view and 818 in the empty state.

| Field | Expected |
|---|---|
| `mounted.stylesheet` | `true` |
| `mounted.marker` | `"on"` (or `"off"` if you turned it off) |
| `mounted.dir` / `mounted.lang` | `"rtl"` / `"ar"` |
| `mounted.fontHasArabicFamily` | `true` |
| `direction.rtl` | every element except the code surfaces |
| `direction.ltrExamples` | only `code` / `pre` entries |
| `layout.overflowX` | `0` — the flip must not introduce horizontal overflow |
| `codeSurfaces[].direction` | `"ltr"` |
| `codeSurfaces[].unicodeBidi` | `"isolate"` |
| `composer.direction` | `"rtl"` |
| `composer.unicodeBidi` | `"plaintext"` |
| `addedElements` | `["dsh-rtl-bidi-style"]` — the stylesheet only, no overlay |
| `toggle.afterAltR` | `dir` null, `lang` back to the page's original |
| `toggle.restored` | `rtl` / `ar` again |
| `window.__rtlProbeHeal` | `rtl` / `ar` within 250 ms of the app rewriting `<html>` |

## Why the root attribute is enough

The page ships `<html lang="en">` with no `dir` attribute, all 818 elements
computed `ltr`, and **not one element fixes its own direction**. Flipping the
root therefore mirrors the shell without a per-component override: the first
Arabic sidebar title moved `x=40 -> x=963`, the composer `380 -> 105`, and
`overflowX` stayed `0`.

## What is not verified this way

- Subjective legibility and rhythm. Geometry does not tell you whether the
  mirrored layout feels right; open the page and look.
- Views not exercised by the probe (plugin panels, automation tasks, a
  terminal). They inherit the same rules, but they were not each measured.