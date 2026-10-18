(() => {
  if (window.__readflowLoaded) return;
  window.__readflowLoaded = true;

  const WPM = 200;
  const IDLE_MS = 30000;
  const DEFAULTS = { progress: true, bionic: false, focus: false, dock: true, dim: 0.85, textSize: 100, lineSpacing: 0, theme: "default", dockPos: { v: "bottom", h: "right", dx: 16, dy: 16 } };
  let settings = { ...DEFAULTS };

  let main = null;                  // the article element
  let words = 0, minutes = 1;       // total words, estimated minutes to read
  let prog = 0, pct = 0, wordsRead = 0;
  let bar = null, barFill = null;   // thin progress bar at the top of the page
  let dock = null;                  // on-page panel + always-visible HUD
  let spot = null;                  // the spotlight used by focus mode
  let pomo = null;
  let finished = false, scrolled = false;
  const bionicMap = new Map();      // span -> original text node

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const num = (n) => n.toLocaleString();
  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const fmt = (s) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`);
  const send = (msg) => { try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch (_) { /* extension reloaded */ } };

  // ---------- find the main article and count its words ----------
  const SKIP = "script,style,noscript,nav,aside,button,select,textarea,input,.rf-ui";

  function countWords(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || !n.nodeValue.trim() || p.closest(SKIP)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let total = 0;
    while (walker.nextNode()) total += walker.currentNode.nodeValue.trim().split(/\s+/).length;
    return total;
  }

  function paragraphText(el) {
    let n = 0;
    el.querySelectorAll("p").forEach((p) => (n += p.textContent.length));
    return n;
  }

  function findMain() {
    let best = null, bestLen = 0;
    document.querySelectorAll("article, [role='main'], main").forEach((el) => {
      const n = paragraphText(el);
      if (n > bestLen) { bestLen = n; best = el; }
    });
    if (best && bestLen > 600) return best;

    best = null; bestLen = 0;
    document.querySelectorAll("div, section").forEach((el) => {
      let score = 0;
      for (const c of el.children) if (c.tagName === "P") score += c.textContent.length;
      if (score > bestLen) { bestLen = score; best = el; }
    });
    return best || document.body;
  }

  // ---------- progress and words read (measured on the article itself) ----------
  function measureProgress() {
    if (!main) return;
    let p;
    if (main !== document.body && main !== document.documentElement) {
      const r = main.getBoundingClientRect();
      const span = r.height - innerHeight;
      p = span > 0 ? -r.top / span : (innerHeight - r.top) / Math.max(r.height, 1);
    } else {
      const max = document.documentElement.scrollHeight - innerHeight;
      p = max > 0 ? scrollY / max : 1;
    }
    prog = clamp(p, 0, 1);
    pct = Math.round(prog * 100);
    wordsRead = Math.round(words * prog);
  }

  // ---------- UI: top progress bar + on-page dock ----------
  const DOCK_CSS = `
  :host{all:initial}
  *{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
  .wrap{display:flex;flex-direction:column;align-items:flex-end;gap:10px}
  .panel{display:none;width:272px;max-height:calc(100vh - 110px);overflow-y:auto;background:rgba(255,255,255,.97);border-radius:18px;padding:14px;box-shadow:0 12px 40px rgba(30,27,75,.3);color:#1e1b4b}
  .panel.open{display:block;animation:pop .18s ease}
  @keyframes pop{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
  .head{display:flex;align-items:center;gap:4px;font-weight:800;font-size:15px;margin-bottom:10px}
  .head .title{flex:1}
  .x{background:none;border:0;font-size:20px;line-height:1;cursor:pointer;color:#6b7280;padding:2px 6px;border-radius:6px}
  .x:hover{background:#eef2ff}
  .x:focus-visible,.pre:focus-visible,.go:focus-visible,.chip:focus-visible,input:focus-visible{outline:3px solid #6366f1;outline-offset:1px}
  .chips{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  .chip{border:0;border-radius:12px;padding:10px 4px;background:#eef2ff;color:#4338ca;font-weight:600;font-size:12px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;transition:.15s}
  .chip span{font-size:18px}
  .chip:hover{transform:translateY(-1px)}
  .chip.on{background:linear-gradient(135deg,#6366f1,#22d3ee);color:#fff}
  .cfg{display:none;margin-bottom:10px;padding:10px;border-radius:12px;background:#f5f3ff}
  .cfg.open{display:block}
  .cfg-title{font-size:12px;font-weight:700;margin-bottom:8px}
  .presets{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
  .pre{border:0;border-radius:8px;padding:5px 9px;background:#fff;color:#4338ca;font-weight:700;font-size:12px;cursor:pointer;box-shadow:0 0 0 1px #c7d2fe inset}
  .pre.on{background:#4338ca;color:#fff}
  .cfg-row{display:flex;gap:10px;font-size:12px}
  .cfg-row label{display:flex;align-items:center;gap:5px}
  .cfg-row input{width:54px;padding:4px 6px;border:1px solid #c7d2fe;border-radius:6px;font-size:13px}
  .cfg-note{margin-top:8px;font-size:11px;color:#6b7280}
  .cfg-note.err{color:#dc2626;font-weight:600}
  .pomo{margin-top:12px;padding:12px;border-radius:14px;background:#1e1b4b;color:#fff;text-align:center}
  .time{font-size:34px;font-weight:800;font-variant-numeric:tabular-nums}
  .phase{font-size:11px;opacity:.75;margin-bottom:8px}
  .go{border:0;border-radius:10px;padding:8px 20px;font-weight:700;cursor:pointer;background:#fbbf24;color:#1e1b4b}
  .go.stop{background:#f87171;color:#fff}
  .stats{display:flex;margin-top:12px;text-align:center}
  .stats div{flex:1}
  .stats b{display:block;font-size:15px}
  .stats small{font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em}
  .hud{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;gap:6px;min-width:224px;padding:10px 14px 11px;border-radius:16px;background:linear-gradient(135deg,#4f46e5,#1e1b4b);color:#fff;box-shadow:0 6px 20px rgba(30,27,75,.4);font:600 13px system-ui,sans-serif}
  .hud:focus-visible{outline:3px solid #fbbf24;outline-offset:2px}
  .hw{font-size:14px;font-weight:700;font-variant-numeric:tabular-nums}
  .track{height:6px;border-radius:999px;background:rgba(255,255,255,.28);overflow:hidden}
  .fill{height:100%;width:0;border-radius:999px;background:linear-gradient(90deg,#22d3ee,#a78bfa);transition:width .12s linear}
  .hm{font-size:12px;font-weight:500;opacity:.92;font-variant-numeric:tabular-nums}
  .head,.hud{user-select:none;-webkit-user-select:none}
  .head{cursor:grab;touch-action:none}
  .hud{touch-action:none}
  .hint{font-size:11px;color:#6b7280}
  .sum{width:100%;margin-top:10px;border:0;border-radius:10px;padding:9px;background:#eef2ff;color:#4338ca;font-weight:700;font-size:12px;cursor:pointer}
  .sum:focus-visible{outline:3px solid #6366f1;outline-offset:1px}
  .sumbox{display:none;margin-top:8px;padding:10px;border-radius:12px;background:#f5f3ff;max-height:190px;overflow-y:auto;font-size:12px;line-height:1.5}
  .sumbox.open{display:block}
  .sumbox ul{margin:0;padding-left:16px}
  .sumbox li{margin-bottom:6px}
  .sumnote{font-size:10px;color:#6b7280;margin-top:6px}
  .look{margin-top:12px;display:flex;flex-direction:column;gap:10px}
  .lrow{display:flex;flex-direction:column;gap:5px}
  .llabel{font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em}
  .seg{display:flex;gap:4px}
  .sb{flex:1;border:0;border-radius:8px;padding:6px 2px;background:#eef2ff;color:#4338ca;font-weight:700;font-size:12px;cursor:pointer}
  .sb.on{background:#4338ca;color:#fff}
  .sb:disabled{opacity:.4;cursor:default}
  .sb:focus-visible{outline:3px solid #6366f1;outline-offset:1px}
  .sv{flex:1.4}
  .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px;border:1px solid #9ca3af;vertical-align:-1px}
  @media (prefers-reduced-motion:reduce){.panel.open{animation:none}.fill{transition:none}.chip{transition:none}}
  `;

  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function buildDock() {
    const host = document.createElement("div");
    host.className = "rf-ui";
    host.style.cssText = "all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;";
    const root = host.attachShadow({ mode: "closed" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(DOCK_CSS);
    root.adoptedStyleSheets = [sheet];

    const wrap = h("div", "wrap");
    // keep typing in the timer boxes from triggering the website's own keyboard shortcuts
    ["keydown", "keyup", "keypress"].forEach((ev) => wrap.addEventListener(ev, (e) => e.stopPropagation()));
    const panel = h("div", "panel");

    // header: title, ⋮ (timer settings), × (close panel)
    const head = h("div", "head");
    const dots = h("button", "x", "⋮");
    dots.setAttribute("aria-label", "Timer settings");
    dots.title = "Timer settings";
    const x = h("button", "x", "×");
    x.setAttribute("aria-label", "Close panel");
    x.onclick = () => saveSettings({ dock: false });
    head.append(h("span", "title", "📖 ReadFlow"), dots, x);

    // timer settings (opened with ⋮)
    const cfg = h("div", "cfg");
    cfg.append(h("div", "cfg-title", "Pomodoro length (minutes)"));
    const presets = h("div", "presets");
    const focusIn = h("input"), breakIn = h("input");
    [focusIn, breakIn].forEach((i) => { i.type = "number"; i.min = "1"; i.max = "180"; i.step = "1"; });
    const note = h("div", "cfg-note", "Pick a preset or type any length from 1 to 180.");
    const presetEls = [];
    [2, 5, 10, 25, 45].forEach((m) => {
      const b = h("button", "pre", String(m));
      b.setAttribute("aria-label", `Set focus time to ${m} minutes`);
      b.onclick = () => { focusIn.value = String(m); saveTimer(); };
      presetEls.push([m, b]);
      presets.append(b);
    });
    const row = h("div", "cfg-row");
    const l1 = h("label", "", "Focus "), l2 = h("label", "", "Break ");
    l1.append(focusIn); l2.append(breakIn);
    row.append(l1, l2);
    cfg.append(presets, row, note);

    function saveTimer() {
      const f = Math.round(Number(focusIn.value)), b = Math.round(Number(breakIn.value));
      const ok = f >= 1 && f <= 180 && b >= 1 && b <= 180;
      note.classList.toggle("err", !ok);
      if (!ok) { note.textContent = "Use whole minutes from 1 to 180."; return; }
      note.textContent = pomo && pomo.running ? "Saved. It applies from the next session." : "Saved.";
      send({ type: "pomoConfig", focusMin: f, breakMin: b });
    }
    focusIn.addEventListener("change", saveTimer);
    breakIn.addEventListener("change", saveTimer);
    dots.onclick = () => {
      const open = !cfg.classList.contains("open");
      cfg.classList.toggle("open", open);
      dots.setAttribute("aria-expanded", String(open));
      if (open) { dock.syncCfg(true); focusIn.focus(); }
    };
    cfg.addEventListener("keydown", (e) => { if (e.key === "Escape") { cfg.classList.remove("open"); dots.focus(); } });

    // reading tools
    const chips = h("div", "chips");
    const chipDefs = [["bionic", "Aa", "Bionic"], ["focus", "🎯", "Dim focus"], ["progress", "📏", "Top bar"]];
    const chipEls = {};
    chipDefs.forEach(([key, icon, label]) => {
      const c = h("button", "chip");
      c.append(h("span", "", icon), document.createTextNode(label));
      c.setAttribute("aria-pressed", "false");
      c.onclick = () => saveSettings({ [key]: !settings[key] });
      chipEls[key] = c;
      chips.append(c);
    });

    // text size, line spacing and theme
    const look = h("div", "look");
    const tsRow = h("div", "lrow"), tsSeg = h("div", "seg");
    const tsDown = h("button", "sb", "A−"), tsVal = h("button", "sb sv", "100%"), tsUp = h("button", "sb", "A+");
    tsDown.setAttribute("aria-label", "Smaller text");
    tsUp.setAttribute("aria-label", "Larger text");
    tsVal.setAttribute("aria-label", "Reset text size to 100 percent");
    tsVal.title = "Reset";
    const curTs = () => clamp(Number(settings.textSize) || 100, 70, 200);
    tsDown.onclick = () => saveSettings({ textSize: Math.max(70, curTs() - 10) });
    tsUp.onclick = () => saveSettings({ textSize: Math.min(200, curTs() + 10) });
    tsVal.onclick = () => saveSettings({ textSize: 100 });
    tsSeg.append(tsDown, tsVal, tsUp);
    tsRow.append(h("div", "llabel", "Text size"), tsSeg);

    const lsRow = h("div", "lrow"), lsSeg = h("div", "seg");
    const lsEls = [];
    [["Auto", 0], ["1.4", 1.4], ["1.6", 1.6], ["1.8", 1.8], ["2.0", 2]].forEach(([label, v]) => {
      const b = h("button", "sb", label);
      b.setAttribute("aria-label", v ? `Line spacing ${label}` : "Line spacing: page default");
      b.onclick = () => saveSettings({ lineSpacing: v });
      lsEls.push([v, b]);
      lsSeg.append(b);
    });
    lsRow.append(h("div", "llabel", "Line spacing"), lsSeg);

    const thRow = h("div", "lrow"), thSeg = h("div", "seg");
    const thEls = [];
    [["Default", "default", "#9ca3af"], ["Light", "light", "#ffffff"], ["Sepia", "sepia", "#f4ecd8"], ["Dark", "dark", "#16171d"]].forEach(([label, v, color]) => {
      const b = h("button", "sb");
      const dot = h("span", "dot");
      dot.style.background = color;
      b.append(dot, document.createTextNode(label));
      b.setAttribute("aria-label", `${label} theme`);
      b.onclick = () => saveSettings({ theme: v });
      thEls.push([v, b]);
      thSeg.append(b);
    });
    thRow.append(h("div", "llabel", "Theme"), thSeg);
    const posRow = h("div", "lrow"), posSeg = h("div", "seg");
    const posEls = [];
    [["↖", "top", "left", "top left"], ["↗", "top", "right", "top right"], ["↙", "bottom", "left", "bottom left"], ["↘", "bottom", "right", "bottom right"]].forEach(([label, v, hh, name]) => {
      const b = h("button", "sb", label);
      b.setAttribute("aria-label", `Move panel to ${name}`);
      b.title = name;
      b.onclick = () => saveSettings({ dockPos: { v, h: hh, dx: 16, dy: 16 } });
      posEls.push([v, hh, b]);
      posSeg.append(b);
    });
    posRow.append(h("div", "llabel", "Panel position"), posSeg, h("div", "hint", "Or drag the title or the card anywhere."));
    look.append(tsRow, lsRow, thRow, posRow);

    // summary
    const sumBtn = h("button", "sum", "📝 Summarize article");
    sumBtn.setAttribute("aria-expanded", "false");
    const sumBox = h("div", "sumbox");
    sumBox.setAttribute("aria-live", "polite");
    sumBtn.onclick = () => {
      const open = !sumBox.classList.contains("open");
      sumBox.classList.toggle("open", open);
      sumBtn.setAttribute("aria-expanded", String(open));
      sumBtn.textContent = open ? "📝 Hide summary" : "📝 Summarize article";
      if (!open) return;
      const items = summarize();
      sumBox.replaceChildren();
      if (!items.length) { sumBox.textContent = "Not enough text to summarize on this page."; return; }
      const ul = h("ul");
      items.forEach((t) => { const li = h("li", "", t); li.dir = "auto"; ul.append(li); });
      sumBox.append(ul, h("div", "sumnote", "Key sentences from the article, in its own language."));
    };

    // pomodoro
    const pomoBox = h("div", "pomo");
    const time = h("div", "time", "25:00");
    const phase = h("div", "phase", "Pomodoro · ready");
    const go = h("button", "go", "Start");
    go.onclick = () => {
      if (pomo && pomo.running) send({ type: "pomoStop" });
      else send({ type: "pomoStart", focusMin: (pomo && pomo.focusMin) || 25, breakMin: (pomo && pomo.breakMin) || 5 });
    };
    pomoBox.append(time, phase, go);

    // reading time history
    const stats = h("div", "stats");
    const sEls = {};
    [["today", "Today"], ["week", "7 days"], ["all", "All time"]].forEach(([k, label]) => {
      const d = h("div");
      sEls[k] = h("b", "", "0s");
      d.append(sEls[k], h("small", "", label));
      stats.append(d);
    });

    panel.append(head, cfg, chips, look, sumBtn, sumBox, pomoBox, stats);

    // always-visible HUD: words read + progress bar + time left (+ timer while it runs)
    const hud = h("button", "hud");
    const hudWords = h("div", "hw", "0 / 0 words");
    const track = h("div", "track");
    const hudFill = h("div", "fill");
    track.append(hudFill);
    const hudMeta = h("div", "hm", "");
    hud.append(hudWords, track, hudMeta);
    let justDragged = false;
    hud.onclick = () => { if (justDragged) return; saveSettings({ dock: settings.dock === false }); };

    wrap.append(panel, hud);
    root.append(wrap);
    document.documentElement.append(host);

    function applyPos() {
      const p = settings.dockPos || {};
      const v = p.v === "top" ? "top" : "bottom", hh = p.h === "left" ? "left" : "right";
      const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
      const dx = clamp(Number.isFinite(Number(p.dx)) ? Number(p.dx) : 16, 0, Math.max(0, W - 90));
      const dy = clamp(Number.isFinite(Number(p.dy)) ? Number(p.dy) : 16, 0, Math.max(0, H - 70));
      host.style.left = hh === "left" ? dx + "px" : "auto";
      host.style.right = hh === "right" ? dx + "px" : "auto";
      host.style.top = v === "top" ? dy + "px" : "auto";
      host.style.bottom = v === "bottom" ? dy + "px" : "auto";
      wrap.style.flexDirection = v === "top" ? "column-reverse" : "column";
      wrap.style.alignItems = hh === "left" ? "flex-start" : "flex-end";
    }
    addEventListener("resize", applyPos);

    // drag the title or the card to put the panel anywhere; it snaps to the nearest corner's offsets
    function attachDrag(handle) {
      handle.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || (e.target.closest && e.target.closest(".x"))) return;
        const r0 = host.getBoundingClientRect();
        const sx = e.clientX, sy = e.clientY;
        let moved = false;
        const move = (ev) => {
          const mx = ev.clientX - sx, my = ev.clientY - sy;
          if (!moved && Math.hypot(mx, my) < 6) return;
          moved = true;
          const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
          host.style.left = clamp(r0.left + mx, 0, Math.max(0, W - r0.width)) + "px";
          host.style.top = clamp(r0.top + my, 0, Math.max(0, H - r0.height)) + "px";
          host.style.right = "auto"; host.style.bottom = "auto";
        };
        const up = () => {
          removeEventListener("pointermove", move, true);
          removeEventListener("pointerup", up, true);
          removeEventListener("pointercancel", up, true);
          if (!moved) return;
          justDragged = true; setTimeout(() => (justDragged = false), 60);
          const r = host.getBoundingClientRect();
          const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
          const hh = r.left + r.width / 2 < W / 2 ? "left" : "right";
          const v = r.top + r.height / 2 < H / 2 ? "top" : "bottom";
          saveSettings({ dockPos: {
            v, h: hh,
            dx: Math.max(0, Math.round(hh === "left" ? r.left : W - r.right)),
            dy: Math.max(0, Math.round(v === "top" ? r.top : H - r.bottom)),
          } });
        };
        addEventListener("pointermove", move, true);
        addEventListener("pointerup", up, true);
        addEventListener("pointercancel", up, true);
      });
    }
    attachDrag(head);
    attachDrag(hud);

    dock = {
      host,
      render() {
        applyPos();
        const open = settings.dock !== false;
        panel.classList.toggle("open", open);
        Object.keys(chipEls).forEach((k) => {
          chipEls[k].classList.toggle("on", !!settings[k]);
          chipEls[k].setAttribute("aria-pressed", String(!!settings[k]));
        });
        hud.setAttribute("aria-expanded", String(open));
        const ts = clamp(Number(settings.textSize) || 100, 70, 200);
        tsVal.textContent = ts + "%";
        tsDown.disabled = ts <= 70;
        tsUp.disabled = ts >= 200;
        const ls = Number(settings.lineSpacing) || 0;
        lsEls.forEach(([v, el]) => { el.classList.toggle("on", v === ls); el.setAttribute("aria-pressed", String(v === ls)); });
        const pp = settings.dockPos || {};
        posEls.forEach(([v, hh, el]) => {
          const on = v === (pp.v === "top" ? "top" : "bottom") && hh === (pp.h === "left" ? "left" : "right");
          el.classList.toggle("on", on); el.setAttribute("aria-pressed", String(on));
        });
        const th = settings.theme || "default";
        thEls.forEach(([v, el]) => { el.classList.toggle("on", v === th); el.setAttribute("aria-pressed", String(v === th)); });
      },
      syncCfg(force) {
        const f = (pomo && pomo.focusMin) || 25, b = (pomo && pomo.breakMin) || 5;
        if (force || root.activeElement !== focusIn) focusIn.value = String(f);
        if (force || root.activeElement !== breakIn) breakIn.value = String(b);
        presetEls.forEach(([m, el]) => el.classList.toggle("on", m === f));
      },
      renderHud() {
        const left = Math.max(0, Math.ceil(minutes * (1 - prog)));
        hudWords.textContent = `${num(wordsRead)} / ${num(words)} words`;
        hudFill.style.width = pct + "%";
        let meta = pct >= 100 ? "100% · Finished 🎉" : `${pct}% · ${left} min left`;
        if (pomo && pomo.running) {
          const secs = Math.max(0, Math.round((pomo.endTime - Date.now()) / 1000));
          meta += ` · ${pomo.mode === "focus" ? "🍅" : "☕"} ${mmss(secs)}`;
        }
        hudMeta.textContent = meta;
        hud.setAttribute("aria-label", `${num(wordsRead)} of ${num(words)} words read, ${pct} percent. ${hudMeta.textContent}. Press to show or hide the ReadFlow panel.`);
      },
      renderPomo() {
        if (pomo && pomo.running) {
          const left = Math.max(0, Math.round((pomo.endTime - Date.now()) / 1000));
          time.textContent = mmss(left);
          phase.textContent = (pomo.mode === "focus" ? "🍅 Focus time" : "☕ Break time") + ` · done: ${pomo.sessions}`;
          go.textContent = "Stop"; go.classList.add("stop");
        } else {
          time.textContent = mmss(((pomo && pomo.focusMin) || 25) * 60);
          phase.textContent = "Pomodoro · ready" + (pomo && pomo.sessions ? ` · done: ${pomo.sessions}` : "");
          go.textContent = "Start"; go.classList.remove("stop");
        }
        this.syncCfg(false);
        this.renderHud();
      },
      async renderStats() {
        try {
          const { daily = {}, total = 0 } = await chrome.storage.local.get(["daily", "total"]);
          let week = 0;
          for (let i = 0; i < 7; i++) week += daily[new Date(Date.now() - i * 86400000).toLocaleDateString("en-CA")] || 0;
          sEls.today.textContent = fmt(daily[new Date().toLocaleDateString("en-CA")] || 0);
          sEls.week.textContent = fmt(week);
          sEls.all.textContent = fmt(total);
        } catch (_) {}
      },
    };
    dock.render(); dock.renderPomo(); dock.renderStats();
  }

  function saveSettings(patch) {
    // don't mutate local settings here; the storage listener applies the change
    try { chrome.storage.local.set({ settings: { ...settings, ...patch } }); } catch (_) {}
  }

  function ensureUI() {
    if (bar) return;
    bar = h("div", "rf-bar rf-ui");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", "Reading progress");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    barFill = h("div", "rf-bar-fill");
    bar.append(barFill);
    document.documentElement.append(bar);
    buildDock();
    setInterval(() => dock && dock.renderPomo(), 1000);
  }

  function toast(msg) {
    const t = h("div", "rf-toast rf-ui", msg);
    t.setAttribute("role", "status");
    document.documentElement.append(t);
    setTimeout(() => t.remove(), 2800);
  }

  function updateUI() {
    measureProgress();
    if (bar) {
      bar.style.display = settings.progress && words >= 100 ? "block" : "none";
      barFill.style.width = pct + "%";
      bar.setAttribute("aria-valuenow", String(pct));
    }
    if (dock) { dock.renderHud(); dock.host.style.display = words >= 100 ? "" : "none"; }
    if (!finished && scrolled && words >= 300 && pct >= 99) { finished = true; toast("🎉 You finished this article!"); }
  }

  // ---------- bionic reading ----------
  function setBionic(on) {
    if (!main) return;
    if (!on) {
      bionicMap.forEach((orig, span) => span.isConnected && span.replaceWith(orig));
      bionicMap.clear();
      return;
    }
    if (bionicMap.size) return;
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (!p || p.closest("script,style,noscript,code,pre,textarea,input,.rf-ui,.rf-bionic"))
          return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((n) => {
      const span = document.createElement("span");
      span.className = "rf-bionic";
      n.nodeValue.split(/(\s+)/).forEach((part) => {
        if (!part.trim()) { span.append(part); return; }
        const k = part.length <= 3 ? 1 : Math.ceil(part.length * 0.45);
        const b = document.createElement("b");
        b.textContent = part.slice(0, k);
        span.append(b, part.slice(k));
      });
      n.replaceWith(span);
      bionicMap.set(span, n);
    });
  }

  // ---------- dim focus mode ----------
  // The page keeps its normal layout. A fixed, see-through "spotlight" box sits over the
  // article and its huge box-shadow darkens everything around it, with a soft warm glow
  // along the article's edge. It never touches the page's own elements.
  let paraBox = null; // horizontal extent of the text columns, in document coordinates

  function computeParaBox() {
    paraBox = null;
    if (!main) return;
    let l = Infinity, r = -Infinity, n = 0;
    for (const p of main.querySelectorAll("p")) {
      if (p.textContent.length < 60) continue;
      const b = p.getBoundingClientRect();
      if (!b.width) continue;
      l = Math.min(l, b.left + scrollX);
      r = Math.max(r, b.right + scrollX);
      if (++n >= 300) break;
    }
    if (n) paraBox = { left: l, right: r };
  }

  function updateSpot() {
    if (!spot || !main || !settings.focus) return;
    const b = main.getBoundingClientRect();
    let left = b.left, right = b.right;
    const wide = main === document.body || main === document.documentElement || b.width > innerWidth * 0.97;
    if (wide && paraBox) { left = paraBox.left - scrollX; right = paraBox.right - scrollX; }
    left -= 14; right += 14;
    const top = clamp(b.top - 8, -40, innerHeight + 40);
    const bottom = clamp(b.bottom + 8, -40, innerHeight + 40);
    const l = clamp(left, -40, innerWidth + 40);
    const r = clamp(right, -40, innerWidth + 40);
    spot.style.transform = `translate(${l}px, ${top}px)`;
    spot.style.width = Math.max(0, r - l) + "px";
    spot.style.height = Math.max(0, bottom - top) + "px";
  }

  function applyDim() {
    if (spot) spot.style.setProperty("--rf-dim", `rgba(8,8,14,${clamp(Number(settings.dim) || 0.85, 0.3, 0.97)})`);
  }

  function setFocus(on) {
    if (!main) return;
    if (!on) { if (spot) spot.classList.remove("on"); return; }
    if (!spot) {
      spot = h("div", "rf-spot rf-ui");
      spot.setAttribute("aria-hidden", "true");
      document.documentElement.append(spot);
    }
    applyDim();
    computeParaBox();
    updateSpot();
    requestAnimationFrame(() => spot.classList.add("on"));
    const wide = main === document.body || main === document.documentElement;
    toast(wide && !paraBox ? "Couldn't find a clear article on this page." : "Dim focus on — press Esc to exit");
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && settings.focus) saveSettings({ focus: false });
  });

  // ---------- text size, line spacing and theme ----------
  // Text size and line spacing are applied to the article's text blocks through CSS rules in
  // content.css. Each block's original size is saved in --rf-fs, so turning the setting back to
  // 100% / Auto restores the page exactly. The theme is a single attribute on <html>.
  const TEXT_BODY = "p,li,blockquote,dd,dt,td,th,figcaption";
  const TEXT_HEAD = "h1,h2,h3,h4,h5,h6";
  const textActive = () => (Number(settings.textSize) || 100) !== 100 || (Number(settings.lineSpacing) || 0) > 0;

  function clearText() {
    const root = document.documentElement;
    root.removeAttribute("data-rf-ts");
    root.removeAttribute("data-rf-lh");
    root.style.removeProperty("--rf-ts");
    root.style.removeProperty("--rf-lh");
    document.querySelectorAll("[data-rf-text]").forEach((el) => {
      el.removeAttribute("data-rf-text");
      el.style.removeProperty("--rf-fs");
    });
  }

  function applyText() {
    if (!main || words < 100) { clearText(); return; }
    if (!textActive()) { clearText(); if (settings.focus) computeParaBox(); schedule(); return; }
    const root = document.documentElement;
    const ts = clamp(Number(settings.textSize) || 100, 70, 200);
    const ls = Number(settings.lineSpacing) || 0;

    // save the original size of any text block we have not seen yet (measured at 100%)
    const fresh = [...main.querySelectorAll(TEXT_BODY + "," + TEXT_HEAD)]
      .filter((el) => !el.hasAttribute("data-rf-text") && !el.closest(".rf-ui"));
    if (fresh.length) {
      root.style.setProperty("--rf-ts", "1");
      const sizes = fresh.map((el) => parseFloat(getComputedStyle(el).fontSize) || 16);
      fresh.forEach((el, i) => {
        el.style.setProperty("--rf-fs", sizes[i] + "px");
        el.setAttribute("data-rf-text", el.matches(TEXT_HEAD) ? "head" : "body");
      });
    }

    root.style.setProperty("--rf-ts", String(ts / 100));
    if (ts !== 100) root.setAttribute("data-rf-ts", ""); else root.removeAttribute("data-rf-ts");
    if (ls) { root.style.setProperty("--rf-lh", String(ls)); root.setAttribute("data-rf-lh", ""); }
    else { root.style.removeProperty("--rf-lh"); root.removeAttribute("data-rf-lh"); }
    if (settings.focus) computeParaBox();
    schedule();
  }

  function applyTheme() {
    if (words < 100) { document.documentElement.removeAttribute("data-rf-theme"); return; }
    const t = ["light", "sepia", "dark"].includes(settings.theme) ? settings.theme : "default";
    if (t === "default") document.documentElement.removeAttribute("data-rf-theme");
    else document.documentElement.setAttribute("data-rf-theme", t);
  }

  // text that loads later (infinite scroll, lazy sections) gets the same size and spacing
  let textObserver = null, textTimer = 0;
  function watchText() {
    if (textObserver || !main) return;
    textObserver = new MutationObserver(() => {
      if (!textActive()) return;
      clearTimeout(textTimer);
      textTimer = setTimeout(applyText, 400);
    });
    textObserver.observe(main, { childList: true, subtree: true });
  }

  // ---------- apply settings ----------
  function apply(prev) {
    if (!prev || prev.bionic !== settings.bionic) setBionic(settings.bionic);
    if (!prev || prev.focus !== settings.focus) setFocus(settings.focus);
    if (prev && prev.dim !== settings.dim) applyDim();
    if (!prev || prev.textSize !== settings.textSize || prev.lineSpacing !== settings.lineSpacing) applyText();
    if (!prev || prev.theme !== settings.theme) applyTheme();
    if (dock) dock.render();
    updateUI();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.settings) {
      const prev = settings;
      settings = { ...DEFAULTS, ...changes.settings.newValue };
      apply(prev);
    }
    if (changes.pomo) { pomo = changes.pomo.newValue; if (dock) dock.renderPomo(); }
    if ((changes.daily || changes.total) && dock) dock.renderStats();
  });

  // ---------- reading history ----------
  let pending = 0, lastActivity = Date.now(), maxScroll = 0;
  ["scroll", "mousemove", "keydown", "touchstart", "click"].forEach((ev) =>
    addEventListener(ev, () => (lastActivity = Date.now()), { passive: true })
  );
  const pageKey = () => location.origin + location.pathname + location.search;

  let curKey = location.origin + location.pathname + location.search;
  async function flush() {
    if (!pending || words < 150) return;
    const secs = pending;
    const key = curKey || pageKey();
    pending = 0;
    try {
      const data = await chrome.storage.local.get(["history", "daily", "total"]);
      const history = data.history || {}, daily = data.daily || {};
      const now = Date.now();
      const e = history[key] || { url: key, seconds: 0, maxScroll: 0, firstRead: now };
      e.title = document.title || key;
      e.seconds += secs;
      e.maxScroll = Math.max(e.maxScroll, maxScroll);
      e.lastRead = now;
      history[key] = e;
      const keys = Object.keys(history);
      if (keys.length > 300) {
        keys.sort((a, b) => history[a].lastRead - history[b].lastRead)
            .slice(0, keys.length - 300).forEach((k) => delete history[k]);
      }
      const day = new Date().toLocaleDateString("en-CA");
      daily[day] = (daily[day] || 0) + secs;
      Object.keys(daily).sort().slice(0, -60).forEach((k) => delete daily[k]);
      await chrome.storage.local.set({ history, daily, total: (data.total || 0) + secs });
    } catch (_) { /* extension was reloaded; ignore */ }
  }

  setInterval(() => {
    if (document.hidden || Date.now() - lastActivity > IDLE_MS) return;
    pending++;
    if (pending >= 5) flush();
  }, 1000);
  document.addEventListener("visibilitychange", () => document.hidden && flush());
  addEventListener("pagehide", flush);

  // ---------- scrolling and resizing ----------
  let raf = 0;
  function tick() {
    raf = 0;
    updateUI();
    updateSpot();
    maxScroll = Math.max(maxScroll, pct);
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(tick); };

  addEventListener("scroll", () => { scrolled = true; schedule(); }, { passive: true });
  addEventListener("resize", () => { if (settings.focus) computeParaBox(); schedule(); });
  setInterval(() => { if (settings.focus) schedule(); }, 600); // follow late layout changes

  // ---------- summary ----------
  // Picks the most important sentences of the article by how often their words appear in it.
  // It runs in your browser and the article is never sent anywhere. The summary uses the article's
  // own sentences, so it is in the same language as the article.
  const STOP = new Set("the and for are but not you all can had her was one our out has have been from this that with they will would there their what about which when your said each she how its who did get may him his than then them these some could other into more also only over such very just like were being does doing because while where after before should those through between against during without within".split(" "));
  const SENT = /[^.!?।॥。！？\n]+(?:[.!?।॥。！？]+["'”’)\]]*|$)/g;

  function articlePars() {
    let paras = [];
    main.querySelectorAll("p, li, blockquote").forEach((el) => {
      if (el.closest(SKIP) || el.querySelector("p, li")) return;
      const t = el.textContent.replace(/\s+/g, " ").trim();
      if (t.length >= 40) paras.push(t);
    });
    if (!paras.length) paras = (main.innerText || "").split(/\n+/).map((t) => t.trim()).filter((t) => t.length >= 40);
    return paras;
  }

  function summarize() {
    if (!main) return [];
    const paras = articlePars();

    const sents = [], seen = new Set();
    paras.forEach((t, pi) => {
      (t.match(SENT) || [t]).forEach((raw, si) => {
        const s = raw.trim();
        const wc = s.split(/\s+/).length;
        if (seen.has(s) || s.length > 420 || wc > 60 || (wc < 6 && s.length < 25)) return;
        seen.add(s);
        const tokens = (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length >= (/^[a-z]+$/.test(w) ? 4 : 2) && !STOP.has(w));
        sents.push({ s, tokens, first: pi === 0 && si === 0, lead: si === 0 });
      });
    });
    if (!sents.length) return [];

    const freq = new Map();
    sents.forEach((x) => x.tokens.forEach((w) => freq.set(w, (freq.get(w) || 0) + 1)));
    sents.forEach((x, i) => {
      let sum = 0;
      x.tokens.forEach((w) => (sum += freq.get(w)));
      x.i = i;
      x.score = (sum / Math.max(x.tokens.length, 10)) * (x.first ? 1.3 : x.lead ? 1.1 : 1);
    });

    const n = Math.min(sents.length, words < 500 ? 3 : words < 1500 ? 4 : 5);
    return sents.slice().sort((a, b) => b.score - a.score).slice(0, n).sort((a, b) => a.i - b.i).map((x) => x.s);
  }

  // ---------- popup asks for stats ----------
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg && msg.type === "getSummary") {
      reply({ sentences: words >= 100 ? summarize() : [] });
      return;
    }
    if (msg && msg.type === "getStats") {
      reply({ words, wordsRead, minutes, minutesLeft: Math.max(0, Math.ceil(minutes * (1 - prog))), pct });
    }
  });

  // ---------- init (retries, because many sites load their text a moment after the page) ----------
  let initGen = 0, retrying = false, rescans = 0;
  function initArticle(attempt, gen = ++initGen) {
    if (gen !== initGen) return; // a newer scan replaced this one
    main = findMain();
    words = countWords(main);
    if (words < 100 && attempt < 15) { retrying = true; setTimeout(() => initArticle(attempt + 1, gen), 1000); return; }
    retrying = false;
    minutes = Math.max(1, Math.ceil(words / WPM));
    if (words >= 100) ensureUI();
    apply(null);
    watchText();
    maxScroll = pct;
  }

  // Remove everything ReadFlow added to the old article before looking for a new one.
  function teardown() {
    if (main) setBionic(false);
    bionicMap.clear();
    clearText();
    document.documentElement.removeAttribute("data-rf-theme");
    if (textObserver) { textObserver.disconnect(); textObserver = null; }
    if (spot) spot.classList.remove("on");
    finished = false; scrolled = false; prog = 0; pct = 0; wordsRead = 0;
    main = null; words = 0;
  }

  // Single-page sites (Substack, Medium, news apps) change the address without reloading the page.
  // Notice that, and scan the new article.
  setInterval(() => {
    const key = location.origin + location.pathname + location.search;
    if (key === curKey) return;
    flush();
    curKey = key;
    teardown();
    rescans = 0;
    maxScroll = 0;
    updateUI();
    initArticle(0);
  }, 800);

  // Keep looking for an article that appears late, and recover if the site replaces it.
  setInterval(() => {
    if (retrying) return;
    if (main && !main.isConnected) { teardown(); updateUI(); initArticle(0); return; }
    if (words < 100 && rescans < 15) {
      rescans++;
      if (countWords(findMain()) >= 100) initArticle(0);
    }
  }, 4000);

  chrome.storage.local.get(["settings", "pomo"]).then(({ settings: s, pomo: p }) => {
    settings = { ...DEFAULTS, ...(s || {}) };
    pomo = p || null;
    initArticle(0);
  });
})();
