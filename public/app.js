const UI_VERSION = "10.0.0";
const $ = q => document.querySelector(q);
const $$ = q => [...document.querySelectorAll(q)];

const REQUIRED_UI = [
  "#login", "#loginForm", "#app", "#charName", "#subtitle", "#dc", "#atk", "#prepCount",
  "#currentHp", "#maxHp", "#combatAc", "#combatReference", "#saveList", "#skillList",
  "#slotDashboard", "#preparedList", "#bookList", "#discoverList", "#inventoryRows", "#levelCards",
  "#ownedFeats", "#featCatalogue", "#levelUpForm", "#nextLevelSummary", "#levelSpell1", "#levelSpell2",
  "#levelFilter", "#schoolFilter", "#bookSearch", "#spellSearch", "#featSearch", "#castResult", "#toast",
  "#referenceSpellSearch", "#referenceSpellLevel", "#referenceSpellSchool", "#referenceSpellClass", "#referenceSpellSource", "#referenceSpellTrait",
  "#referenceSpellList", "#rollResult", "#referenceFeatSearch", "#referenceFeatType", "#referenceFeatSource", "#referenceFeatList"
];

function verifyUiVersion() {
  const missing = REQUIRED_UI.filter(selector => !$(selector));
  if (!missing.length) {
    sessionStorage.removeItem("noctis-ui-refresh");
    return true;
  }

  // A Coolify rolling deploy can briefly pair cached HTML with a newer JS bundle.
  // Reload once; server.js now sends no-store headers so the second request gets
  // a matched HTML/CSS/JS set.
  if (!sessionStorage.getItem("noctis-ui-refresh")) {
    sessionStorage.setItem("noctis-ui-refresh", UI_VERSION);
    location.reload();
    return false;
  }

  document.body.innerHTML = `<main class="content-shell"><div class="panel startup-panel"><div class="eyebrow">INTERFACE ERROR · v${UI_VERSION}</div><h2>Companion files are out of sync</h2><p class="muted">Missing: ${escapeHtml(missing.join(", "))}. Redeploy the current build and refresh once.</p><button class="primary" onclick="location.reload()">Reload companion</button></div></main>`;
  return false;
}

let model = null;
let catalogue = [];
let referenceCatalogue = [];
let featCatalogue = [];
let inventory = { coins: {}, items: [] };
let inventoryDraft = [];
let discoverLimit = window.matchMedia("(max-width: 700px)").matches ? 24 : 60;
let referenceMode = "spells";
let referenceSpellLimit = window.matchMedia("(max-width: 700px)").matches ? 36 : 72;
let rollMode = localStorage.getItem("noctis-roll-mode") || "normal";

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== "/api/session" && url !== "/api/login") {
    $("#app")?.classList.add("hidden");
    $("#login")?.classList.remove("hidden");
    throw new Error("Your session expired. Sign in again.");
  }
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

function toast(message, type = "info") {
  const el = $("#toast");
  el.textContent = message;
  el.dataset.type = type;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}

function setSheetStatus(state) {
  const el = $("#sheetSyncStatus");
  if (!el) return;
  const labels = { syncing:"↻ Syncing…", synced:"✓ Sheet synced", error:"! Sync failed" };
  el.textContent = labels[state] || labels.synced;
  el.dataset.state = state;
}

async function withButtonBusy(button, task, busyLabel = "Working…") {
  if (!button || button.disabled) return;
  const old = button.textContent;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  if (busyLabel) button.textContent = busyLabel;
  try { return await task(); }
  finally {
    if (button.isConnected) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.textContent = old;
    }
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[ch]);
}

function ordinal(n) {
  if (Number(n) === 1) return "1st";
  if (Number(n) === 2) return "2nd";
  if (Number(n) === 3) return "3rd";
  return `${n}th`;
}

function schoolName(spell) {
  return typeof spell.school === "string" ? spell.school : (spell.school?.name || "Unknown");
}

function componentsText(spell) {
  const comps = Array.isArray(spell.components) ? spell.components.join(", ") : "";
  return `${comps}${spell.material ? ` — ${spell.material}` : ""}`;
}

function spellSummary(spell) {
  const text = String(spell.summary || spell.description || (spell.desc || [""])[0] || "No description available.").trim();
  return text.length > 480 ? `${text.slice(0, 477).replace(/\s+\S*$/, "")}…` : text;
}

function saveCue(spell) {
  const text = `${spell.summary || ""} ${spell.description || ""}`;
  const save = text.match(/(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw/i);
  if (save) return `${save[1].slice(0,3).toUpperCase()} save DC ${model.character.spellSaveDC}`;
  if (/spell attack/i.test(text)) return `Spell attack ${model.character.spellAttack >= 0 ? "+" : ""}${model.character.spellAttack}`;
  if (/automatically hits|hits automatically/i.test(text)) return "No attack roll";
  return "";
}

function practicalHints(spell) {
  const hints = [];
  const cast = String(spell.casting_time || "").toLowerCase();
  if (cast.includes("reaction")) hints.push("Reaction — keep the trigger in mind and a slot available.");
  else if (cast.includes("bonus")) hints.push("Bonus action — leaves your action free.");
  if (spell.concentration) hints.push("Concentration — taking damage can force a CON save, and another concentration spell will end this one.");
  if (spell.ritual) hints.push("Wizard ritual — if it is in your spellbook, you can ritual-cast it without preparing it (takes 10 extra minutes).");
  if (spell.material) hints.push("Check the material component; your focus can replace it unless the component has a listed cost or is consumed.");
  return hints;
}

function getSpell(index) {
  return catalogue.find(s => s.index === index);
}

function getReferenceSpell(index) {
  return referenceCatalogue.find(s => s.index === index);
}

function castsForSpell(index) {
  return Object.entries(model.state.casts || {}).filter(([k]) => k.startsWith(`${index}@`)).reduce((n,[,v]) => n + Number(v || 0), 0);
}

function availableSlotLevels(spell) {
  const base = Number(spell.level || 0);
  if (base === 0) return [0];
  const levels = [];
  model.character.slots.forEach((max, i) => {
    const level = i + 1;
    const used = Number(model.state.slotsUsed?.[level] || 0);
    if (level >= base && max - used > 0) levels.push(level);
  });
  return levels;
}

function castControls(spell) {
  const base = Number(spell.level || 0);
  const prepared = model.state.prepared.includes(spell.index);
  const knownCantrip = base === 0 && model.state.known.includes(spell.index);
  if (!prepared && !knownCantrip) return "";

  if (base === 0) {
    return `<div class="cast-controls"><button class="cast-button" data-action="cast" data-index="${spell.index}" data-cast-level="0">Cast Cantrip</button><span class="cast-count">Cast ${castsForSpell(spell.index)}× since long rest</span></div>`;
  }

  const levels = availableSlotLevels(spell);
  const options = levels.map(l => `<option value="${l}">${ordinal(l)}-level slot · ${model.character.slots[l-1] - Number(model.state.slotsUsed?.[l] || 0)} left</option>`).join("");
  return `<div class="cast-controls">
    <select class="cast-level" data-cast-select="${spell.index}" ${levels.length ? "" : "disabled"}>${options || `<option>No slots available</option>`}</select>
    <button class="cast-button" data-action="cast" data-index="${spell.index}" ${levels.length ? "" : "disabled"}>Cast</button>
    <span class="cast-count">Cast ${castsForSpell(spell.index)}× since long rest</span>
  </div>`;
}

function spellCard(spell, mode) {
  const known = model.state.known.includes(spell.index);
  const prepared = model.state.prepared.includes(spell.index);
  const level = Number(spell.level || 0);
  const cue = saveCue(spell);
  const hints = practicalHints(spell);
  const info = [
    ["Casting", spell.casting_time || "—"],
    ["Range", spell.range || "—"],
    ["Duration", spell.duration || "—"],
    ["Components", componentsText(spell) || "—"]
  ];

  let actions = "";
  if (mode === "discover") {
    actions = known
      ? `<button class="danger-button" data-action="forget" data-index="${spell.index}">Remove from spellbook</button>`
      : `<button class="primary small" data-action="learn" data-index="${spell.index}">Add to spellbook</button>`;
  } else if (mode === "book") {
    if (level > 0) actions += `<button class="${prepared ? "danger-button" : "primary"} small" data-action="prepare" data-index="${spell.index}">${prepared ? "Unprepare" : "Prepare"}</button>`;
    actions += `<button class="danger-button" data-action="forget" data-index="${spell.index}">Remove</button>`;
  }

  const schoolKey = schoolName(spell).toLowerCase().replace(/[^a-z]+/g, "-");
  return `<article class="spell-card ${prepared ? "prepared" : ""}" data-school="${escapeHtml(schoolKey)}">
    <div class="spell-heading">
      <div>
        <div class="spell-kicker">${escapeHtml(schoolName(spell))}</div>
        <h3>${escapeHtml(spell.name)}</h3>
      </div>
      <div class="spell-badges">
        <span class="badge">${level === 0 ? "Cantrip" : `${ordinal(level)} level`}</span>
        ${prepared ? `<span class="badge prepared-badge">Prepared</span>` : ""}
        ${spell.concentration ? `<span class="badge">Concentration</span>` : ""}
        ${spell.ritual ? `<span class="badge">Ritual</span>` : ""}
        ${spell.sourceShort && spell.sourceShort !== "PHB 2014" ? `<span class="badge source-badge">${escapeHtml(spell.sourceShort)}</span>` : ""}
      </div>
    </div>
    <div class="spell-info-grid">${info.map(([k,v]) => `<div><span>${k}</span><strong>${escapeHtml(v)}</strong></div>`).join("")}</div>
    ${cue ? `<div class="mechanic-callout">🎲 ${escapeHtml(cue)}</div>` : ""}
    <p class="spell-summary">${escapeHtml(spellSummary(spell))}</p>
    ${hints.length ? `<div class="practical-hints">${hints.map(x => `<div>• ${escapeHtml(x)}</div>`).join("")}</div>` : ""}
    ${mode === "play" ? castControls(spell) : `<div class="spell-actions">${actions}<button class="secondary small" data-action="details" data-index="${spell.index}">Full details</button></div>`}
  </article>`;
}

async function boot() {
  const session = await api("/api/session");
  if (!session.authenticated) {
    $("#login").classList.remove("hidden");
    return;
  }
  $("#app").classList.remove("hidden");
  await refresh();
  activateInitialTab();
}

async function refresh() {
  const [charResult, spellResult, referenceSpellResult, featResult, invResult] = await Promise.all([
    api("/api/character"), api("/api/spells"), api("/api/reference/spells"), api("/api/feats"), api("/api/inventory")
  ]);
  model = charResult;
  catalogue = spellResult.results || [];
  referenceCatalogue = referenceSpellResult.results || [];
  featCatalogue = featResult.results || [];
  inventory = invResult;
  inventoryDraft = (inventory.items || []).map(x => ({...x}));
  renderAll();
}

function renderAll() {
  const c = model.character;
  $("#charName").textContent = c.name;
  $("#subtitle").textContent = `Tiefling · Level ${c.level} ${c.subclass}`;
  $("#dc").textContent = c.spellSaveDC;
  $("#atk").textContent = `${c.spellAttack >= 0 ? "+" : ""}${c.spellAttack}`;
  $("#prepCount").textContent = `${model.state.prepared.length} / ${c.preparedMax}`;
  $("#levelSetting").value = c.level;
  $("#intSetting").value = c.intScore;

  const recoveryUsed = model.state.resources?.arcaneRecoveryUsed;
  const recoveryEl = $("#arcaneRecoveryStatus");
  recoveryEl.textContent = recoveryUsed
    ? "Arcane Recovery · Used"
    : `Arcane Recovery · ${c.arcaneRecoveryBudget} levels · Use`;
  recoveryEl.disabled = recoveryUsed;
  recoveryEl.setAttribute("aria-label", recoveryUsed
    ? "Arcane Recovery has already been used since the last long rest"
    : `Use Arcane Recovery. Restore up to ${c.arcaneRecoveryBudget} combined spell-slot levels during a short rest.`);

  renderCampaign();
  renderSlots();
  renderPrepared();
  renderSpellbook();
  renderDiscover();
  renderInventory();
  renderFeats();
  renderReference();
  renderLevelUp();
  setSheetStatus("synced");
}

function signed(n) {
  const value = Number(n || 0);
  return `${value >= 0 ? "+" : ""}${value}`;
}

const CONDITION_NAMES = ["Blinded","Charmed","Deafened","Frightened","Grappled","Incapacitated","Invisible","Paralysed","Petrified","Poisoned","Prone","Restrained","Stunned","Unconscious"];
const SKILL_LABELS = { athletics:"Athletics", acrobatics:"Acrobatics", sleightOfHand:"Sleight of Hand", stealth:"Stealth", arcana:"Arcana", history:"History", investigation:"Investigation", nature:"Nature", religion:"Religion", animalHandling:"Animal Handling", insight:"Insight", medicine:"Medicine", perception:"Perception", survival:"Survival", deception:"Deception", intimidation:"Intimidation", performance:"Performance", persuasion:"Persuasion" };
const ABILITY_LABELS = { str:"STR", dex:"DEX", con:"CON", int:"INT", wis:"WIS", cha:"CHA" };
const ABILITY_FULL = { str:"Strength", dex:"Dexterity", con:"Constitution", int:"Intelligence", wis:"Wisdom", cha:"Charisma" };

function d20() {
  if (window.crypto?.getRandomValues) {
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    return (array[0] % 20) + 1;
  }
  return Math.floor(Math.random() * 20) + 1;
}

function setRollMode(mode) {
  rollMode = ["normal","advantage","disadvantage"].includes(mode) ? mode : "normal";
  localStorage.setItem("noctis-roll-mode", rollMode);
  $$('[data-roll-mode]').forEach(btn => {
    const active = btn.dataset.rollMode === rollMode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
}

function rollCheck(label, modifier = 0) {
  const mod = Number(modifier || 0);
  const rolls = rollMode === "normal" ? [d20()] : [d20(), d20()];
  const chosen = rollMode === "advantage" ? Math.max(...rolls) : rollMode === "disadvantage" ? Math.min(...rolls) : rolls[0];
  const total = chosen + mod;
  const natural = chosen === 20 ? " · NAT 20" : chosen === 1 ? " · NAT 1" : "";
  const modeLabel = rollMode === "advantage" ? "Advantage" : rollMode === "disadvantage" ? "Disadvantage" : "Normal";
  const diceText = rolls.length === 2 ? `${rolls[0]} / ${rolls[1]} → ${chosen}` : `${chosen}`;
  const el = $("#rollResult");
  el.innerHTML = `<div><span class="panel-kicker">${escapeHtml(modeLabel.toUpperCase())} D20</span><strong>${escapeHtml(label)}</strong></div><div class="roll-math"><span>${diceText}</span><b>${signed(mod)}</b><em>=</em><strong>${total}</strong></div><small>${natural ? natural.slice(3) : "Tap another stat to roll again"}</small>`;
  el.classList.remove("hidden");
  el.classList.toggle("critical", chosen === 20);
  el.classList.toggle("fumble", chosen === 1);
  return { rolls, chosen, modifier: mod, total };
}

function renderCampaign() {
  const c = model.character;
  $("#concentrationCheck").classList.add("hidden");
  $("#concentrationCheck").innerHTML = "";
  const hp = c.hp || {current:0,max:1,temp:0};
  $("#currentHp").textContent = hp.current;
  $("#maxHp").textContent = hp.max;
  $("#hpBigCurrent").textContent = hp.current;
  $("#hpBigMax").textContent = hp.max;
  $("#tempHpSummary").textContent = hp.temp ? `${hp.temp} temporary HP` : "No temporary HP";
  $("#hpTempBadge").textContent = `${hp.temp || 0} temp`;
  $("#tempHpInput").value = hp.temp || 0;
  $("#combatAc").textContent = c.ac ?? "—";
  $("#combatInitiative").textContent = signed(c.initiative);
  $("#combatSpeed").textContent = c.speed ?? "—";
  $("#inspirationStatus").textContent = c.inspiration ? "●" : "○";
  $("#inspirationToggle").classList.toggle("active", Boolean(c.inspiration));
  const pct = hp.max ? Math.max(0, Math.min(100, (hp.current / hp.max) * 100)) : 0;
  $("#hpMeterFill").style.width = `${pct}%`;
  $("#hitDiceSummary").textContent = `${c.hitDice?.current ?? 0} / ${c.hitDice?.max ?? c.level} ${c.hitDice?.die || "d6"}`;

  const deathPips = (type, count) => Array.from({length:3}, (_,i)=>`<button class="death-pip ${i < count ? "filled" : ""}" data-action="death-${type}" data-count="${i+1}" aria-label="Set ${type} death saves to ${i+1}"></button>`).join("");
  $("#deathSuccesses").innerHTML = deathPips("success", c.deathSaves?.successes || 0);
  $("#deathFailures").innerHTML = deathPips("failure", c.deathSaves?.failures || 0);

  $("#combatReference").innerHTML = [
    ["AC", c.ac, "edit-ac"], ["Initiative", signed(c.initiative)], ["Speed", `${c.speed} ft`],
    ["Proficiency", signed(c.proficiencyBonus)], ["Passive Perception", c.passivePerception], ["Spell Save DC", c.spellSaveDC], ["Spell Attack", signed(c.spellAttack)], ["Max HP", c.hp?.max, "edit-max-hp"]
  ].map(([label,value,action])=>`<div class="reference-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${action?`<button class="mini-edit" data-action="${action}">Edit</button>`:""}</div>`).join("");

  $("#abilityStrip").innerHTML = Object.entries(c.abilities || {}).map(([key,score])=>`<button class="ability-roll" data-action="roll-check" data-roll-label="${escapeHtml(ABILITY_FULL[key] || key.toUpperCase())}" data-roll-mod="${Math.floor((Number(score)-10)/2)}" title="Roll a ${escapeHtml(ABILITY_FULL[key] || key)} check"><span>${ABILITY_LABELS[key] || key.toUpperCase()}</span><strong>${score}</strong><small>${signed(Math.floor((Number(score)-10)/2))} · roll</small></button>`).join("");
  $("#saveList").innerHTML = Object.entries(c.saves || {}).map(([key,value])=>`<button class="check-row roll-check" data-action="roll-check" data-roll-label="${escapeHtml(ABILITY_FULL[key] || key)} Save" data-roll-mod="${Number(value)}"><span>${ABILITY_LABELS[key] || key.toUpperCase()} Save</span><strong>${signed(value)}</strong><small>Roll</small></button>`).join("");
  $("#skillList").innerHTML = Object.entries(c.skills || {}).map(([key,value])=>`<button class="check-row roll-check" data-action="roll-check" data-roll-label="${escapeHtml(SKILL_LABELS[key] || key)}" data-roll-mod="${Number(value)}"><span>${escapeHtml(SKILL_LABELS[key] || key)}</span><strong>${signed(value)}</strong><small>Roll</small></button>`).join("");
  setRollMode(rollMode);

  const concentration = c.concentration ? getSpell(c.concentration) : null;
  $("#concentrationCard").innerHTML = concentration
    ? `<div><span class="status-kicker">CONCENTRATING</span><strong>${escapeHtml(concentration.name)}</strong><small>${escapeHtml(concentration.duration || "")}</small></div><button class="ghost-danger small" data-action="end-concentration">End</button>`
    : `<div><span class="status-kicker">CONCENTRATION</span><strong>None</strong><small>Casting a concentration spell will track it here automatically.</small></div>`;

  const conditions = Array.isArray(c.conditions) ? c.conditions : [];
  $("#conditionList").innerHTML = conditions.length ? conditions.map(x=>`<button class="condition-chip" data-action="condition-remove" data-condition="${escapeHtml(x)}">${escapeHtml(x)} <span>×</span></button>`).join("") : `<span class="muted compact">No active conditions.</span>`;
  const select = $("#conditionSelect");
  const old = select.value;
  select.innerHTML = `<option value="">Add condition…</option>` + CONDITION_NAMES.filter(x=>!conditions.includes(x)).map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("");
  if ([...select.options].some(o=>o.value===old)) select.value=old;
  $("#exhaustionLevel").value = String(c.exhaustion || 0);
}

async function campaignAction(action, extra={}) {
  setSheetStatus("syncing");
  const result = await api("/api/campaign/action", {method:"POST", body:JSON.stringify({action,...extra})});
  model.state = result.state;
  model.character = result.character;
  renderAll();
  if (result.message) toast(result.message);
  if (result.concentrationCheck) {
    const box = $("#concentrationCheck");
    box.innerHTML = `<strong>Concentration check</strong><span>Make a CON save ${signed(result.concentrationCheck.bonus)} vs DC ${result.concentrationCheck.dc}.</span><div><button class="secondary small" data-action="keep-concentration">Maintained</button><button class="ghost-danger small" data-action="end-concentration">Lost concentration</button></div>`;
    box.classList.remove("hidden");
  }
  return result;
}

function renderSlots() {
  $("#slotDashboard").innerHTML = model.character.slots.map((max, i) => {
    const level = i + 1;
    const used = Number(model.state.slotsUsed?.[level] || 0);
    const remain = Math.max(0, max - used);
    const orbs = Array.from({length:max}, (_,n) => `<span class="slot-orb ${n < used ? "spent" : "available"}" title="${n < used ? "Spent" : "Available"}"></span>`).join("");
    return `<div class="slot-level"><div class="slot-level-top"><strong>${ordinal(level)} level</strong><span class="slot-count">${remain}/${max} available</span></div><div class="slot-orbs">${orbs}</div></div>`;
  }).join("") || `<div class="notice">No spell slots yet.</div>`;
}

function renderPrepared() {
  const cantrips = model.state.known.map(getSpell).filter(s => s && Number(s.level) === 0).sort((a,b)=>a.name.localeCompare(b.name));
  const prepared = model.state.prepared.map(getSpell).filter(Boolean).sort((a,b)=>a.level-b.level || a.name.localeCompare(b.name));
  const spells = [...cantrips, ...prepared];
  $("#preparedList").innerHTML = spells.length
    ? spells.map(s => spellCard(s, "play")).join("")
    : `<div class="notice">No castable spells are set up yet. Add spells to your spellbook, then prepare your levelled spells.</div>`;
}

function renderSpellbook() {
  const q = $("#bookSearch").value.trim().toLowerCase();
  const spells = model.state.known.map(getSpell).filter(Boolean)
    .filter(s => !q || `${s.name} ${schoolName(s)} ${spellSummary(s)}`.toLowerCase().includes(q))
    .sort((a,b)=>a.level-b.level || a.name.localeCompare(b.name));
  const levelled = spells.filter(s => Number(s.level) > 0).length;
  $("#bookStats").innerHTML = `Levelled spells in spellbook: <b>${levelled}</b> · expected minimum at Wizard ${model.character.level}: <b>${model.character.spellbookMinimum}</b> · prepared: <b>${model.state.prepared.length}/${model.character.preparedMax}</b>.`;
  $("#bookList").innerHTML = spells.length ? spells.map(s => spellCard(s,"book")).join("") : `<div class="notice">Your spellbook is empty.</div>`;
}

function renderDiscoverFilters() {
  const maxSpellLevel = Math.min(9, Math.ceil(model.character.level / 2));
  const old = $("#levelFilter").value || "all";
  $("#levelFilter").innerHTML = `<option value="all">Cantrip–${ordinal(maxSpellLevel)}</option>` + Array.from({length:maxSpellLevel+1}, (_,i) => `<option value="${i}">${i === 0 ? "Cantrips" : `${ordinal(i)} Level`}</option>`).join("");
  if ([...$("#levelFilter").options].some(o=>o.value===old)) $("#levelFilter").value=old;

  const schools = [...new Set(catalogue.map(s=>schoolName(s)).filter(x=>x && x!=="Unknown"))].sort();
  const schoolOld = $("#schoolFilter").value || "all";
  $("#schoolFilter").innerHTML = `<option value="all">All schools</option>` + schools.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
  if ([...$("#schoolFilter").options].some(o=>o.value===schoolOld)) $("#schoolFilter").value=schoolOld;
}

function renderDiscover() {
  renderDiscoverFilters();
  const maxSpellLevel = Math.min(9, Math.ceil(model.character.level / 2));
  const levelFilter = $("#levelFilter").value;
  const schoolFilter = $("#schoolFilter").value;
  const q = $("#spellSearch").value.trim().toLowerCase();
  let spells = catalogue.filter(s => Number(s.level) <= maxSpellLevel);
  if (levelFilter !== "all") spells = spells.filter(s => Number(s.level) === Number(levelFilter));
  if (schoolFilter !== "all") spells = spells.filter(s => schoolName(s) === schoolFilter);
  if (q) spells = spells.filter(s => `${s.name} ${schoolName(s)} ${spellSummary(s)}`.toLowerCase().includes(q));
  spells.sort((a,b)=>a.level-b.level || a.name.localeCompare(b.name));
  const visible = spells.slice(0, discoverLimit);
  const more = spells.length > visible.length
    ? `<div class="load-more-wrap"><button class="secondary load-more" data-action="show-more">Show ${Math.min(24, spells.length-visible.length)} more · ${spells.length-visible.length} remaining</button></div>`
    : "";
  $("#discoverList").innerHTML = visible.map(s=>spellCard(s,"discover")).join("") + more;
}

function renderInventory() {
  const c = inventory.coins || {};
  $("#coinCp").value = c.cp ?? 0; $("#coinSp").value = c.sp ?? 0; $("#coinEp").value = c.ep ?? 0; $("#coinGp").value = c.gp ?? 0; $("#coinPp").value = c.pp ?? 0;
  if (!inventoryDraft.length) inventoryDraft.push({qty:"1",name:"",cost:"",weight:""});
  $("#inventoryRows").innerHTML = inventoryDraft.map((item,i)=>`<div class="inventory-row" data-inv-row="${i}">
    <input data-field="qty" value="${escapeHtml(item.qty)}" placeholder="1" />
    <input data-field="name" value="${escapeHtml(item.name)}" placeholder="Item name" />
    <input data-field="cost" value="${escapeHtml(item.cost)}" placeholder="— or 5 gp" />
    <input data-field="weight" value="${escapeHtml(item.weight)}" placeholder="0" />
    <button class="icon-button" data-action="remove-item" data-row="${i}" title="Remove">×</button>
  </div>`).join("");
}

function abilityLabel(key) {
  return ({str:"Strength",dex:"Dexterity",con:"Constitution",int:"Intelligence",wis:"Wisdom",cha:"Charisma"})[key] || key;
}

function referenceSaveCue(spell) {
  const text = `${spell.summary || ""} ${spell.description || ""}`;
  const save = text.match(/(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw/i);
  if (save) return `${save[1].slice(0,3).toUpperCase()} save`;
  if (/spell attack/i.test(text)) return "Spell attack";
  if (/automatically hits|hits automatically/i.test(text)) return "No attack roll";
  return "";
}

function referenceSpellCard(spell) {
  const level = Number(spell.level || 0);
  const cue = referenceSaveCue(spell);
  const schoolKey = schoolName(spell).toLowerCase().replace(/[^a-z]+/g, "-");
  return `<article class="reference-spell-card" data-school="${escapeHtml(schoolKey)}">
    <div class="reference-card-head">
      <div><div class="spell-kicker">${escapeHtml(schoolName(spell))}</div><h3>${escapeHtml(spell.name)}</h3></div>
      <div class="spell-badges"><span class="badge">${level === 0 ? "Cantrip" : `${ordinal(level)} level`}</span>${spell.ritual ? `<span class="badge">Ritual</span>` : ""}${spell.concentration ? `<span class="badge">Concentration</span>` : ""}</div>
    </div>
    <div class="reference-facts">
      <span><small>CAST</small>${escapeHtml(spell.casting_time || "—")}</span>
      <span><small>RANGE</small>${escapeHtml(spell.range || "—")}</span>
      <span><small>DURATION</small>${escapeHtml(spell.duration || "—")}</span>
      <span><small>COMPONENTS</small>${escapeHtml(componentsText(spell) || "—")}</span>
    </div>
    ${cue ? `<div class="reference-mechanic">🎲 ${escapeHtml(cue)}</div>` : ""}
    <p>${escapeHtml(spellSummary(spell))}</p>
    ${(spell.classes || []).length ? `<div class="reference-classes"><small>CLASSES</small>${(spell.classes || []).map(c=>`<span>${escapeHtml(c)}</span>`).join("")}</div>` : ""}
    <div class="reference-card-footer"><span class="source-label">${escapeHtml(spell.sourceShort || spell.source || "Unknown source")}</span><button class="secondary small" data-action="reference-details" data-index="${spell.index}">Full details</button></div>
  </article>`;
}

function referenceFeatCard(feat) {
  const prereq = feat.prerequisiteText || (feat.prerequisite ? "Has a prerequisite" : "No prerequisite");
  const boosts = (feat.abilityIncrease || []).map(abilityLabel);
  return `<article class="reference-feat-card">
    <div class="reference-card-head">
      <div><div class="spell-kicker">${escapeHtml(feat.sourceShort || feat.source || "PHB 2014")} · ${feat.category === "racial" ? "RACIAL FEAT" : "FEAT"}</div><h3>${escapeHtml(feat.name)}</h3></div>
      ${feat.repeatable ? `<span class="badge">Repeatable</span>` : ""}
    </div>
    <p>${escapeHtml(feat.summary || "No summary available.")}</p>
    <div class="reference-feat-meta"><span><small>PREREQUISITE</small>${escapeHtml(prereq)}</span>${boosts.length ? `<span><small>ABILITY INCREASE</small>+1 ${escapeHtml(boosts.join(" or "))}</span>` : ""}</div>
  </article>`;
}

function populateReferenceFilters() {
  const levels = [...new Set(referenceCatalogue.map(s => Number(s.level || 0)))].sort((a,b)=>a-b);
  const levelEl = $("#referenceSpellLevel");
  const oldLevel = levelEl.value || "all";
  levelEl.innerHTML = `<option value="all">All levels</option>` + levels.map(level=>`<option value="${level}">${level === 0 ? "Cantrips" : `${ordinal(level)} level`}</option>`).join("");
  if ([...levelEl.options].some(o=>o.value===oldLevel)) levelEl.value=oldLevel;

  const schools = [...new Set(referenceCatalogue.map(s=>schoolName(s)).filter(Boolean))].sort();
  const schoolEl = $("#referenceSpellSchool");
  const oldSchool = schoolEl.value || "all";
  schoolEl.innerHTML = `<option value="all">All schools</option>` + schools.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("");
  if ([...schoolEl.options].some(o=>o.value===oldSchool)) schoolEl.value=oldSchool;

  const spellClasses = [...new Set(referenceCatalogue.flatMap(s=>s.classes || []).filter(Boolean))].sort();
  const classEl = $("#referenceSpellClass");
  const oldClass = classEl.value || "all";
  classEl.innerHTML = `<option value="all">All classes</option>` + spellClasses.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("");
  if ([...classEl.options].some(o=>o.value===oldClass)) classEl.value=oldClass;

  const spellSources = [...new Set(referenceCatalogue.map(s=>s.sourceShort || s.source).filter(Boolean))].sort();
  const spellSourceEl = $("#referenceSpellSource");
  const oldSpellSource = spellSourceEl.value || "all";
  spellSourceEl.innerHTML = `<option value="all">All sources</option>` + spellSources.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("");
  if ([...spellSourceEl.options].some(o=>o.value===oldSpellSource)) spellSourceEl.value=oldSpellSource;

  const featSources = [...new Set(featCatalogue.map(f=>f.sourceShort || f.source || "PHB 2014"))].sort();
  const featSourceEl = $("#referenceFeatSource");
  const oldFeatSource = featSourceEl.value || "all";
  featSourceEl.innerHTML = `<option value="all">All sources</option>` + featSources.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("");
  if ([...featSourceEl.options].some(o=>o.value===oldFeatSource)) featSourceEl.value=oldFeatSource;
}

function renderReferenceSpells() {
  const q = $("#referenceSpellSearch").value.trim().toLowerCase();
  const level = $("#referenceSpellLevel").value;
  const school = $("#referenceSpellSchool").value;
  const className = $("#referenceSpellClass").value;
  const source = $("#referenceSpellSource").value;
  const trait = $("#referenceSpellTrait").value;
  let spells = referenceCatalogue.filter(spell => {
    if (level !== "all" && Number(spell.level) !== Number(level)) return false;
    if (school !== "all" && schoolName(spell) !== school) return false;
    if (className !== "all" && !(spell.classes || []).includes(className)) return false;
    if (source !== "all" && (spell.sourceShort || spell.source) !== source) return false;
    if (trait === "ritual" && !spell.ritual) return false;
    if (trait === "concentration" && !spell.concentration) return false;
    const casting = String(spell.casting_time || "").toLowerCase();
    if (trait === "reaction" && !casting.includes("reaction")) return false;
    if (trait === "bonus" && !casting.includes("bonus")) return false;
    if (q && !`${spell.name} ${schoolName(spell)} ${(spell.classes || []).join(" ")} ${spellSummary(spell)} ${spell.description || ""} ${spell.sourceShort || ""}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a,b)=>Number(a.level)-Number(b.level) || a.name.localeCompare(b.name));
  $("#referenceSpellCount").textContent = `${spells.length} spell${spells.length === 1 ? "" : "s"}`;
  const visible = spells.slice(0, referenceSpellLimit);
  const more = spells.length > visible.length ? `<div class="load-more-wrap reference-load-more"><button class="secondary" data-action="reference-spell-more">Show ${Math.min(36, spells.length-visible.length)} more · ${spells.length-visible.length} remaining</button></div>` : "";
  $("#referenceSpellList").innerHTML = spells.length ? visible.map(referenceSpellCard).join("") + more : `<div class="notice reference-empty">No spells match those filters.</div>`;
}

function renderReferenceFeats() {
  const q = $("#referenceFeatSearch").value.trim().toLowerCase();
  const type = $("#referenceFeatType").value;
  const source = $("#referenceFeatSource").value;
  const feats = featCatalogue.filter(feat => {
    const category = feat.category || "general";
    if (type !== "all" && category !== type) return false;
    if (source !== "all" && (feat.sourceShort || feat.source || "PHB 2014") !== source) return false;
    if (q && !`${feat.name} ${feat.summary || ""} ${feat.prerequisiteText || ""} ${feat.sourceShort || feat.source || ""}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a,b)=>a.name.localeCompare(b.name));
  $("#referenceFeatCount").textContent = `${feats.length} feat${feats.length === 1 ? "" : "s"}`;
  $("#referenceFeatList").innerHTML = feats.length ? feats.map(referenceFeatCard).join("") : `<div class="notice reference-empty">No feats match those filters.</div>`;
}

function referenceIsOpen() {
  return $(".tab[data-tab=reference]")?.classList.contains("active");
}

function setReferenceMode(mode, render = true) {
  referenceMode = mode === "feats" ? "feats" : "spells";
  $$('[data-reference-mode]').forEach(button => {
    const active = button.dataset.referenceMode === referenceMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $("#referenceSpellsPanel").classList.toggle("hidden", referenceMode !== "spells");
  $("#referenceFeatsPanel").classList.toggle("hidden", referenceMode !== "feats");
  localStorage.setItem("noctis-reference-mode", referenceMode);
  if (render && referenceIsOpen()) {
    if (referenceMode === "spells") renderReferenceSpells();
    else renderReferenceFeats();
  }
}

function renderReference(force = false) {
  populateReferenceFilters();
  $("#referenceLibraryCount").textContent = `${referenceCatalogue.length} spells · ${featCatalogue.length} feats`;
  setReferenceMode(localStorage.getItem("noctis-reference-mode") || referenceMode, false);
  if (!force && !referenceIsOpen()) return;
  if (referenceMode === "spells") renderReferenceSpells();
  else renderReferenceFeats();
}

function renderFeats() {
  const chosen = model.state.feats || [];
  $("#ownedFeats").innerHTML = chosen.length ? chosen.map(entry => {
    const feat = featCatalogue.find(f => f.id === entry.id);
    if (!feat) return "";
    return `<article class="owned-feat"><div><div class="spell-kicker">Chosen at Wizard ${entry.chosenAtLevel || "?"}</div><h4>${escapeHtml(feat.name)}</h4></div><p>${escapeHtml(feat.summary)}</p>${entry.ability ? `<span class="badge">+1 ${escapeHtml(abilityLabel(entry.ability))}</span>` : ""}${entry.note ? `<span class="badge">${escapeHtml(entry.note)}</span>` : ""}</article>`;
  }).join("") : `<div class="notice">No feats selected yet. Your first Wizard ASI/feat choice is at level 4.</div>`;

  const q = $("#featSearch").value.trim().toLowerCase();
  const list = featCatalogue.filter(f => !q || `${f.name} ${f.summary} ${f.reason || ""} ${f.sourceShort || f.source || ""}`.toLowerCase().includes(q));
  $("#featCatalogue").innerHTML = list.map(feat => {
    const chosenAlready = chosen.some(x => x.id === feat.id);
    const status = chosenAlready && !feat.repeatable ? "Chosen" : feat.eligible ? "Available" : (feat.reason || "Unavailable");
    return `<article class="feat-card ${feat.eligible ? "eligible" : "locked"}">
      <div class="feat-card-head"><div><div class="spell-kicker">${escapeHtml(feat.sourceShort || "PHB 2014")}${feat.category === "racial" ? " · RACIAL FEAT" : " · FEAT"}</div><h3>${escapeHtml(feat.name)}</h3></div><span class="badge ${feat.eligible ? "prepared-badge" : ""}">${escapeHtml(status)}</span></div>
      <p>${escapeHtml(feat.summary)}</p>
      ${feat.prerequisite ? `<div class="feat-prereq">${feat.eligible ? escapeHtml(feat.prerequisiteText || "Prerequisite met") : escapeHtml(feat.reason || feat.prerequisiteText || "Prerequisite not met")}</div>` : `<div class="feat-prereq">No prerequisite</div>`}
      ${(feat.abilityIncrease || []).length ? `<div class="feat-boost">Ability increase: ${feat.abilityIncrease.map(a=>escapeHtml(abilityLabel(a))).join(" or ")} +1</div>` : ""}
    </article>`;
  }).join("");
}

function wizardSlotsAt(level) {
  const table = {
    1:[2],2:[3],3:[4,2],4:[4,3],5:[4,3,2],6:[4,3,3],7:[4,3,3,1],8:[4,3,3,2],9:[4,3,3,3,1],10:[4,3,3,3,2],
    11:[4,3,3,3,2,1],12:[4,3,3,3,2,1],13:[4,3,3,3,2,1,1],14:[4,3,3,3,2,1,1],15:[4,3,3,3,2,1,1,1],16:[4,3,3,3,2,1,1,1],
    17:[4,3,3,3,2,1,1,1,1],18:[4,3,3,3,3,1,1,1,1],19:[4,3,3,3,3,2,1,1,1],20:[4,3,3,3,3,2,2,1,1]
  };
  return table[level] || [];
}

function wizardFeatures(level) {
  const items = level === 1 ? [] : ["Learn 2 wizard spells"];
  const unlocks = {3:"Unlock 2nd-level spells",5:"Unlock 3rd-level spells",7:"Unlock 4th-level spells",9:"Unlock 5th-level spells",11:"Unlock 6th-level spells",13:"Unlock 7th-level spells",15:"Unlock 8th-level spells",17:"Unlock 9th-level spells"};
  if (unlocks[level]) items.unshift(unlocks[level]);
  if (level === 1) items.unshift("Spellcasting", "Arcane Recovery", "3 cantrips known", "6 first-level spells in your starting spellbook");
  if (level === 2) items.unshift("School of Necromancy", "Necromancy Savant", "Grim Harvest");
  if (level === 4) items.unshift("ASI or feat", "Learn 1 additional cantrip");
  if ([8,12,16,19].includes(level)) items.unshift("ASI or feat");
  if (level === 6) items.unshift("Undead Thralls", "Animate Dead added to your spellbook if needed");
  if (level === 10) items.unshift("Inured to Undeath", "Learn 1 additional cantrip");
  if (level === 14) items.unshift("Command Undead");
  if (level === 18) items.unshift("Spell Mastery");
  if (level === 20) items.unshift("Signature Spells");
  if ([5,9,13,17].includes(level)) items.push(`Proficiency bonus increases to +${Math.ceil(level/4)+1}`);
  const slots = wizardSlotsAt(level);
  if (slots.length) items.push(`Spell slots: ${slots.map((n,i)=>`${n}×${ordinal(i+1)}`).join(", ")}`);
  return items;
}

function spellSelectOptions(spells, placeholder="Choose a spell…") {
  const grouped = new Map();
  for (const spell of spells) {
    const level = Number(spell.level || 0);
    if (!grouped.has(level)) grouped.set(level, []);
    grouped.get(level).push(spell);
  }
  let html = `<option value="">${escapeHtml(placeholder)}</option>`;
  for (const [level, entries] of [...grouped.entries()].sort((a,b)=>a[0]-b[0])) {
    html += `<optgroup label="${level === 0 ? "Cantrips" : `${ordinal(level)}-level spells`}">` + entries.sort((a,b)=>a.name.localeCompare(b.name)).map(s=>`<option value="${escapeHtml(s.index)}">${escapeHtml(s.name)}</option>`).join("") + `</optgroup>`;
  }
  return html;
}

function selectedLevelSpellPreview() {
  const ids = [$("#levelSpell1").value, $("#levelSpell2").value].filter(Boolean);
  const cards = ids.map(getSpell).filter(Boolean);
  $("#levelSpellPreview").innerHTML = cards.length ? cards.map(s=>`<div><b>${escapeHtml(s.name)}</b><span>${escapeHtml(spellSummary(s).slice(0,180))}${spellSummary(s).length>180?"…":""}</span></div>`).join("") : "";
}

function selectedFeatPreview() {
  const feat = featCatalogue.find(f => f.id === $("#levelFeat").value);
  $("#levelFeatPreview").innerHTML = feat ? `<div><b>${escapeHtml(feat.name)}</b><span>${escapeHtml(feat.summary)}</span></div>` : "";
  const label = $("#featAbilityLabel");
  const select = $("#levelFeatAbility");
  const boosts = feat?.abilityIncrease || [];
  if (boosts.length) {
    label.classList.remove("hidden");
    select.innerHTML = boosts.map(a=>`<option value="${a}">${escapeHtml(abilityLabel(a))} (${model.character.abilities?.[a] ?? "?"} → ${Math.min(20, Number(model.character.abilities?.[a] || 0)+1)})</option>`).join("");
  } else {
    label.classList.add("hidden");
    select.innerHTML = "";
  }
}

function renderLevelUp() {
  const current = model.character.level;
  const target = current + 1;
  const atMax = current >= 20;
  $("#levelMaxNotice").classList.toggle("hidden", !atMax);
  $("#levelUpForm").classList.toggle("hidden", atMax);
  $("#nextLevelBadge").textContent = atMax ? "Wizard 20 · complete" : `Wizard ${current} → ${target}`;
  if (atMax) {
    $("#nextLevelSummary").innerHTML = `<div class="notice">You've reached the end of the 2014 Wizard class progression.</div>`;
  } else {
    const maxSpellLevel = ({1:1,2:1,3:2,4:2,5:3,6:3,7:4,8:4,9:5,10:5,11:6,12:6,13:7,14:7,15:8,16:8,17:9,18:9,19:9,20:9})[target];
    const options = catalogue.filter(s => Number(s.level) >= 1 && Number(s.level) <= maxSpellLevel && !model.state.known.includes(s.index));
    const old1 = $("#levelSpell1").value, old2 = $("#levelSpell2").value;
    $("#levelSpell1").innerHTML = spellSelectOptions(options, "Choose first spell…");
    $("#levelSpell2").innerHTML = spellSelectOptions(options, "Choose second spell…");
    if (options.some(s=>s.index===old1)) $("#levelSpell1").value=old1;
    if (options.some(s=>s.index===old2)) $("#levelSpell2").value=old2;
    selectedLevelSpellPreview();

    const needsCantrip = (target === 4 || target === 10);
    $("#cantripStep").classList.toggle("hidden", !needsCantrip);
    if (needsCantrip) {
      const cantrips = catalogue.filter(s=>Number(s.level)===0 && !model.state.known.includes(s.index));
      $("#levelCantrip").innerHTML = spellSelectOptions(cantrips, "Choose new cantrip…");
    }

    const needsAdvancement = [4,8,12,16,19].includes(target);
    $("#advancementStep").classList.toggle("hidden", !needsAdvancement);
    if (needsAdvancement) {
      const eligible = featCatalogue.filter(f=>f.eligible).sort((a,b)=>a.name.localeCompare(b.name));
      $("#levelFeat").innerHTML = `<option value="">Choose a feat…</option>` + eligible.map(f=>`<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)}</option>`).join("");
      selectedFeatPreview();
      const abilityOptions = Object.entries(model.character.abilities || {}).map(([a,v])=>`<option value="${a}">${escapeHtml(abilityLabel(a))} (${v})</option>`).join("");
      $("#asiAbility1").innerHTML = abilityOptions;
      $("#asiAbility2").innerHTML = abilityOptions;
      updateAdvancementPanels();
    }

    $("#levelUpTitle").textContent = `Advance to Wizard ${target}`;
    $("#levelUpSummary").textContent = `This will set the character sheet to Wizard ${target}, add your spell choices, and sync SPELLS / SpellBook${needsAdvancement ? " plus your feat or ASI" : ""}.`;
    $("#nextLevelSummary").innerHTML = wizardFeatures(target).map((x,i)=>`<div class="next-change"><span>${i+1}</span><p>${escapeHtml(x)}</p></div>`).join("");
  }

  $("#levelCards").innerHTML = Array.from({length:20},(_,i)=>i+1).map(level=>{
    const status = level < current ? "done" : level === current ? "current" : level === target ? "next" : "future";
    return `<article class="level-card ${status}"><div class="level-card-top"><div class="eyebrow">LEVEL ${level}</div><span class="level-status">${status === "done" ? "✓" : status === "current" ? "Current" : status === "next" ? "Next" : ""}</span></div><h3>Wizard ${level}</h3><ul>${wizardFeatures(level).map(i=>`<li>${escapeHtml(i)}</li>`).join("")}</ul></article>`;
  }).join("");
}

function updateAdvancementPanels() {
  const value = document.querySelector('input[name="advancement"]:checked')?.value || "feat";
  $("#featChoicePanel").classList.toggle("hidden", value !== "feat");
  $("#asiChoicePanel").classList.toggle("hidden", value !== "asi");
  const split = $("#asiMode").value === "split";
  $("#asiAbility2Label").classList.toggle("hidden", !split);
}

async function commitLevelUp() {
  const target = model.character.level + 1;
  const body = { spells:[$("#levelSpell1").value,$("#levelSpell2").value] };
  if (target === 4 || target === 10) body.cantrip = $("#levelCantrip").value;
  if ([4,8,12,16,19].includes(target)) {
    body.advancement = document.querySelector('input[name="advancement"]:checked')?.value || "feat";
    if (body.advancement === "feat") {
      body.featId = $("#levelFeat").value;
      body.featAbility = $("#levelFeatAbility").value;
      body.featNote = $("#levelFeatNote").value;
    } else {
      body.asi = { mode:$("#asiMode").value, abilities:[$("#asiAbility1").value, ...( $("#asiMode").value === "split" ? [$("#asiAbility2").value] : [] )] };
    }
  }
  if (!confirm(`Advance Noctis from Wizard ${model.character.level} to Wizard ${target}? This updates the Google Sheet.`)) return;
  setSheetStatus("syncing");
  const result = await api("/api/level-up", {method:"POST",body:JSON.stringify(body)});
  model.state = result.state;
  model.character = result.character;
  const featResult = await api("/api/feats");
  featCatalogue = featResult.results || [];
  renderAll();
  toast(`Level up complete — Noctis is now Wizard ${result.character.level}`);
}

async function updateState(patch) {
  setSheetStatus("syncing");
  const result = await api("/api/state", { method:"PUT", body:JSON.stringify({...model.state,...patch}) });
  model.state = result.state;
  if (result.character) model.character = result.character;
  renderAll();
}

async function castSpell(index, explicitLevel) {
  const spell = getSpell(index);
  if (!spell) return;
  const currentConcentration = model.character.concentration ? getSpell(model.character.concentration) : null;
  if (spell.concentration && currentConcentration && currentConcentration.index !== spell.index) {
    if (!confirm(`Casting ${spell.name} will end concentration on ${currentConcentration.name}. Cast anyway?`)) return;
  }
  let castLevel = explicitLevel;
  if (castLevel === undefined) {
    const select = document.querySelector(`[data-cast-select="${CSS.escape(index)}"]`);
    castLevel = Number(select?.value || spell.level || 0);
  }
  setSheetStatus("syncing");
  const result = await api("/api/cast", { method:"POST", body:JSON.stringify({index,castLevel}) });
  model.state = result.state;
  model.character = result.character;
  renderAll();
  showCastResult(result.cast);
}

function showCastResult(cast) {
  const spell = cast.spell;
  const cue = saveCue(spell);
  const levelText = Number(spell.level) === 0 ? "Cantrip" : `Cast using a ${ordinal(cast.castLevel)}-level slot`;
  const remaining = cast.castLevel ? `<strong>${cast.remaining}</strong> ${ordinal(cast.castLevel)}-level slot${cast.remaining===1?"":"s"} remaining.` : "No spell slot used.";
  const hints = practicalHints(spell);
  $("#castResult").innerHTML = `<div class="cast-result-title"><span class="cast-icon">✦</span><div><div class="eyebrow">YOU CAST</div><h3>${escapeHtml(spell.name)}</h3></div></div>
    <div class="cast-facts"><span>${escapeHtml(levelText)}</span><span>${escapeHtml(spell.casting_time || "")}</span><span>${escapeHtml(spell.range || "")}</span>${cue?`<span>${escapeHtml(cue)}</span>`:""}</div>
    <p><b>Tell the table:</b> ${escapeHtml(spellSummary(spell))}</p>
    ${Number(cast.castLevel)>Number(spell.level) && spell.higher_level ? `<p><b>Upcast:</b> ${escapeHtml(spell.higher_level)}</p>`:""}
    ${hints.length?`<p class="muted">${hints.map(escapeHtml).join(" ")}</p>`:""}
    <div class="remaining-slots">${remaining}</div>`;
  $("#castResult").classList.remove("hidden");
  $("#castResult").scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion: reduce), (max-width: 900px)").matches ? "auto" : "smooth",block:"center"});
}

async function showDetails(index, reference = false) {
  const spell = reference
    ? (getReferenceSpell(index) || await api(`/api/reference/spells/${index}`))
    : (getSpell(index) || await api(`/api/spells/${index}`));
  $("#spellDetail").innerHTML = `<div class="eyebrow">${escapeHtml(schoolName(spell))}</div><h2>${escapeHtml(spell.name)}</h2>
    <div class="detail-meta"><span class="badge">${Number(spell.level)===0?"Cantrip":`${ordinal(spell.level)} level`}</span><span class="badge">${escapeHtml(spell.casting_time||"")}</span><span class="badge">${escapeHtml(spell.range||"")}</span>${spell.concentration?`<span class="badge">Concentration</span>`:""}${spell.ritual?`<span class="badge">Ritual</span>`:""}</div>
    <p><b>Components:</b> ${escapeHtml(componentsText(spell))}</p>
    <p><b>Duration:</b> ${escapeHtml(spell.duration||"")}</p>
    ${(spell.classes || []).length ? `<p><b>Classes:</b> ${escapeHtml((spell.classes || []).join(", "))}</p>` : ""}
    <p><b>Source:</b> ${escapeHtml(spell.sourceShort || spell.source || "Unknown")}</p>
    <div class="detail-body"><p>${escapeHtml(spell.description || spellSummary(spell))}</p>${spell.higher_level?`<p><b>At higher levels:</b> ${escapeHtml(spell.higher_level)}</p>`:""}</div>`;
  $("#spellDialog").showModal();
}

function recoveryOptions() {
  const budget = model.character.arcaneRecoveryBudget;
  const spent = {};
  model.character.slots.forEach((max,i)=>spent[i+1]=Math.min(max,Number(model.state.slotsUsed?.[i+1]||0)));
  const combos = [];
  const rec = (level,left,current) => {
    if (level > Math.min(5,model.character.slots.length)) {
      if (current.length) combos.push([...current]);
      return;
    }
    const maxTake = Math.min(spent[level] || 0, Math.floor(left/level));
    for (let n=0;n<=maxTake;n++) {
      for (let j=0;j<n;j++) current.push(level);
      rec(level+1,left-n*level,current);
      current.splice(current.length-n,n);
    }
  };
  rec(1,budget,[]);
  const unique = [...new Map(combos.map(c=>[c.join(","),c])).values()];
  unique.sort((a,b)=>b.reduce((x,y)=>x+y,0)-a.reduce((x,y)=>x+y,0) || a.length-b.length);
  return unique;
}

function openShortRest() {
  const used = model.state.resources?.arcaneRecoveryUsed;
  const options = recoveryOptions();
  $("#arcaneRecoveryHelp").textContent = used
    ? "You've already used Arcane Recovery since your last long rest. A long rest refreshes it."
    : options.length
      ? `Choose spent slots to restore. Their combined levels can total up to ${model.character.arcaneRecoveryBudget}. For example, a 2nd-level slot costs 2 recovery levels and a 1st-level slot costs 1.`
      : `Arcane Recovery is available, but you have no expended spell slots to restore yet. Your current budget is ${model.character.arcaneRecoveryBudget} combined slot levels.`;
  $("#recoveryChoice").innerHTML = `<option value="">Don't recover spell slots</option>` + options.map(c=>{
    const counts={}; c.forEach(x=>counts[x]=(counts[x]||0)+1);
    const label=Object.entries(counts).map(([lvl,n])=>`${n} × ${ordinal(lvl)}-level`).join(" + ");
    return `<option value="${c.join(",")}">${label}</option>`;
  }).join("");
  $("#recoveryChoice").disabled = used || !options.length;
  $("#shortRestDialog").showModal();
}

async function takeShortRest(useSelection=true) {
  const recover = useSelection && $("#recoveryChoice").value ? $("#recoveryChoice").value.split(",").map(Number) : [];
  setSheetStatus("syncing");
  const result = await api("/api/rest", {method:"POST",body:JSON.stringify({type:"short",recover})});
  model.state=result.state; model.character=result.character;
  $("#shortRestDialog").close(); renderAll(); toast(recover.length?"Short rest taken — Arcane Recovery used":"Short rest taken");
}

function readInventoryDraftFromDom() {
  inventoryDraft = $$("[data-inv-row]").map(row=>({
    qty: row.querySelector('[data-field="qty"]').value,
    name: row.querySelector('[data-field="name"]').value,
    cost: row.querySelector('[data-field="cost"]').value,
    weight: row.querySelector('[data-field="weight"]').value
  }));
}

const UI_READY = verifyUiVersion();

// Navigation
$$('.tab').forEach(btn => btn.onclick = () => {
  $$('.tab').forEach(x=>{
    const active = x === btn;
    x.classList.toggle('active', active);
    x.setAttribute('aria-selected', String(active));
    x.tabIndex = active ? 0 : -1;
  });
  $$('.view').forEach(v=>v.classList.toggle('active',v.id===btn.dataset.tab));
  history.replaceState(null, "", `#${btn.dataset.tab}`);
  if (btn.dataset.tab === "reference" && model) renderReference(true);
});

function activateInitialTab() {
  const wanted = location.hash.replace(/^#/, "");
  const btn = wanted ? $(`.tab[data-tab="${CSS.escape(wanted)}"]`) : null;
  if (btn) btn.click();
}

$(".tabs").addEventListener("keydown", e => {
  if (!["ArrowLeft","ArrowRight","Home","End"].includes(e.key)) return;
  const tabs = $$(".tab");
  const current = tabs.indexOf(document.activeElement);
  if (current < 0) return;
  e.preventDefault();
  let next = current;
  if (e.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
  if (e.key === "ArrowRight") next = (current + 1) % tabs.length;
  if (e.key === "Home") next = 0;
  if (e.key === "End") next = tabs.length - 1;
  tabs[next].focus();
  tabs[next].click();
});


// Event delegation for dynamically-rendered cards and inventory rows.
document.addEventListener("click", async e => {
  const btn = e.target.closest("[data-action]");
  if (!btn || btn.disabled) return;
  const action = btn.dataset.action;
  const index = btn.dataset.index;
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  try {
    if (action === "learn") { await updateState({known:[...new Set([...model.state.known,index])]}); toast("Added to spellbook and synced to the DM sheet"); }
    if (action === "forget") {
      const spell = getSpell(index);
      if (!confirm(`Remove ${spell?.name || "this spell"} from the spellbook?${model.state.prepared.includes(index) ? " It is currently prepared." : ""}`)) return;
      await updateState({known:model.state.known.filter(x=>x!==index),prepared:model.state.prepared.filter(x=>x!==index)}); toast("Removed and sheet updated");
    }
    if (action === "prepare") {
      const isPrepared=model.state.prepared.includes(index);
      if (!isPrepared && model.state.prepared.length>=model.character.preparedMax) return toast(`You can prepare ${model.character.preparedMax} spells`);
      await updateState({prepared:isPrepared?model.state.prepared.filter(x=>x!==index):[...model.state.prepared,index]});
      toast(isPrepared?"Spell unprepared — DM sheet updated":"Spell prepared — DM sheet updated");
    }
    if (action === "cast") await castSpell(index, btn.dataset.castLevel !== undefined ? Number(btn.dataset.castLevel) : undefined);
    if (action === "details") await showDetails(index);
    if (action === "reference-details") await showDetails(index, true);
    if (action === "remove-item") { readInventoryDraftFromDom(); inventoryDraft.splice(Number(btn.dataset.row),1); renderInventory(); }
    if (action === "show-more") { discoverLimit += 24; renderDiscover(); }
    if (action === "reference-spell-more") { referenceSpellLimit += 36; renderReferenceSpells(); }
    if (action === "roll-check") rollCheck(btn.dataset.rollLabel || "Check", Number(btn.dataset.rollMod || 0));
    if (action === "condition-remove") await campaignAction("condition-remove", {condition:btn.dataset.condition});
    if (action === "end-concentration") await campaignAction("concentration-end");
    if (action === "keep-concentration") { $("#concentrationCheck").classList.add("hidden"); toast("Concentration maintained"); }
    if (action === "death-success") { const next=Number(btn.dataset.count); await campaignAction("death-saves", {successes:(model.character.deathSaves?.successes===next?next-1:next), failures:model.character.deathSaves?.failures||0}); }
    if (action === "death-failure") { const next=Number(btn.dataset.count); await campaignAction("death-saves", {successes:model.character.deathSaves?.successes||0, failures:(model.character.deathSaves?.failures===next?next-1:next)}); }
    if (action === "edit-ac") { const value=prompt("Armour Class", String(model.character.ac)); if (value!==null) await campaignAction("ac", {value:Number(value)}); }
    if (action === "edit-max-hp") { const value=prompt("Maximum HP", String(model.character.hp?.max||1)); if (value!==null) await campaignAction("max-hp", {value:Number(value)}); }
  } catch (err) {
    setSheetStatus("error");
    toast(err.message, "error");
  } finally {
    if (btn.isConnected) { btn.disabled = false; btn.removeAttribute("aria-busy"); }
  }
});

$$('[data-health-amount]').forEach(btn => btn.onclick = () => { $("#healthAmount").value = btn.dataset.healthAmount; });
$("#takeDamage").onclick = e => withButtonBusy(e.currentTarget, () => campaignAction("damage", {amount:Number($("#healthAmount").value)}), "Applying…").catch(err=>{setSheetStatus("error");toast(err.message,"error")});
$("#healDamage").onclick = e => withButtonBusy(e.currentTarget, () => campaignAction("heal", {amount:Number($("#healthAmount").value)}), "Healing…").catch(err=>{setSheetStatus("error");toast(err.message,"error")});
$("#setTempHp").onclick = e => withButtonBusy(e.currentTarget, () => campaignAction("temp-hp", {amount:Number($("#tempHpInput").value)}), "Saving…").catch(err=>{setSheetStatus("error");toast(err.message,"error")});
$("#inspirationToggle").onclick = e => withButtonBusy(e.currentTarget, () => campaignAction("inspiration"), "").catch(err=>{setSheetStatus("error");toast(err.message,"error")});
$("#spendHitDie").onclick = e => withButtonBusy(e.currentTarget, () => campaignAction("hit-die").then(r=>{$("#lastHitDieRoll").textContent=r.message||"";}), "Rolling…").catch(err=>{setSheetStatus("error");toast(err.message,"error")});
$("#resetDeathSaves").onclick = e => withButtonBusy(e.currentTarget, () => campaignAction("death-saves", {successes:0,failures:0}), "Resetting…").catch(err=>{setSheetStatus("error");toast(err.message,"error")});
$("#addCondition").onclick = e => { const condition=$("#conditionSelect").value; if(condition) withButtonBusy(e.currentTarget, () => campaignAction("condition-add", {condition}), "Adding…").catch(err=>{setSheetStatus("error");toast(err.message,"error")}); };
$("#exhaustionLevel").onchange = () => campaignAction("exhaustion", {level:Number($("#exhaustionLevel").value)}).catch(err=>{setSheetStatus("error");toast(err.message,"error")});

$("#bookSearch").addEventListener("input",renderSpellbook);
$("#spellSearch").addEventListener("input",()=>{discoverLimit=24;renderDiscover();});
$("#levelFilter").addEventListener("change",()=>{discoverLimit=24;renderDiscover();});
$("#schoolFilter").addEventListener("change",()=>{discoverLimit=24;renderDiscover();});
$("#featSearch").addEventListener("input",renderFeats);
$$('[data-roll-mode]').forEach(button => button.addEventListener("click", () => setRollMode(button.dataset.rollMode)));
$("#initiativeRoll").addEventListener("click", () => rollCheck("Initiative", Number(model?.character?.initiative || 0)));
$$('[data-reference-mode]').forEach(button => button.addEventListener("click", () => setReferenceMode(button.dataset.referenceMode)));
["#referenceSpellSearch","#referenceSpellLevel","#referenceSpellSchool","#referenceSpellClass","#referenceSpellSource","#referenceSpellTrait"].forEach(selector => {
  const el = $(selector); el.addEventListener(el.tagName === "INPUT" ? "input" : "change", () => { referenceSpellLimit = window.matchMedia("(max-width: 700px)").matches ? 36 : 72; renderReferenceSpells(); });
});
["#referenceFeatSearch","#referenceFeatType","#referenceFeatSource"].forEach(selector => {
  const el = $(selector); el.addEventListener(el.tagName === "INPUT" ? "input" : "change", renderReferenceFeats);
});
$("#referenceSpellClear").onclick = () => { $("#referenceSpellSearch").value=""; $("#referenceSpellLevel").value="all"; $("#referenceSpellSchool").value="all"; $("#referenceSpellClass").value="all"; $("#referenceSpellSource").value="all"; $("#referenceSpellTrait").value="all"; referenceSpellLimit = window.matchMedia("(max-width: 700px)").matches ? 36 : 72; renderReferenceSpells(); };
$("#referenceFeatClear").onclick = () => { $("#referenceFeatSearch").value=""; $("#referenceFeatType").value="all"; $("#referenceFeatSource").value="all"; renderReferenceFeats(); };
$("#closeDialog").onclick=()=>$("#spellDialog").close();
$("#closeShortRest").onclick=()=>$("#shortRestDialog").close();
$("#levelSpell1").addEventListener("change",selectedLevelSpellPreview);
$("#levelSpell2").addEventListener("change",selectedLevelSpellPreview);
$("#levelFeat").addEventListener("change",selectedFeatPreview);
$$("input[name=advancement]").forEach(x=>x.addEventListener("change",updateAdvancementPanels));
$("#asiMode").addEventListener("change",updateAdvancementPanels);
$("#commitLevelUp").onclick=e=>withButtonBusy(e.currentTarget, () => commitLevelUp(), "Leveling…").catch(err=>toast(err.message,"error"));

$("#shortRest").onclick=openShortRest;
$("#arcaneRecoveryStatus").onclick=openShortRest;
$("#confirmShortRest").onclick=e=>withButtonBusy(e.currentTarget, () => takeShortRest(true), "Resting…").catch(err=>toast(err.message,"error"));
$("#shortRestNoRecovery").onclick=e=>withButtonBusy(e.currentTarget, () => takeShortRest(false), "Resting…").catch(err=>toast(err.message,"error"));
$("#longRest").onclick=async e=>{
  if (!confirm("Take a long rest? This restores HP and spell slots, clears temporary HP/death saves, regains Hit Dice, resets Arcane Recovery, and reduces exhaustion by 1.")) return;
  await withButtonBusy(e.currentTarget, async () => {
    setSheetStatus("syncing");
    const r=await api("/api/rest",{method:"POST",body:JSON.stringify({type:"long"})});
    model.state=r.state; model.character=r.character; renderAll();
    toast("Long rest complete — HP, slots and rest resources restored");
  }, "Resting…").catch(err=>toast(err.message,"error"));
};

$("#addInventoryRow").onclick=()=>{readInventoryDraftFromDom();inventoryDraft.push({qty:"1",name:"",cost:"",weight:""});renderInventory();};
$("#saveInventory").onclick=e=>withButtonBusy(e.currentTarget, async()=>{
  readInventoryDraftFromDom();
  const items=inventoryDraft.filter(x=>String(x.name || "").trim());
  const coins={cp:$("#coinCp").value,sp:$("#coinSp").value,ep:$("#coinEp").value,gp:$("#coinGp").value,pp:$("#coinPp").value};
  setSheetStatus("syncing");
  await api("/api/inventory",{method:"PUT",body:JSON.stringify({items,coins})});
  inventory={items,coins}; inventoryDraft=items.map(x=>({...x})); renderInventory(); toast("Inventory saved to BAG sheet");
}, "Saving…").catch(err=>toast(err.message,"error"));

$("#saveSettings").onclick=e=>withButtonBusy(e.currentTarget, async()=>{ await updateState({settings:{...model.state.settings,level:$("#levelSetting").value,intScore:$("#intSetting").value}}); toast("Settings saved"); }, "Saving…").catch(err=>toast(err.message,"error"));
$("#syncSheet").onclick=e=>withButtonBusy(e.currentTarget, async()=>{ setSheetStatus("syncing"); await api("/api/sync",{method:"POST"}); setSheetStatus("synced"); toast("SPELLS, SpellBook and feats rebuilt from companion state"); }, "Syncing…").catch(err=>{setSheetStatus("error");toast(err.message,"error")});
$("#logout").onclick=async()=>{await api("/api/logout",{method:"POST"});location.reload();};

$("#loginForm").onsubmit=async e=>{
  e.preventDefault(); $("#loginError").textContent="";
  try { await api("/api/login",{method:"POST",body:JSON.stringify({password:$("#password").value})}); $("#login").classList.add("hidden"); $("#app").classList.remove("hidden"); await refresh(); }
  catch(err){$("#loginError").textContent=err.message;}
};

$$('.tab').forEach((tab,i)=>{ tab.setAttribute('aria-selected', String(i===0)); tab.tabIndex = i===0 ? 0 : -1; });

if (UI_READY) boot().catch(err=>{
  document.body.innerHTML = `<main class="content-shell"><div class="panel" style="max-width:760px;margin:8vh auto"><div class="eyebrow">STARTUP ERROR · v${UI_VERSION}</div><h2 style="margin:.45rem 0 1rem">Companion failed to start</h2><p class="muted" style="line-height:1.6">${escapeHtml(err.message)}</p><button class="primary" style="margin-top:1rem" onclick="location.reload()">Reload companion</button></div></main>`;
});
