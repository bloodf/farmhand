/** `pnpm dev:fake` — a whole fake farm on loopback so the UI can be built without hardware. */
import { createFakeApps, FIXTURE_PASSWORD, FIXTURE_USER } from "./apps.js";
import { createFakeMoonraker } from "./moonraker.js";

export const FAKE_PORTS = {
  printstash: 13460,
  fdm: 14000,
  spoolman: 17912,
  printers: [17125, 17126, 17127],
} as const;

const printers = [
  createFakeMoonraker({
    name: "voron-24",
    port: 17125,
    state: "printing",
    filename: "benchy_0.2mm_PLA.gcode",
  }),
  createFakeMoonraker({ name: "snapmaker-u1", port: 17126, state: "standby" }),
  createFakeMoonraker({ name: "ender-3", port: 17127, state: "error" }),
];
for (const p of printers) p.start();

const apps = createFakeApps({
  printstashPort: FAKE_PORTS.printstash,
  fdmPort: FAKE_PORTS.fdm,
  spoolmanPort: FAKE_PORTS.spoolman,
}).start();

process.stdout.write(
  [
    "fake farm up",
    ...printers.map(
      (p) =>
        `  moonraker  ${p.name.padEnd(14)} http://127.0.0.1:${p.port}  (POST /__control {offline,state,klippy})`,
    ),
    `  printstash http://127.0.0.1:${FAKE_PORTS.printstash}  user ${FIXTURE_USER} / ${FIXTURE_PASSWORD}`,
    `  fdm        http://127.0.0.1:${FAKE_PORTS.fdm}  (POST /__control {fdmFail,fdmDown})`,
    `  spoolman   http://127.0.0.1:${FAKE_PORTS.spoolman}  (POST /__control {spoolmanDown})`,
    "",
  ].join("\n"),
);

const shutdown = async () => {
  await Promise.all([...printers.map((p) => p.stop()), apps.stop()]);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
