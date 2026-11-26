export type GameStatus = 'ready' | 'playing' | 'paused' | 'gameover';
export interface Player {id: string; displayName: string; avatarUrl?: string}
export interface Rules {
  enemySpeed: number; enemyHealth: number; spawnIntervalMs: number; maxEnemies: number;
  autoFire: boolean; fireCooldownMs: number; shotDamage: number; pelletCount: number;
  spreadDegrees: number; projectileSpeed: number; projectileLifetimeMs: number;
  fenceMaxHp: number; enemyContactDamage: number; enemyAttackIntervalMs: number;
  explosionDurationMs: number; explosionRadius: number; explosionDamage: number;
  scorePerKill: number; enemiesPerWave: number; waveDelayMs: number;
  enemySpeedMultiplierPerWave: number; maxWaves: number; scoreMode: 'game' | 'host';
}
export interface GameState {
  status: GameStatus; score: number; wave: number; kills: number; elapsedMs: number;
  fence: {hp: number; maxHp: number}; player: Player | null; rules: Rules; catId: string;
  enemyCount: number; runId: string | null; muted: boolean;
  availableCats: {id: string; name: string; kind?: string}[];
  [key: string]: unknown;
}
export interface Point {x: number; y: number}
export interface SpawnEnemyOptions {type?: string; lane?: number; health?: number; speed?: number}
export interface ExplosionOptions extends Point {radius?: number; damage?: number; durationMs?: number}
export interface InitOptions {player?: Player; rules?: Partial<Rules>; catId?: string; runId?: string | null}
export interface CommandResult {accepted?: boolean; reason?: string; [key: string]: unknown}
export interface CatDefenseClient {
  readonly protocolVersion: number;
  readonly connected: boolean;
  readonly state: GameState | undefined;
  ready(): Promise<GameState>;
  init(options?: InitOptions): Promise<GameState>;
  configure(rules: Partial<Rules>): Promise<GameState>;
  setPlayer(player: Player): Promise<GameState>;
  setCat(catId: string): Promise<GameState>;
  start(): Promise<GameState>; pause(): Promise<GameState>; resume(): Promise<GameState>;
  restart(options?: {seed?: number}): Promise<GameState>;
  fire(options?: {target?: Point}): Promise<CommandResult>;
  spawnEnemy(options?: SpawnEnemyOptions): Promise<CommandResult>;
  setFenceHp(hp: number): Promise<GameState>;
  repairFence(amount: number): Promise<GameState>;
  explode(options: ExplosionOptions): Promise<CommandResult>;
  setScore(score: number): Promise<GameState>;
  getState(): Promise<GameState>;
  setMuted(muted: boolean): Promise<GameState>;
  on(type: string, handler: (payload: any, type: string) => void): () => void;
  destroy(): void;
}
export function createCatDefenseClient(options: {
  iframe: HTMLIFrameElement; gameUrl: string; allowedOrigin?: string; timeoutMs?: number;
}): CatDefenseClient;
