# Automated 3D → HTML5 sprite pipeline

This project turns the animated `.blend` characters in this folder into transparent 2D sprite frames, browser-safe PNG atlases, JSON metadata, and an HTML5 preview player.

It is dependency-free apart from Python 3. Blender is detected automatically. If Blender is missing, `setup` downloads the official Blender 5.3.0 package, verifies its SHA-256 checksum, and installs a complete project-local copy under `.tools/`—no administrator access required.

## One-command render

From Terminal:

```bash
python3 pipeline.py render
```

Or on macOS, double-click `render_all.command`.

The render command automatically:

1. Finds or installs Blender.
2. Discovers every `.blend` file below this folder.
3. Preserves and enhances the authored color intent while upgrading old Blender 2.79 materials to modern Principled materials.
4. Smart-fills genuinely blank gray materials with a deterministic semantic palette.
5. Detects the armature and all animation actions.
6. Samples the 24 fps source actions at 12 fps.
7. Scans every sampled pose to make a stable, non-jittering orthographic camera.
8. Renders transparent `256 × 256` PNG frames with CPU-safe Cycles by default.
9. Packs frames into atlas pages no larger than `2048 × 2048`.
10. Writes manifests, validates every reference and atlas rectangle, and builds the HTML5 preview.

Source `.blend`, `.fbx`, `.obj`, and license files are never modified. Generated files go to `dist/`.

## Preview

View the rendered models and animations online at [the GitHub Pages preview](https://ndkh-tsarsi.github.io/3d-render/).

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

# Render every model at 512 px and 15 fps
python3 pipeline.py render --size 512 --fps 15 --max-atlas-size 4096

# Give every model a new generated palette
python3 pipeline.py render --recolor

# Use Eevee on a machine with an available GPU (faster)
python3 pipeline.py render --engine eevee

# Render only a specific file or directory (repeat --input as needed)
python3 pipeline.py render --input "Dinosaur Animated Pack - Dec 2018/Blends/Trex.blend"

# Validate an existing output without rendering
python3 pipeline.py validate --output dist
```

Set `BLENDER_BIN=/path/to/blender` if you want to force a particular Blender executable.

## GitHub Actions

The [Render HTML5 assets workflow](https://github.com/ndkh-tsarsi/3d-render/actions/workflows/render-assets.yml) runs automatically on every push to `main`. You can also start it from **Actions → Render HTML5 assets → Run workflow**.

It installs the required Linux libraries, downloads and verifies Blender 5.3.0 (cached between runs), renders every model and animation with CPU Cycles, and validates the output. A model coverage check prevents incomplete renders from being uploaded. After validation, a separate deployment job publishes the same assets to [GitHub Pages](https://ndkh-tsarsi.github.io/3d-render/).

Open a successful run and download `html5-assets-<run number>` from **Artifacts**, or use the download link in the run summary. The ZIP contains the HTML5 preview, catalog, transparent frames, atlas PNGs, JSON metadata, and source-pack licenses. Downloads are retained for 30 days.

After extracting the ZIP, serve its folder:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000) to play the animations. Generated assets are uploaded by the workflow and stay out of Git history. No repository secrets are required.

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
