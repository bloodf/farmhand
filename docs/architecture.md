# Architecture

farmhand is one Node process plus one small root helper.

```
browser ──HTTP/SSE──▶ farmhand server (:3490, user farmhand)
                        │  ├─ SQLite (users, printers, candidates, operations, settings)
                        │  ├─ Moonraker WebSocket per printer (live state)
                        │  ├─ PrintStash / FDM Monster / Spoolman HTTP adapters
                        │  └─ discovery job (avahi-browse, ip neigh)
                        │
                        └─unix socket─▶ farmhand-helper (root, fixed verbs)
                                          ├─ allowlist file + nftables guard reload
                                          ├─ mobileraker.conf + docker compose
                                          ├─ docker compose restart / logs
                                          └─ systemctl start/show backup unit
```

## Server (`apps/server`)

- **Hono** with `@hono/zod-openapi`. Every route declares its input and output schema; the spec is served at `/api/openapi.json` and Scalar at `/api/docs` (session required).
- **better-auth** for accounts. Email and password only. The admin plugin provides the `viewer < operator < admin` roles; `requireRole` in `middleware/session.ts` is what each route uses.
- **Drizzle on libsql**. Migrations in `src/db/migrations` run at boot. Live printer state is not in the database; it lives in `live/store.ts` and is rebuilt from the printers table on start.
- **Jobs** (`jobs/`): `fleet.ts` keeps one Moonraker WebSocket per registered printer (backoff 1–30 s, stale after 30 s without a frame), polls app health every 15 s and the Spoolman stock every 60 s. `discovery.ts` runs on the interval from settings and on demand. `adopt.ts` imports the printers PrintStash already knows when the registry is empty.
- **Approval** (`approval/index.ts`): probe Moonraker, create the printer row, then run four independent idempotent steps. Each step's result is written to the printer's `integrations` column and to the operation row.
- **Operations** (`lib/operations.ts`) is the audit log. A row is opened before any mutation and closed after it. Rows still `running` at boot become `unknown`.
- **Confirm tokens** (`lib/confirm-token.ts`): the approval preview mints an HMAC token over `{action, input, userId, exp, nonce}`; the approval redeems it once. A token for one printer cannot approve another.
- **Helper client** (`adapters/helper.ts`): `SocketHelper` speaks newline-delimited JSON to the root helper; `FakeHelper` writes to a directory and is used in development and tests.

## Web (`apps/web`)

Vite, React 19, TanStack Router (file routes) and Query, Tailwind v4, shadcn/ui on Base UI, i18next. `lib/live.ts` opens `/api/events` and writes every frame into the query cache, so components only read queries. All writes wait for the server and go through a confirm dialog.

## Contracts (`packages/contracts`)

Zod schemas and the target validation shared by server and web. `checkTarget` rejects anything that is not a plain IPv4 on a directly connected LAN. The helper repeats the same checks in Python.

## Fixtures (`packages/fixtures`)

Fake Moonraker (HTTP and WebSocket with a simulated print), PrintStash, FDM Monster and Spoolman. `pnpm dev:fake` runs them on loopback; the server tests boot them in-process.

## Data model

| table                                        | purpose                                                                |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| `user`, `session`, `account`, `verification` | better-auth                                                            |
| `printers`                                   | registered printers: host, port, name, source, per-step `integrations` |
| `candidates`                                 | printers seen on the LAN, keyed by host:port, with `dismissedAt`       |
| `operations`                                 | audit log: kind, actor, target, sanitized input, status, steps         |
| `settings`                                   | discovery interval, LAN interfaces, low-stock threshold                |

Printer identity is host:port. Moonraker has no stable machine id, so give printers a DHCP reservation.
