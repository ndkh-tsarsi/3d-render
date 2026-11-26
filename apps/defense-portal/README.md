# Cat Defense React host

This Next.js app is an integration test portal. The game remains a separate, dependency-free HTML/JS folder and runs at a different origin.

Rendered game images are ignored by Git. In a fresh checkout, restore the ready package's `cat-defense/assets/` directory to `game/cat-defense/assets/` before running the game server. `npm run typecheck --workspace @cat-defense/portal` generates Next.js declarations locally before checking types.

From the repository root:

```sh
npm install
npm run dev:game
# In another terminal:
npm run dev:portal
```

Open `http://127.0.0.1:3010`. Use any display name and the local test access code `cat-test`. Configure `.env.local` using `.env.example` to change the code, session secret, or standalone game URL. Authentication uses a signed, expiring HttpOnly cookie. The test run/score store is in memory and resets when the server restarts.

The app supports starting/resetting a run, changing all 17 cats, pausing/resuming, host-triggered shots, enemy spawning, explosions, repairing/setting fence HP, and live rule changes. Score events are sent to the host route, deduplicated by run and enemy ID, and the accepted score is sent back to the game.

## Connect your existing portal

Use the SDK and the React iframe lifecycle in `components/defense-portal.tsx`. A production React host does not need Next.js or these test API routes. The component also accepts an `adapter` implementing `HostAdapter` from `lib/host-adapter.ts`:

```ts
interface HostAdapter {
  session(): Promise<{ player: { id: string; displayName: string } | null; mode: 'test' }>;
  signIn(displayName: string, passcode: string): Promise<HostSession>;
  signOut(): Promise<void>;
  createRun(rules: Record<string, unknown>): Promise<{ runId: string; score: number; scorePerKill: number }>;
  recordKill(runId: string, event: { enemyId: string; enemyType?: string; killIndex?: number }): Promise<ScoreReceipt>;
}
```

Replace the test adapter with your existing auth/session and gameplay services. For a host with an existing authenticated session, omit the test sign-in form and pass its public player information to `game.init({ player, runId, rules })`. Keep cookies and tokens in the host; the iframe receives only the public player record. The test score endpoint demonstrates deduplication and server-selected points; competitive score validation belongs in your existing game service.

## Test routes

- `GET /api/session`: public player details for the current test session.
- `POST /api/session`: `{ displayName, passcode }`, creates the test cookie.
- `DELETE /api/session`: clears the cookie.
- `POST /api/runs`: `{ rules }`, creates a run using the authenticated player.
- `POST /api/runs/:runId/score`: `{ enemyId, enemyType?, killIndex? }`, returns the accepted total score. Client-supplied point values are ignored.

`npm run test --workspace @cat-defense/portal` checks session tampering/expiry and score deduplication/ownership. `npm run build --workspace @cat-defense/portal` creates a production Next.js build.
