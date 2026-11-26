import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

export const SESSION_COOKIE = 'cat_defense_test_session';
export const SESSION_TTL_SECONDS = 8 * 60 * 60;
export type PublicPlayer = { id: string; displayName: string };

const secret = () => process.env.DEMO_SESSION_SECRET || 'cat-defense-local-test-session-only-v1';
const signature = (value: string) => createHmac('sha256', secret()).update(value).digest('base64url');

export function checkTestPasscode(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 256) return false;
  const expected = Buffer.from(process.env.DEMO_ACCESS_CODE || 'cat-test');
  const submitted = Buffer.from(value);
  return expected.length === submitted.length && timingSafeEqual(expected, submitted);
}

export function createTestSession(displayName: unknown, now = Date.now()): { token: string; player: PublicPlayer } {
  if (typeof displayName !== 'string') throw new Error('Enter your display name.');
  const cleanedName = displayName.trim().replace(/\s+/g, ' ');
  if (cleanedName.length < 2 || cleanedName.length > 32) throw new Error('Use a display name with 2–32 characters.');
  const player = { id: randomUUID(), displayName: cleanedName };
  const payload = Buffer.from(JSON.stringify({ player, expiresAt: now + SESSION_TTL_SECONDS * 1000 })).toString('base64url');
  return { token: `${payload}.${signature(payload)}`, player };
}

export function readTestSession(token: string | undefined, now = Date.now()): PublicPlayer | null {
  if (!token || token.length > 2048) return null;
  const [payload, suppliedSignature, extra] = token.split('.');
  if (!payload || !suppliedSignature || extra) return null;
  const expected = Buffer.from(signature(payload));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Number.isFinite(data.expiresAt) || data.expiresAt <= now) return null;
    if (typeof data.player?.id !== 'string' || typeof data.player?.displayName !== 'string') return null;
    return { id: data.player.id, displayName: data.player.displayName };
  } catch { return null; }
}
