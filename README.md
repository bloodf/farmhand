# farmhand

Self-hosted control room for a Klipper/Moonraker 3D print farm.

farmhand sits on top of the tools you already run — [PrintStash](https://github.com/xiao-villamor/printstash) for the job queue, [FDM Monster](https://github.com/fdm-monster/fdm-monster) for the fleet grid, [Spoolman](https://github.com/Donkie/Spoolman) for filament, [Mobileraker](https://github.com/Clon1998/mobileraker_companion) for phone notifications, OrcaSlicer in the browser — and gives you the one screen they don't: find a new printer on the network, approve it once, and have it registered everywhere, with live status, diagnostics and maintenance in the same place. No terminal needed after install.

**Status:** 0.1.x, running on one farm. Install from the [releases](https://github.com/bloodf/farmhand/releases) following [docs/install.md](docs/install.md). Roadmap in [docs/roadmap.md](docs/roadmap.md).

## What it does

- Finds Moonraker printers on your LAN (mDNS and neighbour table) and lists them as candidates. Nothing joins the farm without your approval.
- Approve wizard: shows exactly what will change (LAN allowlist, PrintStash, FDM Monster, Mobileraker), runs each step, shows the result per step, and lets you retry only what failed.
- Live overview: who is printing, progress, temperatures, who is offline, filament stock, app health. A source that is down is shown as down, never as zero.
- Printer page: integration checklist, diagnostics, copy-paste snippets for `moonraker.conf` `[spoolman]`, Home Assistant and the Mobileraker app.
- Maintenance: restart one service with a readiness check, read sanitized logs, trigger the host backup.
- Accounts with roles (admin, operator, viewer), English and Brazilian Portuguese, light and dark.

## What it does not do

- Send print commands. PrintStash owns the queue; FDM Monster handles manual control.
- Run arbitrary shell. Root work goes through a helper with a fixed set of verbs, see [SECURITY.md](SECURITY.md).

## Develop

```bash
pnpm install
pnpm dev:fake   # fake printers and apps, no hardware needed
pnpm dev        # http://localhost:5173
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. Bundled Claude Code skills keep their own licenses, see [NOTICE](NOTICE).
