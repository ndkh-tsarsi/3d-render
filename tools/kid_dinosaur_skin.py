"""Cat-inspired dinosaur materials, rounded silhouettes and rig-bound eyes.

Installed only in a disposable Blender render process; source files stay intact.
"""
from __future__ import annotations

import json
from pathlib import Path

from .cat_toon_palette import INK_HEX, SOURCE_REFERENCE
from .kid_fish_skin import linear

STYLE_ID = "cat-toon-dinosaur-v1"
GEOMETRY_ID = "kid-rounded-dinosaur-v1"
UV_NAME = "KidDinosaurRestUV"
PALETTES = {
    "apatosaurus": ("00A99D", "FBE7C4", "5CC8C0"),
    "parasaurolophus": ("29ABE2", "FBE7C4", "FF7BAC"),
    "stegosaurus": ("93278F", "FBE7C4", "F18854"),
    "trex": ("F18854", "FBE7C4", "FBB03B"),
    "triceratops": ("56A5FF", "FBE7C4", "F1BF8C"),
    "velociraptor": ("FFE356", "FBE7C4", "F7931E"),
}
REGIONS = {
    "apatosaurus": {"Brown": "body", "Material": "belly"},
    "parasaurolophus": {"Green": "body", "LightGreen": "body", "LightYellow": "belly", "Red": "accent"},
    "stegosaurus": {"DarkBrown": "body", "LightBrown": "belly", "Brown": "accent"},
    "trex": {"Green": "body", "LightGreen": "belly", "Black": "claws", "Red": "mouth", "LightYellow": "teeth"},
    "triceratops": {"Purple": "body", "LightBrown": "belly", "Brown": "horns"},
    "velociraptor": {"Brown": "body", "LightBrown": "belly", "Black": "claws"},
}
_REPORT: list[dict] = []


def annotate(path: Path) -> None:
    data = json.loads(path.read_text())
    key = Path(data["source"]["file"]).stem.casefold()
    data["skin"] = {"id": STYLE_ID, "name": "Cat-inspired Toon",
        "palette": dict(zip(("body", "belly", "accent"), PALETTES[key])),
        "ink": INK_HEX, "surface": "matte-three-tone", "stableUV": UV_NAME,
        "patterns": ["authored-material-regions", "cream-belly"],
        "eyes": "rig-bound-warm-white-chocolate-pupils-white-glints",
        "reference": {"folder": SOURCE_REFERENCE, "use": "palette-and-shading", "artworkCopied": False},
        "sourceFilesUnchanged": True}
    data["geometry"] = {"id": GEOMETRY_ID, "name": "Soft rounded cartoon dinosaur",
        "method": "catmull-clark-with-selective-feature-creases", "nativeRigPreserved": True,
        "sourceFilesUnchanged": True, "restUVPreserved": True, "meshes": _REPORT}
    data["source"]["licenseFile"] = "../licenses/dinosaur-animated-pack-dec-2018.txt"
    path.write_text(json.dumps(data, indent=2) + "\n")


def install(core, source_name: str) -> None:
    import bpy
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    from mathutils.kdtree import KDTree

    key = source_name.casefold()
    body_hex, belly_hex, accent_hex = PALETTES[key]
    ink = linear(INK_HEX)
    colors = {"body": linear(body_hex), "belly": linear(belly_hex),
        "accent": linear(accent_hex), "horns": linear("FFE6AF"),
        "claws": ink, "mouth": linear("B74F62"), "teeth": linear("FFF8E5")}

    def material_shader(material, color):
        material.use_nodes = True
        material.diffuse_color = color
        nodes = material.node_tree.nodes; links = material.node_tree.links; nodes.clear()
        output = nodes.new("ShaderNodeOutputMaterial")
        geometry = nodes.new("ShaderNodeNewGeometry")
        light = nodes.new("ShaderNodeVectorMath"); light.operation = "DOT_PRODUCT"
        light.inputs[1].default_value = (.56, -.32, .77)
        links.new(geometry.outputs["Normal"], light.inputs[0])
        shade = nodes.new("ShaderNodeValToRGB"); shade.color_ramp.interpolation = "CONSTANT"
        for index, (position, tint) in enumerate(((0, (.62,.52,.47,1)), (.20,(.84,.76,.69,1)), (.53,(1,1,1,1)))):
            e = shade.color_ramp.elements[index] if index < 2 else shade.color_ramp.elements.new(position)
            e.position = position; e.color = tint
        links.new(light.outputs["Value"], shade.inputs[0])
        multiply = nodes.new("ShaderNodeMixRGB"); multiply.blend_type = "MULTIPLY"
        multiply.inputs[0].default_value = 1; multiply.inputs[1].default_value = color
        links.new(shade.outputs[0], multiply.inputs[2])
        emission = nodes.new("ShaderNodeEmission")
        links.new(multiply.outputs[0], emission.inputs["Color"])
        links.new(emission.outputs[0], output.inputs["Surface"])

    def ensure_materials(meshes, *args, **kwargs):
        _REPORT.clear()
        for obj in meshes:
            mesh = obj.data
            points = [obj.matrix_world @ v.co for v in mesh.vertices]
            if not points: continue
            # The inspected dinos all use longitudinal Y and vertical Z. Keep
            # authored belly/plate/horn regions rather than a fish belly band.
            lo_y,hi_y = min(p.y for p in points),max(p.y for p in points)
            lo_z,hi_z = min(p.z for p in points),max(p.z for p in points)
            uv = mesh.uv_layers.get(UV_NAME) or mesh.uv_layers.new(name=UV_NAME)
            for loop in mesh.loops:
                p = points[loop.vertex_index]
                uv.data[loop.index].uv = ((p.y-lo_y)/max(hi_y-lo_y,.001),(p.z-lo_z)/max(hi_z-lo_z,.001))
            roles = []
            for material in mesh.materials:
                role = REGIONS[key].get(material.name, "body")
                roles.append(role); material_shader(material, colors[role])
            for polygon in mesh.polygons: polygon.use_smooth = True
            uses = [[] for _ in mesh.edges]
            for polygon in mesh.polygons:
                role = roles[polygon.material_index]
                for index in polygon.loop_indices: uses[mesh.loops[index].edge_index].append(role)
            crease = mesh.attributes.get("crease_edge") or mesh.attributes.new(name="crease_edge",type="FLOAT",domain="EDGE")
            protected = 0
            amounts = {"horns":.65,"claws":.55,"teeth":.65,"mouth":.15}
            if key in {"stegosaurus", "parasaurolophus"}: amounts["accent"] = .46
            for edge in mesh.edges:
                amount = max((amounts.get(role,0) for role in uses[edge.index]),default=0)
                if len(uses[edge.index]) == 1: amount = max(amount,.22)
                crease.data[edge.index].value = amount
                protected += int(amount > 0)
            surface = next((m for m in obj.modifiers if m.type=="SUBSURF"),None)
            if surface is None: surface = obj.modifiers.new("Rounded Kid Dinosaur", "SUBSURF")
            surface.subdivision_type = "CATMULL_CLARK"; surface.levels = surface.render_levels = 2
            surface.quality = 3; surface.show_render = surface.show_viewport = True
            surface.boundary_smooth = "ALL"; surface.uv_smooth = "PRESERVE_BOUNDARIES"
            _REPORT.append({"object":obj.name,"sourceVertices":len(mesh.vertices),"sourceFaces":len(mesh.polygons),
                "subdivisionLevels":2,"protectedFeatureEdges":protected,"regions":dict(zip((m.name for m in mesh.materials),roles))})
        core.log(f"Applied {STYLE_ID}: authored regions, cream belly, warm ink, rounded feature-preserving surface")
    core.ensure_materials = ensure_materials

    def add_dinosaur_face(meshes, armature, style="cartoon"):
        if armature is None or "Head" not in armature.data.bones:
            raise RuntimeError("Dinosaur requires its native Head bone")
        source = max(meshes,key=lambda o:len(o.data.vertices))
        vertices = [source.matrix_world @ v.co for v in source.data.vertices]
        nearest = KDTree(len(vertices))
        for index,p in enumerate(vertices): nearest.insert(p,index)
        nearest.balance()
        previous = armature.data.pose_position; armature.data.pose_position = "REST"
        bpy.context.view_layer.update()
        evaluated = source.evaluated_get(bpy.context.evaluated_depsgraph_get()); smooth = evaluated.to_mesh()
        try:
            smooth.calc_loop_triangles()
            surface = BVHTree.FromPolygons([evaluated.matrix_world @ v.co for v in smooth.vertices],
                [tuple(f.vertices) for f in smooth.loop_triangles],all_triangles=True)
        finally: evaluated.to_mesh_clear()
        armature.data.pose_position = previous; bpy.context.view_layer.update()
        bone = armature.data.bones["Head"]
        head = armature.matrix_world @ bone.head_local; nose = armature.matrix_world @ bone.tail_local
        forward = 1 if nose.y > head.y else -1
        length = max(p.y for p in vertices)-min(p.y for p in vertices)
        head_length = abs(nose.y-head.y)
        group = source.vertex_groups.get("Head")
        head_points = [p for p,v in zip(vertices,source.data.vertices)
            if any(g.group==group.index and g.weight>.4 for g in v.groups)]
        head_height = max(p.z for p in head_points)-min(p.z for p in head_points)
        radius = min(length*.032,head_length*.25,head_height*.24)
        eye_y = head.y+forward*head_length*.30
        eye_z = head.z+(nose.z-head.z)*.30+head_length*.10
        extent = max(abs(p.x) for p in vertices)+length
        features=[]

        def flat(name,color):
            m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=color
            n=m.node_tree.nodes;n.clear();o=n.new("ShaderNodeOutputMaterial");e=n.new("ShaderNodeEmission")
            e.inputs["Color"].default_value=color;m.node_tree.links.new(e.outputs[0],o.inputs["Surface"])
            return m
        dark=flat("Dinosaur Face Ink",ink);white=flat("Dinosaur Eye White",linear("FFF3DB"))
        iris=flat("Dinosaur Warm Iris",linear("98604B"));glint=flat("Dinosaur Eye Glint",(1,1,1,1))

        def attach(obj):
            groups={}
            for v in obj.data.vertices:
                _,index,_=nearest.find(obj.matrix_world @ v.co)
                for assignment in source.data.vertices[index].groups:
                    name=source.vertex_groups[assignment.group].name
                    if name not in armature.data.bones: continue
                    if name not in groups: groups[name]=obj.vertex_groups.new(name=name)
                    groups[name].add([v.index],assignment.weight,"REPLACE")
            modifier=obj.modifiers.new("Follow Native Dinosaur Head Skin","ARMATURE");modifier.object=armature
            obj["generated_face_feature"]=True;features.append(obj)

        def hit(side,y,z):
            p,*_=surface.ray_cast(Vector((side*extent,y,z)),Vector((-side,0,0)),extent*3)
            return p.x if p is not None else None

        def sphere(name,center,scale,material):
            bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,radius=1,location=(0,0,0))
            obj=bpy.context.object;obj.name=name
            for v in obj.data.vertices: v.co=center+Vector(tuple(v.co[i]*scale[i] for i in range(3)))
            for f in obj.data.polygons: f.use_smooth=True
            obj.data.materials.append(material);attach(obj)

        for side,label in ((1,"Right"),(-1,"Left")):
            z=eye_z;center_hit=hit(side,eye_y,z)
            for amount in (.2,.4,.6,.8):
                if center_hit is not None: break
                z=eye_z-radius*amount;center_hit=hit(side,eye_y,z)
            if center_hit is None: raise RuntimeError(f"Cannot attach {label} dinosaur eye")
            samples=[center_hit]
            for dy,dz in ((-radius*.6,0),(radius*.6,0),(0,-radius*.6),(0,radius*.6)):
                value=hit(side,eye_y+dy,z+dz)
                if value is not None: samples.append(value)
            x=side*(max(side*v for v in samples)+radius*.08)
            center=Vector((x,eye_y,z))
            sphere(f"{label} Dinosaur Eye Ink",center,(radius*.25,radius,radius),dark)
            sphere(f"{label} Dinosaur Eye White",center+Vector((side*radius*.14,0,0)),(radius*.29,radius*.86,radius*.86),white)
            pupil=center+Vector((side*radius*.46,forward*radius*.15,radius*.025))
            sphere(f"{label} Dinosaur Iris",pupil,(radius*.12,radius*.60,radius*.60),iris)
            pupil.x+=side*radius*.08
            sphere(f"{label} Dinosaur Pupil",pupil,(radius*.12,radius*.44,radius*.44),dark)
            sphere(f"{label} Dinosaur Glint",pupil+Vector((side*radius*.12,forward*radius*.13,radius*.21)),(radius*.05,radius*.17,radius*.17),glint)
            sphere(f"{label} Dinosaur Soft Glint",pupil+Vector((side*radius*.13,-forward*radius*.18,-radius*.16)),(radius*.05,radius*.08,radius*.08),glint)
            if key=="trex": continue # Authored mouth and individual teeth remain intact.
            coordinates=[]
            for amount,dip in ((.98,0),(.80,.07),(.60,.09),(.45,.01)):
                y=head.y+forward*head_length*amount
                z=head.z+(nose.z-head.z)*amount-radius*(.60+dip)
                x=hit(side,y,z)
                if x is not None: coordinates.append(Vector((x+side*radius*.10,y,z)))
            if len(coordinates)<3: continue
            data=bpy.data.curves.new(f"{label} Dinosaur Smile",type="CURVE")
            data.dimensions="3D";data.resolution_u=12;data.bevel_depth=radius*.065;data.bevel_resolution=3
            spline=data.splines.new("BEZIER");spline.bezier_points.add(len(coordinates)-1)
            for p,co in zip(spline.bezier_points,coordinates): p.co=co;p.handle_left_type=p.handle_right_type="AUTO"
            obj=bpy.data.objects.new(data.name,data);bpy.context.scene.collection.objects.link(obj);data.materials.append(dark)
            bpy.ops.object.select_all(action="DESELECT");obj.select_set(True);bpy.context.view_layer.objects.active=obj
            bpy.ops.object.convert(target="MESH");attach(bpy.context.object)
        core.log(f"Added bilateral dinosaur eyes/glints and native-skin-bound face on {bone.name}")
        return features,{"headBone":bone.name,"attachment":"nearest-source-skin-weights","profiles":["+X","-X"],
            "expression":"friendly-kid","authoredTeethPreserved":key=="trex","eyeRadius":round(radius,6)}
    core.add_fish_face = add_dinosaur_face

    old_configure=core.configure_scene
    def configure_scene(*args,**kwargs):
        result=old_configure(*args,**kwargs)
        faces=[o for o in bpy.context.scene.objects if o.get("generated_face_feature")]
        collection=bpy.data.collections.new("Painted Dinosaur Face Details")
        bpy.context.scene.collection.children.link(collection)
        for obj in faces: collection.objects.link(obj)
        for lineset in bpy.context.view_layer.freestyle_settings.linesets:
            lineset.linestyle.color=ink[:3];lineset.linestyle.alpha=1
            lineset.linestyle.thickness=max(1.3,bpy.context.scene.render.resolution_x/180)
            lineset.select_by_collection=True;lineset.collection=collection;lineset.collection_negation="EXCLUSIVE"
        return result
    core.configure_scene=configure_scene
