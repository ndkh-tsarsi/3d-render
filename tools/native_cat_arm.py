"""Rotate the supplied bent arm artwork without drawing replacement limbs."""
from __future__ import annotations
import math
import re
import zlib
from pathlib import Path

RIG_ID = 'fishing-native-art-v1'
RIG_TYPE = 'baked-native-art'
CLIP_COUNTS = {'idle':12,'pull':40,'bite':12,'celebrate':24,'miss':24}


def _override_stream(original, number, generation, stream):
    """A cached incremental PDF revision; every source resource stays intact."""
    previous = int(list(re.finditer(rb'startxref\s+(\d+)', original))[-1].group(1))
    trailers = list(re.finditer(rb'trailer\s*<<(.*?)>>', original, re.S))
    trailer = trailers[-1].group(1)
    root = re.search(rb'/Root\s+(\d+\s+\d+\s+R)', trailer).group(1)
    size = int(re.search(rb'/Size\s+(\d+)', trailer).group(1))
    prefix = original + b'\n'
    offset = len(prefix)
    obj = f'{number} {generation} obj\n<< /Length {len(stream)} >>\nstream\n'.encode()+stream+b'\nendstream\nendobj\n'
    xref = len(prefix)+len(obj)
    end = (f'xref\n{number} 1\n{offset:010d} {generation:05d} n \ntrailer\n<< /Size {size} /Root '.encode()
           +root+f' /Prev {previous} >>\nstartxref\n{xref}\n%%EOF\n'.encode())
    return prefix+obj+end


def separate_gray_pdf(source: Path, output: Path):
    """Separate the final authored arm draw from the gray costume Body page."""
    original=source.read_bytes(); candidates=[]
    for match in re.finditer(rb'(?:^|[\r\n])(\d+)\s+(\d+)\s+obj\b(.*?)endobj',original,re.S):
        obj=match.group(3); s=re.search(rb'\bstream\r?\n(.*?)\r?\nendstream',obj,re.S)
        if not s or b'/FlateDecode' not in obj[:s.start()]:continue
        try:program=zlib.decompress(s.group(1))
        except zlib.error:continue
        # This exact native arm is the final independent fill/stroke on Body.
        arm=re.search(rb'(0\.459 0\.408 0\.431\s+scn\s+q 1 0 0 1 ([\d.-]+) ([\d.-]+) cm\s+0 0 m\s+(?:-13\.135 -8\.824 -14\.54 -13\.904 v|3\.569 -0\.108 6\.476 -2\.77 v)\s+.*?\nB\s+Q)',program,re.S)
        if arm:candidates.append((match,program,arm))
    if len(candidates)!=1:raise RuntimeError(f'{source.name}: expected one independently drawn native gray arm, found {len(candidates)}')
    match,program,arm=candidates[0];number,generation=map(int,match.group(1,2))
    # Costume layers following the arm (e.g. scarf) remain separate occluders.
    prefix=program[:arm.start()];tail=program[arm.end():]
    ending=re.search(rb'EMC\s+Q\s*$',tail)
    after=tail[:ending.start()]
    header=b'q\n/CS0 cs\n/CS0 CS 0.231 0.09 0.106 SCN\n/GS0 gs\n1.494 w\n'
    is_tenth=b'3.569 -0.108 6.476 -2.77 v' in arm.group(1)
    # C10's final form is the arm's native shade, rather than a scarf.
    clean=prefix+b'EMC\nQ\n'
    hand=header+arm.group(1)+(after if is_tenth else b'')+b'\nQ\n'
    front=header+(after if not is_tenth else b'')+b'\nQ\n'
    output.mkdir(parents=True,exist_ok=True)
    body_pdf=output/'body-without-arm.pdf';arm_pdf=output/'native-arm.pdf'
    body_pdf.write_bytes(_override_stream(original,number,generation,clean))
    arm_pdf.write_bytes(_override_stream(original,number,generation,hand))
    (output/'body-front.pdf').write_bytes(_override_stream(original,number,generation,front))
    return body_pdf,arm_pdf


def rotation(clip,phase):
    phase=max(0.,min(1.,phase));p=phase*phase*(3-2*phase) if clip=='pull' else 0.
    wind=math.sin(math.pi*min(1.,phase/.22)) if clip=='pull' else 0.
    if clip=='celebrate':p=1-phase*phase*(3-2*phase)
    a=.36*p-.06*wind
    if clip in ('idle','bite'):a+=.012*math.sin(phase*math.tau)
    if clip=='miss':a+=.07*math.sin(math.pi*phase)
    return a


def pose(landmarks, shoulder, scale, clip, phase, motion_sign=1.):
    """One rigid transform for the exact native bent-arm image, at body scale."""
    angle=rotation(clip,phase)*motion_sign;c=math.cos(angle)*scale;s=math.sin(angle)*scale
    pivot=landmarks['shoulder'];e=shoulder[0]-c*pivot[0]+s*pivot[1];f=shoulder[1]-s*pivot[0]-c*pivot[1]
    H=[c,s,-s,c,e,f]
    def apply(p):return {'x':c*p[0]-s*p[1]+e,'y':s*p[0]+c*p[1]+f}
    result={k:apply(v) for k,v in landmarks.items()}
    result['upperAngle']=math.atan2(result['elbow']['y']-result['shoulder']['y'],result['elbow']['x']-result['shoulder']['x'])
    result['forearmAngle']=math.atan2(result['wrist']['y']-result['elbow']['y'],result['wrist']['x']-result['elbow']['x'])
    result['handAngle']=math.atan2(result['grip']['y']-result['wrist']['y'],result['grip']['x']-result['wrist']['x'])
    result['handTransform']=H
    return result


def metadata(landmarks,scale):
    def length(a,b):return math.dist(landmarks[a],landmarks[b])*scale
    w,g=landmarks['wrist'],landmarks['grip']
    return {'id':RIG_ID,'type':RIG_TYPE,'assemblyScale':scale,'nativeScale':1,
        'lengths':{'upper':length('shoulder','elbow'),'forearm':length('elbow','wrist')},
        'restHandAngle':math.atan2(g[1]-w[1],g[0]-w[0])}
