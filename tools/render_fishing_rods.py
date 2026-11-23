#!/usr/bin/env python3
"""Render the five Cute Fish Pack rods locally with thin ink and attachment anchors."""

from __future__ import annotations

import argparse
import json
import struct
import subprocess
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def alpha_pixels(path: Path) -> tuple[int, int, list[bytearray]]:
    """Read the renderer's non-interlaced 8-bit RGBA PNG without dependencies."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"Not a PNG: {path}")
    offset = 8
    compressed = bytearray()
    width = height = 0
    while offset < len(data):
        length = struct.unpack_from(">I", data, offset)[0]
        kind = data[offset + 4:offset + 8]
        chunk = data[offset + 8:offset + 8 + length]
        if kind == b"IHDR":
            width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", chunk)
            if (depth, color, compression, filtering, interlace) != (8, 6, 0, 0, 0):
                raise ValueError(f"Expected 8-bit non-interlaced RGBA: {path}")
        elif kind == b"IDAT":
            compressed.extend(chunk)
        elif kind == b"IEND":
            break
        offset += length + 12
    raw = zlib.decompress(compressed)
    stride = width * 4
    if not width or not height or len(raw) != height * (stride + 1):
        raise ValueError(f"Invalid PNG pixel data: {path}")
    previous = bytearray(stride)
    alphas = []
    for y in range(height):
        start = y * (stride + 1)
        mode = raw[start]
        row = bytearray(raw[start + 1:start + 1 + stride])
        for i in range(stride):
            left = row[i - 4] if i >= 4 else 0
            up = previous[i]
            upper_left = previous[i - 4] if i >= 4 else 0
            if mode == 1:
                predictor = left
            elif mode == 2:
                predictor = up
            elif mode == 3:
                predictor = (left + up) // 2
            elif mode == 4:
                estimate = left + up - upper_left
                distances = (abs(estimate - left), abs(estimate - up), abs(estimate - upper_left))
                predictor = (left, up, upper_left)[distances.index(min(distances))]
            elif mode == 0:
                predictor = 0
            else:
                raise ValueError(f"Unknown PNG row filter: {mode}")
            row[i] = (row[i] + predictor) & 255
        alphas.append(row[3::4])
        previous = row
    return width, height, alphas


def annotate(output: Path) -> None:
    manifest_path = output / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    frame = manifest["animations"]["still"]["frames"][0]
    width, height, alpha = alpha_pixels(output / frame["image"])
    points = [(x, y) for y, row in enumerate(alpha) for x, value in enumerate(row) if value >= 24]
    if not points:
        raise ValueError("The rod render is empty")
    left = min(x for x, _ in points)
    right = max(x for x, _ in points) + 1
    top = min(y for _, y in points)
    bottom = max(y for _, y in points) + 1
    band = max(2, round(height * 0.003))
    def anchor(first: int, last: int, y: float) -> dict:
        xs = [x + 0.5 for x, py in points if first <= py < last]
        return {"x": round(sum(xs) / len(xs) / width, 6), "y": round(y / height, 6)}
    manifest["prop"] = {
        "kind": "fishing-rod",
        "level": int(manifest["id"][-1]),
        "tip": anchor(top, top + band, top + 0.5),
        "handle": anchor(bottom - band, bottom, bottom - 0.5),
        "bounds": {
            "x": round(left / width, 6), "y": round(top / height, 6),
            "w": round((right - left) / width, 6), "h": round((bottom - top) / height, 6),
        },
        "hasLine": False,
    }
    manifest["name"] = f"Fishing rod · Level {manifest['prop']['level']}"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"[fishing-rods] {manifest['id']}: {json.dumps(manifest['prop'])}", flush=True)


def render_worker() -> None:
    import bpy
    from tools import blender_render

    configure = blender_render.configure_scene
    def configure_rod(*args, **kwargs):
        result = configure(*args, **kwargs)
        # Fish-sized outlines would cover the narrow colored shaft.
        for lineset in bpy.context.view_layer.freestyle_settings.linesets:
            lineset.linestyle.thickness = max(1.25, bpy.context.scene.render.resolution_x / 512)
        return result
    blender_render.configure_scene = configure_rod
    args = blender_render.parse_args()
    blender_render.main()
    annotate(Path(args.output).resolve())


def main() -> None:
    from pipeline import find_blender, slugify, validate_output, write_catalog

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default="raw/Cute Fish Pack - Feb 2020/Blends")
    parser.add_argument("--output", default="dist-rods-1024")
    parser.add_argument("--size", type=int, default=1024)
    args = parser.parse_args()
    if args.size < 64:
        parser.error("--size must be at least 64")
    blender = find_blender()
    if not blender:
        parser.error("Blender is not installed; run python3 pipeline.py setup first")
    output = Path(args.output).expanduser().resolve()
    sources = Path(args.input).expanduser()
    if not sources.is_absolute():
        sources = ROOT / sources
    for level in range(1, 6):
        source = sources / f"FishingRod_Lvl{level}.blend"
        if not source.is_file():
            parser.error(f"Missing source: {source}")
        subprocess.run([
            str(blender), "--background", str(source), "--python-exit-code", "1",
            "--python", str(Path(__file__).resolve()), "--", "--rod-worker",
            "--output", str(output / slugify(source.stem)), "--size", str(args.size),
            "--style", "cartoon", "--max-atlas-size", "2048",
        ], cwd=ROOT, check=True)
    write_catalog(output)
    validate_output(output)


if __name__ == "__main__":
    if "--rod-worker" in sys.argv:
        sys.argv.remove("--rod-worker")
        render_worker()
    else:
        main()
