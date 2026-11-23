import { Aquarium } from "./aquarium.js?v=aquarium-1";

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

const aquarium = new Aquarium(document.querySelector("#aquarium-stage"), {
  onStatus(message) {
    aquariumStatus.textContent = message;
  },
  onReady(count) {
    aquariumReady = true;
    aquariumStatus.hidden = true;
    aquariumCount.textContent = `${count} swimmers · one little ocean`;
    aquariumPause.disabled = false;
    aquariumReset.disabled = false;
  },
});

async function ensureAquarium() {
  if (!aquariumLoadPromise) {
    aquariumLoadPromise = aquarium.load(catalog).catch((error) => {
      aquariumLoadPromise = null;
      throw error;
    });
  }
  await aquariumLoadPromise;
  aquarium.setActive(currentView === "aquarium");
}

function startSingleAnimation() {
  if (singleAnimationFrame === null && currentView === "sprite" && manifest) {
    lastTime = performance.now();
    singleAnimationFrame = requestAnimationFrame(animate);
  }
}

async function setView(view) {
  currentView = view;
  aquariumPanel.hidden = view !== "aquarium";
  spritePanel.hidden = view !== "sprite";
  aquariumViewButton.setAttribute("aria-pressed", String(view === "aquarium"));
  spriteViewButton.setAttribute("aria-pressed", String(view === "sprite"));
  aquarium.setActive(view === "aquarium" && aquariumReady);
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
  aquarium.setPlaying(aquariumPlaying);
  aquariumPause.textContent = aquariumPlaying ? "Pause" : "Play";
});
swimSpeed.addEventListener("input", () => {
  aquarium.setSpeed(Number(swimSpeed.value));
  speedValue.value = `${Number(swimSpeed.value)}×`;
});
aquariumReset.addEventListener("click", () => aquarium.reset());

function showError(error) {
  console.error(error);
  status.textContent = error.message;
}

try {
  pauseButton.disabled = true;
  await setView(currentView);
  catalog = await fetchJson("catalog.json");
  assetSelect.replaceChildren(
    ...catalog.assets.map((asset, index) => new Option(asset.name, String(index)))
  );
  await setView(currentView);
} catch (error) {
  showError(error);
  aquariumStatus.textContent = `Could not load the catalog: ${error.message}`;
}

