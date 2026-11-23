const SPECIES = [
  { id: "dolphin", width: 200, speed: 36 },
  { id: "fish1", width: 155, speed: 28 },
  { id: "fish2", width: 150, speed: 34 },
  { id: "fish3", width: 160, speed: 25 },
  { id: "manta-ray", width: 200, speed: 22 },
  { id: "shark", width: 235, speed: 43 },
  { id: "whale", width: 240, speed: 20 },
];

const START_X = [0.16, 0.72, 0.36, 0.84, 0.25, 0.66, 0.43];
const ATLAS_EDGE = 1024;

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
  constructor(canvas, { onStatus = () => {}, onReady = () => {} } = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.onStatus = onStatus;
    this.onReady = onReady;
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
    for (const model of this.models) {
      const variant = this.resetCount % 2;
      model.position = variant ? 1 - START_X[model.index] : START_X[model.index];
      model.direction = (model.index + variant) % 2 ? 1 : -1;
      model.frameIndex = Math.floor(model.frames.length * ((model.index * 0.173) % 1));
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
      const scale = this.sizeScale();
      for (const model of this.models) {
        const travel = Math.max(1, this.width - this.bodyWidth(model) - 32);
        model.position += model.direction * model.speed * scale * (scaled / 1000) / travel;
        if (model.position > 1) {
          model.position = 2 - model.position;
          model.direction = -1;
        } else if (model.position < 0) {
          model.position = -model.position;
          model.direction = 1;
        }
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

  draw() {
    if (!this.width || !this.height || this.destroyed) return;
    const context = this.context;
    context.clearRect(0, 0, this.width, this.height);
    const scale = this.sizeScale();
    for (const model of this.models) {
      const frame = model.frames[model.frameIndex];
      const atlas = model.images.get(frame.page);
      const rect = frame.frame;
      const bodyWidth = this.bodyWidth(model);
      const size = bodyWidth / model.bounds.width;
      const bodyHeight = size * model.bounds.height;
      const margin = bodyWidth / 2 + 16;
      const x = margin + Math.max(0, this.width - margin * 2) * model.position;
      const lane = 0.13 + model.index * 0.12;
      const bob = Math.sin(this.clock * (0.55 + model.index * 0.07) + model.index * 1.8) * 6 * scale;
      const padding = bodyHeight / 2 + 12;
      const y = Math.max(padding, Math.min(this.height - padding, this.height * lane + bob));
      context.save();
      context.translate(x, y);
      // Authored +X profiles face left; a positive travel direction faces right.
      if (model.direction > 0) context.scale(-1, 1);
      context.drawImage(atlas.image,
        rect.x * atlas.scaleX, rect.y * atlas.scaleY,
        rect.w * atlas.scaleX, rect.h * atlas.scaleY,
        -size * model.bounds.centerX, -size * model.bounds.centerY,
        size, size * model.manifest.frameSize.h / model.manifest.frameSize.w);
      context.restore();
    }
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
