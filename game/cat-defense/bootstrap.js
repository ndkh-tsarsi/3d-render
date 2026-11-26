import {createGame} from './game.js';
import {createGameBridge} from './bridge.js';

const $ = id => document.getElementById(id);
let game, bridge;
let lastState;
const buffered = [];
const params = new URL(location.href).searchParams;
const isEmbedded=params.get('embed')==='1'&&parent!==window;
if (isEmbedded) document.documentElement.classList.add('is-embedded');
const embedStyles=document.createElement('link');embedStyles.rel='stylesheet';embedStyles.href=new URL('./embedded.css',import.meta.url).href;document.head.append(embedStyles);
function update(state) {
  lastState = state;
  const text = (id,value) => {if($(id))$(id).textContent=String(value);};
  text('game-status',({ready:'Ready',playing:'Defending',paused:'Paused',gameover:'Fence down'})[state.status] ?? state.status);
  text('fence-hp',`${Math.ceil(state.fence.hp)} / ${state.fence.maxHp}`);
  text('wave-value',state.wave);text('score-value',state.score.toLocaleString());
  text('player-name',state.player?.displayName ?? 'Guest defender');
  if($('pause-button')){$('pause-button').textContent=state.status==='paused'?'▶':'Ⅱ';$('pause-button').setAttribute('aria-label',state.status==='paused'?'Resume game':'Pause game');$('pause-button').disabled=!['paused','playing'].includes(state.status);}
  if($('fire-button'))$('fire-button').disabled=state.status!=='playing';
  if($('start-button')){$('start-button').hidden=state.status==='playing'||state.status==='paused';$('start-button').disabled=false;$('start-button').textContent=state.status==='gameover'?'Defend again':'Start defending';}
  if($('ready-overlay'))$('ready-overlay').hidden=state.status==='playing'||state.status==='paused';
  if($('sound-button')){$('sound-button').setAttribute('aria-pressed',String(!state.muted));$('sound-button').setAttribute('aria-label',state.muted?'Enable sound':'Mute sound');}
  if($('fence-meter'))$('fence-meter').style.width=`${Math.max(0,state.fence.hp/state.fence.maxHp*100)}%`;
  if($('cooldown-meter'))$('cooldown-meter').style.transform=`scaleX(${1-Number(state.cooldownMs??0)/state.rules.fireCooldownMs})`;
  if($('auto-fire'))$('auto-fire').checked=state.rules.autoFire;
  if(state.status==='gameover'){
    if($('overlay-title'))$('overlay-title').textContent=state.completed?'Neighborhood safe!':'The fence is down';
    if($('overlay-message'))$('overlay-message').textContent=`${state.kills} monsters stopped · ${state.score.toLocaleString()} points. Ready for another round?`;
  }else if(isEmbedded&&state.status==='ready'){
    if($('overlay-message'))$('overlay-message').textContent='Your defender is ready. Start a run from the host controls.';
  }
  const select=$('cat-select');
  if(select && select.dataset.populated!=='true'){select.replaceChildren();for(const cat of state.availableCats??[])select.add(new Option(cat.name,cat.id));select.dataset.populated='true';}
  if(select)select.value=state.catId;
}
function showError(error) {
  console.error(error);
  if($('game-status'))$('game-status').textContent=error.message??String(error);
}
async function act(command,payload={}) {
  try {await bridge.api.execute(command,payload);update(await bridge.api.getState());} catch(error){showError(error);}
}
try {
  game=await createGame({canvas:$('game-canvas'),assetsUrl:'./assets/manifest.json',onEvent(type,payload){
    if(type==='state')update(payload);
    if(bridge)bridge.publish(type,payload);else buffered.push([type,payload]);
  }});
  bridge=createGameBridge({game});
  window.CatDefense=bridge.api;
  update(game.getState());
  for(const [type,payload] of buffered)bridge.publish(type,payload);
  bridge.announce();
  window.dispatchEvent(new CustomEvent('cat-defense:ready',{detail:bridge.api}));
  $('start-button')?.addEventListener('click',()=>act(lastState.status==='gameover'?'restart':'start'));
  $('pause-button')?.addEventListener('click',()=>act(lastState.status==='paused'?'resume':'pause'));
  $('restart-button')?.addEventListener('click',()=>act('restart'));
  $('fire-button')?.addEventListener('click',()=>act('fire'));
  $('sound-button')?.addEventListener('click',()=>act('setMuted',{muted:!lastState.muted}));
  $('cat-select')?.addEventListener('change',event=>act('setCat',{catId:event.target.value}));
  $('auto-fire')?.addEventListener('change',event=>act('configure',{rules:{autoFire:event.target.checked}}));
  window.addEventListener('pagehide',event=>{if(!event.persisted)bridge.destroy();});
} catch(error) {
  showError(error);
  if($('ready-overlay'))$('ready-overlay').textContent=`Unable to load game: ${error.message}. Serve this folder over HTTP.`;
  if(params.get('embed')==='1'&&parent!==window){
    try {const origin=new URL(params.get('parentOrigin')).origin;parent.postMessage({namespace:'cat-defense',version:1,channelId:params.get('channelId'),kind:'event',type:'loadError',payload:{message:error.message}},origin);}catch{}
  }
}
