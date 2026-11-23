const SPECIES = [
  { id: "dolphin", width: 200, speed: 36 },
  { id: "fish1", width: 155, speed: 28 },
  { id: "fish2", width: 150, speed: 34 },
  { id: "fish3", width: 160, speed: 25 },
  { id: "manta-ray", width: 200, speed: 22 },
  { id: "shark", width: 235, speed: 43 },
  { id: "whale", width: 240, speed: 20 },
];

const ATLAS_EDGE = 1024;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const randomBetween = (min, max) => min + Math.random() * (max - min);

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

async function loadAtlas(path, page) {
  const scale = Math.min(1, ATLAS_EDGE / Math.max(page.size.w, page.size.h));
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
      if (image.width <= ATLAS_EDGE && image.height <= ATLAS_EDGE) {
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
  const fallback = { centerX: 0.5, centerY: 0.6, width: 0.86, height: 0.48 };
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
    return {
      centerX: (left + right) / 256,
      centerY: (top + bottom) / 256,
      width: (right - left) / 128,
      height: (bottom - top) / 128,
    };
  } catch (error) {
    return fallback;
  }
}

export class Aquarium {
  constructor(canvas, { onStatus = () => {}, onReady = () => {}, drawOverlay = () => {} } = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.onStatus = onStatus;
    this.onReady = onReady;
    this.drawOverlay = drawOverlay;
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
    this.onStatus("Loading aquarium · 0 / 7 fish");
    const models = await Promise.all(SPECIES.map(async (species, index) => {
      const asset = catalog.assets.find((entry) => entry.id === species.id);
      if (!asset) throw new Error(`Aquarium is missing ${species.id}`);
      const manifest = await fetchJson(versioned(asset.manifest, asset.version));
      const animation = manifest.animations.swim;
      if (!animation?.frames?.length) throw new Error(`${asset.name} has no swim animation`);
      const durations = animation.frames.map((frame) =>
        Math.max(1, frame.durationMs || 1000 / (animation.fps || 12)));
      return {
        ...species, index, asset, manifest,
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
          const atlas = await loadAtlas(path, page);
          model.images.set(page.page, atlas);
          model.pending.delete(page.page);
          if (!model.pending.size && requestId === this.loadId && !this.destroyed) {
            completed += 1;
            this.onStatus(`Loading aquarium · ${completed} / 7 fish`);
          }
        } catch (error) {
          failure = error;
        }
      }
    };
    // Keep temporary decodes bounded and retain only <=1024px atlas bitmaps.
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
      Math.max(0.55, this.height / 540));
  }

  bodyWidth(model) {
    return Math.min(model.width * this.sizeScale(), this.width * 0.58);
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
      // Authored +X profiles face left; a positive travel direction faces right.
      context.scale((model.direction > 0 ? -1 : 1) * model.turnScale, 1);
      context.drawImage(atlas.image,
        rect.x * atlas.scaleX, rect.y * atlas.scaleY,
        rect.w * atlas.scaleX, rect.h * atlas.scaleY,
        -size * model.bounds.centerX, -size * model.bounds.centerY,
        size, size * model.manifest.frameSize.h / model.manifest.frameSize.w);
      context.restore();
    }
    this.drawOverlay(context, { width: this.width, height: this.height, clock: this.clock });
  }

  release(models) {
    for (const model of models) {
      for (const atlas of model.images.values()) atlas.image.close?.();
      model.images.clear();
    }
  }

  destroy() {
    this.destroyed = true;
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
