const $ = (q) => document.querySelector(q);
const $$ = (q) => [...document.querySelectorAll(q)];

let model = null;
let catalogue = [];
let detailsCache = new Map();

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
  setTimeout(() => el.classList.remove("show"), 1800);
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
  model = await api("/api/character");
  catalogue = (await api("/api/spells")).results || [];
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

  $("#slotSummary").innerHTML = c.slots.map((n, i) =>
    `<span class="slot">${ordinal(i+1)}: ${n}</span>`).join("");

  renderPrepared();
  renderSpellbook();
  renderDiscover();
  renderLevelUp();
}

function ordinal(n) {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

function getCatalogueSpell(index) {
  return catalogue.find(s => s.index === index);
}

function spellCard(spell, mode) {
  const isKnown = model.state.known.includes(spell.index);
  const isPrepared = model.state.prepared.includes(spell.index);
  const level = Number(spell.level || 0);
  let actions = "";

  if (mode === "discover") {
    actions = isKnown
      ? `<button class="remove" data-action="forget" data-index="${spell.index}">Remove</button>`
      : `<button class="primary" data-action="learn" data-index="${spell.index}">Add to spellbook</button>`;
  } else if (mode === "book" && level > 0) {
    actions = `<button class="${isPrepared ? "remove" : "primary"}" data-action="prepare" data-index="${spell.index}">
      ${isPrepared ? "Unprepare" : "Prepare"}
    </button>
    <button class="remove" data-action="forget" data-index="${spell.index}">Remove</button>`;
  } else if (mode === "book") {
    actions = `<button class="remove" data-action="forget" data-index="${spell.index}">Remove</button>`;
  }

  return `<article class="spell ${isPrepared ? "prepared" : ""}" data-detail="${spell.index}">
    <h3>${escapeHtml(spell.name)}</h3>
    <div class="meta">
      <span class="badge">${level === 0 ? "Cantrip" : `${ordinal(level)} level`}</span>
      ${isKnown ? `<span class="badge">Spellbook</span>` : ""}
      ${isPrepared ? `<span class="badge">Prepared</span>` : ""}
    </div>
    <div class="spell-actions">${actions}</div>
  </article>`;
}

function renderPrepared() {
  const spells = model.state.prepared
    .map(getCatalogueSpell)
    .filter(Boolean);

  // Known cantrips are always castable, so show them here too.
  const cantrips = model.state.known
    .map(getCatalogueSpell)
    .filter(s => s && Number(s.level) === 0);

  const all = [...cantrips, ...spells];
  $("#preparedList").innerHTML = all.length
    ? all.map(s => spellCard(s, "prepared")).join("")
    : `<div class="notice">Nothing prepared yet. Open <b>Spellbook</b> and prepare up to ${model.character.preparedMax} levelled spells.</div>`;
  bindCards();
}

function renderSpellbook() {
  const q = $("#bookSearch").value.trim().toLowerCase();
  const spells = model.state.known
    .map(getCatalogueSpell)
    .filter(Boolean)
    .filter(s => !q || s.name.toLowerCase().includes(q));

  const levelled = spells.filter(s => Number(s.level) > 0).length;
  $("#bookStats").innerHTML =
    `Known levelled spells: <b>${levelled}</b> / minimum expected <b>${model.character.spellbookMinimum}</b>.
     Prepared: <b>${model.state.prepared.length}</b> / <b>${model.character.preparedMax}</b>.`;

  $("#bookList").innerHTML = spells.length
    ? spells.sort((a,b) => a.level-b.level || a.name.localeCompare(b.name)).map(s => spellCard(s, "book")).join("")
    : `<div class="notice">Your companion spellbook is empty. Add spells from <b>Choose Spells</b>.</div>`;
  bindCards();
}

function renderDiscover() {
  const filter = $("#levelFilter").value;
  const q = $("#spellSearch").value.trim().toLowerCase();
  const maxSpellLevel = Math.ceil(model.character.level / 2);

  let spells = catalogue.filter(s => Number(s.level) <= maxSpellLevel);
  if (filter !== "all") spells = spells.filter(s => Number(s.level) === Number(filter));
  if (q) spells = spells.filter(s => s.name.toLowerCase().includes(q));

  $("#discoverList").innerHTML = spells
    .sort((a,b) => a.level-b.level || a.name.localeCompare(b.name))
    .map(s => spellCard(s, "discover")).join("");
  bindCards();
}

function renderLevelUp() {
  const l = model.character.level;
  const cards = [
    {
      level: l,
      title: "Right now",
      items: [
        `${model.character.preparedMax} prepared spells`,
        `${model.character.spellbookMinimum} minimum levelled spells in your spellbook`,
        `${model.character.cantripsKnown} cantrips known`,
        "Necromancy Savant",
        "Grim Harvest"
      ]
    },
    {
      level: 4,
      title: "Wizard 4",
      items: [
        "Ability Score Improvement / feat",
        "Learn 2 more wizard spells",
        "Gain another cantrip",
        "3 second-level spell slots"
      ]
    },
    {
      level: 5,
      title: "Wizard 5",
      items: [
        "Unlock 3rd-level wizard spells",
        "Learn 2 more wizard spells",
        "Animate Dead becomes available",
        "Proficiency bonus becomes +3"
      ]
    },
    {
      level: 6,
      title: "Necromancer 6",
      items: [
        "Undead Thralls",
        "Animate Dead added to your spellbook if needed",
        "Raised undead become considerably stronger"
      ]
    }
  ];

  $("#levelCards").innerHTML = cards.map(c => `
    <article class="level-card ${c.level === l ? "current" : ""}">
      <div class="eyebrow">LEVEL ${c.level}</div>
      <h3>${c.title}</h3>
      <ul>${c.items.map(i => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
    </article>`).join("");
}

async function updateState(patch) {
  const next = { ...model.state, ...patch };
  await api("/api/state", { method: "PUT", body: JSON.stringify(next) });
  model.state = next;
  renderAll();
}

function bindCards() {
  $$("[data-action]").forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const index = btn.dataset.index;
      const action = btn.dataset.action;

      try {
        if (action === "learn") {
          await updateState({ known: [...new Set([...model.state.known, index])] });
          toast("Added to spellbook");
        }

        if (action === "forget") {
          await updateState({
            known: model.state.known.filter(x => x !== index),
            prepared: model.state.prepared.filter(x => x !== index)
          });
          toast("Removed from spellbook");
        }

        if (action === "prepare") {
          const isPrepared = model.state.prepared.includes(index);
          const spell = getCatalogueSpell(index);
          if (Number(spell?.level) === 0) return;

          if (!isPrepared && model.state.prepared.length >= model.character.preparedMax) {
            toast(`You can only prepare ${model.character.preparedMax} spells`);
            return;
          }
          await updateState({
            prepared: isPrepared
              ? model.state.prepared.filter(x => x !== index)
              : [...model.state.prepared, index]
          });
          toast(isPrepared ? "Spell unprepared" : "Spell prepared");
        }
      } catch (err) {
        toast(err.message);
      }
    };
  });

  $$("[data-detail]").forEach(card => {
    card.onclick = () => showSpell(card.dataset.detail);
  });
}

async function showSpell(index) {
  try {
    let spell = detailsCache.get(index);
    if (!spell) {
      spell = await api(`/api/spells/${index}`);
      detailsCache.set(index, spell);
    }

    const desc = Array.isArray(spell.desc) ? spell.desc : [spell.description || ""];
    $("#spellDetail").innerHTML = `
      <div class="eyebrow">${escapeHtml(spell.school?.name || "Spell")}</div>
      <h2>${escapeHtml(spell.name)}</h2>
      <div class="detail-meta">
        <span class="badge">${Number(spell.level) === 0 ? "Cantrip" : `${ordinal(spell.level)} level`}</span>
        <span class="badge">${escapeHtml(spell.casting_time || "")}</span>
        <span class="badge">${escapeHtml(spell.range || "")}</span>
        ${spell.concentration ? `<span class="badge">Concentration</span>` : ""}
        ${spell.ritual ? `<span class="badge">Ritual</span>` : ""}
      </div>
      <p class="muted">Components: ${escapeHtml((spell.components || []).join(", "))}${spell.material ? ` — ${escapeHtml(spell.material)}` : ""}</p>
      <div class="detail-body">${desc.map(p => `<p>${escapeHtml(p)}</p>`).join("")}</div>
    `;
    $("#spellDialog").showModal();
  } catch (err) {
    toast(err.message);
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  })[ch]);
}

$$(".tab").forEach(btn => {
  btn.onclick = () => {
    $$(".tab").forEach(x => x.classList.toggle("active", x === btn));
    $$(".view").forEach(v => v.classList.toggle("active", v.id === btn.dataset.tab));
  };
});

$("#bookSearch").addEventListener("input", renderSpellbook);
$("#spellSearch").addEventListener("input", renderDiscover);
$("#levelFilter").addEventListener("change", renderDiscover);
$("#closeDialog").onclick = () => $("#spellDialog").close();

$("#loginForm").onsubmit = async (e) => {
  e.preventDefault();
  $("#loginError").textContent = "";
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ password: $("#password").value })
    });
    $("#login").classList.add("hidden");
    $("#app").classList.remove("hidden");
    await refresh();
  } catch (err) {
    $("#loginError").textContent = err.message;
  }
};

$("#saveSettings").onclick = async () => {
  try {
    await updateState({
      settings: {
        ...model.state.settings,
        level: $("#levelSetting").value,
        intScore: $("#intSetting").value
      }
    });
    await refresh();
    toast("Settings saved");
  } catch (err) {
    toast(err.message);
  }
};

$("#logout").onclick = async () => {
  await api("/api/logout", { method: "POST" });
  location.reload();
};

boot().catch(err => {
  document.body.innerHTML = `<main><div class="notice"><b>Companion failed to start:</b> ${escapeHtml(err.message)}</div></main>`;
});
