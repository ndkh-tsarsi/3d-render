#!/usr/bin/env python3
"""Install validated local render batches into the existing preview without rendering."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pipeline import PipelineError, validate_output, write_catalog

PREVIEW_FILES = ("catalog.json", "index.html", "player.js", "aquarium.js", "fishing.js",
                 "fishing-audio.js", "scene-sizing.js", "style.css")


def hashes(folder: Path) -> dict[str, str]:
    return {p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in folder.rglob("*") if p.is_file()}


def merge(sources: list[Path], output: Path) -> None:
    if ROOT not in output.parents or output == ROOT / "raw" or ROOT / "raw" in output.parents:
        raise ValueError("Choose a generated preview folder inside this project")
    if any(part.startswith(".") for part in output.relative_to(ROOT).parts):
        raise ValueError("Do not use a hidden project directory as the preview")
    if output.parent == ROOT and output.name.startswith("dist-"):
        raise ValueError("Use dist/ or a folder beneath build/; root dist-* outputs are retired")
    validate_output(output)
    assets: dict[str, Path] = {}
    licenses: dict[Path, Path] = {}
    for source in sources:
        if source == output or source in output.parents or output in source.parents:
            raise ValueError("Render batches and preview must be separate folders")
        validate_output(source)
        catalog = json.loads((source / "catalog.json").read_text())
        for asset in catalog["assets"]:
            aid = asset["id"]
            if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", aid) or asset["manifest"] != f"{aid}/manifest.json":
                raise ValueError(f"Invalid generated asset path: {aid}")
            folder = source / aid
            if folder.is_symlink() or any(p.is_symlink() or p.name == ".git" for p in folder.rglob("*")):
                raise ValueError(f"Asset folders must contain regular generated files: {aid}")
            manifest = json.loads((folder / "manifest.json").read_text())
            if (manifest["id"] != aid or manifest.get("sampling") == "probe"
                    or manifest.get("skin", {}).get("maxFrames", 0)):
                raise ValueError(f"Only complete renders can update the preview: {aid}")
            if aid in assets:
                raise ValueError(f"Duplicate asset across render batches: {aid}")
            assets[aid] = folder
            license_name = manifest.get("source", {}).get("licenseFile")
            if license_name:
                path = (folder / license_name).resolve()
                if not path.is_file() or path.parent != source / "licenses" or path.is_symlink():
                    raise ValueError(f"Missing generated license: {aid}")
                relative = Path("licenses") / path.name
                previous = licenses.get(relative)
                if previous and previous.read_bytes() != path.read_bytes():
                    raise ValueError(f"Conflicting licenses in render batches: {relative}")
                licenses[relative] = path
    if not assets:
        raise ValueError("No assets to install")
    work = ROOT / "build/work"
    work.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=".local-assets-", dir=work))
    promoted: list[str] = []
    moved: list[str] = []
    cleanup = True
    old_files = {p: (output / p).read_bytes() if (output / p).is_file() else None
                 for p in [*map(Path, PREVIEW_FILES), *licenses]}
    try:
        for aid, folder in assets.items():
            shutil.copytree(folder, temporary / "next" / aid)
            if hashes(folder) != hashes(temporary / "next" / aid):
                raise RuntimeError(f"Copied render differs from its source: {aid}")
        (temporary / "previous").mkdir()
        try:
            for aid in assets:
                if (output / aid).exists():
                    (output / aid).rename(temporary / "previous" / aid)
                    moved.append(aid)
                (temporary / "next" / aid).rename(output / aid)
                promoted.append(aid)
            for relative, path in licenses.items():
                (output / relative).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, output / relative)
            write_catalog(output)
            validate_output(output)
            for aid, folder in assets.items():
                if hashes(folder) != hashes(output / aid):
                    raise RuntimeError(f"Installed render differs from its source: {aid}")
        except BaseException:
            cleanup = False
            for aid in reversed(promoted):
                shutil.rmtree(output / aid)
            for aid in moved:
                (temporary / "previous" / aid).rename(output / aid)
            for relative, data in old_files.items():
                if data is None:
                    (output / relative).unlink(missing_ok=True)
                else:
                    (output / relative).write_bytes(data)
            cleanup = True
            raise
    finally:
        if cleanup:
            shutil.rmtree(temporary)
        else:
            print(f"Recovery files retained at {temporary}", file=sys.stderr)
    print(f"Updated {len(assets)} local assets in {output}; preview refreshed, no rendering or publishing.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", action="append", required=True, help="Complete local render batch; repeatable")
    parser.add_argument("--output", default="dist")
    args = parser.parse_args()
    try:
        merge([(ROOT / path).resolve() for path in args.source], (ROOT / args.output).resolve())
    except (ValueError, OSError, PipelineError) as error:
        parser.exit(1, f"Local merge failed: {error}\n")


if __name__ == "__main__":
    main()
