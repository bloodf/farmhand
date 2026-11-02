"""Tests for farmhand-helper. Real binaries are replaced by shell shims that log argv."""

import fcntl
import importlib.machinery
import importlib.util
import json
import os
import pathlib
import socket
import sys
import tempfile
import threading
import unittest
from unittest import mock

sys.dont_write_bytecode = True
HERE = pathlib.Path(__file__).resolve().parent
SHIMS = pathlib.Path(tempfile.mkdtemp(prefix="farmhand-shims-"))
LOG = SHIMS / "calls.log"

SHIM_SOURCE = {
    "docker": """case " $* " in
  *" ps "*) cat "{d}/ps.json" ;;
  *" logs "*) cat "{d}/logs.txt" ;;
esac""",
    "systemctl": """case "$1" in
  is-active) cat "{d}/is-active" 2>/dev/null || echo inactive ;;
  show) cat "{d}/show.txt" ;;
esac""",
    "journalctl": 'cat "{d}/journal.txt"',
    "ip": 'cat "{d}/ip.json"',
}
for _name, _body in SHIM_SOURCE.items():
    _path = SHIMS / _name
    _path.write_text(f'#!/bin/sh\necho "{_name} $*" >> "{LOG}"\n{_body.format(d=SHIMS)}\nexit 0\n')
    _path.chmod(0o755)

os.environ["FARMHAND_HELPER_BIN_DIR"] = str(SHIMS)
_loader = importlib.machinery.SourceFileLoader("farmhand_helper", str(HERE / "farmhand-helper"))
_spec = importlib.util.spec_from_loader("farmhand_helper", _loader)
helper = importlib.util.module_from_spec(_spec)
_loader.exec_module(helper)
helper.POLL_INTERVAL = 0

IP_JSON = [{"ifname": "br0", "addr_info": [{"family": "inet", "local": "10.77.88.1", "prefixlen": 24}]}]


def ps_line(service, state="running", health="healthy"):
    return json.dumps({"Service": service, "State": state, "Health": health})


def tearDownModule():
    for p in SHIMS.iterdir():
        p.unlink()
    SHIMS.rmdir()


class HelperTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self._tmp.name)
        self.allow = self.dir / "printers.allow"
        self.mr = self.dir / "mobileraker" / "mobileraker.conf"
        self.lock = self.dir / "farmhand.lock"
        self.env = self.dir / "helper.env"
        self.write_env()
        LOG.write_text("")
        (SHIMS / "ip.json").write_text(json.dumps(IP_JSON))
        (SHIMS / "is-active").write_text("active\n")
        (SHIMS / "logs.txt").write_text("")
        (SHIMS / "journal.txt").write_text("")
        (SHIMS / "show.txt").write_text("")
        self.set_ps(*(ps_line(s) for s in helper.SERVICES if s != "mobileraker"))

    def tearDown(self):
        self._tmp.cleanup()

    def write_env(self, **over):
        values = {
            "COMPOSE_FILE": "/srv/compose/docker-compose.yml",
            "ALLOW_FILE": str(self.allow),
            "MR_CONF": str(self.mr),
            "GUARD_UNIT": "farmhand-guard.service",
            "BACKUP_UNIT": "farmhand-backup.service",
            "LOCK_FILE": str(self.lock),
            "TZ": "America/Sao_Paulo",
            "LAN_IFACES": "br0",
            "ALLOWED_UID": str(os.getuid()),
            **over,
        }
        self.env.write_text("# test\n" + "".join(f"{k}={v}\n" for k, v in values.items()))
        helper.ENV_FILE = str(self.env)

    def set_ps(self, *lines):
        (SHIMS / "ps.json").write_text("\n".join(lines) + "\n")

    def call(self, **req):
        return helper.dispatch(req, helper.load_config(str(self.env)))

    def calls(self):
        return LOG.read_text().splitlines()

    # --- read verbs -------------------------------------------------------

    def test_ping(self):
        self.assertEqual(self.call(op="ping"), {"ok": True})

    def test_unknown_op(self):
        self.assertEqual(self.call(op="rm-rf")["code"], "invalid")
        self.assertEqual(helper.dispatch(["op"], {})["code"], "invalid")

    def test_status_line_format(self):
        r = self.call(op="status")
        self.assertTrue(r["ok"])
        self.assertEqual(r["guard"], "active")
        by = {s["service"]: s for s in r["services"]}
        self.assertEqual(list(by), list(helper.SERVICES))
        self.assertEqual(by["spoolman"], {"service": "spoolman", "state": "running", "health": "healthy"})
        self.assertEqual(by["mobileraker"]["state"], "missing")
        self.assertIn("docker compose -f /srv/compose/docker-compose.yml -p farmhand --profile companion ps -a "
                      "--format json", self.calls())

    def test_status_array_format_and_guard_not_configured(self):
        (SHIMS / "ps.json").write_text(json.dumps([
            {"Service": "spoolman", "State": "exited", "Health": ""},
            {"Service": "printstash", "State": "running", "Health": "unhealthy"},
            {"Service": "nginx", "State": "running", "Health": ""},
        ]))
        self.write_env(GUARD_UNIT="")
        r = self.call(op="status")
        by = {s["service"]: s for s in r["services"]}
        self.assertEqual((by["spoolman"]["state"], by["spoolman"]["health"]), ("exited", "none"))
        self.assertEqual(by["printstash"]["health"], "unhealthy")
        self.assertEqual(r["guard"], "not_configured")
        self.assertNotIn("nginx", by)

    # --- allowlist --------------------------------------------------------

    def test_allowlist_add_is_idempotent(self):
        self.allow.write_text("# approved printers\n10.77.88.10")
        r = self.call(op="allowlist-add", ip="10.77.88.20")
        self.assertEqual(r, {"ok": True, "already": False})
        self.assertEqual(self.allow.read_text(), "# approved printers\n10.77.88.10\n10.77.88.20\n")
        self.assertEqual(self.call(op="allowlist-add", ip="10.77.88.20"), {"ok": True, "already": True})
        self.assertEqual(self.allow.read_text().count("10.77.88.20"), 1)
        self.assertEqual(self.calls().count("systemctl reload farmhand-guard.service"), 2)
        self.assertEqual(self.call(op="allowlist-list"), {"ok": True, "ips": ["10.77.88.10", "10.77.88.20"]})

    def test_allowlist_not_configured(self):
        self.write_env(GUARD_UNIT="")
        self.assertEqual(self.call(op="allowlist-add", ip="10.77.88.20")["code"], "not_configured")
        self.assertFalse(self.allow.exists())

    def test_ip_validation(self):
        for ip, reason in [
            ("192.168.1.5", "outside the directly connected LAN"),
            ("10.77.88.1", "belongs to this server"),
            ("10.77.88.0", "network or broadcast"),
            ("10.77.88.255", "network or broadcast"),
            ("127.0.0.1", "class not allowed"),
            ("169.254.1.1", "class not allowed"),
            ("224.0.0.1", "class not allowed"),
            ("010.77.88.5", "not an IPv4"),
            ("10.77.88.5/24", "not an IPv4"),
            ("printer.local", "not an IPv4"),
        ]:
            with self.subTest(ip=ip):
                r = self.call(op="allowlist-add", ip=ip)
                self.assertEqual(r["code"], "invalid")
                self.assertIn(reason, r["message"])
        self.assertEqual(self.call(op="allowlist-add", ip=None)["code"], "invalid")
        self.assertFalse(self.allow.exists())

    def test_empty_lan_ifaces_fails_closed(self):
        self.write_env(LAN_IFACES=",")
        self.assertEqual(self.call(op="allowlist-add", ip="10.77.88.20")["code"], "invalid")

    # --- mobileraker ------------------------------------------------------

    def test_mobileraker_add_creates_file_and_starts_companion(self):
        r = self.call(op="mobileraker-add", ip="10.77.88.20", port=7125, name="Voron 2.4 #1")
        self.assertEqual(r, {"ok": True, "already": False})
        self.assertEqual(self.mr.read_text(), "[general]\ntimezone: America/Sao_Paulo\n\n[printer Voron 2.4 #1]\n"
                                              "moonraker_uri: ws://10.77.88.20:7125/websocket\n")
        self.assertIn("docker compose -f /srv/compose/docker-compose.yml -p farmhand --profile companion up -d "
                      "--force-recreate mobileraker", self.calls())
        self.assertEqual(self.call(op="mobileraker-list"),
                         {"ok": True, "uris": ["ws://10.77.88.20:7125/websocket"]})

    def test_mobileraker_already_and_collision(self):
        self.call(op="mobileraker-add", ip="10.77.88.20", port=7125, name="Voron")
        self.set_ps(ps_line("mobileraker"))
        LOG.write_text("")
        self.assertEqual(self.call(op="mobileraker-add", ip="10.77.88.20", port=7125, name="Voron"),
                         {"ok": True, "already": True})
        self.assertFalse(any(" up " in c for c in self.calls()))
        self.assertEqual(self.call(op="mobileraker-add", ip="10.77.88.21", port=7125, name="Voron"),
                         {"ok": True, "already": False})
        text = self.mr.read_text()
        self.assertEqual(text.count("[general]"), 1)
        self.assertIn("[printer Voron-10.77.88.21]\nmoonraker_uri: ws://10.77.88.21:7125/websocket\n", text)

    def test_mobileraker_already_but_stopped_restarts_companion(self):
        self.call(op="mobileraker-add", ip="10.77.88.20", port=7125, name="Voron")
        LOG.write_text("")
        self.assertEqual(self.call(op="mobileraker-add", ip="10.77.88.20", port=7125, name="Voron"),
                         {"ok": True, "already": True})
        self.assertTrue(any(c.endswith("up -d --force-recreate mobileraker") for c in self.calls()))

    def test_mobileraker_validation(self):
        for kw in [dict(name="bad]name"), dict(name="[x"), dict(name=" lead"), dict(name="a\nb"), dict(name=""),
                   dict(name="x" * 81), dict(port=0), dict(port=65536), dict(port=True), dict(port="7125"),
                   dict(ip="192.168.1.5")]:
            req = {"ip": "10.77.88.20", "port": 7125, "name": "ok", **kw}
            with self.subTest(**kw):
                self.assertEqual(self.call(op="mobileraker-add", **req)["code"], "invalid")
        self.assertFalse(self.mr.exists())

    # --- restart ----------------------------------------------------------

    def test_restart_ready(self):
        r = self.call(op="restart", service="spoolman")
        self.assertTrue(r["ok"] and r["ready"])
        self.assertEqual(r["state"], "running healthy")
        self.assertIn("T", r["acceptedAt"])
        self.assertTrue(any(c.endswith("restart --timeout 60 spoolman") for c in self.calls()))

    def test_restart_missing_service_uses_up(self):
        self.set_ps(ps_line("spoolman"))
        with mock.patch.object(helper, "READY_TIMEOUT", 0):
            r = self.call(op="restart", service="printstash")
        self.assertEqual((r["ok"], r["state"]), (True, "missing none"))
        self.assertTrue(any(c.endswith("up -d printstash") for c in self.calls()))

    def test_restart_not_ready_after_deadline(self):
        self.set_ps(ps_line("spoolman", "running", "starting"))
        with mock.patch.object(helper, "READY_TIMEOUT", 0):
            r = self.call(op="restart", service="spoolman")
        self.assertEqual((r["ok"], r["ready"], r["state"]), (True, False, "running starting"))

    def test_restart_refusals(self):
        self.assertEqual(self.call(op="restart", service="mobileraker")["code"], "waiting")
        self.mr.parent.mkdir()
        self.mr.write_text("[general]\ntimezone: UTC\n")
        self.assertEqual(self.call(op="restart", service="mobileraker")["code"], "waiting")
        for bad in ("../x", "nginx", "", None, ["spoolman"]):
            with self.subTest(service=bad):
                self.assertEqual(self.call(op="restart", service=bad)["code"], "invalid")
        self.assertFalse(any("restart" in c or " up " in c for c in self.calls()))

    # --- logs -------------------------------------------------------------

    def test_logs_redaction(self):
        (SHIMS / "logs.txt").write_text("\n".join([
            "spoolman-1  | \x1b[32mINFO\x1b[0m Authorization: Bearer abc.def.ghi",
            "spoolman-1  | login password=hunter2 ok",
            'spoolman-1  | {"api_key": "sk-123", "Token":"t0k"}',
            "spoolman-1  | session eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4fw done",
            "spoolman-1  | GET http://user:pw@host/ 200",
            "spoolman-1  | bell\x07here",
        ]) + "\n")
        r = self.call(op="logs", source="spoolman")
        self.assertEqual(r["lines"], [
            "spoolman-1  | INFO Authorization: Bearer [redacted]",
            "spoolman-1  | login password=[redacted] ok",
            'spoolman-1  | {"api_key": "[redacted] "Token":"[redacted]',
            "spoolman-1  | session [jwt] done",
            "spoolman-1  | GET http://[redacted]@host/ 200",
            "spoolman-1  | bell here",
        ])
        self.assertIn("docker compose -f /srv/compose/docker-compose.yml -p farmhand --profile companion logs "
                      "--no-color --tail 100 spoolman", self.calls())

    def test_logs_caps(self):
        (SHIMS / "logs.txt").write_text("".join(f"line {i}\n" for i in range(150)))
        lines = self.call(op="logs", source="orcaslicer")["lines"]
        self.assertEqual(len(lines), 100)
        self.assertEqual(lines[-1], "line 149")
        (SHIMS / "logs.txt").write_text(("x" * 5000 + "\n") * 100)
        lines = self.call(op="logs", source="orcaslicer")["lines"]
        self.assertLessEqual(sum(len(l.encode()) + 1 for l in lines), 64 * 1024)
        self.assertTrue(all(len(l) <= 4096 for l in lines))
        self.assertGreater(len(lines), 10)

    def test_logs_guard_and_invalid(self):
        (SHIMS / "journal.txt").write_text("guard: 2 printer(s) allowed on 10.77.88.1:7912\n")
        r = self.call(op="logs", source="guard")
        self.assertEqual(r["lines"], ["guard: 2 printer(s) allowed on 10.77.88.1:7912"])
        self.assertIn("journalctl -u farmhand-guard.service -n 100 -o cat --no-pager", self.calls())
        for bad in ("../etc/shadow", "nginx", None):
            self.assertEqual(self.call(op="logs", source=bad)["code"], "invalid")

    # --- backup -----------------------------------------------------------

    def test_backup_start(self):
        (SHIMS / "is-active").write_text("inactive\n")
        r = self.call(op="backup-start")
        self.assertTrue(r["ok"])
        self.assertIn("acceptedAt", r)
        self.assertIn("systemctl start --no-block farmhand-backup.service", self.calls())
        (SHIMS / "is-active").write_text("active\n")
        self.assertEqual(self.call(op="backup-start")["code"], "busy")
        self.write_env(BACKUP_UNIT="")
        self.assertEqual(self.call(op="backup-start")["code"], "not_configured")
        self.assertEqual(self.call(op="backup-status")["code"], "not_configured")

    def test_backup_status(self):
        (SHIMS / "show.txt").write_text("ActiveState=inactive\nResult=success\n"
                                        "ExecMainStartTimestamp=@1700000000\nExecMainExitTimestamp=\n")
        r = self.call(op="backup-status")
        self.assertEqual(r, {"ok": True, "activeState": "inactive", "result": "success",
                             "startedAt": "2023-11-14T22:13:20+00:00", "finishedAt": None})

    # --- locking and peers ------------------------------------------------

    def test_busy_when_flock_held_elsewhere(self):
        with open(self.lock, "w") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            self.assertEqual(self.call(op="allowlist-add", ip="10.77.88.20")["code"], "busy")
            self.assertEqual(self.call(op="restart", service="spoolman")["code"], "busy")
            self.assertTrue(self.call(op="allowlist-list")["ok"])
            self.assertTrue(self.call(op="status")["ok"])
        self.assertTrue(self.call(op="allowlist-add", ip="10.77.88.20")["ok"])

    def test_busy_when_in_process_lock_held(self):
        with helper.busy:
            self.assertEqual(self.call(op="backup-start")["code"], "busy")
            self.assertTrue(self.call(op="ping")["ok"])

    def test_denied_uid(self):
        a, b = socket.socketpair()
        with mock.patch.object(helper, "peer_uid", return_value=4242):
            a.sendall(b'{"op":"ping"}\n')
            helper.handle(b)
        self.assertEqual(json.loads(a.recv(4096))["code"], "denied")
        a.close()

    def test_end_to_end_over_unix_socket(self):
        path = str(self.dir / "helper.sock")
        srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        srv.bind(path)
        srv.listen(4)

        def serve(n):
            for _ in range(n):
                conn, _ = srv.accept()
                helper.handle(conn)

        t = threading.Thread(target=serve, args=(3,), daemon=True)
        t.start()

        def request(raw):
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as c:
                c.connect(path)
                c.sendall(raw)
                buf = b""
                while chunk := c.recv(4096):
                    buf += chunk
            self.assertTrue(buf.endswith(b"\n"))
            return json.loads(buf)

        self.assertEqual(request(b'{"op":"ping"}\n'), {"ok": True})
        self.assertEqual(request(b'{"op":"allowlist-add","ip":"10.77.88.30"}\n'), {"ok": True, "already": False})
        self.assertEqual(request(b"not json\n")["code"], "invalid")
        t.join(5)
        srv.close()
        self.assertEqual(self.allow.read_text(), "10.77.88.30\n")


if __name__ == "__main__":
    unittest.main()
