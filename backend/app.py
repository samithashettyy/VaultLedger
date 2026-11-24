"""
SQLite persistence for VaultLedger consortium state.

Stores ONLY coordination state:
    users, sessions, manual flags, investigations, participation consent,
    PSI/encryption outputs, decryption-share approvals, identity-reveal
    requests/votes and audit logs.

Bank transactions and customer records are NOT stored here - they stay in
each bank's own CSV files (see ../dataset/bank_X/).
"""

import os
import sqlite3
from datetime import datetime
from pathlib import Path

from werkzeug.security import generate_password_hash

DB_PATH = Path(
    os.environ.get(
        "VAULTLEDGER_DB",
        Path(__file__).resolve().parent / "vaultledger.db",
    )
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    bank          TEXT NOT NULL,
    display_name  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    username   TEXT NOT NULL,
    bank       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS manual_flags (
    bank       TEXT NOT NULL,
    account_id TEXT NOT NULL,
    flagged    INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (bank, account_id)
);

CREATE TABLE IF NOT EXISTS investigations (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    code             TEXT UNIQUE,
    initiator        TEXT NOT NULL,
    purpose          TEXT NOT NULL,
    status           TEXT NOT NULL,
    current_step     INTEGER NOT NULL DEFAULT 1,
    reveal_threshold INTEGER NOT NULL DEFAULT 2,
    psi_json         TEXT,
    crypto_blob      BLOB,
    error            TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
    investigation_id INTEGER NOT NULL,
    bank             TEXT NOT NULL,
    role             TEXT NOT NULL,
    consent          TEXT NOT NULL,
    consent_at       TEXT,
    PRIMARY KEY (investigation_id, bank)
);

CREATE TABLE IF NOT EXISTS results (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    investigation_id INTEGER NOT NULL,
    token            TEXT NOT NULL,
    entity_id        TEXT NOT NULL,   -- NEVER serialised before identity reveal
    banks_json       TEXT NOT NULL,
    bank_count       INTEGER NOT NULL,
    enc_json         TEXT,            -- per-bank ciphertexts only (no plaintext)
    aggregate_cipher TEXT,
    joint_sum        INTEGER,
    joint_risk       REAL,
    decrypted        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS decryption_approvals (
    investigation_id INTEGER NOT NULL,
    bank             TEXT NOT NULL,
    created_at       TEXT NOT NULL,
    PRIMARY KEY (investigation_id, bank)
);

CREATE TABLE IF NOT EXISTS identity_requests (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    investigation_id INTEGER NOT NULL,
    result_id        INTEGER NOT NULL,
    requested_by     TEXT NOT NULL,
    status           TEXT NOT NULL,   -- PENDING | REVEALED | DENIED
    threshold        INTEGER NOT NULL,
    eligible_json    TEXT NOT NULL,
    reason           TEXT,
    created_at       TEXT NOT NULL,
    resolved_at      TEXT
);

CREATE TABLE IF NOT EXISTS identity_votes (
    request_id INTEGER NOT NULL,
    bank       TEXT NOT NULL,
    decision   TEXT NOT NULL,         -- APPROVE | REJECT
    created_at TEXT NOT NULL,
    PRIMARY KEY (request_id, bank)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    ts               TEXT NOT NULL,
    bank             TEXT NOT NULL,
    action           TEXT NOT NULL,
    investigation_id TEXT,
    account_ref      TEXT,
    details          TEXT
);
"""

# Demo logins.
SEED_USERS = [
    ("bank_a", "bank_a123", "A", "Bank A"),
    ("bank_b", "bank_b123", "B", "Bank B"),
    ("bank_c", "bank_c123", "C", "Bank C"),
]


def now():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def connect():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = connect()
    conn.executescript(SCHEMA)

    for username, password, bank, display in SEED_USERS:
        exists = conn.execute(
            "SELECT 1 FROM users WHERE username = ?", (username,)
        ).fetchone()

        if not exists:
            conn.execute(
                "INSERT INTO users (username, password_hash, bank, display_name)"
                " VALUES (?, ?, ?, ?)",
                (username, generate_password_hash(password, method="pbkdf2:sha256"), bank, display),
            )

    conn.commit()
    conn.close()


def audit(conn, bank, action, investigation=None, account_ref=None, details=None):
    """Append one audit-log entry (caller commits)."""
    conn.execute(
        "INSERT INTO audit_logs (ts, bank, action, investigation_id, account_ref, details)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (now(), bank, action, investigation, account_ref, details),
    )


# ==================== HTTP API and application ====================
import engine

"""Flask API for the VaultLedger cross-bank fraud detection demo.

Bank-specific endpoints (/api/banks/<id>/...) are only reachable with that
bank's login. Cross-bank investigation endpoints never expose raw
transactions, customer data or another bank's plaintext scores, and account
identities stay hidden until enough banks approve a reveal request.
"""

import json
import os
import secrets
from datetime import datetime, timedelta
from pathlib import Path
from functools import wraps

from flask import Flask, g, jsonify, request, send_from_directory
from flask_cors import CORS
from werkzeug.security import check_password_hash





FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"

app = Flask(__name__, static_folder=None)
CORS(app)

DECRYPT_THRESHOLD = 2
REVEAL_THRESHOLD = max(2, int(os.environ.get("VAULTLEDGER_REVEAL_THRESHOLD", "2")))
MEDIUM_RISK_THRESHOLD = 30
SESSION_HOURS = 12
BANK_NAMES = {b: f"Bank {b}" for b in engine.BANKS}

# Weights of the local rule engine: local_risk_score is the weighted sum of these factors.
FACTOR_WEIGHTS = [
    ("velocity_score", "Transaction Velocity", 0.15),
    ("structuring_score", "Structuring", 0.30),
    ("cross_bank_counterparty_score", "Cross-Bank Counterparty", 0.25),
    ("pass_through_score", "Pass-Through", 0.30),
]


# Infrastructure

class ApiError(Exception):
    def __init__(self, message, status=400, **extra):
        super().__init__(message)
        self.message = message
        self.status = status
        self.extra = extra


@app.errorhandler(ApiError)
def handle_api_error(e):
    return jsonify({"error": e.message, **e.extra}), e.status


@app.errorhandler(Exception)
def handle_unexpected(e):  # pragma: no cover
    import traceback
    traceback.print_exc()
    return jsonify({"error": "Internal server error"}), 500


def conn():
    if "db" not in g:
        g.db = connect()
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    c = g.pop("db", None)
    if c is not None:
        c.close()


def auth_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        token = header[7:] if header.startswith("Bearer ") else None

        if not token:
            raise ApiError("Authentication required", 401)

        row = conn().execute(
            "SELECT * FROM sessions WHERE token = ?", (token,)
        ).fetchone()

        if not row or row["expires_at"] < now():
            raise ApiError("Session expired - please log in again", 401)

        g.bank = row["bank"]
        g.username = row["username"]
        g.token = token
        return fn(*args, **kwargs)

    return wrapper


def norm_bank(value):
    b = str(value or "").upper().replace("BANK_", "").replace("BANK", "").strip()
    if b not in engine.BANKS:
        raise ApiError("Unknown bank", 404)
    return b


def own_bank_only(bank_id):
    bank = norm_bank(bank_id)
    if bank != g.bank:
        raise ApiError(
            "Forbidden: you can only access your own bank's data. "
            "Raw customer and transaction data never leaves its bank.",
            403,
        )
    return bank


def body():
    return request.get_json(silent=True) or {}


def short(token):
    return f"{token[:4]}…{token[-4:]}"


# Local account helpers (data owned by ONE bank)

def risk_level(score):
    if score >= engine.ACCOUNT_RISK_THRESHOLD:
        return "HIGH"
    if score >= MEDIUM_RISK_THRESHOLD:
        return "MEDIUM"
    return "LOW"


def bank_accounts(bank):
    """All local accounts of `bank` with effective flag state."""
    c = conn()
    overrides = {
        r["account_id"]: bool(r["flagged"])
        for r in c.execute(
            "SELECT account_id, flagged FROM manual_flags WHERE bank = ?", (bank,)
        )
    }

    out = []
    table = engine.NODES[bank].account_table()

    for rec in table.to_dict(orient="records"):
        score = int(rec["local_risk_score"])
        level = risk_level(score)
        base = score >= engine.ACCOUNT_RISK_THRESHOLD
        override = overrides.get(rec["account_id"])
        flagged = base if override is None else override
        manual = None
        if override is not None and override != base:
            manual = "FLAGGED" if override else "UNFLAGGED"

        if flagged:
            status = "FLAGGED"
        elif level == "MEDIUM":
            status = "MEDIUM RISK"
        else:
            status = "NORMAL"

        out.append({
            "account_id": rec["account_id"],
            "customer_name": rec.get("full_name"),
            "account_type": rec.get("account_type"),
            "city": rec.get("city"),
            "kyc_risk_tier": rec.get("kyc_risk_tier"),
            "risk_score": score,
            "risk_level": level,
            "status": status,
            "flagged": bool(flagged),
            "manual_override": manual,
            "_rec": rec,
        })

    return out


def public_account(a):
    return {k: v for k, v in a.items() if not k.startswith("_")}


def find_account(bank, account_id):
    for a in bank_accounts(bank):
        if a["account_id"] == account_id:
            return a
    raise ApiError("Account not found at this bank", 404)


# Investigation helpers

def get_investigation(code):
    inv = conn().execute(
        "SELECT * FROM investigations WHERE code = ?", (code,)
    ).fetchone()
    if not inv:
        raise ApiError("Investigation not found", 404)
    return inv


def participants_of(inv_id):
    return [
        dict(r) for r in conn().execute(
            "SELECT bank, role, consent, consent_at FROM participants"
            " WHERE investigation_id = ? ORDER BY role DESC, bank",
            (inv_id,),
        )
    ]


def require_participant(code):
    """Return the investigation if the logged-in bank takes part in it."""
    inv = get_investigation(code)
    mine = conn().execute(
        "SELECT * FROM participants WHERE investigation_id = ? AND bank = ?",
        (inv["id"], g.bank),
    ).fetchone()
    if not mine:
        raise ApiError("You are not a participant of this investigation", 403)
    return inv, mine


def identity_request_view(req, me):
    c = conn()
    votes = {
        v["bank"]: v["decision"]
        for v in c.execute(
            "SELECT bank, decision FROM identity_votes WHERE request_id = ?",
            (req["id"],),
        )
    }
    eligible = json.loads(req["eligible_json"])
    approvals = sorted(b for b, d in votes.items() if d == "APPROVE")
    rejections = sorted(b for b, d in votes.items() if d == "REJECT")
    pending = [b for b in eligible if b not in votes]

    return {
        "id": req["id"],
        "result_id": req["result_id"],
        "requested_by": req["requested_by"],
        "reason": req["reason"],
        "status": req["status"],
        "threshold": req["threshold"],
        "eligible_banks": eligible,
        "approvals": approvals,
        "rejections": rejections,
        "pending": pending,
        "my_vote": votes.get(me),
        "can_vote": req["status"] == "PENDING" and me in eligible and me not in votes,
        "created_at": req["created_at"],
        "resolved_at": req["resolved_at"],
    }


def latest_identity_request(result_id):
    return conn().execute(
        "SELECT * FROM identity_requests WHERE result_id = ?"
        " ORDER BY id DESC LIMIT 1",
        (result_id,),
    ).fetchone()


def result_view(r, me, include_enc=False):
    """
    Serialise a PSI match for the logged-in bank.

    NEVER includes entity_id unless an identity-reveal request for this
    match has reached its approval threshold AND `me` is a flagging bank.
    """
    banks = json.loads(r["banks_json"])
    req = latest_identity_request(r["id"])
    req_view = identity_request_view(req, me) if req else None
    decrypted = bool(r["decrypted"])
    eligible = me in banks

    identity = {"state": "PROTECTED"}
    if req and req["status"] == "REVEALED" and eligible:
        identity = {
            "state": "REVEALED",
            "entity_id": r["entity_id"],
            "local_account_id": engine.NODES[me].account_for_entity(r["entity_id"]),
        }

    if not decrypted:
        risk_status = "PENDING DECRYPTION"
    elif r["joint_risk"] >= engine.ACCOUNT_RISK_THRESHOLD:
        risk_status = "HIGH RISK"
    else:
        risk_status = "LOW RISK"

    return {
        "id": r["id"],
        "token": r["token"],
        "token_short": short(r["token"]),
        "banks": banks,
        "bank_count": r["bank_count"],
        "joint_risk": round(r["joint_risk"], 1) if decrypted else None,
        "decrypted": decrypted,
        "risk_status": risk_status,
        "fraud_ring_candidate": risk_status == "HIGH RISK",
        "identity": identity,
        "identity_request": req_view,
        "can_request_identity": (
            decrypted and eligible
            and (req is None or req["status"] == "DENIED")
        ),
        "i_flagged": eligible,
    }


def results_of(inv_id):
    return conn().execute(
        "SELECT * FROM results WHERE investigation_id = ? ORDER BY id", (inv_id,)
    ).fetchall()


def investigation_view(inv, me, detail=False):
    c = conn()
    parts = participants_of(inv["id"])
    mine = next((p for p in parts if p["bank"] == me), None)
    approvals = [
        r["bank"] for r in c.execute(
            "SELECT bank FROM decryption_approvals WHERE investigation_id = ?"
            " ORDER BY bank", (inv["id"],),
        )
    ]
    results = results_of(inv["id"])

    view = {
        "id": inv["code"],
        "initiator": inv["initiator"],
        "purpose": inv["purpose"],
        "status": inv["status"],
        "current_step": inv["current_step"],
        "steps": engine.STEPS,
        "created_at": inv["created_at"],
        "updated_at": inv["updated_at"],
        "error": inv["error"],
        "participants": parts,
        "my_consent": mine["consent"] if mine else None,
        "can_run": inv["status"] == "APPROVED" and inv["initiator"] == me,
        "decryption": {
            "required": DECRYPT_THRESHOLD,
            "participants": [p["bank"] for p in parts],
            "approvals": approvals,
            "my_share_approved": me in approvals,
        },
        "reveal_threshold": inv["reveal_threshold"],
        "suspicious_count": len(results),
        "high_risk_count": sum(
            1 for r in results
            if r["decrypted"] and r["joint_risk"] >= engine.ACCOUNT_RISK_THRESHOLD
        ),
        "psi": json.loads(inv["psi_json"]) if inv["psi_json"] else None,
    }

    if detail:
        view["timeline"] = [
            dict(r) for r in c.execute(
                "SELECT id, ts, bank, action, investigation_id, account_ref, details"
                " FROM audit_logs WHERE investigation_id = ? ORDER BY id",
                (inv["code"],),
            )
        ]

    return view


# Auth

@app.post("/api/login")
def login():
    data = body()
    username = str(data.get("username", "")).strip().lower()
    password = str(data.get("password", ""))
    bank = data.get("bank")

    c = conn()
    user = c.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()

    if not user or not check_password_hash(user["password_hash"], password):
        if user:
            audit(c, user["bank"], "LOGIN_FAILED", details="Invalid password")
            c.commit()
        raise ApiError("Invalid username or password", 401)

    if bank and norm_bank(bank) != user["bank"]:
        raise ApiError(
            f"These credentials do not belong to {BANK_NAMES[norm_bank(bank)]}", 401
        )

    token = secrets.token_hex(24)
    expires = (datetime.now().astimezone() + timedelta(hours=SESSION_HOURS))
    c.execute(
        "INSERT INTO sessions (token, username, bank, created_at, expires_at)"
        " VALUES (?, ?, ?, ?, ?)",
        (token, user["username"], user["bank"], now(),
         expires.isoformat(timespec="seconds")),
    )
    audit(c, user["bank"], "LOGIN", details=f"User {user['username']} signed in")
    c.commit()

    return jsonify({
        "token": token,
        "bank": user["bank"],
        "bank_name": BANK_NAMES[user["bank"]],
        "username": user["username"],
    })


@app.post("/api/logout")
@auth_required
def logout():
    c = conn()
    c.execute("DELETE FROM sessions WHERE token = ?", (g.token,))
    audit(c, g.bank, "LOGOUT", details=f"User {g.username} signed out")
    c.commit()
    return jsonify({"ok": True})


@app.get("/api/me")
@auth_required
def me():
    return jsonify({
        "bank": g.bank,
        "bank_name": BANK_NAMES[g.bank],
        "username": g.username,
    })


# Bank-local endpoints (owner only)

@app.get("/api/banks/<bank_id>/summary")
@auth_required
def bank_summary(bank_id):
    bank = own_bank_only(bank_id)
    c = conn()
    accounts = bank_accounts(bank)
    n = len(accounts)

    flagged = sum(1 for a in accounts if a["flagged"])
    medium = sum(1 for a in accounts if a["status"] == "MEDIUM RISK")
    normal = sum(1 for a in accounts if a["status"] == "NORMAL")
    avg = sum(a["risk_score"] for a in accounts) / n if n else 0

    invs = c.execute(
        "SELECT i.* FROM investigations i JOIN participants p"
        " ON p.investigation_id = i.id WHERE p.bank = ?", (bank,),
    ).fetchall()

    pending_requests = sum(
        1 for i in invs
        if i["status"] == "PENDING_CONSENT" and any(
            p["bank"] == bank and p["consent"] == "PENDING"
            for p in participants_of(i["id"])
        )
    )
    active = sum(
        1 for i in invs
        if i["status"] in ("PENDING_CONSENT", "APPROVED", "RUNNING", "AWAITING_DECRYPTION")
    )
    completed = sum(1 for i in invs if i["status"] == "COMPLETED")

    suspicious = high = 0
    for i in invs:
        for r in results_of(i["id"]):
            suspicious += 1
            if r["decrypted"] and r["joint_risk"] >= engine.ACCOUNT_RISK_THRESHOLD:
                high += 1

    pending_identity = len(pending_identity_requests(bank))
    pending_shares = sum(
        1 for i in invs
        if i["status"] == "AWAITING_DECRYPTION" and not c.execute(
            "SELECT 1 FROM decryption_approvals WHERE investigation_id = ? AND bank = ?",
            (i["id"], bank),
        ).fetchone()
    )

    return jsonify({
        "bank": bank,
        "bank_name": BANK_NAMES[bank],
        "threshold": engine.ACCOUNT_RISK_THRESHOLD,
        "medium_threshold": MEDIUM_RISK_THRESHOLD,
        "total_customers": n,
        "total_transactions": engine.NODES[bank].summary()["transactions"],
        "normal": normal,
        "medium": medium,
        "flagged": flagged,
        "average_risk": round(avg, 1),
        "manual_overrides": sum(1 for a in accounts if a["manual_override"]),
        "investigations": {
            "pending_requests": pending_requests,
            "active": active,
            "completed": completed,
            "pending_decryption_approvals": pending_shares,
        },
        "alerts": {
            "suspicious_accounts": suspicious,
            "high_risk_matches": high,
            "pending_identity_requests": pending_identity,
        },
        "privacy": {
            "raw_data": "LOCAL ONLY",
            "encrypted_risk_sharing": "ENABLED",
            "threshold_consent": f"{DECRYPT_THRESHOLD}-of-{len(engine.BANKS)}",
            "identity_reveal_threshold": REVEAL_THRESHOLD,
        },
    })


@app.get("/api/banks/<bank_id>/customers")
@auth_required
def bank_customers(bank_id):
    bank = own_bank_only(bank_id)
    return jsonify({
        "bank": bank,
        "threshold": engine.ACCOUNT_RISK_THRESHOLD,
        "customers": [public_account(a) for a in bank_accounts(bank)],
    })


@app.get("/api/banks/<bank_id>/customers/<account_id>")
@auth_required
def bank_customer(bank_id, account_id):
    bank = own_bank_only(bank_id)
    acct = find_account(bank, account_id)
    rec = acct["_rec"]

    factors, weighted = [], 0.0
    for key, label, weight in FACTOR_WEIGHTS:
        score = float(rec.get(key, 0) or 0)
        contribution = score * weight
        weighted += contribution
        factors.append({
            "key": key,
            "label": label,
            "score": round(score, 1),
            "weight": weight,
            "contribution": round(contribution, 1),
        })

    history = [
        dict(r) for r in conn().execute(
            "SELECT ts, bank, action, details FROM audit_logs WHERE bank = ?"
            " AND account_ref = ? ORDER BY id DESC LIMIT 20",
            (bank, account_id),
        )
    ]

    return jsonify({
        **public_account(acct),
        "factors": factors,
        "weighted_sum": round(weighted, 1),
        "threshold": engine.ACCOUNT_RISK_THRESHOLD,
        "activity": engine.NODES[bank].account_activity(account_id),
        "history": history,
        "visibility": f"Visible only to {BANK_NAMES[bank]}",
    })


def set_flag(bank_id, account_id, flagged):
    bank = own_bank_only(bank_id)
    acct = find_account(bank, account_id)

    if acct["flagged"] == flagged:
        raise ApiError(
            "Account is already flagged" if flagged else "Account is not flagged",
            409,
        )

    c = conn()
    c.execute(
        "INSERT INTO manual_flags (bank, account_id, flagged, updated_at)"
        " VALUES (?, ?, ?, ?) ON CONFLICT(bank, account_id) DO UPDATE SET"
        " flagged = excluded.flagged, updated_at = excluded.updated_at",
        (bank, account_id, int(flagged), now()),
    )
    audit(
        c, bank,
        "LOCAL_ACCOUNT_FLAGGED" if flagged else "LOCAL_ACCOUNT_UNFLAGGED",
        account_ref=account_id,
        details=str(body().get("reason") or "Manual local decision") +
                " (local only - other banks unaffected)",
    )
    c.commit()

    engine.apply_overrides(c, bank)
    return jsonify(public_account(find_account(bank, account_id)))


@app.post("/api/banks/<bank_id>/customers/<account_id>/flag")
@auth_required
def flag_account(bank_id, account_id):
    return set_flag(bank_id, account_id, True)


@app.post("/api/banks/<bank_id>/customers/<account_id>/unflag")
@auth_required
def unflag_account(bank_id, account_id):
    return set_flag(bank_id, account_id, False)


@app.post("/api/banks/<bank_id>/local-analysis")
@auth_required
def local_analysis(bank_id):
    bank = own_bank_only(bank_id)
    c = conn()
    engine.apply_overrides(c, bank)
    accounts = bank_accounts(bank)
    name = BANK_NAMES[bank]

    flagged = sum(1 for a in accounts if a["flagged"])
    txns = engine.NODES[bank].summary()["transactions"]

    audit(
        c, bank, "LOCAL_RISK_ANALYSIS_RUN",
        details=f"{len(accounts)} accounts analysed locally, {flagged} flagged",
    )
    c.commit()

    return jsonify({
        "bank": bank,
        "bank_name": name,
        "threshold": engine.ACCOUNT_RISK_THRESHOLD,
        "accounts_analyzed": len(accounts),
        "transactions_analyzed": txns,
        "flagged": flagged,
        "normal": sum(1 for a in accounts if a["status"] == "NORMAL"),
        "medium": sum(1 for a in accounts if a["status"] == "MEDIUM RISK"),
        "ran_at": now(),
        "pipeline": [
            {"label": name, "detail": "Data owner"},
            {"label": "Local transaction data", "detail": f"{txns:,} transactions read locally"},
            {"label": "Account-level risk calculation",
             "detail": "Velocity, structuring, cross-bank counterparty, pass-through"},
            {"label": f"Risk threshold = {engine.ACCOUNT_RISK_THRESHOLD}",
             "detail": "Scores at or above the threshold are flagged"},
            {"label": "Local flagged accounts", "detail": f"{flagged} accounts flagged"},
        ],
        "message": f"Raw transaction data never leaves {name}.",
    })


# Investigations: creation & participation consent

@app.post("/api/investigations")
@auth_required
def create_investigation():
    data = body()
    invited = []
    for b in data.get("participants", []):
        nb = norm_bank(b)
        if nb != g.bank and nb not in invited:
            invited.append(nb)

    if not invited:
        raise ApiError("Select at least one other bank to invite", 400)

    purpose = str(data.get("purpose") or "Privacy-preserving fraud detection")[:200]

    c = conn()
    cur = c.execute(
        "INSERT INTO investigations (initiator, purpose, status, current_step,"
        " reveal_threshold, created_at, updated_at) VALUES (?, ?, 'PENDING_CONSENT',"
        " 1, ?, ?, ?)",
        (g.bank, purpose, REVEAL_THRESHOLD, now(), now()),
    )
    inv_id = cur.lastrowid
    code = f"VL-{inv_id:04d}"
    c.execute("UPDATE investigations SET code = ? WHERE id = ?", (code, inv_id))

    c.execute(
        "INSERT INTO participants VALUES (?, ?, 'INITIATOR', 'APPROVED', ?)",
        (inv_id, g.bank, now()),
    )
    for b in invited:
        c.execute(
            "INSERT INTO participants VALUES (?, ?, 'INVITED', 'PENDING', NULL)",
            (inv_id, b),
        )

    audit(
        c, g.bank, "INVESTIGATION_INITIATED", code,
        details="Invited: " + ", ".join(BANK_NAMES[b] for b in invited),
    )
    audit(c, g.bank, "PARTICIPATION_APPROVED", code,
             details="Initiator participation")
    c.commit()

    return jsonify(investigation_view(get_investigation(code), g.bank, True)), 201


@app.get("/api/investigations")
@auth_required
def list_investigations():
    rows = conn().execute(
        "SELECT i.* FROM investigations i JOIN participants p"
        " ON p.investigation_id = i.id WHERE p.bank = ? ORDER BY i.id DESC",
        (g.bank,),
    ).fetchall()
    return jsonify({"investigations": [investigation_view(i, g.bank) for i in rows]})


@app.get("/api/investigations/<code>")
@auth_required
def get_investigation_detail(code):
    inv, _ = require_participant(code)
    return jsonify(investigation_view(inv, g.bank, True))


@app.post("/api/investigations/<code>/participate")
@auth_required
def participate(code):
    inv, mine = require_participant(code)
    if inv["status"] != "PENDING_CONSENT" or mine["consent"] != "PENDING":
        raise ApiError("No participation decision is pending for your bank", 409)

    c = conn()
    c.execute(
        "UPDATE participants SET consent = 'APPROVED', consent_at = ?"
        " WHERE investigation_id = ? AND bank = ?",
        (now(), inv["id"], g.bank),
    )
    audit(c, g.bank, "PARTICIPATION_APPROVED", code,
             details="Bank agreed to participate")

    remaining = c.execute(
        "SELECT COUNT(*) n FROM participants WHERE investigation_id = ?"
        " AND consent != 'APPROVED'", (inv["id"],),
    ).fetchone()["n"]

    if remaining == 0:
        c.execute(
            "UPDATE investigations SET status = 'APPROVED', current_step = 2,"
            " updated_at = ? WHERE id = ?", (now(), inv["id"]),
        )
        audit(c, "COORDINATOR", "ALL_PARTICIPANTS_APPROVED", code,
                 details="Participation approved by every required bank")
    c.commit()

    return jsonify(investigation_view(get_investigation(code), g.bank, True))


@app.post("/api/investigations/<code>/decline")
@auth_required
def decline(code):
    inv, mine = require_participant(code)
    if inv["status"] != "PENDING_CONSENT" or mine["consent"] != "PENDING":
        raise ApiError("No participation decision is pending for your bank", 409)

    c = conn()
    c.execute(
        "UPDATE participants SET consent = 'DECLINED', consent_at = ?"
        " WHERE investigation_id = ? AND bank = ?",
        (now(), inv["id"], g.bank),
    )
    c.execute(
        "UPDATE investigations SET status = 'CANCELLED', updated_at = ? WHERE id = ?",
        (now(), inv["id"]),
    )
    audit(c, g.bank, "PARTICIPATION_DECLINED", code,
             details="Bank declined to participate")
    audit(c, "COORDINATOR", "INVESTIGATION_CANCELLED", code,
             details="Required participation consent not obtained - "
                     "no PSI, encryption or aggregation performed")
    c.commit()

    return jsonify(investigation_view(get_investigation(code), g.bank, True))


@app.post("/api/investigations/<code>/run")
@auth_required
def run_investigation(code):
    inv, _ = require_participant(code)

    if inv["initiator"] != g.bank:
        raise ApiError("Only the initiating bank can start the analysis", 403)

    # Hard consent gate: every participant must have explicitly approved.
    consents = participants_of(inv["id"])
    if inv["status"] != "APPROVED" or any(p["consent"] != "APPROVED" for p in consents):
        raise ApiError(
            "Cryptographic analysis cannot start until all required "
            "participating banks have approved.", 409,
        )

    c = conn()
    c.execute(
        "UPDATE investigations SET status = 'RUNNING', current_step = 2,"
        " updated_at = ? WHERE id = ?", (now(), inv["id"]),
    )
    audit(c, g.bank, "ANALYSIS_STARTED", code,
             details="Cryptographic pipeline started after full consent")
    c.commit()

    engine.start_pipeline(inv["id"])
    return jsonify(investigation_view(get_investigation(code), g.bank, True)), 202


# Cross-bank views (never contain raw transactions)

@app.get("/api/investigations/<code>/psi")
@auth_required
def psi_view(code):
    inv, _ = require_participant(code)
    if not inv["psi_json"]:
        return jsonify({"available": False, "status": inv["status"]})

    info = json.loads(inv["psi_json"])
    matches = []
    if inv["current_step"] >= 4:
        matches = [
            {
                "token": r["token"],
                "token_short": short(r["token"]),
                "banks": json.loads(r["banks_json"]),
                "bank_count": r["bank_count"],
            }
            for r in results_of(inv["id"])
        ]

    return jsonify({
        "available": True,
        "my_bank": g.bank,
        "participants": [p["bank"] for p in participants_of(inv["id"])],
        # Only the set SIZES are visible - never another bank's list.
        "set_sizes": info["set_sizes"],
        "min_banks": info["min_banks"],
        "group_bits": info["group_bits"],
        "matches": matches,
        "stage_complete": inv["current_step"] >= 4,
        "note": "Only cross-bank matches are revealed. Raw flagged-account "
                "lists remain private.",
    })


@app.get("/api/investigations/<code>/encryption")
@auth_required
def encryption_view(code):
    inv, _ = require_participant(code)
    items = []
    for r in results_of(inv["id"]):
        if not r["enc_json"]:
            continue
        enc = json.loads(r["enc_json"])
        items.append({
            "token": r["token"],
            "token_short": short(r["token"]),
            "banks": [
                {
                    "bank": b,
                    "ciphertext": enc[b],
                    # A bank can only ever see ITS OWN plaintext score.
                    "local_risk": (
                        engine.NODES[b].risk_for_account(r["entity_id"])
                        if b == g.bank else None
                    ),
                    "plaintext_hidden": b != g.bank,
                }
                for b in sorted(enc)
            ],
        })

    return jsonify({
        "available": bool(items),
        "my_bank": g.bank,
        "accounts": items,
        "note": "Local plaintext risk is protected before aggregation. "
                "The ciphertext is NOT the account's risk value.",
    })


@app.get("/api/investigations/<code>/aggregation")
@auth_required
def aggregation_view(code):
    inv, _ = require_participant(code)
    items = []
    for r in results_of(inv["id"]):
        if not r["aggregate_cipher"]:
            continue
        enc = json.loads(r["enc_json"])
        items.append({
            "token": r["token"],
            "token_short": short(r["token"]),
            "inputs": [
                {
                    "bank": b,
                    "ciphertext": enc[b],
                    "label": (
                        f"E({int(engine.NODES[b].risk_for_account(r['entity_id']))})"
                        if b == g.bank else "E(?)"
                    ),
                }
                for b in sorted(enc)
            ],
            "aggregate_cipher": r["aggregate_cipher"],
        })

    return jsonify({
        "available": bool(items),
        "accounts": items,
        "coordinator_can_read_plaintext": False,
        "note": "The coordinator multiplies ciphertexts (= adds plaintexts). "
                "It cannot read individual plaintext scores.",
    })


@app.get("/api/investigations/<code>/results")
@auth_required
def results_view(code):
    inv, _ = require_participant(code)
    return jsonify({
        "investigation": investigation_view(inv, g.bank, True),
        "results": [result_view(r, g.bank) for r in results_of(inv["id"])],
    })


# 2-of-3 threshold decryption (consent gate on key shares)

@app.post("/api/investigations/<code>/decryption-approve")
@auth_required
def decryption_approve(code):
    inv, _ = require_participant(code)
    if inv["status"] != "AWAITING_DECRYPTION":
        raise ApiError("Investigation is not awaiting threshold decryption", 409)

    c = conn()
    try:
        c.execute(
            "INSERT INTO decryption_approvals VALUES (?, ?, ?)",
            (inv["id"], g.bank, now()),
        )
    except Exception:
        raise ApiError("Your key share is already approved", 409)

    audit(c, g.bank, "DECRYPTION_SHARE_APPROVED", code,
             details="Bank approved use of its threshold key share")
    c.commit()
    return jsonify(investigation_view(get_investigation(code), g.bank, True))


@app.post("/api/investigations/<code>/decrypt")
@auth_required
def decrypt(code):
    inv, _ = require_participant(code)
    if inv["status"] != "AWAITING_DECRYPTION":
        raise ApiError("Investigation is not awaiting threshold decryption", 409)

    c = conn()
    paillier = engine.load_paillier(inv["crypto_blob"])
    results = results_of(inv["id"])
    demo_single = body().get("mode") == "single_share"

    approvals = [
        r["bank"] for r in c.execute(
            "SELECT bank FROM decryption_approvals WHERE investigation_id = ?"
            " ORDER BY bank", (inv["id"],),
        )
    ]
    banks_used = [g.bank] if demo_single else approvals

    # ThresholdPaillier.combine: it raises
    # PermissionError when fewer than 2 key shares are supplied.
    try:
        computed = {
            r["id"]: engine.try_decrypt(
                paillier, int(r["aggregate_cipher"]), banks_used[:2]
            )
            for r in results
        }
    except PermissionError as denied:
        audit(c, g.bank, "DECRYPTION_DENIED", code,
                 details=f"{len(banks_used)} of {DECRYPT_THRESHOLD} required key "
                         "shares - decryption refused")
        c.commit()
        return jsonify({
            "denied": True,
            "message": str(denied),
            "shares_provided": len(banks_used),
            "shares_required": DECRYPT_THRESHOLD,
            "coordinator_alone": "DENIED",
        }), 403

    if demo_single:  # cannot be reached with 1 share; defensive
        raise ApiError("Demonstration mode never decrypts", 400)

    for r in results:
        total = int(computed[r["id"]])
        c.execute(
            "UPDATE results SET joint_sum = ?, joint_risk = ?, decrypted = 1"
            " WHERE id = ?",
            (total, total / r["bank_count"], r["id"]),
        )
        audit(c, "COORDINATOR", "JOINT_RISK_DECRYPTED", code,
                 account_ref=short(r["token"]),
                 details="Joint risk recovered via 2-of-3 threshold decryption")

    for b in banks_used[:2]:
        audit(c, b, "DECRYPTION_APPROVED", code,
                 details="Key share used in partial decryption")

    c.execute(
        "UPDATE investigations SET status = 'COMPLETED', current_step = 8,"
        " updated_at = ? WHERE id = ?", (now(), inv["id"]),
    )
    c.commit()

    return jsonify({
        "denied": False,
        "shares_provided": len(banks_used[:2]),
        "shares_required": DECRYPT_THRESHOLD,
        "investigation": investigation_view(get_investigation(code), g.bank, True),
    })


# Identity reveal - separate consent stage

def evaluate_identity_request(req_id, inv_code, token):
    """Resolve an identity request once approvals/rejections decide it."""
    c = conn()
    req = c.execute("SELECT * FROM identity_requests WHERE id = ?", (req_id,)).fetchone()
    if req["status"] != "PENDING":
        return

    eligible = json.loads(req["eligible_json"])
    votes = c.execute(
        "SELECT decision FROM identity_votes WHERE request_id = ?", (req_id,)
    ).fetchall()
    approvals = sum(1 for v in votes if v["decision"] == "APPROVE")
    rejections = sum(1 for v in votes if v["decision"] == "REJECT")

    # Identity is NEVER revealed with fewer than 2 approvals.
    if approvals >= max(2, req["threshold"]):
        c.execute(
            "UPDATE identity_requests SET status = 'REVEALED', resolved_at = ?"
            " WHERE id = ?", (now(), req_id),
        )
        audit(c, "COORDINATOR", "IDENTITY_REVEALED", inv_code,
                 account_ref=short(token),
                 details=f"Threshold reached ({approvals}/{len(eligible)} approvals)")
    elif rejections > len(eligible) - req["threshold"]:
        c.execute(
            "UPDATE identity_requests SET status = 'DENIED', resolved_at = ?"
            " WHERE id = ?", (now(), req_id),
        )
        audit(c, "COORDINATOR", "IDENTITY_REVEAL_DENIED", inv_code,
                 account_ref=short(token),
                 details="Approval threshold can no longer be reached; "
                         "identity stays protected")
    c.commit()


@app.post("/api/investigations/<code>/identity-request")
@auth_required
def identity_request(code):
    inv, _ = require_participant(code)
    data = body()

    if inv["status"] != "COMPLETED":
        raise ApiError("Identity reveal can only be requested after "
                       "threshold decryption has completed", 409)

    c = conn()
    r = c.execute(
        "SELECT * FROM results WHERE id = ? AND investigation_id = ?",
        (data.get("result_id"), inv["id"]),
    ).fetchone()
    if not r or not r["decrypted"]:
        raise ApiError("Suspicious account not found", 404)

    banks = json.loads(r["banks_json"])
    if g.bank not in banks:
        raise ApiError("Only banks that flagged this account can request "
                       "its identity", 403)

    existing = latest_identity_request(r["id"])
    if existing and existing["status"] in ("PENDING", "REVEALED"):
        raise ApiError("An identity reveal request already exists for this "
                       "account", 409)

    threshold = max(2, min(inv["reveal_threshold"], len(banks)))
    reason = str(data.get("reason") or "Cross-bank fraud investigation")[:200]

    cur = c.execute(
        "INSERT INTO identity_requests (investigation_id, result_id, requested_by,"
        " status, threshold, eligible_json, reason, created_at)"
        " VALUES (?, ?, ?, 'PENDING', ?, ?, ?, ?)",
        (inv["id"], r["id"], g.bank, threshold, json.dumps(banks), reason, now()),
    )
    req_id = cur.lastrowid
    c.execute("INSERT INTO identity_votes VALUES (?, ?, 'APPROVE', ?)",
              (req_id, g.bank, now()))
    audit(c, g.bank, "IDENTITY_REVEAL_REQUESTED", code,
             account_ref=short(r["token"]), details=reason)
    c.commit()

    evaluate_identity_request(req_id, code, r["token"])
    return jsonify(result_view(
        c.execute("SELECT * FROM results WHERE id = ?", (r["id"],)).fetchone(),
        g.bank,
    )), 201


def cast_identity_vote(code, decision):
    inv, _ = require_participant(code)
    c = conn()
    req = c.execute(
        "SELECT * FROM identity_requests WHERE id = ? AND investigation_id = ?",
        (body().get("request_id"), inv["id"]),
    ).fetchone()
    if not req:
        raise ApiError("Identity request not found", 404)
    if req["status"] != "PENDING":
        raise ApiError("This identity request is already resolved", 409)
    if g.bank not in json.loads(req["eligible_json"]):
        raise ApiError("Your bank did not flag this account, so it cannot vote", 403)
    if c.execute("SELECT 1 FROM identity_votes WHERE request_id = ? AND bank = ?",
                 (req["id"], g.bank)).fetchone():
        raise ApiError("Your bank has already voted on this request", 409)

    r = c.execute("SELECT * FROM results WHERE id = ?", (req["result_id"],)).fetchone()
    c.execute("INSERT INTO identity_votes VALUES (?, ?, ?, ?)",
              (req["id"], g.bank, decision, now()))
    audit(
        c, g.bank,
        "IDENTITY_REVEAL_APPROVED" if decision == "APPROVE" else "IDENTITY_REVEAL_REJECTED",
        code, account_ref=short(r["token"]),
        details=("Bank agreed to reveal identity" if decision == "APPROVE"
                 else "Bank chose to keep identity private"),
    )
    c.commit()

    evaluate_identity_request(req["id"], code, r["token"])
    return jsonify(result_view(
        c.execute("SELECT * FROM results WHERE id = ?", (r["id"],)).fetchone(),
        g.bank,
    ))


@app.post("/api/investigations/<code>/identity-approve")
@auth_required
def identity_approve(code):
    return cast_identity_vote(code, "APPROVE")


@app.post("/api/investigations/<code>/identity-reject")
@auth_required
def identity_reject(code):
    return cast_identity_vote(code, "REJECT")


def pending_identity_requests(bank):
    c = conn()
    out = []
    for req in c.execute(
        "SELECT * FROM identity_requests WHERE status = 'PENDING' ORDER BY id DESC"
    ):
        if bank in json.loads(req["eligible_json"]) and not c.execute(
            "SELECT 1 FROM identity_votes WHERE request_id = ? AND bank = ?",
            (req["id"], bank),
        ).fetchone():
            out.append(req)
    return out


# Cross-investigation lists

@app.get("/api/suspicious-accounts")
@auth_required
def suspicious_accounts():
    c = conn()
    items = []
    for inv in c.execute(
        "SELECT i.* FROM investigations i JOIN participants p"
        " ON p.investigation_id = i.id WHERE p.bank = ? ORDER BY i.id DESC",
        (g.bank,),
    ):
        for r in results_of(inv["id"]):
            items.append({
                "investigation_id": inv["code"],
                "investigation_status": inv["status"],
                "initiator": inv["initiator"],
                **result_view(r, g.bank),
            })
    return jsonify({"accounts": items})


@app.get("/api/identity-requests")
@auth_required
def identity_requests():
    c = conn()
    items = []
    for req in c.execute("SELECT * FROM identity_requests ORDER BY id DESC"):
        if g.bank not in json.loads(req["eligible_json"]):
            continue
        inv = c.execute("SELECT * FROM investigations WHERE id = ?",
                        (req["investigation_id"],)).fetchone()
        r = c.execute("SELECT * FROM results WHERE id = ?", (req["result_id"],)).fetchone()
        items.append({
            "investigation_id": inv["code"],
            "request": identity_request_view(req, g.bank),
            "account": result_view(r, g.bank),
        })
    return jsonify({"requests": items})


# Audit logs

@app.get("/api/audit-logs")
@auth_required
def audit_logs():
    c = conn()
    my_investigations = [
        r["code"] for r in c.execute(
            "SELECT i.code FROM investigations i JOIN participants p"
            " ON p.investigation_id = i.id WHERE p.bank = ?", (g.bank,),
        )
    ]
    marks = ",".join("?" * len(my_investigations)) or "''"
    rows = c.execute(
        "SELECT id, ts, bank, action, investigation_id, account_ref, details"
        " FROM audit_logs WHERE bank = ? OR investigation_id IN (" + marks + ")"
        " ORDER BY id DESC LIMIT ?",
        (g.bank, *my_investigations, int(request.args.get("limit", 500))),
    ).fetchall()
    return jsonify({"logs": [dict(r) for r in rows]})


@app.get("/api/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    if path.startswith("api/"):
        return jsonify({"error": "Endpoint not found"}), 404
    static_file = FRONTEND_DIST / path
    if path and static_file.is_file():
        return send_from_directory(str(FRONTEND_DIST), path)
    return send_from_directory(str(FRONTEND_DIST), "index.html")


def bootstrap():
    init_db()
    c = connect()
    engine.init_nodes(c)
    # Pipelines interrupted by a restart cannot resume (in-memory stage).
    c.execute("UPDATE investigations SET status = 'FAILED', error = ?"
              " WHERE status = 'RUNNING'", ("Server restarted during analysis",))
    c.commit()
    c.close()


engine.configure_storage(connect=connect, audit=audit, now=now)
bootstrap()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    print(f"VaultLedger running at http://localhost:{port}")
    app.run(
        host="0.0.0.0",
        port=port,
        threaded=True,
        debug=False,
    )
