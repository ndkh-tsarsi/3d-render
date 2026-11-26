"""Animation-stable candy fish materials, installed only in temporary Blender scenes."""
from __future__ import annotations

import json
import re
from pathlib import Path

STYLE_ID = "kid-candy-v1"
UV_NAME = "KidSkinRestUV"

# Display sRGB colors: body, belly, fins, accent. Authored material regions stay
# intact, so a clownfish keeps its stripes and a koi keeps its patches.
PALETTES = {
    "anglerfish": ("A48AF3", "F4E6FF", "70DDE3", "FFE17D"),
    "armoredcatfish": ("7D9BF5", "E6F9FF", "9AE3D6", "FFF0B7"),
    "betta": ("6A86F4", "DEF8FF", "FF8AB9", "79E8EA"),
    "blacklionfish": ("7684E5", "F7F1FF", "A7A0F5", "FFE59B"),
    "blobfish": ("FF9DAF", "FFE9DB", "F69AC2", "FF7394"),
    "bluegoldfish": ("64A3FF", "D7F8FF", "A89AF5", "FFE48C"),
    "bluetang": ("408CF5", "CFF8FF", "FFE367", "83E4ED"),
    "butterflyfish": ("FFDD68", "FFF7DC", "FFBF8C", "F89B7D"),
    "cardinalfish": ("FF927C", "FFF2DA", "FFBD8C", "8EDFE7"),
    "clownfish": ("FF943D", "FFF6DC", "FFA381", "FFCF70"),
    "coralgrouper": ("F78D94", "FFEBD6", "FFBE85", "FFE196"),
    "cowfish": ("FFE36E", "FFF7D9", "FFBC83", "F6A654"),
    "flatfish": ("B69AF1", "FFF0FA", "9ACBF2", "FFE4B9"),
    "flowerhorn": ("F781B7", "FFE3EA", "B2A2F2", "FFF0AC"),
    "goblinshark": ("7AB8ED", "E4F9FF", "7C96DF", "94E6E2"),
    "goldfish": ("FFB04D", "FFF2C9", "FF9980", "FFE17B"),
    "humphead": ("63D8B3", "EEFFCE", "8BCDDC", "FFE58C"),
    "koi": ("FF9679", "FFF6E5", "FFC894", "FFD080"),
    "lionfish": ("FF9C79", "FFF3DD", "C1B0F5", "FFD38C"),
    "mandarinfish": ("FFB457", "FFF4D7", "83DEE7", "A095F3"),
    "moorishidol": ("FFE37C", "FFF8DF", "B7ABF1", "FFBD8C"),
    "parrotfish": ("42DDC3", "DEFFE9", "AF9CF4", "F98FB8"),
    "piranha": ("9499EF", "FFC1AE", "FFE18D", "F8A8BA"),
    "puffer": ("FFDD62", "FFF5D4", "FFBD92", "F6AD50"),
    "redsnapper": ("FF8D99", "FFECD3", "FFBC8D", "9BE5DA"),
    "royalgramma": ("BE8DF4", "FFF0CE", "FFDB75", "FFB1CD"),
    "shark": ("43C1EB", "ECFAFF", "759BED", "99E3EF"),
    "sunfish": ("FFD68C", "FFF3DB", "F7BDA4", "E0AFE5"),
    "swordfish": ("7BB7F1", "ECFAFF", "8E9FE5", "9AE6DA"),
    "tang": ("6794EF", "E7F8FF", "FFE17B", "FFC198"),
    "tetra": ("65DCEB", "E4FFFA", "C1AFF9", "FF9AB1"),
    "tuna": ("77BDEB", "ECFAFF", "FFE07D", "A3E5D5"),
    "turbot": ("83DCC9", "EEFFDE", "B1BDF1", "FFE2AD"),
    "yellowtang": ("FFE46B", "FFF9DF", "FFBE8C", "FFCA7B"),
    "zebraclownfish": ("9A94E8", "FFF7E6", "C3BCF7", "FFBDCB"),
    "fish1": ("FF9B51", "DFFFE6", "FFE077", "FFB3BA"),
    "fish2": ("43BCEE", "D6FFFA", "FFE985", "FFAFCA"),
    "fish3": ("FF943D", "FFF6DC", "FFA381", "FFCF70"),
    "dolphin": ("61D5E8", "ECFFFF", "93BBF5", "FFC1CC"),
    "mantaray": ("94ACF5", "ECFCFF", "BCB4F5", "C0EFE8"),
    "whale": ("AD91F6", "FFF2CD", "ABBFFB", "FFCFAB"),
}
SPOTTED = {"puffer", "cowfish", "coralgrouper", "flowerhorn", "flatfish", "turbot", "armoredcatfish", "whale"}
NO_CHEEK = {"shark", "goblinshark", "swordfish", "tuna", "anglerfish", "piranha", "mantaray", "whale"}
LIGHT_ACCENTS = {"parrotfish": "FA94BE", "mandarinfish": "86E5D8", "royalgramma": "FFE27D", "tetra": "FFA2B2", "tang": "FFE17B"}


def species_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.casefold())


def linear(hex_color: str) -> tuple[float, float, float, float]:
    channels = [int(hex_color[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in channels) + (1.0,)


def annotate(manifest_path: Path) -> None:
    data = json.loads(manifest_path.read_text())
    key = species_key(Path(data["source"]["file"]).stem)
    palette = PALETTES[key]
    data["skin"] = {
        "id": STYLE_ID, "name": "Candy Reef Kids", "stableUV": UV_NAME,
        "palette": dict(zip(("body", "belly", "fins", "accent"), palette)),
        "patterns": ["soft-belly-gradient", "two-tone-fins"] + (["large-spots"] if key in SPOTTED else []),
        "eyes": "blue-iris-white-glints", "sourceGeometry": "preserved",
    }
    manifest_path.write_text(json.dumps(data, indent=2) + "\n")


def install(core, source_name: str) -> None:
    """Patch one in-memory render process; no Blender dependency for CLI imports."""
    import bpy
    key = species_key(source_name)
    palette = PALETTES[key]
    body, belly, fins, accent = [linear(value) for value in palette]
    ink = linear("304C7A")
    old_ensure = core.ensure_materials

    def make_shader(material, eye_rect=None):
        nodes = material.node_tree.nodes
        links = material.node_tree.links
        nodes.clear()
        output = nodes.new("ShaderNodeOutputMaterial")
        uv = nodes.new("ShaderNodeUVMap")
        uv.uv_map = UV_NAME
        axes = nodes.new("ShaderNodeSeparateXYZ")
        links.new(uv.outputs["UV"], axes.inputs[0])

        def calc(operation, first, second=None):
            node = nodes.new("ShaderNodeMath")
            node.operation = operation
            for i, value in enumerate((first, second)):
                if value is None:
                    continue
                if isinstance(value, (int, float)):
                    node.inputs[i].default_value = value
                else:
                    links.new(value, node.inputs[i])
            return node.outputs[0]

        def mix(factor, a, b):
            node = nodes.new("ShaderNodeMixRGB")
            if isinstance(factor, (int, float)):
                node.inputs[0].default_value = factor
            else:
                links.new(factor, node.inputs[0])
            for i, value in ((1, a), (2, b)):
                if isinstance(value, tuple):
                    node.inputs[i].default_value = value
                else:
                    links.new(value, node.inputs[i])
            return node.outputs[0]

        def ramp(value, stops):
            node = nodes.new("ShaderNodeValToRGB")
            node.color_ramp.interpolation = "EASE"
            for element in list(node.color_ramp.elements)[2:]:
                node.color_ramp.elements.remove(element)
            for index, (position, color) in enumerate(stops):
                e = node.color_ramp.elements[index] if index < 2 else node.color_ramp.elements.new(position)
                e.position, e.color = position, color
            links.new(value, node.inputs[0])
            return node.outputs["Color"]

        def ellipse_distance(cx, cy, rx, ry):
            x = calc("DIVIDE", calc("SUBTRACT", axes.outputs["X"], cx), rx)
            y = calc("DIVIDE", calc("SUBTRACT", axes.outputs["Y"], cy), ry)
            return calc("ADD", calc("MULTIPLY", x, x), calc("MULTIPLY", y, y))

        def ellipse(cx, cy, rx, ry):
            return calc("SUBTRACT", 1, calc("SMOOTH_MIN", ellipse_distance(cx, cy, rx, ry), 1.0))

        def disk(cx, cy, rx, ry):
            return calc("LESS_THAN", ellipse_distance(cx, cy, rx, ry), 1.0)

        # Eyes are painted in their own projected rest-space, including explicit
        # white highlights. They remain bright in Eevee without reflection probes.
        if eye_rect:
            x, y, w, h = eye_rect
            cx, cy = x + w / 2, y + h / 2
            rx, ry = max(w / 2, 0.001), max(h / 2, 0.001)
            pupil = disk(cx - rx * .06, cy - ry * .025, rx * .68, ry * .68)
            iris = mix(pupil, linear("45B8D7"), linear("193B58"))
            eye_color = mix(disk(cx, cy, rx * .95, ry * .95), linear("E7FBFF"), iris)
            for gx, gy, gr in ((-.26, .30, .21), (.27, -.23, .105)):
                shine = disk(cx + rx * gx, cy + ry * gy, rx * gr, ry * gr)
                eye_color = mix(shine, eye_color, (1.0, 1.0, 1.0, 1.0))
            emission = nodes.new("ShaderNodeEmission")
            links.new(eye_color, emission.inputs["Color"])
            links.new(emission.outputs[0], output.inputs["Surface"])
            material.diffuse_color = linear("4EACD5")
            return

        name = material.name.casefold()
        if any(token in name for token in ("teeth", "tooth")):
            color = linear("FFF8E5")
        elif name == "light":
            color = linear("D6FFF3")
        elif name.endswith(("_dark", "_black")) or name in {"dark", "black", "outline"}:
            # Indigo-to-accent fins instead of large lifeless black patches.
            tint = tuple(fins[i] * .62 + ink[i] * .38 for i in range(4))
            color = ramp(axes.outputs["Y"], [(0.0, fins), (.45, tint), (1.0, fins)])
        elif "light" in name or "stripe" in name or "bottom" in name:
            color = linear(LIGHT_ACCENTS[key]) if key in LIGHT_ACCENTS and "light2" not in name else belly
        elif "fin" in name or "details" in name:
            color = ramp(axes.outputs["Y"], [(0.0, accent), (.5, fins), (1.0, belly)])
        elif key == "blacklionfish" and name.endswith("_main"):
            # Its very tall rays put the whole torso below the global belly
            # gradient. Keep the lavender body distinct from authored cream bands.
            color = body
        else:
            color = ramp(axes.outputs["Y"], [(0.0, belly), (.30, belly), (.60, body), (1.0, body)])
            if key in SPOTTED:
                mask = 0
                for cx, cy, rx, ry in ((.40, .67, .035, .045), (.53, .73, .045, .052), (.65, .62, .035, .044), (.73, .75, .03, .038), (.51, .53, .027, .034)):
                    spot = ellipse(cx, cy, rx, ry)
                    mask = calc("MAXIMUM", mask, calc("MULTIPLY", spot, 3.0))
                color = mix(mask, color, accent)
            if key not in NO_CHEEK:
                cheek = calc("MULTIPLY", ellipse(.22, .45, .055, .058), .27)
                color = mix(cheek, color, linear("FFACB7"))

        geometry = nodes.new("ShaderNodeNewGeometry")
        lighting = nodes.new("ShaderNodeVectorMath")
        lighting.operation = "DOT_PRODUCT"
        lighting.inputs[1].default_value = (.56, -.32, .77)
        links.new(geometry.outputs["Normal"], lighting.inputs[0])
        shade = ramp(lighting.outputs["Value"], [(0.0, (.69, .79, .92, 1)), (.28, (.88, .92, .99, 1)), (.78, (1, 1, 1, 1))])
        tinted = nodes.new("ShaderNodeMixRGB")
        tinted.blend_type = "MULTIPLY"
        tinted.inputs[0].default_value = 1.0
        if isinstance(color, tuple):
            tinted.inputs[1].default_value = color
            material.diffuse_color = color
        else:
            links.new(color, tinted.inputs[1])
            material.diffuse_color = body
        links.new(shade, tinted.inputs[2])
        emission = nodes.new("ShaderNodeEmission")
        links.new(tinted.outputs[0], emission.inputs["Color"])
        toy = nodes.new("ShaderNodeBsdfPrincipled")
        links.new(tinted.outputs[0], toy.inputs["Base Color"])
        toy.inputs["Roughness"].default_value = .30
        toy.inputs["Specular IOR Level"].default_value = .34
        toy.inputs["Coat Weight"].default_value = .24
        toy.inputs["Coat Roughness"].default_value = .26
        finish = nodes.new("ShaderNodeMixShader")
        finish.inputs[0].default_value = .16
        links.new(emission.outputs[0], finish.inputs[1])
        links.new(toy.outputs[0], finish.inputs[2])
        links.new(finish.outputs[0], output.inputs["Surface"])

    def ensure_materials(meshes, *args, **kwargs):
        old_ensure(meshes, *args, **kwargs)
        materials = {}
        for obj in meshes:
            mesh = obj.data
            # Project the undeformed source vertices once. A named UV layer is
            # carried by the armature/subdivision, so colors never swim over skin.
            points = [obj.matrix_world @ v.co for v in mesh.vertices]
            if not points:
                continue
            lo_y, hi_y = min(p.y for p in points), max(p.y for p in points)
            lo_z, hi_z = min(p.z for p in points), max(p.z for p in points)
            length, height = max(hi_y - lo_y, .001), max(hi_z - lo_z, .001)
            uv = mesh.uv_layers.get(UV_NAME) or mesh.uv_layers.new(name=UV_NAME)
            values = [((p.y - lo_y) / length, (p.z - lo_z) / height) for p in points]
            for loop in mesh.loops:
                uv.data[loop.index].uv = values[loop.vertex_index]
            for index, material in enumerate(mesh.materials):
                if not material:
                    continue
                rect = None
                if "eye" in material.name.casefold():
                    verts = {v for polygon in mesh.polygons if polygon.material_index == index for v in polygon.vertices}
                    if verts:
                        us, vs = zip(*(values[v] for v in verts))
                        rect = min(us), min(vs), max(us) - min(us), max(vs) - min(vs)
                materials[material] = rect
        for material, rect in materials.items():
            make_shader(material, rect)
        core.log(f"Applied {STYLE_ID}: rest UVs, candy palettes, belly gradients and sparkling eyes")

    core.ensure_materials = ensure_materials
