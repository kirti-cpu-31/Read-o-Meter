chrome.runtime.onMessage.addListener((m) => {
  if (m.type !== "beep") return;
  const ctx = new AudioContext();
  [0, 0.35, 0.7].forEach((t) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880;
    o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.25, ctx.currentTime + t);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.25);
    o.start(ctx.currentTime + t);
    o.stop(ctx.currentTime + t + 0.3);
  });
  setTimeout(() => ctx.close(), 1500);
});
