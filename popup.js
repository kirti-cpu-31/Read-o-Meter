const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const fmt = (s) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`);
const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});

// ---------- settings (reading tools + dim strength) ----------
const toggles = ["progress", "bionic", "focus"];
let settings = { progress: true, bionic: false, focus: false, dim: 0.85, textSize: 100, lineSpacing: 0, theme: "default", dockPos: { v: "bottom", h: "right", dx: 16, dy: 16 } };

async function saveSettings(patch) {
  // read the latest value first so we never overwrite a change made on the page
  const { settings: cur } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({ settings: { ...(cur || {}), ...patch } });
}

function renderSettings() {
  toggles.forEach((k) => ($(k).checked = !!settings[k]));
  const pctDim = Math.round((Number(settings.dim) || 0.85) * 100);
  $("dim").value = String(pctDim);
  $("dimVal").textContent = pctDim + "%";

  const ts = Math.min(200, Math.max(70, Number(settings.textSize) || 100));
  $("tsVal").textContent = ts + "%";
  $("tsDown").disabled = ts <= 70;
  $("tsUp").disabled = ts >= 200;
  const ls = Number(settings.lineSpacing) || 0;
  document.querySelectorAll("#lsSeg .opt").forEach((el) => el.classList.toggle("on", Number(el.dataset.ls) === ls));
  const pp = settings.dockPos || {};
  document.querySelectorAll("#posSeg .opt").forEach((el) =>
    el.classList.toggle("on", el.dataset.v === (pp.v === "top" ? "top" : "bottom") && el.dataset.h === (pp.h === "left" ? "left" : "right"))
  );
  const th = settings.theme || "default";
  document.querySelectorAll("#thSeg .opt").forEach((el) => el.classList.toggle("on", el.dataset.theme === th));
}

// ---------- panel position and summary ----------
document.querySelectorAll("#posSeg .opt").forEach((el) =>
  el.addEventListener("click", () => saveSettings({ dockPos: { v: el.dataset.v, h: el.dataset.h, dx: 16, dy: 16 } }))
);

$("sumBtn").addEventListener("click", async () => {
  const list = $("sumList");
  list.replaceChildren();
  $("sumMsg").textContent = "Summarizing…";
  let items = [];
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const r = await chrome.tabs.sendMessage(tab.id, { type: "getSummary" });
    items = (r && r.sentences) || [];
  } catch (_) { /* restricted page or no article */ }
  if (!items.length) { $("sumMsg").textContent = "Open an article with enough text to summarize."; return; }
  $("sumMsg").textContent = "Key sentences, in the article's own language.";
  items.forEach((t) => { const li = document.createElement("li"); li.textContent = t; li.dir = "auto"; list.append(li); });
});

// ---------- text size, line spacing, theme ----------
const curTs = () => Math.min(200, Math.max(70, Number(settings.textSize) || 100));
$("tsDown").addEventListener("click", () => saveSettings({ textSize: Math.max(70, curTs() - 10) }));
$("tsUp").addEventListener("click", () => saveSettings({ textSize: Math.min(200, curTs() + 10) }));
$("tsVal").addEventListener("click", () => saveSettings({ textSize: 100 }));
document.querySelectorAll("#lsSeg .opt").forEach((el) =>
  el.addEventListener("click", () => saveSettings({ lineSpacing: Number(el.dataset.ls) }))
);
document.querySelectorAll("#thSeg .opt").forEach((el) =>
  el.addEventListener("click", () => saveSettings({ theme: el.dataset.theme }))
);

toggles.forEach((k) => $(k).addEventListener("change", () => saveSettings({ [k]: $(k).checked })));

let dimTimer = 0;
$("dim").addEventListener("input", () => {
  $("dimVal").textContent = $("dim").value + "%";
  clearTimeout(dimTimer);
  dimTimer = setTimeout(() => saveSettings({ dim: Number($("dim").value) / 100 }), 60);
});

// ---------- settings panel (the ⋮ button) ----------
function showSettings(open) {
  $("settings").hidden = !open;
  $("menu").setAttribute("aria-expanded", String(open));
  if (open) $("settings").scrollIntoView({ block: "nearest" });
}
$("menu").addEventListener("click", () => showSettings($("settings").hidden));
$("editTimer").addEventListener("click", () => {
  showSettings(true);
  $("focusMin").focus();
  $("focusMin").select();
});

// ---------- page stats ----------
async function loadStats() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const r = await chrome.tabs.sendMessage(tab.id, { type: "getStats" });
    if (r && r.words >= 100) {
      $("wordsLine").textContent = `${r.wordsRead.toLocaleString()} of ${r.words.toLocaleString()} words read`;
      $("metaLine").textContent = `${r.pct}% done · ${r.minutesLeft} min left`;
      $("fill").style.width = r.pct + "%";
      $("track").setAttribute("aria-valuenow", String(r.pct));
      return;
    }
  } catch (_) { /* restricted page or no article */ }
  $("wordsLine").textContent = "Open an article to see your reading stats.";
  $("metaLine").textContent = "";
  $("fill").style.width = "0%";
  $("track").setAttribute("aria-valuenow", "0");
}
setInterval(loadStats, 1000);

// ---------- pomodoro ----------
let pomo = null;

function readCfg() {
  const f = Math.round(Number($("focusMin").value));
  const b = Math.round(Number($("breakMin").value));
  const ok = f >= 1 && f <= 180 && b >= 1 && b <= 180;
  return { ok, f, b };
}

function renderCfg() {
  const f = pomo ? pomo.focusMin : 25;
  const b = pomo ? pomo.breakMin : 5;
  if (document.activeElement !== $("focusMin")) $("focusMin").value = f;
  if (document.activeElement !== $("breakMin")) $("breakMin").value = b;
  $("cfgSummary").textContent = `Focus ${f} min · Break ${b} min`;
  document.querySelectorAll(".preset").forEach((el) => el.classList.toggle("on", Number(el.dataset.min) === f));
}

function saveCfg() {
  const { ok, f, b } = readCfg();
  $("cfgMsg").classList.toggle("err", !ok);
  if (!ok) { $("cfgMsg").textContent = "Use whole minutes from 1 to 180."; return false; }
  $("cfgMsg").textContent = pomo && pomo.running ? "Saved. It applies from the next session." : "Saved.";
  send({ type: "pomoConfig", focusMin: f, breakMin: b });
  return true;
}

["focusMin", "breakMin"].forEach((id) => $(id).addEventListener("change", saveCfg));
document.querySelectorAll(".preset").forEach((btn) =>
  btn.addEventListener("click", () => { $("focusMin").value = btn.dataset.min; saveCfg(); })
);

function renderPomo() {
  if (pomo && pomo.running) {
    const left = Math.max(0, Math.round((pomo.endTime - Date.now()) / 1000));
    $("timer").textContent = `${pad(Math.floor(left / 60))}:${pad(left % 60)}`;
    $("phase").textContent = (pomo.mode === "focus" ? "Focus" : "Break") + ` · sessions done: ${pomo.sessions}`;
  } else {
    const m = pomo ? pomo.focusMin : 25;
    $("timer").textContent = `${pad(m)}:00`;
    $("phase").textContent = pomo && pomo.sessions ? `Ready · sessions done: ${pomo.sessions}` : "Ready";
  }
}

$("start").addEventListener("click", () => {
  const { ok, f, b } = readCfg();
  if (!ok) { showSettings(true); saveCfg(); return; }
  send({ type: "pomoStart", focusMin: f, breakMin: b });
});
$("stop").addEventListener("click", () => send({ type: "pomoStop" }));
setInterval(renderPomo, 1000);

// ---------- history ----------
async function renderHistory() {
  const { history = {}, daily = {}, total = 0 } = await chrome.storage.local.get(["history", "daily", "total"]);
  const today = new Date().toLocaleDateString("en-CA");
  let week = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() - i * 86400000).toLocaleDateString("en-CA");
    week += daily[d] || 0;
  }
  $("tToday").textContent = fmt(daily[today] || 0);
  $("tWeek").textContent = fmt(week);
  $("tAll").textContent = fmt(total);

  const list = $("list");
  list.replaceChildren();
  const items = Object.values(history).sort((a, b) => b.lastRead - a.lastRead).slice(0, 15);
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No reading history yet.";
    list.append(li);
  }
  items.forEach((e) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = e.url; a.target = "_blank"; a.title = e.title;
    a.textContent = e.title || e.url;
    const s = document.createElement("small");
    s.textContent = `${fmt(e.seconds)} · ${e.maxScroll}% read · ${new Date(e.lastRead).toLocaleDateString()}`;
    li.append(a, s);
    list.append(li);
  });
}

$("clear").addEventListener("click", async () => {
  if (!confirm("Clear all reading history?")) return;
  await chrome.storage.local.remove(["history", "daily", "total"]);
  renderHistory();
});

// ---------- keep popup in sync ----------
chrome.storage.onChanged.addListener((c) => {
  if (c.settings) { settings = { ...settings, ...c.settings.newValue }; renderSettings(); }
  if (c.pomo) { pomo = c.pomo.newValue; renderPomo(); renderCfg(); }
  if (c.history || c.daily || c.total) renderHistory();
});

(async () => {
  const d = await chrome.storage.local.get(["settings", "pomo"]);
  settings = { ...settings, ...(d.settings || {}) };
  pomo = d.pomo || null;
  renderSettings(); renderPomo(); renderCfg(); renderHistory(); loadStats();
})();
