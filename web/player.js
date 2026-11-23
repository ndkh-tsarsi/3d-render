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

async function fetchJson(path) {
  const response = await fetch(path);
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
  const asset = catalog.assets[index];
  const base = asset.manifest.slice(0, asset.manifest.lastIndexOf("/") + 1);
  manifest = await fetchJson(asset.manifest);
  atlasImages = await Promise.all(manifest.atlases.map((page) => loadImage(base + page.image)));
  animationSelect.replaceChildren(
    ...Object.keys(manifest.animations).map((name) => new Option(name, name))
  );
  canvas.width = manifest.frameSize.w;
  canvas.height = manifest.frameSize.h;
  frameIndex = 0;
  elapsed = 0;
  status.textContent = `${manifest.name} · ${manifest.view.cameraAxis} profile`;
  chooseAnimation();
}

function chooseAnimation() {
  frameIndex = 0;
  elapsed = 0;
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
      while (elapsed >= frames[frameIndex].durationMs) {
        elapsed -= frames[frameIndex].durationMs;
        if (frameIndex + 1 < frames.length) frameIndex += 1;
        else if (animation.loop) frameIndex = 0;
        else playing = false;
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
  playing = true;
  pauseButton.textContent = "Pause";
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

