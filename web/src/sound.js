// Short answer sounds, synthesized with Web Audio (no files). On by default; the choice is kept in
// localStorage key "sound" ("on" / "off").

let ctx = null;
let on = (() => { try { return localStorage.getItem("sound") !== "off"; } catch { return true; } })();

// [frequency Hz, start s, peak gain, length s, wave]
const TONES = {
  right: [[659.25, 0, 0.12, 0.3, "sine"], [987.77, 0.09, 0.12, 0.4, "sine"]],   // E5 then B5, rising
  wrong: [[196, 0, 0.08, 0.22, "triangle"]],                                      // a low G3 thud
};

export const sound = {
  get on() { return on; },
  set(value) {
    on = value;
    try { localStorage.setItem("sound", value ? "on" : "off"); } catch {}
  },
  play(kind) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!on || !AC || !TONES[kind]) return;
    try {
      ctx ??= new AC();
      if (ctx.state === "suspended") ctx.resume();
      const t = ctx.currentTime;
      for (const [freq, at, peak, len, wave] of TONES[kind]) {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = wave;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t + at);
        gain.gain.exponentialRampToValueAtTime(peak, t + at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + at + len);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t + at);
        osc.stop(t + at + len + 0.05);
      }
    } catch {}
  },
};
