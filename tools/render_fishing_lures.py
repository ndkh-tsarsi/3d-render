#!/usr/bin/env python3
"""Render the six authored Cute Fish Pack lures locally from a clear side view."""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def annotate(output: Path) -> None:
    from tools.render_fishing_rods import alpha_pixels

    path = output / "manifest.json"
    manifest = json.loads(path.read_text())
    frame = manifest["animations"]["still"]["frames"][0]
    width, height, alpha = alpha_pixels(output / frame["image"])
    points = [(x, y) for y, row in enumerate(alpha) for x, value in enumerate(row) if value >= 24]
    if not points:
        raise ValueError("The lure render is empty")
    left = min(x for x, _ in points)
    right = max(x for x, _ in points) + 1
    top = min(y for _, y in points)
    bottom = max(y for _, y in points) + 1
    band = max(2, round(width * 0.004))
    def endpoint(first: int, last: int, x: float) -> dict:
        ys = [y + 0.5 for px, y in points if first <= px < last]
        return {"x": round(x / width, 6), "y": round(sum(ys) / len(ys) / height, 6)}
    manifest["prop"] = {
        "kind": "fishing-lure",
        "number": int(manifest["id"][-1]),
        # The authored eye/nose is at negative source X. After the temporary
        # scene rotation that is the left edge; the metal treble hook is right.
        "lineAnchor": endpoint(left, left + band, left + 0.5),
        "biteAnchor": endpoint(right - band, right, right - 0.5),
        "bounds": {
            "x": round(left / width, 6), "y": round(top / height, 6),
            "w": round((right - left) / width, 6), "h": round((bottom - top) / height, 6),
        },
        "hasHook": True,
        "sourceView": "+Z",
    }
    manifest["name"] = f"Fishing lure · {manifest['prop']['number']}"
    path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"[fishing-lures] {manifest['id']}: {json.dumps(manifest['prop'])}", flush=True)


def render_worker() -> None:
    import bpy
    from tools import blender_render

    roots = [obj for obj in bpy.context.scene.objects if obj.parent is None]
    pivot = bpy.data.objects.new("LureSideView", None)
    bpy.context.scene.collection.objects.link(pivot)
    for obj in roots:
        matrix = obj.matrix_world.copy()
        obj.parent = pivot
        obj.matrix_world = matrix
    # Lures are authored lengthwise on X with their painted eyes on the Z sides.
    # Face that side toward the shared camera while keeping the nose at left.
    # Only this temporary render scene changes; .blend sources stay untouched.
    pivot.rotation_euler.x = math.pi / 2
    pivot.rotation_euler.z = math.pi / 2
    bpy.context.view_layer.update()

    configure = blender_render.configure_scene
    def configure_lure(*args, **kwargs):
        result = configure(*args, **kwargs)
        for lineset in bpy.context.view_layer.freestyle_settings.linesets:
            lineset.linestyle.thickness = max(1.25, bpy.context.scene.render.resolution_x / 512)
        return result
    blender_render.configure_scene = configure_lure
    args = blender_render.parse_args()
    blender_render.main()
    annotate(Path(args.output).resolve())


def main() -> None:
    from pipeline import find_blender, slugify, validate_output, write_catalog

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default="raw/Cute Fish Pack - Feb 2020/Blends")
    parser.add_argument("--output", default="dist-lures-1024")
    parser.add_argument("--size", type=int, default=1024)
    parser.add_argument("--only", type=int, choices=range(1, 7))
    args = parser.parse_args()
    if args.size < 64:
        parser.error("--size must be at least 64")
    blender = find_blender()
    if not blender:
        parser.error("Blender is not installed; run python3 pipeline.py setup first")
    output = (ROOT / Path(args.output).expanduser()).resolve()
    sources = (ROOT / Path(args.input).expanduser()).resolve()
    for number in ([args.only] if args.only else range(1, 7)):
        source = sources / f"Lure_{number}.blend"
        if not source.is_file():
            parser.error(f"Missing source: {source}")
        subprocess.run([
            str(blender), "--background", str(source), "--python-exit-code", "1",
            "--python", str(Path(__file__).resolve()), "--", "--lure-worker",
            "--output", str(output / slugify(source.stem)), "--size", str(args.size),
            "--style", "cartoon", "--max-atlas-size", "2048",
        ], cwd=ROOT, check=True)
    write_catalog(output)
    validate_output(output)


if __name__ == "__main__":
    if "--lure-worker" in sys.argv:
        sys.argv.remove("--lure-worker")
        render_worker()
    else:
        main()
