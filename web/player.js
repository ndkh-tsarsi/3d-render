import { Aquarium } from "./aquarium.js?v=fishing-shore-1";
import { FishingRig } from "./fishing.js?v=fishing-shore-1";
import { FishingAudio } from "./fishing-audio.js?v=fishing-sound-1";

const assetSelect = document.querySelector("#asset");
const animationSelect = document.querySelector("#animation");
const mirrorInput = document.querySelector("#mirror");
const pauseButton = document.querySelector("#pause");
const canvas = document.querySelector("#stage");
const context = canvas.getContext("2d");
const status = document.querySelector("#status");
const details = document.querySelector("#details");
const aquariumPanel = document.querySelector("#aquarium-panel");
const spritePanel = document.querySelector("#sprite-panel");
const aquariumViewButton = document.querySelector("#aquarium-view");
const spriteViewButton = document.querySelector("#sprite-view");
const aquariumStatus = document.querySelector("#aquarium-status");
const aquariumCount = document.querySelector("#aquarium-count");
const aquariumPause = document.querySelector("#aquarium-pause");
const aquariumReset = document.querySelector("#aquarium-reset");
const swimSpeed = document.querySelector("#swim-speed");
const speedValue = document.querySelector("#speed-value");
const rodSelect = document.querySelector("#fishing-rod");
const catSelect = document.querySelector("#fishing-cat");
const outfitSelect = document.querySelector("#cat-outfit");
const fishingStatus = document.querySelector("#fishing-status");
const castBaitButton = document.querySelector("#cast-bait");
const biteStatus = document.querySelector("#bite-status");
const reelButton = document.querySelector("#reel-in");
const catchCount = document.querySelector("#catch-count");
const lureSelect = document.querySelector("#fishing-lure");
const cuteRoster = document.querySelector("#cute-roster");
const cuteRosterSummary = document.querySelector("#cute-roster-summary");
const cuteRosterList = document.querySelector("#cute-roster-list");
const soundToggle = document.querySelector("#sound-toggle");
const catPortrait = document.querySelector("#fishing-cat-portrait");
catPortrait?.addEventListener("error", () => { catPortrait.hidden = true; });

let catalog;
let manifest;
let spriteAtlases;
let pendingSpriteAtlases;
let assetController;
let spritePageError;
let frameIndex = 0;
let elapsed = 0;
let lastTime = performance.now();
let playing = true;
let assetRequestId = 0;
let pixelRatioQuery;
let currentView = location.hash === "#sprite" ? "sprite" : "aquarium";
let singleAnimationFrame = null;
let singleLoadPromise;
let aquariumLoadPromise;
let aquariumReady = false;
let aquariumPlaying = true;
let latestFishingState = { phase: "disabled" };
let actorLoading = false;
let actorLoadId = 0;
let catVariants = [];
let rodLoading = false;
let lureLoading = false;
let rodLoadId = 0;
let lureLoadId = 0;
const fishingRig = new FishingRig();
const fishingAudio = new FishingAudio({ onChange: updateSoundButton });
updateSoundButton({ enabled: fishingAudio.enabled, available: fishingAudio.available });

function updateSoundButton({ enabled, available }) {
  soundToggle.disabled = !available;
  soundToggle.setAttribute("aria-pressed", String(enabled));
  soundToggle.setAttribute("aria-label", enabled ? "Tắt âm thanh" : "Bật âm thanh");
  soundToggle.textContent = available ? `Âm thanh: ${enabled ? "Bật" : "Tắt"}` : "Âm thanh: Không hỗ trợ";
  soundToggle.title = available ? enabled ? "Tắt âm thanh" : "Bật âm thanh" : "Trình duyệt chưa hỗ trợ âm thanh";
}

function unlockSound() {
  if (fishingAudio.enabled && !document.hidden) void fishingAudio.unlock();
}

// Unlock inside the gesture; event sounds only begin on later phase changes.
document.addEventListener("pointerdown", unlockSound, { capture: true });
document.addEventListener("keydown", (event) => {
  if (!event.repeat && ["Enter", " "].includes(event.key)) unlockSound();
}, { capture: true });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) fishingAudio.stop();
});
window.addEventListener("pagehide", () => fishingAudio.stop());
soundToggle.addEventListener("click", () => { void fishingAudio.setEnabled(!fishingAudio.enabled); });

const aquarium = new Aquarium(document.querySelector("#aquarium-stage"), {
  getBait(scene) {
    return fishingRig.getBait(scene);
  },
  getReelTarget(scene) {
    return fishingRig.getLandingPoint(scene);
  },
  onFishingEvent(state) {
    fishingAudio.handleEvent(state, { active: aquariumReady && aquariumPlaying
      && currentView === "aquarium" && !document.hidden && !actorLoading && !rodLoading && !lureLoading
      && Boolean(fishingRig.rod) });
    updateBiteStatus(state);
  },
  drawOverlay(context, scene) {
    fishingRig.draw(context, scene);
  },
  onStatus(message) {
    aquariumStatus.textContent = message;
  },
  onReady(count) {
    aquariumReady = true;
    aquariumStatus.hidden = true;
    aquariumCount.textContent = `${count} bạn cá trong bể`;
    document.querySelector("#aquarium-stage").setAttribute("aria-label", `Mèo câu cá cùng ${count} loài cá bơi tự do trong bể`);
    aquariumPause.disabled = false;
    aquariumReset.disabled = false;
    updateBiteStatus(latestFishingState);
  },
});

function updateBiteStatus(state) {
  latestFishingState = state;
  const name = ({ fish1: "cá cam", fish2: "cá xanh", fish3: "cá hề" })[state.fishId] || state.name || "cá";
  const messages = {
    disabled: "Chọn cần câu để thả mồi",
    waiting: "Chờ cá cắn…",
    approaching: `${name} đang tới mồi…`,
    nibbling: `${name} đang đớp mồi…`,
    biting: "Cá cắn! Bấm Giật cần!",
    reeling: `Đang kéo ${name} lên…`,
    caught: `Câu được ${name}! +1`,
    released: state.reason === "released" ? "Ôi, chậm mất rồi! Cá đã tuột…"
      : `${name} tuột mất rồi… Thử lại nhé!`,
  };
  biteStatus.textContent = !aquariumPlaying ? "Đã tạm dừng" : messages[state.phase] || messages.waiting;
  biteStatus.dataset.phase = aquariumPlaying ? state.phase : "paused";
  aquariumPanel.dataset.phase = biteStatus.dataset.phase;
  castBaitButton.disabled = !aquariumReady || !aquariumPlaying || currentView !== "aquarium"
    || !["waiting", "released"].includes(state.phase);
  reelButton.disabled = !aquariumReady || !aquariumPlaying || currentView !== "aquarium" || state.phase !== "biting";
  reelButton.textContent = state.phase === "reeling" ? "Đang kéo…" : "Giật cần";
  reelButton.setAttribute("aria-busy", String(state.phase === "reeling"));
  const score = String(state.catchCount ?? 0);
  if (catchCount.textContent !== score) catchCount.textContent = score;
}

async function ensureAquarium() {
  if (!aquariumLoadPromise) {
    aquariumLoadPromise = Promise.all([
      aquarium.load(catalog), chooseFishingActor(), chooseFishingRod(), chooseFishingLure(),
    ]).catch((error) => {
      aquariumLoadPromise = null;
      throw error;
    });
  }
  await aquariumLoadPromise;
  aquarium.setActive(currentView === "aquarium");
}

function syncFishingAvailability() {
  aquarium.setFishingEnabled(Boolean(fishingRig.actor && fishingRig.rod)
    && !actorLoading && !rodLoading && !lureLoading);
}

function updateRigStatus() {
  const actor = fishingRig.actor?.manifest.actor;
  const cat = actor?.familyName ?? fishingRig.actor?.manifest.name ?? "Mèo câu cá";
  const outfit = actor?.outfit?.name;
  const character = outfit ? `${cat} · ${outfit}` : cat;
  const asset = catalog.assets.find((entry) => entry.id === fishingRig.actorAssetId);
  if (catPortrait && asset?.thumbnail) {
    const thumbnail = `${asset.thumbnail}${asset.version ? `?v=${encodeURIComponent(asset.version)}` : ""}`;
    if (catPortrait.getAttribute("src") !== thumbnail) catPortrait.src = thumbnail;
    catPortrait.alt = character;
    catPortrait.hidden = false;
  }
  fishingStatus.textContent = fishingRig.rod
    ? `${character} · ${rodSelect.selectedOptions[0]?.textContent ?? ""} · ${lureSelect.selectedOptions[0]?.textContent ?? ""}`
    : `${character} đang ngắm đàn cá`;
}

function catFamily(asset) {
  return asset.actor?.family ?? "orange-tabby";
}

function populateCatOutfits(preferredId) {
  const variants = catVariants.filter((asset) => catFamily(asset) === catSelect.value)
    .sort((first, second) => (first.actor?.outfit?.order ?? 0) - (second.actor?.outfit?.order ?? 0));
  outfitSelect.replaceChildren(...variants.map((asset) =>
    new Option(asset.actor?.outfit?.name ?? "Nguyên bản", asset.id)));
  outfitSelect.value = variants.some((asset) => asset.id === preferredId) ? preferredId : variants[0]?.id ?? "";
  outfitSelect.disabled = !variants.length;
}

function configureCatControls() {
  catVariants = catalog.assets.filter((asset) => asset.actor?.kind === "cat" || asset.id === "fishing-cat");
  const families = new Map(catVariants.map((asset) => [catFamily(asset), asset.actor?.familyName ?? "Mèo cam"]));
  catSelect.replaceChildren(...[...families].map(([family, name]) => new Option(name, family)));
  const initial = catVariants.find((asset) => asset.id === "fishing-cat") ?? catVariants[0];
  catSelect.value = initial ? catFamily(initial) : "";
  catSelect.disabled = !initial;
  populateCatOutfits(initial?.id);
}

async function chooseFishingActor() {
  fishingAudio.stop();
  const requestId = ++actorLoadId;
  actorLoading = true;
  syncFishingAvailability();
  fishingStatus.textContent = "Đang chuẩn bị mèo và trang phục…";
  let committed = false;
  try {
    if (!await fishingRig.loadActor(catalog, outfitSelect.value || "fishing-cat")) return;
    committed = true;
  } catch (error) {
    console.error(error);
    if (requestId === actorLoadId) {
      const previous = catVariants.find((asset) => asset.id === fishingRig.actorAssetId);
      if (previous) {
        catSelect.value = catFamily(previous);
        populateCatOutfits(previous.id);
      }
      fishingStatus.textContent = `Không tải được trang phục: ${error.message}`;
    }
  } finally {
    if (requestId === actorLoadId) {
      actorLoading = false;
      syncFishingAvailability();
      if (committed && !rodLoading && !lureLoading) updateRigStatus();
      aquarium.draw();
    }
  }
}

async function chooseFishingRod() {
  fishingAudio.stop();
  const requestId = ++rodLoadId;
  rodLoading = true;
  syncFishingAvailability();
  fishingStatus.textContent = "Đang chuẩn bị cần câu…";
  try {
    if (!await fishingRig.loadRod(catalog, rodSelect.value)) return;
    if (!actorLoading && !lureLoading) updateRigStatus();
  } catch (error) {
    console.error(error);
    if (requestId === rodLoadId) fishingStatus.textContent = `Không tải được cần câu: ${error.message}`;
  } finally {
    if (requestId === rodLoadId) {
      rodLoading = false;
      syncFishingAvailability();
      aquarium.draw();
    }
  }
}

async function chooseFishingLure() {
  fishingAudio.stop();
  const requestId = ++lureLoadId;
  lureLoading = true;
  syncFishingAvailability();
  fishingStatus.textContent = "Đang chuẩn bị mồi câu…";
  try {
    if (!await fishingRig.loadLure(catalog, lureSelect.value)) return;
    if (!actorLoading && !rodLoading) updateRigStatus();
  } catch (error) {
    console.error(error);
    if (requestId === lureLoadId) fishingStatus.textContent = `Không tải được mồi câu: ${error.message}`;
  } finally {
    if (requestId === lureLoadId) {
      lureLoading = false;
      syncFishingAvailability();
      aquarium.draw();
    }
  }
}

function startSingleAnimation() {
  if (singleAnimationFrame === null && currentView === "sprite" && manifest) {
    lastTime = performance.now();
    singleAnimationFrame = requestAnimationFrame(animate);
  }
}

async function setView(view) {
  currentView = view;
  document.body.dataset.view = view;
  if (view !== "aquarium") fishingAudio.stop();
  aquariumPanel.hidden = view !== "aquarium";
  spritePanel.hidden = view !== "sprite";
  aquariumViewButton.setAttribute("aria-pressed", String(view === "aquarium"));
  spriteViewButton.setAttribute("aria-pressed", String(view === "sprite"));
  aquarium.setActive(view === "aquarium" && aquariumReady);
  updateBiteStatus(latestFishingState);
  if (view !== "sprite" && singleAnimationFrame !== null) {
    cancelAnimationFrame(singleAnimationFrame);
    singleAnimationFrame = null;
  }
  if (!catalog) return;
  if (view === "aquarium") {
    try {
      await ensureAquarium();
    } catch (error) {
      console.error(error);
      aquariumStatus.hidden = false;
      aquariumStatus.textContent = `Không tải được bể cá: ${error.message}. Chọn Bể cá để thử lại.`;
      aquariumCount.textContent = "Chưa tải được đàn cá";
    }
  } else {
    if (!manifest) {
      singleLoadPromise ??= chooseAsset(Number(assetSelect.value)).finally(() => {
        singleLoadPromise = null;
      });
      try {
        await singleLoadPromise;
      } catch (error) {
        showError(error);
      }
    }
    syncCanvasResolution();
    startSingleAnimation();
  }
}

function syncCanvasResolution() {
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const ratio = Math.max(0.1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(bounds.width * ratio));
  const height = Math.max(1, Math.round(bounds.height * ratio));
  // Resizing clears the canvas and its drawing state, so only do it when needed.
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
}

function watchPixelRatio() {
  if (!window.matchMedia) return;
  pixelRatioQuery?.removeEventListener("change", handlePixelRatioChange);
  pixelRatioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  pixelRatioQuery.addEventListener("change", handlePixelRatioChange, { once: true });
}

function handlePixelRatioChange() {
  syncCanvasResolution();
  watchPixelRatio();
}

if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(syncCanvasResolution).observe(canvas);
}
window.addEventListener("resize", syncCanvasResolution);
watchPixelRatio();
syncCanvasResolution();

async function fetchJson(path, signal) {
  const response = await fetch(path, { cache: "no-cache", signal });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

const SPRITE_ATLAS_LIMIT = 3;
const SPRITE_ATLAS_EDGE = 2048;

function abortedAtlasLoad() {
  return new DOMException("Sprite page load was cancelled", "AbortError");
}

function releaseSpriteImage(image) {
  if (typeof image?.close === "function") image.close();
  else if (image && "src" in image) image.src = "";
  else if (image) image.width = image.height = 0;
}

async function decodeSpritePage(path, page, signal) {
  const scale = Math.min(1, SPRITE_ATLAS_EDGE / Math.max(page.size.w, page.size.h));
  const width = Math.max(1, Math.round(page.size.w * scale));
  const height = Math.max(1, Math.round(page.size.h * scale));
  let image;
  if (typeof createImageBitmap === "function") {
    const response = await fetch(path, { cache: "force-cache", signal });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    const blob = await response.blob();
    if (signal.aborted) throw abortedAtlasLoad();
    try {
      image = await createImageBitmap(blob, {
        resizeWidth: width, resizeHeight: height, resizeQuality: "high",
      });
    } catch (error) {
      if (signal.aborted) throw abortedAtlasLoad();
      // Some browsers expose ImageBitmap but cannot decode or resize this PNG.
    }
  }
  if (!image) {
    image = await new Promise((resolve, reject) => {
      const source = new Image();
      const clean = () => {
        signal.removeEventListener("abort", cancel);
        source.onload = source.onerror = null;
      };
      const cancel = () => {
        clean();
        source.src = "";
        reject(abortedAtlasLoad());
      };
      source.onload = () => { clean(); resolve(source); };
      source.onerror = () => { clean(); reject(new Error(`Could not load ${path}`)); };
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      else source.src = path;
    });
  }
  if (signal.aborted) {
    releaseSpriteImage(image);
    throw abortedAtlasLoad();
  }
  // Respect the memory cap even if a browser ignores ImageBitmap resize options.
  if (image.width > width || image.height > height) {
    const reduced = typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(width, height) : document.createElement("canvas");
    reduced.width = width;
    reduced.height = height;
    try {
      const reducedContext = reduced.getContext("2d");
      reducedContext.imageSmoothingEnabled = true;
      reducedContext.imageSmoothingQuality = "high";
      reducedContext.drawImage(image, 0, 0, width, height);
    } finally {
      releaseSpriteImage(image);
    }
    image = reduced;
  }
  return { image, scaleX: image.width / page.size.w, scaleY: image.height / page.size.h };
}

class SpriteAtlasCache {
  constructor(model, imagePath) {
    this.pages = new Map(model.atlases.map((page) => [page.page, page]));
    this.imagePath = imagePath;
    this.entries = new Map();
    this.errors = new Map();
    this.focus = new Set();
    this.destroyed = false;
  }

  get(pageId) {
    const entry = this.entries.get(pageId);
    if (!entry?.value) return null;
    this.entries.delete(pageId);
    this.entries.set(pageId, entry);
    return entry.value;
  }

  isLoading(pageId) {
    const entry = this.entries.get(pageId);
    return Boolean(entry && !entry.value);
  }

  setFocus(pageIds) {
    this.focus = new Set(pageIds);
    for (const [pageId, entry] of this.entries) {
      if (!entry.value && !this.focus.has(pageId)) this.remove(pageId);
    }
  }

  remove(pageId) {
    const entry = this.entries.get(pageId);
    if (!entry) return;
    this.entries.delete(pageId);
    entry.controller.abort();
    if (entry.value) releaseSpriteImage(entry.value.image);
  }

  load(pageId) {
    if (this.destroyed) return Promise.reject(abortedAtlasLoad());
    const existing = this.entries.get(pageId);
    if (existing) return existing.promise;
    if (this.errors.has(pageId)) return Promise.reject(this.errors.get(pageId));
    const page = this.pages.get(pageId);
    if (!page) return Promise.reject(new Error(`Missing sprite atlas page ${pageId}`));
    while (this.entries.size >= SPRITE_ATLAS_LIMIT) {
      const oldest = [...this.entries.keys()].find((id) => !this.focus.has(id));
      if (oldest === undefined) return Promise.reject(new Error("Sprite atlas cache is full"));
      this.remove(oldest);
    }
    const entry = { controller: new AbortController(), value: null, promise: null };
    this.entries.set(pageId, entry);
    entry.promise = decodeSpritePage(this.imagePath(page.image), page, entry.controller.signal)
      .then((value) => {
        if (this.destroyed || this.entries.get(pageId) !== entry) {
          releaseSpriteImage(value.image);
          throw abortedAtlasLoad();
        }
        entry.value = value;
        return value;
      }).catch((error) => {
        if (this.entries.get(pageId) === entry) this.entries.delete(pageId);
        if (!this.destroyed && error.name !== "AbortError") this.errors.set(pageId, error);
        throw error;
      });
    return entry.promise;
  }

  destroy() {
    this.destroyed = true;
    for (const pageId of this.entries.keys()) this.remove(pageId);
    this.errors.clear();
  }
}

async function chooseAsset(index) {
  const requestId = ++assetRequestId;
  assetController?.abort();
  assetController = new AbortController();
  const controller = assetController;
  spriteAtlases?.destroy();
  pendingSpriteAtlases?.destroy();
  spriteAtlases = pendingSpriteAtlases = null;
  manifest = null;
  spritePageError = null;
  pauseButton.disabled = true;
  animationSelect.disabled = true;
  const asset = catalog.assets[index];
  const base = asset.manifest.slice(0, asset.manifest.lastIndexOf("/") + 1);
  const versioned = (path) => asset.version
    ? `${path}?v=${encodeURIComponent(asset.version)}`
    : path;
  let nextManifest;
  let nextAtlases;
  let initialAnimation;
  try {
    nextManifest = await fetchJson(versioned(asset.manifest), controller.signal);
    if (requestId !== assetRequestId) return;
    const names = Object.keys(nextManifest.animations);
    initialAnimation = names.find((name) => name === "idle")
      ?? names.find((name) => name === "swim") ?? names[0];
    const firstFrame = nextManifest.animations[initialAnimation]?.frames[0];
    if (!firstFrame) throw new Error(`${asset.name} has no animation frames`);
    nextAtlases = new SpriteAtlasCache(nextManifest, (image) => versioned(base + image));
    pendingSpriteAtlases = nextAtlases;
    nextAtlases.setFocus([firstFrame.page]);
    status.textContent = `Đang tải ${asset.name}…`;
    await nextAtlases.load(firstFrame.page);
  } catch (error) {
    nextAtlases?.destroy();
    if (pendingSpriteAtlases === nextAtlases) pendingSpriteAtlases = null;
    if (requestId !== assetRequestId) return;
    throw error;
  }
  if (requestId !== assetRequestId) {
    nextAtlases.destroy();
    return;
  }

  // The previous canvas remains visible while only the first needed page loads.
  manifest = nextManifest;
  spriteAtlases = nextAtlases;
  pendingSpriteAtlases = null;
  const animationNames = Object.keys(manifest.animations);
  animationSelect.replaceChildren(
    ...animationNames.map((name) => new Option(name, name))
  );
  animationSelect.value = initialAnimation;
  animationSelect.disabled = false;
  canvas.style.aspectRatio = `${manifest.frameSize.w} / ${manifest.frameSize.h}`;
  syncCanvasResolution();
  status.textContent = `${manifest.name} · góc nhìn ${manifest.view.cameraAxis}`;
  chooseAnimation();
  pauseButton.disabled = false;
  startSingleAnimation();
}

function chooseAnimation() {
  frameIndex = 0;
  elapsed = 0;
  lastTime = performance.now();
  playing = true;
  pauseButton.textContent = "Tạm dừng";
  spritePageError = null;
  spriteAtlases.errors.clear();
  const animation = manifest.animations[animationSelect.value];
  details.textContent = `${animation.frames.length} frames · ${animation.fps} fps · ${animation.loop ? "loop" : "one-shot"}`;
  primeSpritePages(animation);
}

function primeSpritePages(animation) {
  const cache = spriteAtlases;
  const frames = animation.frames;
  const current = frames[frameIndex]?.page;
  if (!cache || current === undefined) return;
  let next;
  if (playing) {
    for (let offset = 1; offset < frames.length; offset += 1) {
      const index = frameIndex + offset;
      if (!animation.loop && index >= frames.length) break;
      const pageId = frames[index % frames.length].page;
      if (pageId !== current) { next = pageId; break; }
    }
  }
  cache.setFocus(next === undefined ? [current] : [current, next]);
  for (const pageId of cache.focus) {
    if (!cache.get(pageId) && !cache.isLoading(pageId) && !cache.errors.has(pageId)) {
      void cache.load(pageId).catch(() => {});
    }
  }
  const error = cache.errors.get(current);
  if (error && spritePageError !== current) {
    spritePageError = current;
    playing = false;
    pauseButton.textContent = "Tiếp tục";
    showError(new Error(`${error.message}. Bấm Tiếp tục để thử lại.`));
  } else if (!error && spritePageError === null) {
    status.textContent = cache.get(current)
      ? `${manifest.name} · góc nhìn ${manifest.view.cameraAxis}`
      : `Đang tải ${manifest.name} · trang ${current + 1}…`;
  }
}

function drawFrame(frame) {
  const atlas = spriteAtlases?.get(frame.page);
  if (!atlas) return;
  const rect = frame.frame;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  if (mirrorInput.checked) {
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
  }
  context.drawImage(
    atlas.image,
    rect.x * atlas.scaleX, rect.y * atlas.scaleY,
    rect.w * atlas.scaleX, rect.h * atlas.scaleY,
    0, 0, canvas.width, canvas.height
  );
  context.restore();
}

function animate(now) {
  singleAnimationFrame = null;
  if (currentView !== "sprite") return;
  if (manifest) {
    const animation = manifest.animations[animationSelect.value];
    const frames = animation.frames;
    const ready = frames.length && spriteAtlases?.get(frames[frameIndex].page);
    if (playing && ready) {
      elapsed += now - lastTime;
      while (playing && elapsed >= frames[frameIndex].durationMs) {
        const next = frameIndex + 1 < frames.length ? frameIndex + 1 : animation.loop ? 0 : null;
        if (next === null) {
          playing = false;
          elapsed = 0;
          pauseButton.textContent = "Tiếp tục";
        } else if (!spriteAtlases.get(frames[next].page)) {
          // Keep the last drawn frame, dropping blocked wall time rather than
          // skipping frames or clearing the canvas while a page is fetched.
          elapsed = frames[frameIndex].durationMs;
          const error = spriteAtlases.errors.get(frames[next].page);
          if (error) {
            playing = false;
            pauseButton.textContent = "Tiếp tục";
            if (spritePageError !== frames[next].page) {
              spritePageError = frames[next].page;
              showError(new Error(`${error.message}. Bấm Tiếp tục để thử lại.`));
            }
          }
          break;
        } else {
          elapsed -= frames[frameIndex].durationMs;
          frameIndex = next;
        }
      }
    } else if (!ready) elapsed = 0;
    primeSpritePages(animation);
    if (frames.length) drawFrame(frames[frameIndex]);
  }
  lastTime = now;
  singleAnimationFrame = requestAnimationFrame(animate);
}

pauseButton.addEventListener("click", () => {
  if (!manifest) return;
  playing = !playing;
  pauseButton.textContent = playing ? "Tạm dừng" : "Tiếp tục";
  if (playing) {
    spritePageError = null;
    spriteAtlases.errors.clear();
    const frames = manifest.animations[animationSelect.value].frames;
    if (frameIndex === frames.length - 1) frameIndex = 0;
  }
  elapsed = 0;
  lastTime = performance.now();
  primeSpritePages(manifest.animations[animationSelect.value]);
});
assetSelect.addEventListener("change", () => chooseAsset(Number(assetSelect.value)).catch(showError));
animationSelect.addEventListener("change", () => {
  if (!manifest) return;
  chooseAnimation();
});

for (const [button, view] of [[aquariumViewButton, "aquarium"], [spriteViewButton, "sprite"]]) {
  button.addEventListener("click", () => {
    history.replaceState(null, "", `#${view}`);
    setView(view);
  });
}
window.addEventListener("hashchange", () => setView(location.hash === "#sprite" ? "sprite" : "aquarium"));
aquariumPause.addEventListener("click", () => {
  aquariumPlaying = !aquariumPlaying;
  if (!aquariumPlaying) fishingAudio.stop();
  aquarium.setPlaying(aquariumPlaying);
  aquariumPause.textContent = aquariumPlaying ? "Tạm dừng" : "Tiếp tục";
  aquariumPause.setAttribute("aria-pressed", String(!aquariumPlaying));
  updateBiteStatus(latestFishingState);
});
swimSpeed.addEventListener("input", () => {
  aquarium.setSpeed(Number(swimSpeed.value));
  speedValue.value = `${Number(swimSpeed.value)}×`;
});
aquariumReset.addEventListener("click", () => {
  fishingAudio.stop();
  aquarium.reset();
});
rodSelect.addEventListener("change", chooseFishingRod);
catSelect.addEventListener("change", () => {
  populateCatOutfits();
  void chooseFishingActor();
});
outfitSelect.addEventListener("change", () => { void chooseFishingActor(); });
lureSelect.addEventListener("change", chooseFishingLure);
castBaitButton.addEventListener("click", () => aquarium.castBait());
reelButton.addEventListener("click", () => aquarium.reelIn());

function showError(error) {
  console.error(error);
  status.textContent = error.message;
}

try {
  pauseButton.disabled = true;
  await setView(currentView);
  catalog = await fetchJson("catalog.json");
  configureCatControls();
  const cuteFish = catalog.assets.filter((asset) => asset.id.startsWith("cute-"));
  cuteRoster.hidden = !cuteFish.length;
  cuteRosterSummary.textContent = `Khám phá thêm ${cuteFish.length} loài cá`;
  cuteRosterList.replaceChildren(...cuteFish.map((asset) => {
    const item = document.createElement("li");
    item.textContent = asset.name;
    return item;
  }));
  assetSelect.replaceChildren(
    ...catalog.assets.map((asset, index) => new Option(
      asset.id.startsWith("cute-") ? `${asset.name} · Cute Fish Pack` : asset.name,
      String(index)))
  );
  const rods = catalog.assets.filter((asset) => /^fishingrod-lvl[1-5]$/.test(asset.id));
  rodSelect.replaceChildren(new Option("Tắt", ""),
    ...rods.map((asset) => new Option(`Cấp ${asset.id.slice(-1)}`, asset.id)));
  rodSelect.value = rods.find((asset) => asset.id === "fishingrod-lvl5")?.id ?? rods[0]?.id ?? "";
  rodSelect.disabled = false;
  const lures = catalog.assets.filter((asset) => /^lure-[1-6]$/.test(asset.id));
  lureSelect.replaceChildren(...lures.map((asset) => new Option(`Mồi ${asset.id.slice(-1)}`, asset.id)));
  lureSelect.value = lures[0]?.id ?? "";
  lureSelect.disabled = !lures.length;
  await setView(currentView);
} catch (error) {
  showError(error);
  aquariumStatus.textContent = `Không tải được danh sách: ${error.message}`;
}

