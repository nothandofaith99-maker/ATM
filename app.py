import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


APP_DIR = Path(__file__).resolve().parent
DATABASE = APP_DIR / "atm.db"
STARTING_BALANCE_CENTS = 100_000
PIN = os.environ.get("ATM_PIN", "1234")
SESSIONS = set()


def connect_db():
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_db():
    with connect_db() as db:
        db.execute(
            """CREATE TABLE IF NOT EXISTS account (
                   id INTEGER PRIMARY KEY CHECK (id = 1),
                   pin_hash TEXT NOT NULL,
                   balance_cents INTEGER NOT NULL
               )"""
        )
        db.execute(
            """CREATE TABLE IF NOT EXISTS transactions (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   kind TEXT NOT NULL,
                   amount_cents INTEGER NOT NULL,
                   balance_cents INTEGER NOT NULL,
                   created_at TEXT NOT NULL
               )"""
        )
        account = db.execute("SELECT id FROM account WHERE id = 1").fetchone()
        if account is None:
            pin_hash = hashlib.sha256(PIN.encode("utf-8")).hexdigest()
            db.execute(
                "INSERT INTO account (id, pin_hash, balance_cents) VALUES (1, ?, ?)",
                (pin_hash, STARTING_BALANCE_CENTS),
            )


class ATMHandler(BaseHTTPRequestHandler):
    def send_json(self, status, payload, headers=None):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if headers:
            for name, value in headers.items():
                self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > 4096:
                raise ValueError
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError
            return payload
        except (ValueError, json.JSONDecodeError):
            self.send_json(400, {"error": "Please send a valid JSON request."})
            return None

    def get_session(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
            token = cookie["atm_session"].value
        except (KeyError, AttributeError):
            return None
        return token if token in SESSIONS else None

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/":
            try:
                body = (APP_DIR / "index.html").read_bytes()
            except OSError:
                self.send_error(500, "Could not load the ATM interface.")
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path.startswith("/api/"):
            if not self.get_session():
                self.send_json(401, {"error": "Please sign in to continue."})
                return
            if path == "/api/account":
                with connect_db() as db:
                    account = db.execute(
                        "SELECT balance_cents FROM account WHERE id = 1"
                    ).fetchone()
                    transactions = db.execute(
                        """SELECT kind, amount_cents, balance_cents, created_at
                           FROM transactions ORDER BY id DESC LIMIT 8"""
                    ).fetchall()
                self.send_json(
                    200,
                    {
                        "balance_cents": account["balance_cents"],
                        "transactions": [dict(row) for row in transactions],
                    },
                )
                return
        self.send_error(404)

    def do_POST(self):
        path = urlparse(self.path).path
        payload = self.read_json()
        if payload is None:
            return

        if path == "/api/login":
            entered_pin = payload.get("pin")
            if not isinstance(entered_pin, str) or not hmac.compare_digest(
                entered_pin, PIN
            ):
                self.send_json(401, {"error": "That PIN is incorrect."})
                return
            token = secrets.token_urlsafe(32)
            SESSIONS.add(token)
            self.send_json(
                200,
                {"message": "Signed in successfully."},
                {
                    "Set-Cookie": (
                        f"atm_session={token}; HttpOnly; SameSite=Strict; Path=/"
                    )
                },
            )
            return

        if path == "/api/logout":
            token = self.get_session()
            if token:
                SESSIONS.discard(token)
            self.send_json(
                200,
                {"message": "Signed out."},
                {
                    "Set-Cookie": (
                        "atm_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
                    )
                },
            )
            return

        if path in ("/api/deposit", "/api/withdraw"):
            if not self.get_session():
                self.send_json(401, {"error": "Please sign in to continue."})
                return
            amount_cents = payload.get("amount_cents")
            if (
                isinstance(amount_cents, bool)
                or not isinstance(amount_cents, int)
                or amount_cents <= 0
                or amount_cents > 1_000_000_00
            ):
                self.send_json(
                    400, {"error": "Enter an amount between $0.01 and $1,000,000."}
                )
                return

            kind = "deposit" if path == "/api/deposit" else "withdrawal"
            with connect_db() as db:
                db.execute("BEGIN IMMEDIATE")
                account = db.execute(
                    "SELECT balance_cents FROM account WHERE id = 1"
                ).fetchone()
                balance = account["balance_cents"]
                if kind == "withdrawal" and amount_cents > balance:
                    db.rollback()
                    self.send_json(400, {"error": "Insufficient funds."})
                    return
                balance += amount_cents if kind == "deposit" else -amount_cents
                db.execute(
                    "UPDATE account SET balance_cents = ? WHERE id = 1", (balance,)
                )
                db.execute(
                    """INSERT INTO transactions
                       (kind, amount_cents, balance_cents, created_at)
                       VALUES (?, ?, ?, ?)""",
                    (
                        kind,
                        amount_cents,
                        balance,
                        datetime.now(timezone.utc).isoformat(),
                    ),
                )
            self.send_json(200, {"balance_cents": balance})
            return

        self.send_error(404)

    def log_message(self, format_string, *args):
        print(f"{self.address_string()} - {format_string % args}")


def main():
    initialize_db()
    server = ThreadingHTTPServer(("127.0.0.1", 8000), ATMHandler)
    print("ATM app is running at http://127.0.0.1:8000")
    print("Demo PIN: set ATM_PIN to change the default PIN (1234).")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping ATM app.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
