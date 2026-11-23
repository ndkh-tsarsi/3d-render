"""Run inside Blender: smart-fill materials, render actions, and pack HTML5 atlases."""

from __future__ import annotations

import argparse
import colorsys
import hashlib
import json
import math
import re
import shutil
import sys
from collections import defaultdict
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector


LOOPING_ACTIONS = {"idle", "walk", "run", "swim"}
KNOWN_ACTIONS = ("attack", "death", "idle", "jump", "run", "walk", "swim")


def log(message: str) -> None:
    print(f"[blender-sprites] {message}", flush=True)


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return slug or "asset"


def parse_args() -> argparse.Namespace:
    user_args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--size", type=int, default=256)
    parser.add_argument("--fps", type=float, default=12.0)
    parser.add_argument("--max-frames", type=int, default=0)
    parser.add_argument("--max-atlas-size", type=int, default=2048)
    parser.add_argument("--view", choices=("left", "right"), default="right")
    parser.add_argument("--engine", choices=("cycles", "eevee"), default="cycles")
    parser.add_argument("--actions")
    parser.add_argument("--recolor", action="store_true")
    parser.add_argument("--keep-existing", action="store_true")
    return parser.parse_args(user_args)


def clean_known_outputs(output: Path) -> None:
    frames = output / "frames"
    if frames.is_dir():
        shutil.rmtree(frames)
    for pattern in ("atlas-*.png", "atlas-*.json"):
        for path in output.glob(pattern):
            if path.is_file():
                path.unlink()
    for name in ("manifest.json", "thumbnail.png"):
        path = output / name
        if path.is_file():
            path.unlink()


def canonical_action(name: str) -> str:
    lowered = name.casefold()
    for action in KNOWN_ACTIONS:
        if action in lowered:
            return action
    parts = [part for part in re.split(r"[^a-z0-9]+", lowered) if part]
    return parts[-1] if parts else "animation"


def set_frame(scene: bpy.types.Scene, frame: float) -> None:
    integer = math.floor(frame)
    scene.frame_set(integer, subframe=frame - integer)


def sample_frames(
    action: bpy.types.Action,
    source_fps: float,
    target_fps: float,
    loop: bool,
    maximum: int,
) -> list[float]:
    start = float(action.frame_range[0])
    end = float(action.frame_range[1])
    if end < start:
        start, end = end, start
    step = max(source_fps / target_fps, 0.001)
    frames: list[float] = []
    current = start
    limit = end - 1e-5 if loop and end > start else end + 1e-5
    while current <= limit:
        frames.append(current)
        current += step
    if not frames:
        frames = [start]
    if not loop and abs(frames[-1] - end) > 1e-4:
        frames.append(end)
    if maximum and len(frames) > maximum:
        indices = np.linspace(0, len(frames) - 1, maximum).round().astype(int)
        frames = [frames[index] for index in dict.fromkeys(indices.tolist())]
    return frames


def ensure_materials(meshes: list[bpy.types.Object], asset_id: str, recolor: bool) -> None:
    materials: list[bpy.types.Material] = []
    for obj in meshes:
        if not obj.data.materials:
            material = bpy.data.materials.new(name="Body")
            obj.data.materials.append(material)
        for material in obj.data.materials:
            if material and material not in materials:
                materials.append(material)

    generic_names = {"material", "material.001", "default", "body", "gray", "grey"}
    neutral_generic = []
    for material in materials:
        rgb = tuple(float(value) for value in material.diffuse_color[:3])
        saturation = colorsys.rgb_to_hsv(*rgb)[1]
        neutral_generic.append(saturation < 0.055 and material.name.casefold() in generic_names)
    blank_model = bool(materials) and all(neutral_generic)

    for index, material in enumerate(materials):
        original = tuple(max(0.0, min(1.0, float(value))) for value in material.diffuse_color[:3])
        invalid = max(original) < 0.002 or not all(math.isfinite(value) for value in original)
        if recolor or blank_model or invalid:
            color = semantic_color(asset_id, material.name, index)
        else:
            color = enhance_authored_color(original, material.name)

        material.diffuse_color = (*color, 1.0)
        material.use_nodes = True
        nodes = material.node_tree.nodes
        nodes.clear()
        output = nodes.new("ShaderNodeOutputMaterial")
        shader = nodes.new("ShaderNodeBsdfPrincipled")
        shader.inputs["Base Color"].default_value = (*color, 1.0)
        shader.inputs["Metallic"].default_value = 0.0
        shader.inputs["Roughness"].default_value = 0.76
        if "Specular IOR Level" in shader.inputs:
            shader.inputs["Specular IOR Level"].default_value = 0.22
        if "Emission Color" in shader.inputs:
            shader.inputs["Emission Color"].default_value = (*color, 1.0)
        if "Emission Strength" in shader.inputs:
            shader.inputs["Emission Strength"].default_value = 0.08
        material.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])

    for obj in meshes:
        for polygon in obj.data.polygons:
            polygon.use_smooth = False
    mode = "new deterministic palette" if recolor else "enhanced authored colors with smart gray fallback"
    log(f"Prepared {len(materials)} material(s): {mode}")


def enhance_authored_color(color: tuple[float, float, float], name: str) -> tuple[float, float, float]:
    lowered = name.casefold()
    hue, saturation, value = colorsys.rgb_to_hsv(*color)
    if any(token in lowered for token in ("black", "outline", "eye", "pupil")):
        return color
    if saturation < 0.055:
        # Neutral materials can be intentional (sharks, dolphins, teeth). Improve
        # their tonal separation without inventing a hue.
        adjusted = min(0.82, max(0.22, value * 1.18))
        return (adjusted, adjusted, adjusted)
    saturation = min(0.9, max(0.38, saturation * 1.5))
    value = min(0.82, max(0.38, value * 1.5))
    return colorsys.hsv_to_rgb(hue, saturation, value)


def semantic_color(asset_id: str, material_name: str, index: int) -> tuple[float, float, float]:
    digest = hashlib.sha256(asset_id.encode("utf-8")).digest()
    base_hue = int.from_bytes(digest[:2], "big") / 65535.0
    name = material_name.casefold()
    if any(token in name for token in ("black", "outline", "eye", "pupil")):
        return (0.012, 0.016, 0.022)
    if any(token in name for token in ("white", "teeth", "tooth")):
        return (0.82, 0.76, 0.62)
    if any(token in name for token in ("red", "tongue", "mouth")):
        return (0.62, 0.025, 0.035)

    hue = (base_hue + index * 0.17) % 1.0
    saturation = 0.62
    value = 0.58
    if any(token in name for token in ("bottom", "belly", "front", "light")):
        saturation = 0.32
        value = 0.78
    elif any(token in name for token in ("fins", "stripe", "plate", "accent")):
        hue = (base_hue + 0.42) % 1.0
        saturation = 0.72
        value = 0.68
    elif any(token in name for token in ("top", "dark")):
        saturation = 0.68
        value = 0.42
    return colorsys.hsv_to_rgb(hue, saturation, value)


def assign_action(armature: bpy.types.Object | None, action: bpy.types.Action | None) -> None:
    if armature is None:
        return
    animation = armature.animation_data_create()
    animation.action = action
    if hasattr(animation, "use_nla"):
        animation.use_nla = False


def evaluated_bounds(meshes: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    minimum = Vector((math.inf, math.inf, math.inf))
    maximum = Vector((-math.inf, -math.inf, -math.inf))
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            matrix = evaluated.matrix_world
            for vertex in mesh.vertices:
                point = matrix @ vertex.co
                for axis in range(3):
                    minimum[axis] = min(minimum[axis], point[axis])
                    maximum[axis] = max(maximum[axis], point[axis])
        finally:
            evaluated.to_mesh_clear()
    return minimum, maximum


def union_bounds(
    scene: bpy.types.Scene,
    armature: bpy.types.Object | None,
    meshes: list[bpy.types.Object],
    animations: list[dict],
) -> tuple[Vector, Vector]:
    overall_min = Vector((math.inf, math.inf, math.inf))
    overall_max = Vector((-math.inf, -math.inf, -math.inf))
    for animation in animations:
        assign_action(armature, animation["action"])
        for frame in animation["samples"]:
            set_frame(scene, frame)
            current_min, current_max = evaluated_bounds(meshes)
            for axis in range(3):
                overall_min[axis] = min(overall_min[axis], current_min[axis])
                overall_max[axis] = max(overall_max[axis], current_max[axis])
    if not all(math.isfinite(value) for value in (*overall_min, *overall_max)):
        raise RuntimeError("Could not determine animated mesh bounds")
    return overall_min, overall_max


def point_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def configure_scene(
    scene: bpy.types.Scene,
    bounds_min: Vector,
    bounds_max: Vector,
    size: int,
    view: str,
    engine: str,
) -> tuple[bpy.types.Object, dict]:
    for obj in list(scene.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)

    center = (bounds_min + bounds_max) * 0.5
    dimensions = bounds_max - bounds_min
    scale = max(float(dimensions.x), float(dimensions.y), float(dimensions.z), 1.0)

    camera_data = bpy.data.cameras.new("SpriteCamera")
    camera = bpy.data.objects.new("SpriteCamera", camera_data)
    scene.collection.objects.link(camera)
    direction = 1.0 if view == "right" else -1.0
    camera.location = center + Vector((direction * scale * 3.2, 0.0, 0.0))
    point_at(camera, center)
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = max(float(dimensions.z), float(dimensions.y)) * 1.16
    camera_data.lens = 50
    camera_data.clip_start = max(0.001, scale * 0.001)
    camera_data.clip_end = scale * 12.0
    scene.camera = camera

    def light(name: str, offset: tuple[float, float, float], color: tuple[float, float, float], power: float, area: float) -> None:
        data = bpy.data.lights.new(name=name, type="AREA")
        data.energy = power * scale * scale
        data.color = color
        data.shape = "DISK"
        data.size = area * scale
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = center + Vector(offset) * scale
        point_at(obj, center)

    light("Key", (1.6 * direction, -0.85, 1.45), (1.0, 0.83, 0.68), 22.0, 1.15)
    light("Fill", (1.0 * direction, 1.1, 0.45), (0.55, 0.72, 1.0), 8.0, 1.45)
    light("Rim", (-1.2 * direction, 0.25, 1.15), (0.55, 0.78, 1.0), 12.0, 0.85)

    world = scene.world or bpy.data.worlds.new("SpriteWorld")
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background:
        background.inputs["Color"].default_value = (0.025, 0.035, 0.06, 1.0)
        background.inputs["Strength"].default_value = 0.18

    if engine == "cycles":
        try:
            bpy.ops.preferences.addon_enable(module="cycles")
        except Exception:
            pass
        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = 12
        scene.cycles.use_adaptive_sampling = True
        scene.cycles.adaptive_threshold = 0.08
        scene.cycles.use_denoising = True
        scene.cycles.max_bounces = 4
        scene.cycles.diffuse_bounces = 2
        scene.cycles.glossy_bounces = 1
        scene.cycles.transparent_max_bounces = 2
    else:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = 1.0
    scene.render.pixel_aspect_y = 1.0
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 25
    scene.render.use_file_extension = True
    scene.render.use_overwrite = True
    scene.render.use_placeholder = False
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0

    bottom_fraction = 0.5 + (center.z - bounds_min.z) / camera_data.ortho_scale
    pivot = {
        "x": size // 2,
        "y": max(0, min(size, int(round(size * bottom_fraction)))),
        "normalized": [0.5, round(max(0.0, min(1.0, bottom_fraction)), 6)],
    }
    return camera, pivot


def collect_animations(args: argparse.Namespace, scene: bpy.types.Scene) -> list[dict]:
    wanted = {item.strip().casefold() for item in args.actions.split(",")} if args.actions else None
    source_fps = scene.render.fps / scene.render.fps_base
    animations: list[dict] = []
    used_names: set[str] = set()
    for action in sorted(bpy.data.actions, key=lambda value: (canonical_action(value.name), value.name.casefold())):
        canonical = canonical_action(action.name)
        if wanted and canonical not in wanted and action.name.casefold() not in wanted:
            continue
        name = canonical
        suffix = 2
        while name in used_names:
            name = f"{canonical}-{suffix}"
            suffix += 1
        used_names.add(name)
        loop = canonical in LOOPING_ACTIONS
        samples = sample_frames(action, source_fps, args.fps, loop, args.max_frames)
        animations.append(
            {
                "name": name,
                "canonical": canonical,
                "action": action,
                "loop": loop,
                "samples": samples,
                "source_range": [float(action.frame_range[0]), float(action.frame_range[1])],
            }
        )
    if not animations:
        if wanted:
            raise RuntimeError(f"No actions matched: {', '.join(sorted(wanted))}")
        animations.append(
            {
                "name": "still",
                "canonical": "still",
                "action": None,
                "loop": False,
                "samples": [float(scene.frame_current)],
                "source_range": [float(scene.frame_current), float(scene.frame_current)],
            }
        )
    return animations


def render_frames(
    scene: bpy.types.Scene,
    armature: bpy.types.Object | None,
    animations: list[dict],
    output: Path,
    size: int,
    fps: float,
) -> list[dict]:
    records: list[dict] = []
    source_fps = scene.render.fps / scene.render.fps_base
    default_duration = 1000.0 / fps
    total = sum(len(animation["samples"]) for animation in animations)
    completed = 0
    for animation in animations:
        assign_action(armature, animation["action"])
        action_dir = output / "frames" / animation["name"]
        action_dir.mkdir(parents=True, exist_ok=True)
        log(f"Rendering {animation['name']} ({len(animation['samples'])} frames)")
        for index, source_frame in enumerate(animation["samples"]):
            set_frame(scene, source_frame)
            image_path = action_dir / f"{index:04d}.png"
            scene.render.filepath = str(image_path)
            bpy.ops.render.render(write_still=True)
            key = f"{animation['name']}/{index:04d}"
            if index + 1 < len(animation["samples"]):
                source_delta = animation["samples"][index + 1] - source_frame
                duration = max(1.0, source_delta / source_fps * 1000.0)
            elif animation["loop"] and len(animation["samples"]) > 1:
                source_delta = animation["source_range"][1] - source_frame
                duration = max(1.0, source_delta / source_fps * 1000.0)
            elif animation["loop"]:
                source_delta = animation["source_range"][1] - animation["source_range"][0]
                duration = max(default_duration, source_delta / source_fps * 1000.0)
            elif len(animation["samples"]) > 1:
                source_delta = source_frame - animation["samples"][index - 1]
                duration = max(1.0, source_delta / source_fps * 1000.0)
            else:
                duration = default_duration
            records.append(
                {
                    "key": key,
                    "animation": animation["name"],
                    "index": index,
                    "sourceFrame": round(source_frame, 6),
                    "durationMs": round(duration, 4),
                    "path": image_path,
                    "image": str(image_path.relative_to(output)).replace("\\", "/"),
                }
            )
            completed += 1
            if completed == total or completed % 10 == 0:
                log(f"Rendered {completed}/{total}")
    return records


def pack_atlases(records: list[dict], output: Path, size: int, maximum: int) -> list[dict]:
    columns = max(1, maximum // size)
    rows_per_page = max(1, maximum // size)
    capacity = columns * rows_per_page
    atlas_pages: list[dict] = []
    for page_number, start in enumerate(range(0, len(records), capacity)):
        chunk = records[start : start + capacity]
        page_columns = min(columns, len(chunk))
        page_rows = math.ceil(len(chunk) / columns)
        width = page_columns * size
        height = page_rows * size
        pixels = np.zeros((height, width, 4), dtype=np.float32)
        page_frames: dict[str, dict] = {}
        page_animations: dict[str, list[str]] = defaultdict(list)

        for index, record in enumerate(chunk):
            column = index % columns
            row_from_top = index // columns
            x = column * size
            y = row_from_top * size
            image = bpy.data.images.load(str(record["path"]), check_existing=False)
            try:
                frame_pixels = np.empty(size * size * 4, dtype=np.float32)
                image.pixels.foreach_get(frame_pixels)
                frame_pixels = frame_pixels.reshape((size, size, 4))
                if float(frame_pixels[:, :, 3].max()) <= 0.001:
                    raise RuntimeError(f"Rendered frame is fully transparent: {record['path']}")
                border_alpha = max(
                    float(frame_pixels[0, :, 3].max()),
                    float(frame_pixels[-1, :, 3].max()),
                    float(frame_pixels[:, 0, 3].max()),
                    float(frame_pixels[:, -1, 3].max()),
                )
                if border_alpha > 0.02:
                    log(f"WARNING: visible pixels touch an edge in {record['key']}")
                bottom = height - (row_from_top + 1) * size
                pixels[bottom : bottom + size, x : x + size, :] = frame_pixels
            finally:
                bpy.data.images.remove(image)

            rect = {"x": x, "y": y, "w": size, "h": size}
            record["page"] = page_number
            record["frame"] = rect
            page_frames[record["key"]] = {
                "frame": rect,
                "rotated": False,
                "trimmed": False,
                "spriteSourceSize": {"x": 0, "y": 0, "w": size, "h": size},
                "sourceSize": {"w": size, "h": size},
            }
            page_animations[record["animation"]].append(record["key"])

        image_name = f"atlas-{page_number}.png"
        data_name = f"atlas-{page_number}.json"
        atlas = bpy.data.images.new(
            f"SpriteAtlas{page_number}", width=width, height=height, alpha=True, float_buffer=False
        )
        try:
            atlas.colorspace_settings.name = "sRGB"
            atlas.alpha_mode = "STRAIGHT"
            atlas.pixels.foreach_set(pixels.ravel())
            atlas.filepath_raw = str(output / image_name)
            atlas.file_format = "PNG"
            atlas.save()
        finally:
            bpy.data.images.remove(atlas)

        atlas_json = {
            "frames": page_frames,
            "animations": dict(page_animations),
            "meta": {
                "app": "blender-html5-sprite-pipeline",
                "version": "1.0",
                "image": image_name,
                "format": "RGBA8888",
                "size": {"w": width, "h": height},
                "scale": "1",
            },
        }
        (output / data_name).write_text(json.dumps(atlas_json, indent=2) + "\n", encoding="utf-8")
        atlas_pages.append(
            {"page": page_number, "image": image_name, "data": data_name, "size": {"w": width, "h": height}}
        )
        log(f"Packed {image_name}: {len(chunk)} frames, {width}x{height}")
    return atlas_pages


def detect_license(source: Path) -> tuple[str | None, str, str | None]:
    candidates = [source.parent, *list(source.parents)[:4]]
    for folder in candidates:
        for name in ("License.txt", "LICENSE.txt", "LICENSE", "license.txt"):
            path = folder / name
            if not path.is_file():
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            lowered = text.casefold()
            license_id = "CC0-1.0" if "cc0 1.0" in lowered else "unknown"
            author = "Quaternius" if "quaternius" in lowered else None
            try:
                license_file = str(path.relative_to(source.parent.parent)).replace("\\", "/")
            except ValueError:
                license_file = path.name
            return author, license_id, license_file
    return None, "unknown", None


def main() -> None:
    args = parse_args()
    source = Path(bpy.data.filepath).resolve()
    if not source.is_file():
        raise RuntimeError("Open a saved .blend file before running this script")
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    if not args.keep_existing:
        clean_known_outputs(output)

    asset_id = slugify(source.stem)
    scene = bpy.context.scene
    meshes = [obj for obj in scene.objects if obj.type == "MESH" and not obj.hide_render]
    if not meshes:
        raise RuntimeError(f"No renderable mesh was found in {source.name}")
    armatures = [obj for obj in scene.objects if obj.type == "ARMATURE"]
    armature = armatures[0] if armatures else None

    animations = collect_animations(args, scene)
    ensure_materials(meshes, asset_id, args.recolor)
    log(f"Scanning stable bounds across {sum(len(item['samples']) for item in animations)} poses")
    bounds_min, bounds_max = union_bounds(scene, armature, meshes, animations)
    _, pivot = configure_scene(scene, bounds_min, bounds_max, args.size, args.view, args.engine)
    records = render_frames(scene, armature, animations, output, args.size, args.fps)
    atlases = pack_atlases(records, output, args.size, args.max_atlas_size)

    grouped: dict[str, list[dict]] = defaultdict(list)
    for record in records:
        grouped[record["animation"]].append(
            {
                "key": record["key"],
                "image": record["image"],
                "page": record["page"],
                "frame": record["frame"],
                "sourceFrame": record["sourceFrame"],
                "durationMs": record["durationMs"],
            }
        )

    animation_manifest = {}
    for animation in animations:
        animation_manifest[animation["name"]] = {
            "sourceAction": animation["action"].name if animation["action"] else None,
            "sourceRange": animation["source_range"],
            "loop": animation["loop"],
            "fps": args.fps,
            "frames": grouped[animation["name"]],
        }

    preferred = next(
        (record for record in records if record["animation"] in {"idle", "swim"}), records[0]
    )
    shutil.copy2(preferred["path"], output / "thumbnail.png")
    author, license_id, license_file = detect_license(source)
    manifest = {
        "format": "html5-sprite-asset-v1",
        "id": asset_id,
        "name": source.stem,
        "frameSize": {"w": args.size, "h": args.size},
        "maxAtlasSize": args.max_atlas_size,
        "view": {"type": "profile", "cameraAxis": "+X" if args.view == "right" else "-X"},
        "pivot": pivot,
        "thumbnail": "thumbnail.png",
        "atlases": atlases,
        "animations": animation_manifest,
        "source": {
            "file": source.name,
            "author": author,
            "license": license_id,
            "licenseFile": license_file,
        },
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    log(f"Finished {asset_id}: {len(records)} frames across {len(atlases)} atlas page(s)")


if __name__ == "__main__":
    main()
