# Changelog

## 1.3.0 - 2026-11-27

Requires Homebridge 2; nothing else changes in how the plugin works.

- **Requires Homebridge 2** (2.0.0 or later). Homebridge 1.6 to 1.11 are no longer supported; on Homebridge 1, stay on 1.2.4: the Homebridge UI still offers this update, with a warning that it needs Homebridge 2.
- README: Requirements, Development and License sections in the same style as the other plugins.
- Development only: the same checks, lint setup and issue forms as the author's other plugins (`npm run verify` also checks the settings schema, the README's JSON examples and Homebridge's plugin rules; oxlint 1.95.0); after a stable release, npm's `beta` tag is removed when it points at an older version; CI no longer fails when npm's registry gives a broken answer for a development-only package.

## 1.2.4 - 2026-11-27

No change to how the plugin works.

### Changed
- npm and Homebridge's plugin search: the description mentions Smart Life, the name many Tuya IR blasters are sold under, with keywords for IR blasters and patio heaters. The README has Verified by Homebridge, CI and downloads badges.
- Development only: CI and releases use the same shared workflows as the other plugins (cached packages, release notes from this changelog); oxlint-tsgolint updated.

## 1.2.3 - 2026-11-26

No change to how the plugin works.

### Changed
- Development only: the linter again runs ESLint's no-dupe-args and no-octal (through a small local oxlint plugin), so it checks everything the old ESLint setup did.

## 1.2.2 - 2026-11-26

No change to how the plugin works: the plugin's files are identical to 1.2.1's.

### Changed
- Development only: linted with oxlint (with TypeScript 7 for its type-aware checks) instead of
  ESLint and TypeScript 6, with the same rules. CI retries npm's package signature check up to 3
  times, because npm's registry sometimes answers it with an invalid response.

## 1.2.1 - 2026-11-26

No change to how the plugin works.

### Changed
- Development only: CI runs the tests on Node 22, 24 and 26 in a single check.

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
