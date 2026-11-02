# Integrations

farmhand talks to five things. None of them is a versioned contract, so every response is parsed with a schema and an unexpected shape is reported as `unexpected_response` rather than guessed at.

## Moonraker

- `GET /server/info` — identity probe (`klippy_state`, `moonraker_version`).
- `GET /printer/info` — hostname, used as the default printer name.
- `ws://host:port/websocket` — JSON-RPC `printer.objects.subscribe` for `print_stats`, `virtual_sdcard`, `display_status`, `extruder`, `heater_bed`, `webhooks`. Notifications `notify_status_update`, `notify_klippy_ready`, `notify_klippy_shutdown`, `notify_klippy_disconnected` update the live state.
- Discovery looks for `_moonraker._tcp` with `avahi-browse`; enable `[zeroconf]` in `moonraker.conf` so a printer announces itself. Printers in the host's neighbour table are probed on 7125.

No print commands are ever sent.

## PrintStash (0.15.x)

- `POST /api/v1/auth/login` with `{username,password}` → `access_token`.
- `GET /api/v1/printers` → list; farmhand matches on `moonraker_url`.
- `POST /api/v1/printers` with `{name, provider:"moonraker", moonraker_url}`.
- `GET /api/v1/health` for the health badge.
- On an empty registry farmhand adopts every Moonraker printer PrintStash knows.

## FDM Monster (2.1.x)

- `POST /api/v2/auth/login` → `token`.
- `GET /api/v2/printer` → list; matched on `printerURL`.
- `POST /api/v2/printer` with `{name, printerURL, printerType:1, apiKey:"", enabled:true}`. FDM Monster contacts the printer when it is created, so a printer that is off makes this step fail; retry from the printer page.
- `GET /api/v2/test` for health.

## Spoolman (0.27.x)

- `GET /api/v1/health`.
- `GET /api/v1/spool?allow_archived=false` → stock summary. Spools without `remaining_weight` are counted separately and never as zero.
- Spoolman has no login. On a LAN the guard (`deploy/guard`) only lets allowlisted printers reach its port.

## Mobileraker companion

Configured by file: the helper appends a `[printer <name>]` section with `moonraker_uri` to `mobileraker.conf` and recreates the `mobileraker` compose service (profile `companion`). The companion is kept stopped until the first printer is approved.

## Home Assistant (optional)

When `HA_URL` and `HA_DISCOVERY_WEBHOOK` are set, the scheduled discovery posts `{host,port}` to `HA_URL/api/webhook/<id>` for every printer seen for the first time. Manual discovery from the UI never notifies.
