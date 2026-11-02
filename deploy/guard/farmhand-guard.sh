#!/usr/bin/env bash
# Restrict Spoolman's LAN port (7912) to approved printers.
#
# Docker publishes ports through DNAT, so the filter hooks prerouting before
# dstnat (-100): packets to LAN_IP:7912 from any source outside the allowlist
# are dropped before Docker can forward them. Loopback and other host addresses
# are different destinations and stay untouched.
#
# LAN_IP and ALLOW_FILE come from /etc/farmhand/helper.env (root-owned).
set -euo pipefail

HELPER_ENV="${FARMHAND_HELPER_ENV:-/etc/farmhand/helper.env}"
PORT=7912
valid_ipv4() { python3 -I -c 'import ipaddress,sys; ipaddress.IPv4Address(sys.argv[1])' "$1" 2>/dev/null; }
setting() { sed -n "s/^$1=//p" "$HELPER_ENV" | tail -n1 | sed "s/^[\"']//; s/[\"']\$//"; }

[ -r "$HELPER_ENV" ] || { echo "guard: $HELPER_ENV is not readable" >&2; exit 78; }
lan_ip=$(setting LAN_IP)
ALLOW_FILE=$(setting ALLOW_FILE)
valid_ipv4 "$lan_ip" || { echo "guard: LAN_IP missing or invalid in $HELPER_ENV" >&2; exit 78; }
[ -n "$ALLOW_FILE" ] || { echo "guard: ALLOW_FILE missing in $HELPER_ENV" >&2; exit 78; }

ips=()
if [ -r "$ALLOW_FILE" ]; then
  while read -r line || [ -n "$line" ]; do
    line="${line%%#*}"; line="${line//[[:space:]]/}"
    [ -n "$line" ] || continue
    valid_ipv4 "$line" || { echo "guard: invalid IPv4 in $ALLOW_FILE: $line" >&2; exit 65; }
    ips+=("$line")
  done < "$ALLOW_FILE"
fi

elements=""
[ "${#ips[@]}" -gt 0 ] && elements="elements = { $(IFS=,; echo "${ips[*]}") }"

nft -f - <<NFT
table inet farmhand_guard
delete table inet farmhand_guard
table inet farmhand_guard {
  set printers {
    type ipv4_addr
    $elements
  }
  chain prerouting {
    type filter hook prerouting priority -110; policy accept;
    ip daddr $lan_ip tcp dport $PORT ip saddr @printers accept
    ip daddr $lan_ip tcp dport $PORT counter drop
  }
}
NFT
echo "guard: ${#ips[@]} printer(s) allowed on $lan_ip:$PORT"
