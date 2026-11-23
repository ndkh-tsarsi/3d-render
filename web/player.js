const assetSelect = document.querySelector("#asset");
const animationSelect = document.querySelector("#animation");
const mirrorInput = document.querySelector("#mirror");
const pauseButton = document.querySelector("#pause");
const canvas = document.querySelector("#stage");
const context = canvas.getContext("2d");
const status = document.querySelector("#status");
const details = document.querySelector("#details");

let catalog;
let manifest;
let atlasImages = [];
let frameIndex = 0;
let elapsed = 0;
let lastTime = performance.now();
let playing = true;
let assetRequestId = 0;
let pixelRatioQuery;

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
  requestAnimationFrame(animate);
}

pauseButton.addEventListener("click", () => {
  playing = !playing;
  pauseButton.textContent = playing ? "Pause" : "Play";
  if (playing) {
    const frames = manifest.animations[animationSelect.value].frames;
    if (frameIndex === frames.length - 1) frameIndex = 0;
  }
});
assetSelect.addEventListener("change", () => chooseAsset(Number(assetSelect.value)).catch(showError));
animationSelect.addEventListener("change", () => {
  chooseAnimation();
});

function showError(error) {
  console.error(error);
  status.textContent = error.message;
}

try {
  catalog = await fetchJson("catalog.json");
  assetSelect.replaceChildren(
    ...catalog.assets.map((asset, index) => new Option(asset.name, String(index)))
  );
  await chooseAsset(0);
  requestAnimationFrame(animate);
} catch (error) {
  showError(error);
}

