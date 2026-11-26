import {httpOrigin, isEnvelope, makeEnvelope, PROTOCOL_VERSION, randomId} from './protocol.js';

/** Pure browser SDK: no React, dependencies, auth tokens or global listeners after destroy(). */
export function createCatDefenseClient({iframe, gameUrl, allowedOrigin, timeoutMs = 30000}) {
  if (!iframe || typeof iframe.addEventListener !== 'function') throw new TypeError('An iframe element is required.');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100) throw new TypeError('timeoutMs must be at least 100.');
  const host = iframe.ownerDocument?.defaultView ?? window;
  const parentOrigin = httpOrigin(host.location.href);
  const url = new URL(gameUrl, host.location.href);
  const origin = httpOrigin(url.href);
  if (allowedOrigin && origin !== httpOrigin(allowedOrigin)) throw new TypeError('Game URL does not match allowedOrigin.');
  const channelId = randomId(host.crypto);
  url.searchParams.set('embed', '1');
  url.searchParams.set('parentOrigin', parentOrigin);
  url.searchParams.set('channelId', channelId);
  let disposed = false;
  let instanceId;
  let lastState;
  let sequence = 0;
  let loaded = false;
  const listeners = new Map();
  const pending = new Map();
  let resolveReady, rejectReady;
  let readyPromise = new Promise((resolve, reject) => {resolveReady = resolve; rejectReady = reject;});
  // A consumer may subscribe to events before awaiting ready(). Keep early disposal harmless.
  readyPromise.catch(() => {});
  let readyTimer = host.setTimeout(() => rejectReady(new Error('Game did not become ready in time.')), timeoutMs);
  function emit(type, payload) {
    for (const handler of [...(listeners.get(type) ?? []), ...(listeners.get('*') ?? [])]) {
      try {handler(payload, type);} catch (error) {host.console?.error('Cat Defense event handler failed', error);}
    }
  }
  function rejectPending(message) {
    for (const {reject, timer} of pending.values()) {host.clearTimeout(timer); reject(new Error(message));}
    pending.clear();
  }
  function onMessage(event) {
    if (disposed || event.source !== iframe.contentWindow || event.origin !== origin || !isEnvelope(event.data, channelId)) return;
    const message = event.data;
    if (message.kind === 'event' && message.type === 'loadError') {
      host.clearTimeout(readyTimer);
      loaded = false;
      lastState = undefined;
      const error = new Error(message.payload?.message ?? 'Unable to load game.');
      rejectReady(error);
      rejectPending(error.message);
      readyPromise = Promise.reject(error);
      readyPromise.catch(() => {});
      emit('error', message.payload);
      return;
    }
    if (message.kind === 'event' && message.type === 'ready') {
      if (typeof message.instanceId !== 'string') return;
      const isNewInstance = instanceId !== message.instanceId;
      if (instanceId && isNewInstance) rejectPending('Game reloaded; initialize the new instance before continuing.');
      instanceId = message.instanceId;
      lastState = message.payload;
      loaded = true;
      host.clearTimeout(readyTimer);
      resolveReady(lastState);
      // A new, successfully loaded instance can recover from an earlier asset failure/timeout.
      readyPromise = Promise.resolve(lastState);
      if (isNewInstance) emit('ready', lastState);
      return;
    }
    if (!instanceId || message.instanceId !== instanceId) return;
    if (message.kind === 'response' && typeof message.requestId === 'string') {
      const task = pending.get(message.requestId);
      if (!task) return;
      pending.delete(message.requestId); host.clearTimeout(task.timer);
      if (message.ok === true) task.resolve(message.payload);
      else {const error = new Error(message.error?.message ?? 'Game command failed.'); error.code = message.error?.code; task.reject(error);}
    } else if (message.kind === 'event') {
      if (message.type === 'state') lastState = message.payload;
      emit(message.type, message.payload);
    }
  }
  function onLoad() {
    // Ask again on load: a cached iframe can announce before its load event.
    if (!disposed) iframe.contentWindow?.postMessage(makeEnvelope(channelId, 'request', 'hello', {}, {requestId: 'hello'}), origin);
  }
  host.addEventListener('message', onMessage);
  iframe.addEventListener('load', onLoad);
  iframe.src = url.href;
  async function command(type, payload = {}) {
    if (disposed) throw new Error('Cat Defense client was destroyed.');
    await readyPromise;
    if (disposed) throw new Error('Cat Defense client was destroyed.');
    const requestId = `${channelId}:${++sequence}`;
    return new Promise((resolve, reject) => {
      const timer = host.setTimeout(() => {pending.delete(requestId); reject(new Error(`Game command timed out: ${type}`));}, timeoutMs);
      pending.set(requestId, {resolve, reject, timer});
      try {iframe.contentWindow.postMessage(makeEnvelope(channelId, 'request', type, payload, {requestId, instanceId}), origin);}
      catch (error) {pending.delete(requestId); host.clearTimeout(timer); reject(error);}
    });
  }
  return {
    protocolVersion: PROTOCOL_VERSION,
    ready: () => disposed ? Promise.reject(new Error('Cat Defense client was destroyed.')) : loaded ? Promise.resolve(lastState) : readyPromise,
    init: (payload = {}) => command('init', payload),
    configure: rules => command('configure', {rules}),
    setPlayer: player => command('setPlayer', {player}),
    setCat: catId => command('setCat', {catId}),
    start: () => command('start'), pause: () => command('pause'), resume: () => command('resume'),
    restart: (payload = {}) => command('restart', payload),
    fire: (payload = {}) => command('fire', payload),
    spawnEnemy: (payload = {}) => command('spawnEnemy', payload),
    setFenceHp: hp => command('setFenceHp', {hp}),
    repairFence: amount => command('repairFence', {amount}),
    explode: payload => command('explode', payload),
    setScore: score => command('setScore', {score}),
    getState: () => command('getState'),
    setMuted: muted => command('setMuted', {muted}),
    on(type, handler) {
      if (typeof handler !== 'function') throw new TypeError('Event handler must be a function.');
      if (disposed) throw new Error('Cat Defense client was destroyed.');
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
      return () => listeners.get(type)?.delete(handler);
    },
    destroy() {
      if (disposed) return;
      disposed = true; loaded = false;
      host.clearTimeout(readyTimer);
      rejectReady(new Error('Cat Defense client was destroyed.'));
      rejectPending('Cat Defense client was destroyed.');
      host.removeEventListener('message', onMessage);
      iframe.removeEventListener('load', onLoad);
      listeners.clear();
    },
    get connected() {return !disposed && loaded;},
    get state() {return lastState;}
  };
}
