#!/usr/bin/env bash
# Install or update farmhand from an unpacked release directory.
#
#   sudo ./deploy/install.sh
#
# Expects the release layout next to this script: apps/server/dist,
# apps/server/node_modules, apps/web/dist, deploy/. Safe to re-run: existing env
# files are never overwritten, only blank BETTER_AUTH_SECRET / ALLOWED_UID are filled.
set -euo pipefail

SRC=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
APP=/opt/farmhand
DATA=/var/lib/farmhand
ETC=/etc/farmhand
LIBEXEC=/usr/local/libexec/farmhand
UNITS=/etc/systemd/system

say() { echo "farmhand-install: $*"; }
die() { echo "farmhand-install: $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run as root (sudo $0)"
for f in apps/server/dist/index.js apps/web/dist deploy/helper/farmhand-helper; do
  [ -e "$SRC/$f" ] || die "missing $SRC/$f; run from an unpacked release"
done
[ -x /usr/bin/node ] || die "/usr/bin/node not found; install Node.js 22 first"
[ -x /usr/bin/python3 ] || die "/usr/bin/python3 not found"
command -v openssl >/dev/null || die "openssl not found"

# 1. Service user. No shell, no home.
if ! getent group farmhand >/dev/null; then groupadd --system farmhand; say "created group farmhand"; fi
if ! id farmhand >/dev/null 2>&1; then
  useradd --system --gid farmhand --no-create-home --home-dir "$DATA" --shell /usr/sbin/nologin farmhand
  say "created user farmhand"
fi
uid=$(id -u farmhand)

# 2. Directories. The app tree is root-owned: farmhand-helper runs the compose
# file under it as root, so the service user must not be able to change it.
install -d -o root -g farmhand -m 0750 "$APP"
install -d -o farmhand -g farmhand -m 0750 "$DATA"
install -d -o root -g root -m 0750 "$ETC"
install -d -o root -g root -m 0755 "$LIBEXEC"

# 3. Application.
if [ "$SRC" != "$APP" ]; then
  for d in apps/server/dist apps/server/node_modules apps/web/dist deploy; do
    [ -e "$SRC/$d" ] || continue
    rm -rf "${APP:?}/$d"
    install -d -o root -g root -m 0755 "$(dirname "$APP/$d")"
    cp -a "$SRC/$d" "$APP/$d"
  done
  [ -f "$SRC/apps/server/package.json" ] && cp "$SRC/apps/server/package.json" "$APP/apps/server/package.json"
  chown -R root:root "$APP/apps" "$APP/deploy"
  chmod -R u+rwX,go+rX,go-w "$APP/apps" "$APP/deploy"
  say "copied application to $APP"
fi

# 4. Root helper, guard and units.
install -o root -g root -m 0755 "$SRC/deploy/helper/farmhand-helper" "$LIBEXEC/farmhand-helper"
install -o root -g root -m 0755 "$SRC/deploy/guard/farmhand-guard.sh" "$LIBEXEC/farmhand-guard.sh"
for u in systemd/farmhand.service systemd/farmhand-helper.socket systemd/farmhand-helper.service \
         guard/farmhand-guard.service; do
  install -o root -g root -m 0644 "$SRC/deploy/$u" "$UNITS/$(basename "$u")"
done
install -o root -g root -m 0644 "$SRC/deploy/systemd/farmhand.tmpfiles.conf" /etc/tmpfiles.d/farmhand.conf
systemd-tmpfiles --create /etc/tmpfiles.d/farmhand.conf
say "installed helper, guard and units"

# 5. Configuration. Never overwrite; fill only blank generated values.
if [ ! -e "$ETC/farmhand.env" ]; then
  install -o root -g farmhand -m 0640 "$SRC/deploy/farmhand.env.example" "$ETC/farmhand.env"
  say "created $ETC/farmhand.env"
fi
chown root:farmhand "$ETC/farmhand.env"; chmod 0640 "$ETC/farmhand.env"
if grep -qx 'BETTER_AUTH_SECRET=' "$ETC/farmhand.env" || ! grep -q '^BETTER_AUTH_SECRET=' "$ETC/farmhand.env"; then
  secret=$(openssl rand -base64 48 | tr -d '\n')
  tmp=$(mktemp "$ETC/.farmhand.env.XXXXXX")
  { grep -v '^BETTER_AUTH_SECRET=' "$ETC/farmhand.env"; echo "BETTER_AUTH_SECRET=$secret"; } >"$tmp"
  chown root:farmhand "$tmp"; chmod 0640 "$tmp"; mv -f "$tmp" "$ETC/farmhand.env"
  unset secret
  say "generated BETTER_AUTH_SECRET"
fi

if [ ! -e "$ETC/helper.env" ]; then
  install -o root -g root -m 0644 "$SRC/deploy/helper.env.example" "$ETC/helper.env"
  say "created $ETC/helper.env"
fi
chown root:root "$ETC/helper.env"; chmod 0644 "$ETC/helper.env"
if grep -qx 'ALLOWED_UID=' "$ETC/helper.env" || ! grep -q '^ALLOWED_UID=' "$ETC/helper.env"; then
  tmp=$(mktemp "$ETC/.helper.env.XXXXXX")
  { grep -v '^ALLOWED_UID=' "$ETC/helper.env"; echo "ALLOWED_UID=$uid"; } >"$tmp"
  chmod 0644 "$tmp"; mv -f "$tmp" "$ETC/helper.env"
  say "set ALLOWED_UID=$uid in helper.env"
fi
setting() { sed -n "s/^$1=//p" "$2" | tail -n1; }
allow=$(setting ALLOW_FILE "$ETC/helper.env")
if [ -n "$allow" ] && [ ! -e "$allow" ]; then
  install -d -o root -g root -m 0755 "$(dirname "$allow")"
  install -o root -g root -m 0644 /dev/null "$allow"
  say "created empty allowlist $allow"
fi
if [ -e "$SRC/deploy/compose/.env.example" ] && [ ! -e "$APP/deploy/compose/.env" ]; then
  install -o root -g root -m 0640 "$SRC/deploy/compose/.env.example" "$APP/deploy/compose/.env"
  say "created $APP/deploy/compose/.env (set FARMHAND_DATA_DIR and LAN_IP there)"
fi

# 6. Enable and (re)start.
systemctl daemon-reload
systemctl enable --now farmhand-helper.socket
systemctl try-restart farmhand-helper.service
if [ -n "$(setting LAN_IP "$ETC/helper.env")" ]; then
  systemctl enable farmhand-guard.service
  systemctl restart farmhand-guard.service
  say "guard enabled"
else
  say "LAN_IP is empty in $ETC/helper.env: guard not enabled (Spoolman's LAN port is not filtered)"
fi
systemctl enable farmhand.service
systemctl restart farmhand.service
say "farmhand.service started"

url=$(setting FARMHAND_PUBLIC_URL "$ETC/farmhand.env")
say "done. Open ${url:-http://localhost:3490}."
say "next: edit $ETC/farmhand.env (service logins) and $APP/deploy/compose/.env, then"
say "      docker compose -p farmhand -f $APP/deploy/compose/docker-compose.yml up -d"
