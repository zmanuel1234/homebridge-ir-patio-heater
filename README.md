# homebridge-ir-patio-heater

Shows remote-only patio heaters, controlled through a Tuya IR blaster, as three HomeKit
tiles per heater:

- **Heater** (switch): the only tile that turns the heater on. On = Power, wait, last level.
  Off = Power.
- **Level** (fan slider, 500 W / 1000 W / 1500 W): changes the level while heating. Off or
  slider to zero does the same as Heater off. It never turns the heater on: picking a level
  while off just remembers it for next time.
- **Out of Sync** (button): flips what HomeKit shows (On ↔ Off) without sending anything.

Rename tiles with `levelName` / `syncName`, or hide Out of Sync with `showSyncButton: false`.

## How the heater is driven

These heaters have three real states: **Off**, **Standby** (power on, not heating) and
**Heating** at a level. The remote's Power button toggles between Off and on; a level button
starts or changes heating, but only when the heater has power.

| HomeKit shows | You do | IR presses |
|---|---|---|
| Off | Heater on | Power → wait `keyDelayMs` → level ×2 |
| On | Move Level slider | level ×2 |
| On | Heater off, Level off, or slider to 0 | Power |
| Off | Move Level slider | level ×2 (remembered for next on) |
| Off | Any off, or Level tapped on | nothing |

Level presses are sent twice (`levelRepeat`, default 2) because the heater ignores a repeated
level, so a missed IR press gets a second chance. Power is a toggle and is always sent once.
If a heater is slow to wake up or far from its blaster, raise its `keyDelayMs` (e.g. 2500).

Requests that arrive together (the Home app often sends on + level at once) are combined
into one sequence. If a press fails, HomeKit is rolled back to what actually happened.

## Getting back in sync

IR is one-way and Power is a toggle, so HomeKit can only be wrong by being inverted.
Look at the heater, then:

| Heater tile shows | Heater itself | Do |
|---|---|---|
| On | Dark, no light | Tap **Out of Sync** → tile shows Off |
| Off | Light on | Tap **Out of Sync** → tile shows On, then turn off normally if you want |
| On | Light on, not heating | Move the **Level** slider (the level press was missed) |

Don't fix it by toggling the Heater tile: every tap sends another Power, so it stays inverted.

For the same reason, `autoOffMinutes` only works with a smart plug, and you should not add
"turn off when everyone leaves" automations without one.

## Optional smart plug (recommended for unattended use)

Set `plugId` to a Tuya smart plug (outdoor, 15 A). Then **off = plug off**, which is always
correct because the heater doesn't remember its state after a power cut. **On** = plug on,
wait `plugPowerUpDelayMs`, Power, level. The plug is polled, so turning it off anywhere marks
the heater off. With a plug, auto-off and away automations are safe.

## Response time

Each log line shows where the time went, e.g.
`On at 1500W (power 640ms, 1500W 590ms; total 2410ms after HomeKit request)`.
The per-press times are Tuya's cloud accepting the command; the blaster then fires the IR,
usually within a second. Turning on also includes `keyDelayMs` (default 1000) between Power
and the level, which the heater needs to wake up. The plugin itself adds only `debounceMs`
(default 150) to combine on + level requests, and renews its Tuya token in the background.

## Tuya account

Uses the same Access ID / Access Secret as homebridge-tuya-platform, but with a project-level
token, so it does not sign in with your app account and does not kick the Tuya plugin's
session. The cloud project needs the **IR Control Hub Open Service** API authorized (the Tuya
plugin already uses it for your remotes).
