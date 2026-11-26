# Cat Defense: standalone game and host API

This game is plain HTML, CSS and JavaScript. It runs independently of React, Next.js, login providers and backend services. The Next.js portal is an integration test harness with a simple test login. Existing fishing previews and rendered source assets are separate.

## Run locally

From the repository root (Node 22+):

Generated game assets are distributed separately from Git. Before starting a fresh checkout, copy the `assets/` directory from the ready package's `cat-defense/` folder to `game/cat-defense/assets/`. The local macOS export and asset preparation tools can regenerate it from the supplied `raw/` artwork and combat exports. Tests use committed metadata fixtures and do not require these rendered images.

```sh
npm install
npm run dev
```

- Game: `http://127.0.0.1:8780/`
- Next.js test portal: `http://127.0.0.1:3010/`
- Pure JavaScript iframe host: `http://127.0.0.1:8780/examples/host.html`

The game server and portal use different origins to exercise the same integration as a separately hosted game. `npm run dev:game` and `npm run dev:portal` run them individually.

## Ready static folder

```sh
npm run build:defense
node tools/serve_defense.mjs --dir build/cat-defense-standalone --port 8780
```

`build/cat-defense-standalone/` and `build/cat-defense-standalone.zip` contain the complete game, native sprite atlases, licenses, browser SDK and plain JavaScript host example. Copy the folder to any HTTP(S) static host. No Node, React, npm, Blender, CDN or build step is required at runtime. ES modules and fetch require HTTP rather than double-clicking `file://index.html`.

The packaging step copies already prepared assets. It does not render any model or use GitHub Actions. To regenerate the compact atlases from the existing local combat exports, run `python3 tools/package_defense_assets.py` on macOS. Native art is from the supplied Craftpix pack; the bundled license and attribution describe the source assets.

Character scale uses visible body bounds, excluding transparent atlas padding: cat 195 logical pixels tall, regular enemy 180, boss 270. Fixed reference bounds keep feet and animation frames stable; shot origins and enemy hit areas use the same layout. If replacing/repacking the character atlases, run `node tools/measure_defense_bounds.mjs` to refresh those measurements before packaging.

## Embed in React or Next.js

Use the local workspace package `@cat-defense/sdk`, or copy `sdk/` from the ready folder into your own application. The SDK has no dependencies. In Next.js, create it inside a client component effect:

A reusable component is also included at `examples/CatDefenseFrame.tsx` in the standalone package. It accepts public player/rules/run props and calls `onReady(client)` so your host can retain the client and trigger actions. It initializes a fresh game instance after reloads and cleans up on unmount.

```tsx
'use client';
import {useEffect, useRef} from 'react';
import {createCatDefenseClient} from '@cat-defense/sdk';

export function DefenseGame({player}: {player: {id:string; displayName:string}}) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!frame.current) return;
    const game = createCatDefenseClient({
      iframe: frame.current,
      gameUrl: 'https://your-game-host.example/index.html',
      allowedOrigin: 'https://your-game-host.example'
    });
    let cancelled = false;
    game.ready().then(async () => {
      if (cancelled) return;
      await game.init({
        player,
        runId: 'run-' + Date.now(), // Prefer a run ID created by your host/backend.
        rules: {enemySpeed:58, autoFire:false, fenceMaxHp:1000,
          explosionDurationMs:650, scoreMode:'host'}
      });
      if (!cancelled) await game.start();
    }).catch(error => { if (!cancelled) console.error(error); });
    const stop = game.on('scoreRequested', async event => {
      // Your host/backend validates and deduplicates this event against the run.
      // const result = await yourScoreApi(event);
      // await game.setScore(result.totalScore);
    });
    return () => {cancelled = true; stop(); game.destroy();};
  }, [player.id, player.displayName]);
  return <iframe ref={frame} title="Cat Defense"
    sandbox="allow-scripts allow-same-origin" allow="autoplay"
    style={{width:'100%', aspectRatio:'16 / 10', border:0}} />;
}
```

Subscribe before starting. Call `destroy()` when unmounting; this removes listeners and rejects pending requests, including React Strict Mode cleanup. Do not retain a client after replacing the iframe. On an iframe reload the SDK emits another `ready`, rejects old pending requests and the host must initialize the new game instance/run again.

## Public actions

Every SDK action returns a Promise. Invalid payloads reject with a structured command error. `fire()` can return `{accepted:false, reason:...}` when paused or cooling down; it never bypasses the configured cooldown.

```js
await game.init({player:{id:'u1',displayName:'Milo'},runId:'run-123'});
await game.configure({enemySpeed:90, autoFire:false, fireCooldownMs:500});
await game.setCat('cat-01');
await game.start();
await game.fire({target:{x:0.8,y:0.6}});
await game.spawnEnemy({type:'enemy-reg-1',lane:1,speed:70,health:80});
await game.setFenceHp(400);
await game.repairFence(100);
await game.explode({x:0.7,y:0.6,radius:150,damage:100,durationMs:900});
await game.pause();
await game.resume();
await game.setScore(1200);
const state = await game.getState();
await game.restart({seed:42});
await game.setMuted(false);
```

Target and explosion `x/y` are normalized to `0..1` in the logical 1280×720 world, independent of canvas size, Retina density and letterboxing. Radius/speed use logical pixels; durations use milliseconds. `lane` is a zero-based lane index. Read `availableCats` and `availableEnemies` in state instead of hardcoding asset IDs. Cat art supports native Idle and Shoot clips; boxer/guardian use their supplied action clips.

`restart` clears entities, timers, effects, kills and game score and starts a new run using current rules/player/cat. Host run IDs belong to the host: call `init({runId:newId})` before restart. Changing maximum fence HP clamps the existing HP; it does not heal the fence. Use `setFenceHp()` or `repairFence()` explicitly. Changing enemy speed affects live enemies. Pausing freezes gameplay, projectiles, explosions and spawning.

## Rules

`configure` accepts a partial flat rules object. Unknown keys, non-finite numbers and out-of-range values reject. The exact defaults and limits are exported by `game/cat-defense/rules.js` and included in game state capabilities.

- Enemies: `enemySpeed`, `enemyHealth`, `spawnIntervalMs`, `maxEnemies`, `enemyContactDamage`, `enemyAttackIntervalMs`.
- Shotgun: `autoFire`, `fireCooldownMs`, `shotDamage`, `pelletCount`, `spreadDegrees`, `projectileSpeed`, `projectileLifetimeMs`.
- Fence: `fenceMaxHp`.
- Explosion: `explosionDurationMs`, `explosionRadius`, `explosionDamage`. Damage is applied once, independently of visual duration.
- Waves: `enemiesPerWave`, `waveDelayMs`, `enemySpeedMultiplierPerWave`, `maxWaves` (`0` means endless).
- Scores: `scorePerKill`, `scoreMode` (`game` or `host`).

## Events and host responsibilities

```js
const unsubscribe = game.on('enemyKilled', event => console.log(event));
game.on('fenceDamaged', event => updateFenceUi(event));
game.on('gameOver', event => finishRun(event));
game.on('state', state => updateDashboard(state));
game.on('*', (payload, eventType) => log(eventType, payload));
```

Events include `ready`, `initialized`, `state`, `shot`, `enemySpawned`, `enemyKilled`, `fenceDamaged`, `explosionStarted`, `explosionEnded`, `waveStarted`, `waveCompleted`, `gameOver`, `scoreChanged` and `scoreRequested`. Events carry the current host `runId`; `state` is throttled. All score requests have a stable enemy ID within the run. In `scoreMode:'host'` kills do not increment game score: your host/backend decides the accepted total and sends `setScore(total)`. The test portal deduplicates score events for its own runs. A browser event alone is not proof for competitive server-authoritative scoring.

Keep login, credentials, authorization and reward rules in the host. Only public player fields (`id`, `displayName`, optional `avatarUrl`) belong in the iframe. Do not send passwords, cookies or bearer tokens to the game. Replacing the portal authentication system requires no game modification.

## Protocol and isolation

The SDK configures iframe query parameters `embed=1`, exact `parentOrigin`, and a random `channelId`. Both sides validate `event.source`, the exact origin, namespace `cat-defense`, protocol version `1`, channel and game instance. Replies correlate a `requestId`; duplicate request IDs do not repeat side effects. Default command/ready timeout is 30 seconds. `postMessage` always uses an exact origin, never `*`.

Envelope format for non-JavaScript hosts:

```js
{
  namespace:'cat-defense', version:1, channelId:'...', instanceId:'...',
  kind:'request', requestId:'unique-id', type:'fire', payload:{target:{x:.8,y:.6}}
}
```

The game initially emits `kind:'event', type:'ready'`; use that instance ID in requests. Responses use `kind:'response'`, matching request ID, `ok:true` plus `payload`, or `ok:false` plus `error:{code,message}`. A `hello` request can repeat the ready announcement. Channel IDs isolate integrations; they are not authentication credentials. Your static host must permit framing from the portal (`Content-Security-Policy: frame-ancestors ...`) and must not send `X-Frame-Options: DENY`.

When running directly, use `window.CatDefense` after the `cat-defense:ready` window event. It exposes the same actions and `execute(type,payload)` without iframe messaging. This direct API and the SDK share the same engine.

## Validation

```sh
npm test
npm run typecheck
npm run build:portal
npm run build:defense
```

The pure engine/protocol tests cover live rules, damage/cooldowns/waves/pause/restart, host score events, command validation, message source/origin checks, duplicate commands, reloads, timeouts and disposal.
