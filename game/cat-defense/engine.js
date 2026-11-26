import { RULE_LIMITS, assertRecord, finiteNumber, gameError, validateRules } from "./rules.js";
import { ENEMY_BODY } from "./character-layout.js";

export const WORLD = Object.freeze({ width: 1280, height: 720, fenceX: 420, laneY: [350, 445, 535] });
const DEFAULT_ENEMIES = Array.from({ length: 8 }, (_, i) => ({ id: `reg-${i + 1}`, kind: "regular" }));
const copy = value => JSON.parse(JSON.stringify(value));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function seededRandom(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let n = state;
    n = Math.imul(n ^ n >>> 15, n | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}

function segmentCircle(x1, y1, x2, y2, cx, cy, radius) {
  const dx = x2 - x1, dy = y2 - y1;
  const d = dx * dx + dy * dy;
  const t = d ? clamp(((cx - x1) * dx + (cy - y1) * dy) / d, 0, 1) : 0;
  return (x1 + t * dx - cx) ** 2 + (y1 + t * dy - cy) ** 2 <= radius ** 2;
}

/** Pure deterministic simulation. Presentation, audio, and transport live outside it. */
export class DefenseEngine {
  constructor({ onEvent = () => {}, enemies = DEFAULT_ENEMIES, cats = [], seed = 12345, rules = {} } = {}) {
    this.onEvent = onEvent;
    this.enemyTypes = enemies.length ? enemies : DEFAULT_ENEMIES;
    this.cats = cats;
    this.rules = validateRules(rules);
    this.player = { id: "local-player", displayName: "Guest ranger" };
    this.catId = cats[0]?.id || "cat-01";
    this.muted = true;
    this.seed = seed;
    this.muzzle = { x: 300, y: 445 };
    this._reset(seed);
  }

  _emit(type, detail = {}) { this.onEvent(type, copy(detail)); }
  _stateChanged() { this._emit("state", this.getState()); }

  _reset(seed) {
    this.seed = seed;
    this.random = seededRandom(seed);
    this.status = "ready";
    this.score = 0;
    this.wave = 0;
    this.kills = 0;
    this.elapsedMs = 0;
    this.fenceHp = this.rules.fenceMaxHp;
    this.enemies = [];
    this.projectiles = [];
    this.explosions = [];
    this.effects = [];
    this.lastShotMs = -Infinity;
    this.nextSpawnMs = 0;
    this.nextWaveMs = null;
    this.waveSpawned = 0;
    this.waveTarget = 0;
    this.idSequence = 0;
    this.shotSerial = 0;
    this.completed = false;
    this.catActionMs = -Infinity;
    this.aim = { x: 950, y: 450 };
  }

  getState() {
    return {
      status: this.status, score: this.score, wave: this.wave, kills: this.kills,
      elapsedMs: Math.round(this.elapsedMs), fence: { hp: this.fenceHp, maxHp: this.rules.fenceMaxHp },
      player: { ...this.player }, rules: { ...this.rules }, catId: this.catId,
      enemyCount: this.enemies.filter(e => e.state !== "dead").length,
      muted: this.muted, completed: this.completed, seed: this.seed,
      waveProgress: { spawned: this.waveSpawned, total: this.waveTarget },
      cooldownMs: Math.max(0, Math.ceil(this.rules.fireCooldownMs - (this.elapsedMs - this.lastShotMs))),
      availableCats: this.cats.map(({ id, name, label, kind }) => ({ id, name: name || label || id, kind: kind || "gun" })),
      availableEnemies: this.enemyTypes.map(({ id, label, kind }) => ({ id, name: label || id, kind: kind || "regular" })),
      ruleLimits: copy(RULE_LIMITS),
    };
  }

  setMuzzle(point) { this.muzzle = { x: point.x, y: point.y }; }

  execute(command, payload = {}) {
    assertRecord(payload);
    switch (command) {
      case "getState": return this.getState();
      case "configure": {
        const next = validateRules(payload.rules, this.rules);
        this.rules = next;
        this.fenceHp = Math.min(this.fenceHp, next.fenceMaxHp);
        this._stateChanged();
        return this.getState();
      }
      case "setPlayer": {
        const player = assertRecord(payload.player, "player");
        if (typeof player.id !== "string" || !player.id.trim() || player.id.length > 160 ||
            typeof player.displayName !== "string" || !player.displayName.trim() || player.displayName.length > 80) {
          throw gameError("INVALID_ARGUMENT", "player requires id (1–160 characters) and displayName (1–80 characters).");
        }
        this.player = { id: player.id.trim(), displayName: player.displayName.trim() };
        this._stateChanged();
        return this.getState();
      }
      case "setCat": {
        if (!this.cats.some(cat => cat.id === payload.catId)) throw gameError("UNKNOWN_CAT", "Unknown catId.");
        this.catId = payload.catId;
        this.catActionMs = -Infinity;
        this._stateChanged();
        return this.getState();
      }
      case "start": {
        if (this.status === "playing") return this.getState();
        if (this.status === "paused") return this.execute("resume");
        if (this.status === "gameover") return this.execute("restart", payload);
        this.status = "playing";
        this._startWave();
        this._stateChanged();
        return this.getState();
      }
      case "pause": {
        if (this.status === "playing") { this.status = "paused"; this._stateChanged(); }
        return this.getState();
      }
      case "resume": {
        if (this.status === "paused") { this.status = "playing"; this._stateChanged(); }
        return this.getState();
      }
      case "restart": {
        const seed = payload.seed === undefined ? this.seed : finiteNumber(payload.seed, "seed", 0, 4294967295, true);
        this._reset(seed);
        this.status = "playing";
        this._startWave();
        this._emit("scoreChanged", { score: 0, reason: "restart" });
        this._stateChanged();
        return this.getState();
      }
      case "fire": {
        let target;
        if (payload.target !== undefined) {
          const p = assertRecord(payload.target, "target");
          target = { x: finiteNumber(p.x, "target.x", 0, 1) * WORLD.width, y: finiteNumber(p.y, "target.y", 0, 1) * WORLD.height };
        }
        return this.fire(target);
      }
      case "spawnEnemy": {
        if (payload.lane !== undefined) finiteNumber(payload.lane, "lane", 0, 2, true);
        if (payload.health !== undefined) finiteNumber(payload.health, "health", 1, 100000);
        if (payload.speed !== undefined) finiteNumber(payload.speed, "speed", 0, 600);
        if (payload.type !== undefined && !this.enemyTypes.some(e => e.id === payload.type)) throw gameError("UNKNOWN_ENEMY", "Unknown enemy type.");
        if (this.status !== "playing") throw gameError("INVALID_STATE", "Start or resume the game before spawning an enemy.");
        if (this.livingEnemies().length >= this.rules.maxEnemies) return { accepted: false, reason: "enemy-limit" };
        const enemy = this.spawnEnemy(payload);
        this._stateChanged();
        return { accepted: true, enemyId: enemy.id };
      }
      case "setFenceHp": {
        this.fenceHp = finiteNumber(payload.hp, "hp", 0, this.rules.fenceMaxHp);
        if (this.fenceHp === 0 && this.status !== "gameover") this._gameOver(false);
        this._stateChanged();
        return this.getState();
      }
      case "repairFence": {
        const amount = finiteNumber(payload.amount, "amount", 0, 1000000);
        this.fenceHp = Math.min(this.rules.fenceMaxHp, this.fenceHp + amount);
        this._stateChanged();
        return this.getState();
      }
      case "explode": return this.explode(payload);
      case "setScore": {
        this.score = finiteNumber(payload.score, "score", 0, Number.MAX_SAFE_INTEGER, true);
        this._emit("scoreChanged", { score: this.score, reason: "host" });
        this._stateChanged();
        return this.getState();
      }
      case "setMuted": {
        if (typeof payload.muted !== "boolean") throw gameError("INVALID_ARGUMENT", "muted must be a boolean.");
        this.muted = payload.muted;
        this._stateChanged();
        return this.getState();
      }
      default: throw gameError("UNKNOWN_COMMAND", `Unknown command: ${command}.`);
    }
  }

  livingEnemies() { return this.enemies.filter(enemy => enemy.state !== "dead"); }

  _startWave() {
    this.wave++;
    this.waveSpawned = 0;
    this.waveTarget = this.rules.enemiesPerWave;
    this.nextWaveMs = null;
    this.nextSpawnMs = this.elapsedMs + 350;
    this._emit("waveStarted", { wave: this.wave, enemyTotal: this.waveTarget, boss: this.wave % 3 === 0 });
  }

  spawnEnemy({ type, lane, health, speed } = {}, waveEnemy = false) {
    const regulars = this.enemyTypes.filter(e => e.kind !== "boss");
    const bosses = this.enemyTypes.filter(e => e.kind === "boss");
    const useBoss = waveEnemy && this.wave % 3 === 0 && this.waveSpawned === this.waveTarget - 1 && bosses.length;
    const pool = useBoss ? bosses : (regulars.length ? regulars : this.enemyTypes);
    const def = type ? this.enemyTypes.find(e => e.id === type) : pool[Math.floor(this.random() * pool.length)];
    const boss = def.kind === "boss";
    const laneIndex = lane ?? Math.floor(this.random() * 3);
    const waveScale = 1 + Math.max(0, this.wave - 1) * this.rules.enemySpeedMultiplierPerWave;
    const hp = health ?? this.rules.enemyHealth * (boss ? 6 : 1) * (1 + Math.max(0, this.wave - 1) * 0.12);
    const speedFactor = waveScale * (boss ? 0.72 : 0.85 + this.random() * 0.3);
    const enemy = {
      id: `enemy-${++this.idSequence}`, type: def.id, kind: boss ? "boss" : "regular", lane: laneIndex,
      x: WORLD.width + (boss ? 110 : 70), y: WORLD.laneY[laneIndex] + (this.random() - 0.5) * 16,
      health: hp, maxHealth: hp, speed: speed ?? this.rules.enemySpeed * speedFactor, speedFactor,
      speedOverride: speed !== undefined, ...ENEMY_BODY[boss ? "boss" : "regular"],
      deathDurationMs: def.clips?.dead?.frames?.length ? def.clips.dead.frames.length / (def.clips.dead.fps || 30) * 1000 + 300 : 1250,
      state: "walk", bornMs: this.elapsedMs, stateMs: this.elapsedMs,
      lastAttackMs: this.elapsedMs, hitMs: -Infinity,
    };
    this.enemies.push(enemy);
    if (waveEnemy) this.waveSpawned++;
    this._emit("enemySpawned", { enemyId: enemy.id, enemyType: enemy.type, kind: enemy.kind, lane: enemy.lane, health: enemy.health, speed: enemy.speed });
    return enemy;
  }

  fire(target) {
    if (this.status !== "playing") return { accepted: false, reason: this.status === "paused" ? "paused" : "not-playing" };
    const cooldownMs = this.rules.fireCooldownMs - (this.elapsedMs - this.lastShotMs);
    if (cooldownMs > 0) return { accepted: false, reason: "cooldown", cooldownMs: Math.ceil(cooldownMs) };
    if (this.muzzleProvider) this.setMuzzle(this.muzzleProvider());
    const living = this.livingEnemies();
    const closest = living.sort((a, b) => a.x - b.x)[0];
    this.aim = target || (closest ? { x: Math.min(WORLD.width, closest.x), y: closest.y - closest.height * 0.48 } : { x: 1050, y: this.muzzle.y });
    const angle = Math.atan2(this.aim.y - this.muzzle.y, Math.max(80, this.aim.x - this.muzzle.x));
    const spread = this.rules.spreadDegrees * Math.PI / 180;
    const shotId = `shot-${++this.shotSerial}`;
    for (let i = 0; i < this.rules.pelletCount; i++) {
      const a = angle + (this.rules.pelletCount === 1 ? 0 : (i / (this.rules.pelletCount - 1) - 0.5) * spread);
      this.projectiles.push({ id: `${shotId}-${i}`, shotId, x: this.muzzle.x, y: this.muzzle.y,
        vx: Math.cos(a) * this.rules.projectileSpeed, vy: Math.sin(a) * this.rules.projectileSpeed,
        bornMs: this.elapsedMs, lifetimeMs: this.rules.projectileLifetimeMs, damage: this.rules.shotDamage });
    }
    this.lastShotMs = this.elapsedMs;
    this.catActionMs = this.elapsedMs;
    this.effects.push({ kind: "muzzle", x: this.muzzle.x, y: this.muzzle.y, angle, bornMs: this.elapsedMs, durationMs: 170 });
    this._emit("shot", { shotId, target: { x: this.aim.x / WORLD.width, y: this.aim.y / WORLD.height }, pelletCount: this.rules.pelletCount, damage: this.rules.shotDamage });
    return { accepted: true, shotId, cooldownMs: this.rules.fireCooldownMs };
  }

  explode(payload) {
    const x = finiteNumber(payload.x, "x", 0, 1) * WORLD.width;
    const y = finiteNumber(payload.y, "y", 0, 1) * WORLD.height;
    const radius = payload.radius === undefined ? this.rules.explosionRadius : finiteNumber(payload.radius, "radius", 1, 1280);
    const damage = payload.damage === undefined ? this.rules.explosionDamage : finiteNumber(payload.damage, "damage", 0, 100000);
    const durationMs = payload.durationMs === undefined ? this.rules.explosionDurationMs : finiteNumber(payload.durationMs, "durationMs", 100, 10000);
    if (this.status !== "playing") throw gameError("INVALID_STATE", "Start or resume the game before an explosion.");
    const explosion = { id: `explosion-${++this.idSequence}`, x, y, radius, damage, durationMs, bornMs: this.elapsedMs };
    this.explosions.push(explosion);
    this._emit("explosionStarted", { explosionId: explosion.id, x: x / WORLD.width, y: y / WORLD.height, radius, damage, durationMs });
    // Damage is instantaneous once; duration affects only the authored visual animation.
    for (const enemy of this.livingEnemies()) {
      if (Math.hypot(enemy.x - x, enemy.y - enemy.height * 0.48 - y) <= radius + enemy.radius) this._damageEnemy(enemy, damage);
    }
    this._stateChanged();
    return { accepted: true, explosionId: explosion.id };
  }

  _damageEnemy(enemy, damage) {
    if (enemy.state === "dead") return;
    enemy.health = Math.max(0, enemy.health - damage);
    enemy.hitMs = this.elapsedMs;
    this.effects.push({ kind: "hit", x: enemy.x, y: enemy.y - enemy.height * 0.5, bornMs: this.elapsedMs, durationMs: 230 });
    if (enemy.health <= 0) {
      enemy.state = "dead";
      enemy.stateMs = this.elapsedMs;
      this.kills++;
      const points = this.rules.scorePerKill * (enemy.kind === "boss" ? 5 : 1);
      const detail = { enemyId: enemy.id, enemyType: enemy.type, points, killIndex: this.kills };
      this._emit("enemyKilled", detail);
      if (this.rules.scoreMode === "host") this._emit("scoreRequested", detail);
      else {
        this.score += points;
        this._emit("scoreChanged", { score: this.score, delta: points, reason: "enemy-killed", enemyId: enemy.id });
      }
      this.effects.push({ kind: "score", x: enemy.x, y: enemy.y - enemy.height,
        text: this.rules.scoreMode === "host" ? "Defeated" : `+${points}`, bornMs: this.elapsedMs, durationMs: 900 });
      this._stateChanged();
    }
  }

  _gameOver(completed) {
    this.status = "gameover";
    this.completed = completed;
    this.projectiles.length = 0;
    this._emit("gameOver", { score: this.score, wave: this.wave, kills: this.kills, elapsedMs: this.elapsedMs, completed });
  }

  update(deltaMs) {
    if (this.status !== "playing") return;
    // Fixed bounded substeps keep swept collisions and contact damage consistent at slow frame rates.
    let remaining = Math.max(0, Math.min(deltaMs, 250));
    while (remaining > 0 && this.status === "playing") {
      const dt = Math.min(remaining, 1000 / 60);
      this._step(dt);
      remaining -= dt;
    }
  }

  _step(dt) {
    this.elapsedMs += dt;
    const seconds = dt / 1000;
    if (this.nextWaveMs !== null && this.elapsedMs >= this.nextWaveMs) this._startWave();
    if (this.nextWaveMs === null && this.waveSpawned < this.waveTarget && this.elapsedMs >= this.nextSpawnMs && this.livingEnemies().length < this.rules.maxEnemies) {
      this.spawnEnemy({}, true);
      this.nextSpawnMs = this.elapsedMs + this.rules.spawnIntervalMs;
    }
    if (this.rules.autoFire && this.livingEnemies().length) this.fire();
    for (const enemy of this.enemies) {
      if (enemy.state === "dead") continue;
      if (enemy.x > WORLD.fenceX + enemy.radius + 15) {
        enemy.x -= (enemy.speedOverride ? enemy.speed : this.rules.enemySpeed * enemy.speedFactor) * seconds;
      } else {
        if (enemy.state !== "attack") { enemy.state = "attack"; enemy.stateMs = this.elapsedMs; enemy.lastAttackMs = this.elapsedMs - this.rules.enemyAttackIntervalMs + 250; }
        if (this.elapsedMs - enemy.lastAttackMs >= this.rules.enemyAttackIntervalMs) {
          const damage = this.rules.enemyContactDamage * (enemy.kind === "boss" ? 3 : 1);
          this.fenceHp = Math.max(0, this.fenceHp - damage);
          enemy.lastAttackMs = this.elapsedMs;
          this._emit("fenceDamaged", { enemyId: enemy.id, damage, hp: this.fenceHp, maxHp: this.rules.fenceMaxHp });
          this.effects.push({ kind: "fence", x: WORLD.fenceX, y: enemy.y - 30, bornMs: this.elapsedMs, durationMs: 180 });
          if (!this.fenceHp) { this._gameOver(false); this._stateChanged(); return; }
          this._stateChanged();
        }
      }
    }
    const survivors = [];
    for (const bullet of this.projectiles) {
      const x = bullet.x + bullet.vx * seconds, y = bullet.y + bullet.vy * seconds;
      const hit = this.livingEnemies().filter(enemy => segmentCircle(bullet.x, bullet.y, x, y, enemy.x, enemy.y - enemy.height * 0.48, enemy.radius)).sort((a, b) => a.x - b.x)[0];
      if (hit) this._damageEnemy(hit, bullet.damage);
      else if (this.elapsedMs - bullet.bornMs < bullet.lifetimeMs && x < WORLD.width + 40 && y > -50 && y < WORLD.height + 50) { bullet.x = x; bullet.y = y; survivors.push(bullet); }
    }
    this.projectiles = survivors;
    this.explosions = this.explosions.filter(explosion => {
      if (this.elapsedMs - explosion.bornMs < explosion.durationMs) return true;
      this._emit("explosionEnded", { explosionId: explosion.id });
      return false;
    });
    this.effects = this.effects.filter(effect => this.elapsedMs - effect.bornMs < effect.durationMs);
    this.enemies = this.enemies.filter(enemy => enemy.state !== "dead" || this.elapsedMs - enemy.stateMs < enemy.deathDurationMs);
    if (this.nextWaveMs === null && this.waveSpawned >= this.waveTarget && !this.livingEnemies().length) {
      this._emit("waveCompleted", { wave: this.wave, score: this.score });
      if (this.rules.maxWaves > 0 && this.wave >= this.rules.maxWaves) this._gameOver(true);
      else this.nextWaveMs = this.elapsedMs + this.rules.waveDelayMs;
      this._stateChanged();
    }
  }
}
