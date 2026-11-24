"""Animation-stable cat-inspired toon colors in temporary fish render scenes."""
from __future__ import annotations

import json
import re
from pathlib import Path

from .cat_toon_palette import INK_HEX, LIGHT_ACCENTS, PALETTES, SOURCE_REFERENCE, STYLE_ID

UV_NAME = "KidSkinRestUV"

# Display sRGB colors: body, belly, fins, accent. Authored material regions stay
# intact, so a clownfish keeps its stripes and a koi keeps its patches.
SPOTTED = {"puffer", "cowfish", "coralgrouper", "flowerhorn", "flatfish", "turbot", "armoredcatfish", "whale"}
NO_CHEEK = {"shark", "goblinshark", "swordfish", "tuna", "anglerfish", "piranha", "mantaray", "whale"}


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
        "id": STYLE_ID, "name": "Cat-inspired Toon", "stableUV": UV_NAME,
        "palette": dict(zip(("body", "belly", "fins", "accent"), palette)),
        "patterns": ["small-cream-belly", "flat-fin-accents"] + (["large-spots"] if key in SPOTTED else []),
        "eyes": "warm-dark-pupil-white-glints", "surface": "matte-three-tone",
        "reference": {"folder": SOURCE_REFERENCE, "use": "palette-and-shading", "artworkCopied": False},
        "sourceGeometry": "preserved",
    }
    manifest_path.write_text(json.dumps(data, indent=2) + "\n")


def install(core, source_name: str) -> None:
    """Patch one in-memory render process; no Blender dependency for CLI imports."""
    import bpy
    key = species_key(source_name)
    palette = PALETTES[key]
    body, belly, fins, accent = [linear(value) for value in palette]
    ink = linear(INK_HEX)
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
            pupil = disk(cx - rx * .06, cy - ry * .025, rx * .70, ry * .70)
            iris = mix(pupil, linear("98604B"), ink)
            eye_color = mix(disk(cx, cy, rx * .87, ry * .87), linear("FFF3DB"), iris)
            for gx, gy, gr in ((-.26, .30, .21), (.27, -.23, .105)):
                shine = disk(cx + rx * gx, cy + ry * gy, rx * gr, ry * gr)
                eye_color = mix(shine, eye_color, (1.0, 1.0, 1.0, 1.0))
            emission = nodes.new("ShaderNodeEmission")
            links.new(eye_color, emission.inputs["Color"])
            links.new(emission.outputs[0], output.inputs["Surface"])
            material.diffuse_color = ink
            return

        name = material.name.casefold()
        if any(token in name for token in ("teeth", "tooth")):
            color = linear("FFF8E5")
        elif name == "light":
            color = linear("D6FFF3")
        elif name.endswith(("_dark", "_black")) or name in {"dark", "black", "outline"}:
            # Indigo-to-accent fins instead of large lifeless black patches.
            tint = tuple(fins[i] * .70 + ink[i] * .30 for i in range(4))
            color = ramp(axes.outputs["Y"], [(0.0, fins), (.45, tint), (1.0, fins)])
        elif "light" in name or "stripe" in name or "bottom" in name:
            color = linear(LIGHT_ACCENTS[key]) if key in LIGHT_ACCENTS and "light2" not in name else belly
        elif "fin" in name or "details" in name:
            color = ramp(axes.outputs["Y"], [(0.0, accent), (.35, fins), (1.0, fins)])
        elif key == "blacklionfish" and name.endswith("_main"):
            # Its very tall rays put the whole torso below the global belly
            # gradient. Keep the lavender body distinct from authored cream bands.
            color = body
        else:
            color = ramp(axes.outputs["Y"], [(0.0, belly), (.16, belly), (.25, body), (1.0, body)])
            if key in SPOTTED:
                mask = 0
                for cx, cy, rx, ry in ((.40, .67, .035, .045), (.53, .73, .045, .052), (.65, .62, .035, .044), (.73, .75, .03, .038), (.51, .53, .027, .034)):
                    spot = disk(cx, cy, rx, ry)
                    mask = calc("MAXIMUM", mask, spot)
                color = mix(mask, color, accent)
            if key not in NO_CHEEK:
                cheek = calc("MULTIPLY", ellipse(.22, .45, .055, .058), .10)
                color = mix(cheek, color, accent)

        geometry = nodes.new("ShaderNodeNewGeometry")
        lighting = nodes.new("ShaderNodeVectorMath")
        lighting.operation = "DOT_PRODUCT"
        lighting.inputs[1].default_value = (.56, -.32, .77)
        links.new(geometry.outputs["Normal"], lighting.inputs[0])
        shade = ramp(lighting.outputs["Value"], [(0.0, (.56, .44, .42, 1)), (.20, (.80, .71, .65, 1)), (.53, (1, 1, 1, 1))])
        shade.node.color_ramp.interpolation = "CONSTANT"
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
        toy.inputs["Roughness"].default_value = .72
        toy.inputs["Specular IOR Level"].default_value = .16
        toy.inputs["Coat Weight"].default_value = 0.0
        toy.inputs["Coat Roughness"].default_value = .26
        finish = nodes.new("ShaderNodeMixShader")
        finish.inputs[0].default_value = .025
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
        core.log(f"Applied {STYLE_ID}: rest UVs, warm ink and matte cel colors")

    core.ensure_materials = ensure_materials

    old_configure = core.configure_scene
    def configure_scene(*args, **kwargs):
        result = old_configure(*args, **kwargs)
        features = [obj for obj in bpy.context.scene.objects if obj.get("generated_face_feature")]
        face_collection = None
        if features:
            # These small eyes and smiles already contain their own painted ink.
            # A second silhouette stroke would cover their whites and highlights.
            face_collection = bpy.data.collections.new("Painted Fish Face Details")
            bpy.context.scene.collection.children.link(face_collection)
            for obj in features:
                face_collection.objects.link(obj)
        for lineset in bpy.context.view_layer.freestyle_settings.linesets:
            lineset.linestyle.color = ink[:3]
            lineset.linestyle.alpha = 1.0
            lineset.linestyle.thickness = max(1.0, bpy.context.scene.render.resolution_x / 128)
            if face_collection:
                lineset.select_by_collection = True
                lineset.collection = face_collection
                lineset.collection_negation = "EXCLUSIVE"
        return result
    core.configure_scene = configure_scene

    old_face = core.add_fish_face
    def add_fish_face(*args, **kwargs):
        result = old_face(*args, **kwargs)
        for material in bpy.data.materials:
            if not material.use_nodes:
                continue
            color = {"Face Ink": ink, "Eye Ocean Iris": linear("98604B"), "Eye White": linear("FFF3DB")}.get(material.name)
            if color:
                material.diffuse_color = color
                for node in material.node_tree.nodes:
                    if node.type == "EMISSION":
                        node.inputs["Color"].default_value = color
            if "Shark Mouth and Teeth" in material.name:
                for node in material.node_tree.nodes:
                    if node.type == "MIX_RGB":
                        node.inputs[1].default_value = ink
                        node.inputs[2].default_value = linear("FFF3DB")
        return result
    core.add_fish_face = add_fish_face
