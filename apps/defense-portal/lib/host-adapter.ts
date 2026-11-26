export type Player = { id: string; displayName: string };
export type HostSession = { player: Player | null; mode: 'test' };
export type HostRun = { runId: string; score: number; scorePerKill: number };
export type ScoreReceipt = { runId: string; score: number; kills: number; duplicate: boolean };

/** Replace this interface's implementation when embedding in your existing authenticated portal. */
export interface HostAdapter {
  session(): Promise<HostSession>;
  signIn(displayName: string, passcode: string): Promise<HostSession>;
  signOut(): Promise<void>;
  createRun(rules: Record<string, unknown>): Promise<HostRun>;
  recordKill(runId: string, event: { enemyId: string; enemyType?: string; killIndex?: number }): Promise<ScoreReceipt>;
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The portal request failed.');
  return data as T;
}

export const testHostAdapter: HostAdapter = {
  session: () => request('/api/session'),
  signIn: (displayName, passcode) => request('/api/session', 'POST', { displayName, passcode }),
  signOut: async () => { await request('/api/session', 'DELETE'); },
  createRun: rules => request('/api/runs', 'POST', { rules }),
  recordKill: (runId, event) => request(`/api/runs/${encodeURIComponent(runId)}/score`, 'POST', event),
};
