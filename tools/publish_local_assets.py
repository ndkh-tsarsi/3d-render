#!/usr/bin/env python3
"""Publish validated local sprites to a static branch without changing main's checkout."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pipeline import ROOT, PipelineError, validate_output


BRANCH = "published-assets"
AQUATIC_IDS = {"dolphin", "fish1", "fish2", "fish3", "manta-ray", "shark", "whale"}


def run_git(*args: str, cwd: Path = ROOT, env: dict | None = None) -> str:
    result = subprocess.run(
        ["git", *args], cwd=cwd, env=env, text=True, capture_output=True, check=False
    )
    if result.returncode:
        raise PipelineError(result.stderr.strip() or result.stdout.strip() or "Git command failed")
    return result.stdout.strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="dist")
    parser.add_argument("--require-aquatic-size", type=int)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    try:
        output = Path(args.output).expanduser()
        if not output.is_absolute():
            output = ROOT / output
        output = output.resolve()
        if output == ROOT or output == Path(output.anchor) or (output / ".git").exists():
            raise PipelineError("Choose a generated asset directory such as dist, not a Git checkout")
        validate_output(output)
        catalog = json.loads((output / "catalog.json").read_text(encoding="utf-8"))
        paths = ["catalog.json", "index.html", "player.js", "aquarium.js", "fishing.js", "style.css"]
        for name in paths:
            if not (output / name).is_file():
                raise PipelineError(f"Missing preview file: {name}")
        aquatic = set()
        for asset in catalog["assets"]:
            manifest_path = (output / asset["manifest"]).resolve()
            if output not in manifest_path.parents or manifest_path.parent == output:
                raise PipelineError(f"Invalid asset directory: {asset['manifest']}")
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if asset["id"] in AQUATIC_IDS:
                aquatic.add(asset["id"])
                if args.require_aquatic_size and manifest["frameSize"] != {
                    "w": args.require_aquatic_size, "h": args.require_aquatic_size
                }:
                    raise PipelineError(f"{asset['id']} is not {args.require_aquatic_size}px")
                if args.require_aquatic_size and (
                    manifest.get("style") != "cartoon" or not manifest.get("generatedFace")
                ):
                    raise PipelineError(f"{asset['id']} is missing cartoon shading or facial features")
            paths.append(manifest_path.parent.relative_to(output).as_posix())
        if args.require_aquatic_size and aquatic != AQUATIC_IDS:
            raise PipelineError("The package must contain all seven aquatic models")
        if (output / "licenses").is_dir():
            paths.append("licenses")
        if any(path.name == ".git" for path in output.rglob(".git")):
            raise PipelineError("The generated package must not contain nested Git metadata")

        print(f"Validated {len(catalog['assets'])} models in {output}", flush=True)
        if args.dry_run:
            print(f"Would publish {len(paths)} paths to origin/{BRANCH}; no files or Git refs changed")
            return 0

        git_dir = run_git("rev-parse", "--absolute-git-dir")
        network_env = os.environ.copy()
        network_env.setdefault(
            "GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10"
        )
        remote = run_git("ls-remote", "--heads", "origin", f"refs/heads/{BRANCH}", env=network_env)
        parent = None
        if remote:
            run_git("fetch", "--no-tags", "origin", f"refs/heads/{BRANCH}", env=network_env)
            parent = run_git("rev-parse", "FETCH_HEAD")

        # The alternate index and explicit work tree leave main's files/index alone.
        with tempfile.TemporaryDirectory(prefix="local-sprite-publish-") as temporary:
            staging_env = os.environ.copy()
            staging_env["GIT_INDEX_FILE"] = str(Path(temporary) / "index")
            prefix = ("--git-dir", git_dir, "--work-tree", str(output))
            run_git(*prefix, "read-tree", "--empty", cwd=output, env=staging_env)
            run_git(*prefix, "add", "--force", "--all", "--", *paths, cwd=output, env=staging_env)
            tree = run_git(*prefix, "write-tree", cwd=output, env=staging_env)
            if parent and tree == run_git("rev-parse", f"{parent}^{{tree}}"):
                print("The published asset package already matches the local render")
                return 0
            commit_args = ["commit-tree", tree, "-m", "Publish locally rendered HTML5 assets"]
            if parent:
                commit_args.extend(["-p", parent])
            commit = run_git(*commit_args)
            # A normal push rejects a concurrent branch update; no force push is used.
            print(run_git("push", "origin", f"{commit}:refs/heads/{BRANCH}", env=network_env))
            print(f"Published local assets: {commit} on {BRANCH}")
        return 0
    except (PipelineError, OSError, subprocess.SubprocessError) as error:
        print(f"[local-publish] ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
