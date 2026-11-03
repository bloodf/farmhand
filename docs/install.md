# Install

Target: a Linux host (Ubuntu 24.04 or Debian 13 tested) that already runs the printer apps with Docker Compose, or will run the reference stack in `deploy/compose`.

## Requirements

- Node.js 22 or newer, Python 3.11 or newer, Docker with Compose v2, systemd.
- `avahi-utils` for mDNS discovery (optional; neighbour-table discovery works without it).
- `nftables` if you want the Spoolman LAN guard.

## Steps

1. Download the release tarball and unpack it somewhere, for example `/tmp/farmhand-0.1.0`.
2. Copy `deploy/farmhand.env.example` to `/etc/farmhand/farmhand.env` and fill in the URLs and credentials of PrintStash and FDM Monster, the public URL users will open, and `FARMHAND_LAN_IP` (the address printers use to reach Spoolman). Leave `BETTER_AUTH_SECRET` blank; the installer generates one.
3. Copy `deploy/helper.env.example` to `/etc/farmhand/helper.env` and set `COMPOSE_FILE`, `ALLOW_FILE`, `MR_CONF`, `GUARD_UNIT` and `BACKUP_UNIT` for your host. Leave a unit empty to disable that feature.
4. Run `sudo bash deploy/install.sh` from the unpacked directory. It creates the `farmhand` user, installs the app under `/opt/farmhand`, the helper under `/usr/local/libexec/farmhand`, the units, and starts everything.
5. Open the public URL and create the admin account.

The installer never overwrites an existing env file and can be re-run after an upgrade.

## Reaching the UI

farmhand listens on every address in `FARMHAND_HOST` (comma list). Two common setups:

- Behind a reverse proxy or Tailscale: keep `FARMHAND_HOST=127.0.0.1`, set `FARMHAND_PUBLIC_URL` to the https name, and have the proxy set `X-Real-IP`. With Tailscale: `tailscale serve --bg --https=3490 http://127.0.0.1:3490`.
- Direct LAN access as well: add the LAN address, `FARMHAND_HOST=127.0.0.1,192.168.1.10`, make `FARMHAND_PUBLIC_URL` the plain-http LAN origin (cookies must not get the Secure flag) and list the https name in `FARMHAND_TRUSTED_ORIGINS`. Traffic on the LAN is plain http: only do this on a network you trust.

If every machine that can reach farmhand is trusted, `FARMHAND_OPEN_ACCESS=1` removes the login: every request acts as an admin, setup is skipped and sign-out disappears. Anyone on that network can then restart services and start backups.

## Reference stack

`deploy/compose/docker-compose.yml` runs Spoolman, PrintStash, FDM Monster, OrcaSlicer, Mainsail and the Mobileraker companion with pinned images. Copy it with its `.env.example`, set `FARMHAND_DATA_DIR`, `TZ` and `LAN_IP`, then `docker compose -p farmhand up -d`. Point `COMPOSE_FILE` in `helper.env` at it.

## Verify

```bash
systemctl status farmhand farmhand-helper.socket
curl -s http://127.0.0.1:3490/api/health
```

In the UI, Settings → Integrations shows which credentials are set and which apps answer; Maintenance → Services shows the compose state through the helper.

## Upgrade

Unpack the new tarball and run `deploy/install.sh` again. Database migrations run at the next start.

## Uninstall

```bash
sudo systemctl disable --now farmhand farmhand-helper.socket farmhand-guard
sudo rm -rf /opt/farmhand /usr/local/libexec/farmhand /etc/systemd/system/farmhand*
sudo systemctl daemon-reload
```

Keep or remove `/var/lib/farmhand` (database) and `/etc/farmhand` (configuration) as you prefer.
