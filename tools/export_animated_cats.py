#!/usr/bin/env python3
"""Render the supplied Craftpix Spine Idle/Shoot clips from vector cat parts.

The AI files are PDF compatible and each artboard holds one rig attachment.
Poppler rasterizes those artboards at the requested native pixel density, then
Blender's bundled NumPy evaluates the original Spine 4.3 bone timelines and
composites the parts. The supplied art and skeleton data are left untouched.
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.export_highres_cats import BASE_VECTOR_DPI, ROOT, SOURCE, find_pdftocairo, load_rgba, parse_numbers


PAGES = {"Head": 1, "Body": 2, "Shade": 3, "Tails": 4, "Gun": 5, "Hat": 6}
CLIPS = ("Idle", "Shoot")


def frame_value(timeline: list[dict] | None, time: float, key: str, default: float) -> float:
    """Evaluate the linear/stepped Spine timelines present in this source pack."""
    if not timeline:
        return default
    first = timeline[0]
    if time < first.get("time", 0):
        return default
    for index in range(len(timeline) - 1):
        start, end = timeline[index:index + 2]
        t0, t1 = start.get("time", 0), end.get("time", 0)
        if time < t1:
            a, b = start.get(key, default), end.get(key, default)
            if start.get("curve") == "stepped" or t1 <= t0:
                return a
            curve = start.get("curve")
            if curve not in (None, "linear"):
                raise ValueError(f"Unsupported Spine curve: {curve!r}")
            return a + (b - a) * (time - t0) / (t1 - t0)
    return timeline[-1].get(key, default)


def bone_worlds(skeleton: dict, animation: dict, time: float) -> dict[str, tuple[float, float, float, float, float, float]]:
    """Return each bone's Spine world transform (a,b,c,d,x,y), y up."""
    worlds = {}
    for bone in skeleton["bones"]:
        timeline = animation.get("bones", {}).get(bone["name"], {})
        rotate, translate = timeline.get("rotate"), timeline.get("translate")
        scale, shear = timeline.get("scale"), timeline.get("shear")
        x = bone.get("x", 0) + frame_value(translate, time, "x", 0)
        y = bone.get("y", 0) + frame_value(translate, time, "y", 0)
        rotation = bone.get("rotation", 0) + frame_value(rotate, time, "value", 0)
        sx = bone.get("scaleX", 1) * frame_value(scale, time, "x", 1)
        sy = bone.get("scaleY", 1) * frame_value(scale, time, "y", 1)
        shear_x = bone.get("shearX", 0) + frame_value(shear, time, "x", 0)
        shear_y = bone.get("shearY", 0) + frame_value(shear, time, "y", 0)
        rx, ry = math.radians(rotation + shear_x), math.radians(rotation + 90 + shear_y)
        a, b, c, d = math.cos(rx) * sx, math.cos(ry) * sy, math.sin(rx) * sx, math.sin(ry) * sy
        parent = worlds.get(bone.get("parent"))
        if parent:
            pa, pb, pc, pd, px, py = parent
            worlds[bone["name"]] = (
                pa*a + pb*c, pa*b + pb*d, pc*a + pd*c, pc*b + pd*d,
                pa*x + pb*y + px, pc*x + pd*y + py,
            )
        else:
            worlds[bone["name"]] = a, b, c, d, x, y
    return worlds


def attachment_world(bone: tuple, attachment: dict) -> tuple[float, float, float, float, float, float]:
    """Compose the region's local offset and rotation onto its bone."""
    a, b, c, d, x, y = bone
    angle = math.radians(attachment.get("rotation", 0))
    cs, sn = math.cos(angle), math.sin(angle)
    sx, sy = attachment.get("scaleX", 1), attachment.get("scaleY", 1)
    return (
        (a*cs + b*sn)*sx, (-a*sn + b*cs)*sy,
        (c*cs + d*sn)*sx, (-c*sn + d*cs)*sy,
        a*attachment.get("x", 0) + b*attachment.get("y", 0) + x,
        c*attachment.get("x", 0) + d*attachment.get("y", 0) + y,
    )


def transformed_corners(matrix: tuple, attachment: dict) -> list[tuple[float, float]]:
    a, b, c, d, x, y = matrix
    w, h = attachment["width"] / 2, attachment["height"] / 2
    return [(a*ix + b*iy + x, c*ix + d*iy + y) for ix in (-w, w) for iy in (-h, h)]


def worker() -> None:
    import numpy as np
    from tools.package_boy import write_rgba

    values = sys.argv[sys.argv.index("--") + 1:]
    if len(values) != 7:
        raise SystemExit("worker expects OUTPUT SOURCE PARTS CAT SIZE FPS PROBE")
    output, source, parts = (Path(value) for value in values[:3])
    number, size, fps = (int(value) for value in values[3:6])
    probe = values[6] == "1"
    skeleton = json.loads((source / f"Json Atlas/Cat Characters/Cat{number}/Character{number}.json").read_text())
    slot_order = skeleton["slots"]
    skins = skeleton["skins"]
    if len(skins) != 1 or skins[0]["name"] != "default":
        raise ValueError(f"Cat {number}: unexpected skins: {[skin['name'] for skin in skins]}")
    attachments = skins[0]["attachments"]
    art = {slot["name"]: load_rgba(parts / f"part-{PAGES[slot['name']]}.png") for slot in slot_order}
    premultiplied = {}
    for name, image in art.items():
        pixels = image.copy()
        pixels[:, :, :3] *= pixels[:, :, 3:4]
        premultiplied[name] = pixels

    durations = {}
    frame_times = {}
    for clip in CLIPS:
        animation = skeleton["animations"][clip]
        duration = max((frame.get("time", 0) for bone in animation.get("bones", {}).values()
            for frames in bone.values() for frame in frames), default=0)
        count = max(1, round(duration * fps))
        durations[clip], frame_times[clip] = duration, [index/fps for index in range(count)]

    def poses(clip: str, time: float):
        worlds = bone_worlds(skeleton, skeleton["animations"][clip], time)
        for slot in slot_order:
            name = slot["name"]
            attachment = attachments[name][slot.get("attachment", name)]
            yield name, attachment, attachment_world(worlds[slot["bone"]], attachment)

    # One global camera for both clips keeps every frame aligned and unclipped.
    all_corners = [corner for clip in CLIPS for time in frame_times[clip]
        for _, attachment, matrix in poses(clip, time)
        for corner in transformed_corners(matrix, attachment)]
    min_x = min(x for x, _ in all_corners)
    max_x = max(x for x, _ in all_corners)
    min_y = min(y for _, y in all_corners)
    max_y = max(y for _, y in all_corners)
    pixels_per_unit = size * .88 / max(max_x - min_x, max_y - min_y)
    offset_x = size/2 - pixels_per_unit * (min_x + max_x)/2
    offset_y = size/2 + pixels_per_unit * (min_y + max_y)/2

    def composite(canvas: np.ndarray, name: str, attachment: dict, matrix: tuple) -> None:
        image = premultiplied[name]
        height, width = image.shape[:2]
        a, b, c, d, x, y = matrix
        determinant = a*d - b*c
        if abs(determinant) < 1e-8:
            return
        inverse = (d/determinant, -b/determinant, -c/determinant, a/determinant)
        corners = transformed_corners(matrix, attachment)
        left = max(0, int(math.floor(min(offset_x + pixels_per_unit * cx for cx, _ in corners))) - 2)
        right = min(size, int(math.ceil(max(offset_x + pixels_per_unit * cx for cx, _ in corners))) + 2)
        top = max(0, int(math.floor(min(offset_y - pixels_per_unit * cy for _, cy in corners))) - 2)
        bottom = min(size, int(math.ceil(max(offset_y - pixels_per_unit * cy for _, cy in corners))) + 2)
        for row in range(top, bottom, 96):
            row_end = min(bottom, row + 96)
            yy, xx = np.mgrid[row:row_end, left:right].astype(np.float32)
            world_x = (xx + .5 - offset_x) / pixels_per_unit - x
            world_y = (offset_y - yy - .5) / pixels_per_unit - y
            local_x = inverse[0] * world_x + inverse[1] * world_y
            local_y = inverse[2] * world_x + inverse[3] * world_y
            source_x = local_x / attachment["width"] * width + width/2 - .5
            source_y = -local_y / attachment["height"] * height + height/2 - .5
            valid = ((source_x >= 0) & (source_y >= 0) &
                (source_x < width - 1) & (source_y < height - 1))
            ix = np.clip(source_x.astype(np.int32), 0, width - 2)
            iy = np.clip(source_y.astype(np.int32), 0, height - 2)
            fx = np.clip(source_x - ix, 0, 1)[:, :, None]
            fy = np.clip(source_y - iy, 0, 1)[:, :, None]
            sampled = ((image[iy, ix] * (1-fx) + image[iy, ix+1] * fx) * (1-fy)
                + (image[iy+1, ix] * (1-fx) + image[iy+1, ix+1] * fx) * fy)
            sampled *= valid[:, :, None]
            target = canvas[row:row_end, left:right]
            target[:] = sampled + target * (1 - sampled[:, :, 3:4])

    records = []
    for clip in CLIPS:
        for index, time in enumerate(frame_times[clip]):
            if probe and index not in {0, len(frame_times[clip])//2, len(frame_times[clip])-1}:
                continue
            canvas = np.zeros((size, size, 4), np.float32)
            for name, attachment, matrix in poses(clip, time):
                composite(canvas, name, attachment, matrix)
            alpha = canvas[:, :, 3]
            ys, xs = np.where(alpha >= 24/255)
            if not len(xs):
                raise RuntimeError(f"Cat {number} {clip}/{index} rendered empty")
            margin = min(xs.min(), ys.min(), size-xs.max()-1, size-ys.max()-1)
            if margin < max(2, round(size * .02)):
                raise RuntimeError(f"Cat {number} {clip}/{index} clipped (margin={margin})")
            rgba = canvas.copy()
            rgba[:, :, :3] = np.divide(rgba[:, :, :3], rgba[:, :, 3:4],
                out=np.zeros_like(rgba[:, :, :3]), where=rgba[:, :, 3:4] > 1e-6)
            pixels = np.clip(np.rint(rgba * 255), 0, 255).astype(np.uint8)
            relpath = f"{clip.lower()}/{index:04d}.png"
            for facing, array in (("original", pixels), ("mirrored", pixels[:, ::-1])):
                destination = output / facing / relpath
                destination.parent.mkdir(parents=True, exist_ok=True)
                write_rgba(destination, size, size, bytearray(array.tobytes()))
            records.append({"clip": clip, "index": index, "time": round(time, 7),
                "file": relpath, "bounds": {"x": int(xs.min()), "y": int(ys.min()),
                    "w": int(xs.max()-xs.min()+1), "h": int(ys.max()-ys.min()+1)}})
        print(f"Cat{number} {clip}: {sum(record['clip'] == clip for record in records)} frames", flush=True)
    manifest = {
        "format": "spine-vector-cat-animation-v1", "sourceCharacter": f"Cat{number}",
        "frameSize": {"w": size, "h": size}, "fps": fps,
        "facings": {"original": "source pose", "mirrored": "horizontal flip of source pose"},
        "slots": [slot["name"] for slot in slot_order],
        "animations": {clip: {"durationSeconds": durations[clip],
            "frameCount": sum(record["clip"] == clip for record in records),
            "frames": [record for record in records if record["clip"] == clip]}
            for clip in CLIPS},
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Exported Cat{number} to {output}", flush=True)


def main() -> None:
    from pipeline import find_blender

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default=SOURCE)
    parser.add_argument("--output", default="build/exports/cats-animated-2048")
    parser.add_argument("--only", help="Comma-separated cat numbers, e.g. 1,9,15")
    parser.add_argument("--size", type=int, default=2048)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--probe", action="store_true", help="Render three representative frames per clip")
    parser.add_argument("--pdftocairo")
    args = parser.parse_args()
    if not 256 <= args.size <= 4096:
        parser.error("--size must be 256..4096")
    if not 1 <= args.fps <= 120:
        parser.error("--fps must be 1..120")
    try:
        numbers = parse_numbers(args.only)
    except argparse.ArgumentTypeError as exc:
        parser.error(str(exc))
    source = (ROOT / args.source).resolve()
    output = (ROOT / args.output).resolve()
    renderer = find_pdftocairo(args.pdftocairo)
    blender = find_blender()
    if not renderer or not blender:
        parser.error("This exporter needs Poppler pdftocairo and Blender")
    dpi = BASE_VECTOR_DPI * args.size / 512
    cache = ROOT / "build/work/animated-cat-vector-parts" / f"{args.size}px"
    cache.mkdir(parents=True, exist_ok=True)
    for number in numbers:
        vector = source / f"Ai/Cat Characters/Char{number} Parts.ai"
        if not vector.is_file():
            parser.error(f"Missing vector file: {vector}")
        parts = cache / f"C{number:02d}"
        parts.mkdir(parents=True, exist_ok=True)
        subprocess.run([str(renderer), "-png", "-transp", "-r", f"{dpi:g}",
            str(vector), str(parts / "part")], check=True)
        skeleton = json.loads((source / f"Json Atlas/Cat Characters/Cat{number}/Character{number}.json").read_text())
        for slot in skeleton["slots"]:
            path = parts / f"part-{PAGES[slot['name']]}.png"
            if not path.is_file():
                raise RuntimeError(f"Missing rasterized artboard: {path}")
        subprocess.run([str(blender), "--background", "--factory-startup", "--python-exit-code", "1",
            "--python", str(Path(__file__).resolve()), "--", str(output / f"cat-{number:02d}"),
            str(source), str(parts), str(number), str(args.size), str(args.fps), "1" if args.probe else "0"],
            cwd=ROOT, check=True)


if __name__ == "__main__":
    if "--" in sys.argv:
        worker()
    else:
        main()
