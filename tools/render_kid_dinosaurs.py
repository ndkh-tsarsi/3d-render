#!/usr/bin/env python3
"""Render six native dinosaur rigs locally using the shared kids' cartoon style."""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import math
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
SOURCE=ROOT/"raw/Dinosaur Animated Pack - Dec 2018"
NAMES=("Apatosaurus","Parasaurolophus","Stegosaurus","Trex","Triceratops","Velociraptor")


def worker():
    import bpy
    from tools import blender_render,kid_dinosaur_skin
    kid_dinosaur_skin.install(blender_render,Path(bpy.data.filepath).stem)
    args=blender_render.parse_args();blender_render.main()
    path=Path(args.output).resolve()/"manifest.json"
    kid_dinosaur_skin.annotate(path)
    manifest=json.loads(path.read_text())
    manifest["skin"].update(maxFrames=args.max_frames,actions=args.actions,engine=args.engine)
    path.write_text(json.dumps(manifest,indent=2)+"\n")


def main():
    from pipeline import find_blender,validate_output,write_catalog
    from tools.kid_dinosaur_skin import STYLE_ID,GEOMETRY_ID
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output",default="build/work/dinosaurs-cartoon-1024")
    parser.add_argument("--size",type=int,default=1024)
    parser.add_argument("--fps",type=float,default=12)
    parser.add_argument("--engine",choices=("eevee","cycles"),default="eevee")
    parser.add_argument("--jobs",type=int,choices=(1,2),default=2)
    parser.add_argument("--only",help="Comma-separated dinosaur IDs")
    parser.add_argument("--actions",help="Optional native action filter; default renders all six actions")
    parser.add_argument("--max-frames",type=int,default=0,help="Limit samples per action for review probes")
    parser.add_argument("--keep-existing",action="store_true")
    args=parser.parse_args()
    if args.size<64 or not math.isfinite(args.fps) or args.fps<=0 or args.max_frames<0:
        parser.error("Use size>=64, positive finite fps and nonnegative max-frames")
    blender=find_blender()
    if not blender: parser.error("Blender is not installed; run pipeline.py setup")
    names=list(NAMES)
    if args.only:
        ids=list(dict.fromkeys(n.strip().casefold() for n in args.only.split(",")))
        if any(n not in [s.casefold() for s in NAMES] for n in ids): parser.error("Unknown dinosaur ID")
        names=[next(s for s in NAMES if s.casefold()==n) for n in ids]
    output=(ROOT/args.output).resolve()
    if (output in {ROOT,ROOT/"dist",ROOT/"build/html5-assets"}
            or (output.parent==ROOT and output.name.startswith("dist"))
            or SOURCE==output or SOURCE in output.parents):
        parser.error("Use an isolated render output, such as build/work/dinosaurs-cartoon-1024")
    logs=output/"logs";logs.mkdir(parents=True,exist_ok=True)
    threads=max(1,(os.cpu_count() or 4)//args.jobs)
    started=time.monotonic()

    def render(name):
        asset_id=name.casefold();source=SOURCE/"Blends"/f"{name}.blend"
        if not source.is_file(): raise FileNotFoundError(source)
        folder=output/asset_id;path=folder/"manifest.json"
        if args.keep_existing and path.is_file():
            m=json.loads(path.read_text());skin=m.get("skin",{})
            if (m.get("frameSize")=={"w":args.size,"h":args.size}
                    and skin.get("id")==STYLE_ID and m.get("geometry",{}).get("id")==GEOMETRY_ID
                    and skin.get("maxFrames")==args.max_frames and skin.get("actions")==args.actions
                    and skin.get("engine")==args.engine
                    and all(a.get("fps")==args.fps for a in m.get("animations",{}).values())):
                return asset_id,"existing"
        command=[str(blender),"--background",str(source),"--threads",str(threads),"--python-exit-code","1",
            "--python",str(Path(__file__).resolve()),"--","--dinosaur-worker","--output",str(folder),
            "--size",str(args.size),"--fps",str(args.fps),"--style","cartoon","--add-face",
            "--engine",args.engine,"--max-atlas-size","2048"]
        if args.actions: command += ["--actions",args.actions]
        if args.max_frames: command += ["--max-frames",str(args.max_frames)]
        elapsed=time.monotonic();log_path=logs/f"{asset_id}.log"
        with log_path.open("w") as log: result=subprocess.run(command,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
        if result.returncode: raise RuntimeError(f"{asset_id} failed; see {log_path}")
        return asset_id,f"{time.monotonic()-elapsed:.1f}s"

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures=[pool.submit(render,name) for name in names]
        for count,future in enumerate(concurrent.futures.as_completed(futures),1):
            try: asset_id,timing=future.result()
            except Exception:
                for pending in futures: pending.cancel()
                raise
            print(f"[kid-dinosaur] {count}/{len(names)} {asset_id}: {timing}",flush=True)
    licenses=output/"licenses";licenses.mkdir(exist_ok=True)
    shutil.copy2(SOURCE/"License.txt",licenses/"dinosaur-animated-pack-dec-2018.txt")
    write_catalog(output);validate_output(output)
    print(f"[kid-dinosaur] Complete {len(names)} dinosaurs in {time.monotonic()-started:.1f}s",flush=True)


if __name__=="__main__":
    if "--dinosaur-worker" in sys.argv:
        sys.argv.remove("--dinosaur-worker");worker()
    else: main()
