# homebridge-ir-patio-heater

[![npm](https://badgen.net/npm/v/homebridge-ir-patio-heater)](https://www.npmjs.com/package/homebridge-ir-patio-heater)
[![license](https://badgen.net/github/license/zmanuel1234/homebridge-ir-patio-heater)](LICENSE)

Shows remote-only patio heaters, controlled through a Tuya IR blaster, as three HomeKit
tiles per heater:

- **Heater** (switch): the only tile that turns the heater on. On = Power, wait, last level.
  Off = Power.
- **Level** (fan slider, 500 W / 1000 W / 1500 W): changes the level while heating. Off or
  slider to zero does the same as Heater off. It never turns the heater on: picking a level
  while off just remembers it for next time.
- **Out of Sync** (button): flips what HomeKit shows (On ↔ Off) without sending anything.

Rename tiles with `levelName` / `syncName`, or hide Out of Sync with `showSyncButton: false`.

## Requirements

- Homebridge 1.6 or later (including 2.x), Node.js 18.20 or later.
- A Tuya (Smart Life) universal IR blaster with the heater's remote learned or added in the app.
- A Tuya IoT Platform cloud project linked to your app account, with **IoT Core** and
  **IR Control Hub Open Service** authorized. If you already use a Tuya Homebridge plugin,
  reuse its project.

## Installation

Search for **IR Patio Heater** in the Homebridge UI's Plugins tab, or run:

```sh
npm install -g homebridge-ir-patio-heater
```

## Configuration

Configure it in the Homebridge UI, or add a platform to `config.json`:

```json
{
  "platform": "PatioHeater",
  "name": "Patio Heaters",
  "accessId": "<Access ID of your Tuya cloud project>",
  "accessKey": "<Access Secret>",
  "endpoint": "https://openapi.tuyaus.com",
  "heaters": [
    {
      "name": "Left Heater",
      "blasterId": "<IR blaster device ID>",
      "remoteId": "<IR remote device ID>",
      "powerKey": "power",
      "levelKeys": ["500W", "1000W", "1500W"]
    }
  ]
}
```

- **blasterId / remoteId**: in the Tuya IoT Platform, Cloud → your project → Devices. The
  remote you added under the blaster is a device of its own. The Tuya app also shows both
  under Device → ✎ → Device Information → Virtual ID.
- **powerKey / levelKeys**: the button names as the remote shows them in the Tuya app
  (matched case-insensitively). If a name doesn't match, the log lists the available ones.
- **endpoint**: the data center of your app account (Americas, Europe, India or China).

Every other option has a sensible default and is explained in the settings screen and below.

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

## Why requests aren't retried

Reading from Tuya is retried on network errors. Pressing a key is not: a request that timed
out may still have reached the blaster, and a second Power press would switch the heater
back. A failed press is reported in the log and HomeKit is rolled back to what is known to
have happened.

## Response time

Each log line shows where the time went, e.g.
`On at 1500W (power 640ms, 1500W 590ms; total 2410ms after HomeKit request)`.
The per-press times are Tuya's cloud accepting the command; the blaster then fires the IR,
usually within a second. Turning on also includes `keyDelayMs` (default 1000) between Power
and the level, which the heater needs to wake up. The plugin itself adds only `debounceMs`
(default 150) to combine on + level requests, and renews its Tuya token in the background.

## Tuya account

Uses the Access ID / Access Secret of your Tuya cloud project with a project-level token.
It never signs in with your app account, so it can share a project with a Tuya Homebridge
plugin without logging that plugin out. The cloud project needs the **IR Control Hub Open Service** API authorized (the Tuya
plugin already uses it for your remotes).
