import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sceneSizing} from '../web/scene-sizing.js';
import {FishingRig} from '../web/fishing.js';
import {Aquarium} from '../web/aquarium.js';

const fixtures=JSON.parse(readFileSync(new URL('./fixtures/fishing-layout.json',import.meta.url)));
const measuredAssets={...fixtures.cats,...fixtures.rods,...fixtures.fish};
const load=id=>{
  if(!Object.hasOwn(measuredAssets,id))throw new Error(`Missing measured fishing fixture: ${id}`);
  return structuredClone(measuredAssets[id]);
};
const cats=Object.keys(fixtures.cats).map(load);
const layouts=[[900,420],[356,474],[280,330],[1180,650]];
function model(manifest){
  const frames=Object.values(manifest.animations).flatMap(clip=>clip.frames);
  return {manifest,frames:(manifest.animations.idle??Object.values(manifest.animations)[0]).frames,
    referenceHeight:Math.max(...frames.map(frame=>frame.bounds?.h||manifest.frameSize.h))};
}
function rigFor(cat=cats[0],rod='fishingrod-lvl5'){
  const rig=new FishingRig();rig.actor=model(cat);rig.rod=model(load(rod));return rig;
}
function fishFor(id='cute-clownfish'){
  const manifest=load(id),meta=manifest.aquarium,box=meta.bounds;
  return {id,manifest,aquarium:meta,width:meta.width,catchable:true,displayName:meta.name,
    bounds:{centerX:box.x+box.w/2,centerY:box.y+box.h/2,width:box.w,height:box.h,
      mouthX:meta.mouth.x,mouthY:meta.mouth.y},
    x:.5,y:.65,targetX:.3,targetY:.5,direction:1,spriteFacing:meta.facing==='left'?-1:1,
    pitch:0,turnScale:1,speed:25,speedFactor:1};
}
function aquariumFor(width,height,models=[]){
  return Object.assign(Object.create(Aquarium.prototype),{width,height,models,clock:0,
    fishing:{phase:'waiting',model:null,elapsed:0},onFishingEvent:()=>{},
    fishingEnabled:true,active:true,playing:true,catchCount:0});
}

test('all 17 native cat outfits stand on the shared dry deck, with the bait in water',()=>{
  assert.equal(cats.length,17);
  for(const [width,height] of layouts)for(const cat of cats){
    const rig=rigFor(cat),sizing=sceneSizing(width,height);
    for(const phase of ['waiting','biting','reeling','caught','released']){
      const geometry=rig.getGeometry({width,height,clock:.4,fishing:{phase,elapsed:.5,reelProgress:.5,caughtProgress:.5}});
      assert.equal(geometry.feetY,sizing.dockY,`${cat.id}: stable shared deck`);
      assert.ok(geometry.feetY+13<sizing.surfaceY,`${cat.id}: deck above water`);
      assert.ok(geometry.feetY+rig.actor.layoutEnvelope.top>=6,`${cat.id}: head has clearance`);
    }
    const bait=rig.getBait({width,height,clock:.4});
    assert.ok(bait.y>sizing.surfaceY+30&&bait.y<height-20,`${cat.id}: bait submerged`);
    assert.ok(rig.getLandingPoint({width,height,clock:.4}).y<sizing.surfaceY,`${cat.id}: catch lands in air`);
  }
});

test('swimming and resize constraints keep ordinary fish beneath the surface',()=>{
  for(const [width,height] of layouts)for(const id of ['cute-clownfish','cute-puffer','cute-tang','cute-shark']){
    const fish=fishFor(id),aquarium=aquariumFor(width,height,[fish]);
    const {surfaceY}=sceneSizing(width,height),bounds=aquarium.swimmingBounds(fish);
    const bodyWidth=aquarium.bodyWidth(fish),bodyHeight=bodyWidth*fish.bounds.height/fish.bounds.width;
    assert.ok(bounds.top-bodyHeight/2>=surfaceY,`${id}: stays submerged`);
    assert.ok(bounds.bottom+bodyHeight/2<=height,`${id}: remains visible at bottom`);
    assert.ok(bounds.top<=bounds.bottom);
    fish.y=0;fish.targetY=0;aquarium.constrainPosition(fish);
    assert.ok(fish.y*height>=bounds.top-1e-6&&fish.targetY*height>=bounds.top-1e-6);
  }
});

test('responsive canvas and CSS shoreline use the same surface coordinate at Retina density',()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'window');
  globalThis.window={devicePixelRatio:2};
  try{
    const aquarium=aquariumFor(0,0),properties=new Map();
    aquarium.canvas={getBoundingClientRect:()=>({width:356,height:474}),
      parentElement:{style:{setProperty:(name,value)=>properties.set(name,value)}}};
    aquarium.context={setTransform:()=>{}};aquarium.draw=()=>{};
    aquarium.syncSize();
    assert.equal(properties.get('--waterline-y'),`${sceneSizing(356,474).surfaceY}px`);
    assert.equal(aquarium.canvas.width,712);assert.equal(aquarium.canvas.height,948);
  }finally{if(original)Object.defineProperty(globalThis,'window',original);else delete globalThis.window;}
});

test('all rod levels can attract a fish below the surface and lift it into the air',()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');
  globalThis.document={hidden:false};
  try{
    for(const [width,height] of layouts)for(let level=1;level<=5;level++){
      const rig=rigFor(cats[0],`fishingrod-lvl${level}`),fish=fishFor();
      const aquarium=aquariumFor(width,height,[fish]);
      aquarium.getBait=scene=>rig.getBait(scene);aquarium.getReelTarget=scene=>rig.getLandingPoint(scene);
      assert.equal(aquarium.castBait(),true,`${width}px / rod ${level}: reachable bait`);
      aquarium.fishing.phase='caught';aquarium.fishing.elapsed=0;
      aquarium.fishing.reelStart={x:fish.x,y:fish.y};
      aquarium.guideReel(fish);
      assert.ok(aquarium.mouthPosition(fish).y<sceneSizing(width,height).surfaceY,'caught fish crosses the surface');
      aquarium.returnFishToWater(fish);
      assert.ok(fish.y*height>=aquarium.swimmingBounds(fish).top,'released fish returns underwater');
    }
  }finally{if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document;}
});

test('drawing clips swimmers to water while allowing the hooked catch above it',()=>{
  const [width,height]=layouts[0],fish=fishFor(),other=fishFor('cute-tang');
  const aquarium=aquariumFor(width,height,[fish,other]);
  const calls=[];
  aquarium.context=new Proxy({}, {get:(_,key)=>(...args)=>calls.push([key,args])});
  aquarium.drawOverlay=()=>{};
  for(const current of [fish,other]){
    current.frames=[{page:0,frame:{x:0,y:0,w:64,h:64}}];current.frameIndex=0;
    current.images=new Map([[0,{image:{},scaleX:1,scaleY:1}]]);
  }
  aquarium.fishing={phase:'caught',model:fish};aquarium.draw();
  const rectangles=calls.filter(([name])=>name==='rect');
  assert.equal(rectangles.length,1,'only the ordinary swimmer is water-clipped');
  assert.deepEqual(rectangles[0][1],[0,sceneSizing(width,height).surfaceY,width,height-sceneSizing(width,height).surfaceY]);
});
