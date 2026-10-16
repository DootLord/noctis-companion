const $ = q => document.querySelector(q);
const $$ = q => [...document.querySelectorAll(q)];

let model = null;
let catalogue = [];
let inventory = { coins: {}, items: [] };
let inventoryDraft = [];

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

  return `<article class="spell-card ${prepared ? "prepared" : ""} ${schoolName(spell).toLowerCase() === "necromancy" ? "necromancy" : ""}">
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
  const [charResult, spellResult, invResult] = await Promise.all([
    api("/api/character"), api("/api/spells"), api("/api/inventory")
  ]);
  model = charResult;
  catalogue = spellResult.results || [];
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
  renderLevelUp();
}

function renderSlots() {
  $("#slotDashboard").innerHTML = model.character.slots.map((max, i) => {
    const level = i + 1;
    const used = Number(model.state.slotsUsed?.[level] || 0);
    const remain = Math.max(0, max - used);
    const orbs = Array.from({length:max}, (_,n) => `<span class="slot-orb ${n < used ? "spent" : "available"}" title="${n < used ? "Spent" : "Available"}"></span>`).join("");
    return `<div class="slot-level"><div><strong>${ordinal(level)}</strong><span>${remain}/${max} available</span></div><div class="slot-orbs">${orbs}</div></div>`;
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
  $("#discoverList").innerHTML = spells.sort((a,b)=>a.level-b.level || a.name.localeCompare(b.name)).map(s=>spellCard(s,"discover")).join("");
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

function renderLevelUp() {
  const l = model.character.level;
  const cards = [
    { level:l, title:"Right now", items:[`${model.character.preparedMax} prepared spells`,`${model.character.spellbookMinimum} minimum levelled spells in your spellbook`,`${model.character.cantripsKnown} cantrips known`,"Necromancy Savant","Grim Harvest"] },
    { level:4, title:"Wizard 4", items:["Ability Score Improvement / feat","Learn 2 more wizard spells","Gain another cantrip","3 second-level spell slots"] },
    { level:5, title:"Wizard 5", items:["Unlock 3rd-level wizard spells","Learn 2 more wizard spells","Animate Dead becomes available","Proficiency bonus becomes +3"] },
    { level:6, title:"Necromancer 6", items:["Undead Thralls","Animate Dead is added if you don't already know it","Your created undead become stronger"] }
  ];
  $("#levelCards").innerHTML = cards.map(c=>`<article class="level-card ${c.level===l?"current":""}"><div class="eyebrow">LEVEL ${c.level}</div><h3>${c.title}</h3><ul>${c.items.map(i=>`<li>${escapeHtml(i)}</li>`).join("")}</ul></article>`).join("");
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
  } catch (err) { toast(err.message); }
});

$("#bookSearch").addEventListener("input",renderSpellbook);
$("#spellSearch").addEventListener("input",renderDiscover);
$("#levelFilter").addEventListener("change",renderDiscover);
$("#schoolFilter").addEventListener("change",renderDiscover);
$("#closeDialog").onclick=()=>$("#spellDialog").close();
$("#closeShortRest").onclick=()=>$("#shortRestDialog").close();

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
$("#syncSheet").onclick=async()=>{try{await api("/api/sync",{method:"POST"});toast("SPELLS and SpellBook rebuilt from companion state");}catch(e){toast(e.message)}};
$("#logout").onclick=async()=>{await api("/api/logout",{method:"POST"});location.reload();};

$("#loginForm").onsubmit=async e=>{
  e.preventDefault(); $("#loginError").textContent="";
  try { await api("/api/login",{method:"POST",body:JSON.stringify({password:$("#password").value})}); $("#login").classList.add("hidden"); $("#app").classList.remove("hidden"); await refresh(); }
  catch(err){$("#loginError").textContent=err.message;}
};

boot().catch(err=>{document.body.innerHTML=`<main><div class="notice"><b>Companion failed to start:</b> ${escapeHtml(err.message)}</div></main>`;});
