export const NAMESPACE = 'cat-defense';
export const PROTOCOL_VERSION = 1;
export function randomId(cryptoProvider) {
  if (typeof cryptoProvider.randomUUID === 'function') return cryptoProvider.randomUUID();
  return Array.from(cryptoProvider.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2,'0')).join('');
}
export function isEnvelope(value, channelId) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && value.namespace === NAMESPACE && value.version === PROTOCOL_VERSION
    && value.channelId === channelId && typeof value.type === 'string'
    && ['request', 'response', 'event'].includes(value.kind);
}
export function makeEnvelope(channelId, kind, type, payload, extra = {}) {
  return {namespace: NAMESPACE, version: PROTOCOL_VERSION, channelId, kind, type, payload, ...extra};
}
export function httpOrigin(value, base) {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('Game URL must use HTTP or HTTPS.');
  return url.origin;
}
