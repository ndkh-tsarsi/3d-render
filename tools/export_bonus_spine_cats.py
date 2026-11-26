#!/usr/bin/env python3
"""Export the supplied Boxer and Guardian Spine animations from vector artboards.

Each frame keeps the authored equipment, attachment changes, slot order, and
bone animation.  Both horizontal facings are included as transparent PNGs.
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
SOURCE = ROOT / "raw/craftpix-net-397030-free-cartoon-cat-defense-game-asset-kit"

PROFILES = {
    "boxer": {
        "id": "cat-boxer",
        "ai": "Ai/AddOn Help/Cat Boxing.ai",
        "rig": "Json Atlas/CatBoxing/CatBoxing.json",
        "pages": {"Head1": 1, "Body1": 2, "Hand2": 3, "Shade": 4,
                  "Tails": 5, "Hand1": 6, "Body2": 7, "Head2": 8,
                  "Hand3": 9, "Fx": 10},
        "clips": {"Idle": 20, "Fight": 20},
    },
    "guardian": {
        "id": "cat-guardian",
        "ai": "Ai/AddOn Help/Cat Guardian.ai",
        "rig": "Json Atlas/CatGuardian/Enemy.json",
        "pages": {"Head": 1, "Body": 2, "Shield": 3, "Tails": 4,
                  "Shade": 5, "Hand1": 6, "Hand2": 7},
        "clips": {"Idle": 20, "Attack": 25},
    },
}


def key_values(keys: list[dict], time: float, kind: str) -> tuple[float, float]:
    """Sample the linear/stepped Spine timelines used in these two rigs."""
    neutral = (1.0, 1.0) if kind == "scale" else (0.0, 0.0)
    if not keys or time + 1e-7 < keys[0].get("time", 0.0):
        return neutral

    def values(key: dict) -> tuple[float, float]:
        if kind == "rotate":
            return (key.get("value", 0.0), 0.0)
        return (key.get("x", neutral[0]), key.get("y", neutral[1]))

    for index in range(len(keys) - 1):
        left, right = keys[index], keys[index + 1]
        t0, t1 = left.get("time", 0.0), right.get("time", 0.0)
        if time + 1e-7 < t1:
            v0, v1 = values(left), values(right)
            if left.get("curve") == "stepped" or t1 <= t0:
                return v0
            portion = max(0.0, min(1.0, (time - t0) / (t1 - t0)))
            return (v0[0] + (v1[0] - v0[0]) * portion,
                    v0[1] + (v1[1] - v0[1]) * portion)
    return values(keys[-1])


def world_bones(rig: dict, animation: dict, time: float):
    import numpy as np

    result = {}
    for bone in rig["bones"]:
        name = bone["name"]
        timelines = animation.get("bones", {}).get(name, {})
        dx, dy = key_values(timelines.get("translate", []), time, "translate")
        rotate, _ = key_values(timelines.get("rotate", []), time, "rotate")
        sx, sy = key_values(timelines.get("scale", []), time, "scale")
        shear_x, shear_y = key_values(timelines.get("shear", []), time, "shear")
        angle_x = math.radians(bone.get("rotation", 0.0) + rotate + bone.get("shearX", 0.0) + shear_x)
        angle_y = math.radians(bone.get("rotation", 0.0) + rotate + 90.0 + bone.get("shearY", 0.0) + shear_y)
        local = np.array([
            [math.cos(angle_x) * bone.get("scaleX", 1.0) * sx,
             math.cos(angle_y) * bone.get("scaleY", 1.0) * sy],
            [math.sin(angle_x) * bone.get("scaleX", 1.0) * sx,
             math.sin(angle_y) * bone.get("scaleY", 1.0) * sy],
        ], dtype=np.float64)
        translation = np.array([bone.get("x", 0.0) + dx, bone.get("y", 0.0) + dy], dtype=np.float64)
        parent = result.get(bone.get("parent"))
        if parent is None:
            result[name] = (translation, local)
        else:
            parent_position, parent_matrix = parent
            result[name] = (parent_position + parent_matrix @ translation,
                            parent_matrix @ local)
    return result


def attachment_at(slot: dict, animation: dict, time: float) -> str | None:
    name = slot.get("attachment")
    for frame in animation.get("slots", {}).get(slot["name"], {}).get("attachment", []):
        if frame.get("time", 0.0) <= time + 1e-7:
            name = frame.get("name")
        else:
            break
    return name


def draw_order_at(slots: list[dict], animation: dict, time: float) -> list[int]:
    frame = None
    for candidate in animation.get("drawOrder", []):
        if candidate.get("time", 0.0) <= time + 1e-7:
            frame = candidate
        else:
            break
    if frame is None:
        return list(range(len(slots)))
    original = {slot["name"]: index for index, slot in enumerate(slots)}
    offsets = sorted(frame["offsets"], key=lambda item: original[item["slot"]])
    order = [-1] * len(slots)
    unchanged = []
    cursor = 0
    for change in offsets:
        source = original[change["slot"]]
        while cursor < source:
            unchanged.append(cursor)
            cursor += 1
        order[source + change["offset"]] = source
        cursor = source + 1
    while cursor < len(slots):
        unchanged.append(cursor)
        cursor += 1
    for index in range(len(order) - 1, -1, -1):
        if order[index] < 0:
            order[index] = unchanged.pop()
    return order


def worker() -> None:
    import numpy as np
    from tools.export_highres_cats import load_rgba
    from tools.package_boy import write_rgba

    argv = sys.argv[sys.argv.index("--") + 1:]
    source, parts, output = (Path(arg) for arg in argv[:3])
    kind, size_text, dpi_text = argv[3:]
    size, dpi = int(size_text), float(dpi_text)
    art_scale = dpi / 288.0
    profile = PROFILES[kind]
    rig = json.loads((source / profile["rig"]).read_text())
    images = {name: load_rgba(parts / f"part-{page}.png") for name, page in profile["pages"].items()}
    premult = {}
    for name, pixels in images.items():
        copy = pixels.copy()
        copy[:, :, :3] *= copy[:, :, 3:4]
        premult[name] = copy
    skin = rig["skins"][0]["attachments"]
    slots = rig["slots"]
    fps = 30

    def frame_parts(clip: str, frame_index: int):
        animation = rig["animations"][clip]
        time = frame_index / fps
        bones = world_bones(rig, animation, time)
        result = []
        for slot_index in draw_order_at(slots, animation, time):
            slot = slots[slot_index]
            name = attachment_at(slot, animation, time)
            if not name:
                continue
            attachment = skin[slot["name"]][name]
            bone_position, bone_matrix = bones[slot["bone"]]
            angle = math.radians(attachment.get("rotation", 0.0))
            rotation = np.array([[math.cos(angle), -math.sin(angle)],
                                 [math.sin(angle), math.cos(angle)]], dtype=np.float64)
            center = bone_position + bone_matrix @ np.array([
                attachment.get("x", 0.0), attachment.get("y", 0.0)], dtype=np.float64)
            matrix = bone_matrix @ rotation
            result.append((name, center, matrix))
        return result

    # One framing across all clips keeps animation anchors fixed. Base logical
    # pixels correspond to four pixels per authored Spine unit.
    samples = {(clip, index): frame_parts(clip, index)
               for clip, count in profile["clips"].items() for index in range(count)}
    bounds = []
    for items in samples.values():
        for name, center, matrix in items:
            height, width = images[name].shape[:2]
            half = np.array([width / art_scale / 2, height / art_scale / 2])
            for dx in (-half[0], half[0]):
                for dy in (-half[1], half[1]):
                    world = center * 4 + matrix @ np.array([dx, dy])
                    bounds.append((world[0], -world[1]))
    lower = np.min(bounds, axis=0)
    upper = np.max(bounds, axis=0)
    fit = min(464.0 / (upper[0] - lower[0]), 464.0 / (upper[1] - lower[1]))
    center = (lower + upper) / 2
    out_scale = size / 512.0
    offset = np.array([256.0, 256.0]) - fit * center
    orient_down = np.diag([1.0, -1.0])
    source_down = np.diag([1.0 / art_scale, -1.0 / art_scale])

    def compose(items):
        canvas = np.zeros((size, size, 4), dtype=np.float32)
        for name, world_center, world_matrix in items:
            image = premult[name]
            height, width = image.shape[:2]
            destination_center = (fit * np.array([world_center[0] * 4, -world_center[1] * 4]) + offset) * out_scale
            transform = orient_down @ world_matrix @ source_down * (fit * out_scale)
            inverse = np.linalg.inv(transform)
            corners = [destination_center + transform @ np.array([x, y])
                       for x in (-width / 2, width / 2) for y in (-height / 2, height / 2)]
            minimum = np.min(corners, axis=0)
            maximum = np.max(corners, axis=0)
            x0, y0 = np.maximum(np.floor(minimum - 2).astype(int), 0)
            x1, y1 = np.minimum(np.ceil(maximum + 2).astype(int), size)
            if x1 <= x0 or y1 <= y0:
                continue
            for row in range(y0, y1, 128):
                bottom = min(y1, row + 128)
                yy, xx = np.mgrid[row:bottom, x0:x1].astype(np.float32)
                delta = np.stack((xx + .5 - destination_center[0],
                                  yy + .5 - destination_center[1]), axis=0)
                source_coords = np.einsum("ij,jhw->ihw", inverse, delta)
                sx = source_coords[0] + width / 2 - .5
                sy = source_coords[1] + height / 2 - .5
                valid = (sx >= 0) & (sy >= 0) & (sx < width - 1) & (sy < height - 1)
                ix = np.clip(sx.astype(np.int32), 0, width - 2)
                iy = np.clip(sy.astype(np.int32), 0, height - 2)
                fx = np.clip(sx - ix, 0, 1)[:, :, None]
                fy = np.clip(sy - iy, 0, 1)[:, :, None]
                pixels = ((image[iy, ix] * (1 - fx) + image[iy, ix + 1] * fx) * (1 - fy)
                          + (image[iy + 1, ix] * (1 - fx) + image[iy + 1, ix + 1] * fx) * fy)
                pixels *= valid[:, :, None]
                target = canvas[row:bottom, x0:x1]
                target[:] = pixels + target * (1 - pixels[:, :, 3:4])
        alpha = canvas[:, :, 3]
        ys, xs = np.where(alpha >= 24 / 255)
        if len(xs) == 0:
            raise RuntimeError("Animation frame is empty")
        margin = min(xs.min(), ys.min(), size - 1 - xs.max(), size - 1 - ys.max())
        if margin < max(2, round(size / 128)):
            raise RuntimeError(f"Animation frame is clipped: {margin}px margin")
        canvas[:, :, :3] = np.divide(canvas[:, :, :3], alpha[:, :, None],
            out=np.zeros_like(canvas[:, :, :3]), where=alpha[:, :, None] > 1e-6)
        return np.clip(np.rint(canvas * 255), 0, 255).astype(np.uint8)

    records = []
    for clip, count in profile["clips"].items():
        for index in range(count):
            pixels = compose(samples[(clip, index)])
            for facing, frame in (("original", pixels), ("mirrored", pixels[:, ::-1])):
                target = output / profile["id"] / facing / clip.lower() / f"{index:04d}.png"
                target.parent.mkdir(parents=True, exist_ok=True)
                write_rgba(target, size, size, bytearray(frame.tobytes()))
            records.append((clip, index))
        print(f"Exported {kind}/{clip}: {count} frames x 2 facings", flush=True)

    manifest = {"format": "spine-vector-png-frames-v1", "character": profile["id"],
        "source": profile["ai"], "rig": profile["rig"], "size": {"w": size, "h": size},
        "fps": fps, "facing": ["original", "mirrored"],
        "mirroredFacing": "horizontal flip of original",
        "clips": {name.lower(): {"frames": count, "loop": name == "Idle"}
                  for name, count in profile["clips"].items()},
        "vectorRasterDpi": dpi, "slots": [slot["name"] for slot in slots],
        "attachmentPages": profile["pages"]}
    target = output / profile["id"] / "manifest.json"
    target.write_text(json.dumps(manifest, indent=2) + "\n")


def main() -> None:
    from pipeline import find_blender
    from tools.export_highres_cats import find_pdftocairo

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--output", type=Path, default=ROOT / "build/exports/cats-animated-2048")
    parser.add_argument("--size", type=int, default=2048)
    parser.add_argument("--only", choices=["boxer", "guardian"])
    parser.add_argument("--pdftocairo")
    args = parser.parse_args()
    if not 256 <= args.size <= 4096:
        parser.error("--size must be between 256 and 4096")
    source = args.source.resolve()
    output = args.output.resolve()
    renderer = find_pdftocairo(args.pdftocairo)
    blender = find_blender()
    if not renderer or not blender:
        parser.error("pdftocairo and Blender are required")
    dpi = 288.0 * args.size / 512.0
    selected = [args.only] if args.only else list(PROFILES)
    for kind in selected:
        profile = PROFILES[kind]
        vector = source / profile["ai"]
        if not vector.is_file():
            parser.error(f"Missing vector art: {vector}")
        cache = ROOT / "build/work/bonus-cat-animation-vectors" / f"{kind}-{args.size}"
        cache.mkdir(parents=True, exist_ok=True)
        subprocess.run([str(renderer), "-png", "-transp", "-r", f"{dpi:g}",
                        str(vector), str(cache / "part")], check=True)
        for page in profile["pages"].values():
            if not (cache / f"part-{page:02d}.png").exists() and not (cache / f"part-{page}.png").exists():
                raise RuntimeError(f"Missing vector artboard {page} of {vector}")
        # Poppler pads the page numbers to two digits for the 10-page boxer AI.
        # Normalize only the path passed to the worker by supplying a mapping.
        if kind == "boxer":
            for page in profile["pages"].values():
                padded = cache / f"part-{page:02d}.png"
                plain = cache / f"part-{page}.png"
                if padded.exists() and not plain.exists():
                    plain.symlink_to(padded.name)
        subprocess.run([str(blender), "--background", "--factory-startup", "--python-exit-code", "1",
                        "--python", str(Path(__file__).resolve()), "--", str(source), str(cache),
                        str(output), kind, str(args.size), f"{dpi:g}"], cwd=ROOT, check=True)
    print(f"Exported bonus animations to {output}", flush=True)


if __name__ == "__main__":
    if "--" in sys.argv:
        worker()
    else:
        main()
