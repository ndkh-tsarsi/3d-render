#!/usr/bin/env python3
"""Compose all fifteen weapon-free fishing cats with their source costumes."""
from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
SOURCE = "raw/craftpix-net-397030-free-cartoon-cat-defense-game-asset-kit"
SIZE = 512

SWIFT = r'''
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
let input = URL(fileURLWithPath: CommandLine.arguments[1])
let folder = URL(fileURLWithPath: CommandLine.arguments[2])
let scale: CGFloat = 4
guard let document = CGPDFDocument(input as CFURL) else { fatalError("Cannot read cat vector source") }
for number in 1...document.numberOfPages {
    if CommandLine.arguments.count > 3, let onlyPage = Int(CommandLine.arguments[3]), onlyPage != number { continue }
    let page = document.page(at: number)!
    let box = page.getBoxRect(.mediaBox)
    let w = Int(ceil(box.width * scale)), h = Int(ceil(box.height * scale))
    let info = CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
    let context = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8,
        bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: info)!
    context.clear(CGRect(x: 0, y: 0, width: w, height: h))
    context.scaleBy(x: scale, y: scale)
    context.translateBy(x: -box.minX, y: -box.minY)
    context.drawPDFPage(page)
    let destination = CGImageDestinationCreateWithURL(folder.appendingPathComponent("part-\(number).png") as CFURL,
        UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, context.makeImage()!, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("Cannot save vector part") }
}
'''


def worker() -> None:
    import numpy as np
    import bpy
    from tools.package_boy import write_rgba, point
    from tools import cat_arm_pose as arm_rig
    from tools import native_cat_arm as native_rig

    args = sys.argv[sys.argv.index("--") + 1:]
    output = Path(args[0]); source = Path(args[1]); parts = Path(args[2]) if len(args)>2 else output.parent / "vector-parts"
    number = int(args[3]) if len(args)>3 else 1
    if number != 1:
        from tools.fishing_cat_roster import compose
        compose(output,source,parts,number,"--probe" in args)
        return
    output.mkdir(parents=True, exist_ok=True)

    def load(path):
        image = bpy.data.images.load(str(path), check_existing=False)
        image.colorspace_settings.name = "Non-Color"
        w,h = image.size
        pixels = np.empty(w*h*4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        bpy.data.images.remove(image)
        # Blender's image buffer is bottom-up; the atlas contract is top-down.
        return pixels.reshape(h,w,4)[::-1].copy()

    artwork = {name: load(parts / f"part-{index}.png") for name,index in {"head":1,"body":2,"tail":4,"gun":5}.items()}
    # Source Gun includes a complete arm, cuff and white closed paw. The cream
    # rounded tip is its shoulder, not its hand. Keep the complete native limb.
    artwork.pop("gun")
    paw=load(parts/'native-arm.png')
    if paw.shape[:2] != (161,235):
        raise RuntimeError('Cat1 requires the complete native arm/cuff/paw artboard, not an arm-only crop')
    artwork["paw"]=paw
    landmarks={'shoulder':(35.,66.),'elbow':(26.,110.),
        'wrist':(70.,124.),'grip':(96.,119.)}
    # Preserve the existing cream arm's displayed size, using the same factor
    # for the restored cuff and paw rather than scaling parts independently.
    native_scale=(70/57+109/89)/2
    native_hand={'pixels':paw,'wrist':landmarks['wrist'],'grip':landmarks['grip']}
    rest_shoulder=(210.,326.)

    def expression_head(expression, gaze=0):
        """Add antialiased vector-style expressions in the original head's space.

        Idle/pull continue to use the untouched source. New eyes fully cover the
        supplied closed eyelids; the mouth is first restored with its sampled
        cream muzzle color, so no second expression remains underneath.
        """
        image=artwork["head"].copy();h,w=image.shape[:2]
        ey,ex=np.mgrid[:h,:w].astype(np.float32)
        # Logical coordinates correspond to the 4x vector export. This also
        # keeps the supplied-PNG fallback's face and anchors in proportion.
        ex=(ex+.5)*354/w;ey=(ey+.5)*331/h
        chocolate=np.array([73,30,27],dtype=np.float32)/255
        cream=image[round(260/331*h),round(210/354*w),:3].copy()

        def paint(coverage,color):
            coverage=np.clip(coverage,0,1)[:,:,None]
            image[:,:,:3]=image[:,:,:3]*(1-coverage)+np.asarray(color)*coverage

        def ellipse(cx,cy,rx,ry,color):
            distance=np.sqrt(((ex-cx)/rx)**2+((ey-cy)/ry)**2)
            coverage=np.clip((1-distance)*min(rx,ry)+.5,0,1)
            paint(coverage,color)

        def stroke(points,width,color):
            distance=np.full((h,w),1e6,dtype=np.float32)
            for (ax,ay),(bx,by) in zip(points,points[1:]):
                dx,dy=bx-ax,by-ay
                t=np.clip(((ex-ax)*dx+(ey-ay)*dy)/(dx*dx+dy*dy),0,1)
                distance=np.minimum(distance,np.sqrt((ex-ax-t*dx)**2+(ey-ay-t*dy)**2))
            paint(width/2+.5-distance,color)

        def curve(a,b,c):
            return [((1-t)**2*a[0]+2*(1-t)*t*b[0]+t*t*c[0],
                     (1-t)**2*a[1]+2*(1-t)*t*b[1]+t*t*c[1]) for t in np.linspace(0,1,25)]

        # Every source mouth pixel lies in this uniform cream area, below the
        # preserved coral nose. Rounded patch edges avoid rectangular seams.
        mouth_patch=np.minimum.reduce([ex-181,243-ex,ey-226,254-ey])
        paint(mouth_patch+.5,cream)
        if expression=="alert":
            for cx,rx in [(159,35),(259,32)]:
                ellipse(cx,195,rx,43,chocolate)
                ellipse(cx,195,rx-4,39,[1,.969,.894])
                ellipse(cx-3+gaze,198,11,17,chocolate)
                ellipse(cx-6+gaze,191,3.5,4.5,[1,1,.97])
            # Small, unmistakable O, readable when the whole cat is 90px tall.
            ellipse(213,240,12,15,chocolate)
            ellipse(213,242,6.5,8,[.74,.29,.24])
        elif expression=="happy":
            # Restore just the old eyelid strokes with their underlying fur;
            # keep the kit's cream brow markings and orange cheek stripes.
            for left,right in [(127,193),(229,287)]:
                patch=np.minimum.reduce([ex-left,right-ex,ey-187,211-ey])
                paint(patch+.5,[241/255,191/255,140/255])
            stroke(curve((136,203),(158,177),(182,203)),7,chocolate)
            stroke(curve((237,203),(260,177),(282,203)),7,chocolate)
            # A broad open smile and pink tongue replace the tiny source mouth.
            smile=np.clip((1-np.sqrt(((ex-213)/25)**2+((ey-238)/19)**2))*19+.5,0,1)
            smile*=np.clip(ey-230+.5,0,1)
            paint(smile,chocolate)
            tongue=np.clip((1-np.sqrt(((ex-214)/13)**2+((ey-251)/6)**2))*6+.5,0,1)
            paint(tongue*smile,[.97,.52,.43])
            stroke([(213,226),(213,231)],3,chocolate)
        else:
            # A gentle disappointment: soft lowered eyes, raised inner brows,
            # and a small frown. Restore the original eyelids before drawing
            # the new face, just as for the celebration expression.
            fur=[241/255,191/255,140/255]
            for left,right in [(127,193),(229,287)]:
                patch=np.minimum.reduce([ex-left,right-ex,ey-187,214-ey])
                paint(patch+.5,fur)
            for cx in (159,259):
                ellipse(cx,204,24,18,chocolate)
                ellipse(cx,204,20,14,[1,.969,.894])
                ellipse(cx,209,8.5,10,chocolate)
                ellipse(cx-2.5,205,2.5,3,[1,1,.97])
            # Half-closed upper lids droop toward the outside of the face.
            left_lid=199-(ex-136)*.12
            right_lid=193+(ex-236)*.12
            for left,right,lid in [(134,184,left_lid),(234,284,right_lid)]:
                cover=np.minimum.reduce([ex-left,right-ex,ey-187,lid-ey])
                paint(cover+.5,fur)
            stroke(curve((136,199),(159,191),(182,194)),4.5,chocolate)
            stroke(curve((236,194),(259,191),(282,199)),4.5,chocolate)
            stroke(curve((139,180),(162,169),(180,176)),4.5,chocolate)
            stroke(curve((238,176),(257,169),(279,180)),4.5,chocolate)
            stroke(curve((199,248),(213,230),(227,248)),4.5,chocolate)
        return image

    artwork["head_happy"]=expression_head("happy")
    artwork["head_sad"]=expression_head("sad")

    yy,xx = np.mgrid[:SIZE,:SIZE].astype(np.float32)
    def composite(canvas, name, cx,cy,w,h, angle=0):
        image = artwork[name]
        sh,sw = image.shape[:2]
        dx,dy = xx+.5-cx, yy+.5-cy
        c,s = math.cos(angle), math.sin(angle)
        sx = (c*dx+s*dy)/w*sw+sw/2-.5
        sy = (-s*dx+c*dy)/h*sh+sh/2-.5
        valid = (sx>=0)&(sy>=0)&(sx<sw-1)&(sy<sh-1)
        ix=np.clip(sx.astype(int),0,sw-2);iy=np.clip(sy.astype(int),0,sh-2)
        fx=np.clip(sx-ix,0,1)[:,:,None];fy=np.clip(sy-iy,0,1)[:,:,None]
        premult=image.copy();premult[:,:,:3]*=premult[:,:,3:4]
        pixels=(premult[iy,ix]*(1-fx)+premult[iy,ix+1]*fx)*(1-fy)+(premult[iy+1,ix]*(1-fx)+premult[iy+1,ix+1]*fx)*fy
        pixels*=valid[:,:,None]
        canvas[:]=pixels+canvas*(1-pixels[:,:,3:4])
        return pixels

    def pixels_rgba(canvas):
        rgba=canvas.copy()
        rgba[:,:,:3]=np.divide(rgba[:,:,:3],rgba[:,:,3:4],out=np.zeros_like(rgba[:,:,:3]),where=rgba[:,:,3:4]>1e-6)
        return bytearray(np.clip(np.rint(rgba*255),0,255).astype(np.uint8).tobytes())

    records=[]; images=[]
    clips=native_rig.CLIP_COUNTS
    for clip,count in clips.items():
        (output/"frames"/clip).mkdir(parents=True,exist_ok=True)
        indices=(([0,19,39] if clip=='pull' else [{'idle':0,'bite':0,'celebrate':10,'miss':12}[clip]]) if '--probe' in args else range(count))
        for index in indices:
            phase=index/count if clip in ("idle","bite") else index/(count-1)
            breath=.5-.5*math.cos(phase*math.tau)
            progress=phase*phase*(3-2*phase) if clip=="pull" else 0
            wind=math.sin(math.pi*min(1,phase/.3)) if clip=="pull" else 0
            squash=1-.055*breath if clip=="idle" else 1-.035*wind
            feet_x,feet_y=272.,466.
            body_h=214*squash
            center_y=feet_y-body_h/2
            head_x=268+progress*8;head_y=center_y-165*squash+wind*8-progress*4
            paw_x=160+progress*20;paw_y=366-progress*22+wind*8
            paw_angle=-progress*.16
            head_angle=-progress*.035
            tail_angle=-.22*breath+progress*.15
            tail_y=389
            head_name="head";expression="calm"
            if clip=="bite":
                pulse=math.sin(phase*math.tau)
                squash=1-.018*breath;body_h=214*squash;center_y=feet_y-body_h/2
                head_x=268+2*pulse;head_y=center_y-165*squash-3*breath
                head_angle=.014*pulse;tail_angle=.13*pulse
                paw_x=160;paw_y=366-2*breath;paw_angle=.012*pulse
                artwork["head_alert"]=expression_head("alert",1.5*pulse)
                head_name="head_alert";expression="alert"
            elif clip=="celebrate":
                progress=1-phase*phase*(3-2*phase)
                envelope=math.sin(math.pi*phase)
                wiggle=math.sin(phase*math.tau*3)*envelope
                bounce=(.5-.5*math.cos(phase*math.tau*3))*envelope
                squash=1-.045*bounce;body_h=214*squash;center_y=feet_y-body_h/2
                head_x=268+8*progress+2*wiggle
                head_y=center_y-165*squash-4*progress-7*bounce
                head_angle=-.035*progress+.035*wiggle
                paw_x=160+20*progress+3*wiggle;paw_y=366-22*progress-7*bounce
                paw_angle=-.16*progress+.035*wiggle
                tail_angle=.15*progress+.24*math.sin(phase*math.tau*4)*envelope
                # End on the exact calm head/pose for a clean return to idle.
                head_name="head_happy" if index<count-1 else "head"
                expression="happy" if index<count-1 else "calm"
            elif clip=="miss":
                # A single slow sigh, with the soles anchored to the pier.
                # Both endpoints use the idle geometry and the last frame is
                # exactly idle0, allowing the preview to resume without a jump.
                slump=math.sin(math.pi*phase)**.8
                squash=1-.045*slump;body_h=214*squash;center_y=feet_y-body_h/2
                head_x=268-4*slump
                head_y=center_y-165*squash+10*slump
                head_angle=-.03*slump
                paw_x=160-1.5*slump;paw_y=366+7*slump;paw_angle=.045*slump
                tail_angle=-.32*slump;tail_y=389+3*slump
                head_name="head_sad" if index<count-1 else "head"
                expression="disappointed" if index<count-1 else "calm"
            frame=np.zeros((SIZE,SIZE,4),dtype=np.float32)
            composite(frame,"tail",158,tail_y,164,140,tail_angle)
            shoulder=(rest_shoulder[0],center_y+(rest_shoulder[1]-359)*squash)
            arm_pose=native_rig.pose(landmarks,shoulder,native_scale,clip,phase,motion_sign=-1.)
            body_pixels=composite(frame,"body",272,center_y,194,body_h)
            foot_rows,foot_columns=np.where(body_pixels[:,:,3]>=24/255)
            body_feet_y=float(foot_rows.max()+1)
            sole_columns=foot_columns[foot_rows>=body_feet_y-4]
            body_feet_x=float((sole_columns.min()+sole_columns.max())/2)
            paw_pixels=arm_rig.draw_hand(frame,arm_pose,native_hand)
            composite(frame,head_name,head_x,head_y,354,330,head_angle)
            grip_x,grip_y=arm_pose['grip']['x'],arm_pose['grip']['y']
            sample=paw_pixels[round(grip_y),round(grip_x)]
            if (sample[3]<.99 or min(sample[:3])<.82
                    or np.max(np.abs(frame[round(grip_y),round(grip_x),:3]-sample[:3]))>.02):
                raise RuntimeError(f'Cat1 {clip}/{index}: fishing grip must be inside the visible original white palm')
            hand_transform=arm_pose['handTransform']
            alpha=frame[:,:,3]
            ys,xs=np.where(alpha>=24/255)
            bounds={"x":int(xs.min()),"y":int(ys.min()),"w":int(xs.max()-xs.min()+1),"h":int(ys.max()-ys.min()+1)}
            if min(bounds['x'],bounds['y'],SIZE-bounds['x']-bounds['w'],SIZE-bounds['y']-bounds['h'])<8:
                raise RuntimeError(f'Cat1 {clip}/{index}: arm pose touches frame edge')
            key=f"{clip}/{index:04d}"
            data=pixels_rgba(frame)
            write_rgba(output/"frames"/f"{key}.png",SIZE,SIZE,data)
            records.append({"key":key,"image":f"frames/{key}.png","sourceFrame":index,
                "durationMs":1000/18,"expression":expression,
                "handTransform":hand_transform,
                "arm":arm_rig.arm_metadata(arm_pose),
                "anchors":{"feet":point(body_feet_x,body_feet_y,SIZE,SIZE),"grip":point(grip_x,grip_y,SIZE,SIZE),"head":point(head_x,head_y,SIZE,SIZE)},
                "bounds":bounds,"palmCrop":{"x":grip_x-15,"y":grip_y-20,"w":30,"h":40}})
            images.append(data)
    hand_layer=arm_rig.export_hand(output/'hand.png',native_hand)
    hand_layer['overlayBounds']={'x':78,'y':107,'w':35,'h':31}
    atlases=[]
    for page,offset in enumerate(range(0,len(records),16)):
        entries=records[offset:offset+16];w=2048;h=math.ceil(len(entries)/4)*SIZE
        atlas=bytearray(w*h*4);metadata={};animations={}
        for local,(record,pixels) in enumerate(zip(entries,images[offset:offset+16])):
            x=(local%4)*SIZE;y=(local//4)*SIZE
            for row in range(SIZE):
                a=((y+row)*w+x)*4;b=row*SIZE*4
                atlas[a:a+SIZE*4]=pixels[b:b+SIZE*4]
            rect={"x":x,"y":y,"w":SIZE,"h":SIZE};record.update(page=page,frame=rect)
            metadata[record["key"]]={"frame":rect,"rotated":False,"trimmed":False,"spriteSourceSize":{"x":0,"y":0,"w":SIZE,"h":SIZE},"sourceSize":{"w":SIZE,"h":SIZE}}
            animations.setdefault(record["key"].split('/')[0],[]).append(record["key"])
        write_rgba(output/f"atlas-{page}.png",w,h,atlas)
        (output/f"atlas-{page}.json").write_text(json.dumps({"frames":metadata,"animations":animations,"meta":{"app":"local-sprite-pipeline","image":f"atlas-{page}.png","format":"RGBA8888","size":{"w":w,"h":h},"scale":"1"}},indent=2)+'\n')
        atlases.append({"page":page,"image":f"atlas-{page}.png","data":f"atlas-{page}.json","size":{"w":w,"h":h}})
    vector_source=json.loads((parts/'mode.json').read_text())["vector"]
    native_metadata=native_rig.metadata(landmarks,native_scale)
    native_metadata['sourcePart']='Gun: complete near arm, cuff and white paw'
    manifest={"format":"html5-sprite-asset-v1","id":"fishing-cat","name":"Mèo câu cá",
        "style":"authored-cat-cartoon","generatedFace":False,"frameSize":{"w":SIZE,"h":SIZE},"maxAtlasSize":2048,
        "anchorFacing":"right","view":{"type":"profile","cameraAxis":"left"},"pivot":records[0]["anchors"]["feet"],
        "actor":{"kind":"cat","species":"orange-tabby","weaponFree":True,"sourceCharacter":"Cat1"},
        "handLayer":hand_layer,"armRig":native_metadata,
        "thumbnail":"thumbnail.png","atlases":atlases,
        "animations":{clip:{"sourceAction":"Recomposed "+clip,"sourceRange":[0,count-1],"loop":clip in ("idle","bite"),"fps":18,"frames":[r for r in records if r['key'].startswith(clip+'/')]} for clip,count in clips.items()},
        "source":{"type":"provided-vector-parts" if vector_source else "provided-png-parts","folder":str(source.relative_to(ROOT)),"file":"Ai/Cat Characters/Char1 Parts.ai" if vector_source else "Spine/Characters/C1/Images",
            "parts":["Head","Body","Tails","complete original near arm, yellow cuff and white paw from Gun; weapon and far paw omitted"],"modification":"Complete native near arm at the original cream arm size; anatomical shoulder pivot and white palm grip, with source limb orientation, colors and outlines preserved; source files unchanged",
            "licenseFile":"../licenses/craftpix-cat-defense.txt","author":"Craftpix"}}
    (output/"manifest.json").write_text(json.dumps(manifest,indent=2)+'\n')
    shutil.copy2(output/'frames/idle/0000.png',output/'thumbnail.png')
    print(f'Packaged fishing-cat:{len(records)} frames,{len(clips)} clips, {SIZE}x{SIZE}, grip={records[0]["anchors"]["grip"]}',flush=True)


def main() -> None:
    from pipeline import find_blender,write_catalog,validate_output
    from tools.fishing_cat_roster import identity,annotate_identity
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',default=SOURCE)
    parser.add_argument('--output',default='build/work/cat-native-arm-primary')
    parser.add_argument('--only',help='Comma-separated character numbers (1..15) or fishing-cat IDs')
    parser.add_argument('--probe',action='store_true',help='Three pulling poses and one pose per other clip for review')
    args=parser.parse_args();source=(ROOT/args.source).resolve();output=(ROOT/args.output).resolve()
    if output==ROOT or output==ROOT/'dist' or (output.parent==ROOT and output.name.startswith('dist')):
        parser.error('Use an isolated output under build/work')
    numbers=list(range(1,16))
    if args.only:
        numbers=[]
        for value in args.only.split(','):
            value=value.strip().lower()
            try:number=1 if value=='fishing-cat' else int(value.removeprefix('fishing-cat-').removeprefix('cat'))
            except ValueError:parser.error(f'Unknown cat: {value}')
            if not 1<=number<=15:parser.error('Character numbers must be1..15')
            if number not in numbers:numbers.append(number)
    cache=output.parent/'cat-fishing-vector-parts';cache.mkdir(parents=True,exist_ok=True)
    swift_bin=shutil.which('swift') if sys.platform=='darwin' else None
    blender=find_blender()
    if not blender:parser.error('Blender is not installed; run pipeline.py setup')
    for number in numbers:
        parts=cache/f'C{number:02d}';parts.mkdir(parents=True,exist_ok=True)
        if swift_bin:
            swift=cache/'render-cat-parts.swift';swift.write_text(SWIFT)
            subprocess.run([swift_bin,'-module-cache-path','/private/tmp/fishing-cat-swift-cache',str(swift),str(source/f'Ai/Cat Characters/Char{number} Parts.ai'),str(parts)],check=True)
        else:
            parser.error('The complete costume roster needs CoreGraphics vector export on macOS')
        (parts/'mode.json').write_text(json.dumps({'vector':True,'scale':4})+'\n')
        if 1 <= number <= 5:
            from tools.orange_native_arm import separate_orange_pdf
            vector_parts=parts/'native-orange-vector'
            native_pdf=separate_orange_pdf(source/f'Ai/Cat Characters/Char{number} Parts.ai',vector_parts)
            raster=vector_parts/'native-arm';raster.mkdir(exist_ok=True)
            subprocess.run([swift_bin,'-module-cache-path','/private/tmp/fishing-cat-swift-cache',str(swift),str(native_pdf),str(raster),'5'],check=True)
            shutil.copy2(raster/'part-5.png',parts/'native-arm.png')
        if 6 <= number <= 10:
            from tools.native_cat_arm import separate_gray_pdf
            vector_parts=parts/'native-vector'
            separate_gray_pdf(source/f'Ai/Cat Characters/Char{number} Parts.ai',vector_parts)
            for stem,target in (('body-without-arm','native-body'),('native-arm','native-arm'),('body-front','native-front')):
                raster=vector_parts/stem;raster.mkdir(exist_ok=True)
                subprocess.run([swift_bin,'-module-cache-path','/private/tmp/fishing-cat-swift-cache',str(swift),str(vector_parts/f'{stem}.pdf'),str(raster),'2'],check=True)
                shutil.copy2(raster/'part-2.png',parts/f'{target}.png')
        if 11 <= number <= 15:
            from tools.white_native_arm import separate_white_pdf
            vector_parts=parts/'native-white-vector'
            native_pdf=separate_white_pdf(source/f'Ai/Cat Characters/Char{number} Parts.ai',vector_parts)
            raster=vector_parts/'native-arm';raster.mkdir(exist_ok=True)
            subprocess.run([swift_bin,'-module-cache-path','/private/tmp/fishing-cat-swift-cache',str(swift),str(native_pdf),str(raster),'5'],check=True)
            shutil.copy2(raster/'part-5.png',parts/'native-arm.png')
        folder=output/identity(number)['id']
        command=[str(blender),'--background','--factory-startup','--python-exit-code','1','--python',str(Path(__file__).resolve()),'--',str(folder),str(source),str(parts),str(number)]
        if args.probe:command.append('--probe')
        subprocess.run(command,check=True,cwd=ROOT)
        annotate_identity(folder/'manifest.json',number,args.probe)
    licenses=output/'licenses';licenses.mkdir(exist_ok=True)
    shutil.copy2(source/'license.txt',licenses/'craftpix-cat-defense.txt')
    write_catalog(output);validate_output(output)


if __name__=='__main__':
    if '--' in sys.argv:worker()
    else:main()
