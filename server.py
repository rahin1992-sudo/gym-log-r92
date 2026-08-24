#!/usr/bin/env python3
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent
BACKUP_DIR = ROOT / "backups"
ONEDRIVE = Path.home() / "OneDrive" / "BTS-Lift"
LATEST = BACKUP_DIR / "latest.json"
PORT = 8787


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Expose-Headers", "Location")

    def end_headers(self):
        self._cors()
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/backup":
            if not LATEST.exists():
                self.send_response(404)
                self.end_headers()
                return
            data = LATEST.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path != "/api/backup":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        json.loads(body.decode("utf-8"))
        BACKUP_DIR.mkdir(exist_ok=True)
        ONEDRIVE.mkdir(parents=True, exist_ok=True)
        LATEST.write_bytes(body)
        stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
        (BACKUP_DIR / f"bts-{stamp}.json").write_bytes(body)
        (ONEDRIVE / "backup.json").write_bytes(body)
        (ONEDRIVE / f"backup-{stamp}.json").write_bytes(body)
        self.send_response(204)
        self.end_headers()


if __name__ == "__main__":
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"BTS Lift server http://127.0.0.1:{PORT}/")
    httpd.serve_forever()
