import test from "node:test";
import assert from "node:assert/strict";
import { DefenseEngine, WORLD } from "../game/cat-defense/engine.js";
import { DEFAULT_RULES, validateRules } from "../game/cat-defense/rules.js";
import { createGame } from "../game/cat-defense/game.js";
import { AssetLibrary, DefenseRenderer } from "../game/cat-defense/render.js";

const advance = (engine, ms) => { for (let left = ms; left > 0; left -= 100) engine.update(Math.min(100, left)); };
function game(rules = {}) {
  const events = [];
  const engine = new DefenseEngine({
    onEvent: (type, payload) => events.push({ type, payload }),
    enemies: [{ id: "reg-1", kind: "regular" }, { id: "boss-1", kind: "boss" }],
    cats: [{ id: "cat-01", label: "Orange scout", kind: "gun" }, { id: "cat-02", label: "Gray scout", kind: "gun" }],
    rules: { autoFire: false, spawnIntervalMs: 60000, ...rules }, seed: 42,
  });
  engine.execute("start");
  engine.nextSpawnMs = Infinity;
  return { engine, events };
}

test("rule changes are atomic, reject unknown keys/non-finite values/prototype keys", () => {
  const { engine } = game();
  assert.throws(() => engine.execute("configure", { rules: { enemySpeed: 120, nope: 1 } }), { code: "UNKNOWN_RULE" });
  assert.equal(engine.rules.enemySpeed, DEFAULT_RULES.enemySpeed);
  for (const rules of [{ pelletCount: 1.5 }, { enemyHealth: Infinity }, { autoFire: "yes" }, { scoreMode: "client" }, JSON.parse('{"__proto__":{"polluted":true}}')]) {
    assert.throws(() => validateRules(rules), RangeError);
  }
  assert.equal({}.polluted, undefined);
});

test("manual fire obeys cooldown, swept projectiles damage only once", () => {
  const { engine, events } = game({ pelletCount: 1, shotDamage: 17, enemyHealth: 50, enemySpeed: 0 });
  const enemy = engine.spawnEnemy({ lane: 1, speed: 0 });
  enemy.x = 800; enemy.y = engine.muzzle.y + enemy.height * 0.48;
  const shot = engine.execute("fire", { target: { x: 800 / WORLD.width, y: engine.muzzle.y / WORLD.height } });
  assert.equal(shot.accepted, true);
  assert.equal(engine.execute("fire").reason, "cooldown");
  advance(engine, 800);
  assert.equal(enemy.health, 33);
  advance(engine, 1500);
  assert.equal(enemy.health, 33);
  assert.equal(events.filter(e => e.type === "shot").length, 1);
});

test("explosion damage applies once while its visual lives for requested duration", () => {
  const { engine, events } = game({ enemyHealth: 100 });
  const enemy = engine.spawnEnemy({ speed: 0 });
  enemy.x = 800;
  const point = { x: enemy.x / WORLD.width, y: (enemy.y - enemy.height * 0.48) / WORLD.height };
  engine.execute("explode", { ...point, damage: 25, durationMs: 700, radius: 120 });
  assert.equal(enemy.health, 75);
  advance(engine, 600);
  assert.equal(enemy.health, 75);
  assert.equal(engine.explosions.length, 1);
  advance(engine, 150);
  assert.equal(engine.explosions.length, 0);
  assert.equal(events.filter(e => e.type === "explosionStarted").length, 1);
  assert.equal(events.filter(e => e.type === "explosionEnded").length, 1);
});

test("host scoring emits one award request per kill without awarding client points", () => {
  const { engine, events } = game({ scoreMode: "host" });
  const enemy = engine.spawnEnemy({ speed: 0 }); enemy.x = 700;
  const explosion = { x: enemy.x / WORLD.width, y: (enemy.y - enemy.height * 0.48) / WORLD.height, damage: 1000 };
  engine.execute("explode", explosion); engine.execute("explode", explosion);
  assert.equal(engine.kills, 1);
  assert.equal(engine.score, 0);
  assert.equal(events.filter(e => e.type === "scoreRequested").length, 1);
  assert.equal(engine.effects.find(effect => effect.kind === "score").text, "Defeated", "host award is not displayed before the host accepts it");
  assert.deepEqual(events.find(e => e.type === "scoreRequested").payload, { enemyId: enemy.id, enemyType: enemy.type, points: 100, killIndex: 1 });
  engine.execute("setScore", { score: 250 });
  assert.equal(engine.getState().score, 250);
});

test("fence attacks stop the game, max HP changes clamp without healing, repair is explicit", () => {
  const { engine, events } = game({ fenceMaxHp: 50, enemyContactDamage: 30, enemyAttackIntervalMs: 100 });
  engine.execute("setFenceHp", { hp: 30 });
  engine.execute("configure", { rules: { fenceMaxHp: 100 } });
  assert.equal(engine.fenceHp, 30);
  engine.execute("repairFence", { amount: 20 }); assert.equal(engine.fenceHp, 50);
  engine.execute("configure", { rules: { fenceMaxHp: 40 } }); assert.equal(engine.fenceHp, 40);
  const enemy = engine.spawnEnemy({ speed: 0 }); enemy.x = WORLD.fenceX;
  advance(engine, 500);
  assert.equal(engine.fenceHp, 0); assert.equal(engine.status, "gameover");
  assert.equal(events.filter(e => e.type === "gameOver").length, 1);
  assert.equal(engine.execute("fire").reason, "not-playing");
});

test("pause freezes simulation; restart resets run data while retaining player/rules/cat", () => {
  const { engine } = game();
  engine.execute("setPlayer", { player: { id: "p-7", displayName: "Mimi" } });
  engine.execute("setCat", { catId: "cat-02" });
  engine.execute("setScore", { score: 123 });
  advance(engine, 500); engine.execute("pause");
  const snapshot = engine.getState();
  advance(engine, 1000); assert.equal(engine.elapsedMs, snapshot.elapsedMs);
  assert.equal(engine.execute("fire").reason, "paused");
  engine.execute("restart", { seed: 1234 });
  const state = engine.getState();
  assert.equal(state.status, "playing"); assert.equal(state.score, 0); assert.equal(state.wave, 1); assert.equal(state.kills, 0);
  assert.equal(state.elapsedMs, 0); assert.equal(state.player.displayName, "Mimi"); assert.equal(state.catId, "cat-02"); assert.equal(state.seed, 1234);
});

test("live enemySpeed changes affect enemies already walking, including zero speed", () => {
  const { engine } = game({ enemySpeed: 0 });
  const enemy = engine.spawnEnemy(); const x = enemy.x;
  advance(engine, 300); assert.equal(enemy.x, x);
  engine.execute("configure", { rules: { enemySpeed: 120 } });
  advance(engine, 300); assert.ok(enemy.x < x - 20);
});

test("waves complete and final configured wave wins; every third wave includes native boss", () => {
  const { engine, events } = game({ enemiesPerWave: 1, waveDelayMs: 0, maxWaves: 3 });
  engine.nextSpawnMs = 0;
  for (let wave = 1; wave <= 3; wave++) {
    advance(engine, 500);
    const enemy = engine.livingEnemies()[0];
    assert.ok(enemy); assert.equal(enemy.kind, wave === 3 ? "boss" : "regular");
    enemy.x = 700;
    engine.execute("explode", { x: enemy.x / WORLD.width, y: (enemy.y - enemy.height * 0.48) / WORLD.height, damage: 10000 });
    advance(engine, 100);
  }
  assert.equal(engine.status, "gameover"); assert.equal(engine.completed, true);
  assert.equal(events.filter(e => e.type === "waveCompleted").length, 3);
  assert.equal(engine.score, 700);
});

test("iframe blur releases held fire without pausing; Space preserves native button activation", async () => {
  class Element {
    constructor(tagName = "div") { this.tagName = tagName; this.listeners = new Map(); }
    matches(selectors) { return selectors.split(",").includes(this.tagName); }
    addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(handler); }
    removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter(value => value !== handler)); }
    dispatch(type, detail = {}) { for (const handler of this.listeners.get(type) || []) handler({ target: this, ...detail }); }
  }
  const context = new Proxy({}, { get: (value, key) => key === "createLinearGradient" ? () => ({ addColorStop() {} }) : (value[key] || (() => {})), set: (value, key, next) => { value[key] = next; return true; } });
  const canvas = Object.assign(new Element("canvas"), { getContext: () => context, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }), focus() {}, setPointerCapture() {} });
  const browser = Object.assign(new Element(), { devicePixelRatio: 1 });
  const frame = { x: 0, y: 0, w: 16, h: 16 };
  const actor = { id: "cat-01", image: "cat.webp", anchor: { x: 0.5, y: 0.9 }, clips: { idle: { frames: [frame] }, shoot: { frames: [frame] } } };
  const enemy = { ...actor, id: "reg-1", kind: "regular", image: "enemy.webp", clips: { walk: { frames: [frame] } } };
  const manifest = { cats: { "cat-01": actor }, enemies: { "reg-1": enemy } };
  const keys = ["window", "document", "HTMLElement", "Image", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame", "fetch"];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let nextFrame, game;
  const events = [];
  Object.assign(globalThis, {
    window: browser, document: { baseURI: "http://localhost/game/" }, HTMLElement: Element,
    Image: class { set src(value) { queueMicrotask(() => this.onload()); } },
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame(callback) { nextFrame = callback; return 1; }, cancelAnimationFrame() {},
    fetch: async () => ({ ok: true, json: async () => manifest }),
  });
  try {
    game = await createGame({ canvas, onEvent: (type, payload) => events.push({ type, payload }) });
    await game.execute("configure", { rules: { autoFire: false, fireCooldownMs: 100 } });
    await game.execute("start");
    canvas.dispatch("pointerdown", { button: 0, clientX: 800, clientY: 400, pointerId: 1 });
    assert.equal(events.filter(event => event.type === "shot").length, 1);
    browser.dispatch("blur");
    assert.equal(game.getState().status, "playing");
    for (let time = 1000; time <= 1800; time += 100) nextFrame(time);
    assert.equal(game.getState().status, "playing");
    assert.equal(events.filter(event => event.type === "shot").length, 1, "blur must release continuous pointer fire");
    let prevented = false;
    const keyboard = { code: "Space", target: new Element("button"), preventDefault() { prevented = true; } };
    browser.dispatch("keydown", keyboard); browser.dispatch("keyup", keyboard);
    assert.equal(prevented, false, "native focused buttons must handle Space themselves");
  } finally {
    game?.destroy();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});

test("enemy atlas cache retains active/dead types and only two recent inactive types", () => {
  const enemies = Array.from({ length: 5 }, (_, i) => ({ id: `reg-${i + 1}`, image: `enemy-${i + 1}.webp`, clips: { dead: { image: `dead-${i + 1}.webp` } } }));
  const assets = new AssetLibrary({ enemies }, new URL("http://localhost/assets/"));
  for (const actor of enemies) {
    assets.markEnemyUsed(actor.id);
    for (const path of assets.actorPaths(actor)) { assets.images.set(path, {}); assets.loads.set(path, Promise.resolve({})); }
  }
  assets.trimEnemyCache(["reg-1"]);
  assert.deepEqual([...assets.images.keys()].sort(), ["dead-1.webp", "dead-4.webp", "dead-5.webp", "enemy-1.webp", "enemy-4.webp", "enemy-5.webp"]);
  assert.equal(assets.loads.size, 6, "resolved promises must also release their decoded image references");
  assets.trimEnemyCache(["reg-1", "reg-4", "reg-5"], 0);
  assert.equal(assets.images.size, 6, "all represented entities, including native death animations, remain loaded");
  assets.trimEnemyCache([], 0); assert.equal(assets.images.size, 0); assert.equal(assets.loads.size, 0);
});

test("an evicted in-flight atlas cannot restore itself or replace a newer load", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "Image");
  const pending = [];
  globalThis.Image = class { set src(value) { pending.push(this); } };
  try {
    const actor = { id: "reg-1", image: "enemy.webp", clips: {} };
    const assets = new AssetLibrary({ enemies: [actor] }, new URL("http://localhost/assets/"));
    const first = assets.load(actor.image);
    assets.unloadActor(actor);
    const second = assets.load(actor.image);
    pending[0].onload(); await first;
    assert.equal(assets.images.has(actor.image), false);
    pending[1].onload(); await second;
    assert.equal(assets.images.get(actor.image), pending[1]);
    pending[0].onload();
    assert.equal(assets.images.get(actor.image), pending[1], "stale completion must not replace the current generation");
  } finally {
    if (original) Object.defineProperty(globalThis, "Image", original); else delete globalThis.Image;
  }
});

test("renderer clips translated world content before drawing entities and restores the clip", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  globalThis.window = { devicePixelRatio: 1 };
  const calls = [];
  const context = new Proxy({}, { get: (value, key) => typeof value[key] === "function" ? value[key] : (...args) => { calls.push([key, args]); }, set: (value, key, next) => { value[key] = next; return true; } });
  try {
    const canvas = { getContext: () => context, getBoundingClientRect: () => ({ width: 1500, height: 720 }) };
    const assets = new AssetLibrary({}, new URL("http://localhost/assets/"));
    const renderer = new DefenseRenderer(canvas, assets);
    const engine = new DefenseEngine();
    renderer.draw(engine);
    const translated = calls.findIndex(([name]) => name === "translate");
    const clipped = calls.findIndex(([name]) => name === "clip");
    assert.ok(translated > 0 && calls[translated - 1][0] === "save");
    assert.ok(clipped > translated);
    assert.deepEqual(calls[clipped - 1], ["rect", [0, 0, WORLD.width, WORLD.height]]);
    assert.equal(calls.at(-1)[0], "restore");
    assert.equal(calls.filter(([name]) => name === "save").length, calls.filter(([name]) => name === "restore").length);
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original); else delete globalThis.window;
  }
});
