# Changelog

## 1.2.0 - 2026-11-22

No new settings; with your current config, 1.2.0 behaves like 1.1.4. Check your Node.js version
before updating (below).

### Changed
- **Requires Node.js 22.19 or later, 24 or 26** (dropped 18 and 20, which no longer get security updates; on Node 22, 22.19 is the minimum across the author's plugins). Check with `node -v` or on the Homebridge UI's status page before updating.
- Development only, nothing changes for users: the same ESLint and Dependabot setup as the
  author's other plugins. ESLint now checks for likely bugs (unhandled promises and similar)
  instead of formatting, reading the JavaScript through a `tsconfig.json` that isn't used for
  building. It runs once in CI, on Node 24, while the tests still run on every supported Node
  version.
- Development only: `npm publish` lints and tests first. New tests cover the plug (a plug
  reported off shows the heater off; turned back on, it stays off), auto-off, a remote missing the
  configured keys, keys that fail to load and are retried, a failed repeat of the level press,
  the Level tile turned off, DIY learned remotes, the plug's Tuya calls, Tuya errors and their
  hints, and the token renewed in the background.
- Development only: the same release and CI workflows as the author's other plugins. Publishing a GitHub release publishes it to npm (with trusted publishing; the package and its checksum are added to the release); each repository's checks are its `verify`, `test:matrix` and `release:check` scripts.

## 1.1.4 - 2026-11-03

### Changed
- Added the `supports-hap` keyword, which Homebridge plugin verification requires.

## 1.1.3 - 2026-11-03

### Fixed
- A Tuya read retried after a network error now gets a new timestamp, nonce and signature.
  It reused the first attempt's, which Tuya can reject as a replay, so the retry could fail
  where a fresh request would have worked.

## 1.1.2 - 2026-11-03

### Fixed
- Settings screen: all number fields are number boxes. "Send each level press this many
  times" was a slider, and some versions of the screen drew the other timing fields as
  sliders too.

## 1.1.1 - 2026-11-03

### Fixed
- Settings screen: the Level and Out of Sync tile name hints were missing the heater name,
  because the screen treated `<name>` as markup. They now say the default in words.

## 1.1.0 - 2026-11-03

First public release.

### Changed
- Commands to the IR blaster are no longer retried after a network error. A timed-out
  request may already have pressed Power, and a second press would switch the heater back.
  Reads are still retried.
- Settings screen uses standard `required` lists, so the Homebridge UI validates it cleanly.
- Removed warnings about settings from pre-release versions.

### Added
- `plugPollSeconds` in the settings screen (it was supported but not shown).
- Installation and configuration sections in the README, LICENSE, tests and linting.

## 1.0.4 - 2026-11-01

Private pre-release: Heater, Level and Out of Sync tiles; optional smart plug.
