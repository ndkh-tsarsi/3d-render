import { DefenseEngine } from "./engine.js";
import { AssetLibrary, DefenseRenderer } from "./render.js";
import { gameError } from "./rules.js";

class GameAudio {
  constructor() { this.context = null; }
  unlock() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) this.context ||= new AudioContext();
      this.context?.resume().catch(() => {});
    } catch { /* Silent play remains available when device audio is unavailable. */ }
  }
  play(type) {
    const ctx = this.context;
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const tones = {
      shot: [160, 45, 0.09, "sawtooth", 0.055],
      enemyKilled: [700, 1050, 0.12, "sine", 0.04],
      fenceDamaged: [110, 60, 0.13, "triangle", 0.055],
      explosionStarted: [100, 22, 0.3, "sawtooth", 0.07],
      waveStarted: [460, 680, 0.23, "sine", 0.045],
      gameOver: [300, 90, 0.6, "triangle", 0.05],
    };
    const tone = tones[type];
    if (!tone) return;
    const [start, end, duration, waveform, volume] = tone;
    const oscillator = ctx.createOscillator(), gain = ctx.createGain();
    oscillator.type = waveform; oscillator.frequency.setValueAtTime(start, now); oscillator.frequency.exponentialRampToValueAtTime(end, now + duration);
    gain.gain.setValueAtTime(volume, now); gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(now); oscillator.stop(now + duration);
  }
  destroy() { this.context?.close().catch(() => {}); }
}

/** Create an embeddable, dependency-free game. All coordinates in commands are normalized. */
export async function createGame({ canvas, assetsUrl = "./assets/manifest.json", onEvent = () => {} } = {}) {
  if (!canvas || typeof canvas.getContext !== "function") throw gameError("INVALID_ARGUMENT", "createGame needs a canvas element.");
  const manifestUrl = new URL(assetsUrl, document.baseURI);
  const response = await fetch(manifestUrl);
  if (!response.ok) throw new Error(`Asset manifest could not be loaded (${response.status}).`);
  const manifest = await response.json();
  const assets = new AssetLibrary(manifest, new URL("./", manifestUrl));
  if (!assets.cats.length || !assets.enemies.length) throw new Error("The asset manifest must include native cat and enemy animations.");
  const scenery = manifest.scenery || {};
  const background = typeof scenery.background === "string" ? scenery.background : scenery.background?.image;
  await Promise.all([
    assets.load(background),
    assets.loadActor(assets.cats[0]),
    assets.loadActor(assets.enemies.find(enemy => enemy.kind !== "boss") || assets.enemies[0], ["walk"]),
  ]);
  const audio = new GameAudio();
  let destroyed = false, engine;
  const emit = (type, payload) => {
    if (destroyed) return;
    if (type === "enemySpawned") {
      const actor = assets.enemies.find(enemy => enemy.id === payload.enemyType);
      assets.markEnemyUsed(payload.enemyType);
      if (actor) assets.loadActor(actor, ["walk", "dead"]).catch(() => emit("assetWarning", { message: `An enemy animation could not be decoded: ${actor.id}` }));
    }
    if (engine && !engine.muted) audio.play(type);
    onEvent(type, payload);
  };
  engine = new DefenseEngine({ cats: assets.cats, enemies: assets.enemies, onEvent: emit });
  const renderer = new DefenseRenderer(canvas, assets);
  engine.muzzleProvider = () => renderer.muzzle(engine);
  let frameId = 0, previousTime = 0, stateTime = 0, cacheTime = 0, pointerHeld = false, spaceHeld = false;
  const removals = [];
  const listen = (element, name, callback, options) => { element.addEventListener(name, callback, options); removals.push(() => element.removeEventListener(name, callback, options)); };
  const userFire = () => {
    if (!engine.muted) audio.unlock();
    engine.execute("fire", renderer.pointer ? { target: renderer.pointer } : {});
  };
  listen(canvas, "pointermove", event => { renderer.pointer = renderer.worldPoint(event.clientX, event.clientY); });
  listen(canvas, "pointerleave", () => { if (!pointerHeld) renderer.pointer = null; });
  listen(canvas, "pointerdown", event => {
    if (event.button !== 0) return;
    const point = renderer.worldPoint(event.clientX, event.clientY);
    if (!point) return;
    renderer.pointer = point; pointerHeld = true; canvas.focus({ preventScroll: true }); userFire();
    canvas.setPointerCapture?.(event.pointerId);
  });
  const releasePointer = () => { pointerHeld = false; };
  listen(canvas, "pointerup", releasePointer);
  listen(canvas, "pointercancel", releasePointer);
  // Host controls live outside the iframe, so leaving canvas focus must not pause the simulation.
  listen(window, "blur", () => { pointerHeld = false; spaceHeld = false; });
  listen(window, "keydown", event => {
    if (event.target instanceof HTMLElement && (event.target.matches("input,textarea,select,button") || event.target.isContentEditable)) return;
    if (event.code === "Space") { event.preventDefault(); if (!event.repeat) userFire(); spaceHeld = true; }
    else if (event.code === "KeyP" && !event.repeat) engine.execute(engine.status === "paused" ? "resume" : "pause");
  });
  listen(window, "keyup", event => {
    if (event.code !== "Space") return;
    spaceHeld = false;
    const interactive = event.target instanceof HTMLElement && (event.target.matches("input,textarea,select,button") || event.target.isContentEditable);
    if (!interactive) event.preventDefault();
  });
  const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => renderer.resize()) : null;
  observer?.observe(canvas);
  listen(window, "resize", () => renderer.resize());
  const animate = now => {
    if (destroyed) return;
    const delta = previousTime ? now - previousTime : 0;
    previousTime = now;
    if ((pointerHeld || spaceHeld) && engine.status === "playing") userFire();
    engine.update(delta);
    renderer.draw(engine, delta);
    if (now - cacheTime >= 1000) {
      cacheTime = now;
      // Native Dead clips count as active until their final frame and fade leave the simulation.
      assets.trimEnemyCache(engine.enemies.map(enemy => enemy.type));
    }
    if (now - stateTime >= 150 && engine.status === "playing") { stateTime = now; emit("state", engine.getState()); }
    frameId = requestAnimationFrame(animate);
  };
  renderer.draw(engine);
  frameId = requestAnimationFrame(animate);
  // Only effects are preloaded. Enemy atlases decode on spawn; alternate cats decode when selected.
  const backgroundLoads = [
    ...Object.values(manifest.effects || {}).filter(value => value && typeof value === "object").map(effect => assets.loadActor(effect)),
  ];
  Promise.allSettled(backgroundLoads).then(results => {
    const failed = results.filter(result => result.status === "rejected");
    if (failed.length && !destroyed) emit("assetWarning", { count: failed.length, message: "Some optional animation clips could not be decoded." });
  });
  let catChangeVersion = 0;
  const api = {
    async execute(command, payload = {}) {
      if (destroyed) throw gameError("DESTROYED", "This game instance has been destroyed.");
      if (command === "setCat") {
        const version = ++catChangeVersion;
        const cat = assets.cats.find(actor => actor.id === payload?.catId);
        if (!cat) throw gameError("UNKNOWN_CAT", "Unknown catId.");
        await assets.loadActor(cat);
        if (destroyed) throw gameError("DESTROYED", "This game instance has been destroyed.");
        if (version !== catChangeVersion) throw gameError("SUPERSEDED", "A newer cat selection replaced this request.");
        const oldCat = assets.cats.find(actor => actor.id === engine.catId);
        const result = engine.execute(command, payload);
        if (oldCat && oldCat.id !== cat.id) assets.unloadActor(oldCat);
        return result;
      }
      if (command === "setMuted" && payload?.muted === false) audio.unlock();
      if (["start", "resume", "restart", "fire", "explode"].includes(command) && !engine.muted) audio.unlock();
      return engine.execute(command, payload);
    },
    getState: () => engine.getState(),
    destroy() {
      if (destroyed) return;
      destroyed = true; cancelAnimationFrame(frameId); observer?.disconnect(); removals.forEach(remove => remove()); audio.destroy();
    },
  };
  emit("ready", engine.getState());
  return api;
}
