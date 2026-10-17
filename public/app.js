const UI_VERSION = "5.0.0";
const $ = q => document.querySelector(q);
const $$ = q => [...document.querySelectorAll(q)];

const REQUIRED_UI = [
  "#login", "#loginForm", "#app", "#charName", "#subtitle", "#dc", "#atk", "#prepCount",
  "#slotDashboard", "#preparedList", "#bookList", "#discoverList", "#inventoryRows", "#levelCards",
  "#ownedFeats", "#featCatalogue", "#levelUpForm", "#nextLevelSummary", "#levelSpell1", "#levelSpell2",
  "#levelFilter", "#schoolFilter", "#bookSearch", "#spellSearch", "#featSearch", "#castResult", "#toast"
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

  throw new Error(`Interface files are out of sync (missing ${missing.join(", ")}). Redeploy v${UI_VERSION} and hard-refresh once.`);
}

let model = null;
let catalogue = [];
let featCatalogue = [];
let inventory = { coins: {}, items: [] };
let inventoryDraft = [];
let discoverLimit = window.matchMedia("(max-width: 700px)").matches ? 24 : 60;

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2200);
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
}

async function refresh() {
  const [charResult, spellResult, featResult, invResult] = await Promise.all([
    api("/api/character"), api("/api/spells"), api("/api/feats"), api("/api/inventory")
  ]);
  model = charResult;
  catalogue = spellResult.results || [];
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

  $("#arcaneRecoveryStatus").textContent = model.state.resources?.arcaneRecoveryUsed
    ? "Arcane Recovery used"
    : `Arcane Recovery: ${c.arcaneRecoveryBudget} slot levels`;

  renderSlots();
  renderPrepared();
  renderSpellbook();
  renderDiscover();
  renderInventory();
  renderFeats();
  renderLevelUp();
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
  const maxSpellLevel = Math.ceil(model.character.level / 2);
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
  const maxSpellLevel = Math.ceil(model.character.level / 2);
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

function renderFeats() {
  const chosen = model.state.feats || [];
  $("#ownedFeats").innerHTML = chosen.length ? chosen.map(entry => {
    const feat = featCatalogue.find(f => f.id === entry.id);
    if (!feat) return "";
    return `<article class="owned-feat"><div><div class="spell-kicker">Chosen at Wizard ${entry.chosenAtLevel || "?"}</div><h4>${escapeHtml(feat.name)}</h4></div><p>${escapeHtml(feat.summary)}</p>${entry.ability ? `<span class="badge">+1 ${escapeHtml(abilityLabel(entry.ability))}</span>` : ""}${entry.note ? `<span class="badge">${escapeHtml(entry.note)}</span>` : ""}</article>`;
  }).join("") : `<div class="notice">No feats selected yet. Your first Wizard ASI/feat choice is at level 4.</div>`;

  const q = $("#featSearch").value.trim().toLowerCase();
  const list = featCatalogue.filter(f => !q || `${f.name} ${f.summary} ${f.reason || ""}`.toLowerCase().includes(q));
  $("#featCatalogue").innerHTML = list.map(feat => {
    const chosenAlready = chosen.some(x => x.id === feat.id);
    const status = chosenAlready && !feat.repeatable ? "Chosen" : feat.eligible ? "Available" : (feat.reason || "Unavailable");
    return `<article class="feat-card ${feat.eligible ? "eligible" : "locked"}">
      <div class="feat-card-head"><div><div class="spell-kicker">PHB FEAT</div><h3>${escapeHtml(feat.name)}</h3></div><span class="badge ${feat.eligible ? "prepared-badge" : ""}">${escapeHtml(status)}</span></div>
      <p>${escapeHtml(feat.summary)}</p>
      ${feat.prerequisite ? `<div class="feat-prereq">${feat.eligible ? "Prerequisite met" : escapeHtml(feat.reason || "Prerequisite not met")}</div>` : `<div class="feat-prereq">No prerequisite</div>`}
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
  const result = await api("/api/level-up", {method:"POST",body:JSON.stringify(body)});
  model.state = result.state;
  model.character = result.character;
  const featResult = await api("/api/feats");
  featCatalogue = featResult.results || [];
  renderAll();
  toast(`Level up complete — Noctis is now Wizard ${result.character.level}`);
}

async function updateState(patch) {
  const result = await api("/api/state", { method:"PUT", body:JSON.stringify({...model.state,...patch}) });
  model.state = result.state;
  if (result.character) model.character = result.character;
  renderAll();
}

async function castSpell(index, explicitLevel) {
  const spell = getSpell(index);
  if (!spell) return;
  let castLevel = explicitLevel;
  if (castLevel === undefined) {
    const select = document.querySelector(`[data-cast-select="${CSS.escape(index)}"]`);
    castLevel = Number(select?.value || spell.level || 0);
  }
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
  $("#castResult").scrollIntoView({behavior:"smooth",block:"center"});
}

async function showDetails(index) {
  const spell = getSpell(index) || await api(`/api/spells/${index}`);
  $("#spellDetail").innerHTML = `<div class="eyebrow">${escapeHtml(schoolName(spell))}</div><h2>${escapeHtml(spell.name)}</h2>
    <div class="detail-meta"><span class="badge">${Number(spell.level)===0?"Cantrip":`${ordinal(spell.level)} level`}</span><span class="badge">${escapeHtml(spell.casting_time||"")}</span><span class="badge">${escapeHtml(spell.range||"")}</span>${spell.concentration?`<span class="badge">Concentration</span>`:""}${spell.ritual?`<span class="badge">Ritual</span>`:""}</div>
    <p><b>Components:</b> ${escapeHtml(componentsText(spell))}</p>
    <p><b>Duration:</b> ${escapeHtml(spell.duration||"")}</p>
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
  $("#arcaneRecoveryHelp").textContent = used
    ? "You've already used Arcane Recovery since your last long rest. You can still take a short rest, but it won't restore spell slots."
    : `Once per long rest, Arcane Recovery can restore expended spell slots with combined levels up to ${model.character.arcaneRecoveryBudget}.`;
  const options = recoveryOptions();
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

if (!verifyUiVersion()) {
  // The page is reloading to pick up matching static assets.
  throw new Error("Refreshing updated interface…");
}

// Navigation
$$('.tab').forEach(btn => btn.onclick = () => {
  $$('.tab').forEach(x=>x.classList.toggle('active',x===btn));
  $$('.view').forEach(v=>v.classList.toggle('active',v.id===btn.dataset.tab));
});

// Event delegation for dynamically-rendered cards and inventory rows.
document.addEventListener("click", async e => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const index = btn.dataset.index;
  try {
    if (action === "learn") { await updateState({known:[...new Set([...model.state.known,index])]}); toast("Added to spellbook and synced to the DM sheet"); }
    if (action === "forget") { await updateState({known:model.state.known.filter(x=>x!==index),prepared:model.state.prepared.filter(x=>x!==index)}); toast("Removed and sheet updated"); }
    if (action === "prepare") {
      const isPrepared=model.state.prepared.includes(index);
      if (!isPrepared && model.state.prepared.length>=model.character.preparedMax) return toast(`You can prepare ${model.character.preparedMax} spells`);
      await updateState({prepared:isPrepared?model.state.prepared.filter(x=>x!==index):[...model.state.prepared,index]});
      toast(isPrepared?"Spell unprepared — DM sheet updated":"Spell prepared — DM sheet updated");
    }
    if (action === "cast") await castSpell(index, btn.dataset.castLevel !== undefined ? Number(btn.dataset.castLevel) : undefined);
    if (action === "details") await showDetails(index);
    if (action === "remove-item") { readInventoryDraftFromDom(); inventoryDraft.splice(Number(btn.dataset.row),1); renderInventory(); }
    if (action === "show-more") { discoverLimit += 24; renderDiscover(); }
  } catch (err) { toast(err.message); }
});

$("#bookSearch").addEventListener("input",renderSpellbook);
$("#spellSearch").addEventListener("input",()=>{discoverLimit=24;renderDiscover();});
$("#levelFilter").addEventListener("change",()=>{discoverLimit=24;renderDiscover();});
$("#schoolFilter").addEventListener("change",()=>{discoverLimit=24;renderDiscover();});
$("#featSearch").addEventListener("input",renderFeats);
$("#closeDialog").onclick=()=>$("#spellDialog").close();
$("#closeShortRest").onclick=()=>$("#shortRestDialog").close();
$("#levelSpell1").addEventListener("change",selectedLevelSpellPreview);
$("#levelSpell2").addEventListener("change",selectedLevelSpellPreview);
$("#levelFeat").addEventListener("change",selectedFeatPreview);
$$("input[name=advancement]").forEach(x=>x.addEventListener("change",updateAdvancementPanels));
$("#asiMode").addEventListener("change",updateAdvancementPanels);
$("#commitLevelUp").onclick=()=>commitLevelUp().catch(e=>toast(e.message));

$("#shortRest").onclick=openShortRest;
$("#confirmShortRest").onclick=()=>takeShortRest(true).catch(e=>toast(e.message));
$("#shortRestNoRecovery").onclick=()=>takeShortRest(false).catch(e=>toast(e.message));
$("#longRest").onclick=async()=>{
  if (!confirm("Take a long rest? This restores all spell slots and resets Arcane Recovery.")) return;
  try { const r=await api("/api/rest",{method:"POST",body:JSON.stringify({type:"long"})}); model.state=r.state; model.character=r.character; renderAll(); toast("Long rest complete — spell slots restored"); } catch(e){toast(e.message)}
};

$("#addInventoryRow").onclick=()=>{readInventoryDraftFromDom();inventoryDraft.push({qty:"1",name:"",cost:"",weight:""});renderInventory();};
$("#saveInventory").onclick=async()=>{
  try {
    readInventoryDraftFromDom();
    const items=inventoryDraft.filter(x=>x.name||x.qty||x.cost||x.weight);
    const coins={cp:$("#coinCp").value,sp:$("#coinSp").value,ep:$("#coinEp").value,gp:$("#coinGp").value,pp:$("#coinPp").value};
    await api("/api/inventory",{method:"PUT",body:JSON.stringify({items,coins})});
    inventory={items,coins}; inventoryDraft=items.map(x=>({...x})); renderInventory(); toast("Inventory saved to BAG sheet");
  } catch(e){toast(e.message)}
};

$("#saveSettings").onclick=async()=>{
  try { await updateState({settings:{...model.state.settings,level:$("#levelSetting").value,intScore:$("#intSetting").value}}); toast("Settings saved"); } catch(e){toast(e.message)}
};
$("#syncSheet").onclick=async()=>{try{await api("/api/sync",{method:"POST"});toast("SPELLS, SpellBook and feats rebuilt from companion state");}catch(e){toast(e.message)}};
$("#logout").onclick=async()=>{await api("/api/logout",{method:"POST"});location.reload();};

$("#loginForm").onsubmit=async e=>{
  e.preventDefault(); $("#loginError").textContent="";
  try { await api("/api/login",{method:"POST",body:JSON.stringify({password:$("#password").value})}); $("#login").classList.add("hidden"); $("#app").classList.remove("hidden"); await refresh(); }
  catch(err){$("#loginError").textContent=err.message;}
};

boot().catch(err=>{
  if (err.message === "Refreshing updated interface…") return;
  document.body.innerHTML = `<main class="content-shell"><div class="panel" style="max-width:760px;margin:8vh auto"><div class="eyebrow">STARTUP ERROR · v${UI_VERSION}</div><h2 style="margin:.45rem 0 1rem">Companion failed to start</h2><p class="muted" style="line-height:1.6">${escapeHtml(err.message)}</p><button class="primary" style="margin-top:1rem" onclick="location.reload()">Reload companion</button></div></main>`;
});
