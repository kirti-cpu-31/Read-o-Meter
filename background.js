const ALARM = "pomodoro";
const MAX_MIN = 180;
const clamp = (n, d) => Math.min(MAX_MIN, Math.max(1, Math.round(Number(n)) || d));

// Run one job at a time so the popup, the on-page panel and the alarm never overwrite each other.
let queue = Promise.resolve();
const enqueue = (job) => (queue = queue.then(job, job));

async function getPomo() {
  const { pomo } = await chrome.storage.local.get("pomo");
  return pomo || { running: false, mode: "focus", focusMin: 25, breakMin: 5, endTime: 0, sessions: 0 };
}

async function startPhase(mode, p) {
  const mins = mode === "focus" ? p.focusMin : p.breakMin;
  const endTime = Date.now() + mins * 60000;
  await chrome.alarms.create(ALARM, { when: endTime });
  await chrome.storage.local.set({ pomo: { ...p, running: true, mode, endTime } });
  chrome.action.setBadgeBackgroundColor({ color: mode === "focus" ? "#6366f1" : "#10b981" });
  chrome.action.setBadgeText({ text: mode === "focus" ? "F" : "B" });
}

async function stopPomo() {
  const p = await getPomo();
  await chrome.alarms.clear(ALARM);
  await chrome.storage.local.set({ pomo: { ...p, running: false, endTime: 0 } });
  chrome.action.setBadgeText({ text: "" });
}

async function playBeep() {
  try {
    const ctxs = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    if (!ctxs.length) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["AUDIO_PLAYBACK"],
        justification: "Play the Pomodoro alarm sound",
      });
    }
    chrome.runtime.sendMessage({ type: "beep" });
  } catch (e) { console.warn("beep failed", e); }
}

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (!msg || !msg.type || !msg.type.startsWith("pomo")) return;
  enqueue(async () => {
    const p = await getPomo();
    if (msg.type === "pomoStart") {
      await startPhase("focus", { ...p, focusMin: clamp(msg.focusMin, p.focusMin), breakMin: clamp(msg.breakMin, p.breakMin) });
    } else if (msg.type === "pomoStop") {
      await stopPomo();
    } else if (msg.type === "pomoConfig") {
      // Save the new lengths. A running session keeps its end time; the new length is used by the next phase.
      await chrome.storage.local.set({
        pomo: { ...p, focusMin: clamp(msg.focusMin, p.focusMin), breakMin: clamp(msg.breakMin, p.breakMin) },
      });
    }
    send({ ok: true });
  });
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM) return;
  enqueue(async () => {
    const p = await getPomo();
    if (!p.running) return;
    const next = p.mode === "focus" ? "break" : "focus";
    const sessions = p.mode === "focus" ? p.sessions + 1 : p.sessions;
    chrome.notifications.create("pomo-" + Date.now(), {
      type: "basic",
      iconUrl: "icon128.png",
      title: p.mode === "focus" ? "Focus session done!" : "Break over",
      message: p.mode === "focus"
        ? `Great work. Take a ${p.breakMin} min break.`
        : "Time to get back to reading.",
      priority: 2,
    });
    playBeep();
    await startPhase(next, { ...p, sessions });
  });
});

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get("settings");
  if (!settings) {
    await chrome.storage.local.set({ settings: { progress: true, bionic: false, focus: false, dock: true, dim: 0.85 } });
  }
});
