import { sceneSizing } from "./scene-sizing.js?v=scene-ratio-1";

const SPECIES = [
  { id: "dolphin", width: 205, speed: 36 },
  { id: "fish1", width: 95, speed: 28, catchable: true },
  { id: "fish2", width: 85, speed: 34, catchable: true },
  { id: "fish3", width: 65, speed: 25, catchable: true },
  { id: "manta-ray", width: 220, speed: 22 },
  { id: "shark", width: 270, speed: 43 },
  { id: "whale", width: 330, speed: 20 },
];

const ATLAS_EDGE = 1024;
const BITE_DURATION = 3;
const REEL_DURATION = 2.2;
const CAUGHT_DURATION = 1.6;
const RELEASE_DURATION = 1.6;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const randomBetween = (min, max) => min + Math.random() * (max - min);

function crowdScale(count, width) {
  const density = clamp((count - SPECIES.length) / 35, 0, 1);
  return 1 - density * (width < 560 ? 0.22 : 0.16);
}

function cuteDefaults(id) {
  const species = id.slice(5).replaceAll("-", "").toLowerCase();
  const widths = {
    anglerfish: 115, armoredcatfish: 125, betta: 75, blacklionfish: 105,
    blobfish: 100, bluegoldfish: 70, bluetang: 80, butterflyfish: 75,
    cardinalfish: 65, clownfish: 60, coralgrouper: 140, cowfish: 90,
    flatfish: 105, flowerhorn: 110, goblinshark: 245, goldfish: 70,
    humphead: 150, koi: 125, lionfish: 105, mandarinfish: 65,
    moorishidol: 85, parrotfish: 125, piranha: 90, puffer: 95,
    redsnapper: 135, royalgramma: 65, shark: 250, sunfish: 215,
    swordfish: 240, tang: 80, tetra: 55, tuna: 210, turbot: 110,
    yellowtang: 80, zebraclownfish: 60,
  };
  const width = widths[species] ?? 85;
  return { id, width, speed: width >= 200 ? 34 : 22 + width * 0.055,
    catchable: width <= 150 && !["lionfish", "blacklionfish", "anglerfish"].includes(species) };
}

function versioned(path, version) {
  return version ? `${path}?v=${encodeURIComponent(version)}` : path;
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

function makeCanvas(width, height) {
  const canvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(width, height)
    : document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function loadAtlas(path, page, edge = ATLAS_EDGE) {
  const scale = Math.min(1, edge / Math.max(page.size.w, page.size.h));
  const width = Math.max(1, Math.round(page.size.w * scale));
  const height = Math.max(1, Math.round(page.size.h * scale));
  if (typeof createImageBitmap === "function") {
    const response = await fetch(path, { cache: "force-cache" });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    const blob = await response.blob();
    try {
      const image = await createImageBitmap(blob, {
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: "high",
      });
      // Browsers that ignore resize options are handled by their actual size.
      if (image.width <= width && image.height <= height) {
        return { image, scaleX: image.width / page.size.w, scaleY: image.height / page.size.h };
      }
      const reduced = makeCanvas(width, height);
      const context = reduced.getContext("2d");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, width, height);
      image.close();
      return { image: reduced, scaleX: width / page.size.w, scaleY: height / page.size.h };
    } catch (error) {
      // Some browsers expose createImageBitmap without resize/decode support.
      // Continue through the ordinary image decoder and immediately downsample.
    }
  }
  const image = await new Promise((resolve, reject) => {
    const source = new Image();
    source.onload = () => resolve(source);
    source.onerror = () => reject(new Error(`Could not load ${path}`));
    source.src = path;
  });
  try {
    const reduced = makeCanvas(width, height);
    const context = reduced.getContext("2d");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, width, height);
    return { image: reduced, scaleX: width / page.size.w, scaleY: height / page.size.h };
  } finally {
    image.src = "";
  }
}

function contentBounds(model) {
  const applyMouth = (bounds) => {
    const point = model.aquarium?.mouth;
    return Number.isFinite(point?.x) && Number.isFinite(point?.y)
      && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
      ? { ...bounds, mouthX: point.x, mouthY: point.y } : bounds;
  };
  const fallback = applyMouth({ centerX: 0.5, centerY: 0.6, width: 0.86, height: 0.48,
    mouthX: 0.5 + model.spriteFacing * 0.86 * 0.46, mouthY: 0.6 });
  const authored = model.aquarium?.bounds;
  if (authored && [authored.x, authored.y, authored.w, authored.h].every(Number.isFinite)
    && authored.x >= 0 && authored.y >= 0 && authored.w > 0 && authored.h > 0
    && authored.x + authored.w <= 1 && authored.y + authored.h <= 1) {
    return applyMouth({
      centerX: authored.x + authored.w / 2,
      centerY: authored.y + authored.h / 2,
      width: authored.w, height: authored.h,
      mouthX: authored.x + authored.w * (model.spriteFacing > 0 ? 0.985 : 0.015),
      mouthY: authored.y + authored.h / 2,
    });
  }
  try {
    // Measure the visible body once; the square source frame has ample padding.
    const probe = makeCanvas(128, 128);
    const context = probe.getContext("2d", { willReadFrequently: true });
    const frame = model.frames[0];
    const atlas = model.images.get(frame.page);
    const rect = frame.frame;
    context.drawImage(atlas.image,
      rect.x * atlas.scaleX, rect.y * atlas.scaleY,
      rect.w * atlas.scaleX, rect.h * atlas.scaleY,
      0, 0, 128, 128);
    const data = context.getImageData(0, 0, 128, 128).data;
    let left = 128;
    let top = 128;
    let right = 0;
    let bottom = 0;
    for (let y = 0; y < 128; y += 1) {
      for (let x = 0; x < 128; x += 1) {
        if (data[(y * 128 + x) * 4 + 3] < 24) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + 1);
        bottom = Math.max(bottom, y + 1);
      }
    }
    if (right <= left || bottom <= top) return fallback;
    const noseRows = [];
    const noseLeft = model.spriteFacing > 0 ? Math.max(left, right - 4) : left;
    const noseRight = model.spriteFacing > 0 ? right : Math.min(right, left + 4);
    for (let y = top; y < bottom; y += 1) {
      for (let x = noseLeft; x < noseRight; x += 1) {
        if (data[(y * 128 + x) * 4 + 3] >= 24) noseRows.push(y + 0.5);
      }
    }
    return applyMouth({
      centerX: (left + right) / 256,
      centerY: (top + bottom) / 256,
      width: (right - left) / 128,
      height: (bottom - top) / 128,
      mouthX: (model.spriteFacing > 0 ? right - 1.5 : left + 1.5) / 128,
      mouthY: noseRows.length ? noseRows.reduce((sum, y) => sum + y, 0) / noseRows.length / 128 : (top + bottom) / 256,
    });
  } catch (error) {
    return fallback;
  }
}

export class Aquarium {
  constructor(canvas, { onStatus = () => {}, onReady = () => {}, drawOverlay = () => {},
    getBait = () => null, getReelTarget = () => null, onFishingEvent = () => {} } = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.onStatus = onStatus;
    this.onReady = onReady;
    this.drawOverlay = drawOverlay;
    this.getBait = getBait;
    this.getReelTarget = getReelTarget;
    this.onFishingEvent = onFishingEvent;
    this.catchCount = 0;
    this.fishingEnabled = false;
    this.fishing = { phase: "disabled", model: null, elapsed: 0, waitTime: randomBetween(5, 10) };
    this.models = [];
    this.active = false;
    this.playing = true;
    this.speed = 1;
    this.clock = 0;
    this.width = 0;
    this.height = 0;
    this.lastTime = null;
    this.raf = null;
    this.loadId = 0;
    this.destroyed = false;
    this.resetCount = 0;
    this.tick = this.tick.bind(this);
    this.syncSize = this.syncSize.bind(this);
    this.handleVisibility = this.handleVisibility.bind(this);
    this.handlePixelRatio = this.handlePixelRatio.bind(this);
    this.resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(this.syncSize) : null;
    this.resizeObserver?.observe(canvas);
    window.addEventListener("resize", this.syncSize);
    document.addEventListener("visibilitychange", this.handleVisibility);
    this.watchPixelRatio();
    this.syncSize();
  }

  async load(catalog) {
    const requestId = ++this.loadId;
    const extras = catalog.assets.filter((asset) => asset.id.startsWith("cute-")
      && !SPECIES.some((species) => species.id === asset.id));
    const roster = [...SPECIES, ...extras.map((asset) => cuteDefaults(asset.id))];
    this.onStatus(`Loading aquarium · 0 / ${roster.length} fish`);
    const models = await Promise.all(roster.map(async (species, index) => {
      const asset = catalog.assets.find((entry) => entry.id === species.id);
      if (!asset) throw new Error(`Aquarium is missing ${species.id}`);
      const manifest = await fetchJson(versioned(asset.manifest, asset.version));
      const aquarium = { ...asset.aquarium, ...manifest.aquarium };
      const animation = manifest.animations.swim ?? manifest.animations.idle
        ?? manifest.animations.still ?? Object.values(manifest.animations)[0];
      if (!animation?.frames?.length) throw new Error(`${asset.name} has no animation frames`);
      const durations = animation.frames.map((frame) =>
        Math.max(1, frame.durationMs || 1000 / (animation.fps || 12)));
      return {
        ...species, index, asset, manifest,
        aquarium,
        width: Number.isFinite(aquarium.width) ? clamp(aquarium.width, 32, 330) : species.width,
        speed: Number.isFinite(aquarium.speed) ? clamp(aquarium.speed, 12, 55) : species.speed,
        catchable: typeof aquarium.catchable === "boolean" ? aquarium.catchable : Boolean(species.catchable),
        displayName: aquarium.name || manifest.name,
        pack: aquarium.pack || (species.id.startsWith("cute-") ? "cute-fish" : "original"),
        spriteFacing: aquarium.facing === "right" ? 1 : -1,
        frames: animation.frames,
        durations,
        totalDuration: durations.reduce((sum, duration) => sum + duration, 0),
        images: new Map(),
        pending: new Set(animation.frames.map((frame) => frame.page)),
      };
    }));
    const jobs = [];
    for (const model of models) {
      const base = model.asset.manifest.slice(0, model.asset.manifest.lastIndexOf("/") + 1);
      for (const pageId of model.pending) {
        const page = model.manifest.atlases.find((entry) => entry.page === pageId);
        if (!page) throw new Error(`${model.asset.name} is missing atlas ${pageId}`);
        jobs.push({ model, page, path: versioned(base + page.image, model.asset.version) });
      }
    }
    let completed = 0;
    let cursor = 0;
    let failure;
    const worker = async () => {
      while (!failure && cursor < jobs.length && requestId === this.loadId && !this.destroyed) {
        const { model, page, path } = jobs[cursor++];
        try {
          const atlas = await loadAtlas(path, page, this.atlasEdge(model, page));
          model.images.set(page.page, atlas);
          if (page.page === model.frames[0].page && !model.bounds) model.bounds = contentBounds(model);
          model.pending.delete(page.page);
          if (!model.pending.size && requestId === this.loadId && !this.destroyed) {
            completed += 1;
            this.onStatus(`Loading aquarium · ${completed} / ${models.length} fish`);
          }
        } catch (error) {
          failure = error;
        }
      }
    };
    // Decode only two pages at once, at the display resolution each species needs.
    await Promise.all([worker(), worker()]);
    if (failure || requestId !== this.loadId || this.destroyed) {
      this.release(models);
      if (failure) throw failure;
      return;
    }
    this.release(this.models);
    this.models = models;
    for (const model of models) model.bounds = contentBounds(model);
    this.resetCount = 0;
    this.reset();
    this.onStatus("");
    this.onReady(models.length);
    this.schedule();
  }

  reset() {
    this.clock = 0;
    this.cancelFishing("reset");
    const placed = [];
    for (const model of this.models) {
      const bounds = this.swimmingBounds(model);
      let best;
      let bestDistance = -1;
      // Spread the initial group without assigning a depth or lane to a species.
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const point = {
          x: randomBetween(bounds.left, bounds.right),
          y: randomBetween(bounds.top, bounds.bottom),
        };
        const distance = placed.reduce((nearest, other) => Math.min(nearest,
          Math.hypot((point.x - other.x) / 180, (point.y - other.y) / 90)), Infinity);
        if (distance > bestDistance) {
          best = point;
          bestDistance = distance;
        }
      }
      model.x = best.x / Math.max(1, this.width);
      model.y = best.y / Math.max(1, this.height);
      placed.push(best);
      model.direction = Math.random() < 0.5 ? -1 : 1;
      model.turnScale = 1;
      model.pitch = 0;
      model.speedFactor = randomBetween(0.8, 1.2);
      const cruise = model.speed * this.sizeScale() * model.speedFactor;
      model.vx = model.direction * cruise * randomBetween(0.65, 0.95);
      model.vy = cruise * randomBetween(-0.45, 0.45);
      this.chooseTarget(model);
      model.frameIndex = Math.floor(Math.random() * model.frames.length);
      model.elapsed = 0;
    }
    this.resetCount += 1;
    this.lastTime = null;
    this.draw();
  }

  setActive(active) {
    this.active = Boolean(active);
    this.lastTime = null;
    if (this.active) {
      this.syncSize();
      this.schedule();
    } else {
      this.cancelFrame();
    }
  }

  setPlaying(playing) {
    this.playing = Boolean(playing);
    this.lastTime = null;
    if (this.playing) this.schedule();
    else this.cancelFrame();
  }

  setSpeed(speed) {
    const number = Number(speed);
    if (Number.isFinite(number)) this.speed = Math.min(2, Math.max(0.25, number));
  }

  syncSize() {
    if (this.destroyed) return;
    const bounds = this.canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    this.width = bounds.width;
    this.height = bounds.height;
    const ratio = Math.max(0.1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(this.width * ratio));
    const height = Math.max(1, Math.round(this.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.context.setTransform(width / this.width, 0, 0, height / this.height, 0, 0);
    this.context.imageSmoothingEnabled = true;
    this.context.imageSmoothingQuality = "high";
    for (const model of this.models) this.constrainPosition(model);
    if (this.fishing.model && ["nibbling", "biting"].includes(this.fishing.phase)) {
      // Layout changes must keep the mouth attached even while playback is paused.
      this.guideToBait(this.fishing.model, 0);
    } else if (this.fishing.model && ["reeling", "caught"].includes(this.fishing.phase)) {
      this.guideReel(this.fishing.model);
    }
    this.draw();
  }

  watchPixelRatio() {
    this.pixelRatioQuery?.removeEventListener("change", this.handlePixelRatio);
    if (!window.matchMedia) return;
    this.pixelRatioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.pixelRatioQuery.addEventListener("change", this.handlePixelRatio, { once: true });
  }

  handlePixelRatio() {
    this.syncSize();
    this.watchPixelRatio();
  }

  handleVisibility() {
    this.lastTime = null;
    if (document.hidden) this.cancelFrame();
    else this.schedule();
  }

  schedule() {
    if (!this.destroyed && this.active && this.playing && !document.hidden && this.raf === null) {
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  cancelFrame() {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  tick(now) {
    this.raf = null;
    const delta = this.lastTime === null ? 0 : Math.max(0, Math.min(100, now - this.lastTime));
    this.lastTime = now;
    if (this.active && this.playing && !document.hidden) {
      const scaled = delta * this.speed;
      this.clock += scaled / 1000;
      this.updateFishing(scaled / 1000);
      this.advanceSwimmers(scaled / 1000);
      for (const model of this.models) {
        model.elapsed += scaled;
        while (model.elapsed >= model.durations[model.frameIndex]) {
          model.elapsed -= model.durations[model.frameIndex];
          model.frameIndex = (model.frameIndex + 1) % model.frames.length;
        }
      }
    }
    this.draw();
    this.schedule();
  }

  sizeScale() {
    return Math.min(1,
      Math.max(0.55, this.width / 720),
      Math.max(0.55, this.height / 540)) * crowdScale(this.models.length, this.width);
  }

  atlasEdge(model, page) {
    // Cache for the largest layout so resizing a phone-sized preview stays sharp.
    const sizing = sceneSizing(1180, 600);
    const bodyFraction = clamp(model.aquarium.bounds?.w ?? model.bounds?.width ?? 0.8, 0.25, 1);
    const heightFraction = model.aquarium.bounds?.h ?? model.bounds?.height;
    const bodyWidth = Math.min(model.width * sizing.fishScale,
      heightFraction > 0 ? sizing.fishMaxHeight * bodyFraction / heightFraction : Infinity);
    // Retain enough pixels for Retina even when initially opened on a DPR1 monitor.
    const ratio = Math.max(2, window.devicePixelRatio || 1);
    const pageFrames = Math.max(page.size.w / model.manifest.frameSize.w,
      page.size.h / model.manifest.frameSize.h);
    const needed = bodyWidth * ratio / bodyFraction * pageFrames;
    // Canvas supports non-power-of-two textures; avoid wasting a whole larger page.
    return Math.min(ATLAS_EDGE, Math.max(128, Math.ceil(needed / 16) * 16));
  }

  bodyWidth(model) {
    const sizing = sceneSizing(this.width, this.height);
    const aspect = model.bounds.height / model.bounds.width;
    return Math.min(model.width * sizing.fishScale, sizing.fishMaxWidth,
      sizing.fishMaxHeight / aspect);
  }

  get fishingState() {
    const fishing = this.fishing;
    return {
      phase: fishing.phase,
      fishId: fishing.model?.id ?? fishing.fishId ?? null,
      name: fishing.model?.displayName ?? fishing.name ?? null,
      mouth: fishing.model ? this.mouthPosition(fishing.model) : null,
      biteProgress: fishing.phase === "biting" ? clamp(fishing.elapsed / BITE_DURATION, 0, 1) : 0,
      reelProgress: fishing.phase === "reeling" ? clamp(fishing.elapsed / REEL_DURATION, 0, 1)
        : fishing.phase === "caught" ? 1 : 0,
      caughtProgress: fishing.phase === "caught" ? clamp(fishing.elapsed / CAUGHT_DURATION, 0, 1) : 0,
      releaseProgress: fishing.phase === "released" ? clamp(fishing.elapsed / RELEASE_DURATION, 0, 1) : 0,
      catchCount: this.catchCount,
      elapsed: fishing.elapsed,
      reason: fishing.reason ?? null,
    };
  }

  fishingPhase(phase, reason = null) {
    const changed = this.fishing.phase !== phase;
    this.fishing.phase = phase;
    this.fishing.elapsed = 0;
    this.fishing.reason = reason;
    if (changed || reason) this.onFishingEvent(this.fishingState);
  }

  setFishingEnabled(enabled) {
    const next = Boolean(enabled);
    if (this.fishingEnabled === next) return;
    this.fishingEnabled = next;
    this.cancelFishing(next ? "enabled" : "disabled");
    this.draw();
  }

  cancelFishing(reason = "cancelled") {
    const model = this.fishing.model;
    if (model) {
      this.returnFishToWater(model, ["reeling", "caught"].includes(this.fishing.phase));
    }
    this.fishing.model = null;
    this.fishing.fishId = null;
    this.fishing.name = null;
    this.fishing.reelStart = null;
    this.fishing.waitTime = randomBetween(5, 10);
    this.fishingPhase(this.fishingEnabled && reason !== "bait-unavailable" ? "waiting" : "disabled", reason);
  }

  currentBait() {
    const bait = this.getBait({ width: this.width, height: this.height, clock: this.clock });
    return bait?.enabled !== false && Number.isFinite(bait?.x) && Number.isFinite(bait?.y) ? bait : null;
  }

  mouthOffset(model, { direction = model.direction, pitch = model.pitch, turnScale = model.turnScale } = {}) {
    const size = this.bodyWidth(model) / model.bounds.width;
    const localX = ((model.bounds.mouthX ?? model.bounds.centerX - model.bounds.width * 0.46) - model.bounds.centerX)
      * size * (direction === model.spriteFacing ? 1 : -1) * turnScale;
    const localY = ((model.bounds.mouthY ?? model.bounds.centerY) - model.bounds.centerY) * size;
    return { x: Math.cos(pitch) * localX - Math.sin(pitch) * localY,
      y: Math.sin(pitch) * localX + Math.cos(pitch) * localY };
  }

  mouthPosition(model) {
    const offset = this.mouthOffset(model);
    return { x: model.x * this.width + offset.x, y: model.y * this.height + offset.y };
  }

  castBait() {
    if (!this.fishingEnabled || !this.active || !this.playing || document.hidden ||
      ["approaching", "nibbling", "biting", "reeling", "caught"].includes(this.fishing.phase)) return false;
    const bait = this.currentBait();
    const candidates = this.models.filter((model) => model.catchable && model.width <= 160);
    if (!bait || !candidates.length) return false;
    // Vary the visitor while favoring fish already near the lure.
    const ranked = candidates.map((model) => {
      const bounds = this.swimmingBounds(model);
      const preferred = bait.x >= model.x * this.width ? 1 : -1;
      const direction = [preferred, -preferred].find((facing) => {
        const offset = this.mouthOffset(model, { direction: facing, pitch: 0, turnScale: 1 });
        return bait.x - offset.x >= bounds.left && bait.x - offset.x <= bounds.right &&
          bait.y - offset.y >= bounds.top && bait.y - offset.y <= bounds.bottom;
      });
      return { model, direction,
        score: Math.hypot(model.x * this.width - bait.x, model.y * this.height - bait.y) + Math.random() * 180 };
    }).filter((candidate) => candidate.direction).sort((a, b) => a.score - b.score);
    if (!ranked.length) return false;
    this.fishing.model = ranked[0].model;
    this.fishing.fishId = this.fishing.model.id;
    this.fishing.name = this.fishing.model.displayName;
    this.fishing.direction = ranked[0].direction;
    this.fishingPhase("approaching");
    return true;
  }

  reelIn() {
    if (!this.fishingEnabled || !this.active || !this.playing || document.hidden ||
      this.fishing.phase !== "biting" || !this.fishing.model || !this.currentBait()) return false;
    const mouth = this.mouthPosition(this.fishing.model);
    this.fishing.reelStart = { x: mouth.x / this.width, y: mouth.y / this.height };
    this.fishing.reelPitch = this.fishing.model.pitch;
    this.fishingPhase("reeling");
    return true;
  }

  returnFishToWater(model, respawn = false) {
    model.pitch = 0;
    model.turnScale = 1;
    const bounds = this.swimmingBounds(model);
    if (respawn) {
      model.x = randomBetween(bounds.left, Math.max(bounds.left, this.width * 0.55)) / this.width;
      model.y = randomBetween(Math.max(bounds.top, this.height * 0.55), bounds.bottom) / this.height;
    }
    this.constrainPosition(model);
    model.vx = -model.direction * model.speed * this.sizeScale() * 0.8;
    model.vy = randomBetween(-8, 8);
    this.chooseTarget(model);
  }

  guideReel(model) {
    const fishing = this.fishing;
    if (!fishing.reelStart || !this.width || !this.height) return;
    const progress = fishing.phase === "caught" ? 1 : clamp(fishing.elapsed / REEL_DURATION, 0, 1);
    const ease = 1 - (1 - progress) ** 3;
    const supplied = this.getReelTarget({ width: this.width, height: this.height, clock: this.clock });
    const target = Number.isFinite(supplied?.x) && Number.isFinite(supplied?.y)
      ? supplied : { x: this.width * 0.8, y: Math.min(100, this.height * 0.2) };
    const start = { x: fishing.reelStart.x * this.width, y: fishing.reelStart.y * this.height };
    const swing = Math.sin(progress * Math.PI * 5) * Math.sin(progress * Math.PI) * 6;
    const desiredMouth = {
      x: start.x + (target.x - start.x) * ease + swing,
      y: start.y + (target.y - start.y) * ease - Math.sin(progress * Math.PI) * Math.min(44, this.height * 0.1),
    };
    const landedWiggle = fishing.phase === "caught" ? Math.sin(fishing.elapsed * 16) * 0.07 : 0;
    model.pitch = (fishing.reelPitch ?? 0) * (1 - progress)
      - model.direction * Math.sin(progress * Math.PI) * 1.05 + landedWiggle;
    model.turnScale = 1;
    const offset = this.mouthOffset(model);
    const bodyWidth = this.bodyWidth(model);
    const bodyHeight = bodyWidth * model.bounds.height / model.bounds.width;
    const radiusX = Math.abs(Math.cos(model.pitch)) * bodyWidth / 2
      + Math.abs(Math.sin(model.pitch)) * bodyHeight / 2 + 6;
    const radiusY = Math.abs(Math.sin(model.pitch)) * bodyWidth / 2
      + Math.abs(Math.cos(model.pitch)) * bodyHeight / 2 + 6;
    const left = Math.min(this.width / 2, radiusX);
    const top = Math.min(this.height / 2, radiusY);
    // A hooked fish can rise above its normal swimming area, but stays visible.
    model.x = clamp(desiredMouth.x - offset.x, left, Math.max(left, this.width - left)) / this.width;
    model.y = clamp(desiredMouth.y - offset.y, top, Math.max(top, this.height - top)) / this.height;
    model.vx = 0;
    model.vy = 0;
  }

  updateFishing(seconds) {
    if (!this.fishingEnabled) return;
    const bait = this.currentBait();
    if (!bait) {
      if (this.fishing.phase !== "disabled") this.cancelFishing("bait-unavailable");
      return;
    }
    const fishing = this.fishing;
    if (fishing.phase === "disabled") {
      fishing.waitTime = randomBetween(5, 10);
      this.fishingPhase("waiting", "bait-returned");
    }
    fishing.elapsed += seconds;
    if (fishing.phase === "reeling") {
      if (fishing.elapsed >= REEL_DURATION) {
        this.guideReel(fishing.model);
        this.catchCount += 1;
        this.fishingPhase("caught", "landed");
      }
      return;
    }
    if (fishing.phase === "caught") {
      if (fishing.elapsed >= CAUGHT_DURATION) {
        this.returnFishToWater(fishing.model, true);
        fishing.model = null;
        fishing.reelStart = null;
        fishing.waitTime = randomBetween(5, 10);
        this.fishingPhase("waiting", "next-cast");
      }
      return;
    }
    if (fishing.phase === "waiting") {
      if (fishing.elapsed >= fishing.waitTime) this.castBait();
      return;
    }
    if (fishing.phase === "released") {
      if (fishing.elapsed >= RELEASE_DURATION) {
        fishing.waitTime = randomBetween(5, 10);
        this.fishingPhase("waiting");
      }
      return;
    }
    if (fishing.phase === "approaching" && fishing.elapsed >= 18) this.finishBite("timeout");
    else if (fishing.phase === "nibbling" && fishing.elapsed >= 0.7) this.fishingPhase("biting");
    else if (fishing.phase === "biting" && fishing.elapsed >= BITE_DURATION) this.finishBite("released");
  }

  finishBite(reason) {
    const model = this.fishing.model;
    if (model) {
      model.vx = -model.direction * model.speed * this.sizeScale();
      model.vy = randomBetween(-12, 12);
      this.chooseTarget(model);
    }
    this.fishing.model = null;
    this.fishingPhase("released", reason);
  }

  guideToBait(model, seconds) {
    const bait = this.currentBait();
    if (!bait) return false;
    const fishing = this.fishing;
    const bounds = this.swimmingBounds(model);
    const fits = (direction) => {
      const offset = this.mouthOffset(model, { direction, pitch: 0, turnScale: 1 });
      return bait.x - offset.x >= bounds.left && bait.x - offset.x <= bounds.right &&
        bait.y - offset.y >= bounds.top && bait.y - offset.y <= bounds.bottom;
    };
    if (!fits(fishing.direction)) {
      if (!fits(-fishing.direction)) {
        this.finishBite("bait-unreachable");
        return true;
      }
      fishing.direction = -fishing.direction;
      if (fishing.phase !== "approaching") {
        // A narrow layout may only have room on the other side of the bait.
        model.direction = fishing.direction;
        model.turnScale = 1;
      }
    }
    const facing = fishing.direction;
    if (model.direction !== facing) {
      model.turnScale = Math.max(0.2, model.turnScale - seconds * 3.5);
      if (model.turnScale <= 0.2) model.direction = facing;
      model.vx = 0;
      model.vy = 0;
      return true;
    }
    model.turnScale = Math.min(1, model.turnScale + seconds * 3);
    model.direction = facing;
    if (fishing.phase === "approaching") {
      const offset = this.mouthOffset(model);
      const targetX = clamp(bait.x - offset.x, bounds.left, bounds.right);
      const targetY = clamp(bait.y - offset.y, bounds.top, bounds.bottom);
      const dx = targetX - model.x * this.width;
      const dy = targetY - model.y * this.height;
      const distance = Math.hypot(dx, dy);
      const speed = Math.max(80, model.speed * this.sizeScale() * 2.5);
      const travel = Math.min(distance, speed * seconds);
      const oldX = model.x * this.width;
      const oldY = model.y * this.height;
      model.x = (oldX + dx / Math.max(1, distance) * travel) / this.width;
      model.y = (oldY + dy / Math.max(1, distance) * travel) / this.height;
      model.vx = (model.x * this.width - oldX) / Math.max(0.001, seconds);
      model.vy = (model.y * this.height - oldY) / Math.max(0.001, seconds);
      model.pitch += (0 - model.pitch) * (1 - Math.exp(-seconds * 5));
      if (distance < 4 && Math.hypot(this.mouthPosition(model).x - bait.x,
        this.mouthPosition(model).y - bait.y) < 8) this.fishingPhase("nibbling");
    } else {
      model.pitch = Math.sin(this.clock * 15) * (fishing.phase === "biting" ? 0.055 : 0.02);
      const offset = this.mouthOffset(model);
      const tugX = fishing.phase === "biting" ? Math.sin(fishing.elapsed * 20) * 4 : 0;
      const tugY = fishing.phase === "biting" ? Math.sin(fishing.elapsed * 16) * 4 : 0;
      model.x = clamp(bait.x + tugX - offset.x, bounds.left, bounds.right) / this.width;
      model.y = clamp(bait.y + tugY - offset.y, bounds.top, bounds.bottom) / this.height;
      model.vx = 0;
      model.vy = 0;
    }
    return true;
  }

  swimmingBounds(model) {
    const width = this.bodyWidth(model);
    const height = width * model.bounds.height / model.bounds.width;
    // Leave room for a small pitch and the animated fins at every tank edge.
    const horizontal = Math.min(this.width / 2, width * 0.58 + 14);
    const vertical = Math.min(this.height / 2, height / 2 + width * 0.18 + 14);
    return {
      left: horizontal, right: Math.max(horizontal, this.width - horizontal),
      top: vertical, bottom: Math.max(vertical, this.height - vertical),
    };
  }

  chooseTarget(model) {
    const bounds = this.swimmingBounds(model);
    let targetX;
    let targetY;
    // A distant waypoint gives a long, gentle glide rather than tiny jitters.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      targetX = randomBetween(bounds.left, bounds.right);
      targetY = randomBetween(bounds.top, bounds.bottom);
      if (Math.hypot(targetX - model.x * this.width,
        targetY - model.y * this.height) > Math.min(160, this.width * 0.3)) break;
    }
    model.targetX = targetX / Math.max(1, this.width);
    model.targetY = targetY / Math.max(1, this.height);
    model.wanderTime = randomBetween(4, 9);
    model.speedFactor = randomBetween(0.8, 1.2);
  }

  constrainPosition(model) {
    if (!Number.isFinite(model.x) || !Number.isFinite(model.y)) return;
    const bounds = this.swimmingBounds(model);
    model.x = clamp(model.x * this.width, bounds.left, bounds.right) / Math.max(1, this.width);
    model.y = clamp(model.y * this.height, bounds.top, bounds.bottom) / Math.max(1, this.height);
    model.targetX = clamp(model.targetX * this.width, bounds.left, bounds.right) / Math.max(1, this.width);
    model.targetY = clamp(model.targetY * this.height, bounds.top, bounds.bottom) / Math.max(1, this.height);
  }

  advanceSwimmers(seconds) {
    if (!seconds || !this.width || !this.height) return;
    const positions = this.models.map((model) => ({
      x: model.x * this.width, y: model.y * this.height,
      width: this.bodyWidth(model),
      height: this.bodyWidth(model) * model.bounds.height / model.bounds.width,
    }));
    const smooth = 1 - Math.exp(-seconds * 1.35);
    for (const model of this.models) {
      if (model === this.fishing.model && ["reeling", "caught"].includes(this.fishing.phase)) {
        this.guideReel(model);
        continue;
      }
      if (model === this.fishing.model && ["approaching", "nibbling", "biting"].includes(this.fishing.phase)) {
        this.guideToBait(model, seconds);
        continue;
      }
      const point = positions[model.index];
      const bounds = this.swimmingBounds(model);
      model.wanderTime -= seconds;
      let dx = model.targetX * this.width - point.x;
      let dy = model.targetY * this.height - point.y;
      if (model.wanderTime <= 0 || Math.hypot(dx, dy) < 34) {
        this.chooseTarget(model);
        dx = model.targetX * this.width - point.x;
        dy = model.targetY * this.height - point.y;
      }
      const cruise = model.speed * this.sizeScale() * model.speedFactor;
      const distance = Math.max(1, Math.hypot(dx, dy));
      let desiredX = dx / distance * cruise;
      let desiredY = dy / distance * cruise * 0.8;
      // Profile sprites remain readable while climbing and diving on an angle.
      desiredX = (Math.abs(desiredX) < cruise * 0.4)
        ? (dx < 0 ? -1 : 1) * cruise * 0.4 : desiredX;
      desiredY = clamp(desiredY, -cruise * 0.65, cruise * 0.65);

      // Give nearby fish a little room, while allowing the group to cross paths.
      for (const other of this.models) {
        if (other === model) continue;
        const neighbor = positions[other.index];
        const awayX = point.x - neighbor.x;
        const awayY = point.y - neighbor.y;
        const radiusX = (point.width + neighbor.width) * 0.45 + 16;
        const radiusY = (point.height + neighbor.height) * 0.5 + 18;
        const proximity = Math.hypot(awayX / radiusX, awayY / radiusY);
        if (proximity < 1.25) {
          const strength = (1.25 - proximity) * cruise * 0.65;
          const length = Math.max(1, Math.hypot(awayX, awayY));
          desiredX += awayX / length * strength;
          desiredY += awayY / length * strength;
        }
      }

      const wallZone = Math.min(70, Math.max(25, point.width * 0.45));
      if (point.x < bounds.left + wallZone) desiredX += cruise * (1 - (point.x - bounds.left) / wallZone) * 2;
      if (point.x > bounds.right - wallZone) desiredX -= cruise * (1 - (bounds.right - point.x) / wallZone) * 2;
      if (point.y < bounds.top + wallZone) desiredY += cruise * (1 - (point.y - bounds.top) / wallZone);
      if (point.y > bounds.bottom - wallZone) desiredY -= cruise * (1 - (bounds.bottom - point.y) / wallZone);
      model.vx += (desiredX - model.vx) * smooth;
      model.vy += (clamp(desiredY, -cruise * 0.75, cruise * 0.75) - model.vy) * smooth;
      const nextX = point.x + model.vx * seconds;
      const nextY = point.y + model.vy * seconds;
      if (nextX < bounds.left || nextX > bounds.right) {
        model.vx = (nextX < bounds.left ? 1 : -1) * Math.max(cruise * 0.35, Math.abs(model.vx) * 0.5);
        this.chooseTarget(model);
      }
      if (nextY < bounds.top || nextY > bounds.bottom) {
        model.vy = (nextY < bounds.top ? 1 : -1) * Math.max(cruise * 0.2, Math.abs(model.vy) * 0.5);
        this.chooseTarget(model);
      }
      model.x = clamp(nextX, bounds.left, bounds.right) / this.width;
      model.y = clamp(nextY, bounds.top, bounds.bottom) / this.height;

      const facing = Math.abs(model.vx) > cruise * 0.12
        ? (model.vx > 0 ? 1 : -1) : model.direction;
      if (facing !== model.direction) {
        model.turnScale = Math.max(0.2, model.turnScale - seconds * 3.5);
        if (model.turnScale <= 0.2) model.direction = facing;
      } else model.turnScale = Math.min(1, model.turnScale + seconds * 2.5);
      const pitch = clamp(Math.atan2(model.vy, Math.max(cruise * 0.4, Math.abs(model.vx))), -0.3, 0.3) * model.direction;
      model.pitch += (pitch - model.pitch) * (1 - Math.exp(-seconds * 4));
    }
  }

  draw() {
    if (!this.width || !this.height || this.destroyed) return;
    const context = this.context;
    context.clearRect(0, 0, this.width, this.height);
    for (const model of this.models) {
      const frame = model.frames[model.frameIndex];
      const atlas = model.images.get(frame.page);
      const rect = frame.frame;
      const bodyWidth = this.bodyWidth(model);
      const size = bodyWidth / model.bounds.width;
      context.save();
      context.translate(model.x * this.width, model.y * this.height);
      context.rotate(model.pitch);
      // Respect authored facing while keeping the nose in the travel direction.
      context.scale((model.direction === model.spriteFacing ? 1 : -1) * model.turnScale, 1);
      context.drawImage(atlas.image,
        rect.x * atlas.scaleX, rect.y * atlas.scaleY,
        rect.w * atlas.scaleX, rect.h * atlas.scaleY,
        -size * model.bounds.centerX, -size * model.bounds.centerY,
        size, size * model.manifest.frameSize.h / model.manifest.frameSize.w);
      context.restore();
    }
    this.drawOverlay(context, { width: this.width, height: this.height, clock: this.clock,
      fishing: this.fishingState });
  }

  release(models) {
    for (const model of models) {
      for (const atlas of model.images.values()) atlas.image.close?.();
      model.images.clear();
    }
  }

  destroy() {
    this.destroyed = true;
    this.fishingEnabled = false;
    this.cancelFishing("destroyed");
    this.loadId += 1;
    this.cancelFrame();
    this.resizeObserver?.disconnect();
    window.removeEventListener("resize", this.syncSize);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    this.pixelRatioQuery?.removeEventListener("change", this.handlePixelRatio);
    this.release(this.models);
    this.models = [];
  }
}
