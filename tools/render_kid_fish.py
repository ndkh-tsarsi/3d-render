#!/usr/bin/env python3
"""Render all 42 aquarium fish locally with the shared children's cartoon skin."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import math
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def original_worker() -> None:
    import bpy
    from tools import blender_render, kid_fish_geometry, kid_fish_skin

    kid_fish_skin.install(blender_render, Path(bpy.data.filepath).stem)
    kid_fish_geometry.install(blender_render, Path(bpy.data.filepath).stem)
    args = blender_render.parse_args()
    blender_render.main()
    path = Path(args.output).resolve() / "manifest.json"
    kid_fish_skin.annotate(path)
    kid_fish_geometry.annotate(path)
    manifest = json.loads(path.read_text())
    manifest["skin"]["maxFrames"] = args.max_frames
    manifest["source"]["licenseFile"] = "../licenses/animated-fish-pack-by-quaternius.txt"
    path.write_text(json.dumps(manifest, indent=2) + "\n")


def assets() -> list[dict]:
    from pipeline import slugify
    from tools.render_cute_fish import WIDTHS

    original = ROOT / "raw/Animated Fish Pack by @Quaternius/Blends"
    cute = ROOT / "raw/Cute Fish Pack - Feb 2020/Blends"
    result = [{"id": slugify(name), "name": name, "path": original / f"{name}.blend", "cute": False}
              for name in ("Dolphin", "Fish1", "Fish2", "Fish3", "Manta ray", "Shark", "Whale")]
    result += [{"id": "cute-" + slugify(name), "name": name, "path": cute / f"{name}.blend", "cute": True}
               for name in sorted(WIDTHS)]
    return result


def main() -> None:
    from pipeline import find_blender, validate_output, write_catalog

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="dist-cat-toon-rounded-1024")
    parser.add_argument("--size", type=int, default=1024)
    parser.add_argument("--fps", type=float, default=12)
    parser.add_argument("--engine", choices=("cycles", "eevee"), default="eevee")
    parser.add_argument("--jobs", type=int, choices=(1, 2), default=2)
    parser.add_argument("--only", help="Comma-separated asset IDs, such as fish3,cute-clownfish,cute-shark")
    parser.add_argument("--max-frames", type=int, default=0, help="Limit samples for a preview render")
    parser.add_argument("--keep-existing", action="store_true", help="Resume complete matching skin renders")
    args = parser.parse_args()
    if args.size < 64 or not math.isfinite(args.fps) or args.fps <= 0 or args.max_frames < 0:
        parser.error("Use size>=64, positive finite fps, and nonnegative max-frames")
    blender = find_blender()
    if not blender:
        parser.error("Blender is not installed; run python3 pipeline.py setup first")
    roster = assets()
    if args.only:
        choices = list(dict.fromkeys(value.strip().casefold() for value in args.only.split(",")))
        selected = []
        for choice in choices:
            match = next((asset for asset in roster if asset["id"] == choice), None)
            if match is None:
                matches = [asset for asset in roster if asset["name"].casefold() == choice]
                if len(matches) != 1:
                    parser.error(f"Unknown or ambiguous fish '{choice}'; use its asset ID")
                match = matches[0]
            selected.append(match)
        roster = selected
    output = (ROOT / args.output).resolve()
    logs = output / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    threads = max(1, (os.cpu_count() or 4) // args.jobs)
    started = time.monotonic()

    def render(asset: dict) -> tuple[str, str]:
        source = asset["path"]
        if not source.is_file():
            raise FileNotFoundError(source)
        folder = output / asset["id"]
        manifest_path = folder / "manifest.json"
        if args.keep_existing and manifest_path.is_file():
            from tools.kid_fish_geometry import GEOMETRY_ID
            from tools.kid_fish_skin import STYLE_ID
            existing = json.loads(manifest_path.read_text())
            animation = existing.get("animations", {}).get("swim", {})
            if (existing.get("frameSize") == {"w": args.size, "h": args.size}
                    and animation.get("fps") == args.fps
                    and existing.get("skin", {}).get("id") == STYLE_ID
                    and existing.get("geometry", {}).get("id") == GEOMETRY_ID
                    and existing.get("skin", {}).get("maxFrames") == args.max_frames):
                return asset["id"], "existing"
        script = ROOT / "tools" / ("render_cute_fish.py" if asset["cute"] else "render_kid_fish.py")
        worker = "--cute-worker" if asset["cute"] else "--kid-worker"
        command = [str(blender), "--background", str(source), "--threads", str(threads),
                   "--python-exit-code", "1", "--python", str(script), "--", worker,
                   "--output", str(folder), "--size", str(args.size), "--fps", str(args.fps),
                   "--style", "cartoon", "--actions", "Swimming_Normal" if asset["cute"] else "swim",
                   "--engine", args.engine, "--max-atlas-size", "2048"]
        if not asset["cute"]:
            command.append("--add-face")
        if args.max_frames:
            command += ["--max-frames", str(args.max_frames)]
        t = time.monotonic()
        log_path = logs / f"{asset['id']}.log"
        with log_path.open("w") as log:
            result = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
        if result.returncode:
            raise RuntimeError(f"{asset['id']} failed; see {log_path}")
        return asset["id"], f"{time.monotonic() - t:.1f}s"

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = [pool.submit(render, asset) for asset in roster]
        for count, future in enumerate(concurrent.futures.as_completed(futures), 1):
            try:
                asset_id, timing = future.result()
            except Exception:
                for pending in futures:
                    pending.cancel()
                raise
            print(f"[kid-fish] {count}/{len(roster)} {asset_id}: {timing}", flush=True)
    licenses = output / "licenses"
    licenses.mkdir(exist_ok=True)
    for name, source in (
        ("cute-fish-pack-feb-2020.txt", ROOT / "raw/Cute Fish Pack - Feb 2020/License.txt"),
        ("animated-fish-pack-by-quaternius.txt", ROOT / "raw/Animated Fish Pack by @Quaternius/License.txt"),
    ):
        if source.is_file():
            shutil.copy2(source, licenses / name)
    write_catalog(output)
    validate_output(output)
    print(f"[kid-fish] Complete {len(roster)} fish in {time.monotonic() - started:.1f}s", flush=True)


if __name__ == "__main__":
    if "--kid-worker" in sys.argv:
        sys.argv.remove("--kid-worker")
        original_worker()
    else:
        main()
