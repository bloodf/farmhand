# Development

```bash
pnpm install
cp .env.example .env     # points the server at the fake farm
pnpm dev:fake            # fake printers and apps on loopback
pnpm dev                 # server :3490 and web :5173
```

Open http://localhost:5173 and create the admin account. Approve `127.0.0.1:17126` from Discover → Add by IP to see the whole onboarding flow run against the fakes; the fake helper writes its allowlist and `mobileraker.conf` under `.farmhand-fake-helper/`.

Fake controls (POST JSON):

- printers `127.0.0.1:17125..17127` → `/__control {"offline":true}`, `{"state":"printing","filename":"x.gcode"}`, `{"klippy":"shutdown"}`
- PrintStash `:13460`, FDM `:14000`, Spoolman `:17912` → `/__control {"fdmFail":true}`, `{"spoolmanDown":true}`, `{"printstashDown":true}`; `GET /__state` dumps what they hold.

## Checks

```bash
pnpm lint        # biome (use `rtk bypass pnpm lint` on hosts where rtk wraps the shell)
pnpm typecheck
pnpm test        # vitest: contracts, fixtures, server (boots the fakes in-process)
pnpm build
pnpm e2e         # playwright against the fake farm
python3 -I -m unittest discover -s deploy/helper -p 'test_*.py'
```

## Where things go

- A new API route: `apps/server/src/routes/*.ts`, registered in `app.ts`. Declare request and response schemas; add `requireRole` and, for writes, `rateLimit` and an `operations` row.
- A new upstream call: `apps/server/src/adapters/*.ts`, through `fetchJson` with a schema.
- Anything that needs root: a new verb in `deploy/helper/farmhand-helper` with its own validation and a test, then the matching method in `adapters/helper.ts` (both `SocketHelper` and `FakeHelper`).
- A new page: `apps/web/src/routes/_app/*.tsx`, strings in both locale files, every list through `QueryState`.

## Releasing

Add a changeset (`pnpm changeset`) with any user-visible change. The release workflow opens a version PR; merging it tags the release and publishes a tarball with `apps/server/dist`, `apps/web/dist` and `deploy/`.
