# Changelog

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
