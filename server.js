import express from "express";
import session from "express-session";
import { google } from "googleapis";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT = Number(process.env.PORT || 3000);
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const RULESET = process.env.DND_RULESET || "2014";
const APP_DATA_SHEET = "APP_DATA";

if (!SPREADSHEET_ID) {
  console.warn("SPREADSHEET_ID is not set.");
}

app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
}));

function getCredentials() {
  const encoded = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
  if (!encoded) throw new Error("GOOGLE_SERVICE_ACCOUNT_B64 is not configured.");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

function sheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  return google.sheets({ version: "v4", auth });
}

function requireAuth(req, res, next) {
  if (!APP_PASSWORD || req.session?.authenticated) return next();
  return res.status(401).json({ error: "Unauthorised" });
}

app.post("/api/login", (req, res) => {
  if (!APP_PASSWORD || req.body?.password === APP_PASSWORD) {
    req.session.authenticated = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: "Wrong password" });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/session", (req, res) => {
  res.json({ authenticated: !APP_PASSWORD || Boolean(req.session?.authenticated) });
});

async function getValues(range) {
  const sheets = sheetsClient();
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range
  });
  return result.data.values || [];
}

function cell(matrix, a1) {
  // Supports simple coordinates such as B2/AB2.
  const match = /^([A-Z]+)(\d+)$/.exec(a1);
  if (!match) return "";
  const letters = match[1];
  const row = Number(match[2]) - 1;
  let col = 0;
  for (const ch of letters) col = col * 26 + (ch.charCodeAt(0) - 64);
  col -= 1;
  return matrix?.[row]?.[col] ?? "";
}

function asNumber(v, fallback = 0) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

async function ensureAppDataSheet() {
  const sheets = sheetsClient();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: "sheets.properties"
  });
  const existing = (meta.data.sheets || []).find(s => s.properties?.title === APP_DATA_SHEET);

  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          addSheet: {
            properties: {
              title: APP_DATA_SHEET,
              hidden: false,
              gridProperties: { rowCount: 500, columnCount: 3 }
            }
          }
        }]
      }
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${APP_DATA_SHEET}!A1:C1`,
      valueInputOption: "RAW",
      requestBody: { values: [["type", "key", "value"]] }
    });
  }
}

async function readState() {
  await ensureAppDataSheet();
  const rows = await getValues(`${APP_DATA_SHEET}!A2:C500`);
  const state = {
    known: [],
    prepared: [],
    custom: [],
    notes: {},
    settings: {}
  };

  for (const [type, key, raw] of rows) {
    if (!type || !key) continue;
    if (type === "known") state.known.push(key);
    if (type === "prepared") state.prepared.push(key);
    if (type === "custom") {
      try { state.custom.push(JSON.parse(raw || "{}")); } catch {}
    }
    if (type === "note") state.notes[key] = raw || "";
    if (type === "setting") state.settings[key] = raw || "";
  }
  return state;
}

async function writeState(state) {
  await ensureAppDataSheet();
  const rows = [["type", "key", "value"]];

  for (const key of [...new Set(state.known || [])]) rows.push(["known", key, "1"]);
  for (const key of [...new Set(state.prepared || [])]) rows.push(["prepared", key, "1"]);
  for (const item of state.custom || []) rows.push(["custom", item.id, JSON.stringify(item)]);
  for (const [key, value] of Object.entries(state.notes || {})) rows.push(["note", key, String(value)]);
  for (const [key, value] of Object.entries(state.settings || {})) rows.push(["setting", key, String(value)]);

  const sheets = sheetsClient();
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${APP_DATA_SHEET}!A:C`
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${APP_DATA_SHEET}!A1:C${rows.length}`,
    valueInputOption: "RAW",
    requestBody: { values: rows }
  });
}

app.get("/api/character", requireAuth, async (req, res) => {
  try {
    const [main, info, state] = await Promise.all([
      getValues("MAIN!A1:AN36"),
      getValues("INFO!A1:AG48"),
      readState()
    ]);

    // These are the current coordinates in Shaun's sheet template.
    // The UI also lets you override level/INT if the sheet layout later moves.
    const name = String(cell(main, "B2") || "Noctis");
    const levelFromSheet = asNumber(cell(main, "AB2"), 3);
    const intScore = asNumber(cell(main, "B19"), 17);
    const intMod = Math.floor((intScore - 10) / 2);
    const proficiency = 2; // level 3; recalculated below for future levels

    const level = asNumber(state.settings.level, levelFromSheet);
    const prof = Math.ceil(level / 4) + 1;
    const effectiveInt = asNumber(state.settings.intScore, intScore);
    const effectiveIntMod = Math.floor((effectiveInt - 10) / 2);

    const preparedMax = Math.max(1, level + effectiveIntMod);

    res.json({
      character: {
        name,
        class: "Wizard",
        subclass: "School of Necromancy",
        race: "Tiefling",
        level,
        intScore: effectiveInt,
        intMod: effectiveIntMod,
        proficiencyBonus: prof,
        spellAttack: effectiveIntMod + prof,
        spellSaveDC: 8 + effectiveIntMod + prof,
        preparedMax,
        cantripsKnown: level < 4 ? 3 : level < 10 ? 4 : 5,
        spellbookMinimum: 6 + Math.max(0, level - 1) * 2,
        slots: slotTable(level)
      },
      state,
      source: {
        spreadsheetId: SPREADSHEET_ID,
        appDataSheet: APP_DATA_SHEET,
        ruleset: RULESET
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

function slotTable(level) {
  const table = {
    1:[2], 2:[3], 3:[4,2], 4:[4,3], 5:[4,3,2], 6:[4,3,3],
    7:[4,3,3,1], 8:[4,3,3,2], 9:[4,3,3,3,1], 10:[4,3,3,3,2],
    11:[4,3,3,3,2,1], 12:[4,3,3,3,2,1], 13:[4,3,3,3,2,1,1],
    14:[4,3,3,3,2,1,1], 15:[4,3,3,3,2,1,1,1],
    16:[4,3,3,3,2,1,1,1], 17:[4,3,3,3,2,1,1,1,1],
    18:[4,3,3,3,3,1,1,1,1], 19:[4,3,3,3,3,2,1,1,1],
    20:[4,3,3,3,3,2,2,1,1]
  };
  return table[Math.min(20, Math.max(1, level))] || [];
}

app.put("/api/state", requireAuth, async (req, res) => {
  try {
    const current = await readState();
    const next = {
      known: Array.isArray(req.body?.known) ? req.body.known : current.known,
      prepared: Array.isArray(req.body?.prepared) ? req.body.prepared : current.prepared,
      custom: Array.isArray(req.body?.custom) ? req.body.custom : current.custom,
      notes: req.body?.notes && typeof req.body.notes === "object" ? req.body.notes : current.notes,
      settings: req.body?.settings && typeof req.body.settings === "object" ? req.body.settings : current.settings
    };

    const level = asNumber(next.settings.level, 3);
    const intScore = asNumber(next.settings.intScore, 17);
    const intMod = Math.floor((intScore - 10) / 2);
    const maxPrepared = Math.max(1, level + intMod);

    if (next.prepared.length > maxPrepared) {
      return res.status(400).json({
        error: `Too many prepared spells. Level ${level} Wizard with INT ${intScore} can prepare ${maxPrepared}.`
      });
    }

    // Only levelled spells are prepared; cantrips are always available.
    await writeState(next);
    res.json({ ok: true, state: next });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const SRD_BASE = `https://www.dnd5eapi.co/api/${RULESET}`;
const LOCAL_SPELLS_PATH = path.join(__dirname, "data", "wizard-spells-2014.json");

function readLocalSpells() {
  try {
    if (!fs.existsSync(LOCAL_SPELLS_PATH)) return [];
    const parsed = JSON.parse(fs.readFileSync(LOCAL_SPELLS_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : (parsed.spells || []);
  } catch (err) {
    console.warn("Could not read local spell database:", err.message);
    return [];
  }
}

app.get("/api/spells", requireAuth, async (req, res) => {
  try {
    let results = readLocalSpells();

    if (!results.length) {
      const response = await fetch(`${SRD_BASE}/classes/wizard/spells`);
      if (!response.ok) throw new Error(`SRD API returned ${response.status}`);
      const data = await response.json();
      results = data.results || [];
    }

    const levelFilter = req.query.level !== undefined ? Number(req.query.level) : null;
    if (Number.isFinite(levelFilter)) results = results.filter(s => Number(s.level) === levelFilter);

    res.json({ results });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/spells/:index", requireAuth, async (req, res) => {
  try {
    const local = readLocalSpells();
    const spell = local.find(s => s.index === req.params.index);
    if (spell) return res.json(spell);

    const response = await fetch(`${SRD_BASE}/spells/${encodeURIComponent(req.params.index)}`);
    if (!response.ok) return res.status(response.status).json({ error: "Spell not found" });
    res.json(await response.json());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Noctis Companion listening on :${PORT}`);
});
