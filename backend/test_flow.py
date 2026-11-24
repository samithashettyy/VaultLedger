"""
End-to-end API test of the full VaultLedger demo flow.

Run from the backend folder:
    VAULTLEDGER_STEP_DELAY=0 python test_flow.py

Uses a throw-away SQLite database and Flask's test client.
"""

import os
import tempfile
import time

os.environ["VAULTLEDGER_STEP_DELAY"] = "0"
os.environ["VAULTLEDGER_DB"] = os.path.join(tempfile.mkdtemp(), "test.db")

import app as vault  # noqa: E402

client = vault.app.test_client()
TOK = {}


def call(method, url, bank=None, **kw):
    headers = {"Authorization": f"Bearer {TOK[bank]}"} if bank else {}
    return getattr(client, method)(url, headers=headers, **kw)


def ok(resp, status=200):
    assert resp.status_code == status, (resp.status_code, resp.get_data(as_text=True)[:300])
    return resp.get_json()


# 1. login ---------------------------------------------------------------
for b in "ABC":
    TOK[b] = ok(client.post("/api/login", json={
        "username": f"bank_{b.lower()}", "password": f"bank_{b.lower()}123", "bank": b,
    }))["token"]
assert client.post("/api/login", json={"username": "bank_a", "password": "x"}).status_code == 401
assert client.post("/api/login", json={
    "username": "bank_a", "password": "bank_a123", "bank": "B"}).status_code == 401
print("login ok")

# 2. bank isolation --------------------------------------------------------
assert call("get", "/api/banks/B/customers", "A").status_code == 403
assert call("get", "/api/banks/B/summary", "A").status_code == 403
assert call("get", "/api/banks/A/customers", None).status_code == 401
s = ok(call("get", "/api/banks/A/summary", "A"))
print("summary A:", s["total_customers"], s["total_transactions"], s["flagged"], s["average_risk"])
custs = ok(call("get", "/api/banks/A/customers", "A"))["customers"]
assert len(custs) == s["total_customers"]
detail = ok(call("get", f"/api/banks/A/customers/{custs[0]['account_id']}", "A"))
assert len(detail["factors"]) == 4 and "recent" in detail["activity"]

# 3. local flag / unflag does not touch other banks -------------------------
normal = next(c for c in custs if c["status"] == "NORMAL")
ok(call("post", f"/api/banks/A/customers/{normal['account_id']}/flag", "A"))
assert call("post", f"/api/banks/A/customers/{normal['account_id']}/flag", "A").status_code == 409
assert ok(call("get", "/api/banks/A/summary", "A"))["flagged"] == s["flagged"] + 1
assert ok(call("get", "/api/banks/B/summary", "B"))["manual_overrides"] == 0
ok(call("post", f"/api/banks/A/customers/{normal['account_id']}/unflag", "A"))
assert ok(call("get", "/api/banks/A/summary", "A"))["flagged"] == s["flagged"]
print("flag/unflag ok")

# 4. consent gate -------------------------------------------------------------
inv = ok(call("post", "/api/investigations", "A", json={"participants": ["B", "C"]}), 201)
code = inv["id"]
assert inv["status"] == "PENDING_CONSENT"
assert call("post", f"/api/investigations/{code}/run", "A").status_code == 409  # no consent yet
assert call("get", f"/api/investigations/{code}/psi", "A").get_json()["available"] is False
ok(call("post", f"/api/investigations/{code}/participate", "B"))
assert call("post", f"/api/investigations/{code}/run", "A").status_code == 409  # C missing
ok(call("post", f"/api/investigations/{code}/participate", "C"))
assert ok(call("get", f"/api/investigations/{code}", "A"))["status"] == "APPROVED"

# declined investigation is cancelled and cannot run
inv2 = ok(call("post", "/api/investigations", "A", json={"participants": ["B"]}), 201)
ok(call("post", f"/api/investigations/{inv2['id']}/decline", "B"))
assert call("post", f"/api/investigations/{inv2['id']}/run", "A").status_code == 409
assert ok(call("get", f"/api/investigations/{inv2['id']}", "A"))["status"] == "CANCELLED"
print("consent gate ok")

# 5. pipeline -------------------------------------------------------------------
ok(call("post", f"/api/investigations/{code}/run", "A"), 202)
for _ in range(100):
    st = ok(call("get", f"/api/investigations/{code}", "A"))["status"]
    if st == "AWAITING_DECRYPTION":
        break
    time.sleep(0.2)
assert st == "AWAITING_DECRYPTION", st

psi = ok(call("get", f"/api/investigations/{code}/psi", "A"))
assert psi["matches"] and all(m["bank_count"] >= 2 for m in psi["matches"])
enc = ok(call("get", f"/api/investigations/{code}/encryption", "A"))
row = enc["accounts"][0]["banks"]
assert [b for b in row if b["bank"] == "A"][0]["local_risk"] is not None
assert all(b["local_risk"] is None for b in row if b["bank"] != "A")  # others' plaintext hidden
agg = ok(call("get", f"/api/investigations/{code}/aggregation", "A"))
assert agg["coordinator_can_read_plaintext"] is False
print("pipeline ok:", len(psi["matches"]), "matches")

# 6. threshold decryption -----------------------------------------------------------
r = call("post", f"/api/investigations/{code}/decrypt", "A", json={"mode": "single_share"})
assert r.status_code == 403 and r.get_json()["denied"], r.get_data(as_text=True)
r = call("post", f"/api/investigations/{code}/decrypt", "A")
assert r.status_code == 403  # no approvals yet
ok(call("post", f"/api/investigations/{code}/decryption-approve", "A"))
assert call("post", f"/api/investigations/{code}/decrypt", "A").status_code == 403  # 1 share
ok(call("post", f"/api/investigations/{code}/decryption-approve", "B"))
dec = ok(call("post", f"/api/investigations/{code}/decrypt", "A"))
assert dec["investigation"]["status"] == "COMPLETED"

res = ok(call("get", f"/api/investigations/{code}/results", "A"))["results"]
assert all(x["decrypted"] and x["joint_risk"] is not None for x in res)
assert all(x["identity"]["state"] == "PROTECTED" for x in res)
assert "entity_id" not in str(res)
print("joint risks:", [(x["token_short"], x["banks"], x["joint_risk"], x["risk_status"]) for x in res][:5])

# 7. identity reveal -----------------------------------------------------------------------
target = next(x for x in res if x["bank_count"] == 3)
req = ok(call("post", f"/api/investigations/{code}/identity-request", "A",
              json={"result_id": target["id"]}), 201)
assert req["identity"]["state"] == "PROTECTED"          # 1 approval -> still protected
assert req["identity_request"]["approvals"] == ["A"]
assert req["identity_request"]["threshold"] == 2
assert call("post", f"/api/investigations/{code}/identity-approve", "A",
            json={"request_id": req["identity_request"]["id"]}).status_code == 409
pending_b = ok(call("get", "/api/identity-requests", "B"))["requests"]
assert pending_b[0]["request"]["can_vote"] and pending_b[0]["account"]["identity"]["state"] == "PROTECTED"
out = ok(call("post", f"/api/investigations/{code}/identity-approve", "B",
              json={"request_id": req["identity_request"]["id"]}))
assert out["identity"]["state"] == "REVEALED" and len(out["identity"]["entity_id"]) == 16
assert out["identity"]["local_account_id"].startswith("NLB")
a_view = ok(call("get", f"/api/investigations/{code}/results", "A"))["results"]
assert [x for x in a_view if x["id"] == target["id"]][0]["identity"]["state"] == "REVEALED"
print("identity reveal ok ->", out["identity"])

# rejection path: a second account, B rejects, C rejects -> denied
other = next(x for x in res if x["id"] != target["id"] and x["bank_count"] == 3)
rq = ok(call("post", f"/api/investigations/{code}/identity-request", "A",
             json={"result_id": other["id"]}), 201)["identity_request"]
ok(call("post", f"/api/investigations/{code}/identity-reject", "B", json={"request_id": rq["id"]}))
final = ok(call("post", f"/api/investigations/{code}/identity-reject", "C", json={"request_id": rq["id"]}))
assert final["identity"]["state"] == "PROTECTED" and final["identity_request"]["status"] == "DENIED"

# 8. audit ---------------------------------------------------------------------------------
logs = ok(call("get", "/api/audit-logs", "B"))["logs"]
actions = {x["action"] for x in logs}
for needed in ["LOGIN", "PARTICIPATION_APPROVED", "PSI_COMPLETED", "ENCRYPTION_COMPLETED",
               "DECRYPTION_SHARE_APPROVED", "IDENTITY_REVEAL_APPROVED", "IDENTITY_REVEALED",
               "IDENTITY_REVEAL_REQUESTED", "IDENTITY_REVEAL_REJECTED"]:
    assert needed in actions, needed
# Bank B must not see Bank A's local flag logs
assert not any(x["action"].startswith("LOCAL_ACCOUNT") for x in logs)
a_logs = {x["action"] for x in ok(call("get", "/api/audit-logs", "A"))["logs"]}
assert {"LOCAL_ACCOUNT_FLAGGED", "LOCAL_ACCOUNT_UNFLAGGED"} <= a_logs
print("audit ok:", len(logs), "entries visible to Bank B")
print("\nALL CHECKS PASSED")
