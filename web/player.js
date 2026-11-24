import { Aquarium } from "./aquarium.js?v=scene-ratio-1";
import { FishingRig } from "./fishing.js?v=scene-ratio-1";
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

let catalog;
let manifest;
let atlasImages = [];
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
      && currentView === "aquarium" && !document.hidden && !rodLoading && !lureLoading
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
  castBaitButton.disabled = !aquariumReady || !aquariumPlaying || currentView !== "aquarium"
    || !["waiting", "released"].includes(state.phase);
  reelButton.disabled = !aquariumReady || !aquariumPlaying || currentView !== "aquarium" || state.phase !== "biting";
  reelButton.textContent = state.phase === "reeling" ? "Đang kéo…" : "Giật cần";
  const score = String(state.catchCount ?? 0);
  if (catchCount.textContent !== score) catchCount.textContent = score;
}

async function ensureAquarium() {
  if (!aquariumLoadPromise) {
    aquariumLoadPromise = Promise.all([aquarium.load(catalog), chooseFishingRod(), chooseFishingLure()]).catch((error) => {
      aquariumLoadPromise = null;
      throw error;
    });
  }
  await aquariumLoadPromise;
  aquarium.setActive(currentView === "aquarium");
}

function syncFishingAvailability() {
  aquarium.setFishingEnabled(Boolean(fishingRig.rod) && !rodLoading && !lureLoading);
}

function updateRigStatus() {
  fishingStatus.textContent = fishingRig.rod
    ? `Mèo câu cá · ${rodSelect.selectedOptions[0]?.textContent ?? ""} · ${lureSelect.selectedOptions[0]?.textContent ?? ""}`
    : "Mèo đang ngắm đàn cá";
}

async function chooseFishingRod() {
  fishingAudio.stop();
  const requestId = ++rodLoadId;
  rodLoading = true;
  syncFishingAvailability();
  fishingStatus.textContent = "Đang chuẩn bị cần câu…";
  try {
    if (!await fishingRig.load(catalog, rodSelect.value)) return;
    if (!lureLoading) updateRigStatus();
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
    if (!rodLoading) updateRigStatus();
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
      aquariumStatus.textContent = `Could not load the aquarium: ${error.message}. Select Aquarium to retry.`;
      aquariumCount.textContent = "Swimmers could not be loaded";
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

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

function loadImage(path) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${path}`));
    image.src = path;
  });
}

async function chooseAsset(index) {
  const requestId = ++assetRequestId;
  const asset = catalog.assets[index];
  const base = asset.manifest.slice(0, asset.manifest.lastIndexOf("/") + 1);
  const versioned = (path) => asset.version
    ? `${path}?v=${encodeURIComponent(asset.version)}`
    : path;
  let nextManifest;
  let nextImages;
  try {
    nextManifest = await fetchJson(versioned(asset.manifest));
    nextImages = await Promise.all(nextManifest.atlases.map((page) => loadImage(versioned(base + page.image))));
  } catch (error) {
    if (requestId !== assetRequestId) return;
    throw error;
  }
  if (requestId !== assetRequestId) return;

  // Keep the current character playable until the replacement is fully loaded.
  manifest = nextManifest;
  atlasImages = nextImages;
  const animationNames = Object.keys(manifest.animations);
  animationSelect.replaceChildren(
    ...animationNames.map((name) => new Option(name, name))
  );
  animationSelect.value = animationNames.find((name) => name === "idle")
    ?? animationNames.find((name) => name === "swim")
    ?? animationNames[0];
  canvas.style.aspectRatio = `${manifest.frameSize.w} / ${manifest.frameSize.h}`;
  syncCanvasResolution();
  status.textContent = `${manifest.name} · ${manifest.view.cameraAxis} profile`;
  chooseAnimation();
  pauseButton.disabled = false;
  startSingleAnimation();
}

function chooseAnimation() {
  frameIndex = 0;
  elapsed = 0;
  lastTime = performance.now();
  playing = true;
  pauseButton.textContent = "Pause";
  const animation = manifest.animations[animationSelect.value];
  details.textContent = `${animation.frames.length} frames · ${animation.fps} fps · ${animation.loop ? "loop" : "one-shot"}`;
}

function drawFrame(frame) {
  const image = atlasImages[frame.page];
  const rect = frame.frame;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  if (mirrorInput.checked) {
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
  }
  context.drawImage(
    image,
    rect.x, rect.y, rect.w, rect.h,
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
    if (playing && frames.length) {
      elapsed += now - lastTime;
      while (playing && elapsed >= frames[frameIndex].durationMs) {
        elapsed -= frames[frameIndex].durationMs;
        if (frameIndex + 1 < frames.length) frameIndex += 1;
        else if (animation.loop) frameIndex = 0;
        else {
          playing = false;
          elapsed = 0;
          pauseButton.textContent = "Play";
        }
      }
    }
    if (frames.length) drawFrame(frames[frameIndex]);
  }
  lastTime = now;
  singleAnimationFrame = requestAnimationFrame(animate);
}

pauseButton.addEventListener("click", () => {
  if (!manifest) return;
  playing = !playing;
  pauseButton.textContent = playing ? "Pause" : "Play";
  if (playing) {
    const frames = manifest.animations[animationSelect.value].frames;
    if (frameIndex === frames.length - 1) frameIndex = 0;
  }
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
  const cuteFish = catalog.assets.filter((asset) => asset.id.startsWith("cute-"));
  cuteRoster.hidden = !cuteFish.length;
  cuteRosterSummary.textContent = `${cuteFish.length} loài mới từ Cute Fish Pack`;
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
  rodSelect.value = rods[0]?.id ?? "";
  rodSelect.disabled = false;
  const lures = catalog.assets.filter((asset) => /^lure-[1-6]$/.test(asset.id));
  lureSelect.replaceChildren(...lures.map((asset) => new Option(`Mồi ${asset.id.slice(-1)}`, asset.id)));
  lureSelect.value = lures[0]?.id ?? "";
  lureSelect.disabled = !lures.length;
  await setView(currentView);
} catch (error) {
  showError(error);
  aquariumStatus.textContent = `Could not load the catalog: ${error.message}`;
}

