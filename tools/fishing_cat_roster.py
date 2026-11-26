"""Profiles and source-part composition for the fifteen authored Craftpix cats."""
from __future__ import annotations
import json
import math
from pathlib import Path

OUTFITS = [
    ("basic", "Nguyên bản"), ("gray-cap", "Mũ xám"), ("teal-cap", "Mũ xanh ngọc"),
    ("pink-cap", "Mũ hồng"), ("orange-hood", "Áo trùm cam"),
    ("white-pants", "Quần trắng"), ("pirate-headwrap", "Khăn hải tặc"),
    ("blue-goggles", "Kính xanh, khăn đỏ"), ("gold-top-hat", "Mũ vàng, kính tròn"),
    ("red-beret", "Mũ đỏ, khăn xanh"), ("orange-collar", "Khăn cam"),
    ("purple-helmet", "Mũ tím"), ("blue-helmet", "Mũ xanh lam"),
    ("horned-helmet", "Mũ sừng vàng"), ("masked-helmet", "Mũ kính, mặt nạ"),
]


def identity(number):
    group = (number - 1) // 5
    family = ("orange-tabby", "gray-tabby", "white-cat")[group]
    label = ("Mèo cam", "Mèo xám", "Mèo trắng")[group]
    outfit_id, outfit_name = OUTFITS[number-1]
    return {"id": "fishing-cat" if number == 1 else f"fishing-cat-{number:02d}",
        "name": f"{label} · {outfit_name}", "actor": {"kind": "cat", "family": family,
        "familyName": label, "species": family, "sourceCharacter": f"Cat{number}", "weaponFree": True,
        "outfit": {"id": outfit_id, "name": outfit_name, "order": (number-1)%5+1}}}


def annotate_identity(path, number, probe=False):
    data=json.loads(path.read_text());data.update(identity(number))
    data['sampling']='probe' if probe else 'complete'
    path.write_text(json.dumps(data,indent=2,ensure_ascii=False)+"\n")


def write_hand_layer(output, hand, records, images, clip_to_baked=True):
    """Export visible native hand art without re-exposing a hidden upper arm."""
    import numpy as np
    from tools.package_boy import write_rgba
    hand=hand.copy();h,w=hand.shape[:2]
    if clip_to_baked:
        yy,xx=np.mgrid[:h,:w].astype(np.float32);u=xx+.5;v=yy+.5
        core=hand[:,:,3]>.98;visible=np.ones((h,w),bool)
        for record,data in zip(records,images):
            a,b,c,d,e,f=record['handTransform']
            x=a*u+c*v+e-.5;y=b*u+d*v+f-.5
            valid=(x>=0)&(y>=0)&(x<511)&(y<511)
            ix=np.clip(np.floor(x).astype(int),0,510);iy=np.clip(np.floor(y).astype(int),0,510)
            fx=np.clip(x-ix,0,1)[:,:,None];fy=np.clip(y-iy,0,1)[:,:,None]
            frame=np.frombuffer(data,dtype=np.uint8).reshape(512,512,4).astype(np.float32)/255
            sampled=(frame[iy,ix]*(1-fx)+frame[iy,ix+1]*fx)*(1-fy)+(frame[iy+1,ix]*(1-fx)+frame[iy+1,ix+1]*fx)*fy
            visible &= valid & (np.max(np.abs(sampled[:,:,:3]-hand[:,:,:3]),axis=2)<.12)
        hidden=core&~visible
        # Remove the antialiased fringe at a hidden proximal attachment too.
        fringe=hidden.copy()
        for oy,ox in ((0,1),(0,-1),(1,0),(-1,0)):
            fringe|=np.roll(np.roll(hidden,oy,0),ox,1)
        hand[:,:,3]*=~fringe
    # Transparent source RGB can contain weapon/clothing colors. Clear those
    # invisible channels in the standalone semantic layer, preserving its alpha.
    hand[:,:,:3][hand[:,:,3]<=.001]=0
    write_rgba(output/'hand.png',w,h,bytearray(np.clip(np.rint(hand*255),0,255).astype(np.uint8).tobytes()))


def compose(output, source, parts, number, probe=False):
    import bpy
    import numpy as np
    from tools.package_boy import write_rgba,point
    from tools import cat_arm_pose as arm_rig
    from tools import native_cat_arm as native_rig
    size=512;output.mkdir(parents=True,exist_ok=True)

    def load(path):
        image=bpy.data.images.load(str(path),check_existing=False);image.colorspace_settings.name="Non-Color"
        w,h=image.size;p=np.empty(w*h*4,dtype=np.float32);image.pixels.foreach_get(p);bpy.data.images.remove(image)
        return p.reshape(h,w,4)[::-1].copy()
    art={name:load(parts/f"part-{page}.png") for name,page in {"head":1,"body":2,"tail":4,"gun":5}.items()}
    if number in (9,10):art["hat"]=load(parts/"part-6.png")
    skeleton=json.loads((source/f"Json Atlas/Cat Characters/Cat{number}/Character{number}.json").read_text())
    bones={}
    for b in skeleton["bones"]:
        parent=bones.get(b.get("parent"),(0,0,0));angle=parent[2]
        bones[b["name"]]=(parent[0]+math.cos(angle)*b.get("x",0)-math.sin(angle)*b.get("y",0),
            parent[1]+math.sin(angle)*b.get("x",0)+math.cos(angle)*b.get("y",0),angle+math.radians(b.get("rotation",0)))
    attachments=skeleton["skins"][0]["attachments"]
    slots={s["name"]:s["bone"] for s in skeleton["slots"]}
    def setup(name):
        a=attachments[name][name];b=bones[slots[name]]
        return (b[0]+math.cos(b[2])*a.get("x",0)-math.sin(b[2])*a.get("y",0),
            b[1]+math.sin(b[2])*a.get("x",0)+math.cos(b[2])*a.get("y",0))
    bx,by=setup("Body")
    position={name:((setup(label)[0]-bx)*4,-(setup(label)[1]-by)*4)
        for name,label in (("head","Head"),("body","Body"),("tail","Tails"))}
    if "hat" in art:position["hat"]=((setup("Hat")[0]-bx)*4,-(setup("Hat")[1]-by)*4)
    # Retain complete native limbs: gray's bent arm/paw is in Body; orange and
    # white forearm/cuff/paw groups are separated from their weapon vectors.
    gun=art.pop("gun");gh,gw=gun.shape[:2]
    if number<=5:
        # The cream L is the arm, not a palm: retain its original yellow cuff
        # and closed white near paw from the same vector weapon layer.
        art['paw']=load(parts/'native-arm.png')
        if art['paw'].shape[:2] != (161,235):
            raise RuntimeError(f'Cat{number} requires its complete native arm/cuff/paw artboard')
        gun_center=setup('Gun')
        position['paw']=((gun_center[0]-bx)*4,-(gun_center[1]-by)*4)
    elif number>=11:
        art['paw']=load(parts/'native-arm.png')
        if art['paw'].shape[:2] != (161,351):
            raise RuntimeError(f'Cat{number} requires its complete native exposed forearm/cuff/paw artboard')
        gun_center=setup('Gun')
        position['paw']=((gun_center[0]-bx)*4,-(gun_center[1]-by)*4)
    native_mode=True
    if 6<=number<=10:
        from tools.gray_native_arm import gray_arm_profile
        gray_profile=gray_arm_profile(number)
        art['body']=load(parts/'native-body.png')
        art['body_front']=load(parts/'native-front.png')
        native_hand=load(parts/'native-arm.png')
        if native_hand.shape[:2] != (gray_profile['nativeSize']['h'],gray_profile['nativeSize']['w']):
            raise RuntimeError(f'Cat{number}: native Body arm artboard dimensions changed')
        landmarks=gray_profile['landmarks']
        overlay_bounds=gray_profile['overlayBounds']
    else:
        native_hand=art['paw']
        hh,ww=native_hand.shape[:2]
        if number<=5:
            landmarks={'shoulder':(35.,66.),'elbow':(26.,110.),'wrist':(70.,124.),'grip':(96.,119.)}
            overlay_bounds={'x':72,'y':90,'w':55,'h':56}
        else:
            # The weapon hid the long upper arm. Pivot only the exposed native
            # forearm from its actual attachment root; do not invent a limb.
            landmarks={'shoulder':(66.,88.),'elbow':(70.,100.),'wrist':(91.,101.),'grip':(130.,103.)}
            overlay_bounds={'x':110,'y':98,'w':42,'h':22}
    closed_hand={'pixels':native_hand,'wrist':landmarks['wrist'],'grip':landmarks['grip']}
    # All coordinates below are per-head vector artboard landmarks. Accessories
    # are retained, including opaque goggles, moustache and C15's face mask.
    mouth={2:(213,239),3:(298,274),4:(277,284),5:(290,282),
        6:(287,184),7:(287,184),8:(287,184),9:(287,184),10:(286,245),
        11:(203,255),12:(216,262),13:(213,255),14:(228,291)}
    orange_eyes={2:((159,204),(259,204)),3:((245,240),(344,240)),
        4:((224,246),(323,246)),5:((236,247),(337,247))}

    # Restore exposed white-family eyes in their actual face windows. Helmets
    # and C15's diagonal mask are outside this mask and remain byte-for-byte art.
    clean_white=None;white_visible=None;white_eyes=None
    if number>=11:
        head=art['head'];hh,ww=head.shape[:2];wy,wx=np.mgrid[:hh,:ww].astype(np.float32)
        dx,dy={11:(0,0),12:(13,7),13:(10,0),14:(25,36),15:(63,23)}[number]
        white_eyes=((143+dx,225+dy),(255+dx,193+dy))
        def polygon(points):
            inside=np.zeros((hh,ww),bool)
            for (ax,ay),(bx,by) in zip(points,points[1:]+points[:1]):
                inside^=((ay>wy)!=(by>wy))&(wx<(bx-ax)*(wy-ay)/(by-ay if by!=ay else 1e-5)+ax)
            return inside
        left_eye=[(65,185),(181,211),(191,237),(155,263),(94,261),(72,237)]
        right_eye=[(202,207),(294,144),(299,186),(277,221),(239,233),(207,222)]
        mask=polygon([(x+dx,y+dy) for x,y in left_eye])|polygon([(x+dx,y+dy) for x,y in right_eye])
        white_visible=np.ones((hh,ww),bool)
        if number>=12:
            x0,y0,x1,y1={12:(91,209,296,145),13:(90,203,281,139),14:(105,234,303,175),15:(144,222,335,157)}[number]
            white_visible &= wy>y0+(wx-x0)*(y1-y0)/(x1-x0)+4
            white_visible &= wx>x0+np.maximum(0,wy-y0)*.27+3
        if number==15:white_visible &= wy<309.2-wx*.236-4
        mask &= white_visible
        if number!=15:
            # Exact source nose and its dark outline remain untouched.
            mask &= ~((wx>=180+dx)&(wx<=214+dx)&(wy>=219+dy)&(wy<=244+dy))
        # Local diffusion followed by the exact source fur palette reconstructs
        # the white/gray markings, removing aggressive brows as well as pupils.
        work=head[:,:,:3].copy();work[mask]=np.array([.80,.80,.80])
        for _ in range(150):
            average=(np.roll(work,1,0)+np.roll(work,-1,0)+np.roll(work,1,1)+np.roll(work,-1,1))*.25
            work[mask]=average[mask]
        palette=np.array([[1,1,1],[.8,.8,.8],[.64,.59,.60],[.52,.46,.47]],np.float32)
        values=work[mask];nearest=((values[:,None,:]-palette[None,:,:])**2).sum(axis=2).argmin(axis=1)
        clean_white=head.copy();clean_white[:,:,:3][mask]=palette[nearest]

    def face(expression,gaze=0):
        image=(clean_white if clean_white is not None else art["head"]).copy();h,w=image.shape[:2];yy,xx=np.mgrid[:h,:w].astype(np.float32)
        if 11<=number<=14:
            dx,dy={11:(0,0),12:(13,7),13:(10,0),14:(25,36)}[number]
            # Eye reconstruction must not change the authored white muzzle
            # boundary beside the nose. Restore its original pixels first;
            # only the warm mouth ink is removed below.
            image[236+dy:280+dy,170+dx:246+dx]=art['head'][236+dy:280+dy,170+dx:246+dx]
        ink=np.array([73,30,27],np.float32)/255
        def source_ink():
            original=art['head'];r,g,b=original[:,:,0],original[:,:,1],original[:,:,2]
            seed=(r<.70)&(r-g>.10)&(r-b>.08)
            # Include just the two-pixel antialiased fringe around warm ink.
            # Neutral fur markings are never selected as restoration seeds.
            grown=seed.copy()
            for oy,ox in ((0,1),(0,-1),(1,0),(-1,0),(1,1),(1,-1),(-1,1),(-1,-1),(0,2),(0,-2),(2,0),(-2,0)):
                grown|=np.roll(np.roll(seed,oy,0),ox,1)
            return grown
        draw_clip=None
        def paint(mask,color):
            if draw_clip is not None:mask=mask*draw_clip
            a=np.clip(mask,0,1)[:,:,None];image[:,:,:3]=image[:,:,:3]*(1-a)+np.asarray(color)*a
        def ellipse(cx,cy,rx,ry,color):paint((1-np.sqrt(((xx+.5-cx)/rx)**2+((yy+.5-cy)/ry)**2))*min(rx,ry)+.5,color)
        def stroke(points,width,color):
            distance=np.full((h,w),1e6,np.float32)
            for (ax,ay),(bx,by) in zip(points,points[1:]):
                dx,dy=bx-ax,by-ay;t=np.clip(((xx-ax)*dx+(yy-ay)*dy)/max(dx*dx+dy*dy,.001),0,1)
                distance=np.minimum(distance,np.sqrt((xx-ax-t*dx)**2+(yy-ay-t*dy)**2))
            paint(width/2+.5-distance,color)
        def curve(a,b,c):return [((1-t)**2*a[0]+2*(1-t)*t*b[0]+t*t*c[0],(1-t)**2*a[1]+2*(1-t)*t*b[1]+t*t*c[1]) for t in np.linspace(0,1,25)]
        if number in orange_eyes:
            for cx,cy in orange_eyes[number]:
                if expression=="alert":
                    ellipse(cx,cy,35,27,ink);ellipse(cx,cy,31,23,[1,.969,.894])
                    ellipse(cx-3+gaze,cy+2,10,13,ink);ellipse(cx-6+gaze,cy-4,3,4,[1,1,.97])
                else:
                    fur=image[min(h-1,int(cy+24)),int(cx),:3].copy()
                    # Source eyelids lie below every cap's preserved lower rim.
                    patch=np.minimum.reduce([xx-(cx-34),(cx+34)-xx,yy-(cy-17),(cy+13)-yy])
                    # Restore only the source ink, preserving cream brow marks,
                    # cheek stripes and cap edges around the original eyelid.
                    paint(np.clip(patch+.5,0,1)*source_ink(),fur)
                    bend=-20 if expression=="happy" else 7
                    stroke(curve((cx-24,cy+3),(cx,cy+bend),(cx+24,cy+3)),6,ink)
        if white_eyes:
            draw_clip=white_visible
            for cx,cy in white_eyes:
                if expression=='alert':
                    ellipse(cx,cy,36,31,ink);ellipse(cx,cy,32,27,[1,.969,.894])
                    ellipse(cx-2+gaze,cy+2,10,15,ink);ellipse(cx-5+gaze,cy-5,3.5,4.5,[1,1,.97])
                elif expression=='happy':
                    stroke(curve((cx-24,cy+3),(cx,cy-21),(cx+24,cy+3)),6,ink)
                else:
                    ellipse(cx,cy+3,29,18,ink);ellipse(cx,cy+3,25,14,[1,.969,.894])
                    ellipse(cx,cy+7,8,9,ink)
                    stroke(curve((cx-25,cy-13),(cx,cy-21),(cx+23,cy-13)),4,ink)
            draw_clip=None
            if number==15:return image
        cx,cy=mouth[number]
        sample_y=min(h-1,int(cy+16));skin=image[sample_y,int(cx),:3].copy()
        # Masked-eye characters react through their uncovered muzzle; their
        # authored goggles, eye patch/headwrap and moustache are never erased.
        patch=np.minimum.reduce([xx-(cx-42),(cx+42)-xx,yy-(cy-(28 if number>=11 else 14)),(cy+17)-yy])
        if number!=10:
            # Replace old mouth ink rather than a rectangular skin patch. The
            # original moustached cat has no exposed mouth to erase at all.
            mask=np.clip(patch+.5,0,1)*source_ink()
            if number>=11:
                dx,dy={11:(0,0),12:(13,7),13:(10,0),14:(25,36)}[number]
                mask*=~((xx>=180+dx)&(xx<=214+dx)&(yy>=219+dy)&(yy<=244+dy))
                # The old curls cross the white/gray fur boundary. Reconstruct
                # only their ink pixels from neighboring fur instead of filling
                # the entire stroke with one white color.
                selected=mask>.5;work=image[:,:,:3].copy();work[selected]=skin
                for _ in range(48):
                    average=(np.roll(work,1,0)+np.roll(work,-1,0)+np.roll(work,1,1)+np.roll(work,-1,1))*.25
                    work[selected]=average[selected]
                image[:,:,:3][selected]=work[selected]
            else:paint(mask,skin)
        if expression=="alert":
            ellipse(cx,cy+2,10,13,ink);ellipse(cx,cy+4,5,6,[.74,.29,.24])
        elif expression=="happy":
            smile=np.clip((1-np.sqrt(((xx-cx)/22)**2+((yy-cy)/16)**2))*16+.5,0,1)*np.clip(yy-cy+7,0,1)
            paint(smile,ink)
            tongue=np.clip((1-np.sqrt(((xx-cx)/11)**2+((yy-cy-10)/5)**2))*5+.5,0,1)
            paint(tongue*smile,[.97,.52,.43])
        else:stroke(curve((cx-14,cy+9),(cx,cy-8),(cx+14,cy+9)),4.5,ink)
        return image
    art["happy"]=face("happy");art["sad"]=face("sad")
    # Normalize the whole authored costume as one assembly. Large caps/hoods
    # keep their source proportions instead of shrinking the face alone.
    boxes=[]
    for name,(x,y) in position.items():
        h,w=art[name].shape[:2]
        if name=='paw' and number<=5:
            # Keep the accepted body/head framing; a full transparent Gun
            # artboard must not rescale the costume when its native arm moves.
            x,y,w,h=112,7,57,89
        elif name=='paw' and number>=11:
            x,y,w,h=110,30,84,81
        boxes.append((x-w/2,y-h/2,x+w/2,y+h/2))
    left=min(b[0] for b in boxes)-30;right=max(b[2] for b in boxes)+30
    top=min(b[1] for b in boxes)-30;bottom=max(b[3] for b in boxes)+24
    scale=min(464/(right-left),464/(bottom-top));offset=(256-(left+right)/2*scale,256-(top+bottom)/2*scale)
    gy,gx=np.mgrid[:size,:size].astype(np.float32)
    def composite(canvas,name,x,y,angle=0,stretch=1):
        image=art[name];h,w=image.shape[:2];cx=x*scale+offset[0];cy=y*scale+offset[1]
        dx=(gx+.5-cx)/scale;dy=(gy+.5-cy)/scale;c=math.cos(angle);s=math.sin(angle)
        sx=c*dx+s*dy+w/2-.5;sy=(-s*dx+c*dy)/stretch+h/2-.5
        valid=(sx>=0)&(sy>=0)&(sx<w-1)&(sy<h-1)
        ix=np.clip(sx.astype(int),0,w-2);iy=np.clip(sy.astype(int),0,h-2)
        fx=np.clip(sx-ix,0,1)[:,:,None];fy=np.clip(sy-iy,0,1)[:,:,None]
        p=image.copy();p[:,:,:3]*=p[:,:,3:4]
        pixels=(p[iy,ix]*(1-fx)+p[iy,ix+1]*fx)*(1-fy)+(p[iy+1,ix]*(1-fx)+p[iy+1,ix+1]*fx)*fy
        pixels*=valid[:,:,None];canvas[:]=pixels+canvas*(1-pixels[:,:,3:4]);return pixels
    records=[];images=[];clips=arm_rig.CLIP_COUNTS
    body_h=art["body"].shape[0]
    for clip,count in clips.items():
        (output/"frames"/clip).mkdir(parents=True,exist_ok=True)
        indices=(([0,19,39] if clip=='pull' else [{"idle":0,"bite":0,"celebrate":10,"miss":12}[clip]]) if probe else range(count))
        for index in indices:
            phase=index/count if clip in ("idle","bite") else index/(count-1)
            breath=.5-.5*math.cos(phase*math.tau);progress=phase*phase*(3-2*phase) if clip=="pull" else 0
            wind=math.sin(math.pi*min(1,phase/.3)) if clip=="pull" else 0
            squash=1-.055*breath if clip=="idle" else 1-.035*wind
            hx,hy=position["head"];hx+=progress*8;hy=hy*squash+wind*8-progress*4
            px,py=position.get("paw",(0,0));px+=progress*20;py-=progress*22-wind*8
            pa=-progress*.16;ha=-progress*.035;ta=-.22*breath+progress*.15;tail_drop=0
            head_name="head";expression="calm"
            if clip=="bite":
                pulse=math.sin(phase*math.tau);squash=1-.018*breath
                hx=position["head"][0]+2*pulse;hy=position["head"][1]*squash-3*breath
                ha=.014*pulse;ta=.13*pulse;px,py=position.get("paw",(0,0));py-=2*breath;pa=.012*pulse
                art["alert"]=face("alert",1.5*pulse);head_name="alert";expression="alert"
            elif clip=="celebrate":
                progress=1-phase*phase*(3-2*phase);envelope=math.sin(math.pi*phase)
                wiggle=math.sin(phase*math.tau*3)*envelope;bounce=(.5-.5*math.cos(phase*math.tau*3))*envelope
                squash=1-.045*bounce;hx=position["head"][0]+8*progress+2*wiggle
                hy=position["head"][1]*squash-4*progress-7*bounce;ha=-.035*progress+.035*wiggle
                px,py=position.get("paw",(0,0));px+=20*progress+3*wiggle;py-=22*progress+7*bounce
                pa=-.16*progress+.035*wiggle;ta=.15*progress+.24*math.sin(phase*math.tau*4)*envelope
                head_name="happy" if index<count-1 else "head";expression="happy" if index<count-1 else "calm"
            elif clip=="miss":
                slump=math.sin(math.pi*phase)**.8;squash=1-.045*slump
                hx=position["head"][0]-4*slump;hy=position["head"][1]*squash+10*slump;ha=-.03*slump
                px,py=position.get("paw",(0,0));px-=1.5*slump;py+=7*slump;pa=.045*slump;ta=-.32*slump;tail_drop=3*slump
                head_name="sad" if index<count-1 else "head";expression="disappointed" if index<count-1 else "calm"
            body_y=(1-squash)*body_h/2;hy+=body_y
            canvas=np.zeros((size,size,4),np.float32)
            tx,ty=position["tail"];composite(canvas,"tail",tx,ty+tail_drop,ta)
            if "hat" in art:
                dx=position["hat"][0]-position["head"][0];dy=position["hat"][1]-position["head"][1]
                composite(canvas,"hat",hx+math.cos(ha)*dx-math.sin(ha)*dy,hy+math.sin(ha)*dx+math.cos(ha)*dy,ha)
            sh=landmarks['shoulder']
            if 6<=number<=10:
                bh,bw=art['body'].shape[:2]
                shoulder_raw=(sh[0]-bw/2,sh[1]-bh/2)
                shoulder=(shoulder_raw[0]*scale+offset[0],(shoulder_raw[1]*squash+body_y)*scale+offset[1])
            else:
                ph,pw=native_hand.shape[:2];base_x,base_y=position['paw']
                shoulder_raw=(base_x+sh[0]-pw/2,base_y+sh[1]-ph/2)
                shoulder=(shoulder_raw[0]*scale+offset[0],(shoulder_raw[1]+body_y)*scale+offset[1])
            arm_pose=native_rig.pose(landmarks,shoulder,scale,clip,phase,motion_sign=-1. if number<=5 or number>=11 else 1.)
            body=composite(canvas,"body",0,body_y,stretch=squash)
            paw_pixels=arm_rig.draw_hand(canvas,arm_pose,closed_hand)
            if 'body_front' in art:composite(canvas,'body_front',0,body_y,stretch=squash)
            composite(canvas,head_name,hx,hy,ha)
            fy,fx=np.where(body[:,:,3]>=24/255);feet_y=float(fy.max()+1);sole=fx[fy>=feet_y-4]
            feet_x=float((sole.min()+sole.max())/2)
            grip_x,grip_y=arm_pose['grip']['x'],arm_pose['grip']['y']
            if number<=5 or number>=11:
                ix,iy=round(grip_x),round(grip_y);sample=paw_pixels[iy,ix]
                if (sample[3]<.99 or min(sample[:3])<.82
                        or np.max(np.abs(canvas[iy,ix,:3]-sample[:3]))>.02):
                    raise RuntimeError(f"Cat{number} {clip}/{index}: grip is not its visible native white glove")
            else:
                ix,iy=round(grip_x),round(grip_y);sample=paw_pixels[iy,ix]
                expected=np.asarray(gray_profile['gripRGBA'][:3],np.float32)/255
                if (sample[3]<.99 or np.max(np.abs(sample[:3]-expected))>.04
                        or np.max(np.abs(canvas[iy,ix,:3]-sample[:3]))>.02):
                    raise RuntimeError(f'Cat{number} {clip}/{index}: grip must remain on the visible original gray paw')
            hand_transform=arm_pose['handTransform']
            ys,xs=np.where(canvas[:,:,3]>=24/255)
            bounds={"x":int(xs.min()),"y":int(ys.min()),"w":int(xs.max()-xs.min()+1),"h":int(ys.max()-ys.min()+1)}
            if min(bounds['x'],bounds['y'],size-bounds['x']-bounds['w'],size-bounds['y']-bounds['h'])<8:
                raise RuntimeError(f'Cat{number} {clip}/{index}: arm pose touches frame edge')
            rgba=canvas.copy();rgba[:,:,:3]=np.divide(rgba[:,:,:3],rgba[:,:,3:4],out=np.zeros_like(rgba[:,:,:3]),where=rgba[:,:,3:4]>1e-6)
            pixels=bytearray(np.clip(np.rint(rgba*255),0,255).astype(np.uint8).tobytes());key=f"{clip}/{index:04d}"
            write_rgba(output/"frames"/f"{key}.png",size,size,pixels)
            records.append({"key":key,"image":f"frames/{key}.png","sourceFrame":index,"durationMs":1000/18,
                "expression":expression,"bounds":bounds,"anchors":{"feet":point(feet_x,feet_y,size,size),
                "grip":point(grip_x,grip_y,size,size),"head":point(hx*scale+offset[0],hy*scale+offset[1],size,size)},
                "palmCrop":{"x":grip_x-11,"y":grip_y-13,"w":22,"h":26},"handTransform":hand_transform,
                "arm":arm_rig.arm_metadata(arm_pose)});images.append(pixels)
    hand_layer=arm_rig.export_hand(output/'hand.png',closed_hand)
    hand_layer['overlayBounds']=overlay_bounds
    atlases=[]
    for page,start in enumerate(range(0,len(records),16)):
        batch=records[start:start+16];w=2048;h=math.ceil(len(batch)/4)*size;pixels=bytearray(w*h*4);metadata={};animations={}
        for local,(record,data) in enumerate(zip(batch,images[start:start+16])):
            x=local%4*size;y=local//4*size
            for row in range(size):a=((y+row)*w+x)*4;b=row*size*4;pixels[a:a+size*4]=data[b:b+size*4]
            rect={"x":x,"y":y,"w":size,"h":size};record.update(page=page,frame=rect)
            metadata[record["key"]]={"frame":rect,"rotated":False,"trimmed":False,"spriteSourceSize":{"x":0,"y":0,"w":size,"h":size},"sourceSize":{"w":size,"h":size}}
            animations.setdefault(record["key"].split('/')[0],[]).append(record["key"])
        write_rgba(output/f"atlas-{page}.png",w,h,pixels)
        (output/f"atlas-{page}.json").write_text(json.dumps({"frames":metadata,"animations":animations,"meta":{"app":"local-sprite-pipeline","image":f"atlas-{page}.png","format":"RGBA8888","size":{"w":w,"h":h},"scale":"1"}},indent=2)+'\n')
        atlases.append({"page":page,"image":f"atlas-{page}.png","data":f"atlas-{page}.json","size":{"w":w,"h":h}})
    rig_metadata=native_rig.metadata(landmarks,scale)
    rig_metadata['nativePoints']={k:{'x':v[0],'y':v[1]} for k,v in landmarks.items()}
    rig_metadata['sourcePart']=("Gun: complete near arm, yellow cuff and white paw" if number<=5 else
        gray_profile['sourcePart'] if number<=10 else "Gun: original exposed near forearm, yellow cuff and white paw")
    if number>=11:
        rig_metadata['landmarkMeaning']={
            'shoulder':'Visible native forearm attachment root; the original weapon hid the upper shoulder',
            'elbow':'Bend in the short authored exposed forearm',
            'wrist':'Original yellow cuff', 'grip':'Original white palm interior'}
    manifest={"format":"html5-sprite-asset-v1",**identity(number),"style":"authored-cat-cartoon","generatedFace":False,
        "frameSize":{"w":size,"h":size},"maxAtlasSize":2048,"anchorFacing":"right","view":{"type":"profile","cameraAxis":"left"},
        "pivot":records[0]["anchors"]["feet"],"thumbnail":"thumbnail.png","atlases":atlases,
        "handLayer":hand_layer,"armRig":rig_metadata,
        "animations":{c:{"sourceAction":"Recomposed "+c,"sourceRange":[0,n-1],"loop":c in ("idle","bite"),"fps":18,"frames":[r for r in records if r['key'].startswith(c+'/')]} for c,n in clips.items()},
        "source":{"type":"provided-vector-parts","folder":str(source.relative_to(Path(__file__).resolve().parents[1])),
        "file":f"Ai/Cat Characters/Char{number} Parts.ai","author":"Craftpix","licenseFile":"../licenses/craftpix-cat-defense.txt",
        "parts":["Head","Body","Tails"]+(["Hat"] if number in (9,10) else [])+(["original complete cream arm, yellow cuff and white near paw from Gun; weapon and far paw omitted"] if number<=5 else ["native Body arm vector separated once from original torso; Gun omitted"] if number<=10 else ["original exposed forearm, yellow cuff and white near paw from Gun; weapon and far paw omitted"]),
        "modification":"Original vector costume and native arm size preserved; original bent arm rigidly rotates independently of torso; accessory-safe facial reactions; source files unchanged",
        "expressionMethod":"exposed-eye accents and pose; original mask preserved" if number==15 else "per-character facial landmarks; original accessories preserved"},"sampling":"probe" if probe else "complete"}
    (output/"manifest.json").write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n')
    (output/"thumbnail.png").write_bytes((output/records[0]["image"]).read_bytes())
    print(f'Packaged {manifest["id"]}: {len(records)} frames',flush=True)
