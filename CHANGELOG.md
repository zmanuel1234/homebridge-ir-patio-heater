# Changelog

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
