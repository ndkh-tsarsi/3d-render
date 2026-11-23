#!/usr/bin/env python3
"""Zero-dependency launcher for the Blender-to-HTML5 sprite pipeline."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import shutil
import struct
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parent
TOOLS_DIR = ROOT / ".tools"
BLENDER_PATH_FILE = ROOT / ".blender-path"
DEFAULT_BLENDER_VERSION = "5.3.0"
OFFICIAL_RELEASE_ROOT = "https://download.blender.org/release"


class PipelineError(RuntimeError):
    pass


def info(message: str) -> None:
    print(f"[sprite-pipeline] {message}", flush=True)


def executable_works(path: Path) -> bool:
    if not path.is_file():
        return False
    try:
        result = subprocess.run(
            [str(path), "--version"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=20,
            check=False,
        )
        return result.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def blender_candidates() -> list[Path]:
    candidates: list[Path] = []
    env_path = os.environ.get("BLENDER_BIN")
    if env_path:
        candidates.append(Path(env_path).expanduser())
    if BLENDER_PATH_FILE.is_file():
        saved = BLENDER_PATH_FILE.read_text(encoding="utf-8").strip()
        if saved:
            candidates.append(Path(saved))
    on_path = shutil.which("blender")
    if on_path:
        candidates.append(Path(on_path))

    system = platform.system()
    if system == "Darwin":
        candidates.extend(
            [
                Path("/Applications/Blender.app/Contents/MacOS/Blender"),
                TOOLS_DIR / "Blender.app/Contents/MacOS/Blender",
            ]
        )
    elif system == "Windows":
        candidates.extend(
            [
                TOOLS_DIR / "blender/blender.exe",
                Path(os.environ.get("ProgramFiles", "C:/Program Files"))
                / "Blender Foundation/Blender/blender.exe",
            ]
        )
    else:
        candidates.append(TOOLS_DIR / "blender/blender")

    deduped: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate.resolve()) if candidate.exists() else str(candidate)
        if key not in seen:
            deduped.append(candidate)
            seen.add(key)
    return deduped


def find_blender() -> Path | None:
    for candidate in blender_candidates():
        if executable_works(candidate):
            return candidate.resolve()
    return None


def release_artifact(version: str) -> tuple[str, str]:
    system = platform.system()
    machine = platform.machine().lower()
    prefix = f"blender-{version}"
    if system == "Darwin" and machine in {"arm64", "aarch64"}:
        return f"{prefix}-macos-arm64.dmg", "mac-dmg"
    if system == "Windows" and machine in {"arm64", "aarch64"}:
        return f"{prefix}-windows-arm64.zip", "zip"
    if system == "Windows" and machine in {"amd64", "x86_64"}:
        return f"{prefix}-windows-x64.zip", "zip"
    if system == "Linux" and machine in {"amd64", "x86_64"}:
        return f"{prefix}-linux-x64.tar.xz", "tar"
    raise PipelineError(
        f"No official project-local Blender package is configured for {system} {machine}. "
        "Install Blender manually, or set BLENDER_BIN to its executable."
    )


def download(url: str, destination: Path) -> None:
    info(f"Downloading {url}")

    def report(blocks: int, block_size: int, total: int) -> None:
        if total > 0 and blocks % 128 == 0:
            percent = min(100, blocks * block_size * 100 // total)
            print(f"\r[sprite-pipeline] Download {percent:3d}%", end="", flush=True)

    urllib.request.urlretrieve(url, destination, reporthook=report)
    print()


def expected_sha256(checksum_file: Path, artifact_name: str) -> str:
    for line in checksum_file.read_text(encoding="utf-8").splitlines():
        fields = line.strip().replace("*", " ").split()
        if len(fields) >= 2 and Path(fields[-1]).name == artifact_name:
            return fields[0].lower()
    raise PipelineError(f"Official checksum did not contain {artifact_name}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_extract_tar(archive: Path, destination: Path) -> None:
    root = destination.resolve()
    with tarfile.open(archive) as bundle:
        for member in bundle.getmembers():
            target = (destination / member.name).resolve()
            if root not in target.parents and target != root:
                raise PipelineError(f"Unsafe archive member: {member.name}")
        if sys.version_info >= (3, 12):
            bundle.extractall(destination, filter="data")
        else:
            bundle.extractall(destination)


def safe_extract_zip(archive: Path, destination: Path) -> None:
    root = destination.resolve()
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            target = (destination / member.filename).resolve()
            if root not in target.parents and target != root:
                raise PipelineError(f"Unsafe archive member: {member.filename}")
        bundle.extractall(destination)


def install_blender(version: str) -> Path:
    existing = find_blender()
    if existing:
        BLENDER_PATH_FILE.write_text(str(existing) + "\n", encoding="utf-8")
        info(f"Using Blender at {existing}")
        return existing

    artifact_name, kind = release_artifact(version)
    release_series = ".".join(version.split(".")[:2])
    base_url = f"{OFFICIAL_RELEASE_ROOT}/Blender{release_series}"
    TOOLS_DIR.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="blender-install-") as temp_name:
        temp = Path(temp_name)
        artifact = temp / artifact_name
        checksums = temp / f"blender-{version}.sha256"
        download(f"{base_url}/{checksums.name}", checksums)
        download(f"{base_url}/{artifact_name}", artifact)
        expected = expected_sha256(checksums, artifact_name)
        actual = sha256(artifact)
        if actual != expected:
            raise PipelineError(
                f"Blender checksum mismatch for {artifact_name}: expected {expected}, got {actual}"
            )
        info("Official SHA-256 checksum verified")

        if kind == "mac-dmg":
            mount = temp / "mount"
            mount.mkdir()
            subprocess.run(
                ["hdiutil", "attach", str(artifact), "-nobrowse", "-quiet", "-mountpoint", str(mount)],
                check=True,
            )
            try:
                source_app = next(mount.glob("*.app"), None)
                if source_app is None:
                    raise PipelineError("Blender.app was not found inside the official disk image")
                destination_app = TOOLS_DIR / "Blender.app"
                if destination_app.exists():
                    shutil.rmtree(destination_app)
                subprocess.run(["ditto", str(source_app), str(destination_app)], check=True)
            finally:
                subprocess.run(["hdiutil", "detach", str(mount), "-quiet"], check=False)
            installed = TOOLS_DIR / "Blender.app/Contents/MacOS/Blender"
        elif kind == "zip":
            unpacked = temp / "unpacked"
            unpacked.mkdir()
            safe_extract_zip(artifact, unpacked)
            source = next((item for item in unpacked.iterdir() if item.is_dir()), None)
            if source is None:
                raise PipelineError("Blender folder was not found in the official zip")
            destination = TOOLS_DIR / "blender"
            if destination.exists():
                shutil.rmtree(destination)
            shutil.move(str(source), destination)
            installed = destination / "blender.exe"
        else:
            unpacked = temp / "unpacked"
            unpacked.mkdir()
            safe_extract_tar(artifact, unpacked)
            source = next((item for item in unpacked.iterdir() if item.is_dir()), None)
            if source is None:
                raise PipelineError("Blender folder was not found in the official archive")
            destination = TOOLS_DIR / "blender"
            if destination.exists():
                shutil.rmtree(destination)
            shutil.move(str(source), destination)
            installed = destination / "blender"

    if not executable_works(installed):
        raise PipelineError(f"Installed Blender is not executable: {installed}")
    installed = installed.resolve()
    BLENDER_PATH_FILE.write_text(str(installed) + "\n", encoding="utf-8")
    info(f"Installed Blender {version} locally at {installed}")
    return installed


def discover_blends(inputs: Iterable[str], only: str | None) -> list[Path]:
    files: list[Path] = []
    for raw in inputs:
        candidate = Path(raw).expanduser()
        if not candidate.is_absolute():
            candidate = (ROOT / candidate).resolve()
        if candidate.is_file() and candidate.suffix.lower() == ".blend":
            files.append(candidate)
        elif candidate.is_dir():
            files.extend(
                path.resolve()
                for path in candidate.rglob("*.blend")
                if ".tools" not in path.parts and "dist" not in path.parts
            )
        else:
            raise PipelineError(f"Input does not exist or is not a .blend file: {candidate}")
    if only:
        needle = only.casefold()
        files = [path for path in files if needle in path.stem.casefold()]
    unique = sorted(set(files), key=lambda path: str(path).casefold())
    if not unique:
        raise PipelineError("No .blend files matched the requested inputs")
    return unique


def slugify(value: str) -> str:
    output = []
    previous_dash = False
    for char in value.casefold():
        if char.isalnum():
            output.append(char)
            previous_dash = False
        elif not previous_dash:
            output.append("-")
            previous_dash = True
    return "".join(output).strip("-") or "asset"


def png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as stream:
        header = stream.read(24)
    if len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise PipelineError(f"Invalid PNG: {path}")
    return struct.unpack(">II", header[16:24])


def write_catalog(output: Path) -> dict:
    manifests: list[tuple[Path, dict]] = []
    for path in sorted(output.glob("*/manifest.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        manifests.append((path, data))
    if not manifests:
        raise PipelineError(f"No rendered manifests found in {output}")
    versions = {}
    for path, data in manifests:
        signature = hashlib.sha256(path.read_bytes())
        for atlas in data["atlases"]:
            signature.update((path.parent / atlas["image"]).read_bytes())
        versions[path] = signature.hexdigest()[:16]
    assets = [
        {
            "id": data["id"],
            "name": data["name"],
            "version": versions[path],
            "manifest": str(path.relative_to(output)).replace(os.sep, "/"),
            "animations": list(data["animations"]),
            "thumbnail": (
                str((path.parent / data["thumbnail"]).relative_to(output)).replace(os.sep, "/")
                if data.get("thumbnail")
                else None
            ),
        }
        for path, data in manifests
    ]
    catalog = {"format": "html5-sprite-catalog-v1", "assets": assets}
    (output / "catalog.json").write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    web = ROOT / "web"
    for name in ("index.html", "player.js", "aquarium.js", "style.css"):
        shutil.copy2(web / name, output / name)
    return catalog


def validate_output(output: Path) -> None:
    catalog_path = output / "catalog.json"
    if not catalog_path.is_file():
        raise PipelineError(f"Missing {catalog_path}")
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    errors: list[str] = []
    for asset in catalog.get("assets", []):
        manifest_path = output / asset["manifest"]
        if not manifest_path.is_file():
            errors.append(f"Missing manifest: {asset['manifest']}")
            continue
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        frame_size = manifest["frameSize"]
        width, height = frame_size["w"], frame_size["h"]
        pages: dict[int, tuple[int, int]] = {}
        for page in manifest.get("atlases", []):
            image_path = manifest_path.parent / page["image"]
            data_path = manifest_path.parent / page["data"]
            if not image_path.is_file() or not data_path.is_file():
                errors.append(f"{asset['id']}: missing atlas page {page['page']}")
                continue
            atlas_w, atlas_h = png_size(image_path)
            pages[page["page"]] = (atlas_w, atlas_h)
            if atlas_w > manifest["maxAtlasSize"] or atlas_h > manifest["maxAtlasSize"]:
                errors.append(f"{asset['id']}: atlas {page['page']} exceeds maximum size")
        for action_name, action in manifest.get("animations", {}).items():
            if not action.get("frames"):
                errors.append(f"{asset['id']}/{action_name}: animation has no frames")
            for frame in action.get("frames", []):
                frame_path = manifest_path.parent / frame["image"]
                if not frame_path.is_file():
                    errors.append(f"{asset['id']}/{action_name}: missing {frame['image']}")
                else:
                    actual = png_size(frame_path)
                    if actual != (width, height):
                        errors.append(f"{frame_path}: expected {width}x{height}, got {actual}")
                page_size = pages.get(frame["page"])
                rect = frame["frame"]
                if page_size and (
                    rect["x"] < 0
                    or rect["y"] < 0
                    or rect["x"] + rect["w"] > page_size[0]
                    or rect["y"] + rect["h"] > page_size[1]
                ):
                    errors.append(f"{asset['id']}/{frame['key']}: atlas rectangle is out of bounds")
    if errors:
        raise PipelineError("Validation failed:\n- " + "\n- ".join(errors))
    info(f"Validated {len(catalog.get('assets', []))} assets with no missing or out-of-bounds frames")


def render(args: argparse.Namespace) -> None:
    blender = install_blender(args.blender_version)
    blends = discover_blends(args.input or ["."], args.only)
    output = Path(args.output).expanduser()
    if not output.is_absolute():
        output = (ROOT / output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    renderer = ROOT / "tools/blender_render.py"

    info(f"Rendering {len(blends)} model(s) to {output}")
    for index, blend in enumerate(blends, start=1):
        asset_dir = output / slugify(blend.stem)
        info(f"[{index}/{len(blends)}] {blend.name}")
        command = [
            str(blender),
            "--background",
            str(blend),
            "--python-exit-code",
            "1",
            "--python",
            str(renderer),
            "--",
            "--output",
            str(asset_dir),
            "--size",
            str(args.size),
            "--fps",
            str(args.fps),
            "--max-atlas-size",
            str(args.max_atlas_size),
            "--view",
            args.view,
            "--engine",
            args.engine,
            "--style",
            args.style,
        ]
        if args.actions:
            command.extend(["--actions", args.actions])
        if args.max_frames:
            command.extend(["--max-frames", str(args.max_frames)])
        if args.recolor:
            command.append("--recolor")
        if args.add_face:
            command.append("--add-face")
        if args.keep_existing:
            command.append("--keep-existing")
        result = subprocess.run(command, cwd=ROOT, check=False)
        if result.returncode != 0:
            raise PipelineError(f"Blender failed while rendering {blend.name}")

    catalog = write_catalog(output)
    validate_output(output)
    info(f"Complete: {len(catalog['assets'])} assets. Preview with: python3 pipeline.py preview")


def preview(args: argparse.Namespace) -> None:
    output = Path(args.output).expanduser()
    if not output.is_absolute():
        output = (ROOT / output).resolve()
    if not (output / "index.html").is_file():
        raise PipelineError(f"No preview found in {output}; run the render command first")
    info(f"Preview: http://127.0.0.1:{args.port}/")
    subprocess.run(
        [sys.executable, "-m", "http.server", str(args.port), "--bind", "127.0.0.1"],
        cwd=output,
        check=False,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Install Blender and turn animated .blend files into HTML5 sprite atlases."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    setup_parser = subparsers.add_parser("setup", help="Find or install a verified local Blender")
    setup_parser.add_argument("--blender-version", default=DEFAULT_BLENDER_VERSION)

    render_parser = subparsers.add_parser("render", help="Render, pack, and validate sprite assets")
    render_parser.add_argument("--input", action="append", help=".blend file or folder; repeatable")
    render_parser.add_argument("--output", default="dist")
    render_parser.add_argument("--only", help="Only models whose file name contains this text")
    render_parser.add_argument("--actions", help="Comma-separated canonical actions such as idle,walk,run")
    render_parser.add_argument("--size", type=int, default=256)
    render_parser.add_argument("--fps", type=float, default=12.0)
    render_parser.add_argument("--max-frames", type=int, default=0, help="Optional cap per animation; 0 keeps all samples")
    render_parser.add_argument("--max-atlas-size", type=int, default=2048)
    render_parser.add_argument("--view", choices=("left", "right"), default="right")
    render_parser.add_argument("--engine", choices=("cycles", "eevee"), default="cycles")
    render_parser.add_argument("--style", choices=("standard", "cartoon"), default="standard", help="Cartoon adds cel shading and ink outlines; standard keeps the existing look")
    render_parser.add_argument("--recolor", action="store_true", help="Apply a new deterministic palette")
    render_parser.add_argument("--add-face", action="store_true", help="Add visible eyes and a curved mouth to fish using their head rig")
    render_parser.add_argument("--keep-existing", action="store_true", help="Do not clear an existing asset output folder")
    render_parser.add_argument("--blender-version", default=DEFAULT_BLENDER_VERSION)

    validate_parser = subparsers.add_parser("validate", help="Validate an existing render output")
    validate_parser.add_argument("--output", default="dist")

    preview_parser = subparsers.add_parser("preview", help="Serve the HTML5 preview locally")
    preview_parser.add_argument("--output", default="dist")
    preview_parser.add_argument("--port", type=int, default=8000)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        if args.command == "setup":
            install_blender(args.blender_version)
        elif args.command == "render":
            if args.style == "cartoon" and args.engine != "cycles":
                raise PipelineError("--style cartoon requires --engine cycles for ink outlines")
            if args.size < 64 or args.size > 2048:
                raise PipelineError("--size must be between 64 and 2048")
            if args.fps <= 0:
                raise PipelineError("--fps must be positive")
            if args.max_atlas_size < args.size:
                raise PipelineError("--max-atlas-size must be at least --size")
            render(args)
        elif args.command == "validate":
            output = Path(args.output).expanduser()
            if not output.is_absolute():
                output = (ROOT / output).resolve()
            validate_output(output)
        elif args.command == "preview":
            preview(args)
        return 0
    except (PipelineError, OSError, subprocess.SubprocessError, urllib.error.URLError) as error:
        print(f"[sprite-pipeline] ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
