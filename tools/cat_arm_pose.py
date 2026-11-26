"""Shared baked shoulder/elbow/wrist animation in 512px frame coordinates."""
from __future__ import annotations
import math

REST_HAND_ANGLE=-2.94
CLIP_COUNTS={"idle":12,"pull":40,"bite":12,"celebrate":24,"miss":24}
INK="3B171B"


def rgba(color):
    return tuple(int(color[i:i+2],16)/255 for i in (0,2,4))+(1.,)


def make_hand(pixels,wrist,grip,scale=.62):
    """Keep complete native RGBA art and its distinct pixel-edge landmarks."""
    return {"pixels":pixels.copy(),"wrist":tuple(wrist),"grip":tuple(grip),"scale":float(scale)}


def extract_white_hand(image,box):
    """Isolate the authored closed white glove, including its warm ink border."""
    import numpy as np
    x0,y0,x1,y1=box;p=image[y0:y1,x0:x1].copy()
    white=(p[:,:,:3].min(axis=2)>.80)&(p[:,:,3]>.8)
    seen=np.zeros_like(white);largest=[]
    for sy,sx in zip(*np.where(white)):
        if seen[sy,sx]:continue
        stack=[(int(sy),int(sx))];seen[sy,sx]=True;component=[]
        while stack:
            y,x=stack.pop();component.append((y,x))
            for yy,xx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
                if 0<=yy<white.shape[0] and 0<=xx<white.shape[1] and white[yy,xx] and not seen[yy,xx]:
                    seen[yy,xx]=True;stack.append((yy,xx))
        if len(component)>len(largest):largest=component
    if not largest:raise RuntimeError("No source white glove was found")
    core=np.zeros_like(white)
    for y,x in largest:core[y,x]=True
    mask=core.copy()
    for oy in range(-5,6):
        for ox in range(-5,6):
            if ox*ox+oy*oy<=25:mask|=np.roll(np.roll(core,oy,0),ox,1)
    rgb=p[:,:,:3];neutral=rgb.max(axis=2)-rgb.min(axis=2)<.20
    ink=(rgb[:,:,0]<.42)&(rgb[:,:,1]<.28)&(rgb[:,:,2]<.28)
    p[:,:,3]*=mask&(neutral|ink)
    ys,xs=np.where(p[:,:,3]>.02);left=max(0,int(xs.min())-2);right=min(p.shape[1],int(xs.max())+3)
    top=max(0,int(ys.min())-2);bottom=min(p.shape[0],int(ys.max())+3)
    p=p[top:bottom,left:right].copy();core=core[top:bottom,left:right]
    ys,xs=np.where(core);grip=(float(xs.mean()+.5),float(ys.mean()+.5))
    # A lower-right point inside the closed glove gives a real wrist seam;
    # the palm extends toward the water, independently of forearm rotation.
    target_y=float(np.quantile(ys,.78));band=np.abs(ys-target_y)<3
    candidates=np.where(band)[0];index=max(candidates,key=lambda i:xs[i])
    wrist=(float(xs[index]+.5),float(ys[index]+.5))
    return make_hand(p,wrist,grip)


def make_closed_paw(fur_hex="75686E",scale=.62):
    """Small code-native closed paw for source characters lacking a hand part."""
    import numpy as np
    y,x=np.mgrid[:64,:64].astype(np.float32);p=np.zeros((64,64,4),np.float32)
    # A round palm and tucked thumb form a closed grasp, with a wrist opening
    # on the lower-right. Colors/ink match the supplied cat vector art.
    def oval(cx,cy,rx,ry):return (1-np.sqrt(((x+.5-cx)/rx)**2+((y+.5-cy)/ry)**2))*min(rx,ry)
    distance=np.maximum(oval(28,28,23,22),oval(44,42,14,13))
    def paint(mask,color):
        a=np.clip(mask+.5,0,1)[:,:,None];value=np.array(color,np.float32);premult=np.concatenate((a*value[:3],a),axis=2)
        p[:]=premult+p*(1-a)
    paint(distance,rgba(INK));paint(distance-3.2,rgba(fur_hex))
    # Gentle finger divisions make the shaft read as held by a closed paw.
    color=rgba(INK)
    for cy in (20,29):
        segment=((x-13)/9)**2+((y-cy)/1.1)**2
        paint(np.minimum(1-segment,1),color)
    alpha=p[:,:,3:4];p[:,:,:3]=np.divide(p[:,:,:3],alpha,out=np.zeros_like(p[:,:,:3]),where=alpha>1e-6)
    return make_hand(p,(49.5,46.5),(27.5,28.5),scale)


def solve_arm(shoulder,scale,clip,phase,hand):
    """Solve a connected constant-length two-bone chain; angles are radians."""
    phase=max(0.,min(1.,float(phase)));scale=float(scale)
    p=phase*phase*(3-2*phase) if clip=="pull" else 0.
    wind=math.sin(math.pi*min(1.,phase/.22)) if clip=="pull" else 0.
    bounce=0.;wiggle=0.;slump=0.
    if clip=="celebrate":
        p=1-phase*phase*(3-2*phase);envelope=math.sin(math.pi*phase)
        bounce=(.5-.5*math.cos(phase*math.tau*2))*envelope
        wiggle=math.sin(phase*math.tau*2)*envelope
    elif clip=="miss":slump=math.sin(math.pi*phase)**.8
    dx=(-78+24*p-5*wind+2*wiggle)*scale
    dy=(42-58*p+5*wind-4*bounce+3*slump)*scale
    if clip=="biting" or clip=="bite":dy+=math.sin(phase*math.tau)*1.5*scale
    l1,l2=52*scale,56*scale;distance=math.hypot(dx,dy)
    distance=max(abs(l1-l2)+.001,min(l1+l2-.001,distance))
    direction=math.atan2(dy,dx);bend=math.acos(max(-1.,min(1.,(l1*l1+distance*distance-l2*l2)/(2*l1*distance))))
    sx,sy=map(float,shoulder);upper=direction-bend
    ex,ey=sx+l1*math.cos(upper),sy+l1*math.sin(upper)
    wx,wy=sx+math.cos(direction)*distance,sy+math.sin(direction)*distance
    forearm=math.atan2(wy-ey,wx-ex)
    angle=REST_HAND_ANGLE-.10*p+.018*wiggle
    if clip=="idle":angle+=.012*math.sin(phase*math.tau)
    if clip in ("bite","biting"):angle+=.018*math.sin(phase*math.tau)
    uw,vw=hand['wrist'];ug,vg=hand['grip']
    native_angle=math.atan2(vg-vw,ug-uw);rotation=angle-native_angle
    factor=scale*hand['scale'];a=math.cos(rotation)*factor;b=math.sin(rotation)*factor
    c=-math.sin(rotation)*factor;d=math.cos(rotation)*factor;e=wx-a*uw-c*vw;f=wy-b*uw-d*vw
    grip={"x":a*ug+c*vg+e,"y":b*ug+d*vg+f}
    return {"shoulder":{"x":sx,"y":sy},"elbow":{"x":ex,"y":ey},"wrist":{"x":wx,"y":wy},"grip":grip,
        "upperAngle":math.atan2(ey-sy,ex-sx),"forearmAngle":forearm,"handAngle":angle,
        "handTransform":[a,b,c,d,e,f],"lengths":{"upper":l1,"forearm":l2},"scale":scale}


def arm_metadata(pose):
    return {key:pose[key] for key in ('shoulder','elbow','wrist','grip','upperAngle','forearmAngle','handAngle')}


def draw_hand(canvas,pose,hand):
    import numpy as np
    p=hand['pixels'];h,w=p.shape[:2];a,b,c,d,e,f=pose['handTransform'];det=a*d-b*c
    corners=[(a*x+c*y+e,b*x+d*y+f) for x in (0,w) for y in (0,h)]
    left=max(0,int(math.floor(min(x for x,y in corners)))-2);right=min(canvas.shape[1],int(math.ceil(max(x for x,y in corners)))+2)
    top=max(0,int(math.floor(min(y for x,y in corners)))-2);bottom=min(canvas.shape[0],int(math.ceil(max(y for x,y in corners)))+2)
    result=np.zeros_like(canvas)
    if right<=left or bottom<=top:return result
    yy,xx=np.mgrid[top:bottom,left:right].astype(np.float32);dx=xx+.5-e;dy=yy+.5-f
    u=(d*dx-c*dy)/det-.5;v=(-b*dx+a*dy)/det-.5
    valid=(u>=0)&(v>=0)&(u<w-1)&(v<h-1)
    ix=np.clip(np.floor(u).astype(int),0,w-2);iy=np.clip(np.floor(v).astype(int),0,h-2)
    fx=np.clip(u-ix,0,1)[:,:,None];fy=np.clip(v-iy,0,1)[:,:,None]
    source=p.copy();source[:,:,:3]*=source[:,:,3:4]
    value=(source[iy,ix]*(1-fx)+source[iy,ix+1]*fx)*(1-fy)+(source[iy+1,ix]*(1-fx)+source[iy+1,ix+1]*fx)*fy
    value*=valid[:,:,None];result[top:bottom,left:right]=value
    canvas[top:bottom,left:right]=value+canvas[top:bottom,left:right]*(1-value[:,:,3:4])
    return result


def draw_arm(canvas,pose,hand,fur_hex="F1BF8C",draw_hand_part=True,part="both",**kwargs):
    """Paint rounded connected segments, optionally followed by the native paw."""
    import numpy as np
    if 'draw_hand' in kwargs:draw_hand_part=kwargs['draw_hand']
    points=[pose[key] for key in ('shoulder','elbow','wrist')];radius=14*pose['scale']
    selected=points[:2] if part=='upper' else points[1:] if part=='forearm' else points
    left=max(0,int(min(p['x'] for p in selected)-radius-2));right=min(canvas.shape[1],int(max(p['x'] for p in selected)+radius+3))
    top=max(0,int(min(p['y'] for p in selected)-radius-2));bottom=min(canvas.shape[0],int(max(p['y'] for p in selected)+radius+3))
    yy,xx=np.mgrid[top:bottom,left:right].astype(np.float32);xx+=.5;yy+=.5
    distances=[]
    for p,q in zip(points,points[1:]):
        dx=q['x']-p['x'];dy=q['y']-p['y'];t=np.clip(((xx-p['x'])*dx+(yy-p['y'])*dy)/(dx*dx+dy*dy),0,1)
        distances.append(np.sqrt((xx-p['x']-t*dx)**2+(yy-p['y']-t*dy)**2))
    distance=distances[0] if part=='upper' else distances[1] if part=='forearm' else np.minimum(*distances)
    target=canvas[top:bottom,left:right]
    outer=np.clip(radius+.5-distance,0,1)
    for index,(r,color) in enumerate(((radius,rgba(INK)),(radius-3*pose['scale'],rgba(fur_hex)))):
        inner_distance=np.minimum(*distances) if part=='forearm' and index else distance
        alpha=np.clip(r+.5-inner_distance,0,1)
        if part=='forearm' and index:alpha*=outer
        alpha=alpha[:,:,None];value=np.concatenate((alpha*np.array(color[:3]),alpha),axis=2)
        target[:]=value+target*(1-alpha)
    return draw_hand(canvas,pose,hand) if draw_hand_part else None


def export_hand(path,hand):
    import numpy as np
    from tools.package_boy import write_rgba
    p=hand['pixels'].copy();p[:,:,:3][p[:,:,3]<=.001]=0;h,w=p.shape[:2]
    write_rgba(path,w,h,bytearray(np.clip(np.rint(p*255),0,255).astype(np.uint8).tobytes()))
    return {"image":path.name,"size":{"w":w,"h":h},
        "wrist":{"x":hand['wrist'][0],"y":hand['wrist'][1]},"grip":{"x":hand['grip'][0],"y":hand['grip'][1]}}
