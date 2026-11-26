import { randomUUID } from 'node:crypto';

export type RunRules = Record<string, unknown>;
type Run = {
  id: string;
  playerId: string;
  score: number;
  scorePerKill: number;
  enemyIds: Set<string>;
  createdAt: number;
};
const storage = globalThis as typeof globalThis & { __catDefenseRuns?: Map<string, Run> };
const runs = storage.__catDefenseRuns ??= new Map<string, Run>();
const RUN_TTL_MS = 8 * 60 * 60 * 1000;

export function createRun(playerId: string, rules: RunRules, now = Date.now()) {
  for (const [id, run] of runs) if (now - run.createdAt > RUN_TTL_MS) runs.delete(id);
  const rawPoints = rules.scorePerKill ?? 100;
  if (typeof rawPoints !== 'number' || !Number.isInteger(rawPoints) || rawPoints < 0 || rawPoints > 10000) {
    throw new Error('scorePerKill must be an integer between 0 and 10000.');
  }
  const run: Run = { id: randomUUID(), playerId, score: 0, scorePerKill: rawPoints, enemyIds: new Set(), createdAt: now };
  runs.set(run.id, run);
  return { runId: run.id, score: run.score, scorePerKill: run.scorePerKill };
}

export function acceptKill(playerId: string, runId: string, enemyId: unknown, now = Date.now()) {
  const run = runs.get(runId);
  if (!run || run.playerId !== playerId || now - run.createdAt > RUN_TTL_MS) throw new Error('Run not found. Start a new run.');
  if (typeof enemyId !== 'string' || enemyId.length < 1 || enemyId.length > 128) throw new Error('Invalid enemy ID.');
  const duplicate = run.enemyIds.has(enemyId);
  if (!duplicate) {
    if (run.enemyIds.size >= 100000) throw new Error('Run limit reached. Start a new run.');
    run.enemyIds.add(enemyId);
    run.score += run.scorePerKill;
  }
  return { runId, score: run.score, kills: run.enemyIds.size, duplicate };
}
