const PREFERENCE_KEY = "3d-render-fishing-sound";
const MAX_VOICES = 12;

/** Quiet synthesized fishing cues. Audio starts only after an enabled gesture. */
export class FishingAudio {
  constructor({ onChange } = {}) {
    this._AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    this.available = typeof this._AudioContext === "function";
    this.enabled = false;
    this.error = null;
    this._onChange = onChange;
    this._context = null;
    this._master = null;
    this._voices = new Set();
    this._lastPhase = null;
    this._generation = 0;
    this._destroyed = false;
    try { this.enabled = this.available && localStorage.getItem(PREFERENCE_KEY) === "true"; }
    catch { /* Storage is optional, including in private browsing. */ }
  }

  _notify() {
    try {
      this._onChange?.({ enabled: this.enabled, available: this.available,
        running: this._context?.state === "running", error: this.error });
    } catch { /* A UI callback must not interrupt gameplay. */ }
  }

  _persist() {
    try { localStorage.setItem(PREFERENCE_KEY, String(this.enabled)); }
    catch { /* Keep the in-memory preference when storage is unavailable. */ }
  }

  async setEnabled(enabled) {
    if (this._destroyed) return false;
    this.enabled = Boolean(enabled) && this.available;
    this.error = null;
    this._persist();
    if (!this.enabled) {
      this._generation++;
      this.stop();
      this._notify();
      return false;
    }
    return this.unlock();
  }

  async unlock() {
    if (!this.enabled || !this.available || this._destroyed) return false;
    const generation = this._generation;
    let context;
    let creating = false;
    try {
      if (!this._context || this._context.state === "closed") {
        // Construction and resume both run before the first await, preserving
        // the browser's user-gesture permission. Never called from phase events.
        creating = true;
        this._context = new this._AudioContext();
        this._master = this._context.createGain();
        this._master.gain.setValueAtTime(0.18, this._context.currentTime);
        this._master.connect(this._context.destination);
        this._context.onstatechange = () => {
          if (this._context?.state !== "running") this.stop();
          this._notify();
        };
        creating = false;
      }
      context = this._context;
      if (context.state !== "running") {
        this.stop();
        await context.resume();
      }
      if (this._destroyed || !this.enabled || generation !== this._generation) return false;
      if (context.state !== "running") throw new Error("Audio permission was not granted");
      this.error = null;
      this._notify();
      return true;
    } catch {
      if (this._destroyed || generation !== this._generation) return false;
      this.stop();
      if (creating) {
        this.available = false;
        try { Promise.resolve(this._context?.close()).catch(() => {}); } catch { /* Unavailable. */ }
      }
      this.enabled = false;
      this.error = "Không bật được âm thanh trên trình duyệt này.";
      this._persist();
      this._notify();
      return false;
    }
  }

  handleEvent(state, { active = true } = {}) {
    const phase = state?.phase ?? "disabled";
    const changed = phase !== this._lastPhase;
    this._lastPhase = phase; // Also consume events while muted, paused or blocked.
    if (this._destroyed || !active || !this.enabled || this._context?.state !== "running") {
      this.stop();
      return false;
    }
    if (!changed) return false;
    this.stop();
    try {
      const now = this._context.currentTime;
      const tone = (delay, duration, frequency, endFrequency, volume = 0.5, type = "sine") =>
        this._tone(now + delay, duration, frequency, endFrequency, volume, type);
      if (phase === "biting") {
        tone(0, 0.13, 540, 720, 0.55);
        tone(0.16, 0.14, 700, 900, 0.5);
      } else if (phase === "reeling") {
        tone(0, 0.22, 420, 230, 0.42, "triangle");
        tone(0.06, 0.18, 680, 380, 0.22);
      } else if (phase === "caught") {
        for (const [index, frequency] of [660, 830, 990].entries()) {
          tone(index * 0.12, 0.3, frequency, frequency, 0.4);
          tone(index * 0.12, 0.2, frequency * 2, frequency * 2, 0.09);
        }
      } else if (phase === "released") {
        tone(0, 0.25, 420, 300, 0.32);
        tone(0.14, 0.28, 350, 260, 0.25);
      } else return false;
      return true;
    } catch {
      this.stop();
      this.error = "Âm thanh tạm thời không khả dụng.";
      this._notify();
      return false;
    }
  }

  _tone(start, duration, frequency, endFrequency, volume, type) {
    if (this._voices.size >= MAX_VOICES) this._removeVoice(this._voices.values().next().value);
    const context = this._context;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const voice = { oscillator, gain };
    this._voices.add(voice);
    oscillator.onended = () => this._removeVoice(voice, false);
    oscillator.type = type;
    const clampFrequency = (value) => Math.max(80, Math.min(4000, value));
    oscillator.frequency.setValueAtTime(clampFrequency(frequency), start);
    oscillator.frequency.exponentialRampToValueAtTime(clampFrequency(endFrequency), start + duration);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(Math.max(0, Math.min(0.65, volume)), start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(this._master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  _removeVoice(voice, stop = true) {
    if (!voice || !this._voices.delete(voice)) return;
    voice.oscillator.onended = null;
    if (stop) {
      try {
        const now = this._context.currentTime;
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(0, now);
        voice.oscillator.stop(now);
      } catch { /* An oscillator may already have ended. */ }
    }
    try { voice.oscillator.disconnect(); } catch { /* Already disconnected. */ }
    try { voice.gain.disconnect(); } catch { /* Already disconnected. */ }
  }

  stop() {
    for (const voice of this._voices) this._removeVoice(voice);
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._generation++;
    this.enabled = false;
    this.stop();
    if (this._context) {
      this._context.onstatechange = null;
      try { Promise.resolve(this._context.close()).catch(() => {}); } catch { /* Already closed. */ }
    }
    try { this._master?.disconnect(); } catch { /* Already disconnected. */ }
    this._context = null;
    this._master = null;
    this._onChange = null;
  }
}
