"""이 컴퓨터에서만 장부를 엽니다. 127.0.0.1 바깥으로는 열리지 않습니다."""

from __future__ import annotations

import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LEDGER = ROOT / "data" / "ledger.json"
HOST = "127.0.0.1"
PORT = 8787
MAX_BYTES = 1_000_000


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/api/health":
            self._json(200, {"ok": True})
            return
        super().do_GET()

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/api/ledger":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0 or length > MAX_BYTES:
            self.send_error(413)
            return
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_error(400)
            return
        if not isinstance(data, dict):
            self.send_error(400)
            return
        if not isinstance(data.get("profile"), dict):
            self.send_error(400)
            return
        if not isinstance(data.get("events"), list) or not isinstance(data.get("appointments"), list):
            self.send_error(400)
            return
        LEDGER.parent.mkdir(exist_ok=True)
        LEDGER.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        self._json(200, {"ok": True})

    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))


def main():
    ThreadingHTTPServer.allow_reuse_address = True
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError:
        print(f"Port {PORT} is already in use.")
        print("Close the other ledger window, then open start-ledger.bat again.")
        raise SystemExit(1)
    print("Mom care ledger")
    print(f"http://{HOST}:{PORT}")
    print("This window must stay open. Closing it stops the ledger.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Stopped.")


if __name__ == "__main__":
    main()
