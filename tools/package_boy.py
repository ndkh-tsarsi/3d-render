#!/usr/bin/env python3
"""Package the supplied RedHatBoy idle PNGs without resizing or redrawing them."""

from __future__ import annotations

import argparse
import binascii
import json
import math
import shutil
import struct
import sys
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def read_rgba(path: Path) -> tuple[int, int, bytearray]:
    """Read the noninterlaced RGBA8 source format using only the standard library."""
    data = path.read_bytes()
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError(f"Not a PNG: {path}")
    offset = 8
    compressed = bytearray()
    width = height = 0
    while offset < len(data):
        length = struct.unpack_from(">I", data, offset)[0]
        kind = data[offset + 4:offset + 8]
        payload = data[offset + 8:offset + 8 + length]
        if kind == b"IHDR":
            width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", payload)
            if (depth, color, compression, filtering, interlace) != (8, 6, 0, 0, 0):
                raise ValueError(f"Expected noninterlaced RGBA8 PNG: {path}")
        elif kind == b"IDAT":
            compressed.extend(payload)
        elif kind == b"IEND":
            break
        offset += length + 12
    stride = width * 4
    filtered = zlib.decompress(compressed)
    if not width or len(filtered) != height * (stride + 1):
        raise ValueError(f"Invalid PNG dimensions or data: {path}")
    pixels = bytearray(width * height * 4)
    previous = bytearray(stride)
    for y in range(height):
        start = y * (stride + 1)
        method = filtered[start]
        row = bytearray(filtered[start + 1:start + stride + 1])
        if method > 4:
            raise ValueError(f"Unknown PNG filter {method}: {path}")
        if method:
            for x in range(stride):
                left = row[x - 4] if x >= 4 else 0
                above = previous[x]
                upper_left = previous[x - 4] if x >= 4 else 0
                if method == 1:
                    predictor = left
                elif method == 2:
                    predictor = above
                elif method == 3:
                    predictor = (left + above) // 2
                else:
                    estimate = left + above - upper_left
                    distances = (abs(estimate - left), abs(estimate - above), abs(estimate - upper_left))
                    predictor = (left, above, upper_left)[distances.index(min(distances))]
                row[x] = (row[x] + predictor) & 255
        pixels[y * stride:(y + 1) * stride] = row
        previous = row
    return width, height, pixels


def write_rgba(path: Path, width: int, height: int, pixels: bytearray) -> None:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", binascii.crc32(kind + payload) & 0xffffffff)

    stride = width * 4
    raw = b"".join(b"\x00" + pixels[y * stride:(y + 1) * stride] for y in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    path.write_bytes(PNG_SIGNATURE + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def point(x: float, y: float, width: int, height: int) -> dict:
    return {"x": round(x, 3), "y": round(y, 3), "normalized": [round(x / width, 6), round(y / height, 6)]}


def measure_anchors(width: int, height: int, pixels: bytearray) -> tuple[dict, dict]:
    visible = [(x, y) for y in range(height) for x in range(width) if pixels[(y * width + x) * 4 + 3] >= 24]
    if not visible:
        raise ValueError("A source frame is empty")
    left = min(x for x, _ in visible)
    right = max(x for x, _ in visible) + 1
    top = min(y for _, y in visible)
    bottom = max(y for _, y in visible) + 1
    soles = [x for x, y in visible if y >= bottom - 4]
    feet = point((min(soles) + max(soles)) / 2, bottom, width, height)

    # The supplied right-facing idle pose has a visible leading hand to the
    # right of the overalls. Measure its skin-colored lower forearm each frame.
    hand = []
    for y in range(round(height * 0.60), round(height * 0.77)):
        for x in range(round(width * 0.63), round(width * 0.74)):
            r, g, b, a = pixels[(y * width + x) * 4:(y * width + x + 1) * 4]
            if a >= 220 and r > 150 and g > 130 and b > 90 and r > g + 5 and g > b + 5:
                hand.append((x, y))
    if not hand:
        raise ValueError("Could not locate the idle pose's leading hand")
    hand_top = min(y for _, y in hand)
    hand_bottom = max(y for _, y in hand)
    grip_y = hand_top + (hand_bottom - hand_top) * 0.76
    grip_band = [x for x, y in hand if abs(y - grip_y) <= 5]
    grip_x = (min(grip_band) + max(grip_band)) / 2
    anchors = {"grip": point(grip_x, grip_y, width, height), "feet": feet}
    bounds = {"x": left, "y": top, "w": right - left, "h": bottom - top}
    return anchors, bounds


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default="raw/RedHatBoy")
    parser.add_argument("--output", default="dist-boy")
    parser.add_argument("--fps", type=float, default=10)
    args = parser.parse_args()
    if not math.isfinite(args.fps) or args.fps <= 0:
        parser.error("--fps must be positive")
    source = (ROOT / args.source).resolve()
    output = (ROOT / args.output / "red-hat-boy").resolve()
    if source == output or source in output.parents or output in source.parents:
        parser.error("Output must be separate from the source asset folder")
    images = [source / "png" / f"Idle ({index}).png" for index in range(1, 11)]
    decoded = [read_rgba(path) for path in images]
    width, height = decoded[0][:2]
    if any(image[:2] != (width, height) for image in decoded):
        raise ValueError("Idle frames must share dimensions")
    columns = 2048 // width
    rows = 2048 // height
    capacity = columns * rows
    if not capacity:
        raise ValueError("A source frame exceeds the 2048px atlas limit")
    output.mkdir(parents=True, exist_ok=True)
    (output / "frames" / "idle").mkdir(parents=True, exist_ok=True)
    atlases = []
    frames = []
    for page_number, offset in enumerate(range(0, len(images), capacity)):
        page_images = decoded[offset:offset + capacity]
        page_columns = min(columns, len(page_images))
        page_width = page_columns * width
        page_height = math.ceil(len(page_images) / page_columns) * height
        atlas_pixels = bytearray(page_width * page_height * 4)
        frame_metadata = {}
        keys = []
        for local_index, (_, _, pixels) in enumerate(page_images):
            frame_index = offset + local_index
            x = (local_index % page_columns) * width
            y = (local_index // page_columns) * height
            for row in range(height):
                start = ((y + row) * page_width + x) * 4
                atlas_pixels[start:start + width * 4] = pixels[row * width * 4:(row + 1) * width * 4]
            key = f"idle/{frame_index:04d}"
            anchors, bounds = measure_anchors(width, height, pixels)
            rect = {"x": x, "y": y, "w": width, "h": height}
            frames.append({"key": key, "image": f"frames/{key}.png", "page": page_number,
                           "frame": rect, "sourceFrame": frame_index, "durationMs": 1000 / args.fps,
                           "anchors": anchors, "bounds": bounds})
            keys.append(key)
            frame_metadata[key] = {"frame": rect, "rotated": False, "trimmed": False,
                                   "spriteSourceSize": {"x": 0, "y": 0, "w": width, "h": height},
                                   "sourceSize": {"w": width, "h": height}}
            shutil.copy2(images[frame_index], output / "frames" / f"{key}.png")
        write_rgba(output / f"atlas-{page_number}.png", page_width, page_height, atlas_pixels)
        metadata = {"frames": frame_metadata, "animations": {"idle": keys},
                    "meta": {"app": "local-sprite-pipeline", "image": f"atlas-{page_number}.png",
                             "format": "RGBA8888", "size": {"w": page_width, "h": page_height}, "scale": "1"}}
        (output / f"atlas-{page_number}.json").write_text(json.dumps(metadata, indent=2) + "\n")
        atlases.append({"page": page_number, "image": f"atlas-{page_number}.png",
                        "data": f"atlas-{page_number}.json", "size": {"w": page_width, "h": page_height}})
    shutil.copy2(images[0], output / "thumbnail.png")
    manifest = {"format": "html5-sprite-asset-v1", "id": "red-hat-boy", "name": "Red Hat Boy",
                "style": "authored", "generatedFace": False, "frameSize": {"w": width, "h": height},
                "maxAtlasSize": 2048, "view": {"type": "profile", "cameraAxis": "right"},
                "anchorFacing": "right", "pivot": frames[0]["anchors"]["feet"], "thumbnail": "thumbnail.png",
                "atlases": atlases, "animations": {"idle": {"sourceAction": "Idle", "sourceRange": [1, 10],
                "loop": True, "fps": args.fps, "frames": frames}},
                "source": {"type": "provided-png-sprites", "folder": str(source.relative_to(ROOT)),
                           "files": [f"png/{path.name}" for path in images],
                           "animationReference": "spriter/Spriter.scml", "modification": "none; lossless atlas packaging"}}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Packaged {len(frames)} untouched {width}x{height} frames into {len(atlases)} atlases: {output}")
    for frame in frames:
        print(frame["key"], "grip", frame["anchors"]["grip"]["normalized"], "feet", frame["anchors"]["feet"]["normalized"])
    from pipeline import validate_output, write_catalog
    write_catalog(output.parent)
    validate_output(output.parent)


if __name__ == "__main__":
    main()
