import { sceneSizing } from "./scene-sizing.js?v=scene-ratio-1";

const BAKED_ARM_RIGS = new Set(["fishing-two-bone-v1", "fishing-native-art-v1"]);

function versioned(path, version) {
  return version ? `${path}?v=${encodeURIComponent(version)}` : path;
}

function cancelledModelLoad() {
  return new DOMException("Character loading was cancelled", "AbortError");
}

function releaseTexture(image) {
  if (typeof image?.close === "function") image.close();
  else if (image && "src" in image) image.src = "";
  else if (image) image.width = image.height = 0;
}

async function texture(path, page, edge = 1024, signal) {
  if (signal?.aborted) throw cancelledModelLoad();
  const scale = Math.min(1, edge / Math.max(page.size.w, page.size.h));
  const width = Math.round(page.size.w * scale);
  const height = Math.round(page.size.h * scale);
  let image;
  if (typeof createImageBitmap === "function") {
    const response = await fetch(path, { cache: "force-cache", signal });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    const blob = await response.blob();
    if (signal?.aborted) throw cancelledModelLoad();
    try {
      image = await createImageBitmap(blob, {
        resizeWidth: width, resizeHeight: height, resizeQuality: "high",
      });
    } catch (error) {
      if (signal?.aborted) throw cancelledModelLoad();
      // Fall back to the ordinary decoder on browsers without bitmap resizing.
    }
  }
  image ??= await new Promise((resolve, reject) => {
    const source = new Image();
    const clean = () => {
      source.onload = source.onerror = null;
      signal?.removeEventListener("abort", cancel);
    };
    const cancel = () => {
      clean(); source.src = ""; reject(cancelledModelLoad());
    };
    source.onload = () => { clean(); resolve(source); };
    source.onerror = () => { clean(); source.src = ""; reject(new Error(`Could not load ${path}`)); };
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    else source.src = path;
  });
  if (signal?.aborted) {
    releaseTexture(image);
    throw cancelledModelLoad();
  }
  if (image.width > width || image.height > height) {
    const reduced = document.createElement("canvas");
    reduced.width = width;
    reduced.height = height;
    try {
      const context = reduced.getContext("2d");
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, width, height);
    } finally {
      releaseTexture(image);
    }
    image = reduced;
  }
  return { image, scaleX: image.width / page.size.w, scaleY: image.height / page.size.h };
}

function release(model) {
  if (model) for (const atlas of model.images.values()) releaseTexture(atlas.image);
  if (model?.handTexture) releaseTexture(model.handTexture.image);
}

async function loadModel(asset, edge = 1024, signal) {
  if (!asset) return null;
  const response = await fetch(versioned(asset.manifest, asset.version), { cache: "no-cache", signal });
  if (!response.ok) throw new Error(`${asset.manifest}: HTTP ${response.status}`);
  const manifest = await response.json();
  if (signal?.aborted) throw cancelledModelLoad();
  const animation = manifest.animations.idle ?? Object.values(manifest.animations)[0];
  if (!animation?.frames?.length) throw new Error(`${asset.name} has no frames`);
  const base = asset.manifest.slice(0, asset.manifest.lastIndexOf("/") + 1);
  const frames = Object.values(manifest.animations).flatMap((clip) => clip.frames);
  const pages = manifest.atlases.filter((page) => frames.some((frame) => frame.page === page.page));
  const hand = manifest.handLayer;
  if (hand && (!hand.image || !(hand.size?.w > 0 && hand.size?.h > 0))) {
    throw new Error(`${asset.name} has invalid native hand metadata`);
  }
  if (hand?.overlayBounds) {
    const { x, y, w, h } = hand.overlayBounds;
    if (![x, y, w, h].every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0
        || x + w > hand.size.w || y + h > hand.size.h) {
      throw new Error(`${asset.name} has invalid native hand overlay bounds`);
    }
  }
  const loads = pages.map(async (page) => [page.page,
    await texture(versioned(base + page.image, asset.version), page, edge, signal)]);
  if (manifest.handLayer) {
    loads.push(texture(versioned(base + hand.image, asset.version), hand,
      Math.max(hand.size.w, hand.size.h), signal).then((image) => ["hand", image]));
  }
  const results = await Promise.allSettled(loads);
  const loaded = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
  const images = new Map(loaded.filter(([pageId]) => pageId !== "hand"));
  const handTexture = loaded.find(([pageId]) => pageId === "hand")?.[1];
  const failed = results.find((result) => result.status === "rejected");
  if (failed) {
    release({ images, handTexture });
    throw failed.reason;
  }
  return { manifest, frames: animation.frames, images, handTexture,
    referenceHeight: Math.max(...frames.map((frame) => frame.bounds?.h || manifest.frameSize.h)) };
}

function drawSprite(context, model, frame, x, y, width, height, crop = frame.frame) {
  const atlas = model.images.get(frame.page);
  context.drawImage(atlas.image,
    crop.x * atlas.scaleX, crop.y * atlas.scaleY,
    crop.w * atlas.scaleX, crop.h * atlas.scaleY,
    x, y, width, height);
}

function drawRod(context, geometry, part = "full") {
  const { rod, rodWidth, rodHeight, rodGrip, rotation, scale, bendSource, handX, handY } = geometry;
  const sourceFrame = rod.frames[0].frame;
  const gripRow = Math.max(0, Math.min(rodHeight, rodGrip.y * rodHeight));
  const start = part === "butt" ? gripRow : 0;
  const end = part === "shaft" ? gripRow : rodHeight;
  if (end <= start) return;
  context.save();
  context.translate(handX, handY);
  context.rotate(rotation);
  if (bendSource > 0.5) {
    const span = Math.max(1, (rodGrip.y - rod.manifest.prop.tip.y) * rodHeight);
    const step = rodHeight / 64;
    for (let y = start; y < end; y += step) {
      const stripHeight = Math.min(step + 1, end - y);
      const distance = y + stripHeight >= rodGrip.y * rodHeight ? 0
        : Math.max(0, Math.min(1, (rodGrip.y * rodHeight - y) / span));
      const offset = -bendSource * distance * distance;
      const crop = { x: sourceFrame.x, y: sourceFrame.y + y, w: rodWidth, h: stripHeight };
      drawSprite(context, rod, rod.frames[0], (-rodGrip.x * rodWidth + offset) * scale,
        (y - rodGrip.y * rodHeight) * scale, rodWidth * scale, stripHeight * scale, crop);
    }
  } else {
    const crop = { x: sourceFrame.x, y: sourceFrame.y + start, w: rodWidth, h: end - start };
    drawSprite(context, rod, rod.frames[0], -rodGrip.x * rodWidth * scale,
      (start - rodGrip.y * rodHeight) * scale, rodWidth * scale, (end - start) * scale, crop);
  }
  context.restore();
}

function drawNativeHand(context, geometry) {
  const { actor, frame, feet, feetX, feetY, direction, actorScale, actorRotation, actorStretch } = geometry;
  const layer = actor.manifest.handLayer;
  const image = actor.handTexture.image;
  context.save();
  context.translate(feetX, feetY);
  context.rotate(actorRotation);
  context.scale(direction * actorScale, actorStretch * actorScale);
  context.translate(-feet.x, -feet.y);
  context.transform(...frame.handTransform);
  if (layer.overlayBounds) {
    const { x, y, w, h } = layer.overlayBounds;
    context.beginPath();
    context.rect(x, y, w, h);
    context.clip();
  }
  context.drawImage(image, 0, 0, image.width, image.height, 0, 0, layer.size.w, layer.size.h);
  context.restore();
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

function actorFrame(model, clock, fishing) {
  const animations = model.manifest.animations;
  const phase = fishing?.phase;
  if (phase === "biting" && animations.bite?.frames?.length) {
    const clip = animations.bite;
    const elapsed = Math.max(0, fishing.elapsed ?? (fishing.biteProgress ?? 0) * 3);
    const duration = clip.frames.reduce((total, frame) => total + (frame.durationMs || 1000 / clip.fps), 0);
    let remaining = (elapsed * 1000) % duration;
    for (const frame of clip.frames) {
      const hold = frame.durationMs || 1000 / clip.fps;
      if (remaining < hold) return frame;
      remaining -= hold;
    }
    return clip.frames[0];
  }
  const clip = phase === "caught" ? animations.celebrate ?? animations.pull
    : phase === "reeling" ? animations.pull
    : phase === "released" ? animations.miss : null;
  if (clip?.frames?.length) {
    const progress = phase === "caught"
      ? animations.celebrate ? clamp01(fishing.caughtProgress ?? 0) : 1
      : phase === "released" ? clamp01(fishing.releaseProgress ?? (fishing.elapsed ?? 0) / 1.6)
      : clamp01(fishing.reelProgress ?? 0);
    return clip.frames[Math.min(clip.frames.length - 1, Math.floor(progress * clip.frames.length))];
  }
  return idleFrame(model, clock);
}

function actorEnvelope(model, scale, direction, maximumLean) {
  const key = `${scale}:${direction}:${maximumLean}`;
  if (model.layoutEnvelope?.key === key) return model.layoutEnvelope;
  const envelope = { key, left: Infinity, right: -Infinity, top: Infinity };
  for (const clip of Object.values(model.manifest.animations)) {
    for (const frame of clip.frames) {
      const bounds = frame.bounds ?? { x: 0, y: 0, ...model.manifest.frameSize };
      const feet = frame.anchors.feet;
      for (const angle of [-0.055, 0, maximumLean + 0.02]) {
        for (const x of [bounds.x, bounds.x + bounds.w]) {
          for (const y of [bounds.y, bounds.y + bounds.h]) {
            const dx = direction * (x - feet.x) * scale;
            const dy = (y - feet.y) * scale;
            const px = Math.cos(angle) * dx - Math.sin(angle) * dy;
            const py = Math.sin(angle) * dx + Math.cos(angle) * dy;
            envelope.left = Math.min(envelope.left, px);
            envelope.right = Math.max(envelope.right, px);
            envelope.top = Math.min(envelope.top, py);
          }
        }
      }
    }
  }
  model.layoutEnvelope = envelope;
  return envelope;
}

const clamp01 = (value) => Math.max(0, Math.min(1, value));
function easeBetween(start, end, value) {
  const progress = clamp01((value - start) / (end - start));
  return progress * progress * (3 - 2 * progress);
}

function drawCatReaction(context, geometry, scene) {
  if (!geometry.biting && !geometry.caught && !geometry.released) return;
  const { frame, feet, feetX, feetY, actorScale, actorRotation, actorStretch, direction } = geometry;
  const head = frame.anchors.head ?? { x: 268, y: 194 };
  const dx = direction * (head.x - feet.x) * actorScale;
  const dy = (head.y - feet.y) * actorScale * actorStretch;
  const headX = feetX + Math.cos(actorRotation) * dx - Math.sin(actorRotation) * dy;
  const headY = feetY + Math.sin(actorRotation) * dx + Math.cos(actorRotation) * dy;
  const accentScale = geometry.actorHeight / 112;
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  if (geometry.biting) {
    const elapsed = scene.fishing?.elapsed ?? (scene.fishing?.biteProgress ?? 0) * 3;
    const x = headX - 48 * accentScale;
    const y = Math.max(14, headY - 18 * accentScale - Math.sin(elapsed * 9) * 2);
    context.fillStyle = "#fff1c9";
    context.strokeStyle = "#64352f";
    context.lineWidth = 1.5;
    context.beginPath(); context.arc(x, y, 10, 0, Math.PI * 2); context.fill(); context.stroke();
    context.lineWidth = 2.5;
    context.beginPath(); context.moveTo(x, y - 5); context.lineTo(x, y + 1); context.stroke();
    context.fillStyle = "#64352f";
    context.beginPath(); context.arc(x, y + 5, 1.4, 0, Math.PI * 2); context.fill();
  } else if (geometry.caught) {
    const progress = geometry.caughtProgress;
    const opacity = Math.sin(progress * Math.PI);
    const spots = [[-47, -27], [-27, -43], [-5, -39], [-55, 0], [-37, 20]];
    for (let index = 0; index < spots.length; index += 1) {
      const [sx, sy] = spots[index];
      const x = Math.max(8, Math.min(scene.width - 8, headX + sx * accentScale - progress * 9));
      const y = Math.max(8, headY + sy * accentScale - progress * 12);
      const radius = 3 + Math.sin(progress * Math.PI * 2 + index) ** 2 * 2;
      context.fillStyle = index % 2 ? `rgba(255, 156, 158, ${opacity})` : `rgba(255, 218, 108, ${opacity})`;
      context.strokeStyle = `rgba(111, 62, 42, ${opacity * 0.65})`;
      context.lineWidth = 0.8;
      context.beginPath();
      context.moveTo(x, y - radius);
      context.lineTo(x + radius * 0.3, y - radius * 0.3);
      context.lineTo(x + radius, y);
      context.lineTo(x + radius * 0.3, y + radius * 0.3);
      context.lineTo(x, y + radius);
      context.lineTo(x - radius * 0.3, y + radius * 0.3);
      context.lineTo(x - radius, y);
      context.lineTo(x - radius * 0.3, y - radius * 0.3);
      context.closePath(); context.fill(); context.stroke();
    }
  } else {
    const progress = geometry.releaseProgress;
    const opacity = 0.8 * (1 - easeBetween(0.6, 1, progress));
    context.fillStyle = `rgba(235, 249, 250, ${opacity})`;
    context.strokeStyle = `rgba(87, 119, 127, ${opacity})`;
    context.lineWidth = 0.7;
    // A soft trailing sigh accompanies the lowered head, then fades away.
    for (let index = 0; index < 3; index += 1) {
      const x = headX - 43 * accentScale - index * 7 - progress * 4;
      const y = headY + 5 - progress * 8;
      context.beginPath(); context.arc(x, y, 1.5, 0, Math.PI * 2); context.fill(); context.stroke();
    }
  }
  context.restore();
}

export class FishingRig {
  constructor() {
    this.actor = null;
    this.rod = null;
    this.lure = null;
    this.lureRequestId = 0;
    this.actorRequestId = 0;
    this.actorController = null;
    this.actorAssetId = null;
    this.actorVersion = null;
    this.requestId = 0;
  }

  async loadActor(catalog, actorId = "fishing-cat") {
    const requestId = ++this.actorRequestId;
    this.actorController?.abort();
    const controller = new AbortController();
    this.actorController = controller;
    const asset = catalog.assets.find((entry) => entry.id === actorId);
    if (!asset) throw new Error(`The asset catalog is missing ${actorId}`);
    if (this.actor && this.actorAssetId === actorId && this.actorVersion === asset.version) {
      this.actorController = null;
      return true;
    }
    let model;
    try {
      model = await loadModel(asset, 2048, controller.signal);
      const articulatedArm = BAKED_ARM_RIGS.has(model.manifest.armRig?.id);
      if (articulatedArm && (!Number.isFinite(model.manifest.armRig.restHandAngle)
          || !["upper", "forearm"].every((name) => Number.isFinite(model.manifest.armRig.lengths?.[name])
            && model.manifest.armRig.lengths[name] > 0))) {
        throw new Error(`${asset.name} has invalid articulated arm metadata`);
      }
      for (const clip of Object.values(model.manifest.animations)) {
        for (const frame of clip.frames) {
          if (!["feet", "grip", "head"].every((name) =>
            Number.isFinite(frame.anchors?.[name]?.x) && Number.isFinite(frame.anchors?.[name]?.y))) {
            throw new Error(`${asset.name} is missing measured fishing anchors`);
          }
          if (model.manifest.handLayer && (!Array.isArray(frame.handTransform)
              || frame.handTransform.length !== 6 || !frame.handTransform.every(Number.isFinite))) {
            throw new Error(`${asset.name} is missing native hand transforms`);
          }
          if (articulatedArm && (!["shoulder", "elbow", "wrist", "grip"].every((name) =>
            Number.isFinite(frame.arm?.[name]?.x) && Number.isFinite(frame.arm?.[name]?.y))
              || !["upperAngle", "forearmAngle", "handAngle"].every((name) => Number.isFinite(frame.arm?.[name]))
              || Math.hypot(frame.arm.grip.x - frame.anchors.grip.x,
                frame.arm.grip.y - frame.anchors.grip.y) > 0.25)) {
            throw new Error(`${asset.name} has invalid articulated arm anchors`);
          }
        }
      }
      if (requestId !== this.actorRequestId || controller.signal.aborted) {
        release(model);
        return false;
      }
      const previous = this.actor;
      this.actor = model;
      this.actorAssetId = asset.id;
      this.actorVersion = asset.version;
      release(previous);
      return true;
    } catch (error) {
      release(model);
      if (requestId !== this.actorRequestId || controller.signal.aborted) return false;
      throw error;
    } finally {
      if (requestId === this.actorRequestId) this.actorController = null;
    }
  }

  // Retain the original entry point for integrations using the default cat.
  async load(catalog, rodId) {
    const results = await Promise.allSettled([
      this.actor ? Promise.resolve(true) : this.loadActor(catalog), this.loadRod(catalog, rodId),
    ]);
    const failure = results.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
    return results.every((result) => result.value !== false);
  }

  async loadRod(catalog, rodId) {
    const requestId = ++this.requestId;
    const asset = catalog.assets.find((entry) => entry.id === rodId);
    if (rodId && !asset) throw new Error(`The asset catalog is missing ${rodId}`);
    let model;
    try {
      model = await loadModel(asset);
      if (requestId !== this.requestId) {
        release(model);
        return false;
      }
      release(this.rod);
      this.rod = model;
      return true;
    } catch (error) {
      release(model);
      if (requestId !== this.requestId) return false;
      throw error;
    }
  }

  async loadLure(catalog, lureId) {
    const requestId = ++this.lureRequestId;
    const asset = catalog.assets.find((entry) => entry.id === lureId);
    if (lureId && !asset) throw new Error(`The asset catalog is missing ${lureId}`);
    let model;
    try {
      model = await loadModel(asset);
      if (requestId !== this.lureRequestId) {
        release(model);
        return false;
      }
      release(this.lure);
      this.lure = model;
      return true;
    } catch (error) {
      release(model);
      if (requestId !== this.lureRequestId) return false;
      throw error;
    }
  }

  getLureLayout(geometry, clock = 0) {
    const model = this.lure;
    if (!model || !geometry.rod) return null;
    const prop = model.manifest.prop;
    const width = model.manifest.frameSize.w;
    const height = model.manifest.frameSize.h;
    const scale = Math.min(34, Math.max(22, geometry.dockWidth * 0.18)) / (prop.bounds.w * width);
    const angle = Math.sin(clock * 0.9) * 0.05;
    const dx = (prop.lineAnchor.x - prop.biteAnchor.x) * width * scale;
    const dy = (prop.lineAnchor.y - prop.biteAnchor.y) * height * scale;
    return { model, width, height, scale, angle,
      x: geometry.hookX, y: geometry.hookY,
      lineX: geometry.hookX + Math.cos(angle) * dx - Math.sin(angle) * dy,
      lineY: geometry.hookY + Math.sin(angle) * dx + Math.cos(angle) * dy };
  }

  getGeometry({ width, height, clock = 0, fishing = null }) {
    if (!this.actor || !width || !height) return null;
    if (!this.rod) fishing = null;
    const actor = this.actor;
    const frame = actorFrame(actor, clock, fishing);
    const feet = frame.anchors.feet;
    const grip = frame.anchors.grip;
    const bodyHeight = sceneSizing(width, height).catHeight;
    const actorScale = bodyHeight / actor.referenceHeight;
    const dockWidth = Math.min(180, Math.max(108, width * 0.16));
    const direction = actor.manifest.anchorFacing === "right" ? -1 : 1;
    const maximumLean = Math.min(0.14, Math.max(0.09, width / 6000));
    const bodyMotion = BAKED_ARM_RIGS.has(actor.manifest.armRig?.id) ? 0.3 : 1;
    // Reserve room for every pose so the cat stays planted while leaning back.
    const actorBounds = actorEnvelope(actor, actorScale, direction, maximumLean * bodyMotion);
    const feetX = Math.max(6 - actorBounds.left,
      Math.min(width - dockWidth * 0.42, width - 6 - actorBounds.right));
    const feetY = Math.max(6 - actorBounds.top, Math.min(150, Math.max(124, height * 0.29)));
    const nibbling = fishing?.phase === "nibbling";
    const biting = fishing?.phase === "biting";
    const reeling = fishing?.phase === "reeling";
    const caught = fishing?.phase === "caught";
    const released = fishing?.phase === "released";
    const caughtProgress = caught ? clamp01(fishing.caughtProgress ?? 0) : 0;
    const releaseProgress = released ? clamp01(fishing.releaseProgress ?? (fishing.elapsed ?? 0) / 1.6) : 0;
    const reelProgress = caught ? 1 : clamp01(fishing?.reelProgress ?? 0);
    const pullProgress = easeBetween(0.12, 0.6, reelProgress);
    const windup = reeling ? Math.sin(Math.PI * clamp01(reelProgress / 0.28)) : 0;
    const progress = clamp01(fishing?.biteProgress ?? 0.5);
    const envelope = Math.max(0.3, Math.sin(progress * Math.PI));
    const tension = reeling ? 0.65 + Math.sin(reelProgress * Math.PI) * 0.2
      + Math.sin(reelProgress * Math.PI * 9) * 0.08 : caught ? 0.14
      : biting ? envelope * (0.75 + Math.sin(clock * 15) * 0.25)
      : nibbling ? 0.14 + Math.sin(clock * 21) * 0.08 : 0;
    // Baked arm sprites supply the pulling motion. Keep only a small
    // supporting torso sway, with the feet planted throughout the pull.
    const actorRotation = (reeling ? -windup * 0.035 + pullProgress * maximumLean
      + Math.sin(reelProgress * Math.PI * 8) * Math.sin(reelProgress * Math.PI) * 0.012
      : caught ? maximumLean * 0.8 * (1 - easeBetween(0, 0.45, caughtProgress))
        + Math.sin(caughtProgress * Math.PI * 4) * Math.sin(caughtProgress * Math.PI) * 0.025
      : tension * Math.sin(clock * 11) * 0.035) * bodyMotion;
    const actorStretch = reeling ? 1 - windup * 0.045 * bodyMotion : 1;
    const localHandX = direction * (grip.x - feet.x) * actorScale;
    const localHandY = (grip.y - feet.y) * actorScale * actorStretch;
    const handX = feetX + localHandX * Math.cos(actorRotation) - localHandY * Math.sin(actorRotation);
    const handY = feetY + localHandX * Math.sin(actorRotation) + localHandY * Math.cos(actorRotation);
    const geometry = { actor, frame, feet, grip, actorScale, actorHeight: bodyHeight, dockWidth, feetX, feetY,
      direction, handX, handY, actorRotation, actorStretch, tension, nibbling, biting,
      reeling, caught, released, reelProgress, pullProgress, caughtProgress, releaseProgress };
    if (!this.rod) return geometry;

    const rod = this.rod;
    const prop = rod.manifest.prop;
    const rodWidth = rod.manifest.frameSize.w;
    const rodHeight = rod.manifest.frameSize.h;
    const rodGrip = {
      x: prop.handle.x + (prop.tip.x - prop.handle.x) * 0.035,
      y: prop.handle.y + (prop.tip.y - prop.handle.y) * 0.035,
    };
    const dx = (prop.tip.x - rodGrip.x) * rodWidth;
    const dy = (prop.tip.y - rodGrip.y) * rodHeight;
    const length = Math.min(285, Math.max(150, width * 0.24));
    const armRig = actor.manifest.armRig;
    const armDelta = BAKED_ARM_RIGS.has(armRig?.id)
      ? Math.atan2(Math.sin(frame.arm.handAngle - armRig.restHandAngle),
        Math.cos(frame.arm.handAngle - armRig.restHandAngle)) : 0;
    // Native arms keep their authored bend. Roll the pole gently upward at
    // their measured grip for either source arm orientation, independently of
    // the shoulder rotation; the original hand pixels remain unchanged.
    const wristTilt = BAKED_ARM_RIGS.has(armRig?.id)
      ? actorRotation + (armRig.id === "fishing-native-art-v1"
        ? Math.abs(armDelta) * 0.45 : direction * armDelta) : 0;
    const desiredTilt = 0.27 + Math.sin(clock * 0.8) * 0.012
      - tension * (0.055 + Math.sin(clock * 13) * 0.012)
      + (reeling ? -windup * 0.07 + pullProgress * 0.04 : caught ? 0.02 : 0) + wristTilt;
    const maximumTilt = Math.asin(Math.max(0, Math.min(0.85, (handY - 12) / length)));
    const angle = Math.PI + ((reeling || caught) ? Math.min(desiredTilt, maximumTilt) : desiredTilt);
    const rotation = angle - Math.atan2(dy, dx);
    const scale = length / Math.hypot(dx, dy);
    // Warp the supplied shaft very slightly while keeping its grip stationary.
    const bendSource = tension * Math.min(15, length * 0.055) / scale;
    const tipDX = (dx - bendSource) * scale;
    const tipDY = dy * scale;
    const tipX = handX + Math.cos(rotation) * tipDX - Math.sin(rotation) * tipDY;
    const tipY = handY + Math.sin(rotation) * tipDX + Math.cos(rotation) * tipDY;
    const hookX = tipX - 5 + Math.sin(clock * 0.8) * 7;
    const hookY = Math.max(tipY + 80, height * 0.6) + Math.sin(clock * 1.3) * 4;
    const attached = (nibbling || biting || reeling || caught) && Number.isFinite(fishing?.mouth?.x)
      && Number.isFinite(fishing?.mouth?.y);
    return { ...geometry, rod, rodWidth, rodHeight, rodGrip, rotation, scale,
      bendSource, tipX, tipY, hookX: attached ? fishing.mouth.x : hookX,
      hookY: attached ? fishing.mouth.y : hookY };
  }

  getBait(scene) {
    // Fish steer toward the unstrained rig. Feeding the bent tip back into the
    // steering target would make fish and line chase one another during a bite.
    const geometry = this.getGeometry({ ...scene, fishing: null });
    if (!geometry?.rod) return { enabled: false };
    return { x: geometry.hookX, y: geometry.hookY, enabled: true };
  }

  getLandingPoint(scene) {
    const geometry = this.getGeometry({ ...scene, fishing: null });
    if (!geometry?.rod) return { enabled: false };
    // Hold the catch in the clear space beside the pier, above deck height and
    // away from the cat. This target stays stable across its idle frames.
    return {
      x: Math.min(scene.width - 140, Math.max(95, scene.width - geometry.dockWidth - 100)),
      y: Math.max(48, geometry.feetY - 55),
      enabled: true,
    };
  }

  draw(context, scene) {
    const geometry = this.getGeometry(scene);
    if (!geometry) return;
    const { width, clock } = scene;
    const { actor, frame, feet, actorScale, dockWidth, feetX, feetY,
      direction, handX, handY, actorRotation, actorStretch, tension } = geometry;
    const nativeHand = Boolean(actor.handTexture && frame.handTransform);

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

    if (geometry.rod) {
      const { tipX, tipY, hookX, hookY } = geometry;
      const baitHidden = ["biting", "reeling", "caught"].includes(scene.fishing?.phase);
      const lure = this.getLureLayout(geometry, clock);
      // Once swallowed, the bait no longer covers the fish's face. The visible
      // line goes directly to its mouth until the fish lets go or is released.
      const lineX = baitHidden ? hookX : lure?.lineX ?? hookX;
      const lineY = baitHidden ? hookY : lure?.lineY ?? hookY;
      context.strokeStyle = tension ? "#f2ffff" : "#d9faff";
      context.lineWidth = 1.2 + tension * 0.55;
      context.beginPath();
      context.moveTo(tipX, tipY);
      context.quadraticCurveTo(tipX + (lineX - tipX) * 0.5 + 10 * (1 - tension),
        (tipY + lineY) / 2, lineX, lineY);
      context.stroke();
      if (lure && !baitHidden) {
        context.save();
        context.translate(lure.x, lure.y);
        context.rotate(lure.angle);
        drawSprite(context, lure.model, lure.model.frames[0],
          -lure.model.manifest.prop.biteAnchor.x * lure.width * lure.scale,
          -lure.model.manifest.prop.biteAnchor.y * lure.height * lure.scale,
          lure.width * lure.scale, lure.height * lure.scale);
        context.restore();
      } else if (!baitHidden) {
      context.strokeStyle = "#eff6f8";
      context.lineWidth = 1.8;
      context.beginPath();
      context.moveTo(hookX, hookY);
      context.lineTo(hookX, hookY + 8);
      context.arc(hookX - 4, hookY + 8, 4, 0, Math.PI);
      context.stroke();
      // A warm bait dot stays legible against the fish and dark water.
      context.fillStyle = "#ff986433";
      context.beginPath(); context.arc(hookX, hookY, 8 + tension * 3, 0, Math.PI * 2); context.fill();
      context.fillStyle = "#ff8d59";
      context.beginPath(); context.arc(hookX, hookY, 4, 0, Math.PI * 2); context.fill();
      context.fillStyle = "#ffe4b6";
      context.beginPath(); context.arc(hookX - 1, hookY - 1, 1.4, 0, Math.PI * 2); context.fill();
      }

      if (tension) {
        context.strokeStyle = "#b9edf2b3";
        context.lineWidth = 1.2;
        for (let index = 0; index < 5; index += 1) {
          const cycle = (clock * 0.8 + index * 0.2) % 1;
          const side = index % 2 ? -1 : 1;
          context.beginPath();
          context.arc(hookX + side * (10 + cycle * 14), hookY - cycle * 25,
            1.5 + cycle * 2, 0, Math.PI * 2);
          context.stroke();
        }
      }
      if (geometry.reeling) {
        // Short effort marks make the pull readable without another bitmap.
        context.strokeStyle = "#e1f8ee99";
        context.lineWidth = 1.6;
        for (let index = 0; index < 3; index += 1) {
          const shift = Math.sin(geometry.reelProgress * Math.PI * 6 + index) * 2;
          const x = handX + 16 + index * 6;
          const y = handY - 22 - index * 5 + shift;
          context.beginPath(); context.moveTo(x, y); context.lineTo(x + 5, y - 6); context.stroke();
        }
      }
      if (geometry.caught) {
        const celebration = geometry.caughtProgress;
        context.strokeStyle = `rgba(255, 218, 119, ${0.85 * (1 - celebration)})`;
        context.lineWidth = 2;
        for (let index = 0; index < 6; index += 1) {
          const angle = index * Math.PI / 3;
          const radius = 16 + celebration * 27;
          const x = hookX + Math.cos(angle) * radius;
          const y = hookY + Math.sin(angle) * radius;
          context.beginPath(); context.moveTo(x - 3, y); context.lineTo(x + 3, y);
          context.moveTo(x, y - 3); context.lineTo(x, y + 3); context.stroke();
        }
      }
      // Native-hand models split the rod at its grip: the butt is behind the
      // body and the shaft is in front, with no duplicated translucent pixels.
      drawRod(context, geometry, nativeHand ? "butt" : "full");
    }
    // Let the complete authored paw/body silhouette cover the handle naturally,
    // rather than pinning a rectangular patch over a shaft drawn on the wrist.
    context.save();
    context.translate(feetX, feetY);
    context.rotate(actorRotation);
    context.scale(direction, actorStretch);
    drawSprite(context, actor, frame, -feet.x * actorScale, -feet.y * actorScale,
      actor.manifest.frameSize.w * actorScale, actor.manifest.frameSize.h * actorScale);
    context.restore();
    if (geometry.rod && nativeHand) {
      // The shaft stays visible in front of the torso, while only the actual
      // native glove/forearm covers the grip. No cropped actor patch is stamped.
      drawRod(context, geometry, "shaft");
      drawNativeHand(context, geometry);
    }
    drawCatReaction(context, geometry, scene);
    context.restore();
  }
}
