function versioned(path, version) {
  return version ? `${path}?v=${encodeURIComponent(version)}` : path;
}

async function texture(path, page) {
  const scale = Math.min(1, 1024 / Math.max(page.size.w, page.size.h));
  const width = Math.round(page.size.w * scale);
  const height = Math.round(page.size.h * scale);
  let image;
  if (typeof createImageBitmap === "function") {
    const response = await fetch(path, { cache: "force-cache" });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    try {
      image = await createImageBitmap(await response.blob(), {
        resizeWidth: width, resizeHeight: height, resizeQuality: "high",
      });
    } catch {
      // Fall back to the ordinary decoder on browsers without bitmap resizing.
    }
  }
  image ??= await new Promise((resolve, reject) => {
    const source = new Image();
    source.onload = () => resolve(source);
    source.onerror = () => reject(new Error(`Could not load ${path}`));
    source.src = path;
  });
  if (image.width > width || image.height > height) {
    const reduced = document.createElement("canvas");
    reduced.width = width;
    reduced.height = height;
    const context = reduced.getContext("2d");
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, width, height);
    image.close?.();
    if (typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement) image.src = "";
    image = reduced;
  }
  return { image, scaleX: image.width / page.size.w, scaleY: image.height / page.size.h };
}

function release(model) {
  if (model) for (const atlas of model.images.values()) atlas.image.close?.();
}

async function loadModel(asset) {
  if (!asset) return null;
  const response = await fetch(versioned(asset.manifest, asset.version), { cache: "no-cache" });
  if (!response.ok) throw new Error(`${asset.manifest}: HTTP ${response.status}`);
  const manifest = await response.json();
  const animation = manifest.animations.idle ?? Object.values(manifest.animations)[0];
  if (!animation?.frames?.length) throw new Error(`${asset.name} has no frames`);
  const base = asset.manifest.slice(0, asset.manifest.lastIndexOf("/") + 1);
  const pages = manifest.atlases.filter((page) => animation.frames.some((frame) => frame.page === page.page));
  const results = await Promise.allSettled(pages.map(async (page) => [page.page,
    await texture(versioned(base + page.image, asset.version), page)]));
  const images = new Map(results.filter((result) => result.status === "fulfilled").map((result) => result.value));
  const failed = results.find((result) => result.status === "rejected");
  if (failed) {
    release({ images });
    throw failed.reason;
  }
  return { manifest, frames: animation.frames, images };
}

function drawSprite(context, model, frame, x, y, width, height, crop = frame.frame) {
  const atlas = model.images.get(frame.page);
  context.drawImage(atlas.image,
    crop.x * atlas.scaleX, crop.y * atlas.scaleY,
    crop.w * atlas.scaleX, crop.h * atlas.scaleY,
    x, y, width, height);
}

function idleFrame(model, clock) {
  const durations = model.frames.map((frame) => frame.durationMs || 100);
  let elapsed = (clock * 1000) % durations.reduce((sum, duration) => sum + duration, 0);
  for (let index = 0; index < durations.length; index += 1) {
    if (elapsed < durations[index]) return model.frames[index];
    elapsed -= durations[index];
  }
  return model.frames[0];
}

export class FishingRig {
  constructor() {
    this.boy = null;
    this.rod = null;
    this.boyPromise = null;
    this.requestId = 0;
  }

  async load(catalog, rodId) {
    const requestId = ++this.requestId;
    const boyAsset = catalog.assets.find((asset) => asset.id === "red-hat-boy");
    const rodAsset = catalog.assets.find((asset) => asset.id === rodId);
    if (!boyAsset) throw new Error("The asset catalog is missing Red Hat Boy");
    if (rodId && !rodAsset) throw new Error(`The asset catalog is missing ${rodId}`);
    this.boyPromise ??= loadModel(boyAsset)
      .catch((error) => { this.boyPromise = null; throw error; });
    let rod;
    try {
      const results = await Promise.allSettled([this.boyPromise, loadModel(rodAsset)]);
      rod = results[1].status === "fulfilled" ? results[1].value : null;
      const failure = results.find((result) => result.status === "rejected");
      if (failure) throw failure.reason;
      const boy = results[0].value;
      if (requestId !== this.requestId) {
        release(rod);
        return false;
      }
      release(this.rod);
      this.boy = boy;
      this.rod = rod;
      return true;
    } catch (error) {
      release(rod);
      if (requestId !== this.requestId) return false;
      throw error;
    }
  }

  draw(context, { width, height, clock }) {
    if (!this.boy || !width || !height) return;
    const boy = this.boy;
    const frame = idleFrame(boy, clock);
    const feet = frame.anchors.feet;
    const grip = frame.anchors.grip;
    const bodyHeight = Math.min(124, Math.max(96, width * 0.11));
    const boyScale = bodyHeight / frame.bounds.h;
    const dockWidth = Math.min(180, Math.max(108, width * 0.16));
    const feetX = width - dockWidth * 0.42;
    const feetY = Math.min(150, Math.max(124, height * 0.29));
    const direction = boy.manifest.anchorFacing === "right" ? -1 : 1;
    const handX = feetX + direction * (grip.x - feet.x) * boyScale;
    const handY = feetY + (grip.y - feet.y) * boyScale;

    context.save();
    // A small pier places the fisherman above the water rather than in it.
    context.fillStyle = "#654b3e";
    context.fillRect(width - dockWidth + 14, feetY + 10, 10, 43);
    context.fillRect(width - 28, feetY + 10, 10, 43);
    context.fillStyle = "#b77c4f";
    context.fillRect(width - dockWidth, feetY, dockWidth, 13);
    context.fillStyle = "#dfab73";
    context.fillRect(width - dockWidth, feetY, dockWidth, 3);
    context.strokeStyle = "#7f543d";
    context.lineWidth = 1;
    for (let x = width - dockWidth + 24; x < width; x += 28) {
      context.beginPath(); context.moveTo(x, feetY + 3); context.lineTo(x, feetY + 12); context.stroke();
    }

    context.save();
    context.translate(feetX, feetY);
    context.scale(direction, 1);
    drawSprite(context, boy, frame, -feet.x * boyScale, -feet.y * boyScale,
      boy.manifest.frameSize.w * boyScale, boy.manifest.frameSize.h * boyScale);
    context.restore();

    if (this.rod) {
      const rod = this.rod;
      const prop = rod.manifest.prop;
      const rodWidth = rod.manifest.frameSize.w;
      const rodHeight = rod.manifest.frameSize.h;
      const rodGrip = {
        x: prop.handle.x + (prop.tip.x - prop.handle.x) * 0.095,
        y: prop.handle.y + (prop.tip.y - prop.handle.y) * 0.095,
      };
      const dx = (prop.tip.x - rodGrip.x) * rodWidth;
      const dy = (prop.tip.y - rodGrip.y) * rodHeight;
      const length = Math.min(285, Math.max(150, width * 0.24));
      const angle = Math.PI + 0.27 + Math.sin(clock * 0.8) * 0.012;
      const rotation = angle - Math.atan2(dy, dx);
      const scale = length / Math.hypot(dx, dy);
      const tipX = handX + Math.cos(angle) * length;
      const tipY = handY + Math.sin(angle) * length;
      const hookX = tipX - 5 + Math.sin(clock * 0.8) * 7;
      const hookY = Math.max(tipY + 80, height * 0.6) + Math.sin(clock * 1.3) * 4;
      context.strokeStyle = "#d4ecedb8";
      context.lineWidth = 1.2;
      context.beginPath();
      context.moveTo(tipX, tipY);
      context.quadraticCurveTo(tipX + 10, (tipY + hookY) / 2, hookX, hookY);
      context.stroke();
      context.strokeStyle = "#eff6f8";
      context.lineWidth = 1.8;
      context.beginPath();
      context.moveTo(hookX, hookY);
      context.lineTo(hookX, hookY + 8);
      context.arc(hookX - 4, hookY + 8, 4, 0, Math.PI);
      context.stroke();
      context.save();
      context.translate(handX, handY);
      context.rotate(rotation);
      drawSprite(context, rod, rod.frames[0], -rodGrip.x * rodWidth * scale,
        -rodGrip.y * rodHeight * scale, rodWidth * scale, rodHeight * scale);
      context.restore();

      // Redraw just the supplied palm over the grip so he holds the rod.
      const palm = { x: frame.frame.x + grip.x - 12, y: frame.frame.y + grip.y - 10, w: 24, h: 22 };
      context.save();
      context.translate(feetX, feetY);
      context.scale(direction, 1);
      drawSprite(context, boy, frame, (grip.x - 12 - feet.x) * boyScale,
        (grip.y - 10 - feet.y) * boyScale, 24 * boyScale, 22 * boyScale, palm);
      context.restore();
    }
    context.restore();
  }
}
