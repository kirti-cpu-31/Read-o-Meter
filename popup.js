// Read-o-Meter: popup script.
// Shows live stats from the current tab and saves settings.

const DEFAULTS = { wpm: 200, enabled: true, largeText: false, highContrast: false };
const $ = (id) => document.getElementById(id);

// ---------- Settings ----------
function loadSettings() {
  chrome.storage.sync.get(DEFAULTS, (s) => {
    $("wpm").value = s.wpm;
    $("wpm-value").textContent = s.wpm;
    $("enabled").checked = s.enabled;
    $("largeText").checked = s.largeText;
    $("highContrast").checked = s.highContrast;
  });
}

function saveSettings() {
  const wpm = Number($("wpm").value);
  $("wpm-value").textContent = wpm;
  chrome.storage.sync.set({
    wpm,
    enabled: $("enabled").checked,
    largeText: $("largeText").checked,
    highContrast: $("highContrast").checked,
  });
}

["wpm", "enabled", "largeText", "highContrast"].forEach((id) => {
  $(id).addEventListener("input", saveSettings);
});

// ---------- Live stats ----------
function showEmpty() {
  $("empty").hidden = false;
  $("live").hidden = true;
}

function refreshStats() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab) return showEmpty();

    chrome.tabs.sendMessage(tab.id, { type: "getStats" }, (stats) => {
      // lastRunError is set when the page has no Read-o-Meter (not an article)
      if (chrome.runtime.lastError || !stats) return showEmpty();

      $("empty").hidden = true;
      $("live").hidden = false;
      $("percent").textContent = stats.percent + "% read";
      $("left").textContent = stats.timeLeft;
      $("pace").textContent = stats.measured
        ? "Your pace: " + stats.wpm + " words per minute"
        : "Still measuring your pace. Using " + stats.wpm + " words per minute.";
      $("words").textContent = stats.totalWords.toLocaleString() + " words in this article";
    });
  });
}

loadSettings();
refreshStats();
setInterval(refreshStats, 1000);
