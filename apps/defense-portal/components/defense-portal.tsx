'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createCatDefenseClient } from '@cat-defense/sdk';
import { testHostAdapter, type HostAdapter, type Player, type HostRun } from '../lib/host-adapter';

type Rules = {
  enemySpeed: number; enemyHealth: number; spawnIntervalMs: number; autoFire: boolean;
  fireCooldownMs: number; fenceMaxHp: number; explosionDurationMs: number;
  explosionRadius: number; scorePerKill: number; scoreMode: 'host';
};
type GameState = {
  status?: string; score?: number; wave?: number; kills?: number; enemyCount?: number;
  fence?: { hp: number; maxHp: number }; muted?: boolean; catId?: string;
};
type FeedEntry = { id: number; title: string; detail: string; time: string };
const INITIAL_RULES: Rules = {
  enemySpeed: 58, enemyHealth: 40, spawnIntervalMs: 1700, autoFire: true,
  fireCooldownMs: 650, fenceMaxHp: 1000, explosionDurationMs: 650,
  explosionRadius: 110, scorePerKill: 100, scoreMode: 'host',
};
const CATS = Array.from({ length: 15 }, (_, index) => ({ id: `cat-${String(index + 1).padStart(2, '0')}`, name: `Cat ${String(index + 1).padStart(2, '0')}` }))
  .concat([{ id: 'cat-boxer', name: 'Boxer' }, { id: 'cat-guardian', name: 'Guardian' }]);

function Icon({ name, size = 20 }: { name: 'cat' | 'play' | 'pause' | 'reset' | 'target' | 'bolt' | 'sound' | 'mute' | 'code' | 'shield' | 'logout'; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    cat: <><path d="m4 10 1-7 6 4h2l6-4 1 7v5c0 4-4 6-8 6s-8-2-8-6Z"/><path d="M8 12h.01M16 12h.01M10 16l2 1 2-1M2 15l5 1m10 0 5-1"/></>,
    play: <path d="m8 5 11 7-11 7Z"/>, pause: <><path d="M8 5v14M16 5v14"/></>,
    reset: <><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/></>,
    target: <><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></>,
    bolt: <path d="m13 2-9 12h7l-1 8 10-13h-7Z"/>,
    sound: <><path d="m11 4-6 5H2v6h3l6 5ZM15 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14"/></>,
    mute: <><path d="m11 4-6 5H2v6h3l6 5ZM16 9l6 6m0-6-6 6"/></>,
    code: <><path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/></>,
    logout: <><path d="M9 4H4v16h5m-1-8h14m-5-5 5 5-5 5"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function DefensePortal({ adapter = testHostAdapter }: { adapter?: HostAdapter }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const clientRef = useRef<ReturnType<typeof createCatDefenseClient> | null>(null);
  const runRef = useRef<HostRun | null>(null);
  const playerRef = useRef<Player | null>(null);
  const rulesRef = useRef<Rules>(INITIAL_RULES);
  const catRef = useRef('cat-01');
  const operationRef = useRef(0);
  const feedId = useRef(0);
  const [player, setPlayer] = useState<Player | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [displayName, setDisplayName] = useState('Player One');
  const [passcode, setPasscode] = useState('');
  const [rules, setRules] = useState<Rules>(INITIAL_RULES);
  const [catId, setCatId] = useState('cat-01');
  const [gameState, setGameState] = useState<GameState>({ status: 'loading' });
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('Connecting to the standalone game…');
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const gameUrl = process.env.NEXT_PUBLIC_GAME_URL || 'http://127.0.0.1:8780/';

  const addFeed = useCallback((title: string, detail = '') => {
    const entry = { id: ++feedId.current, title, detail, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) };
    setFeed(current => [entry, ...current].slice(0, 7));
  }, []);

  useEffect(() => {
    let active = true;
    adapter.session().then(session => {
      if (!active) return;
      playerRef.current = session.player;
      setPlayer(session.player);
    }).catch(reason => { if (active) setError(reason.message); }).finally(() => { if (active) setAuthLoaded(true); });
    return () => { active = false; };
  }, [adapter]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let active = true;
    let generation = 0;
    const client = createCatDefenseClient({ iframe, gameUrl });
    clientRef.current = client;
    const updateState = (payload: unknown) => {
      if (!active || !payload || typeof payload !== 'object') return;
      const data = payload as { state?: GameState } & GameState;
      const next = data.state || data;
      setGameState(next);
      if (typeof next.muted === 'boolean') setMuted(next.muted);
    };
    const offState = client.on('state', updateState);
    const offAll = client.on('*', (payload: unknown, type: string) => {
      if (!active || type === 'state' || type === 'scoreRequested' || type === 'shot') return;
      const event = (payload || {}) as Record<string, unknown>;
      const labels: Record<string, string> = {
        waveStarted: 'Wave started', waveCompleted: 'Wave cleared', enemyKilled: 'Enemy defeated',
        fenceDamaged: 'Fence damaged', explosionStarted: 'Explosion triggered',
        gameOver: 'Game over', scoreChanged: 'Score confirmed', ready: 'Game ready',
      };
      if (labels[type]) addFeed(labels[type], typeof event.score === 'number' ? `${event.score.toLocaleString()} points` : typeof event.wave === 'number' ? `Wave ${event.wave}` : '');
      if (type === 'gameOver') setNotice('Fence down. Start a fresh run to try again.');
    });
    const offScore = client.on('scoreRequested', async (payload: unknown) => {
      const event = payload as { runId?: string; enemyId?: string; enemyType?: string; killIndex?: number };
      const run = runRef.current;
      if (!active || !run || event.runId !== run.runId || !event.enemyId) return;
      try {
        const receipt = await adapter.recordKill(run.runId, { enemyId: event.enemyId, enemyType: event.enemyType, killIndex: event.killIndex });
        if (!active || runRef.current?.runId !== receipt.runId) return;
        runRef.current.score = Math.max(runRef.current.score, receipt.score);
        await client.setScore(runRef.current.score);
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : 'Could not record score.'); }
    });
    const offReady = client.on('ready', async state => {
      if (!active) return;
      const instance = ++generation;
      operationRef.current++;
      runRef.current = null; setRunId(null); setBusy(false); setConnected(false);
      try {
        await client.init({ ...(playerRef.current ? { player: playerRef.current } : {}), rules: rulesRef.current, catId: catRef.current });
        await client.setMuted(true);
        if (!active || instance !== generation) return;
        updateState(await client.getState() || state);
        setMuted(true); setConnected(true);
        setNotice(playerRef.current ? 'Game connected. Start a new test run.' : 'Game connected. Sign in and start a test run.');
        addFeed('Iframe connected', 'Protocol v1 · separate game origin');
      } catch (reason) {
        if (active && instance === generation) setError(reason instanceof Error ? reason.message : 'Could not initialize game.');
      }
    });
    client.ready().catch(reason => {
      if (!active) return;
      setNotice('Game connection failed. Check that the standalone server is running.');
      setError(reason instanceof Error ? reason.message : 'Could not connect to game.');
    });
    return () => {
      active = false;
      offState(); offAll(); offScore(); offReady(); client.destroy();
      if (clientRef.current === client) clientRef.current = null;
      runRef.current = null;
    };
  }, [adapter, addFeed, gameUrl]);

  const perform = async (action: () => Promise<unknown>, message?: string) => {
    setError('');
    try {
      const result = await action();
      if (message) setNotice(message);
      if (clientRef.current) setGameState(await clientRef.current.getState() as GameState);
      return result;
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The game action failed.'); }
  };

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const session = await adapter.signIn(displayName, passcode);
      playerRef.current = session.player;
      setPlayer(session.player); setPasscode('');
      if (session.player && clientRef.current && connected) await clientRef.current.setPlayer(session.player);
      setNotice('Test session ready. Choose your cat and start a run.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not sign in.'); }
    finally { setBusy(false); }
  };

  const signOut = async () => {
    operationRef.current++;
    runRef.current = null; setRunId(null);
    await perform(async () => {
      if (clientRef.current) await clientRef.current.pause();
      await adapter.signOut();
      playerRef.current = null; setPlayer(null);
      if (clientRef.current) await clientRef.current.setPlayer({ id: 'guest', displayName: 'Guest' });
    }, 'Signed out. The game is paused.');
  };

  const newRun = async () => {
    const client = clientRef.current;
    if (!client || !player) return;
    const operation = ++operationRef.current;
    setBusy(true); setError('');
    runRef.current = null;
    try {
      await client.pause();
      const run = await adapter.createRun(rulesRef.current);
      if (operation !== operationRef.current) return;
      await client.init({ player, rules: rulesRef.current, catId: catRef.current, runId: run.runId });
      await client.setScore(run.score);
      runRef.current = run; setRunId(run.runId);
      await client.restart();
      setNotice('Run started. The host is accepting and confirming score events.');
      addFeed('New host run', run.runId.slice(0, 8));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not start run.'); }
    finally { if (operation === operationRef.current) setBusy(false); }
  };

  const changeRule = <Key extends keyof Rules>(key: Key, value: Rules[Key]) => {
    const next = { ...rulesRef.current, [key]: value };
    rulesRef.current = next; setRules(next);
    if (clientRef.current && connected) void perform(() => clientRef.current!.configure({ [key]: value }), 'Rule applied to the live game.');
  };
  const changeCat = (value: string) => {
    catRef.current = value; setCatId(value);
    if (clientRef.current && connected) void perform(() => clientRef.current!.setCat(value), 'Cat changed using the host API.');
  };
  const isPlaying = gameState.status === 'playing';
  const activeRun = Boolean(runId && player);
  const hp = Math.round(gameState.fence?.hp ?? rules.fenceMaxHp);
  const maxHp = gameState.fence?.maxHp || rules.fenceMaxHp;

  return <main className="portal-shell">
    <header className="topbar">
      <a className="brand" href="/"><span className="brand-icon"><Icon name="cat" size={27}/></span><span>CAT DEFENSE<small>Game lab</small></span></a>
      <div className="topbar-right"><span className="test-badge">TEST ENVIRONMENT</span><a href={gameUrl} target="_blank" rel="noreferrer" className="text-link">Open standalone</a></div>
    </header>

    <section className="page-intro">
      <div><div className="eyebrow">PLAY. CONTROL. INTEGRATE.</div><h1>Your cats. Your rules.</h1><p>A standalone HTML5 game, connected to your React host.</p></div>
      <div className="architecture-pill"><span>React host</span><span className="connection-line"/><Icon name="code" size={18}/><span className="connection-line"/><span>HTML5 game</span></div>
    </section>

    {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}

    <div className="workspace-grid">
      <section className="play-column">
        <div className="game-panel">
          <div className="panel-topline"><div className="section-label"><span className={connected ? 'connection-dot online' : 'connection-dot'}/>{connected ? 'GAME CONNECTED' : 'CONNECTING'}</div><span className="subtle-label">Independent iframe · API v1</span></div>
          <div className="stats-row">
            <div className="stat"><span>HOST SCORE</span><strong>{(gameState.score || 0).toLocaleString()}</strong></div>
            <div className="stat"><span>WAVE</span><strong>{String(gameState.wave || 1).padStart(2, '0')}</strong></div>
            <div className="stat fence-stat"><span>FENCE HP <b>{hp} / {maxHp}</b></span><div className="hp-track"><i style={{ width: `${Math.max(0, Math.min(100, hp / maxHp * 100))}%` }}/></div></div>
          </div>
          <div className="iframe-frame"><iframe ref={iframeRef} title="Cat Defense standalone game" allow="autoplay" sandbox="allow-scripts allow-same-origin"/></div>
          <div className="game-toolbar">
            <button className="button primary" disabled={!connected || !player || busy} onClick={newRun}><Icon name={activeRun ? 'reset' : 'play'}/>{busy ? 'Please wait…' : activeRun ? 'New run' : 'Start game'}</button>
            <button className="button secondary" disabled={!connected || !activeRun || busy} onClick={() => perform(() => isPlaying ? clientRef.current!.pause() : clientRef.current!.resume(), isPlaying ? 'Game paused.' : 'Game resumed.')}><Icon name={isPlaying ? 'pause' : 'play'}/>{isPlaying ? 'Pause' : 'Resume'}</button>
            <div className="toolbar-spacer"/>
            <button className="icon-button" disabled={!connected} aria-label={muted ? 'Turn sound on' : 'Mute sound'} title={muted ? 'Turn sound on' : 'Mute sound'} onClick={() => perform(async () => { await clientRef.current!.setMuted(!muted); setMuted(!muted); })}><Icon name={muted ? 'mute' : 'sound'}/></button>
          </div>
          <p className="game-notice" aria-live="polite">{notice}</p>
        </div>

        <section className="panel action-panel">
          <div className="section-heading"><div><h2>Host actions</h2><p>Trigger game behavior from outside the iframe.</p></div><span className="small-tag">COMMAND API</span></div>
          <div className="action-grid">
            <button disabled={!connected || !activeRun || !isPlaying} className="action-button" onClick={() => perform(async () => {
              const result = await clientRef.current!.fire() as { accepted?: boolean; reason?: string };
              addFeed('Host fire command', result?.accepted === false ? result.reason || 'Cooldown' : 'Shot accepted');
            })}><span className="action-icon coral"><Icon name="target"/></span><span>Fire shotgun<small>Respect shot cooldown</small></span></button>
            <button disabled={!connected || !activeRun || !isPlaying} className="action-button" onClick={() => perform(() => clientRef.current!.spawnEnemy(), 'Enemy spawned by the host.')}><span className="action-icon violet"><Icon name="cat"/></span><span>Spawn enemy<small>Add an enemy to the wave</small></span></button>
            <button disabled={!connected || !activeRun || !isPlaying} className="action-button" onClick={() => perform(() => clientRef.current!.explode({ x: 0.73, y: 0.62 }), 'Explosion triggered by the host.')}><span className="action-icon amber"><Icon name="bolt"/></span><span>Trigger explosion<small>Uses current explosion rules</small></span></button>
            <button disabled={!connected || !activeRun} className="action-button" onClick={() => perform(() => clientRef.current!.repairFence(200), 'Fence repaired by 200 HP.')}><span className="action-icon mint"><Icon name="shield"/></span><span>Repair fence<small>Restore 200 HP</small></span></button>
          </div>
        </section>

        <section className="panel event-panel">
          <div className="section-heading"><div><h2>Live events</h2><p>Game events received by the React host.</p></div><span className="small-tag">{runId ? `RUN ${runId.slice(0, 8).toUpperCase()}` : 'NO ACTIVE RUN'}</span></div>
          <div className="event-list" aria-live="polite">{feed.length ? feed.map(entry => <div className="event-row" key={entry.id}><time>{entry.time}</time><strong>{entry.title}</strong><span>{entry.detail}</span></div>) : <div className="empty-feed">Events will appear when the game connects.</div>}</div>
        </section>
      </section>

      <aside className="control-column">
        <section className="panel session-panel">
          <div className="section-heading"><div><h2>Player session</h2><p>Test authentication, owned by the host.</p></div><Icon name="shield"/></div>
          {player ? <><div className="player-card"><span className="player-avatar">{player.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{player.displayName}</strong><small>Test session active</small></div><button className="icon-button" title="Sign out" aria-label="Sign out" onClick={signOut}><Icon name="logout" size={18}/></button></div><p className="hint">Only public player details are sent to the game.</p></> : <form onSubmit={signIn} className="login-form"><label>Display name<input value={displayName} onChange={event => setDisplayName(event.target.value)} autoComplete="nickname" maxLength={32} minLength={2} required/></label><label>Test access code<input type="password" value={passcode} onChange={event => setPasscode(event.target.value)} autoComplete="current-password" placeholder="Enter test code" required/></label><button className="button primary full-width" disabled={!authLoaded || busy}>{busy ? 'Signing in…' : 'Sign in for test'}</button><p className="hint">Local default code: <code>cat-test</code>. Change it with <code>DEMO_ACCESS_CODE</code>.</p></form>}
        </section>

        <section className="panel rules-panel">
          <div className="section-heading"><div><h2>Game rules</h2><p>Changes apply live through the SDK.</p></div><span className="small-tag purple">LIVE</span></div>
          <div className="defender-picker"><img src={`${gameUrl.replace(/\/$/, '')}/assets/portraits/${catId}.png`} alt="Selected defender" width={80} height={80}/><label className="select-label">Defender<select aria-label="Defender" value={catId} onChange={event => changeCat(event.target.value)} disabled={!connected}>{CATS.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></label></div>
          <div className="toggle-row"><span><strong>Automatic fire</strong><small>Turn off for host-controlled shots</small></span><button className={`toggle ${rules.autoFire ? 'active' : ''}`} role="switch" aria-checked={rules.autoFire} aria-label="Automatic fire" disabled={!connected} onClick={() => changeRule('autoFire', !rules.autoFire)}><i/></button></div>
          <div className="rule-group"><h3>ENEMIES</h3><RuleSlider label="Movement speed" value={rules.enemySpeed} min={10} max={180} step={2} unit="px/s" disabled={!connected} onChange={value => changeRule('enemySpeed', value)}/><RuleSlider label="Enemy health" value={rules.enemyHealth} min={10} max={250} step={10} unit="HP" disabled={!connected} onChange={value => changeRule('enemyHealth', value)}/><RuleSlider label="Spawn interval" value={rules.spawnIntervalMs} min={400} max={4000} step={100} unit="ms" disabled={!connected} onChange={value => changeRule('spawnIntervalMs', value)}/></div>
          <div className="rule-group"><h3>DEFENSE</h3><RuleSlider label="Fence maximum HP" value={rules.fenceMaxHp} min={100} max={3000} step={100} unit="HP" disabled={!connected} onChange={value => changeRule('fenceMaxHp', value)}/><RuleSlider label="Shot cooldown" value={rules.fireCooldownMs} min={100} max={1800} step={50} unit="ms" disabled={!connected} onChange={value => changeRule('fireCooldownMs', value)}/><button className="button quiet full-width" disabled={!connected || !activeRun} onClick={() => perform(() => clientRef.current!.setFenceHp(rules.fenceMaxHp), 'Fence HP set to the configured maximum.')}>Set fence to maximum HP</button></div>
          <div className="rule-group"><h3>EXPLOSION</h3><RuleSlider label="Effect duration" value={rules.explosionDurationMs} min={150} max={2500} step={50} unit="ms" disabled={!connected} onChange={value => changeRule('explosionDurationMs', value)}/><RuleSlider label="Blast radius" value={rules.explosionRadius} min={40} max={300} step={10} unit="px" disabled={!connected} onChange={value => changeRule('explosionRadius', value)}/></div>
        </section>
      </aside>
    </div>

    <details className="integration-details"><summary><Icon name="code"/><span>Embed this game in your own portal</span><span className="small-tag">HTML + JS + SDK</span></summary><div><p>The game folder is independent. Replace <code>HostAdapter</code> with your existing session and score services, then control the iframe through the SDK.</p><pre><code>{`const game = createCatDefenseClient({ iframe, gameUrl });\nawait game.ready();\nawait game.init({ player, runId, rules: { autoFire: false, scoreMode: 'host' } });\nawait game.start();\nawait game.configure({ enemySpeed: 80, explosionDurationMs: 900 });\nawait game.fire();\ngame.on('scoreRequested', event => saveScoreInYourBackend(event));`}</code></pre><p className="hint">This local portal uses test auth and an in-memory run store. Your existing system stays responsible for real accounts, persistent scores and gameplay rules.</p></div></details>
    <footer>CAT DEFENSE <span>Standalone game · React host · Versioned action API</span></footer>
  </main>;
}

function RuleSlider({ label, value, min, max, step, unit, disabled, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; disabled: boolean; onChange: (value: number) => void }) {
  return <label className="rule-slider"><span>{label}<output>{value.toLocaleString()} <small>{unit}</small></output></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} disabled={disabled} style={{ '--range-progress': `${(value - min) / (max - min) * 100}%` } as React.CSSProperties} onChange={event => onChange(Number(event.target.value))}/></label>;
}
