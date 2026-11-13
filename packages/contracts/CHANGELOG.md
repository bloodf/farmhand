# @farmhand/contracts

## 0.1.0

### Minor Changes

- 9f23114: `FARMHAND_BRIDGE_TARGETS` (helper: `BRIDGE_TARGETS`) lists `ip:port` Moonraker bridges on the farmhand host, such as Kobralink for a Kobra X. An exact match may use the host's own address; the Spoolman allowlist step is skipped for it.
- 56d7dbf: Mainsail joins the apps, health checks, services and reference stack (`MAINSAIL_URL`, `MAINSAIL_PUBLIC_URL`).
