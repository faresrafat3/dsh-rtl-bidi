# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [2.1.0] — 2026-10-17

### Added

- Same-origin iframes are entered: root `dir`/`lang`, the stylesheet, and the
  Alt+R shortcut are installed inside the frame, and the frame is released —
  attributes restored, sheet removed, shortcut unbound — when it navigates or
  disappears.
- A message bridge for frames the layer may not enter: every frame is told
  `{type: 'dsh-rtl-bidi', on, lang}` on every change and load; a cooperative
  page asks with `:hello` and confirms with `:ack`. `window.__dshRtlBidiLayer.frames()`
  reports `{src, entered, dir, told, ack}` per frame.
- `verify/rtl-probe.js` also reports frame state, so "it follows" is a reading.

### Fixed

- The layer no longer assumes it is the only document on the page.

## [2.0.2] — 2026-10-17

### Changed

- `client.js` comments now describe the corrected mechanism: laziness is proven
  as a class of risk, not as the cause of the observed absence.
- Trailing newlines restored across the tree.

## [2.0.1] — 2026-10-17

### Fixed

- A throwing bound member (`ctx.slots` without a declared `inject`) falls through
  to the optional `ctx.get('slots')` lookup instead of taking the row down with
  it.

### Changed

- The mechanism claims in `README.md` separate what was proven from what was
  inferred.

## [2.0.0] — 2026-10-17

### Changed

- **Breaking:** the layer is installed when the bundle script executes, not from
  inside the factory. `dir`/`lang`, the stylesheet, the font stack and Alt+R no
  longer depend on the module loader materializing the factory.
- The row declares `inject: ['slots']`, so the fiber parks until the provider is
  active instead of racing it.

## [1.x] — 2026-10-17

### Added

- `dir="rtl"` / `lang="ar"` on `<html>`, an Arabic-capable font stack, and
  `unicode-bidi: plaintext` per text block, with code and editor surfaces pinned
  back to `direction: ltr; unicode-bidi: isolate`.
- A `MutationObserver` that re-asserts the root attributes and the stylesheet
  when the app rewrites them.
- Settings → General → "Right-to-left layout" (slot `settings.general.item`,
  order 13) and the Alt+R shortcut, both writing the same persisted state.
- `tests/` — a `node:vm` suite over the real `client.js` with a stub DOM and a
  fault-injecting `require`.

[Unreleased]: https://github.com/faresrafat3/dsh-rtl-bidi/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/faresrafat3/dsh-rtl-bidi/compare/v2.0.2...v2.1.0
[2.0.2]: https://github.com/faresrafat3/dsh-rtl-bidi/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/faresrafat3/dsh-rtl-bidi/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/faresrafat3/dsh-rtl-bidi/compare/v1.0.0...v2.0.0
