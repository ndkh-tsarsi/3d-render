// This module is part of the static game. No host framework or auth dependency.
export const NAMESPACE = 'cat-defense';
export const PROTOCOL_VERSION = 1;
const COMMANDS = Object.freeze(['init','configure','setPlayer','setCat','start','pause','resume','restart','fire','spawnEnemy','setFenceHp','repairFence','explode','setScore','getState','setMuted']);
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
function validId(value) {return typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,160}$/.test(value);}
function plainPayload(value) {
  if (!isRecord(value)) throw new TypeError('Command payload must be an object.');
  if (Object.keys(value).some(key => ['__proto__','prototype','constructor'].includes(key))) throw new TypeError('Invalid payload key.');
  return value;
}
export function createGameBridge({game, hostWindow = window, onEvent = () => {}}) {
  const params = new URL(hostWindow.location.href).searchParams;
  const embedded = params.get('embed') === '1' && hostWindow.parent !== hostWindow;
  const channelId = params.get('channelId');
  const parentValue = params.get('parentOrigin');
  let parentOrigin;
  if (embedded) {
    const parentUrl = new URL(parentValue ?? '');
    if (!['https:', 'http:'].includes(parentUrl.protocol) || parentUrl.origin !== parentValue || !validId(channelId)) {
      throw new TypeError('Embedded game requires an exact HTTP(S) parentOrigin and valid channelId.');
    }
    parentOrigin = parentUrl.origin;
  }
  const instanceId = typeof hostWindow.crypto.randomUUID==='function' ? hostWindow.crypto.randomUUID()
    : Array.from(hostWindow.crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
  let runId = null;
  let disposed = false;
  let commandQueue = Promise.resolve();
  const subscribers = new Map();
  const receipts = new Map();
  const withContext = value => isRecord(value) ? {...value, runId} : value;
  const state = () => withContext(game.getState());
  function post(kind, type, payload, extra = {}) {
    if (embedded && !disposed) hostWindow.parent.postMessage({namespace:NAMESPACE,version:PROTOCOL_VERSION,channelId,instanceId,kind,type,payload,...extra}, parentOrigin);
  }
  function publish(type, payload = {}) {
    if (disposed) return;
    const enriched = withContext(payload);
    post('event', type, enriched);
    onEvent(type, enriched);
    for (const handler of [...(subscribers.get(type) ?? []), ...(subscribers.get('*') ?? [])]) {
      try {handler(enriched, type);} catch (error) {hostWindow.console?.error(error);}
    }
  }
  async function execute(type, payload = {}) {
    if (disposed) throw new Error('Game bridge was destroyed.');
    if (!COMMANDS.includes(type)) throw new TypeError(`Unknown command: ${type}`);
    plainPayload(payload);
    if (type === 'init') {
      if (Object.keys(payload).some(key => !['rules','player','catId','runId'].includes(key))) throw new TypeError('Unknown init option.');
      if (payload.runId !== undefined && payload.runId !== null && !validId(payload.runId)) throw new TypeError('Invalid runId.');
      if (payload.rules !== undefined) plainPayload(payload.rules);
      if (payload.player !== undefined) plainPayload(payload.player);
      if (payload.catId !== undefined && typeof payload.catId !== 'string') throw new TypeError('Invalid catId.');
      if (payload.rules !== undefined) await game.execute('configure', {rules:payload.rules});
      if (payload.player !== undefined) await game.execute('setPlayer', {player:payload.player});
      if (payload.catId !== undefined) await game.execute('setCat', {catId:payload.catId});
      if (payload.runId !== undefined) runId = payload.runId;
      publish('initialized', state());
      return state();
    }
    const result = await game.execute(type, payload);
    return type === 'getState' || isRecord(result) && 'status' in result ? withContext(result) : result;
  }
  function respond(message, body) {
    post('response', message.type, body.payload, {requestId:message.requestId,ok:body.ok,...(body.error ? {error:body.error} : {})});
  }
  function handleMessage(event) {
    const message = event.data;
    if (!embedded || disposed || event.source !== hostWindow.parent || event.origin !== parentOrigin || !isRecord(message)
      || message.namespace !== NAMESPACE || message.version !== PROTOCOL_VERSION || message.channelId !== channelId || message.kind !== 'request'
      || !validId(message.requestId) || typeof message.type !== 'string') return;
    if (message.type === 'hello') {post('event','ready',state()); return;}
    if (message.instanceId !== instanceId) return;
    if (receipts.has(message.requestId)) {receipts.get(message.requestId).then(body => respond(message, body)); return;}
    const task = commandQueue.then(async () => {
      try {return {ok:true,payload:await execute(message.type, message.payload)};}
      catch (error) {return {ok:false,error:{code:typeof error?.code==='string'?error.code:'INVALID_COMMAND',message:error instanceof Error ? error.message : 'Command failed.'}};}
    });
    commandQueue = task.then(() => {});
    receipts.set(message.requestId, task);
    if (receipts.size > 256) receipts.delete(receipts.keys().next().value);
    task.then(body => respond(message,body));
  }
  hostWindow.addEventListener('message',handleMessage);
  const api = {
    protocolVersion:PROTOCOL_VERSION, getState:() => Promise.resolve(state()),
    execute,
    init:payload => execute('init',payload), configure:rules => execute('configure',{rules}),
    setPlayer:player => execute('setPlayer',{player}),setCat:catId => execute('setCat',{catId}),
    start:() => execute('start'),pause:() => execute('pause'),resume:() => execute('resume'),
    restart:(payload={}) => execute('restart',payload),fire:(payload={}) => execute('fire',payload),
    spawnEnemy:(payload={}) => execute('spawnEnemy',payload),setFenceHp:hp => execute('setFenceHp',{hp}),
    repairFence:amount => execute('repairFence',{amount}),explode:payload => execute('explode',payload),
    setScore:score => execute('setScore',{score}),setMuted:muted => execute('setMuted',{muted}),
    on(type,handler) {if(typeof handler !== 'function')throw new TypeError('Handler must be a function.');if(!subscribers.has(type))subscribers.set(type,new Set());subscribers.get(type).add(handler);return()=>subscribers.get(type)?.delete(handler);},
    destroy() {disposed=true;hostWindow.removeEventListener('message',handleMessage);subscribers.clear();receipts.clear();game.destroy();}
  };
  return {api,publish,announce:()=>post('event','ready',state()),destroy:api.destroy};
}
