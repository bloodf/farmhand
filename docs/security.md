# Security model

## Two processes, one boundary

The web server runs as the unprivileged `farmhand` user with a hardened systemd unit (`NoNewPrivileges`, `ProtectSystem=strict`, no capabilities). It cannot edit the allowlist, run docker or touch systemd.

Everything that needs root goes through `farmhand-helper`, a Python script owned by root that listens on `/run/farmhand/helper.sock`. The socket is group `farmhand`, mode 0660, and the helper also checks the connecting uid with `SO_PEERCRED`. The helper knows a fixed set of verbs; each verb has a fixed argv. There is no `sudo` and the `farmhand` user is not in the `docker` group.

The helper reads its paths and unit names from `/etc/farmhand/helper.env`, which is root-owned. Nothing the web server can write decides what the helper touches.

## What a compromised web server could do

Call the helper verbs: add an IP on the directly connected LAN to the Spoolman allowlist, add a Mobileraker printer entry, restart one of five compose services, read their logs, start the backup unit. It could not run other commands, read other files, or reach hosts outside the LAN through the helper.

## Request pipeline

Every mutation passes, in order: schema validation (zod, strict objects), session, same-origin check on `Origin` (JSON requests are not covered by form-only CSRF protections, so this is explicit), role, per-user rate limit, the in-process farm lock, an audit row, and then the action. Approvals additionally need a single-use token minted by the preview and bound to the exact target and user.

## Printer targets

`checkTarget` accepts plain IPv4 only. It rejects loopback, unspecified, multicast, reserved, broadcast, link-local, any address this host owns, and anything outside the networks of the configured LAN interfaces. The server checks before calling the helper; the helper checks again. `FARMHAND_DEV_ALLOW_LOOPBACK=1` relaxes only the loopback rule and the server refuses to start with it in production. `FARMHAND_BRIDGE_TARGETS` (helper: `BRIDGE_TARGETS`) lists `ip:port` pairs of Moonraker bridges on this host; an exact match lifts only the own-address rule, and a bridge never enters the Spoolman allowlist.

## Secrets

PrintStash and FDM Monster credentials live in `/etc/farmhand/farmhand.env` (root:farmhand 0640). The database stores none of them. The settings API reports whether a credential is set, never its value. Audit rows drop any field whose name looks like a secret. Log output is redacted in the helper and again in the server.

## Outbound HTTP

Every upstream call has a 3 s timeout (longer for registrations), never follows redirects, caps the body at 1 MiB and parses the response with a schema. Errors carry a short code, never the upstream body.

## Reporting

Use GitHub Security Advisories on the repository. Do not open a public issue for a vulnerability.

## Known limits

- Confirm-token nonces are kept in memory. A server restart inside the 120 s token lifetime would let one token be redeemed again. Every approval step is idempotent, so a replay repeats a no-op; it is still listed here so nobody relies on the nonce for anything else.
- The rate limiter is per process. farmhand runs as one process, so that is the whole picture.
- The reverse proxy must overwrite the header named in `FARMHAND_TRUSTED_IP_HEADER` (default `X-Real-IP`). Without a proxy, set it to a header nobody sends and accept that per-IP limits key on one bucket.
