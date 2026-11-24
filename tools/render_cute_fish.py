#!/usr/bin/env python3
"""Render all authored Cute Fish Pack swimmers locally without changing sources."""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Game-readable proportions rather than a shared square-frame size.
WIDTHS = {
    "Anglerfish": 105, "ArmoredCatfish": 130, "Betta": 75,
    "BlackLionFish": 100, "Blobfish": 110, "BlueGoldfish": 65,
    "BlueTang": 85, "ButterflyFish": 80, "CardinalFish": 55,
    "Clownfish": 60, "CoralGrouper": 155, "Cowfish": 90,
    "Flatfish": 95, "FlowerHorn": 95, "GoblinShark": 240,
    "Goldfish": 65, "Humphead": 180, "Koi": 105, "Lionfish": 100,
    "MandarinFish": 55, "MoorishIdol": 80, "ParrotFish": 120,
    "Piranha": 90, "Puffer": 85, "RedSnapper": 130, "RoyalGramma": 55,
    "Shark": 250, "Sunfish": 215, "Swordfish": 240, "Tang": 85,
    "Tetra": 50, "Tuna": 225, "Turbot": 95, "YellowTang": 75,
    "ZebraClownFish": 60,
}
# Mouth positions inside the visible body bounds for noses/foreheads that extend
# past the actual lips. Ordinary fish use the profile silhouette's front tip.
MOUTH_OVERRIDES = {
    "Blobfish": (0.10, 0.63), "Cowfish": (0.015, 0.81), "Puffer": (0.02, 0.48),
}


def annotate(output: Path) -> None:
    from tools.render_fishing_rods import alpha_pixels
    path = output / "manifest.json"
    manifest = json.loads(path.read_text())
    source_name = Path(manifest["source"]["file"]).stem
    frames = manifest["animations"]["swim"]["frames"]
    width, height, alpha = alpha_pixels(output / frames[0]["image"])
    visible = [(x, y) for y, row in enumerate(alpha) for x, value in enumerate(row) if value >= 24]
    if not visible:
        raise ValueError(f"Empty render: {source_name}")
    left = min(x for x, _ in visible)
    right = max(x for x, _ in visible) + 1
    top = min(y for _, y in visible)
    bottom = max(y for _, y in visible) + 1
    nose = [(x, y) for x, y in visible if x < left + max(3, round(width * 0.008))]
    body_width = WIDTHS[source_name]
    manifest["name"] = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", source_name)
    manifest["aquarium"] = {
        "pack": "cute-fish", "name": manifest["name"],
        "width": body_width, "speed": 42 if body_width >= 200 else 25,
        "catchable": body_width <= 155 and source_name not in {"Anglerfish", "Lionfish", "BlackLionFish"}, "facing": "left",
        "bounds": {"x": round(left / width, 6), "y": round(top / height, 6),
                   "w": round((right - left) / width, 6), "h": round((bottom - top) / height, 6)},
        "mouth": {"x": round((left + 1.5) / width, 6),
                  "y": round(sum(y + 0.5 for _, y in nose) / len(nose) / height, 6)},
    }
    if source_name in MOUTH_OVERRIDES:
        mouth_x, mouth_y = MOUTH_OVERRIDES[source_name]
        manifest["aquarium"]["mouth"] = {
            "x": round((left + (right - left) * mouth_x) / width, 6),
            "y": round((top + (bottom - top) * mouth_y) / height, 6),
        }
    manifest["source"]["pack"] = "Cute Fish Pack - Feb 2020"
    manifest["source"]["licenseFile"] = "../licenses/cute-fish-pack-feb-2020.txt"
    path.write_text(json.dumps(manifest, indent=2) + "\n")


def render_worker() -> None:
    import bpy
    from tools import blender_render
    # Three source files intentionally hide their mesh in the authored scene.
    # Show only meshes/rigs in this temporary render; never save the blend file.
    for obj in bpy.context.scene.objects:
        if obj.type in {"MESH", "ARMATURE"}:
            obj.hide_render = False
            obj.hide_viewport = False
            obj.hide_set(False)
    for collection in bpy.data.collections:
        collection.hide_render = False
        collection.hide_viewport = False
    slug = blender_render.slugify
    blender_render.slugify = lambda value: "cute-" + slug(value)
    from tools import kid_fish_geometry, kid_fish_skin
    kid_fish_skin.install(blender_render, Path(bpy.data.filepath).stem)
    kid_fish_geometry.install(blender_render, Path(bpy.data.filepath).stem)
    configure = blender_render.configure_scene
    def configure_scene(*args, **kwargs):
        result = configure(*args, **kwargs)
        bpy.context.scene.cycles.samples = int(os.environ.get("CUTE_FISH_SAMPLES", "16"))
        return result
    blender_render.configure_scene = configure_scene
    args = blender_render.parse_args()
    blender_render.main()
    annotate(Path(args.output).resolve())
    manifest_path = Path(args.output).resolve() / "manifest.json"
    kid_fish_skin.annotate(manifest_path)
    kid_fish_geometry.annotate(manifest_path)
    manifest = json.loads(manifest_path.read_text())
    manifest["skin"]["maxFrames"] = args.max_frames
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")


def main() -> None:
    from pipeline import find_blender, slugify, validate_output, write_catalog
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default="raw/Cute Fish Pack - Feb 2020/Blends")
    parser.add_argument("--output", default="dist-cute-fish-1024")
    parser.add_argument("--size", type=int, default=1024)
    parser.add_argument("--fps", type=float, default=12)
    parser.add_argument("--samples", type=int, default=16, help="Cycles samples per pixel; denoising stays enabled")
    parser.add_argument("--engine", choices=("cycles", "eevee"), default="cycles")
    parser.add_argument("--jobs", type=int, default=2)
    parser.add_argument("--only", help="Comma-separated exact source names")
    parser.add_argument("--max-frames", type=int, default=0)
    parser.add_argument("--keep-existing", action="store_true")
    args = parser.parse_args()
    if args.jobs < 1 or args.jobs > 2 or args.size < 64 or args.fps <= 0 or args.samples < 1:
        parser.error("Use 1–2 jobs, size>=64 and positive fps/samples")
    blender = find_blender()
    if not blender:
        parser.error("Blender is not installed; run pipeline.py setup")
    source = (ROOT / args.input).resolve()
    output = (ROOT / args.output).resolve()
    names = sorted(WIDTHS)
    if args.only:
        names = list(dict.fromkeys(name.strip() for name in args.only.split(",")))
        if any(name not in WIDTHS for name in names):
            parser.error("Unknown fish name in --only")
    output.mkdir(parents=True, exist_ok=True)
    logs = output / "logs"
    logs.mkdir(exist_ok=True)
    threads = max(1, (os.cpu_count() or 4) // args.jobs)
    started = time.monotonic()
    def render(name):
        blend = source / f"{name}.blend"
        if not blend.is_file():
            raise FileNotFoundError(blend)
        folder = output / ("cute-" + slugify(name))
        if args.keep_existing and (folder / "manifest.json").is_file():
            from tools.kid_fish_geometry import GEOMETRY_ID
            from tools.kid_fish_skin import STYLE_ID
            existing = json.loads((folder / "manifest.json").read_text())
            if (existing.get("skin", {}).get("id") == STYLE_ID
                    and existing.get("geometry", {}).get("id") == GEOMETRY_ID
                    and existing.get("skin", {}).get("maxFrames") == args.max_frames
                    and existing.get("frameSize") == {"w": args.size, "h": args.size}
                    and existing.get("animations", {}).get("swim", {}).get("fps") == args.fps):
                return name, "existing"
        command = [str(blender), "--background", str(blend), "--threads", str(threads),
                   "--python-exit-code", "1", "--python", str(Path(__file__).resolve()),
                   "--", "--cute-worker", "--output", str(folder), "--size", str(args.size),
                   "--fps", str(args.fps), "--style", "cartoon", "--actions", "Swimming_Normal",
                   "--engine", args.engine, "--max-atlas-size", "2048"]
        if args.max_frames:
            command += ["--max-frames", str(args.max_frames)]
        t = time.monotonic()
        with (logs / f"{folder.name}.log").open("w") as log:
            result = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                                    env={**os.environ, "CUTE_FISH_SAMPLES": str(args.samples)})
        if result.returncode:
            raise RuntimeError(f"{name} failed; see {logs / (folder.name + '.log')}")
        return name, f"{time.monotonic()-t:.1f}s"
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = [pool.submit(render, name) for name in names]
        for count, future in enumerate(concurrent.futures.as_completed(futures), 1):
            try:
                name, timing = future.result()
            except Exception:
                for pending in futures:
                    pending.cancel()
                raise
            print(f"[cute-fish] {count}/{len(names)} {name}: {timing}", flush=True)
    license_file = source.parent / "License.txt"
    if license_file.is_file():
        license_output = output / "licenses" / "cute-fish-pack-feb-2020.txt"
        license_output.parent.mkdir(exist_ok=True)
        shutil.copy2(license_file, license_output)
    write_catalog(output)
    validate_output(output)
    print(f"[cute-fish] Complete {len(names)} models in {time.monotonic()-started:.1f}s", flush=True)


if __name__ == "__main__":
    if "--cute-worker" in sys.argv:
        sys.argv.remove("--cute-worker")
        render_worker()
    else:
        main()
