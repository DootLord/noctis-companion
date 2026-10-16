# Spell data

`wizard-spells-2014.json` is the local spell database used by the app.

If this file contains spell records, the server uses them first. If it is empty, the current build falls back to the public 2014 SRD API so the UI remains usable.

The Player's Handbook import can populate this file in the same schema consumed by the frontend.
