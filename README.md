# Automated 3D → HTML5 sprite pipeline

This project turns the animated `.blend` characters under `raw/` into transparent 2D sprite frames, browser-safe PNG atlases, JSON metadata, and an HTML5 preview player.

It is dependency-free apart from Python 3. Blender is detected automatically. If Blender is missing, `setup` downloads the official Blender 5.3.0 package, verifies its SHA-256 checksum, and installs a complete project-local copy under `.tools/`—no administrator access required.

## One-command render

Render all **42 aquarium characters** locally with rounded geometry and the **Cat-inspired Toon** skin:

```bash
python3 tools/render_kid_fish.py --output dist --engine eevee --jobs 2
```

This renders 1024×1024 transparent frames at 12 fps. The supplied `raw/craftpix-net-397030-free-cartoon-cat-defense-game-asset-kit` is the color reference: warm cream areas, chocolate outlines, solid dark pupils and restrained three-tone shading. Fish keep separate orange, blue, teal, pink, purple and gold families drawn from the cats and their accessories. Reference colors are centralized in `tools/cat_toon_palette.py`; cat artwork is not copied into fish assets.

Cute Fish Pack models get rounded heads, bodies and fin edges through two levels of Catmull-Clark subdivision, with selective boundary creases retaining the span of long fins, rays and bills. The original seven keep their existing smooth level-one surfaces so generated eyes and smiles stay attached. Their painted face details are excluded from the extra outline pass so small eye highlights remain visible. Authored stripes, source animation and game size proportions are preserved; silhouette and fishing anchors are measured again after rounding. Painted details use a named UV layer projected from the undeformed source mesh, so they follow the fish as it swims. Original source files are never saved or overwritten. Other existing assets in `dist/` stay available.

Use `--only cute-clownfish,cute-puffer,shark` for a subset, `--max-frames 3` for a quick sample, or `--keep-existing` to resume a completed render with matching skin and geometry versions. The IDs `shark` and `cute-shark` distinguish the two packs. Eevee uses the local GPU; `--engine cycles` is the CPU fallback. Neither command publishes anything or starts GitHub Actions. The default isolated output is `dist-cat-toon-rounded-1024`; use `--output dist` to refresh the local preview package directly.

The original seven aquatic characters can also be rendered with the base cartoon renderer, including generated eyes and mouths:

```bash
python3 pipeline.py render --input "raw/Animated Fish Pack by @Quaternius/Blends" --style cartoon --add-face --size 1024 --max-atlas-size 2048 --output dist
```

This replaces only the aquatic asset folders in an existing `dist/`; dinosaurs stay unchanged. `python3 pipeline.py render` or `render_all.command` defaults to the original seven aquatic and six dinosaur characters under `raw/`. Additional packs and props require an explicit `--input`; this prevents similarly named models in new packs from overwriting existing sprites. If neither original pack is present, default discovery falls back to the current project folder.

The render command automatically:

1. Finds or installs Blender.
2. Discovers `.blend` files in the curated original packs or the explicit `--input` paths.
3. Preserves and enhances the authored color intent while upgrading old Blender 2.79 materials to modern Principled materials.
4. Smart-fills genuinely blank gray materials with a deterministic semantic palette.
5. Detects the armature and all animation actions.
6. Samples the 24 fps source actions at 12 fps.
7. Scans every sampled pose to make a stable, non-jittering orthographic camera.
8. Renders transparent PNG frames with CPU-safe Cycles (`1024 × 1024` in the command above; the CLI default is `256 × 256`).
9. Packs frames into atlas pages no larger than `2048 × 2048`.
10. Writes manifests, validates every reference and atlas rectangle, and builds the HTML5 preview.

Source `.blend`, `.fbx`, `.obj`, and license files are never modified. Generated files go to `dist/`.

## Preview

View the rendered models and animations online at [the GitHub Pages preview](https://ndkh-tsarsi.github.io/3d-render/).

The local preview opens in **Aquarium** mode with an orange cat fishing above all **42 species** from the original models and Cute Fish Pack. Fish climb, dive, and choose new directions. **New paths** randomizes the group; **Pause** freezes fish, the cat's animation, and the fishing line. Choose **Fishing rod → Level 1–5** to give the cat a rod from the Cute Fish Pack, or choose **Off**. The rod stays attached to its front paw in every pose. **Single character** also lets you inspect each fish, dinosaur, rod, lure, cat, and the original boy asset. Both views support Retina displays and use existing local assets; opening the aquarium does not run Blender.

Small fish investigate the bait automatically. **Thả mồi** starts a new approach; **Giật cần** becomes available during the bite. The cat opens its eyes wide with a surprised mouth and an alert mark when a fish bites. Press **Giật cần** to animate it leaning back and pulling the fish up beside the pier. A successful landing increases **Cá đã câu** once and triggers a 1.6-second happy dance with a smile, tail wag, and warm-colored stars, then the fish returns to the water. Each bite and celebration starts from its own first frame. The count lasts for the current page session and survives rod/lure changes and **Đổi đường bơi**. Cancelling an unfinished pull awards no point. Pause freezes the entire interaction, including expressions and celebration effects.

If the three-second bite window expires or the fish leaves before it can be caught, the cat shows a disappointed face, lowers its head and paw, and lets its tail droop for 1.6 seconds before returning to idle. The score stays unchanged. **Thả mồi** can start another attempt immediately; changing rods, turning the rod off, or resetting paths simply cancels the interaction. Pause freezes this reaction too.

**Âm thanh: Tắt/Bật** controls four short, gentle effects: a bubble cue when a fish bites, a pluck when reeling starts, an ascending chime for a catch, and a descending tone when a fish escapes. Sound starts off and remembers your choice on this browser. Enable it with the button; on later visits, your first tap or keyboard interaction unlocks playback. Each cue plays once per event. Muting, pausing, hiding the tab, switching views, or changing the rig stops any current effect. The effects are synthesized locally with Web Audio; no sound download or audio service is needed.

The cat and fish share the responsive proportions in `web/scene-sizing.js`. The cat is approximately 108–148 CSS pixels tall; reef fish are roughly one quarter of that height in length, sharks slightly longer than the cat is tall, and the whale remains the longest. Tall species such as sunfish retain their aspect ratio but stay below 72% of the cat's height. Authored visible bounds keep transparent padding out of the measurements. Fish textures are decoded for the largest supported layout so resizing stays sharp without rerendering the assets.

**Mồi** selects one of six actual Cute Fish Pack lures, including their metal hooks. The rope attaches to the lure's nose and the fish's mouth meets its hook. Once the fish bites, the entire lure and hook disappear through the bite, pull, and landing; the rope follows the mouth directly. The lure becomes visible again when the fish releases or the next round starts. Fish sizes are scaled by species: clownfish and small reef fish are much smaller than shark, dolphin, manta and whale. Cat-inspired Toon uses warm outlined color blocks and matte shadows against a light turquoise aquarium. Cute Fish Pack fish retain their authored face geometry, pattern regions and swimming animations, with dark warm pupils and white highlights.

Render all 35 Cute Fish Pack species locally, keeping their IDs separate from the original models:

```bash
python3 tools/render_cute_fish.py --output dist --size 1024 --engine eevee --jobs 1
```

This optional helper renders one looping `swim` clip per species from `Swimming_Normal` at 12 fps. It excludes docks, rods, lures, the boat, and worm. IDs use a `cute-` prefix, so the new shark cannot overwrite the original shark. Per-species `manifest.aquarium` metadata supplies the intended body width, speed, facing, mouth anchor, and catch eligibility. The aquarium adapts its atlas decoding to the displayed fish size, keeping full-resolution source images for individual inspection. Rendering does not publish anything or start GitHub Actions.

Eevee uses the local GPU when available. Omit `--engine eevee` to use the CPU Cycles fallback. `--only Clownfish,BlueTang` renders a subset; `--jobs` accepts 1 or 2 concurrent Blender processes. The original `.blend` files are never saved or overwritten.

The original source packs live under `raw/`. To regenerate just the added fishing props and package the cat:

```bash
python3 tools/render_fishing_rods.py --output dist --size 1024
python3 tools/render_fishing_lures.py --output dist --size 1024
python3 tools/package_fishing_cat.py --output dist
```

Rod renders use thin outlines to keep their shafts visible. The cat packager composes the supplied Craftpix Cat1 head, body, tail, and forepaw without its weapon. It creates 84 frames at 512 px: twelve Idle, twelve Pull, twelve Bite, twenty-four Celebrate, and twenty-four Miss frames, with feet, paw, and head anchors. The extra expressions use vector shapes that match the original warm outlines and fur colors. On macOS, CoreGraphics rasterizes the supplied vector parts at 4× for sharp Retina display; other platforms use the supplied PNG parts. Blender handles the CPU image composition. The source artwork and license stay unchanged, and the license is copied into the output. The original boy remains available through `tools/package_boy.py`.

For a local preview:

```bash
python3 pipeline.py preview
```

Then open [http://127.0.0.1:8000](http://127.0.0.1:8000). The preview uses the generated atlas PNGs and JSON directly, so it also serves as a browser integration smoke test.

## Useful commands

```bash
# Only verify/install Blender
python3 pipeline.py setup

# Fast smoke test for one character and two actions
python3 pipeline.py render --only Trex --actions idle,run --max-frames 8 --output dist-smoke

# Render the original fish and dinosaur characters at 512 px and 15 fps
python3 pipeline.py render --size 512 --fps 15 --max-atlas-size 4096

# Give every model a new generated palette
python3 pipeline.py render --recolor

# Render a single cartoon fish sample with cel shading, outlines, eyes, and a mouth
python3 pipeline.py render --only Fish1 --actions swim --style cartoon --add-face --size 256 --fps 12 --output dist-cartoon

# Apply the base cartoon style and facial features to all seven original aquatic models
python3 pipeline.py render --input "raw/Animated Fish Pack by @Quaternius/Blends" --style cartoon --add-face --size 1024 --output dist

# Use Eevee on a machine with an available GPU (faster)
python3 pipeline.py render --engine eevee

# Render only a specific file or directory (repeat --input as needed)
python3 pipeline.py render --input "raw/Dinosaur Animated Pack - Dec 2018/Blends/Trex.blend"

# Validate an existing output without rendering
python3 pipeline.py validate --output dist
```

Set `BLENDER_BIN=/path/to/blender` if you want to force a particular Blender executable.

## GitHub Actions

Blender rendering is performed locally. Publish the validated local package to the dedicated static-assets branch:

```bash
python3 tools/publish_local_assets.py --output dist --require-aquatic-size 1024 --dry-run
python3 tools/publish_local_assets.py --output dist --require-aquatic-size 1024
```

The publisher validates the package, writes the `published-assets` branch, and uses a normal push. It leaves the `main` checkout and index unchanged. The static branch contains the locally generated images, atlas metadata, preview files, and licenses; it does not depend on expiring Actions artifacts.

Run [Deploy preview without rendering](https://github.com/ndkh-tsarsi/3d-render/actions/workflows/deploy-preview.yml) to publish those files to [GitHub Pages](https://ndkh-tsarsi.github.io/3d-render/). It checks out the local asset package, applies the latest player, validates, and deploys. No Blender process runs on Actions. Player changes under `web/` also trigger this deployment. The player sizes its canvas to the displayed dimensions multiplied by the screen's pixel ratio, so Retina screens can use the higher-resolution source images.

Successful deployment runs provide `html5-local-assets-<run number>` under **Artifacts**, retained for 30 days. The ZIP contains the full preview and both model packs. The old remote [Render HTML5 assets workflow](https://github.com/ndkh-tsarsi/3d-render/actions/workflows/render-assets.yml) is manual-only and never starts on pushes.

After extracting the ZIP, serve its folder:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000) to play the animations. Generated assets stay out of `main` history and live on `published-assets`. No repository secrets are required.

For a fork, enable **Settings → Pages → Build and deployment → Source: GitHub Actions** before running the workflow. Pages must be available for the repository's visibility and account plan.


## Output contract

Each character folder contains:

```text
dist/trex/
├── frames/
│   ├── idle/0000.png
│   └── run/0000.png
├── atlas-0.png
├── atlas-0.json
├── manifest.json
└── thumbnail.png
```

- `atlas-N.json` is Pixi/TexturePacker-style page metadata.
- `manifest.json` joins animation frames across atlas pages and includes FPS, looping, source action names, stable pivot, source frame, and license data.
- `catalog.json` lists every generated character.
- `player.js` is a small Canvas reference loader suitable for adapting to Phaser, PixiJS, or a custom engine.

Looping is enabled for `idle`, `walk`, `run`, and `swim`. `attack`, `jump`, and `death` are one-shot. Opposite facing directions should be mirrored at runtime, as the included player demonstrates, rather than rendered twice.

The included Quaternius source packs declare the models CC0 1.0 in their `License.txt` files.
