# @cat-defense/sdk

Dependency-free browser client for the standalone Cat Defense iframe. Import `createCatDefenseClient` from `index.js` (or the workspace package), provide an iframe and the game URL, await `ready()`, then initialize/start the game.

```js
import {createCatDefenseClient} from './sdk/index.js';
const game=createCatDefenseClient({iframe:document.querySelector('iframe'),gameUrl:'https://your-game.example/'});
game.on('scoreRequested',event=>console.log('Host decides the score',event));
await game.ready();
await game.init({player:{id:'u1',displayName:'Player'},runId:'run-1',rules:{autoFire:false,scoreMode:'host'}});
await game.start();
await game.fire({target:{x:.8,y:.6}});
// On component/page teardown:
// game.destroy();
```

Actions: `init`, `configure`, `setPlayer`, `setCat`, `start`, `pause`, `resume`, `restart`, `fire`, `spawnEnemy`, `setFenceHp`, `repairFence`, `explode`, `setScore`, `getState`, `setMuted`. All return Promises. `on(type,handler)` returns an unsubscribe function; `on('*',handler)` receives all events as `(payload,type)`.

Coordinates are normalized to 0..1. Events include a host-supplied `runId`. Exact origins, iframe source, channel, protocol version and instance ID are validated; no wildcard target origin is used. Call `destroy()` on React effect cleanup. Reloads emit a fresh `ready` event and require a fresh host run initialization. The SDK never needs auth credentials.

See `INTEGRATION.md` in the ready static package, or `docs/cat-defense.md` in the repository, for the full protocol and a React component example. TypeScript definitions are included.
