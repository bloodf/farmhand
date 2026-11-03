# @farmhand/server

## 0.2.0

### Minor Changes

- 56d7dbf: Mainsail joins the apps, health checks, services and reference stack (`MAINSAIL_URL`, `MAINSAIL_PUBLIC_URL`).
- a830b94: `FARMHAND_OPEN_ACCESS=1` skips login: every request acts as an admin and the UI hides sign-out. For farms reachable only from trusted machines.

### Patch Changes

- bdac05d: Listen on several addresses (`FARMHAND_HOST` comma list) and accept writes from extra origins (`FARMHAND_TRUSTED_ORIGINS`), so the UI can be opened over Tailscale and on the LAN at the same time.
- Updated dependencies [56d7dbf]
  - @farmhand/contracts@0.1.0

## 0.1.0

### Minor Changes

- 09f1896: First release: discovery, approve wizard, live fleet, maintenance, root helper and installer.
