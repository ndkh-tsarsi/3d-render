"""Round fish only in temporary render scenes, preserving source rigs and UVs."""
from __future__ import annotations

import json
import re
from pathlib import Path

GEOMETRY_ID = "kid-rounded-v1"
ORIGINAL_SPECIES = {"dolphin", "fish1", "fish2", "fish3", "mantaray", "shark", "whale"}
_REPORT: list[dict] = []


def annotate(manifest_path: Path) -> None:
    data = json.loads(manifest_path.read_text())
    data["geometry"] = {
        "id": GEOMETRY_ID,
        "name": "Soft rounded cartoon silhouette",
        "method": "catmull-clark-with-selective-boundary-creases",
        "sourceFilesUnchanged": True,
        "nativeRigPreserved": True,
        "restUVPreserved": True,
        "meshes": _REPORT,
    }
    if "skin" in data:
        data["skin"]["sourceGeometry"] = "rounded-for-render"
    manifest_path.write_text(json.dumps(data, indent=2) + "\n")


def install(core, source_name: str) -> None:
    """Install after kid_fish_skin.install, before core's animation-bound scan."""
    key = re.sub(r"[^a-z0-9]", "", source_name.casefold())
    old_ensure = core.ensure_materials

    def ensure_materials(meshes, asset_id, *args, **kwargs):
        old_ensure(meshes, asset_id, *args, **kwargs)
        _REPORT.clear()
        # Cute IDs are namespaced, so the two different Shark files are distinct.
        legacy = key in ORIGINAL_SPECIES and not asset_id.startswith("cute-")
        for obj in meshes:
            mesh = obj.data
            if not mesh.vertices or not mesh.polygons:
                continue
            for polygon in mesh.polygons:
                polygon.use_smooth = True

            surface = next((m for m in obj.modifiers if m.type == "SUBSURF"), None)
            if surface is None:
                surface = obj.modifiers.new("Rounded Kid Surface", "SUBSURF")
            surface.subdivision_type = "CATMULL_CLARK"
            surface.levels = 1 if legacy else 2
            surface.render_levels = surface.levels
            surface.quality = 3
            surface.show_viewport = True
            surface.show_render = True
            if hasattr(surface, "use_creases"):
                surface.use_creases = True

            protected_edges = 0
            fin_components = 0
            if not legacy:
                # Many authored fins are separate open, nearly planar islands.
                # A little crease retains their span without locking sharp corners.
                adjacency = [[] for _ in mesh.vertices]
                for edge in mesh.edges:
                    first, second = edge.vertices
                    adjacency[first].append(second)
                    adjacency[second].append(first)
                component = [-1] * len(mesh.vertices)
                islands: list[list[int]] = []
                for vertex in mesh.vertices:
                    if component[vertex.index] >= 0:
                        continue
                    island_id = len(islands)
                    stack = [vertex.index]
                    component[vertex.index] = island_id
                    vertices = []
                    while stack:
                        index = stack.pop()
                        vertices.append(index)
                        for neighbor in adjacency[index]:
                            if component[neighbor] < 0:
                                component[neighbor] = island_id
                                stack.append(neighbor)
                    islands.append(vertices)
                island_materials = [set() for _ in islands]
                edge_uses = [0] * len(mesh.edges)
                for polygon in mesh.polygons:
                    island_materials[component[polygon.vertices[0]]].add(polygon.material_index)
                    for loop_index in polygon.loop_indices:
                        edge_uses[mesh.loops[loop_index].edge_index] += 1
                weights = []
                for indices, material_ids in zip(islands, island_materials):
                    has_eye = any(index < len(mesh.materials) and mesh.materials[index]
                                  and "eye" in mesh.materials[index].name.casefold()
                                  for index in material_ids)
                    if has_eye:
                        weights.append(0.0)
                        continue
                    points = [mesh.vertices[index].co for index in indices]
                    extents = [max(p[axis] for p in points) - min(p[axis] for p in points)
                               for axis in range(3)]
                    largest = max(extents)
                    smallest = min(extents)
                    is_fin = len(indices) < 110
                    if is_fin:
                        fin_components += 1
                        # Long lionfish rays keep their length; their cross-section
                        # and tips are still rounded by the subdivision surface.
                        slender = largest > max(smallest, .01) * 8 and smallest > .001
                        weights.append(.58 if slender else .38)
                    else:
                        # Open mouth/gill roots retain enough shape to stay legible.
                        weights.append(.22)
                crease = mesh.attributes.get("crease_edge")
                if crease is None:
                    crease = mesh.attributes.new(name="crease_edge", type="FLOAT", domain="EDGE")
                for edge in mesh.edges:
                    amount = weights[component[edge.vertices[0]]] if edge_uses[edge.index] == 1 else 0.0
                    crease.data[edge.index].value = amount
                    protected_edges += int(amount > 0)
                surface.boundary_smooth = "ALL"
                surface.uv_smooth = "PRESERVE_BOUNDARIES"
            else:
                # Legacy faces are generated against the original rest cage. Its
                # approved level-one surface keeps those eyes and smiles attached.
                surface.boundary_smooth = "PRESERVE_CORNERS"

            _REPORT.append({
                "object": obj.name, "sourceVertices": len(mesh.vertices),
                "sourceFaces": len(mesh.polygons), "subdivisionLevels": surface.render_levels,
                "existingRoundedLegacySurface": legacy,
                "protectedBoundaryEdges": protected_edges,
                "protectedFinComponents": fin_components,
            })
        core.log(f"Applied {GEOMETRY_ID}: rounded silhouettes, protected fin spans, smooth normals")

    core.ensure_materials = ensure_materials
