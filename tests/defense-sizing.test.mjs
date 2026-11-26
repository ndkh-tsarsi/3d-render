import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DefenseEngine} from '../game/cat-defense/engine.js';
import {AssetLibrary,DefenseRenderer,frameAt} from '../game/cat-defense/render.js';
import {CAT_POSE,ENEMY_BODY} from '../game/cat-defense/character-layout.js';
import {ACTOR_BOUNDS} from '../game/cat-defense/actor-bounds.js';

const manifest=JSON.parse(readFileSync(new URL('./fixtures/defense-layout.json',import.meta.url)));
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} != ${expected}`);
function fixture(run){
  const original=Object.getOwnPropertyDescriptor(globalThis,'window');
  globalThis.window={devicePixelRatio:1};
  const draws=[];
  const context=new Proxy({drawImage:(...args)=>draws.push(args)},{get:(obj,key)=>key in obj?obj[key]:()=>{},set:(obj,key,value)=>{obj[key]=value;return true;}});
  const assets=new AssetLibrary({...manifest,scenery:{},effects:{}},new URL('http://localhost/assets/'));
  for(const actor of [...assets.cats,...assets.enemies])for(const clip of Object.values(actor.clips)){
    const picture={};assets.images.set(clip.image||actor.image,picture);assets.loads.set(clip.image||actor.image,Promise.resolve(picture));
  }
  const renderer=new DefenseRenderer({getContext:()=>context,getBoundingClientRect:()=>({width:1280,height:720})},assets);
  const engine=new DefenseEngine({cats:assets.cats,enemies:assets.enemies});
  try{run({renderer,engine,draws});}finally{if(original)Object.defineProperty(globalThis,'window',original);else delete globalThis.window;}
}

test('every enemy has a readable visible body, grounded feet and a matching collision center',()=>fixture(({renderer,engine,draws})=>{
  for(const actor of Object.values(manifest.enemies)){
    const enemy=engine.spawnEnemy({type:actor.id,lane:1});enemy.x=800;
    draws.length=0;renderer._enemy(enemy,engine);
    assert.equal(draws.length,1,actor.id);
    const [, , , , ,x,y,width,height]=draws[0];
    const bounds=ACTOR_BOUNDS[actor.id];
    const visibleHeight=height*bounds.h;
    near(visibleHeight,ENEMY_BODY[actor.kind==='boss'?'boss':'regular'].height);
    near(y+height*(bounds.y+bounds.h),enemy.y);
    near(x+width*(bounds.x+bounds.w/2),enemy.x);
    assert.ok(Math.abs((enemy.y-enemy.height*.48)-(y+height*(bounds.y+bounds.h/2)))<visibleHeight*.03);
    assert.ok(visibleHeight>=CAT_POSE.height*.85,actor.id);
    if(actor.kind==='boss')assert.ok(visibleHeight>=CAT_POSE.height*1.3,actor.id);
    assert.ok(enemy.radius<visibleHeight/2);
  }
}));

test('all cat outfits share a stable visible height and their projectile muzzle follows the drawn sprite',()=>fixture(({renderer,engine,draws})=>{
  engine.execute('start');
  for(const cat of Object.values(manifest.cats)){
    engine.execute('setCat',{catId:cat.id});engine.catActionMs=engine.elapsedMs;
    draws.length=0;renderer.draw(engine);
    assert.equal(draws.length,1,cat.id);
    const [, , , , ,x,y,width,height]=draws[0];
    const bounds=ACTOR_BOUNDS[cat.id];
    near(height*bounds.h,CAT_POSE.height);
    near(y+height*(bounds.y+bounds.h),CAT_POSE.y);
    const source=frameAt(cat,renderer.actionName(cat),0,false).frame.muzzle||cat.muzzle;
    const muzzle=renderer.muzzle(engine);
    near(muzzle.x,x+source.x*width);near(muzzle.y,y+source.y*height);
  }
}));
