# Contributing

## Setup

```bash
pnpm install
pnpm dev:fake   # fake printers and apps on loopback
pnpm dev        # server on :3490, web on :5173
```

Open http://localhost:5173. The first visit asks you to create the admin account.

## Checks

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. CI runs the same four. `pnpm e2e` runs Playwright against the fake farm; the GitHub workflow for it is manual.

## Rules

- No shell commands built from user input. Privileged work goes through the root helper's fixed verbs (`deploy/helper`).
- Every mutation writes an `operations` row before it acts.
- A source that failed is shown as unavailable, never as healthy or as zero.
- UI strings live in `apps/web/src/i18n/*.json`. Add both `en-US` and `pt-BR`.
- Conventional commits: `feat(web): ...`, `fix(server): ...`, `docs: ...`.
- Add a changeset for anything a user would notice.
## Local note

On a machine where `rtk` wraps shell commands, Biome's node wrapper dies with "Linter process terminated abnormally". Run `rtk bypass pnpm lint` there. CI is unaffected.
