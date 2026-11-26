#!/usr/bin/env python3
"""Export assembled, transparent cat PNGs directly from the supplied AI vectors.

The Illustrator files are PDF-compatible and contain one character part per
artboard.  The driver rasterizes those vector artboards at the resolution
needed for the requested output, then starts Blender only as a bundled
NumPy/image runtime to assemble the parts using the supplied Spine skeleton.
The AI, EPS, and original PNG sources are never modified.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
SOURCE = "raw/craftpix-net-397030-free-cartoon-cat-defense-game-asset-kit"
BASE_SIZE = 512
BASE_VECTOR_DPI = 288.0  # 4x the 72 dpi PDF coordinate system.


def find_pdftocairo(explicit: str | None = None) -> Path | None:
    """Find Poppler without assuming it was installed system-wide."""
    candidates: list[Path] = []
    if explicit:
        candidates.append(Path(explicit).expanduser())
    configured = os.environ.get("PDFTOCAIRO")
    if configured:
        candidates.append(Path(configured).expanduser())
    discovered = shutil.which("pdftocairo")
    if discovered:
        candidates.append(Path(discovered))
    runtime_root = Path.home() / ".cache/codex-runtimes"
    if runtime_root.is_dir():
        candidates.extend(runtime_root.glob("*/dependencies/native/poppler/poppler/bin/pdftocairo"))
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate)
        if key in seen:
            continue
        seen.add(key)
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate.resolve()
    return None


def parse_numbers(value: str | None) -> list[int]:
    if not value:
        return list(range(1, 16))
    result: list[int] = []
    for item in value.split(","):
        text = item.strip().lower()
        if not text:
            continue
        if text == "fishing-cat":
            number = 1
        else:
            text = text.removeprefix("fishing-cat-").removeprefix("cat")
            try:
                number = int(text)
            except ValueError as exc:
                raise argparse.ArgumentTypeError(f"Unknown cat {item!r}") from exc
        if not 1 <= number <= 15:
            raise argparse.ArgumentTypeError("Cat numbers must be between 1 and 15")
        if number not in result:
            result.append(number)
    if not result:
        raise argparse.ArgumentTypeError("Select at least one cat")
    return result


def output_name(number: int) -> str:
    return "fishing-cat.png" if number == 1 else f"fishing-cat-{number:02d}.png"


def load_rgba(path: Path):
    """Load a top-down, straight-alpha float image inside Blender."""
    import bpy
    import numpy as np

    image = bpy.data.images.load(str(path), check_existing=False)
    image.colorspace_settings.name = "Non-Color"
    width, height = image.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    return pixels.reshape(height, width, 4)[::-1].copy()


def worker() -> None:
    import numpy as np

    from tools.package_boy import write_rgba

    values = sys.argv[sys.argv.index("--") + 1:]
    if len(values) != 6:
        raise SystemExit("worker expects OUTPUT SOURCE PARTS CAT SIZE ART_SCALE")
    destination = Path(values[0])
    source = Path(values[1])
    parts = Path(values[2])
    number = int(values[3])
    size = int(values[4])
    art_scale = float(values[5])
    if art_scale <= 0:
        raise ValueError("Vector raster scale must be positive")

    pages = {"head": 1, "body": 2, "tail": 4, "gun": 5}
    art = {name: load_rgba(parts / f"part-{page}.png") for name, page in pages.items()}
    if number in (9, 10):
        art["hat"] = load_rgba(parts / "part-6.png")

    skeleton_path = source / f"Json Atlas/Cat Characters/Cat{number}/Character{number}.json"
    skeleton = json.loads(skeleton_path.read_text())
    bones: dict[str, tuple[float, float, float]] = {}
    for bone in skeleton["bones"]:
        parent_x, parent_y, parent_angle = bones.get(bone.get("parent"), (0.0, 0.0, 0.0))
        local_x, local_y = bone.get("x", 0.0), bone.get("y", 0.0)
        bones[bone["name"]] = (
            parent_x + math.cos(parent_angle) * local_x - math.sin(parent_angle) * local_y,
            parent_y + math.sin(parent_angle) * local_x + math.cos(parent_angle) * local_y,
            parent_angle + math.radians(bone.get("rotation", 0.0)),
        )
    attachments = skeleton["skins"][0]["attachments"]
    slots = {slot["name"]: slot["bone"] for slot in skeleton["slots"]}

    def setup(name: str) -> tuple[float, float]:
        attachment = attachments[name][name]
        bone_x, bone_y, angle = bones[slots[name]]
        local_x, local_y = attachment.get("x", 0.0), attachment.get("y", 0.0)
        return (
            bone_x + math.cos(angle) * local_x - math.sin(angle) * local_y,
            bone_y + math.sin(angle) * local_x + math.cos(angle) * local_y,
        )

    body_x, body_y = setup("Body")
    positions = {
        name: ((setup(slot)[0] - body_x) * 4, -(setup(slot)[1] - body_y) * 4)
        for name, slot in (("head", "Head"), ("body", "Body"), ("tail", "Tails"))
    }
    if "hat" in art:
        hat_x, hat_y = setup("Hat")
        positions["hat"] = ((hat_x - body_x) * 4, -(hat_y - body_y) * 4)

    # Retain the source character's native forepaw, while omitting the weapon.
    gun = art.pop("gun")
    gun_height, gun_width = gun.shape[:2]
    if number <= 5:
        paw = gun[
            round(44 / 161 * gun_height):round(133 / 161 * gun_height),
            round(4 / 235 * gun_width):round(61 / 235 * gun_width),
        ].copy()
        warm = (paw[:, :, 0] > paw[:, :, 1] + .025) & (paw[:, :, 0] > paw[:, :, 2] + .025)
        paw[:, :, 3] *= warm
        art["paw"] = paw
        positions["paw"] = (-112.0, 7.0)
    elif number >= 11:
        y0, y1 = round(58 * art_scale), round(139 * art_scale)
        x0, x1 = round(94 * art_scale), round(178 * art_scale)
        paw = gun[y0:y1, x0:x1].copy()
        white = (paw[:, :, :3].min(axis=2) > .78) & (paw[:, :, 3] > .8)
        mask = np.zeros_like(white)
        radius = max(1, round(5 * art_scale))
        for offset_y in range(-radius, radius + 1):
            for offset_x in range(-radius, radius + 1):
                if offset_x * offset_x + offset_y * offset_y <= radius * radius:
                    mask |= np.roll(np.roll(white, offset_y, axis=0), offset_x, axis=1)
        paw[:, :, 3] *= mask
        art["paw"] = paw
        positions["paw"] = (-135.0, 40.0)

    # Fit in the same logical 512 px composition used by the animation assets.
    boxes: list[tuple[float, float, float, float]] = []
    for name, (x, y) in positions.items():
        height, width = art[name].shape[:2]
        logical_width, logical_height = width / art_scale, height / art_scale
        boxes.append((x - logical_width / 2, y - logical_height / 2,
            x + logical_width / 2, y + logical_height / 2))
    left = min(box[0] for box in boxes) - 30
    right = max(box[2] for box in boxes) + 30
    top = min(box[1] for box in boxes) - 30
    bottom = max(box[3] for box in boxes) + 24
    fit = min(464 / (right - left), 464 / (bottom - top))
    offset = (256 - (left + right) / 2 * fit, 256 - (top + bottom) / 2 * fit)
    output_scale = size / BASE_SIZE
    render_scale = fit * output_scale
    canvas = np.zeros((size, size, 4), dtype=np.float32)
    tile_height = min(128, size)

    # Pre-multiplication makes bilinear edges composite without dark fringes.
    premultiplied = {}
    for name, image in art.items():
        pixels = image.copy()
        pixels[:, :, :3] *= pixels[:, :, 3:4]
        premultiplied[name] = pixels

    def sample_into_canvas(name: str, center_x: float, center_y: float,
            target_width: float, target_height: float) -> None:
        image = premultiplied[name]
        height, width = image.shape[:2]
        for row_start in range(0, size, tile_height):
            row_end = min(row_start + tile_height, size)
            yy, xx = np.mgrid[row_start:row_end, :size].astype(np.float32)
            source_x = (xx + .5 - center_x) / target_width * width + width / 2 - .5
            source_y = (yy + .5 - center_y) / target_height * height + height / 2 - .5
            valid = ((source_x >= 0) & (source_y >= 0)
                & (source_x < width - 1) & (source_y < height - 1))
            ix = np.clip(source_x.astype(np.int32), 0, width - 2)
            iy = np.clip(source_y.astype(np.int32), 0, height - 2)
            fx = np.clip(source_x - ix, 0, 1)[:, :, None]
            fy = np.clip(source_y - iy, 0, 1)[:, :, None]
            sampled = (
                (image[iy, ix] * (1 - fx) + image[iy, ix + 1] * fx) * (1 - fy)
                + (image[iy + 1, ix] * (1 - fx) + image[iy + 1, ix + 1] * fx) * fy
            )
            sampled *= valid[:, :, None]
            target = canvas[row_start:row_end]
            target[:] = sampled + target * (1 - sampled[:, :, 3:4])

    def composite(name: str, x: float, y: float) -> None:
        height, width = art[name].shape[:2]
        sample_into_canvas(
            name,
            (x * fit + offset[0]) * output_scale,
            (y * fit + offset[1]) * output_scale,
            width / art_scale * render_scale,
            height / art_scale * render_scale,
        )

    def composite_absolute(name: str, x: float, y: float, width: float, height: float) -> None:
        sample_into_canvas(name, x * output_scale, y * output_scale,
            width * output_scale, height * output_scale)

    if number == 1:
        # Cat 1 is the original app actor and predates the roster-wide fitting
        # rule. Keep its exact established silhouette and placement.
        composite_absolute("tail", 158, 389, 164, 140)
        composite_absolute("paw", 160, 366, 70, 109)
        composite_absolute("body", 272, 359, 194, 214)
        composite_absolute("head", 268, 194, 354, 330)
    else:
        tail_x, tail_y = positions["tail"]
        composite("tail", tail_x, tail_y)
        if "hat" in art:
            hat_x, hat_y = positions["hat"]
            composite("hat", hat_x, hat_y)
        if number <= 5:
            paw_x, paw_y = positions["paw"]
            composite("paw", paw_x, paw_y)
        composite("body", 0.0, 0.0)
        head_x, head_y = positions["head"]
        composite("head", head_x, head_y)
        if number >= 11:
            paw_x, paw_y = positions["paw"]
            composite("paw", paw_x, paw_y)

    alpha = canvas[:, :, 3]
    visible_y, visible_x = np.where(alpha >= 24 / 255)
    if not len(visible_x):
        raise RuntimeError(f"Cat {number} produced an empty image")
    margin = min(visible_x.min(), visible_y.min(), size - visible_x.max() - 1, size - visible_y.max() - 1)
    if margin < max(2, round(size / 128)):
        raise RuntimeError(f"Cat {number} is clipped or too close to the edge (margin {margin}px)")
    rgba = canvas.copy()
    rgba[:, :, :3] = np.divide(rgba[:, :, :3], rgba[:, :, 3:4],
        out=np.zeros_like(rgba[:, :, :3]), where=rgba[:, :, 3:4] > 1e-6)
    pixels = bytearray(np.clip(np.rint(rgba * 255), 0, 255).astype(np.uint8).tobytes())
    destination.parent.mkdir(parents=True, exist_ok=True)
    write_rgba(destination, size, size, pixels)
    print(f"Exported Cat{number} -> {destination} ({size}x{size}, transparent)", flush=True)


def main() -> None:
    from pipeline import find_blender
    from tools.fishing_cat_roster import identity

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default=SOURCE, help="Craftpix source-pack directory")
    parser.add_argument("--output", default="build/exports/cats-2048", help="Output directory")
    parser.add_argument("--size", type=int, default=2048, help="Square PNG size in pixels (default: 2048)")
    parser.add_argument("--only", help="Comma-separated cat numbers, e.g. 1,3,15")
    parser.add_argument("--dpi", type=float, help="Vector raster DPI; defaults to the output's native requirement")
    parser.add_argument("--pdftocairo", help="Path to Poppler's pdftocairo executable")
    parser.add_argument("--keep-existing", action="store_true", help="Skip valid PNGs already in the output folder")
    args = parser.parse_args()

    if not 256 <= args.size <= 4096:
        parser.error("--size must be between 256 and 4096")
    try:
        numbers = parse_numbers(args.only)
    except argparse.ArgumentTypeError as exc:
        parser.error(str(exc))
    source = (ROOT / args.source).resolve() if not Path(args.source).is_absolute() else Path(args.source).resolve()
    output = (ROOT / args.output).resolve() if not Path(args.output).is_absolute() else Path(args.output).resolve()
    if not source.is_dir():
        parser.error(f"Source directory does not exist: {source}")
    output.mkdir(parents=True, exist_ok=True)
    pdf_renderer = find_pdftocairo(args.pdftocairo)
    if not pdf_renderer:
        parser.error("pdftocairo was not found; install Poppler or pass --pdftocairo")
    blender = find_blender()
    if not blender:
        parser.error("Blender was not found; run `python3 pipeline.py setup`")

    dpi = args.dpi if args.dpi is not None else BASE_VECTOR_DPI * args.size / BASE_SIZE
    if dpi < 72:
        parser.error("--dpi must be at least 72")
    art_scale = dpi / BASE_VECTOR_DPI
    cache = ROOT / "build/work/highres-cat-vector-parts" / f"{args.size}px-{dpi:g}dpi"
    cache.mkdir(parents=True, exist_ok=True)
    records = []
    for number in numbers:
        destination = output / output_name(number)
        if args.keep_existing and destination.is_file():
            from tools.package_boy import read_rgba
            width, height, pixels = read_rgba(destination)
            if width == args.size and height == args.size and any(pixels[3::4]):
                print(f"Keeping existing {destination}", flush=True)
                records.append({"cat": number, "file": destination.name, "size": args.size})
                continue
        vector = source / f"Ai/Cat Characters/Char{number} Parts.ai"
        if not vector.is_file():
            parser.error(f"Missing vector source: {vector}")
        parts = cache / f"C{number:02d}"
        parts.mkdir(parents=True, exist_ok=True)
        prefix = parts / "part"
        subprocess.run([
            str(pdf_renderer), "-png", "-transp", "-r", f"{dpi:g}",
            str(vector), str(prefix),
        ], check=True)
        required = [parts / f"part-{page}.png" for page in (1, 2, 4, 5)]
        if number in (9, 10):
            required.append(parts / "part-6.png")
        missing = [path for path in required if not path.is_file()]
        if missing:
            raise RuntimeError(f"Vector export did not produce: {', '.join(map(str, missing))}")
        subprocess.run([
            str(blender), "--background", "--factory-startup", "--python-exit-code", "1",
            "--python", str(Path(__file__).resolve()), "--", str(destination), str(source),
            str(parts), str(number), str(args.size), f"{art_scale:.12g}",
        ], cwd=ROOT, check=True)
        records.append({"cat": number, "file": destination.name, "size": args.size})

    manifest = {
        "format": "transparent-cat-png-export-v1",
        "size": {"w": args.size, "h": args.size},
        "vectorRasterDpi": dpi,
        "source": str(source.relative_to(ROOT)) if ROOT in source.parents else str(source),
        "method": "PDF-compatible AI artboards rasterized by pdftocairo and assembled from supplied Spine transforms",
        "transparent": True,
        "cats": [{**record, "identity": identity(record["cat"])} for record in records],
    }
    (output / "export-manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(f"Exported {len(records)} high-resolution cat PNG(s) to {output}", flush=True)


if __name__ == "__main__":
    if "--" in sys.argv:
        worker()
    else:
        main()
