#!/usr/bin/env python3
"""Pack existing native cat-defense artwork into portable browser atlases.

No game art is rendered or redrawn. On macOS the standard CoreGraphics/ImageIO
frameworks resize the already-rendered PNGs. One crop/camera is used for all
frames of an actor, so transparent-margin removal cannot create animation jitter.
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "raw/craftpix-net-397030-free-cartoon-cat-defense-game-asset-kit"
CATS = ROOT / "build/exports/cats-animated-2048"

SWIFT = r'''
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

func load(_ path: String) throws -> CGImage {
    guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw NSError(domain: "DefenseAssets", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot read \(path)"])
    }
    return image
}
func save(_ image: CGImage, _ path: String) throws {
    let url = URL(fileURLWithPath: path)
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard let output = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        throw NSError(domain: "DefenseAssets", code: 2)
    }
    CGImageDestinationAddImage(output, image, nil)
    guard CGImageDestinationFinalize(output) else { throw NSError(domain: "DefenseAssets", code: 3) }
}
let input = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
let request = try JSONSerialization.jsonObject(with: input) as! [String: Any]
if request["inspect"] != nil {
    var result = [[String: Any]]()
    for path in request["inspect"] as! [String] {
        let image = try load(path)
        let w = image.width, h = image.height
        var bytes = [UInt8](repeating: 0, count: w*h*4)
        var bounds = [w, h, -1, -1]
        bytes.withUnsafeMutableBytes { buffer in
            let ctx = CGContext(data: buffer.baseAddress, width: w, height: h, bitsPerComponent: 8,
                bytesPerRow: w*4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        }
        for y in 0..<h { for x in 0..<w {
            if bytes[(y*w+x)*4+3] > 20 {
                bounds[0] = min(bounds[0], x); bounds[1] = min(bounds[1], y)
                bounds[2] = max(bounds[2], x); bounds[3] = max(bounds[3], y)
            }
        }}
        result.append(["path": path, "width": w, "height": h, "bounds": bounds])
    }
    let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
} else {
    for job in request["jobs"] as! [[String: Any]] {
        let width = job["width"] as! Int, height = job["height"] as! Int
        let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
            bytesPerRow: width*4, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.interpolationQuality = .high
        for frame in job["frames"] as! [[String: Any]] {
            let image = try load(frame["source"] as! String)
            let crop = frame["crop"] as! [Double]
            let dest = frame["dest"] as! [Double]
            let cropped = image.cropping(to: CGRect(x: crop[0], y: crop[1], width: crop[2], height: crop[3]))!
            // CGContext uses bottom-left placement, while manifest rects use top-left.
            ctx.draw(cropped, in: CGRect(x: dest[0], y: Double(height)-dest[1]-dest[3], width: dest[2], height: dest[3]))
        }
        try save(ctx.makeImage()!, job["output"] as! String)
        print("Packed \((job["output"] as! String).components(separatedBy: "/").last!)")
    }
}
'''


def png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as file:
        header = file.read(24)
    return struct.unpack(">II", header[16:24])


def browser_images(output: Path, manifest: dict, image_format: str) -> None:
    """Use Sharp for exact-alpha lossless WebP and small portal portraits."""
    script = r'''
import sharp from 'sharp';
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import path from 'node:path';
const [folder,manifestPath,format]=process.argv.slice(1);
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
await mkdir(path.join(folder,'portraits'),{recursive:true});
for(const cat of Object.values(manifest.cats)) {
  const clip=cat.clips.idle,frame=clip.frames[0];
  await sharp(path.join(folder,clip.image??cat.image))
    .extract({left:frame.x,top:frame.y,width:frame.w,height:frame.h})
    .resize(192,192).png({compressionLevel:9})
    .toFile(path.join(folder,`portraits/${cat.id}.png`));
  cat.thumbnail=`portraits/${cat.id}.png`;
}
if(format==='webp') {
  const images=new Set();
  const visit=value=>{
    if(!value||typeof value!=='object')return;
    for(const [key,child]of Object.entries(value)) {
      if(key==='image'&&typeof child==='string'&&child.endsWith('.png'))images.add(child);
      else visit(child);
    }
  };
  visit(manifest);
  const list=[...images];let next=0;
  async function worker(){
    while(next<list.length){const image=list[next++];
      await sharp(path.join(folder,image)).webp({lossless:true,effort:5})
        .toFile(path.join(folder,image.replace(/\.png$/,'.webp')));
      await unlink(path.join(folder,image));
    }
  }
  await Promise.all([worker(),worker()]);
  const replace=value=>{
    if(!value||typeof value!=='object')return;
    for(const [key,child]of Object.entries(value)) {
      if(key==='image'&&images.has(child))value[key]=child.replace(/\.png$/,'.webp');
      else replace(child);
    }
  };
  replace(manifest);
}
await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
'''
    manifest_path = output/"manifest.json"
    manifest_path.write_text(json.dumps(manifest,indent=2)+"\n")
    subprocess.run(["node", "--input-type=module", "-e", script,
        str(output), str(manifest_path), image_format], cwd=ROOT, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "game/cat-defense/assets")
    parser.add_argument("--cat-size", type=int, default=384)
    parser.add_argument("--enemy-size", type=int, default=256)
    parser.add_argument("--format", choices=("webp", "png"), default="webp")
    args = parser.parse_args()
    if sys.platform != "darwin":
        raise SystemExit("This preparation tool uses macOS CoreGraphics. Its generated PNG/JSON assets run on every browser platform.")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    jobs: list[dict] = []
    manifest: dict = {
        "format": "cat-defense-atlas-v1", "version": 1,
        "source": "Craftpix free cartoon cat defense game asset kit",
        "cats": {}, "enemies": {}, "effects": {}, "scenery": {},
    }

    def add_atlas(files: list[Path], relative: str, size: int, crop: list[float], *, stretch=False):
        cols = min(8, len(files))
        rows = math.ceil(len(files) / cols)
        cw, ch = crop[2:]
        scale = size / max(cw, ch)
        dw, dh = (size, size) if stretch else (cw*scale, ch*scale)
        frames = []
        renders = []
        for index, path in enumerate(files):
            x, y = (index % cols)*size, (index // cols)*size
            frames.append({"x": x, "y": y, "w": size, "h": size})
            renders.append({"source": str(path), "crop": crop,
                "dest": [x+(size-dw)/2, y+(size-dh)/2, dw, dh]})
        jobs.append({"output": str(output/relative), "width": cols*size,
            "height": rows*size, "frames": renders})
        return frames

    def cat_muzzles(number: int, clips: dict) -> dict:
        # Re-evaluate the exporter camera and supplied gun bone (read-only).
        sys.path.insert(0, str(ROOT))
        from tools.export_animated_cats import bone_worlds, attachment_world, transformed_corners
        skeleton = json.loads((SOURCE/f"Json Atlas/Cat Characters/Cat{number}/Character{number}.json").read_text())
        attachments = skeleton["skins"][0]["attachments"]
        poses = {}
        all_corners = []
        for clip, paths in clips.items():
            animation = skeleton["animations"][clip.title()]
            poses[clip] = []
            for index in range(len(paths)):
                worlds = bone_worlds(skeleton, animation, index/30)
                transforms = {}
                for slot in skeleton["slots"]:
                    attachment = attachments[slot["name"]][slot.get("attachment", slot["name"])]
                    matrix = attachment_world(worlds[slot["bone"]], attachment)
                    all_corners.extend(transformed_corners(matrix, attachment))
                    transforms[slot["name"]] = (attachment, matrix)
                poses[clip].append(transforms)
        xmin, xmax = min(x for x, y in all_corners), max(x for x, y in all_corners)
        ymin, ymax = min(y for x, y in all_corners), max(y for x, y in all_corners)
        scale = .88/max(xmax-xmin, ymax-ymin)
        ox, oy = .5-scale*(xmin+xmax)/2, .5+scale*(ymin+ymax)/2
        result = {}
        for clip, frames in poses.items():
            result[clip] = []
            for transforms in frames:
                attachment, matrix = transforms["Gun"]
                a,b,c,d,x,y = matrix
                # Barrel opening center, measured in the supplied gun artboard.
                gx, gy = attachment["width"]*.36, attachment["height"]*.14
                result[clip].append({"x":round(ox+scale*(a*gx+b*gy+x),6),
                    "y":round(oy-scale*(c*gx+d*gy+y),6)})
        return result

    with tempfile.TemporaryDirectory(prefix="cat-defense-assets-") as temp:
        work = Path(temp)
        swift_path, binary = work/"pack.swift", work/"pack"
        swift_path.write_text(SWIFT)
        subprocess.run(["swiftc", "-module-cache-path", str(work/"module-cache"),
            str(swift_path), "-o", str(binary)], check=True)

        def swift(request: dict, capture=False):
            request_path = work/"request.json"
            request_path.write_text(json.dumps(request))
            result = subprocess.run([str(binary), str(request_path)], check=True,
                capture_output=capture, text=True)
            return json.loads(result.stdout) if capture else None

        for folder in sorted(p for p in CATS.glob("cat-*") if p.is_dir()):
            cat_id = folder.name
            clips = {p.name: sorted(p.glob("*.png")) for p in sorted((folder/"original").iterdir()) if p.is_dir()}
            source_files = [file for files in clips.values() for file in files]
            if not source_files:
                continue
            size = args.cat_size
            image_path = f"cats/{cat_id}.png"
            rects = add_atlas(source_files, image_path, size, [0, 0, *png_size(source_files[0])])
            muzzles = cat_muzzles(int(cat_id[4:]), clips) if cat_id[4:].isdigit() else {}
            record = {"id": cat_id, "label": f"Cat {int(cat_id[4:]):02d}" if cat_id[4:].isdigit() else cat_id.replace("cat-", "").title(),
                "image": image_path, "frameWidth": size, "frameHeight": size,
                "kind": "boxer" if cat_id == "cat-boxer" else "guardian" if cat_id == "cat-guardian" else "gun",
                "anchor": {"x": .5, "y": .86}, "muzzle": {"x": .8, "y": .55}, "clips": {}}
            index = 0
            for clip, files in clips.items():
                frames = rects[index:index+len(files)]
                if clip in muzzles:
                    for frame, muzzle in zip(frames, muzzles[clip]):
                        frame["muzzle"] = muzzle
                record["clips"][clip] = {"image": image_path, "fps":30, "loop":clip=="idle", "frames":frames}
                index += len(files)
            record["muzzle"] = record["clips"]["idle"]["frames"][0].get("muzzle", record["muzzle"])
            # Native bonus actors retain their actual fight/attack clips.
            record["actionClip"] = "shoot" if "shoot" in clips else "fight" if "fight" in clips else "attack"
            manifest["cats"][cat_id] = record

        enemies = sorted(p for p in (SOURCE/"Png/Enemies").iterdir() if p.is_dir())
        all_enemy_files = [file for folder in enemies for file in sorted(folder.glob("*/*.png"))]
        inspected = {row["path"]: row for row in swift({"inspect":[str(file) for file in all_enemy_files]}, True)}
        for folder in enemies:
            enemy_id = folder.name.lower().replace(" ", "-")
            files = sorted(folder.glob("*/*.png"))
            boxes = [inspected[str(file)]["bounds"] for file in files]
            width, height = png_size(files[0])
            left, top = max(0,min(b[0] for b in boxes)-3), max(0,min(b[1] for b in boxes)-3)
            right, bottom = min(width,max(b[2] for b in boxes)+4), min(height,max(b[3] for b in boxes)+4)
            crop = [left,top,right-left,bottom-top]
            size = args.enemy_size
            scale = size/max(crop[2:])
            idle = inspected[str(sorted((folder/"Idle").glob("*.png"))[0])]["bounds"]
            anchor = {"x":round(((idle[0]+idle[2])/2-left)*scale/size+(size-crop[2]*scale)/(2*size),6),
                "y":round((idle[3]-top)*scale/size+(size-crop[3]*scale)/(2*size),6)}
            record = {"id":enemy_id,"label":folder.name,"kind":"boss" if "Boss" in folder.name else "regular",
                "frameWidth":size,"frameHeight":size,"anchor":anchor,"clips":{},"facing":"left"}
            for clip_folder in sorted(p for p in folder.iterdir() if p.is_dir()):
                clip = clip_folder.name.lower()
                image_path = f"enemies/{enemy_id}-{clip}.png"
                rects = add_atlas(sorted(clip_folder.glob("*.png")), image_path, size, crop)
                record["clips"][clip] = {"image":image_path,"fps":30,"loop":clip in {"idle","walk"},"frames":rects}
            record["image"] = record["clips"]["idle"]["image"]
            manifest["enemies"][enemy_id] = record

        for name, folder, size in [("explosion", SOURCE/"Png/Explosion",384),("shoot",SOURCE/"Png/ShootFx",192)]:
            files = sorted(folder.glob("*.png"))
            width,height = png_size(files[0])
            relative = f"effects/{name}.png"
            rects=add_atlas(files, relative,size,[0,0,width,height])
            manifest["effects"][name] = {"image":relative,"frameWidth":size,"frameHeight":size,
                "anchor":{"x":.5,"y":.5},"clips":{"play":{"image":relative,"fps":30,"loop":False,"frames":rects}}}

        area=SOURCE/"Png/Area/Area1.png"
        width,height=png_size(area)
        jobs.append({"output":str(output/"scenery/area-1.png"),"width":1440,"height":714,
            "frames":[{"source":str(area),"crop":[0,0,width,height],"dest":[0,0,1440,714]}]})
        manifest["scenery"]["background"]={"image":"scenery/area-1.png","width":1440,"height":714,"fenceX":.33,
            "fenceHpBar":{"x":.310,"y":.252,"w":.010,"h":.395}}
        # Native fence segment, without the baked source health bar.
        jobs.append({"output":str(output/"scenery/fence.png"),"width":96,"height":440,
            "frames":[{"source":str(area),"crop":[519,218,117,596],"dest":[0,0,96,440]}]})
        manifest["scenery"]["fence"]={"image":"scenery/fence.png","width":96,"height":440}
        bullet=CATS/"extras/bullets/bullet-1.png"
        width,height=png_size(bullet)
        jobs.append({"output":str(output/"effects/bullet.png"),"width":128,"height":max(1,round(128*height/width)),
            "frames":[{"source":str(bullet),"crop":[0,0,width,height],"dest":[0,0,128,128*height/width]}]})
        manifest["effects"]["bullet"]={"image":"effects/bullet.png"}
        swift({"jobs":jobs})

    licenses=output/"licenses"
    licenses.mkdir(exist_ok=True)
    shutil.copy2(SOURCE/"license.txt",licenses/"craftpix-license.txt")
    shutil.copy2(CATS/"source-license.txt",licenses/"combat-export-source.txt")
    manifest["licenses"]=["licenses/craftpix-license.txt","licenses/combat-export-source.txt"]
    browser_images(output, manifest, args.format)
    total=sum(file.stat().st_size for file in output.rglob("*") if file.is_file())
    print(f"Ready: {len(manifest['cats'])} cats, {len(manifest['enemies'])} enemies, {total/1024/1024:.2f} MiB at {output}")


if __name__ == "__main__":
    main()
