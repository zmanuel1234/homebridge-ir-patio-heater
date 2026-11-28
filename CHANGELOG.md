# Changelog

## 0.1.0 - unreleased

- Rebuilt on homebridge/homebridge-plugin-template, sharing its git history, with a stricter setup on top: oxlint, TypeScript 7, Homebridge 2 only, tests, a fully typed example and the shared workflows.
- A weekly job opens a pull request when Homebridge's template changes.
- Leftovers of Homebridge's template dropped: `.npmignore` (the `files` list decides what is published), the Homebridge UI in the local Homebridge config (not installed there: an error on every start), and the browser (DOM) types.
