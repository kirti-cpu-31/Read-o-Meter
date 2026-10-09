// Read-o-Meter: content script.
// Runs on every web page. If the page looks like an article, it adds a progress
// bar at the top and a small card showing % read, time left and your pace.
// The card also has reading comfort controls: themes, text size, spacing, bionic reading.

(() => {
  if (window.__readOMeterLoaded) return;
  window.__readOMeterLoaded = true;

  const DEFAULTS = {
    wpm: 200,
    enabled: true,
    largeText: false,
    highContrast: false,
    theme: "light",   // light | sepia | dark
    fontStep: 0,      // text size: -2 .. 6 (each step = 10%)
    spacingStep: 0,   // line spacing: 0 = page default, 1 .. 5 = roomier
    bionic: false,
  };
  const MIN_ARTICLE_WORDS = 150; // shorter pages are not treated as articles
  const IDLE_LIMIT_MS = 8000;    // no scrolling for 8s = not actively reading
  const SPACING_VALUES = [0, 1.5, 1.65, 1.8, 1.95, 2.1];
  let settings = { ...DEFAULTS };

  // ---------- 1. Find the article and count its words ----------
  const root =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.body;

  function countWords(el) {
    let text = "";
    el.querySelectorAll("p").forEach((p) => {
      text += " " + p.innerText;
    });
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  const totalWords = countWords(root);
  if (totalWords < MIN_ARTICLE_WORDS) return;

  // ---------- 2. Build the UI ----------
  const bar = document.createElement("div");
  bar.id = "rom-bar";
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", "Reading progress");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  bar.setAttribute("aria-valuenow", "0");
  bar.innerHTML = '<div id="rom-fill"></div>';

  const ICON_GEAR =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
  const ICON_X =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  const badge = document.createElement("div");
  badge.id = "rom-badge";
  badge.innerHTML = `
    <div class="rom-head">
      <div class="rom-pct"><span id="rom-percent">0%</span><small>read</small></div>
      <div class="rom-tools">
        <button type="button" id="rom-gear" class="rom-icon" aria-label="Reading settings" aria-expanded="false" aria-controls="rom-panel">${ICON_GEAR}</button>
        <button type="button" id="rom-hide" class="rom-icon" aria-label="Hide Read-o-Meter (Alt+R shows it again)">${ICON_X}</button>
      </div>
    </div>
    <div class="rom-track"><div id="rom-mini"></div></div>
    <div class="rom-chips">
      <div class="rom-chip"><b id="rom-left">Calculating…</b></div>
      <div class="rom-chip"><b id="rom-pace">…</b><span id="rom-pace-note">measuring</span></div>
    </div>
    <button type="button" id="rom-resume" hidden>Resume where you left off</button>

    <div id="rom-panel" hidden>
      <div class="rom-row"><span>Theme</span>
        <div class="rom-themes" role="group" aria-label="Theme">
          <button type="button" class="rom-theme" data-theme="light" aria-label="Light" aria-pressed="false"></button>
          <button type="button" class="rom-theme" data-theme="sepia" aria-label="Sepia" aria-pressed="false"></button>
          <button type="button" class="rom-theme" data-theme="dark" aria-label="Dark" aria-pressed="false"></button>
        </div>
      </div>
      <div class="rom-row"><span>Text size</span>
        <div class="rom-step">
          <button type="button" data-act="size-" aria-label="Smaller text">A−</button>
          <em id="rom-size">100%</em>
          <button type="button" data-act="size+" aria-label="Larger text">A+</button>
        </div>
      </div>
      <div class="rom-row"><span>Line spacing</span>
        <div class="rom-step">
          <button type="button" data-act="space-" aria-label="Less line spacing">−</button>
          <em id="rom-space">Auto</em>
          <button type="button" data-act="space+" aria-label="More line spacing">+</button>
        </div>
      </div>
      <div class="rom-row"><span id="rom-bionic-label">Bionic reading</span>
        <button type="button" id="rom-bionic" class="rom-switch" role="switch" aria-checked="false" aria-labelledby="rom-bionic-label"></button>
      </div>
      <button type="button" id="rom-reset">Reset reading settings</button>
    </div>`;

  document.documentElement.append(bar, badge);

  const fill = bar.querySelector("#rom-fill");
  const mini = badge.querySelector("#rom-mini");
  const percentEl = badge.querySelector("#rom-percent");
  const leftEl = badge.querySelector("#rom-left");
  const paceEl = badge.querySelector("#rom-pace");
  const paceNoteEl = badge.querySelector("#rom-pace-note");
  const resumeBtn = badge.querySelector("#rom-resume");
  const hideBtn = badge.querySelector("#rom-hide");
  const gearBtn = badge.querySelector("#rom-gear");
  const panel = badge.querySelector("#rom-panel");
  const sizeEl = badge.querySelector("#rom-size");
  const spaceEl = badge.querySelector("#rom-space");
  const bionicBtn = badge.querySelector("#rom-bionic");

  // ---------- 3. Reading state ----------
  let progress = 0;        // 0 to 1, where the bottom of the screen is in the article
  let lastProgress = 0;
  let sessionWords = 0;    // words scrolled past while reading
  let activeSeconds = 0;   // seconds spent actively reading
  let lastScrollAt = 0;
  let dirty = false;       // true once the user has scrolled (so we can save)
  let hidden = false;

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  function articleBox() {
    const rect = root.getBoundingClientRect();
    return { top: rect.top + window.scrollY, height: Math.max(rect.height, 1) };
  }

  function getProgress() {
    const { top, height } = articleBox();
    return clamp((window.scrollY + window.innerHeight - top) / height, 0, 1);
  }

  function onScroll() {
    progress = getProgress();
    const delta = progress - lastProgress;
    // Only count small forward moves as reading (ignore jumps and scrolling back)
    if (delta > 0 && delta * totalWords < 400) sessionWords += delta * totalWords;
    lastProgress = progress;
    lastScrollAt = Date.now();
    dirty = true;
    render();
  }

  // ---------- 4. Pace and time left ----------
  function measuredWpm() {
    if (activeSeconds < 15 || sessionWords < 40) return null;
    return clamp(Math.round(sessionWords / (activeSeconds / 60)), 80, 700);
  }

  function formatLeft(mins) {
    if (progress >= 0.99) return "Finished!";
    if (mins < 1) return "Less than 1 min left";
    const m = Math.round(mins);
    if (m < 60) return m + " min left";
    return Math.floor(m / 60) + " h " + (m % 60) + " min left";
  }

  function getStats() {
    const measured = measuredWpm();
    const wpm = measured || settings.wpm;
    const minutesLeft = (totalWords * (1 - progress)) / wpm;
    return {
      percent: Math.round(progress * 100),
      timeLeft: formatLeft(minutesLeft),
      wpm,
      measured: Boolean(measured),
      totalWords,
    };
  }

  function render() {
    const s = getStats();
    fill.style.width = s.percent + "%";
    mini.style.width = Math.max(1, s.percent) + "%";
    bar.setAttribute("aria-valuenow", String(s.percent));
    percentEl.textContent = s.percent + "%";
    leftEl.textContent = s.timeLeft;
    paceEl.textContent = s.wpm + " wpm";
    paceNoteEl.textContent = s.measured ? "your pace" : "estimated";
  }

  // Every second: count time only while the tab is visible and you are scrolling
  setInterval(() => {
    const active =
      document.visibilityState === "visible" &&
      Date.now() - lastScrollAt < IDLE_LIMIT_MS;
    if (active) activeSeconds++;
    render();
  }, 1000);

  // ---------- 5. Reading comfort: text size and spacing ----------
  const TEXT_SELECTOR = "p, li, blockquote, dd";

  function applyTypography() {
    const els = Array.from(root.querySelectorAll(TEXT_SELECTOR));
    const scale = 1 + settings.fontStep * 0.1;
    const lh = SPACING_VALUES[settings.spacingStep] || 0;

    // Read phase first: remember each element's original size once
    els.forEach((el) => {
      if (!el.dataset.romBase) el.dataset.romBase = parseFloat(getComputedStyle(el).fontSize) || 16;
    });
    // Write phase
    els.forEach((el) => {
      if (settings.fontStep === 0) el.style.removeProperty("font-size");
      else el.style.setProperty("font-size", (el.dataset.romBase * scale).toFixed(1) + "px", "important");
      if (!lh) el.style.removeProperty("line-height");
      else el.style.setProperty("line-height", String(lh), "important");
    });
  }

  // ---------- 6. Reading comfort: bionic reading ----------
  const SKIP = "script, style, textarea, pre, code, .rom-bio";
  const WORD = /\p{L}[\p{L}\p{N}'\u2019]*/gu;

  function bionicOn() {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      const par = n.parentElement;
      if (n.nodeValue.trim().length < 2 || !par) continue;
      if (par.closest(SKIP) || !par.closest(TEXT_SELECTOR)) continue;
      nodes.push(n);
    }
    nodes.forEach((n) => {
      const text = n.nodeValue;
      const span = document.createElement("span");
      span.className = "rom-bio";
      span.dataset.orig = text;
      let last = 0, m;
      WORD.lastIndex = 0;
      while ((m = WORD.exec(text))) {
        span.append(text.slice(last, m.index));
        const w = m[0];
        const k = Math.ceil(w.length / 2);
        const b = document.createElement("b");
        b.textContent = w.slice(0, k);
        span.append(b, w.slice(k));
        last = m.index + w.length;
      }
      span.append(text.slice(last));
      n.replaceWith(span);
    });
  }

  function bionicOff() {
    document.querySelectorAll("span.rom-bio").forEach((sp) => {
      sp.replaceWith(document.createTextNode(sp.dataset.orig));
    });
    root.normalize();
  }

  let bionicActive = false;

  // ---------- 7. Settings ----------
  function applySettings() {
    const show = settings.enabled && !hidden;
    bar.style.display = settings.enabled ? "block" : "none";
    badge.style.display = show ? "flex" : "none";
    badge.classList.toggle("rom-large", settings.largeText);
    badge.classList.toggle("rom-contrast", settings.highContrast);
    bar.classList.toggle("rom-contrast", settings.highContrast);

    // Page theme (dark and sepia are applied to the whole page)
    const html = document.documentElement;
    html.classList.remove("rom-theme-dark", "rom-theme-sepia");
    if (settings.enabled && settings.theme !== "light") html.classList.add("rom-theme-" + settings.theme);

    // Panel controls
    badge.querySelectorAll(".rom-theme").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.theme === settings.theme));
    });
    sizeEl.textContent = Math.round((1 + settings.fontStep * 0.1) * 100) + "%";
    spaceEl.textContent = settings.spacingStep ? SPACING_VALUES[settings.spacingStep].toFixed(2) : "Auto";
    bionicBtn.setAttribute("aria-checked", String(settings.bionic));

    if (settings.enabled) applyTypography();
    const wantBionic = settings.enabled && settings.bionic;
    if (wantBionic && !bionicActive) { bionicOn(); bionicActive = true; }
    if (!wantBionic && bionicActive) { bionicOff(); bionicActive = false; }

    // Re-measure after layout changes, without counting it as reading
    progress = lastProgress = getProgress();
    render();
  }

  function change(patch) {
    settings = { ...settings, ...patch };
    chrome.storage.sync.set(patch);
    applySettings();
  }

  chrome.storage.sync.get(DEFAULTS, (saved) => {
    settings = { ...DEFAULTS, ...saved };
    applySettings();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const key in changes) settings[key] = changes[key].newValue;
    applySettings();
  });

  // ---------- 8. Resume where you left off ----------
  const posKey = "pos:" + location.origin + location.pathname;

  chrome.storage.local.get(posKey, (data) => {
    const saved = data[posKey];
    if (typeof saved === "number" && saved > 0.05 && saved < 0.98 && getProgress() < 0.05) {
      resumeBtn.hidden = false;
      resumeBtn.addEventListener("click", () => {
        const { top, height } = articleBox();
        window.scrollTo({ top: top + saved * height - window.innerHeight, behavior: "smooth" });
        resumeBtn.hidden = true;
      });
    }
  });

  setInterval(() => {
    if (!dirty) return;
    dirty = false;
    if (progress >= 0.98) chrome.storage.local.remove(posKey);
    else chrome.storage.local.set({ [posKey]: progress });
  }, 3000);

  // ---------- 9. Controls ----------
  hideBtn.addEventListener("click", () => {
    hidden = true;
    applySettings();
  });

  gearBtn.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    gearBtn.setAttribute("aria-expanded", String(!panel.hidden));
  });

  badge.addEventListener("click", (e) => {
    const themeBtn = e.target.closest("[data-theme]");
    if (themeBtn) return change({ theme: themeBtn.dataset.theme });
    const act = e.target.closest("[data-act]");
    if (act) {
      const a = act.dataset.act;
      if (a === "size+") change({ fontStep: Math.min(6, settings.fontStep + 1) });
      if (a === "size-") change({ fontStep: Math.max(-2, settings.fontStep - 1) });
      if (a === "space+") change({ spacingStep: Math.min(5, settings.spacingStep + 1) });
      if (a === "space-") change({ spacingStep: Math.max(0, settings.spacingStep - 1) });
      return;
    }
    if (e.target.closest("#rom-bionic")) return change({ bionic: !settings.bionic });
    if (e.target.closest("#rom-reset")) {
      change({ theme: DEFAULTS.theme, fontStep: 0, spacingStep: 0, bionic: false });
    }
  });

  // Alt+R shows or hides the card (keyboard shortcut for accessibility)
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.code === "KeyR") {
      hidden = !hidden;
      applySettings();
    }
    if (e.key === "Escape" && !panel.hidden) {
      panel.hidden = true;
      gearBtn.setAttribute("aria-expanded", "false");
    }
  });

  // The popup asks for live numbers through this message
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "getStats") sendResponse(getStats());
  });

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  progress = lastProgress = getProgress();
  render();
})();
