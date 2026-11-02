# farmhand

Self-hosted control room for a Klipper/Moonraker 3D print farm. It orchestrates an existing docker-compose stack (PrintStash, FDM Monster, Spoolman, OrcaSlicer, Mobileraker companion) and adds discovery, guided onboarding, live fleet state, diagnostics and maintenance. PrintStash owns the job queue. farmhand never sends print commands.

## Layout

- `apps/server` — Hono + zod-openapi, Drizzle on SQLite (libsql), better-auth, SSE, in-process jobs. Port 3490.
- `apps/web` — Vite, React 19, TanStack Router + Query, Tailwind v4, shadcn/ui (Base UI), i18next. Talks to the server through `hc<AppType>`.
- `packages/contracts` — zod schemas, network validation, event types shared by both.
- `packages/fixtures` — fake Moonraker, PrintStash, FDM Monster and Spoolman. `pnpm dev:fake`.
- `deploy` — systemd units, the root helper, reference compose, install script.

## Commands

`pnpm install`, `pnpm dev:fake`, `pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e`, `pnpm changeset`.

## Rules that are not negotiable

- Root work goes only through `deploy/helper/farmhand-helper` and its fixed verbs. No `sudo`, no `exec` of user-shaped strings, no new verbs without a validation function and a test.
- Validate printer targets with `@farmhand/contracts` (`checkTarget`) on the server, and again in the helper. Loopback is allowed only with `FARMHAND_DEV_ALLOW_LOOPBACK=1`, which production refuses.
- Every mutation inserts an `operations` row before acting and updates it after. Timeouts end as `unknown`, and the UI then offers "check status", not "retry".
- A source that failed is shown as unavailable. Never show it as healthy, idle or zero.
- Status is always a text label. Color alone is not status.
- UI strings go in `apps/web/src/i18n/en-US.json` and `pt-BR.json`. No literal strings in components.
- Secrets live in env files, never in the database or the repo.
- Pin dependency versions. Confirm the current version with `pnpm view <pkg> version` before adding one.
- Commit with conventional commits, push after each finished step.

## Skills

Project skills live in `.claude/skills/`; ponytail comes from the plugin marketplace in `.claude/settings.json`.

- **ponytail** — always on. Climb the ladder before writing code: does it need to exist, is it already here, stdlib, platform, installed dependency, one line, then minimum code with one check.
- **no-ai-slop** — run on every piece of prose before it lands: README, docs, UI copy, commit bodies, PR descriptions, issue replies.
- **visant-preflight** — at the start of any new feature or page, before code.
- **visant-frontend**, **visant-motion**, **visant-refine** — while building or changing UI. Each element must justify what it helps the operator do.
- **visant-copy** — for pt-BR UI copy and for `copy-lint` on both locales.
- **visant-killer** — gate before any PR that touches `apps/web`. `GATE CLOSED` blocks the PR.
- **unslop** — for redesign passes over an existing screen, not for new screens.

## Design

Follow `docs/design.md`: neutral oklch tokens, Inter, 44px targets, visible focus, reduced motion respected, light and dark through the `.dark` class, QueryState for loading/empty/unavailable/stale, confirm dialogs for every write.
