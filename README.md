# Northstar ATM

A small local ATM demo with a Python backend, HTML/CSS/JavaScript frontend, and a
SQLite database. It supports PIN sign-in, balance checks, deposits, withdrawals,
and recent transaction history.

## Run it

From this directory, run:

```powershell
python app.py
```

Then open <http://127.0.0.1:8000>. The default demo PIN is `1234`. To use another
PIN for a fresh database, set the `ATM_PIN` environment variable before the
first start. The initial demo balance is $1,000.00. The SQLite database is
created as `atm.db` in this directory and keeps the account balance and activity
between restarts.

This is a local demonstration, not production banking software. Do not expose it
to the internet or use real financial or account information.
