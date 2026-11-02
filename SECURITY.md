# Security

Report vulnerabilities privately through GitHub Security Advisories: https://github.com/bloodf/farmhand/security/advisories/new. Expect an answer within 7 days.

## Model

- The web server runs as an unprivileged user. Anything that needs root (allowlist, compose, systemd) goes through `farmhand-helper`, a root-owned script with a fixed set of verbs, reached over a Unix socket that checks the caller's uid.
- The helper reads its paths from `/etc/farmhand/helper.env` (root-owned). Nothing the web server can write decides what the helper touches.
- Printer targets are validated twice (server and helper): IPv4 only, on a directly connected LAN, never loopback, link-local, multicast, broadcast or the host's own addresses.
- Mutations require a session, a same-origin check, a role, a rate limit and, for approvals, a single-use token bound to the exact input.
- Logs shown in the UI are sanitized in the helper and again in the server.

See `docs/security.md` for details.
