# Noctis Companion — Coolify deploy

A private, Dockerised play UI for Noctis' existing Google Sheets character sheet.

The **Google Sheet remains the canonical DM-readable character sheet**. The web app is a quality-of-life wrapper for play: spell preparation, spell-slot tracking, casting, rests, spellbook management, and inventory.

## Quick deploy

1. Put this folder in a Git repository.
2. In Coolify create an Application from the repository.
3. Build pack: **Dockerfile**.
4. Internal/container port: **3000**.
5. Add the environment variables from `.env.example`.
6. Share the character Google Sheet with the service-account email as **Editor**.
7. Deploy and attach your domain.

Health endpoint:

```text
/health
```

A successful response is:

```json
{"ok":true,"service":"noctis-companion"}
```

## What this version does

### Gameplay

- Shows Noctis' prepared spells and known cantrips as expanded cards — no need to click a spell just to remember what it does.
- Shows casting time, range, duration, components, save/attack information, concentration/ritual status, and a readable effect summary.
- **Cast** button automatically spends the chosen spell-slot level.
- Shows casts-per-spell since the last long rest.
- After casting, produces a prominent "Tell the table" summary.
- Displays spell slots as a shared pool by level.

> 5e Wizards do not allocate spell slots to individual spells. Prepared spells can use any suitable shared slot. The UI therefore tracks slot use by level and cast history by spell.

### Rests

- **Long Rest** restores all spell slots, resets cast counters, and refreshes Arcane Recovery.
- **Short Rest** supports Wizard **Arcane Recovery**, enforcing the 2014 combined-slot-level limit and once-per-long-rest use.

### Google Sheet sync

`APP_DATA` stores machine state, but it is no longer the only place changes go.

- `SPELLS` is kept as the compact DM/gameplay spell sheet:
  - known spell names
  - prepared marker
  - concentration marker
  - ritual marker
  - V/S/M component markers
  - spell-slot totals and spent-slot circles
- `SpellBook` is kept as the human-readable full spellbook:
  - quick spell index grouped by level
  - detailed cards with name, level, school, ritual status, casting time, components, range, duration and effect summary
- A **Rebuild DM spell sheets** button in Settings can force a complete resync.

The app preserves the existing formatting and writes into the cells already designed for these fields.

### Inventory

The Inventory tab reads/writes the existing `BAG` sheet.

- quantity
- item name
- cost (for example `5 gp`)
- weight per item
- CP / SP / EP / GP / PP

It uses the BAG sheet's existing rows, so its existing wealth and weight formulas continue to work.

### Spell data

`data/wizard-spells-2014.json` contains the **216 Wizard spells listed in the supplied 2014 Player's Handbook**, structured locally for the companion. It is bundled into the Docker image, so the live app does not need an external spell API.

The data was extracted from the handbook supplied for this private character tool. The UI favours concise card summaries for readability; full source text is available in the local records for the detail view.

## Environment variables

```env
PORT=3000
SPREADSHEET_ID=1I9oKFOEonJ-oUuzO1Fewm3bNMapB1DyDb8f4J74vRsU
GOOGLE_SERVICE_ACCOUNT_B64=<base64 encoded service-account JSON>
APP_PASSWORD=<password for the web UI>
SESSION_SECRET=<long random value>
DND_RULESET=2014
```

## Google Sheets service account

The deployed Coolify container cannot reuse ChatGPT's Google Drive connection. With the current build it authenticates directly to Google Sheets using a service account.

1. Enable Google Sheets API in a Google Cloud project.
2. Create a service account and JSON key.
3. Share the character sheet with the service-account email as Editor.
4. Base64 encode the JSON file and use it as `GOOGLE_SERVICE_ACCOUNT_B64`.

PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("service-account.json"))
```

Linux:

```bash
base64 -w 0 service-account.json
```

## Current Noctis assumptions

The companion reads these directly from the existing sheet (with optional overrides in Settings):

- Level: `MAIN!AC2`
- Intelligence: `MAIN!B20`

For the current Wizard 3 / INT 17 character this gives:

- Spell save DC 13
- Spell attack +5
- 6 prepared levelled spells
- 3 cantrips known
- 4 first-level slots
- 2 second-level slots
- Arcane Recovery budget: 2 combined slot levels

## First deploy after upgrading from the old version

The older build only wrote known/prepared state into `APP_DATA`. After deploying this version, open **Settings → Rebuild DM spell sheets** once. That projects the existing state into `SPELLS` and `SpellBook` immediately.

After that, learning/preparing/removing spells, casting spells, and resting sync the relevant sheet cells automatically.

## v5 - Feats and guided level-ups

The companion now includes a PHB 2014 feat browser and a guided Wizard level-up flow.

- Feats are stored in `APP_DATA` and projected into the `ABILITIES` sheet's custom section for the DM.
- Wizard ASI/feat levels are handled at 4, 8, 12, 16 and 19.
- Each Wizard level-up requires two new levelled Wizard spells.
- Levels 4 and 10 also prompt for the additional Wizard cantrip.
- The level-up workflow supports either a feat or the normal +2 / +1-and-+1 Ability Score Improvement.
- Half-feat ability increases are written back to the corresponding MAIN ability score.
- At Necromancer 6, `Animate Dead` is added automatically if it is not already in the spellbook.
- The Level Up tab includes a 1-20 Wizard / School of Necromancy roadmap and slot progression.
