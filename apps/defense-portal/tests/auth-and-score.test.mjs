import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTestPasscode, createTestSession, readTestSession, SESSION_TTL_SECONDS } from '../lib/demo-auth.ts';
import { createRun, acceptKill } from '../lib/run-store.ts';

test('test-session signatures reject tampering and expired sessions', () => {
  const now = 1000000;
  const { token, player } = createTestSession('  Cat   Player  ', now);
  assert.equal(player.displayName, 'Cat Player');
  assert.deepEqual(readTestSession(token, now + 1), player);
  const [payload, signature] = token.split('.');
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  data.player.displayName = 'Forged player';
  assert.equal(readTestSession(`${Buffer.from(JSON.stringify(data)).toString('base64url')}.${signature}`, now), null);
  assert.equal(readTestSession(token, now + SESSION_TTL_SECONDS * 1000), null);
  assert.equal(readTestSession(`${token}.extra`, now), null);
});

test('test access code check and display name validation', () => {
  process.env.DEMO_ACCESS_CODE = 'private-test-code';
  assert.equal(checkTestPasscode('private-test-code'), true);
  assert.equal(checkTestPasscode('wrong'), false);
  assert.equal(checkTestPasscode(undefined), false);
  assert.throws(() => createTestSession('x'), /2–32/);
  delete process.env.DEMO_ACCESS_CODE;
});

test('score service calculates points from run rules and deduplicates kills', () => {
  const now = 1000000;
  const run = createRun('player-a', { scorePerKill: 125 }, now);
  assert.deepEqual(acceptKill('player-a', run.runId, 'enemy-1', now), { runId: run.runId, score: 125, kills: 1, duplicate: false });
  assert.equal(acceptKill('player-a', run.runId, 'enemy-1', now).score, 125);
  assert.equal(acceptKill('player-a', run.runId, 'enemy-1', now).duplicate, true);
  assert.equal(acceptKill('player-a', run.runId, 'enemy-2', now).score, 250);
  assert.throws(() => acceptKill('player-b', run.runId, 'enemy-3', now), /Run not found/);
  assert.throws(() => acceptKill('player-a', run.runId, '', now), /Invalid enemy/);
  assert.throws(() => createRun('player-a', { scorePerKill: Infinity }, now), /scorePerKill/);
});

test('score service rejects stale runs', () => {
  const run = createRun('player-a', { scorePerKill: 100 }, 0);
  assert.throws(() => acceptKill('player-a', run.runId, 'enemy-1', 8 * 60 * 60 * 1000 + 1), /Run not found/);
});
