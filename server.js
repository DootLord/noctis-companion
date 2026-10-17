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
const SPELLS_SHEET = "SPELLS";
const SPELLBOOK_SHEET = "SpellBook";
const BAG_SHEET = "BAG";
const ABILITIES_SHEET = "ABILITIES";
const LOCAL_SPELLS_PATH = path.join(__dirname, "data", "wizard-spells-2014.json");
const LOCAL_FEATS_PATH = path.join(__dirname, "data", "feats-2014.json");

if (!SPREADSHEET_ID) console.warn("SPREADSHEET_ID is not set.");

app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" ? "auto" : false,
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
}));

app.get("/health", (_req, res) => res.status(200).json({ ok: true, service: "noctis-companion" }));

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

app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/session", (req, res) => res.json({ authenticated: !APP_PASSWORD || Boolean(req.session?.authenticated) }));

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

function readLocalFeats() {
  try {
    if (!fs.existsSync(LOCAL_FEATS_PATH)) return [];
    const parsed = JSON.parse(fs.readFileSync(LOCAL_FEATS_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : (parsed.feats || []);
  } catch (err) {
    console.warn("Could not read local feat database:", err.message);
    return [];
  }
}

const catalogue = readLocalSpells();
const spellByIndex = new Map(catalogue.map(s => [s.index, s]));
const feats = readLocalFeats();
const featById = new Map(feats.map(f => [f.id, f]));
const ASI_LEVELS = new Set([4, 8, 12, 16, 19]);
const ABILITY_CELLS = { str:"B8", dex:"B12", con:"B16", int:"B20", wis:"B26", cha:"B32" };
const ABILITY_NAMES = { str:"Strength", dex:"Dexterity", con:"Constitution", int:"Intelligence", wis:"Wisdom", cha:"Charisma" };

async function getValues(range) {
  const result = await sheetsClient().spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
  return result.data.values || [];
}

async function updateRanges(data) {
  if (!data.length) return;
  await sheetsClient().spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: "RAW", data }
  });
}

function one(range, value) {
  return { range, values: [[value ?? ""]] };
}

function cell(matrix, a1) {
  const match = /^([A-Z]+)(\d+)$/.exec(a1);
  if (!match) return "";
  const row = Number(match[2]) - 1;
  let col = 0;
  for (const ch of match[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return matrix?.[row]?.[col - 1] ?? "";
}

function asNumber(v, fallback = 0) {
  if (v === null || v === undefined || String(v).trim() === "") return fallback;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(v, min, max, fallback) {
  const n = asNumber(v, fallback);
  return Number.isFinite(n) && n >= min && n <= max ? Math.trunc(n) : fallback;
}

function ordinal(n) {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

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

async function ensureAppDataSheet() {
  const sheets = sheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: "sheets.properties" });
  const existing = (meta.data.sheets || []).find(s => s.properties?.title === APP_DATA_SHEET);
  if (existing) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: APP_DATA_SHEET, hidden: false, gridProperties: { rowCount: 500, columnCount: 3 } } } }] }
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${APP_DATA_SHEET}!A1:C1`,
    valueInputOption: "RAW",
    requestBody: { values: [["type", "key", "value"]] }
  });
}

function emptyState() {
  return {
    known: [],
    prepared: [],
    custom: [],
    notes: {},
    settings: {},
    slotsUsed: {},
    casts: {},
    resources: { arcaneRecoveryUsed: false },
    feats: [],
    levelHistory: []
  };
}

async function readState() {
  await ensureAppDataSheet();
  const rows = await getValues(`${APP_DATA_SHEET}!A2:C500`);
  const state = emptyState();

  for (const [type, key, raw] of rows) {
    if (!type || !key) continue;
    if (type === "known") state.known.push(key);
    if (type === "prepared") state.prepared.push(key);
    if (type === "custom") { try { state.custom.push(JSON.parse(raw || "{}")); } catch {} }
    if (type === "note") state.notes[key] = raw || "";
    if (type === "setting") state.settings[key] = raw || "";
    if (type === "slot") state.slotsUsed[key] = Math.max(0, asNumber(raw, 0));
    if (type === "cast") state.casts[key] = Math.max(0, asNumber(raw, 0));
    if (type === "resource") state.resources[key] = raw === "1" || raw === "true";
    if (type === "feat") { try { state.feats.push(JSON.parse(raw || "{}")); } catch {} }
    if (type === "levelup") { try { state.levelHistory.push(JSON.parse(raw || "{}")); } catch {} }
  }

  state.known = [...new Set(state.known)];
  state.prepared = [...new Set(state.prepared)].filter(x => state.known.includes(x));
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
  for (const [key, value] of Object.entries(state.slotsUsed || {})) rows.push(["slot", key, String(value)]);
  for (const [key, value] of Object.entries(state.casts || {})) rows.push(["cast", key, String(value)]);
  for (const [key, value] of Object.entries(state.resources || {})) rows.push(["resource", key, value ? "1" : "0"]);
  (state.feats || []).forEach((feat, i) => rows.push(["feat", `${feat.id || "feat"}:${i}`, JSON.stringify(feat)]));
  (state.levelHistory || []).forEach(entry => rows.push(["levelup", String(entry.level || rows.length), JSON.stringify(entry)]));

  const sheets = sheetsClient();
  await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `${APP_DATA_SHEET}!A:C` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${APP_DATA_SHEET}!A1:C${rows.length}`,
    valueInputOption: "RAW",
    requestBody: { values: rows }
  });
}

async function getCharacter(state) {
  const main = await getValues("MAIN!A1:AN36");
  const name = String(cell(main, "B2") || "Noctis");
  const levelFromSheet = clampInt(cell(main, "AC2"), 1, 20, 3);
  const sheetAbilities = {};
  for (const [key, a1] of Object.entries(ABILITY_CELLS)) sheetAbilities[key] = clampInt(cell(main, a1), 1, 30, key === "int" ? 17 : 10);

  // Invalid/empty overrides are ignored rather than corrupting the character.
  const level = clampInt(state.settings.level, 1, 20, levelFromSheet);
  const intScore = clampInt(state.settings.intScore, 1, 30, sheetAbilities.int);
  const abilities = { ...sheetAbilities, int: intScore };
  const intMod = Math.floor((intScore - 10) / 2);
  const prof = Math.ceil(level / 4) + 1;
  const slots = slotTable(level);
  const slotsUsed = {};
  slots.forEach((max, i) => { slotsUsed[i + 1] = Math.min(max, Math.max(0, asNumber(state.slotsUsed[i + 1], 0))); });

  return {
    name,
    class: "Wizard",
    subclass: "School of Necromancy",
    race: "Tiefling",
    level,
    abilities,
    intScore,
    intMod,
    proficiencyBonus: prof,
    spellAttack: intMod + prof,
    spellSaveDC: 8 + intMod + prof,
    preparedMax: Math.max(1, level + intMod),
    cantripsKnown: cantripsKnownAt(level),
    spellbookMinimum: 6 + Math.max(0, level - 1) * 2,
    slots,
    slotsUsed,
    arcaneRecoveryBudget: Math.ceil(level / 2)
  };
}

function cantripsKnownAt(level) {
  return level < 4 ? 3 : level < 10 ? 4 : 5;
}

function abilityModifier(score) {
  return Math.floor((Number(score || 10) - 10) / 2);
}

function featEligibility(feat, character, state) {
  if (!feat) return { eligible:false, reason:"Unknown feat" };
  if (!feat.repeatable && (state.feats || []).some(x => x.id === feat.id)) return { eligible:false, reason:"Already chosen" };
  const p = feat.prerequisite;
  if (!p) return { eligible:true, reason:"" };
  if (p.spellcasting && character.class !== "Wizard") return { eligible:false, reason:"Requires spellcasting" };
  if (p.ability && Number(character.abilities?.[p.ability] || 0) < Number(p.min || 0)) {
    return { eligible:false, reason:`Requires ${ABILITY_NAMES[p.ability] || p.ability} ${p.min}+` };
  }
  if (p.anyAbility) {
    const ok = (p.anyAbility.abilities || []).some(a => Number(character.abilities?.[a] || 0) >= Number(p.anyAbility.min || 0));
    if (!ok) return { eligible:false, reason:`Requires ${p.anyAbility.abilities.map(a=>ABILITY_NAMES[a]).join(" or ")} ${p.anyAbility.min}+` };
  }
  if (p.armor) {
    // Noctis is a single-class Wizard, so the base class grants no armour proficiency.
    return { eligible:false, reason:`Requires ${p.armor} armour proficiency` };
  }
  return { eligible:true, reason:"" };
}

function spellParts(spell) {
  const school = typeof spell.school === "string" ? spell.school : (spell.school?.name || "Unknown");
  const components = Array.isArray(spell.components) ? spell.components : [];
  const summary = String(spell.summary || spell.description || (spell.desc || [""])[0] || "").trim();
  return { school, components, summary };
}

function spellEntryPositions(level) {
  if (level === 0) {
    return ["F3","K3","P3","U3","Z3","F4","K4","P4","U4","Z4"].map(name => ({ name }));
  }
  const start = 6 + (level - 1) * 9;
  const entries = [];
  const make = (col, row) => {
    const maps = {
      B: { prep:"C", con:"E", rit:"G", v:"H", s:"I", m:"J" },
      L: { prep:"M", con:"O", rit:"Q", v:"R", s:"S", m:"T" },
      V: { prep:"W", con:"Y", rit:"AA", v:"AB", s:"AC", m:"AD" }
    };
    const f = maps[col];
    return { name:`${col}${row}`, prep:`${f.prep}${row+1}`, con:`${f.con}${row+1}`, rit:`${f.rit}${row+1}`, v:`${f.v}${row+1}`, s:`${f.s}${row+1}`, m:`${f.m}${row+1}` };
  };
  entries.push(make("L", start), make("V", start));
  for (const off of [2,4,6]) entries.push(make("B", start + off), make("L", start + off), make("V", start + off));
  return entries;
}

function spellBookIndexCells(level) {
  const headerRow = level === 0 ? 1 : 1 + level * 4;
  const row1 = headerRow + 1;
  const row2 = headerRow + 2;
  const cols = ["B","G","L","Q","V"];
  return [...cols.map(c => `${c}${row1}`), ...cols.map(c => `${c}${row2}`)];
}

function detailCardStarts() {
  const out = [];
  for (let row = 54; row <= 990; row += 13) out.push(row);
  return out;
}

async function syncSpellSheet(state, character, { names = true, prepared = true, slots = true } = {}) {
  const data = [];
  const knownSpells = state.known.map(x => spellByIndex.get(x)).filter(Boolean);

  if (names || prepared) {
    for (let level = 0; level <= 9; level++) {
      const positions = spellEntryPositions(level);
      let spells = knownSpells.filter(s => Number(s.level) === level).sort((a,b) => a.name.localeCompare(b.name));
      const overflow = Math.max(0, spells.length - positions.length);
      if (overflow) spells = [...spells.slice(0, positions.length - 1), { name: `+${overflow + 1} more — see SpellBook`, index:"__overflow__", level }];

      positions.forEach((pos, i) => {
        const spell = spells[i];
        if (names) data.push(one(`${SPELLS_SHEET}!${pos.name}`, spell?.name || ""));
        if (level > 0 && prepared) {
          const parts = spell ? spellParts(spell) : { components: [] };
          const real = spell && spell.index !== "__overflow__";
          data.push(one(`${SPELLS_SHEET}!${pos.prep}`, real && state.prepared.includes(spell.index) ? 1 : 0));
          data.push(one(`${SPELLS_SHEET}!${pos.con}`, real && spell.concentration ? 1 : 0));
          data.push(one(`${SPELLS_SHEET}!${pos.rit}`, real && spell.ritual ? 1 : 0));
          data.push(one(`${SPELLS_SHEET}!${pos.v}`, real && parts.components.includes("V") ? 1 : 0));
          data.push(one(`${SPELLS_SHEET}!${pos.s}`, real && parts.components.includes("S") ? 1 : 0));
          data.push(one(`${SPELLS_SHEET}!${pos.m}`, real && parts.components.includes("M") ? 1 : 0));
        }
      });
    }
  }

  if (slots) {
    for (let level = 1; level <= 9; level++) {
      const start = 6 + (level - 1) * 9;
      const max = character.slots[level - 1] || 0;
      const used = Math.min(max, asNumber(state.slotsUsed[level], 0));
      data.push(one(`${SPELLS_SHEET}!D${start}`, max));
      const maxRow = [];
      const usedRow = [];
      for (let i = 0; i < 6; i++) {
        maxRow.push(i < max ? 0 : "");
        usedRow.push(i < max ? (i < used ? 1 : 0) : "");
      }
      data.push({ range: `${SPELLS_SHEET}!E${start}:J${start}`, values: [maxRow] });
      data.push({ range: `${SPELLS_SHEET}!E${start+1}:J${start+1}`, values: [usedRow] });
    }
  }

  await updateRanges(data);
}

async function syncSpellBook(state) {
  const data = [];
  const knownSpells = state.known.map(x => spellByIndex.get(x)).filter(Boolean).sort((a,b) => Number(a.level)-Number(b.level) || a.name.localeCompare(b.name));

  // Readable quick index at the top, grouped by spell level.
  for (let level = 0; level <= 9; level++) {
    const cells = spellBookIndexCells(level);
    let spells = knownSpells.filter(s => Number(s.level) === level);
    const overflow = Math.max(0, spells.length - cells.length);
    if (overflow) spells = [...spells.slice(0, cells.length - 1), { name: `+${overflow + 1} more below` }];
    cells.forEach((c, i) => data.push(one(`${SPELLBOOK_SHEET}!${c}`, spells[i]?.name || "")));
  }

  // Detailed cards. Row 41 is the sheet's template; rows 54+ are safe fillable copies.
  const starts = detailCardStarts();
  starts.forEach((row, i) => {
    const spell = knownSpells[i];
    const parts = spell ? spellParts(spell) : null;
    const levelText = spell ? (Number(spell.level) === 0 ? "Cantrip" : `${ordinal(Number(spell.level))} Lvl`) : "";
    const comp = spell ? `${parts.components.join(", ")}${spell.material ? ` — ${spell.material}` : ""}` : "";
    const desc = spell ? [parts.summary, spell.higher_level ? `At higher levels: ${spell.higher_level}` : ""].filter(Boolean).join("\n\n") : "";

    data.push(one(`${SPELLBOOK_SHEET}!B${row}`, spell?.name || ""));
    data.push(one(`${SPELLBOOK_SHEET}!O${row+1}`, levelText));
    data.push(one(`${SPELLBOOK_SHEET}!S${row+1}`, spell ? (spell.ritual ? "Yes" : "No") : ""));
    data.push(one(`${SPELLBOOK_SHEET}!D${row+2}`, parts?.school || ""));
    data.push(one(`${SPELLBOOK_SHEET}!K${row+2}`, spell?.casting_time || ""));
    data.push(one(`${SPELLBOOK_SHEET}!S${row+2}`, comp));
    data.push(one(`${SPELLBOOK_SHEET}!D${row+3}`, spell?.range || ""));
    data.push(one(`${SPELLBOOK_SHEET}!K${row+3}`, spell?.duration || ""));
    data.push(one(`${SPELLBOOK_SHEET}!B${row+4}`, desc));
  });

  await updateRanges(data);
}

async function syncFeatsSheet(state) {
  const slots = [];
  for (let row = 19; row <= 25; row++) slots.push(`B${row}`);
  for (let row = 19; row <= 25; row++) slots.push(`U${row}`);
  const data = [one(`${ABILITIES_SHEET}!B18`, "FEATS / CUSTOM")];
  slots.forEach((cellRef, i) => {
    const chosen = (state.feats || [])[i];
    const feat = chosen ? featById.get(chosen.id) : null;
    let text = "";
    if (feat) {
      const boost = chosen.ability ? ` (+1 ${String(chosen.ability).toUpperCase()})` : "";
      const note = chosen.note ? ` [${chosen.note}]` : "";
      text = `${feat.name}${boost}${note} — ${feat.summary}`;
    }
    data.push(one(`${ABILITIES_SHEET}!${cellRef}`, text));
  });
  await updateRanges(data);
}

async function syncAll(state, character) {
  await Promise.all([
    syncSpellSheet(state, character, { names:true, prepared:true, slots:true }),
    syncSpellBook(state),
    syncFeatsSheet(state)
  ]);
}

app.get("/api/character", requireAuth, async (_req, res) => {
  try {
    const state = await readState();
    const character = await getCharacter(state);
    res.json({ character, state, source: { spreadsheetId: SPREADSHEET_ID, appDataSheet: APP_DATA_SHEET, ruleset: RULESET } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/spells", requireAuth, (req, res) => {
  let results = catalogue;
  const level = req.query.level !== undefined ? Number(req.query.level) : null;
  if (Number.isFinite(level)) results = results.filter(s => Number(s.level) === level);
  res.json({ results });
});

app.get("/api/spells/:index", requireAuth, (req, res) => {
  const spell = spellByIndex.get(req.params.index);
  if (!spell) return res.status(404).json({ error: "Spell not found" });
  res.json(spell);
});

app.get("/api/feats", requireAuth, async (_req, res) => {
  try {
    const state = await readState();
    const character = await getCharacter(state);
    res.json({ results: feats.map(feat => ({ ...feat, ...featEligibility(feat, character, state) })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/state", requireAuth, async (req, res) => {
  try {
    const current = await readState();
    const next = {
      ...current,
      known: Array.isArray(req.body?.known) ? [...new Set(req.body.known)] : current.known,
      prepared: Array.isArray(req.body?.prepared) ? [...new Set(req.body.prepared)] : current.prepared,
      custom: Array.isArray(req.body?.custom) ? req.body.custom : current.custom,
      notes: req.body?.notes && typeof req.body.notes === "object" ? req.body.notes : current.notes,
      settings: req.body?.settings && typeof req.body.settings === "object" ? req.body.settings : current.settings
    };
    next.prepared = next.prepared.filter(x => next.known.includes(x) && Number(spellByIndex.get(x)?.level || 0) > 0);

    const character = await getCharacter(next);
    if (next.prepared.length > character.preparedMax) {
      return res.status(400).json({ error: `Too many prepared spells. You can prepare ${character.preparedMax}.` });
    }

    const knownChanged = JSON.stringify([...current.known].sort()) !== JSON.stringify([...next.known].sort());
    const preparedChanged = JSON.stringify([...current.prepared].sort()) !== JSON.stringify([...next.prepared].sort());
    await writeState(next);

    if (knownChanged) {
      await Promise.all([
        syncSpellBook(next),
        syncSpellSheet(next, character, { names:true, prepared:true, slots:false })
      ]);
    } else if (preparedChanged) {
      await syncSpellSheet(next, character, { names:false, prepared:true, slots:false });
    }

    res.json({ ok: true, state: next, character });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/level-up", requireAuth, async (req, res) => {
  try {
    const state = await readState();
    const character = await getCharacter(state);
    if (character.level >= 20) return res.status(400).json({ error: "Noctis is already Wizard 20." });

    const targetLevel = character.level + 1;
    const targetSlots = slotTable(targetLevel);
    const maxSpellLevel = targetSlots.length;
    const newSpells = Array.isArray(req.body?.spells) ? [...new Set(req.body.spells.map(String))] : [];
    if (newSpells.length !== 2) return res.status(400).json({ error: "Choose exactly two new levelled wizard spells for this level." });
    for (const index of newSpells) {
      const spell = spellByIndex.get(index);
      if (!spell || Number(spell.level) < 1 || Number(spell.level) > maxSpellLevel) return res.status(400).json({ error: "One of the selected spells is not available at your new Wizard level." });
      if (state.known.includes(index)) return res.status(400).json({ error: `${spell.name} is already in your spellbook.` });
    }

    const needsCantrip = cantripsKnownAt(targetLevel) > cantripsKnownAt(character.level);
    const cantrip = String(req.body?.cantrip || "");
    if (needsCantrip) {
      const spell = spellByIndex.get(cantrip);
      if (!spell || Number(spell.level) !== 0 || state.known.includes(cantrip)) return res.status(400).json({ error: "Choose one new Wizard cantrip for this level." });
    }

    const abilityUpdates = {};
    let advancement = null;
    let chosenFeat = null;
    if (ASI_LEVELS.has(targetLevel)) {
      advancement = String(req.body?.advancement || "");
      if (!['feat','asi'].includes(advancement)) return res.status(400).json({ error: "Choose either a feat or an Ability Score Improvement." });

      if (advancement === 'feat') {
        const feat = featById.get(String(req.body?.featId || ""));
        const eligibility = featEligibility(feat, character, state);
        if (!eligibility.eligible) return res.status(400).json({ error: eligibility.reason || "That feat is not currently available." });
        let boostAbility = null;
        if ((feat.abilityIncrease || []).length) {
          boostAbility = String(req.body?.featAbility || "").toLowerCase();
          if (!boostAbility && feat.abilityIncrease.length === 1) boostAbility = feat.abilityIncrease[0];
          if (!feat.abilityIncrease.includes(boostAbility)) return res.status(400).json({ error: `Choose which ability ${feat.name} increases.` });
          const current = Number(character.abilities?.[boostAbility] || 0);
          if (current >= 20) return res.status(400).json({ error: `${ABILITY_NAMES[boostAbility]} is already 20.` });
          abilityUpdates[boostAbility] = current + 1;
        }
        chosenFeat = { id:feat.id, ability:boostAbility, note:String(req.body?.featNote || "").trim().slice(0,180), chosenAtLevel:targetLevel };
      } else {
        const mode = String(req.body?.asi?.mode || "");
        const choices = Array.isArray(req.body?.asi?.abilities) ? req.body.asi.abilities.map(x=>String(x).toLowerCase()) : [];
        if (mode === 'plus2') {
          const a = choices[0];
          if (!ABILITY_CELLS[a]) return res.status(400).json({ error: "Choose an ability for the +2 ASI." });
          const current = Number(character.abilities?.[a] || 0);
          if (current + 2 > 20) return res.status(400).json({ error: `${ABILITY_NAMES[a]} cannot be raised above 20 by this ASI.` });
          abilityUpdates[a] = current + 2;
        } else if (mode === 'split') {
          const unique = [...new Set(choices.filter(a=>ABILITY_CELLS[a]))];
          if (unique.length !== 2) return res.status(400).json({ error: "Choose two different abilities for +1/+1." });
          for (const a of unique) {
            const current = Number(character.abilities?.[a] || 0);
            if (current + 1 > 20) return res.status(400).json({ error: `${ABILITY_NAMES[a]} cannot be raised above 20 by this ASI.` });
            abilityUpdates[a] = current + 1;
          }
        } else return res.status(400).json({ error: "Choose +2 to one ability or +1 to two abilities." });
      }
    }

    state.known = [...new Set([...state.known, ...newSpells, ...(needsCantrip ? [cantrip] : [])])];
    const autoAdded = [];
    if (targetLevel === 6 && spellByIndex.has('animate-dead') && !state.known.includes('animate-dead')) {
      state.known.push('animate-dead');
      autoAdded.push('animate-dead');
    }
    if (chosenFeat) state.feats.push(chosenFeat);

    const sheetWrites = [one(`MAIN!AC2`, targetLevel)];
    for (const [ability, score] of Object.entries(abilityUpdates)) sheetWrites.push(one(`MAIN!${ABILITY_CELLS[ability]}`, score));
    await updateRanges(sheetWrites);

    // A real level-up writes back to the sheet, so stale troubleshooting overrides should not mask it.
    delete state.settings.level;
    if (Object.keys(abilityUpdates).includes('int')) delete state.settings.intScore;
    state.levelHistory.push({
      level:targetLevel,
      spells:newSpells,
      cantrip:needsCantrip ? cantrip : null,
      advancement,
      feat:chosenFeat,
      asi:advancement === 'asi' ? req.body.asi : null,
      autoAdded
    });

    await writeState(state);
    const updatedCharacter = await getCharacter(state);
    await syncAll(state, updatedCharacter);
    res.json({ ok:true, state, character:updatedCharacter, levelUp:state.levelHistory[state.levelHistory.length - 1] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/sync", requireAuth, async (_req, res) => {
  try {
    const state = await readState();
    const character = await getCharacter(state);
    await syncAll(state, character);
    res.json({ ok:true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/cast", requireAuth, async (req, res) => {
  try {
    const index = String(req.body?.index || "");
    const spell = spellByIndex.get(index);
    if (!spell) return res.status(404).json({ error: "Spell not found" });

    const state = await readState();
    if (!state.known.includes(index)) return res.status(400).json({ error: "That spell is not in your spellbook." });
    const character = await getCharacter(state);
    const baseLevel = Number(spell.level || 0);

    let castLevel = 0;
    if (baseLevel > 0) {
      if (!state.prepared.includes(index)) return res.status(400).json({ error: "Prepare this spell before casting it." });
      castLevel = clampInt(req.body?.castLevel, baseLevel, character.slots.length, baseLevel);
      if (castLevel < baseLevel) return res.status(400).json({ error: "That slot is too low for this spell." });
      const max = character.slots[castLevel - 1] || 0;
      const used = asNumber(state.slotsUsed[castLevel], 0);
      if (!max || used >= max) return res.status(400).json({ error: `No ${ordinal(castLevel)}-level spell slots remaining.` });
      state.slotsUsed[castLevel] = used + 1;
    }

    const castKey = `${index}@${castLevel}`;
    state.casts[castKey] = asNumber(state.casts[castKey], 0) + 1;
    await writeState(state);
    const updatedCharacter = await getCharacter(state);
    await syncSpellSheet(state, updatedCharacter, { names:false, prepared:false, slots:true });

    res.json({
      ok:true,
      state,
      character: updatedCharacter,
      cast: {
        spell,
        castLevel,
        remaining: castLevel ? (updatedCharacter.slots[castLevel-1] - asNumber(state.slotsUsed[castLevel],0)) : null
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/rest", requireAuth, async (req, res) => {
  try {
    const type = req.body?.type;
    const state = await readState();
    const character = await getCharacter(state);

    if (type === "long") {
      state.slotsUsed = {};
      state.casts = {};
      state.resources.arcaneRecoveryUsed = false;
    } else if (type === "short") {
      const recover = Array.isArray(req.body?.recover) ? req.body.recover.map(Number).filter(Number.isFinite) : [];
      if (recover.length) {
        if (state.resources.arcaneRecoveryUsed) return res.status(400).json({ error: "Arcane Recovery has already been used since your last long rest." });
        const cost = recover.reduce((a,b) => a + b, 0);
        if (cost > character.arcaneRecoveryBudget) return res.status(400).json({ error: `Arcane Recovery can restore combined slot levels up to ${character.arcaneRecoveryBudget}.` });
        for (const level of recover) {
          if (level < 1 || level > 5 || !character.slots[level-1]) return res.status(400).json({ error: "Arcane Recovery can only restore spell slots of 5th level or lower that you actually have." });
          const used = asNumber(state.slotsUsed[level], 0);
          if (used <= 0) return res.status(400).json({ error: `You have no spent ${ordinal(level)}-level slot to recover.` });
          state.slotsUsed[level] = used - 1;
        }
        state.resources.arcaneRecoveryUsed = true;
      }
    } else {
      return res.status(400).json({ error: "Rest type must be short or long." });
    }

    await writeState(state);
    const updatedCharacter = await getCharacter(state);
    await syncSpellSheet(state, updatedCharacter, { names:false, prepared:false, slots:true });
    res.json({ ok:true, state, character:updatedCharacter });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

function inventoryCells() {
  const cells = [];
  for (let row = 3; row <= 33; row++) cells.push({ qty:`I${row}`, name:`K${row}`, cost:`U${row}`, weight:`Y${row}` });
  for (let row = 3; row <= 33; row++) cells.push({ qty:`AD${row}`, name:`AF${row}`, cost:`AP${row}`, weight:`AT${row}` });
  return cells;
}

app.get("/api/inventory", requireAuth, async (_req, res) => {
  try {
    const ranges = [
      `${BAG_SHEET}!B7`, `${BAG_SHEET}!B10`, `${BAG_SHEET}!B13`, `${BAG_SHEET}!B16`, `${BAG_SHEET}!B19`,
      ...inventoryCells().flatMap(c => Object.values(c).map(x => `${BAG_SHEET}!${x}`))
    ];
    const result = await sheetsClient().spreadsheets.values.batchGet({ spreadsheetId: SPREADSHEET_ID, ranges });
    const values = result.data.valueRanges || [];
    const val = i => values[i]?.values?.[0]?.[0] ?? "";
    const coins = { cp:asNumber(val(0),0), sp:asNumber(val(1),0), ep:asNumber(val(2),0), gp:asNumber(val(3),0), pp:asNumber(val(4),0) };
    const items = [];
    let p = 5;
    for (const _c of inventoryCells()) {
      const item = { qty:val(p++), name:String(val(p++) || ""), cost:String(val(p++) || ""), weight:String(val(p++) || "") };
      if (item.name || item.qty || item.cost || item.weight) items.push(item);
    }
    res.json({ coins, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/inventory", requireAuth, async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 62) : [];
    const coins = req.body?.coins && typeof req.body.coins === "object" ? req.body.coins : {};
    const cells = inventoryCells();
    const data = [];
    cells.forEach((c, i) => {
      const item = items[i] || {};
      data.push(one(`${BAG_SHEET}!${c.qty}`, item.qty ?? ""));
      data.push(one(`${BAG_SHEET}!${c.name}`, item.name ?? ""));
      data.push(one(`${BAG_SHEET}!${c.cost}`, item.cost ?? ""));
      data.push(one(`${BAG_SHEET}!${c.weight}`, item.weight ?? ""));
    });
    data.push(one(`${BAG_SHEET}!B7`, asNumber(coins.cp,0)));
    data.push(one(`${BAG_SHEET}!B10`, asNumber(coins.sp,0)));
    data.push(one(`${BAG_SHEET}!B13`, asNumber(coins.ep,0)));
    data.push(one(`${BAG_SHEET}!B16`, asNumber(coins.gp,0)));
    data.push(one(`${BAG_SHEET}!B19`, asNumber(coins.pp,0)));
    await updateRanges(data);
    res.json({ ok:true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Front-end assets intentionally use no-store. Coolify rolling deploys can otherwise
// leave a browser with old HTML and new JavaScript (or vice versa), which causes
// missing-element startup errors after an update. The app is small, so freshness is
// more valuable than asset caching here.
app.use(express.static(path.join(__dirname, "public"), {
  etag: false,
  lastModified: false,
  maxAge: 0,
  setHeaders(res) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
}));
app.get("/{*splat}", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const server = app.listen(PORT, "0.0.0.0", () => console.log(`Noctis Companion listening on 0.0.0.0:${PORT}`));
server.on("error", err => { console.error("Failed to start HTTP server:", err); process.exit(1); });
