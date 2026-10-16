# Quick Coolify deploy

1. Put this folder in a Git repository.
2. In Coolify choose **New Resource → Application → Public/Private Git Repository**.
3. Coolify will detect the included `Dockerfile`.
4. Set container port to **3000**.
5. Add the environment variables from `.env.example`.
6. Share the Google Sheet with the service-account email as **Editor**.
7. Deploy and attach your domain.

No database, Redis, volume, or extra service is required. Character state is written to the existing Google Sheet.

---

# Noctis — Necromancer's Grimoire

A small web companion for Shaun's existing Google Sheets D&D character sheet.

## What it does

- Reads core character information from the existing Google Sheet.
- Keeps the Google Sheet as the source of truth.
- Adds an `APP_DATA` tab to the *same spreadsheet* for companion-only state.
- Browse 2014 SRD Wizard spells.
- Add spells to your spellbook.
- Prepare/unprepare spells live during play.
- Enforces the Wizard prepared-spell limit.
- Shows spell slots and key level-up milestones.
- Works as a small mobile-friendly website.
- Designed to run in Docker / Coolify.

The existing `MAIN`, `INFO`, `SPELLS`, `BAG`, etc. tabs are not overwritten.

## Why `APP_DATA`?

The original `SPELLS` tab is a heavily formatted visual sheet. Writing directly into it would make the app brittle and risks damaging formulas/layout.

Instead, the app creates a tiny `APP_DATA` tab in the same spreadsheet:

| type | key | value |
| --- | --- | --- |
| known | magic-missile | 1 |
| prepared | shield | 1 |

Your DM still has access because it is inside the same shared character spreadsheet.

A later version can mirror the chosen/prepared spells into the visual `SPELLS` tab once its exact card/cell mapping is locked down.

## Google setup

The ChatGPT Google Drive connection is **not** used by your deployed Coolify container. The hosted app needs its own Google API credential.

1. Open Google Cloud Console.
2. Create/select a project.
3. Enable **Google Sheets API**.
4. Create a **Service Account**.
5. Create/download a JSON key for that service account.
6. Copy the service account email, e.g.:
   `noctis-sheet@your-project.iam.gserviceaccount.com`
7. Share the character Google Sheet with that address as **Editor**.
8. Base64 encode the JSON key.

Linux/macOS:
```bash
base64 -w 0 service-account.json
```

PowerShell:
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("service-account.json"))
```

Put the resulting value into `GOOGLE_SERVICE_ACCOUNT_B64`.

## Coolify

Create a new application using this repository / uploaded source.

### Build

Coolify should detect the `Dockerfile`.

Port:
```text
3000
```

### Environment variables

```env
SPREADSHEET_ID=1I9oKFOEonJ-oUuzO1Fewm3bNMapB1DyDb8f4J74vRsU
GOOGLE_SERVICE_ACCOUNT_B64=<base64 JSON>
APP_PASSWORD=<a password for the web UI>
SESSION_SECRET=<long random string>
DND_RULESET=2014
PORT=3000
```

Then attach a Coolify domain such as:

```text
noctis.example.com
```

Coolify handles HTTPS/reverse proxying.

## Local test

```bash
cp .env.example .env
# fill in values
docker build -t noctis-companion .
docker run --rm --env-file .env -p 3000:3000 noctis-companion
```

Open:

```text
http://localhost:3000
```

## Current character assumptions

Current sheet data indicates:

- Noctis
- Tiefling
- Wizard 3
- School of Necromancy
- INT 17 (+3)
- Spell save DC 13
- Spell attack +5
- 21 max HP

At Wizard level 3 / INT +3:

- 6 prepared levelled Wizard spells
- 3 cantrips known
- 4 first-level spell slots
- 2 second-level spell slots
- minimum 10 levelled spells in the spellbook from normal Wizard advancement

## Spell source

The application uses the open D&D 5e SRD API for 2014 Wizard spells and descriptions.

Non-SRD spells are intentionally not bundled. A future update can add a "custom spell" editor where you enter spell details from material you own.

## Good next improvements

- Inventory / consumables view backed by the same `APP_DATA` tab.
- HP and spell-slot trackers.
- Short/long-rest buttons.
- Familiar / summoned-undead cards.
- Explicit Necromancy school filter and recommended spell picker.
- Mirror chosen spells back into the visual `SPELLS` tab.
- DM read-only mode with a second password.
- PWA support so it installs like an app on a phone.
