# Contributing

This is a single-file client plugin with a no-dependency test suite. The rules
are short because the surface is.

## The loop

```bash
npm test          # 24 tests, node --test, no Harness required
```

Load it into a running Harness (`~/.dsh/profiles/web`) and open the app:

```bash
dsh plugin --profile web add link:$PWD
dsh plugin --profile web enable @fares/dsh-rtl-bidi   # if it was added disabled
```

Remove it again with `dsh plugin --profile web remove @fares/dsh-rtl-bidi`.

## What a change must keep

1. **The layer survives everything else.** `dir`/`lang`, the stylesheet, the
   font stack and Alt+R are installed when the bundle script executes. A change
   that moves any of them behind a service, React, or a slot is a regression.
2. **One state, two faces.** The settings row and Alt+R read and write the same
   `dsh:rtl-bidi` value. Do not add a second source of truth.
3. **No pixels of its own.** The control lives in the host's additive
   `settings.general.item` seat. A floating overlay was measured overlapping the
   app's own trigger and was rejected; do not reintroduce one.
4. **Code stays left-to-right.** `pre`, `code` and editor surfaces must compute
   `direction: ltr; unicode-bidi: isolate` under an RTL root.
5. **Restore on the way out.** `dispose()` must put the original `dir`/`lang`
   back, remove the sheet, unbind the shortcut, and release every frame.

## Tests

`tests/client.test.mjs` evaluates the real `client.js` in a `node:vm` sandbox
with a stub DOM and a fault-injecting `require`. When you add behaviour, add the
case that fails without it — in particular for the fault paths (missing React,
missing slot service, blocked storage, a throwing bound member).

The suite is a module-behaviour suite, not evidence about the loader. Claims
about the loader belong in the README with a citation or a live probe.

## Measured claims

Anything about the live page is a computed style or an element rectangle, not a
screenshot. `verify/rtl-probe.js` is the probe; `verify/README.md` carries the
expected values. If you change a number in the README, re-run the probe.

## Commits

Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`), one intent
per commit, and the body says what was measured or what broke. Update
`CHANGELOG.md` under `## [Unreleased]` for anything a user can observe.

## License

MIT. By contributing you agree your work is released under the same terms.
