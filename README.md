# Automated 3D → HTML5 sprite pipeline

## Cat Defense standalone game

The separate **Cat Defense** game is ready to run as pure HTML/CSS/JavaScript, with 17 native cats, 15 enemies and a versioned external action/event API. It can be embedded in React or Next.js using an iframe; authentication and score acceptance stay in the host.

Git stores the source, tools, tests and measured test fixtures. Rendered atlases, downloadable builds, additional `raw/` packs, dependencies and local configuration are ignored. For a fresh checkout, restore `assets/` from your `ready-games/cat-defense/` package into `game/cat-defense/assets/` before starting the game, or regenerate it with the local export/asset tools. To restore the fishing preview, copy the contents of `ready-games/fishing/` into `dist/`.

```sh
npm install
npm run dev
```

Open the standalone game at `http://127.0.0.1:8780/` or the Next.js integration test portal at `http://127.0.0.1:3010/`. Test login uses any display name and code **`cat-test`**. The portal controls enemy speed, shots, fence HP, explosions, cat selection and host scores.

`npm run build:defense` packages existing local assets into **`build/cat-defense-standalone/`** and **`build/cat-defense-standalone.zip`**. This complete static folder needs only an HTTP server. It includes a browser SDK and plain JavaScript host example; no render or GitHub build is involved. See [the integration guide](docs/cat-defense.md) for the React example, API and protocol. The fishing/gallery pipeline below remains separate.

`npm test` uses committed metadata fixtures and works without rendered assets. After regenerating local assets, run `node tools/capture_game_test_fixtures.mjs` to refresh those fixtures and `npm run test:fixtures` to check they match the local renders. `npm run typecheck` regenerates the ignored Next.js declarations before checking the portal and React example.

## Sprite rendering pipeline

The complete two-game release is in **`build/ready-games/`**, with its downloadable archive **`build/ready-games.zip`**. It includes the fishing game, cat defense, all runtime assets, licenses, the defense iframe SDK, a game-selection page and local launchers. Open `START_PREVIEW.command` or run `python3 serve.py` inside that folder, then visit `http://127.0.0.1:8790/`. `python3 verify.py` checks the packaged files. Repackage the already prepared local builds with `npm run build:ready`; this copies assets and never renders them.

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

Render all six dinosaurs locally in the same Cat-inspired Toon family:

```bash
python3 tools/render_kid_dinosaurs.py --size 1024 --engine eevee --jobs 2
```

The default isolated output is `build/work/dinosaurs-cartoon-1024/`. It includes all 36 native actions (785 frames at 12 fps), transparent PNGs and atlases up to 2048 px. Dinosaurs get distinct bright palettes, cream undersides, warm chocolate outlines, rounded surfaces, and glinting eyes attached with the original head skin weights. Horns, plates, claws, teeth, rigs, and action timing are preserved; source `.blend` files are never saved. `--only trex`, `--actions idle,attack`, and `--max-frames 3` create a smaller review sample. `--keep-existing` resumes completed matching assets. Use `--engine cycles` for the CPU fallback.

The single-character gallery keeps only three atlas pages in memory and prefetches the next page, so long 1024 px dinosaur animations remain practical to preview. Switching assets releases the old pages. Aquarium gameplay and fish assets are unaffected.

The fish-specific commands replace only aquatic asset folders in an existing `dist/`. The dinosaur helper writes its separate review output under `build/work/`. `python3 pipeline.py render` or `render_all.command` defaults to the original seven aquatic and six dinosaur characters under `raw/`. Additional packs and props require an explicit `--input`; this prevents similarly named models in new packs from overwriting existing sprites. If neither original pack is present, default discovery falls back to the current project folder.

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

The local preview opens in **Câu cá** mode with a cat fishing above all **42 species** from the original models and Cute Fish Pack. The tank and catch counter occupy the main play area, with large **Thả mồi** and **Giật cần** controls directly beneath it. The bite cue highlights when a fish bites. Cat, outfit, equipment and environment controls sit in separate cards beside the tank; narrow screens put the game and action controls first. The expandable fish guide keeps the play area clear.

The cat stands on a wooden pier above a distinct water surface, with sky behind it. Fish swim below that surface; only a hooked fish rises into the air during a successful pull. The sky, deck, bait and swimming bounds share the same responsive scene geometry.

**Chọn mèo** selects the orange, gray, or white cat family; **Trang phục** selects one of that family's five supplied outfits, plus the orange cat's bonus boxer and guardian outfits. Every outfit includes its original clothes, scarves, helmets, goggles or hat and has the same five fishing reactions. The selected cat's portrait follows the outfit. Fish climb, dive, and choose new directions. **Đổi đường bơi** randomizes the group; **Tạm dừng** freezes fish, the cat's animation, and the fishing line. **Cần câu** starts at **Cấp 5**; choose **Cấp 1–4** or **Tắt** to compare. The rod stays attached to its front paw in every pose. **Bộ sưu tập** also lets you inspect each fish, dinosaur, rod, lure, cat, and the original boy asset. Both views support Retina displays and use existing local assets; opening the aquarium does not run Blender.

Changing the cat or outfit keeps the selected rod, lure and catch count. It cancels an unfinished bite or pull while the replacement loads. Only the selected cat is decoded; switching releases the previous cat's textures.

The fishing motion uses the supplied arm artwork at its original assembly scale. The arm is separated from the resting body and rotated for the pull, keeping its original silhouette, colors and outlines. A transparent `hand.png`, its `handLayer` descriptor and the per-frame `handTransform` affine matrix keep the native arm and rod aligned. The preview layers the handle behind the cat, the shaft in front, and the native arm over the grip. Clothes, faces and headgear retain their original artwork.

Orange cats use the complete original near arm from the `Gun` vector layer, including its yellow cuff and closed white paw. The rounded cream tip is the shoulder; the fishing grip belongs inside the white palm. The packager separates these original vector draws from the weapon and far supporting paw, and checks that the grip stays on the visible white palm in every pose.

Gray cats retain the complete bent arm and paw drawn in `Body`; their rotation pivots sit inside the opaque shoulder rather than on the cut's antialiased corner. White cats retain the original exposed forearm, yellow cuff and white paw from `Gun`, placed using the original skeleton. The source weapon hid the white cats' upper arm, so the existing exposed attachment rotates without inventing a longer limb. The guardian combines its original `Hand1` forearm with the closed fist separated from the `Hand2` plunger; the boxer keeps its complete original red glove.

`armRig` identifies `fishing-native-art-v1`; each frame's `arm` records the source shoulder, elbow, wrist, grip and angles after rotation. These are landmarks on the original bent arm. The motion preserves that bend and rotates the supplied image rather than drawing a replacement limb. Right-facing source assemblies are mirrored together toward the water in the aquarium.

`handLayer.overlayBounds` limits the foreground redraw to the distal grip area. The full native arm stays in the exported PNGs, while shoulder pixels hidden by the head stay hidden in the aquarium. The rod pivots upward around the measured grip during the pull.

To check the grip in the local pool, run `python3 pipeline.py preview`, open `http://127.0.0.1:8000/#aquarium`, and confirm **Fishing rod: Level 5** is selected. Switch through **Mèo** and **Trang phục**, press **Thả mồi**, then press **Giật cần** when a fish bites. The paw should cover the rod grip during idle, bite, pull, celebration, and miss poses. The current portable fishing build is `build/html5-assets/`.

Small fish investigate the bait automatically. **Thả mồi** starts a new approach; **Giật cần** becomes available during the bite. The cat opens its eyes wide with a surprised mouth and an alert mark when a fish bites. Press **Giật cần** to play a forty-frame pull: the original arm rotates with the rod and the fish rises beside the pier. A successful landing increases **Cá đã câu** once and triggers a 1.6-second happy dance with a smile, tail wag, and warm-colored stars, then the fish returns to the water. Each bite and celebration starts from its own first frame. The count lasts for the current page session and survives rod/lure changes and **Đổi đường bơi**. Cancelling an unfinished pull awards no point. Pause freezes the entire interaction, including expressions and celebration effects.

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
python3 tools/package_fishing_cat.py --output build/work/cat-native-arm-primary
python3 tools/package_bonus_fishing_cats.py --output build/work/cat-native-arm-bonus
python3 tools/merge_local_assets.py --source build/work/cat-native-arm-primary --source build/work/cat-native-arm-bonus
```

Rod renders use thin outlines to keep their shafts visible. The cat packagers compose all fifteen main Craftpix characters (three families with five outfits each) and the two bonus cats from their own head, clothed body, tail, native arm and separate hats, omitting weapons. The holding arm keeps its source size and style; it rotates independently of the body without leaving a second copy in its resting position. Each of the seventeen variants has 112 frames at 512 px and 18 fps: twelve Idle, forty Pull, twelve Bite, twenty-four Celebrate, and twenty-four Miss frames, with measured feet, paw and head anchors. Expressions respect each character's face and retain goggles, headgear and masks. The cat packaging commands use macOS CoreGraphics to rasterize the supplied vector parts at 4× for sharp Retina display; Blender handles the CPU image composition. The source artwork and license stay unchanged, and the license is copied into the output. The original boy remains available through `tools/package_boy.py`.

The commands above keep both render cohorts under `build/work/`. For a small costume review, use `python3 tools/package_fishing_cat.py --only 3,9,14 --probe --output build/work/cat-fishing-review`. The merge helper installs complete generated asset folders and their licenses into the existing `dist/`, refreshes the preview, and restores the previous copy if validation fails. It refuses labeled probe renders and does not render or publish anything. After merging, run `python3 tools/build_static_assets.py --replace` to refresh the portable folder.

For a local preview:

```bash
python3 pipeline.py preview
```

Then open [http://127.0.0.1:8000](http://127.0.0.1:8000). The preview uses the generated atlas PNGs and JSON directly, so it also serves as a browser integration smoke test.

To collect the current local renders into one portable static folder:

```bash
python3 tools/build_static_assets.py
```

The result is `build/html5-assets/`, containing the complete demo, catalog, sprite frames, atlases, metadata, and licenses copied unchanged from `dist/`. Run its `START_PREVIEW.command` on macOS or `python3 serve.py` inside the folder. No Blender or rendering is involved. Use `--replace` to refresh this generated package after updating local renders, or `--output build/<name>` to make another package. Replacement validates the new copy before swapping it into place.

`dist/` serves the active local preview. Other `dist-*` folders are test outputs, intermediate batches, or older render variants, and are not runtime inputs. Unique historical source/reference files are preserved in `references/render-history/` before cleanup. Keep `raw/`, `tools/`, and `web/` as the reproducible project sources.

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
