# Deploying farmhand

farmhand runs as one Node service on a Linux host (Ubuntu 24.04 or Debian 12+, systemd, Docker with the compose plugin). It manages a docker-compose farm stack next to it, and a small root helper does the few things that need root.

## What gets installed

| Path                                  | Owner              | What it is                                             |
| ------------------------------------- | ------------------ | ------------------------------------------------------ |
| `/opt/farmhand`                       | root:farmhand 0750 | Application: `apps/server`, `apps/web/dist`, `deploy/` |
| `/var/lib/farmhand`                   | farmhand 0750      | SQLite database                                        |
| `/etc/farmhand/farmhand.env`          | root:farmhand 0640 | Server settings and service logins                     |
| `/etc/farmhand/helper.env`            | root 0644          | Paths the helper may touch. No secrets                 |
| `/etc/farmhand/printers.allow`        | root 0644          | Approved printer IPs                                   |
| `/usr/local/libexec/farmhand/`        | root 0755          | `farmhand-helper`, `farmhand-guard.sh`                 |
| `farmhand.service`                    |                    | The web server, as user `farmhand`                     |
| `farmhand-helper.socket` / `.service` |                    | The root helper, started on demand                     |
| `farmhand-guard.service`              |                    | nftables filter for Spoolman's LAN port                |

## Install

1. Install Node.js 22 at `/usr/bin/node`, Python 3.11+, Docker with the compose plugin, `nftables` and `openssl`. For printer discovery, also install `avahi-daemon` and `avahi-utils`.
2. Unpack a release and run the installer from it:

   ```sh
   tar xzf farmhand-<version>.tar.gz
   cd farmhand-<version>
   sudo ./deploy/install.sh
   ```

   The installer creates the `farmhand` system user, copies the app to `/opt/farmhand`, installs the helper and units, generates `BETTER_AUTH_SECRET`, and starts everything. It never overwrites an env file that already exists, so you can run it again to upgrade.
3. Edit `/etc/farmhand/helper.env`. Set `LAN_IP` to the host's address on the printer network and `LAN_IFACES` to that interface (for example `br0` or `eth0`). Leave `BACKUP_UNIT` empty unless you have a backup unit.
4. Edit `/opt/farmhand/deploy/compose/.env`. Set `FARMHAND_DATA_DIR`, `TZ` and the same `LAN_IP`. `MR_CONF` in `helper.env` must be `<FARMHAND_DATA_DIR>/mobileraker/mobileraker.conf`.
5. Start the farm stack and the guard:

   ```sh
   sudo docker compose -p farmhand -f /opt/farmhand/deploy/compose/docker-compose.yml up -d
   sudo systemctl enable --now farmhand-guard.service
   ```

6. Edit `/etc/farmhand/farmhand.env`. Set `FARMHAND_PUBLIC_URL` to the address people type in the browser, `FARMHAND_LAN_IP`, and the PrintStash and FDM Monster logins. Then run `sudo systemctl restart farmhand`.
7. Open `FARMHAND_PUBLIC_URL`.

The server listens on `127.0.0.1:3490`. Put a reverse proxy with TLS in front of it, or reach it over a VPN. Do not expose it to the internet as-is.

### Spoolman on PostgreSQL

Spoolman uses SQLite by default. To use an existing PostgreSQL server, set the `SPOOLMAN_DB_*` values in the compose `.env`, then list both files in `helper.env`:

```
COMPOSE_FILE=/opt/farmhand/deploy/compose/docker-compose.yml:/opt/farmhand/deploy/compose/docker-compose.postgres.yml
```

Pass both files to `docker compose` by hand too.

### Check it works

```sh
systemctl status farmhand farmhand-helper.socket farmhand-guard
echo '{"op":"ping"}' | sudo -u farmhand socat - UNIX-CONNECT:/run/farmhand/helper.sock   # {"ok":true}
sudo nft list table inet farmhand_guard
journalctl -u farmhand -n 50
```

## Security model

The web server never runs as root. It runs as `farmhand` with no capabilities, a read-only view of the system, and write access only to `/var/lib/farmhand`.

Some actions do need root: adding a printer to the firewall allowlist, editing the Mobileraker config, restarting a container, starting a backup. These go through `farmhand-helper`, a root-owned Python script that listens on `/run/farmhand/helper.sock`. The helper:

- Accepts connections only from root and the `farmhand` uid, checked with the kernel's peer credentials, not anything the client sends. The socket is also mode 0660, group `farmhand`.
- Knows a fixed list of verbs. Each one runs a fixed command line with a clean environment. It never runs a string it received.
- Validates every input again, even though the server already did. A printer IP must be IPv4 on a network directly attached to `LAN_IFACES`. It cannot be loopback, link-local, multicast, broadcast or one of the host's own addresses. The one exception is an exact `ip:port` listed in `BRIDGE_TARGETS` (see below). Names cannot contain brackets or control characters, so they cannot break out of an INI section.
- Reads its paths only from `/etc/farmhand/helper.env`, which root owns. The application tree in `/opt/farmhand` is also root-owned, because the helper runs the compose file stored there. If the `farmhand` user could edit either one, it could get root.
- Runs one change at a time, using a lock in `/run/lock/farmhand.lock`. A second change while one is running gets `busy` instead of waiting.
- Strips ANSI codes and redacts bearer tokens, passwords, API keys, JWTs and URL credentials from logs before returning them.

Spoolman has to be reachable from the printers, so it also listens on `LAN_IP:7912`. `farmhand-guard` installs an nftables table (`inet farmhand_guard`) that drops traffic to that port unless the source is in `printers.allow`. Approving a printer in the UI adds its IP and reloads the guard. Every other farm UI listens on loopback only.

### Printers behind a bridge on this host

A printer without Moonraker (an Anycubic Kobra X, for example) can be added through a bridge that runs on the farmhand host and speaks the Moonraker API, such as Kobralink. Register the bridge by the host's LAN address, not `127.0.0.1`: PrintStash and FDM Monster run in Docker and cannot reach the host's loopback.

1. List the bridge as `ip:port` in both env files, for example `10.25.16.41:7125`:
   - `FARMHAND_BRIDGE_TARGETS` in `/etc/farmhand/farmhand.env` (comma list; the server refuses to start on a malformed entry).
   - `BRIDGE_TARGETS` in `/etc/farmhand/helper.env` (same value).
2. Restart farmhand: `sudo systemctl restart farmhand`. The helper reads its env on each request.
3. Approve the printer in the UI at that address and port.

Only an exact `ip:port` match may use the host's own address. A different port on the same address is still refused, and every other rule still applies (loopback stays development-only). The Spoolman allowlist step shows as skipped for a bridge, because the host's own address must never go into `printers.allow`. PrintStash, FDM Monster and Mobileraker are set up as usual.

Check: `curl -s http://10.25.16.41:7125/server/info` answers with JSON, and the approval checklist shows the allowlist step as skipped.

Secrets live in `/etc/farmhand/farmhand.env` and the compose service env files, never in the database or the repo.

## Uninstall

```sh
sudo systemctl disable --now farmhand farmhand-helper.socket farmhand-helper farmhand-guard
sudo rm /etc/systemd/system/farmhand*.{service,socket} /etc/tmpfiles.d/farmhand.conf
sudo rm -r /usr/local/libexec/farmhand /opt/farmhand
sudo systemctl daemon-reload
```

`/etc/farmhand`, `/var/lib/farmhand` and the farm data directory are left in place. Remove them yourself if you no longer need them.
