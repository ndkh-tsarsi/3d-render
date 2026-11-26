#!/usr/bin/env python3
"""Compose the two authored Craftpix helper cats as weapon-free fishing actors."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
SOURCE = "raw/craftpix-net-397030-free-cartoon-cat-defense-game-asset-kit"
PROFILES = {
    "boxer": {"source": "Cat Boxing", "skeleton": "Json Atlas/CatBoxing/CatBoxing.json",
        "id": "fishing-cat-boxer", "character": "CatBoxing", "label": "Võ sĩ", "order": 6},
    "guardian": {"source": "Cat Guardian", "skeleton": "Json Atlas/CatGuardian/Enemy.json",
        "id": "fishing-cat-guardian", "character": "CatGuardian", "label": "Hiệp sĩ", "order": 7},
}


def worker():
    import bpy
    import numpy as np
    from tools.package_boy import point, read_rgba, write_rgba
    from tools.fishing_cat_roster import write_hand_layer

    args = sys.argv[sys.argv.index("--") + 1:]
    output, source, parts = map(Path, args[:3])
    kind = args[3]
    probe = "--probe" in args
    hand_base = Path(args[args.index("--hand-layers-from") + 1]) if "--hand-layers-from" in args else None
    arm_mode = not hand_base and "--mask-hands-only" not in args
    profile = PROFILES[kind]
    size = 512
    clips = {"idle": 12, "pull": 12, "bite": 12, "celebrate": 24, "miss": 24}
    if arm_mode:
        from tools.cat_arm_pose import CLIP_COUNTS, draw_hand, export_hand, make_hand
        clips = dict(CLIP_COUNTS)
    output.mkdir(parents=True, exist_ok=True)
    if hand_base:
        if output.resolve() == hand_base.resolve() or output.resolve() in hand_base.resolve().parents or hand_base.resolve() in output.resolve().parents:
            raise RuntimeError("Native hand output must be separate from the existing rendered cohort")
        shutil.copytree(hand_base, output, dirs_exist_ok=True)

    def load(page):
        name = f"part-{page}.png" if isinstance(page, int) else page
        image = bpy.data.images.load(str(parts / name), check_existing=False)
        image.colorspace_settings.name = "Non-Color"
        width, height = image.size
        pixels = np.empty(width * height * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        bpy.data.images.remove(image)
        return pixels.reshape(height, width, 4)[::-1].copy()

    # PDF artboard ordering is verified against each supplied PNG and skeleton.
    pages = {"head": 1, "body": 2, "tail": 5, "paw": 6, "back_glove": 3} if kind == "boxer" else {
        "head": 1, "body": 2, "tail": 4, "paw": 6,
    }
    art = {name: load(page) for name, page in pages.items()}
    guardian_compound = arm_mode and kind == "guardian"
    guardian_layout_reference = None
    if guardian_compound:
        # Hand1 is only a forearm. The original closed fist is authored in
        # Hand2 alongside the plunger; preserve that exact fist separately.
        forearm, fist = art["paw"], load("native-fist.png")
        if forearm.shape[:2] != (76, 118) or fist.shape[:2] != (328, 362):
            raise RuntimeError("Guardian needs its complete native forearm and original closed fist")
        compound = np.zeros((336, 384, 4), np.float32)
        compound[191:267, 255:373] = forearm
        target = compound[:328, :362]
        alpha = fist[:, :, 3:4]
        result_alpha = alpha + target[:, :, 3:4] * (1-alpha)
        premult = fist[:, :, :3]*alpha + target[:, :, :3]*target[:, :, 3:4]*(1-alpha)
        target[:, :, :3] = np.divide(premult, result_alpha,
            out=np.zeros_like(premult), where=result_alpha > 1e-6)
        target[:, :, 3:4] = result_alpha
        art["paw"] = compound
    hand_height, hand_width = art["paw"].shape[:2]
    hand_layer = {"image": "hand.png", "size": {"w": hand_width, "h": hand_height}}
    if arm_mode:
        # The source Hand1 is used whole, at the same assembly scale as the
        # head/body. No new fingers, forearm strokes or resized palm are drawn.
        if kind == "boxer":
            native_points = {"shoulder": (54.054, 93.401), "elbow": (75., 108.),
                "wrist": (105., 103.), "grip": (171., 124.)}
            base_rotation = 0.
            overlay_bounds = {"x": 115, "y": 112, "w": 100, "h": 33}
        else:
            # Hand1's Spine shoulder and the real Hand2 palm share the same
            # source coordinate system. Original pixels are only positioned,
            # with subpixel source placement rounded by <0.25 native pixels.
            native_points = {"shoulder": (349.558261, 210.897938), "elbow": (327., 222.),
                "wrist": (285., 236.), "grip": (270., 245.)}
            base_rotation = math.pi + .55
            overlay_bounds = {"x": 256, "y": 232, "w": 28, "h": 28}
        arm_hand = make_hand(art["paw"], wrist=native_points["wrist"],
            grip=native_points["grip"], scale=1.)
        rest_hand_angle = base_rotation + math.atan2(
            native_points["grip"][1] - native_points["wrist"][1],
            native_points["grip"][0] - native_points["wrist"][0])
        rest_hand_angle = math.atan2(math.sin(rest_hand_angle), math.cos(rest_hand_angle))
    if "--mask-hands-only" in args:
        manifest = json.loads((output / "manifest.json").read_text())
        if manifest.get("armRig"):
            raise RuntimeError("Articulated paws must retain their complete silhouette; do not apply a legacy visibility mask")
        records = [frame for action in manifest["animations"].values() for frame in action["frames"]]
        images = [read_rgba(output / record["image"])[2] for record in records]
        write_hand_layer(output, art["paw"], records, images, True)
        print(f"Masked {profile['id']} native hand against {len(records)} unchanged baked poses", flush=True)
        return
    skeleton = json.loads((source / profile["skeleton"]).read_text())
    bones = {}
    for bone in skeleton["bones"]:
        px, py, angle = bones.get(bone.get("parent"), (0.0, 0.0, 0.0))
        bones[bone["name"]] = (
            px + math.cos(angle) * bone.get("x", 0) - math.sin(angle) * bone.get("y", 0),
            py + math.sin(angle) * bone.get("x", 0) + math.cos(angle) * bone.get("y", 0),
            angle + math.radians(bone.get("rotation", 0)),
        )
    slots = {slot["name"]: slot["bone"] for slot in skeleton["slots"]}
    attachments = skeleton["skins"][0]["attachments"]

    def setup(name):
        attachment = attachments[name][name]
        x, y, angle = bones[slots[name]]
        return (
            x + math.cos(angle) * attachment.get("x", 0) - math.sin(angle) * attachment.get("y", 0),
            y + math.sin(angle) * attachment.get("x", 0) + math.cos(angle) * attachment.get("y", 0),
        )

    bx, by = setup("Body1" if kind == "boxer" else "Body")
    labels = {"head": "Head1" if kind == "boxer" else "Head", "body": "Body1" if kind == "boxer" else "Body",
        "tail": "Tails", "paw": "Hand1"}
    if kind == "boxer":
        labels["back_glove"] = "Hand2"
    positions = {name: ((setup(label)[0] - bx) * 4, -(setup(label)[1] - by) * 4)
        for name, label in labels.items()}
    if kind == "guardian":
        # The combat setup tucks the forearm behind the large helmet. Lower the
        # same native forearm into a fishing hold where the paw stays exposed.
        positions["paw"] = (positions["paw"][0], positions["paw"][1] + 40)
        if guardian_compound:
            x, y = positions["paw"]
            guardian_layout_reference = (x, y, 118, 76)
            positions["paw"] = (x-122, y-61)
    # These points are inside the actual vector glove/forearm, rather than a
    # guessed square-frame point. The same transform drives both art and grip.
    paw_landmark = (171.0 - art["paw"].shape[1] / 2, 124.0 - art["paw"].shape[0] / 2) if kind == "boxer" else (
        33.0 - art["paw"].shape[1] / 2, 45.0 - art["paw"].shape[0] / 2,
    )

    def expression(name):
        image = art["head"].copy()
        if kind == "guardian":
            # The opaque authored helmet has no exposed muzzle or eyes.
            # Keep it intact; posture and the player's marks carry reactions.
            return image
        height, width = image.shape[:2]
        yy, xx = np.mgrid[:height, :width].astype(np.float32)
        ink = np.array([59, 23, 27], np.float32) / 255
        fur = np.array([241, 191, 140], np.float32) / 255
        cream = np.array([251, 231, 196], np.float32) / 255

        def paint(mask, color):
            opacity = np.clip(mask, 0, 1)[:, :, None]
            image[:, :, :3] = image[:, :, :3] * (1 - opacity) + np.asarray(color) * opacity

        def ellipse(cx, cy, rx, ry, color):
            paint((1 - np.sqrt(((xx + .5 - cx) / rx) ** 2 + ((yy + .5 - cy) / ry) ** 2)) * min(rx, ry) + .5, color)

        def stroke(points, width, color):
            distance = np.full((height, image.shape[1]), 1e6, np.float32)
            for (ax, ay), (bx, by) in zip(points, points[1:]):
                dx, dy = bx - ax, by - ay
                t = np.clip(((xx - ax) * dx + (yy - ay) * dy) / max(dx * dx + dy * dy, .001), 0, 1)
                distance = np.minimum(distance, np.hypot(xx - ax - t * dx, yy - ay - t * dy))
            paint(width / 2 + .5 - distance, color)

        def curve(a, b, c):
            return [((1-t)**2*a[0] + 2*(1-t)*t*b[0] + t*t*c[0],
                (1-t)**2*a[1] + 2*(1-t)*t*b[1] + t*t*c[1]) for t in np.linspace(0, 1, 25)]

        for cx in (187, 302):
            ellipse(cx, 149, 55, 34, fur)
            if name == "alert":
                ellipse(cx, 150, 33, 28, ink)
                ellipse(cx, 150, 29, 24, [1, .969, .894])
                ellipse(cx - 3, 152, 10, 14, ink)
                ellipse(cx - 6, 147, 3, 4, [1, 1, .97])
            elif name == "happy":
                stroke(curve((cx - 26, 155), (cx, 126), (cx + 26, 155)), 6, ink)
            else:
                ellipse(cx, 156, 28, 20, ink)
                ellipse(cx, 156, 24, 16, [1, .969, .894])
                ellipse(cx, 165, 9, 10, ink)
                stroke(curve((cx - 27, 144), (cx, 150), (cx + 27, 141)), 5, ink)
        patch = np.minimum.reduce([xx - 224, 282 - xx, yy - 186, 223 - yy])
        paint(patch + .5, cream)
        # Remove the old smile's outer ink curls without painting a rectangle
        # across the authored orange cheeks or erasing the source nose.
        old_ink = np.clip((.5 - image[:, :, :3].max(axis=2)) / .18, 0, 1)
        mouth_region = (xx > 216) & (xx < 310) & (yy > 180) & (yy < 225)
        nose = (np.abs(xx - 253) < 16) & (yy < 189)
        paint(old_ink * mouth_region * ~nose, cream)
        if name == "alert":
            ellipse(253, 200, 10, 13, ink)
            ellipse(253, 202, 5, 6, [.74, .29, .24])
        elif name == "happy":
            smile = np.clip((1 - np.sqrt(((xx - 253) / 22)**2 + ((yy - 196) / 16)**2)) * 16 + .5, 0, 1)
            smile *= np.clip(yy - 188, 0, 1)
            paint(smile, ink)
            tongue = np.clip((1 - np.sqrt(((xx - 254) / 11)**2 + ((yy - 207) / 5)**2)) * 5 + .5, 0, 1)
            paint(tongue * smile, [.97, .52, .43])
        else:
            stroke(curve((239, 205), (253, 188), (267, 205)), 4.5, ink)
        return image

    for label in ("alert", "happy", "sad"):
        art[label] = expression(label)
    boxes = []
    for name, (x, y) in positions.items():
        height, width = art[name].shape[:2]
        if name == "paw" and guardian_layout_reference:
            x, y, width, height = guardian_layout_reference
        boxes.append((x - width/2, y - height/2, x + width/2, y + height/2))
    left = min(box[0] for box in boxes) - 30
    right = max(box[2] for box in boxes) + 30
    top = min(box[1] for box in boxes) - 35
    bottom = max(box[3] for box in boxes) + 24
    scale = min(464 / (right - left), 464 / (bottom - top))
    offset = (256 - (left + right) / 2 * scale, 256 - (top + bottom) / 2 * scale)
    yy, xx = np.mgrid[:size, :size].astype(np.float32)

    def composite(canvas, name, x, y, angle=0.0, stretch=1.0):
        image = art[name]
        height, width = image.shape[:2]
        cx, cy = x * scale + offset[0], y * scale + offset[1]
        dx, dy = (xx + .5 - cx) / scale, (yy + .5 - cy) / scale
        c, s = math.cos(angle), math.sin(angle)
        sx, sy = c * dx + s * dy + width/2 - .5, (-s * dx + c * dy) / stretch + height/2 - .5
        valid = (sx >= 0) & (sy >= 0) & (sx < width - 1) & (sy < height - 1)
        ix, iy = np.clip(sx.astype(int), 0, width - 2), np.clip(sy.astype(int), 0, height - 2)
        fx, fy = np.clip(sx - ix, 0, 1)[:, :, None], np.clip(sy - iy, 0, 1)[:, :, None]
        premult = image.copy()
        premult[:, :, :3] *= premult[:, :, 3:4]
        pixels = (premult[iy, ix] * (1-fx) + premult[iy, ix+1] * fx) * (1-fy) + (premult[iy+1, ix] * (1-fx) + premult[iy+1, ix+1] * fx) * fy
        pixels *= valid[:, :, None]
        canvas[:] = pixels + canvas * (1 - pixels[:, :, 3:4])
        return pixels

    def native_arm_pose(clip, phase, squash, body_y):
        """Rigidly rotate the original bent arm about its source shoulder."""
        phase = max(0., min(1., phase))
        progress = phase*phase*(3-2*phase) if clip == "pull" else 0.
        wind = math.sin(math.pi*min(1., phase/.22)) if clip == "pull" else 0.
        pull_angle = -.20 if kind == "boxer" else -.18
        rotation = pull_angle*progress + .06*wind
        if clip == "idle": rotation = .01*math.sin(phase*math.tau)
        elif clip == "bite": rotation = .018*math.sin(phase*math.tau)
        elif clip == "celebrate":
            progress = 1-phase*phase*(3-2*phase)
            rotation = pull_angle*progress + .035*math.sin(phase*math.tau*2)*math.sin(math.pi*phase)
        elif clip == "miss": rotation = .08*math.sin(math.pi*phase)
        angle = base_rotation + rotation
        ux, uy = native_points["shoulder"]
        px, py = positions["paw"]
        shoulder_x = (px + ux - hand_width/2)*scale + offset[0]
        source_y = py + uy - hand_height/2
        shoulder_y = (source_y*squash + body_y)*scale + offset[1]
        ca, sa = math.cos(angle)*scale, math.sin(angle)*scale
        H = [ca, sa, -sa, ca, shoulder_x-ca*ux+sa*uy, shoulder_y-sa*ux-ca*uy]
        pose = {name: {"x": H[0]*x+H[2]*y+H[4], "y": H[1]*x+H[3]*y+H[5]}
            for name, (x,y) in native_points.items()}
        for key, a, b in (("upperAngle", "shoulder", "elbow"),
                ("forearmAngle", "elbow", "wrist"), ("handAngle", "wrist", "grip")):
            pose[key] = math.atan2(pose[b]["y"]-pose[a]["y"], pose[b]["x"]-pose[a]["x"])
        pose.update(handTransform=H, lengths={"upper": math.dist(native_points["shoulder"],native_points["elbow"])*scale,
            "forearm": math.dist(native_points["elbow"],native_points["wrist"])*scale})
        return pose

    records, images, hand_transforms = [], [], {}
    body_height = art["body"].shape[0]
    for clip, count in clips.items():
        (output / "frames" / clip).mkdir(parents=True, exist_ok=True)
        indices = ([0, count // 2, count - 1] if arm_mode and clip == "pull"
            else [{"idle": 0, "pull": count // 2, "bite": 0, "celebrate": 10, "miss": 12}[clip]]) if probe else range(count)
        for index in indices:
            phase = index / count if clip in ("idle", "bite") else index / (count - 1)
            breath = .5 - .5 * math.cos(phase * math.tau)
            progress = phase * phase * (3 - 2 * phase) if clip == "pull" else 0
            wind = math.sin(math.pi * min(1, phase/.3)) if clip == "pull" else 0
            squash = 1 - .045 * breath if clip == "idle" else 1 - .035 * wind
            hx, hy = positions["head"]
            hx += progress * 8
            hy = hy * squash + wind * 8 - progress * 4
            px, py = positions["paw"]
            px += progress * 20
            py -= progress * 22 - wind * 8
            head_angle, paw_angle = -progress * .035, -progress * .16
            tail_angle, tail_drop = -.22 * breath + progress * .15, 0
            head_name, reaction = "head", "calm"
            if clip == "bite":
                pulse = math.sin(phase * math.tau)
                squash = 1 - .018 * breath
                hx, hy = positions["head"][0] + 2*pulse, positions["head"][1]*squash - 3*breath
                head_angle, tail_angle, paw_angle = .014*pulse, .13*pulse, .012*pulse
                px, py = positions["paw"][0], positions["paw"][1] - 2*breath
                head_name, reaction = "alert", "alert"
            elif clip == "celebrate":
                progress = 1 - phase * phase * (3 - 2*phase)
                envelope = math.sin(math.pi * phase)
                wiggle = math.sin(phase * math.tau * 3) * envelope
                bounce = (.5 - .5 * math.cos(phase * math.tau * 3)) * envelope
                squash = 1 - .045 * bounce
                hx = positions["head"][0] + 8*progress + 2*wiggle
                hy = positions["head"][1]*squash - 4*progress - 7*bounce
                head_angle = -.035*progress + .035*wiggle
                px, py = positions["paw"][0]+20*progress+3*wiggle, positions["paw"][1]-22*progress-7*bounce
                paw_angle, tail_angle = -.16*progress+.035*wiggle, .15*progress+.24*math.sin(phase*math.tau*4)*envelope
                head_name, reaction = ("happy", "happy") if index < count-1 else ("head", "calm")
            elif clip == "miss":
                slump = math.sin(math.pi * phase) ** .8
                squash = 1 - .045 * slump
                hx, hy = positions["head"][0]-4*slump, positions["head"][1]*squash + 10*slump
                head_angle = -.03*slump
                px, py = positions["paw"][0]-1.5*slump, positions["paw"][1]+7*slump
                paw_angle, tail_angle, tail_drop = .045*slump, -.32*slump, 3*slump
                head_name, reaction = ("sad", "disappointed") if index < count-1 else ("head", "calm")
            body_y = (1-squash) * body_height/2
            hy += body_y
            c, s = math.cos(paw_angle), math.sin(paw_angle)
            a, b, c, d = scale*c, scale*s, -scale*s, scale*c
            hand_transform = [a, b, c, d,
                px*scale + offset[0] - a*hand_width/2 - c*hand_height/2,
                py*scale + offset[1] - b*hand_width/2 - d*hand_height/2]
            key = f"{clip}/{index:04d}"
            hand_transforms[key] = hand_transform
            if hand_base:
                continue
            canvas = np.zeros((size, size, 4), np.float32)
            tx, ty = positions["tail"]
            composite(canvas, "tail", tx, ty + tail_drop, tail_angle)
            if "back_glove" in art:
                back_x, back_y = positions["back_glove"]
                composite(canvas, "back_glove", back_x, back_y + body_y)
            if arm_mode:
                arm_pose = native_arm_pose(clip, phase, squash, body_y)
            body = composite(canvas, "body", 0, body_y, stretch=squash)
            if not arm_mode:
                paw_pixels = composite(canvas, "paw", px, py, paw_angle)
            if arm_mode:
                paw_pixels = draw_hand(canvas, arm_pose, arm_hand)
                hand_transform = arm_pose["handTransform"]
            composite(canvas, head_name, hx, hy, head_angle)
            body_rows, body_columns = np.where(body[:, :, 3] >= 24/255)
            feet_y = float(body_rows.max()+1)
            sole = body_columns[body_rows >= feet_y-4]
            feet_x = float((sole.min()+sole.max())/2)
            if arm_mode:
                grip_x, grip_y = arm_pose["grip"]["x"], arm_pose["grip"]["y"]
            else:
                local_x, local_y = paw_landmark
                grip_x = (px + math.cos(paw_angle)*local_x - math.sin(paw_angle)*local_y) * scale + offset[0]
                grip_y = (py + math.sin(paw_angle)*local_x + math.cos(paw_angle)*local_y) * scale + offset[1]
            grip_row, grip_column = int(round(grip_y)), int(round(grip_x))
            if paw_pixels[grip_row, grip_column, 3] < .9 or np.max(np.abs(canvas[grip_row, grip_column] - paw_pixels[grip_row, grip_column])) > .08:
                raise RuntimeError(f"The native paw grip is hidden in {kind}/{clip}/{index}")
            if guardian_compound and np.max(np.abs(paw_pixels[grip_row, grip_column, :3]
                    - np.array([241, 191, 140], np.float32)/255)) > .025:
                raise RuntimeError(f"Guardian {clip}/{index}: grip is not in the original closed cream palm")
            rows, columns = np.where(canvas[:, :, 3] >= 24/255)
            bounds = {"x": int(columns.min()), "y": int(rows.min()), "w": int(columns.max()-columns.min()+1), "h": int(rows.max()-rows.min()+1)}
            if min(bounds["x"], bounds["y"], size-bounds["x"]-bounds["w"], size-bounds["y"]-bounds["h"]) < 8:
                raise RuntimeError(f"Bonus cat pose is too close to the frame edge: {kind}/{clip}/{index}")
            rgba = canvas.copy()
            rgba[:, :, :3] = np.divide(rgba[:, :, :3], rgba[:, :, 3:4], out=np.zeros_like(rgba[:, :, :3]), where=rgba[:, :, 3:4] > 1e-6)
            pixels = bytearray(np.clip(np.rint(rgba*255), 0, 255).astype(np.uint8).tobytes())
            key = f"{clip}/{index:04d}"
            write_rgba(output / "frames" / f"{key}.png", size, size, pixels)
            records.append({"key": key, "image": f"frames/{key}.png", "sourceFrame": index, "durationMs": 1000/18,
                "handTransform": hand_transform,
                "expression": reaction, "bounds": bounds,
                "anchors": {"feet": point(feet_x, feet_y, size, size), "grip": point(grip_x, grip_y, size, size),
                    "head": point(hx*scale+offset[0], hy*scale+offset[1], size, size)},
                "palmCrop": {"x": grip_x-12, "y": grip_y-12, "w": 24, "h": 24}})
            if arm_mode:
                records[-1]["arm"] = {name: arm_pose[name] for name in ("shoulder", "elbow", "wrist", "grip",
                    "upperAngle", "forearmAngle", "handAngle")}
            images.append(pixels)

    if hand_base:
        path = output / "manifest.json"
        manifest = json.loads(path.read_text())
        existing_frames = [frame for action in manifest["animations"].values() for frame in action["frames"]]
        if {frame["key"] for frame in existing_frames} != set(hand_transforms):
            raise RuntimeError("Native hand export does not match the existing complete frame cohort")
        manifest["handLayer"] = hand_layer
        for frame in existing_frames:
            frame["handTransform"] = hand_transforms[frame["key"]]
        path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False)+"\n")
        baked = [read_rgba(output / record["image"])[2] for record in existing_frames]
        write_hand_layer(output, art["paw"], existing_frames, baked, True)
        print(f"Exported {profile['id']}: one native hand, {len(existing_frames)} affine transforms; body images copied unchanged", flush=True)
        return

    # Native exports retain the whole source image. Only its distal grip region
    # is redrawn over the pole at runtime, keeping the upper arm's baked order.
    if arm_mode:
        hand_layer = export_hand(output / "hand.png", arm_hand)
        hand_layer["overlayBounds"] = overlay_bounds
    else:
        write_hand_layer(output, art["paw"], records, images, True)
    atlases = []
    for page, start in enumerate(range(0, len(records), 16)):
        batch = records[start:start+16]
        width, height = 2048, math.ceil(len(batch)/4) * size
        pixels, metadata, animations = bytearray(width*height*4), {}, {}
        for local, (record, data) in enumerate(zip(batch, images[start:start+16])):
            x, y = local % 4*size, local // 4*size
            for row in range(size):
                a, b = ((y+row)*width+x)*4, row*size*4
                pixels[a:a+size*4] = data[b:b+size*4]
            rect = {"x": x, "y": y, "w": size, "h": size}
            record.update(page=page, frame=rect)
            metadata[record["key"]] = {"frame": rect, "rotated": False, "trimmed": False,
                "spriteSourceSize": {"x": 0, "y": 0, "w": size, "h": size}, "sourceSize": {"w": size, "h": size}}
            animations.setdefault(record["key"].split("/")[0], []).append(record["key"])
        write_rgba(output / f"atlas-{page}.png", width, height, pixels)
        (output / f"atlas-{page}.json").write_text(json.dumps({"frames": metadata, "animations": animations,
            "meta": {"app": "local-sprite-pipeline", "image": f"atlas-{page}.png", "format": "RGBA8888",
                "size": {"w": width, "h": height}, "scale": "1"}}, indent=2)+"\n")
        atlases.append({"page": page, "image": f"atlas-{page}.png", "data": f"atlas-{page}.json", "size": {"w": width, "h": height}})
    name = f"Mèo cam · {profile['label']}"
    manifest = {"format": "html5-sprite-asset-v1", "id": profile["id"], "name": name,
        "style": "authored-cat-cartoon", "generatedFace": False,
        "frameSize": {"w": size, "h": size}, "maxAtlasSize": 2048, "anchorFacing": "right" if arm_mode else "left",
        "view": {"type": "profile", "cameraAxis": "left"}, "pivot": records[0]["anchors"]["feet"],
        "actor": {"kind": "cat", "family": "orange-tabby", "familyName": "Mèo cam", "species": "orange-tabby",
            "sourceCharacter": profile["character"], "weaponFree": True,
            "outfit": {"id": kind, "name": profile["label"], "order": profile["order"]}},
        "thumbnail": "thumbnail.png", "atlases": atlases,
        "handLayer": hand_layer,
        "animations": {clip: {"sourceAction": "Recomposed "+clip, "sourceRange": [0, count-1],
            "loop": clip in ("idle", "bite"), "fps": 18, "frames": [record for record in records if record["key"].startswith(clip+"/")]}
            for clip, count in clips.items()},
        "source": {"type": "provided-vector-parts", "folder": str(source.relative_to(ROOT)),
            "file": f"Ai/AddOn Help/{profile['source']}.ai", "skeleton": profile["skeleton"], "author": "Craftpix",
            "licenseFile": "../licenses/craftpix-cat-defense.txt", "parts": list(labels.values()),
            "omittedParts": ["Shade", "Fx", "alternate punch-only Body2/Head2/Hand3"] if kind == "boxer" else ["Shade", "Shield", "Hand2 plunger prop"],
            "modification": "Source costume and native gloves/forearm retained; five fishing clips with measured per-frame anchors; sources unchanged",
            "expressionMethod": "Source helmet retained intact; posture and player accents carry reactions" if kind == "guardian" else "Source fur palette and matched vector facial landmarks"},
        "sampling": "probe" if probe else "complete"}
    if arm_mode:
        manifest["armRig"] = {"id": "fishing-native-art-v1", "type": "baked-native-art",
            "lengths": arm_pose["lengths"], "restHandAngle": rest_hand_angle,
            "assemblyScale": scale, "nativeScale": 1.,
            "nativePoints": {name: {"x": x, "y": y} for name,(x,y) in native_points.items()},
            "restRotation": base_rotation,
            "sourcePart": "Hand1 forearm + original Hand2 closed fist" if guardian_compound else "Hand1",
            "motion": "Whole original bent arm rotates about its native shoulder; source size, silhouette and bend retained"}
        manifest["source"]["modification"] = "Source costume and complete native Hand1 retained at original assembly scale; shoulder-pivot fishing rotations, no newly drawn hand or forearm; source files unchanged"
        if guardian_compound:
            manifest["source"]["modification"] = "Original Hand1 forearm and Hand2 closed fist restored at unchanged native assembly scale; only plunger removed; shoulder-pivot fishing motion with real palm grip, no newly drawn hand or forearm; source files unchanged"
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False)+"\n")
    shutil.copy2(output / records[0]["image"], output / "thumbnail.png")
    print(f"Packaged {profile['id']}: {len(records)} frames, {len(clips)} clips", flush=True)


def main():
    from pipeline import find_blender, validate_output, write_catalog
    from tools.package_fishing_cat import SWIFT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default=SOURCE)
    parser.add_argument("--output", default="build/work/cat-native-arm-bonus")
    parser.add_argument("--only", choices=tuple(PROFILES))
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--export-only", action="store_true")
    parser.add_argument("--hand-layers-from", help="Copy an existing complete cohort unchanged and add native hand metadata only")
    parser.add_argument("--mask-hands-only", action="store_true", help="Refresh hand.png visibility masks only; leave all existing body images and metadata untouched")
    args = parser.parse_args()
    source = (ROOT / args.source).resolve()
    output = (ROOT / args.output).resolve()
    hand_source = (ROOT / args.hand_layers_from).resolve() if args.hand_layers_from else None
    if hand_source and args.probe:
        parser.error("Native hand layers must be matched to a complete frame cohort")
    if args.mask_hands_only and (hand_source or args.probe or args.export_only):
        parser.error("Mask-only mode needs an existing complete output and no other generation mode")
    if (ROOT / "build/work").resolve() not in output.parents:
        parser.error("Choose an isolated output beneath build/work/")
    swift = shutil.which("swift") if sys.platform == "darwin" else None
    blender = find_blender()
    if not swift or not blender:
        parser.error("The source vector exporter needs Swift on macOS and an installed Blender")
    cache = output.parent / "cat-fishing-bonus-vector-parts"
    cache.mkdir(parents=True, exist_ok=True)
    exporter = cache / "render-bonus-parts.swift"
    exporter.write_text(SWIFT)
    for key, profile in PROFILES.items():
        if args.only and args.only != key:
            continue
        parts = cache / key
        parts.mkdir(exist_ok=True)
        subprocess.run([swift, "-module-cache-path", "/private/tmp/fishing-cat-swift-cache",
            str(exporter), str(source / f"Ai/AddOn Help/{profile['source']}.ai"), str(parts)], check=True)
        if key == "guardian" and not args.hand_layers_from and not args.mask_hands_only:
            from tools.guardian_native_arm import separate_guardian_fist_pdf
            native_pdf = separate_guardian_fist_pdf(source / f"Ai/AddOn Help/{profile['source']}.ai", parts)
            native_parts = parts / "native-fist-export"
            native_parts.mkdir(exist_ok=True)
            subprocess.run([swift, "-module-cache-path", "/private/tmp/fishing-cat-swift-cache",
                str(exporter), str(native_pdf), str(native_parts)], check=True)
            shutil.copy2(native_parts / "part-7.png", parts / "native-fist.png")
        if args.export_only:
            print(f"Exported {profile['source']} vector pages to {parts}", flush=True)
            continue
        command = [str(blender), "--background", "--factory-startup", "--python-exit-code", "1",
            "--python", str(Path(__file__).resolve()), "--", str(output / profile["id"]),
            str(source), str(parts), key]
        if args.probe:
            command.append("--probe")
        if args.mask_hands_only:
            if not (output / profile["id"] / "manifest.json").is_file():
                parser.error(f"Missing existing native-hand cohort: {profile['id']}")
            command.append("--mask-hands-only")
        baseline = None
        if hand_source:
            original = hand_source / profile["id"]
            if not (original / "manifest.json").is_file():
                parser.error(f"Missing existing rendered actor: {original}")
            baseline = {path.relative_to(original): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in original.rglob("*.png") if path.name != "hand.png"}
            command.extend(["--hand-layers-from", str(original)])
        subprocess.run(command, cwd=ROOT, check=True)
        if baseline:
            destination = output / profile["id"]
            if any(hashlib.sha256((destination / path).read_bytes()).hexdigest() != digest
                   for path, digest in baseline.items()):
                raise RuntimeError("An original body/atlas PNG changed during native hand metadata export")
    if args.export_only:
        return
    if args.mask_hands_only:
        return
    licenses = output / "licenses"
    licenses.mkdir(exist_ok=True)
    shutil.copy2(source / "license.txt", licenses / "craftpix-cat-defense.txt")
    write_catalog(output)
    validate_output(output)


if __name__ == "__main__":
    if "--" in sys.argv:
        worker()
    else:
        main()
