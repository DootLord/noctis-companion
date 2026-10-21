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

### Mobile QoL

- Dedicated viewport-level bottom navigation that is not nested inside the sticky header.
- Five stable primary actions on phones: Character, Spells, Inventory, Reference, and More.
- Less-used sections live in a touch-friendly More sheet instead of squeezing nine icons across the screen.
- Safe-area support for notched iPhones plus virtual-keyboard handling on supported mobile browsers.
- Re-selecting the current tab jumps to the top; switching tabs preserves each tab's previous scroll position.
- Larger touch targets, mobile-safe 16px form controls, compact dialogs, and extra bottom spacing prevent controls from being obscured.

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

`data/wizard-spells-2014.json` is the **Noctis-eligible Wizard catalogue** (PHB 2014 plus the Wizard spells from Ryoko). It remains separate from the larger read-only reference catalogue, so non-Wizard spells can never leak into Noctis' learn, prepare, or level-up flows.

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

## v6 - Ryoko's Guide content

This build also includes the user-supplied **Ryoko's Guide to the Yokai Realms v0.90** player options:

- 43 additional spells from the book's **Wizard Spells** list (cantrips through 5th level).
- 26 general feats from the book's Feats section.
- 13 racial feats, shown in the feat catalogue but locked when Noctis does not meet the racial prerequisite.
- Source badges distinguish PHB 2014 content from Ryoko v0.90 content.
- A fresh OCR/text-cleanup pass was applied after the import.

The companion still treats Noctis as a 2014 Wizard/Necromancer. Expansion spells only appear as Wizard options when Ryoko's own Wizard spell list includes them.

## v7 Campaign dashboard

The companion now includes a live **Character** dashboard for normal session play. It reads and writes the existing `MAIN` sheet for current/max/temp HP, death saves, Inspiration, armour class and Hit Dice, while keeping temporary app-only status such as conditions, exhaustion and concentration in `APP_DATA`.

Gameplay controls include damage/healing (temporary HP is consumed first), clickable death saves, Hit Die healing, Inspiration, condition/exhaustion tracking, concentration tracking/check reminders, saving throws, skills, ability scores, initiative, speed, passive Perception and core combat stats. Long rest now also restores HP, clears temporary HP/death saves, regains the appropriate Hit Dice, and ends concentration.


## v8 - Stability, mobile UX and performance pass

- Removed a legacy frontend exception that could interrupt successful renders.
- Added clearer Google Sheet sync states and error feedback.
- Prevented accidental double-submission of state-changing actions.
- Added confirmation before removing a spell or replacing an active concentration spell.
- Added persistent, touch-friendly mobile navigation and reduced-motion/accessibility handling.
- Added tab ARIA semantics and keyboard arrow/Home/End navigation.
- Fixed duplicate spell mechanic callouts and clamped Wizard spell discovery to 9th level.
- Empty inventory rows are no longer written to the BAG sheet.
- Common HP/healing/AC/death-save actions no longer rewrite APP_DATA unnecessarily, and the APP_DATA sheet lookup is cached after first use.
- Long rests reduce exhaustion by one level in addition to the existing rest restoration.
- Filled three previously blank PHB spell records (Disguise Self, Mordenkainen's Sword and Feeblemind) so their gameplay cards are usable.


## v9 Reference Library

Adds a read-only Reference tab for table lookup. It exposes the companion's current Wizard spell catalogue and complete feat catalogue without any prepare/learn/remove controls. Spells can be filtered by level, school, source, ritual/concentration/reaction/bonus-action type; feats can be filtered by source and general/racial category.


## v9 - Read-only rules reference

- Dedicated **Reference** tab for safely passing the app around the table.
- Fast spell and feat search with level, school, source, ritual/concentration, and feat-type filters.
- Reference cards are read-only and never mutate Noctis.
- The library is lazy-rendered/paginated to keep mobile scrolling responsive.

## v10 - Party spell reference and d20 rolls

- The read-only spell reference now contains **424 PHB 2014 + Ryoko spell entries**, including non-Wizard spells.
- Spell reference supports a **Class** filter, while Noctis' own catalogue remains **259 Wizard-eligible spells**.
- `data/reference-spells-2014.json` is used only by `/api/reference/spells`; normal spellbook, preparation, casting, discovery, and level-up routes continue using the Wizard-only catalogue.
- Initiative, all six ability checks, all saving throws, and all skills can be rolled directly from the Character dashboard.
- Rolls automatically include the character's current modifier.
- Roll mode supports **Normal**, **Advantage**, and **Disadvantage** and remembers the selected mode on the device.
- Dice results are transient UI state and are not written to Google Sheets.
- The expanded PHB reference catalogue received an additional OCR cleanup pass after import.
