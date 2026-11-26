import { WORLD } from "./engine.js";
import { CAT_POSE, actorLayout } from "./character-layout.js";

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const actors = value => Array.isArray(value) ? value : Object.values(value || {});

export class AssetLibrary {
  constructor(manifest, baseUrl) {
    this.manifest = manifest;
    this.baseUrl = baseUrl;
    this.cats = actors(manifest.cats);
    this.enemies = actors(manifest.enemies);
    this.images = new Map();
    this.loads = new Map();
    this.failed = new Set();
    this.generations = new Map();
    this.enemyRecent = new Map();
    this.useSequence = 0;
  }
  url(path) { return new URL(path, this.baseUrl).href; }
  load(path) {
    if (!path) return Promise.resolve(null);
    if (!this.loads.has(path)) {
      const generation = (this.generations.get(path) || 0) + 1;
      this.generations.set(path, generation);
      const promise = new Promise((resolve, reject) => {
        const picture = new Image();
        picture.decoding = "async";
        picture.onload = () => {
          // An evicted or replaced in-flight request must not refill the decoded-image cache.
          if (this.generations.get(path) === generation) this.images.set(path, picture);
          resolve(picture);
        };
        picture.onerror = () => {
          if (this.generations.get(path) === generation) this.failed.add(path);
          reject(new Error(`Unable to load game asset: ${path}`));
        };
        picture.src = this.url(path);
      });
      // Background clips may not be used until a later wave. Keep failures observable without an unhandled rejection.
      promise.catch(() => {});
      this.loads.set(path, promise);
    }
    return this.loads.get(path);
  }
  async loadActor(actor, clipNames = Object.keys(actor?.clips || {})) {
    if (!actor) return;
    await Promise.all([...new Set(clipNames.map(name => actor.clips[name]?.image || actor.image).filter(Boolean))].map(path => this.load(path)));
  }
  unloadActor(actor) {
    for (const path of this.actorPaths(actor)) {
      this.generations.set(path, (this.generations.get(path) || 0) + 1);
      this.images.delete(path); this.loads.delete(path);
    }
  }
  actorPaths(actor) {
    return new Set([actor?.image, ...Object.values(actor?.clips || {}).map(clip => clip.image)].filter(Boolean));
  }
  markEnemyUsed(id) { this.enemyRecent.set(id, ++this.useSequence); }
  trimEnemyCache(activeIds, warmCount = 2) {
    const active = new Set(activeIds);
    const inactive = this.enemies.filter(actor => !active.has(actor.id) &&
      [...this.actorPaths(actor)].some(path => this.loads.has(path) || this.images.has(path)));
    inactive.sort((a, b) => (this.enemyRecent.get(b.id) || 0) - (this.enemyRecent.get(a.id) || 0));
    for (const actor of inactive.slice(warmCount)) this.unloadActor(actor);
  }
  picture(path) {
    if (path && !this.loads.has(path)) this.load(path);
    return this.images.get(path);
  }
}

export function frameAt(actor, name, timeMs, loop = true) {
  const clip = actor?.clips?.[name];
  if (!clip?.frames?.length) return null;
  const count = clip.frames.length;
  const raw = Math.floor(Math.max(0, timeMs) * (clip.fps || 30) / 1000);
  const index = loop ? raw % count : Math.min(raw, count - 1);
  return { clip, frame: clip.frames[index], index };
}

export class DefenseRenderer {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    if (!this.context) throw new Error("A 2D canvas is required to play Cat Guard.");
    this.assets = assets;
    this.pointer = null;
    this.view = { scale: 1, x: 0, y: 0, width: 1280, height: 720 };
    this.visualTime = 0;
    this.catPose = { ...CAT_POSE };
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(width * pixelRatio);
    this.canvas.height = Math.round(height * pixelRatio);
    this.view = { scale: Math.min(width / WORLD.width, height / WORLD.height), x: 0, y: 0, width, height, pixelRatio };
    this.view.x = (width - WORLD.width * this.view.scale) / 2;
    this.view.y = (height - WORLD.height * this.view.scale) / 2;
  }

  worldPoint(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left - this.view.x) / this.view.scale;
    const y = (clientY - rect.top - this.view.y) / this.view.scale;
    if (x < 0 || x > WORLD.width || y < 0 || y > WORLD.height) return null;
    return { x: x / WORLD.width, y: y / WORLD.height };
  }

  currentCat(engine) { return this.assets.cats.find(cat => cat.id === engine.catId) || this.assets.cats[0]; }
  actionName(cat) { return ["shoot", "attack", "fight"].find(name => cat?.clips?.[name]) || "idle"; }

  catFrame(engine, forceAction = false) {
    const cat = this.currentCat(engine);
    const name = this.actionName(cat);
    const clip = cat?.clips?.[name];
    const actionLength = clip ? clip.frames.length / (clip.fps || 30) * 1000 : 0;
    const actionAge = engine.elapsedMs - engine.catActionMs;
    const active = forceAction || actionAge < actionLength;
    return { cat, ...frameAt(cat, active ? name : "idle", active ? (forceAction ? 0 : actionAge) : this.visualTime, !active) };
  }

  muzzle(engine) {
    const { cat, frame } = this.catFrame(engine, true);
    if (!cat) return { x: 310, y: 435 };
    const layout = actorLayout(cat, this.catPose.height);
    const anchor = layout.anchor;
    const muzzle = frame?.muzzle || cat.muzzle || { x: 0.79, y: 0.64 };
    return { x: this.catPose.x + (muzzle.x - anchor.x) * layout.width, y: this.catPose.y + (muzzle.y - anchor.y) * layout.height };
  }

  _actor(actor, clipName, age, x, y, size, { loop = true, alpha = 1, tint = false, anchor: drawAnchor } = {}) {
    let selected = frameAt(actor, clipName, age, loop);
    if (!selected) selected = frameAt(actor, "idle", age);
    if (!selected) return;
    let image = this.assets.picture(selected.clip.image || actor.image);
    // An already-decoded walk/idle frame keeps a newly requested action visible while its atlas decodes.
    if (!image) {
      for (const name of ["walk", "idle"]) {
        const fallback = frameAt(actor, name, age);
        const loaded = fallback && this.assets.images.get(fallback.clip.image || actor.image);
        if (loaded) { selected = fallback; image = loaded; break; }
      }
    }
    if (!image) return;
    const { frame } = selected;
    const anchor = drawAnchor || actor.anchor || { x: 0.5, y: 0.9 };
    const height = size * (actor.frameHeight || frame.h) / (actor.frameWidth || frame.w);
    const ctx = this.context;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (tint) ctx.filter = "brightness(1.6) saturate(.7)";
    ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, x - anchor.x * size, y - anchor.y * height, size, height);
    ctx.restore();
  }

  _scenery(engine) {
    const ctx = this.context;
    const scene = this.assets.manifest.scenery || {};
    const background = scene.background;
    const image = this.assets.picture(typeof background === "string" ? background : background?.image);
    if (image) {
      ctx.drawImage(image, 0, 0, WORLD.width, WORLD.height);
      // Restore the supplied health bar's inner channel, then render its actual current value.
      const bar = background?.fenceHpBar || scene.fenceHpBar;
      if (bar) {
        const x = bar.x * WORLD.width, y = bar.y * WORLD.height, w = bar.w * WORLD.width, h = bar.h * WORLD.height;
        ctx.fillStyle = "#223841"; ctx.fillRect(x, y, w, h);
        const percent = engine.fenceHp / engine.rules.fenceMaxHp;
        ctx.fillStyle = percent < 0.25 ? "#ff8262" : percent < 0.6 ? "#ffd16f" : "#b9ee6e";
        ctx.fillRect(x, y + h * (1 - percent), w, h * percent);
      }
    } else {
      ctx.fillStyle = "#526d77"; ctx.fillRect(0, 0, WORLD.width, WORLD.height);
      ctx.fillStyle = "#7e9295"; ctx.fillRect(0, 135, WORLD.width, 12); ctx.fillRect(0, 600, WORLD.width, 12);
    }
    // Low-contrast lane markers clarify the depth without replacing the native background.
    ctx.save(); ctx.strokeStyle = "#d6eded09"; ctx.setLineDash([9, 16]); ctx.lineWidth = 2;
    for (const y of [385, 480]) { ctx.beginPath(); ctx.moveTo(450, y); ctx.lineTo(1240, y); ctx.stroke(); }
    ctx.restore();
  }

  _enemy(enemy, engine) {
    const actor = this.assets.enemies.find(def => def.id === enemy.type);
    if (!actor) return;
    const ctx = this.context;
    const age = engine.elapsedMs - enemy.stateMs;
    const dead = enemy.state === "dead";
    const alpha = dead ? clamp((enemy.deathDurationMs - age) / 300, 0, 1) : 1;
    const layout = actorLayout(actor, enemy.height);
    this._actor(actor, enemy.state, age, enemy.x, enemy.y, layout.width, { loop: !dead, alpha, tint: engine.elapsedMs - enemy.hitMs < 85, anchor:layout.anchor });
    if (!dead && enemy.health < enemy.maxHealth) {
      const width = enemy.kind === "boss" ? 68 : 42;
      const x = enemy.x - width / 2, y = enemy.y - enemy.height - 10;
      ctx.fillStyle = "#1a2a38bb"; this.rounded(x - 2, y - 2, width + 4, 8, 4); ctx.fill();
      ctx.fillStyle = enemy.kind === "boss" ? "#ffbb63" : "#c8e7a2"; this.rounded(x, y, width * enemy.health / enemy.maxHealth, 4, 2); ctx.fill();
    }
    if (!dead && enemy.kind === "boss") {
      ctx.font = "900 10px system-ui"; ctx.textAlign = "center"; ctx.fillStyle = "#ffe1a0";
      ctx.shadowColor = "#172b35"; ctx.shadowBlur = 4; ctx.fillText("BOSS", enemy.x, enemy.y - enemy.height - 22); ctx.shadowBlur = 0;
    }
  }

  rounded(x, y, width, height, radius) {
    const ctx = this.context; ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, Math.max(0, width), height, radius);
    else ctx.rect(x, y, Math.max(0, width), height);
  }

  _clipEffect(def, progress, x, y, width, angle = 0) {
    if (!def) return false;
    const clipName = Object.keys(def.clips || {})[0];
    const clip = def.clips?.[clipName] || (def.frames ? def : null);
    if (!clip?.frames?.length) return false;
    const frame = clip.frames[Math.min(clip.frames.length - 1, Math.floor(clamp(progress, 0, 1) * clip.frames.length))];
    const image = this.assets.picture(clip.image || def.image);
    if (!image) return false;
    const height = width * frame.h / frame.w;
    const ctx = this.context;
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, -width / 2, -height / 2, width, height);
    ctx.restore(); return true;
  }

  _effects(engine) {
    const ctx = this.context;
    const effects = this.assets.manifest.effects || {};
    for (const bullet of engine.projectiles) {
      ctx.save(); ctx.translate(bullet.x, bullet.y); ctx.rotate(Math.atan2(bullet.vy, bullet.vx));
      const glow = ctx.createLinearGradient(-20, 0, 8, 0); glow.addColorStop(0, "#ffe8aa00"); glow.addColorStop(0.7, "#ffe8aacc"); glow.addColorStop(1, "#fff6d7");
      ctx.fillStyle = glow; this.rounded(-20, -2, 27, 4, 2); ctx.fill(); ctx.restore();
    }
    for (const explosion of engine.explosions) {
      const progress = (engine.elapsedMs - explosion.bornMs) / explosion.durationMs;
      if (!this._clipEffect(effects.explosion, progress, explosion.x, explosion.y, explosion.radius * 2.7)) {
        ctx.save(); ctx.globalAlpha = (1 - progress) * 0.7; ctx.fillStyle = "#ffd36b"; ctx.beginPath(); ctx.arc(explosion.x, explosion.y, explosion.radius * (0.4 + progress), 0, TAU); ctx.fill(); ctx.restore();
      }
    }
    for (const effect of engine.effects) {
      const age = engine.elapsedMs - effect.bornMs, p = age / effect.durationMs;
      ctx.save();
      if (effect.kind === "muzzle") {
        this._clipEffect(effects.shoot || effects.muzzle, p, effect.x + Math.cos(effect.angle) * 19, effect.y + Math.sin(effect.angle) * 19, 78, effect.angle);
      } else if (effect.kind === "hit") {
        ctx.globalAlpha = 1 - p; ctx.strokeStyle = "#fff2c6"; ctx.lineWidth = 3;
        for (let i = 0; i < 6; i++) { const a = i * TAU / 6; ctx.beginPath(); ctx.moveTo(effect.x + Math.cos(a) * (4 + p * 15), effect.y + Math.sin(a) * (4 + p * 15)); ctx.lineTo(effect.x + Math.cos(a) * (11 + p * 22), effect.y + Math.sin(a) * (11 + p * 22)); ctx.stroke(); }
      } else if (effect.kind === "score") {
        ctx.globalAlpha = 1 - p; ctx.font = "900 20px system-ui"; ctx.textAlign = "center"; ctx.lineWidth = 4; ctx.strokeStyle = "#28424a"; ctx.strokeText(effect.text, effect.x, effect.y - p * 45); ctx.fillStyle = "#ffe7a0"; ctx.fillText(effect.text, effect.x, effect.y - p * 45);
      } else if (effect.kind === "fence") {
        ctx.globalAlpha = (1 - p) * 0.2; ctx.fillStyle = "#ffbd74"; ctx.fillRect(314, 150, 116, 400);
      }
      ctx.restore();
    }
  }

  draw(engine, deltaMs = 0) {
    if (engine.status === "ready") this.visualTime += Math.min(deltaMs, 100);
    else if (engine.status === "playing") this.visualTime = engine.elapsedMs;
    const ctx = this.context, view = this.view;
    ctx.setTransform(view.pixelRatio, 0, 0, view.pixelRatio, 0, 0);
    ctx.fillStyle = "#152b35"; ctx.fillRect(0, 0, view.width, view.height);
    ctx.save();
    ctx.translate(view.x, view.y); ctx.scale(view.scale, view.scale);
    ctx.beginPath(); ctx.rect(0, 0, WORLD.width, WORLD.height); ctx.clip();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    this._scenery(engine);
    const cat = this.currentCat(engine);
    const action = this.actionName(cat);
    const actionClip = cat?.clips?.[action];
    const actionAge = engine.elapsedMs - engine.catActionMs;
    const isActing = actionAge < (actionClip?.frames.length || 0) / (actionClip?.fps || 30) * 1000;
    const catLayout = actorLayout(cat, this.catPose.height);
    const catDraw = () => this._actor(cat, isActing ? action : "idle", isActing ? actionAge : this.visualTime, this.catPose.x, this.catPose.y, catLayout.width, { loop: !isActing, anchor:catLayout.anchor });
    const ordered = engine.enemies.slice().sort((a, b) => a.y - b.y);
    let drewCat = false;
    for (const enemy of ordered) {
      if (!drewCat && enemy.y > this.catPose.y) { catDraw(); drewCat = true; }
      this._enemy(enemy, engine);
    }
    if (!drewCat) catDraw();
    this._effects(engine);
    if (this.pointer && engine.status === "playing") {
      const x = this.pointer.x * WORLD.width, y = this.pointer.y * WORLD.height;
      ctx.save(); ctx.strokeStyle = "#ffdf9d99"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 13, 0, TAU); ctx.moveTo(x - 19, y); ctx.lineTo(x - 8, y); ctx.moveTo(x + 8, y); ctx.lineTo(x + 19, y); ctx.moveTo(x, y - 19); ctx.lineTo(x, y - 8); ctx.moveTo(x, y + 8); ctx.lineTo(x, y + 19); ctx.stroke(); ctx.restore();
    }
    if (engine.status === "playing" && engine.nextWaveMs !== null) {
      ctx.font = "800 15px system-ui"; ctx.textAlign = "center"; ctx.fillStyle = "#fff0be";
      ctx.fillText(`WAVE CLEAR · NEXT IN ${Math.max(1, Math.ceil((engine.nextWaveMs - engine.elapsedMs) / 1000))}`, 825, 195);
    }
    ctx.restore();
  }
}
