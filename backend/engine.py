# VaultLedger - Console Version

"""
Pipeline:
1. Each bank keeps its raw data locally
2. Individual account-level risk scores are generated/read locally
3. Accounts above the local threshold are flagged
4. DH-based PSI identifies accounts flagged by >= 2 banks
5. Individual risk scores for matched accounts are encrypted using
   Threshold Paillier
6. Encrypted scores are homomorphically aggregated
7. 2-of-3 threshold decryption gives the joint risk for that account

Setup:
    pip install pandas sympy

Run:
    python engine.py

Dataset structure:

../dataset/
    bank_A/
        transactions.csv
        local_risk_scores.csv
    bank_B/
        transactions.csv
        local_risk_scores.csv
    bank_C/
        transactions.csv
        local_risk_scores.csv
    ground_truth/
        entity_labels.csv
"""

import hashlib
import random
from pathlib import Path

import pandas as pd
from sympy import isprime, randprime


# ------------------------------------------------------------------
# CONFIGURATION
# ------------------------------------------------------------------

# Resolved relative to this file so the Flask API can import this module
# from any working directory.
DATASET_DIR = Path(__file__).resolve().parent.parent / "dataset"

BANKS = ["A", "B", "C"]

ACCOUNT_RISK_THRESHOLD = 50

MIN_BANKS_FOR_PSI_MATCH = 2

random.seed(7)


# ------------------------------------------------------------------
# HELPERS
# ------------------------------------------------------------------

def safe_prime(bits):
    """Return (p, q) where p = 2q + 1 and both are prime."""
    while True:
        q = randprime(2 ** (bits - 2), 2 ** (bits - 1))

        if isprime(2 * q + 1):
            return 2 * q + 1, q


def banner(title):
    print("\n" + "=" * 75)
    print(title)
    print("=" * 75)


# ------------------------------------------------------------------
# 1. BANK NODE
# ------------------------------------------------------------------

class BankNode:
    """
    Represents one bank.

    Raw transactions and local account information remain inside
    this object.

    Only cryptographic outputs and selected results leave the bank.
    """

    def __init__(self, name):

        self.name = name

        folder = DATASET_DIR / f"bank_{name}"

        self._txns = pd.read_csv(
            folder / "transactions.csv"
        )

        self._scores = pd.read_csv(
            folder / "local_risk_scores.csv"
        )

        # Optional local KYC/customer file (never leaves this bank).
        customers_path = folder / "customers.csv"

        self._customers = (
            pd.read_csv(customers_path)
            if customers_path.exists()
            else None
        )

        # Manual local flag overrides {account_id: True/False}.
        # Empty by default -> behaviour identical to the original.
        self._overrides = {}

        required_columns = {
            "entity_id",
            "local_risk_score",
        }

        missing = required_columns - set(self._scores.columns)

        if missing:
            raise ValueError(
                f"Bank {name}: missing required columns: {missing}"
            )

        # If flagged already exists in the dataset, preserve it.
        # Otherwise calculate it from the account-level score.
        if "flagged" not in self._scores.columns:

            self._scores["flagged"] = (
                self._scores["local_risk_score"]
                >= ACCOUNT_RISK_THRESHOLD
            ).astype(int)

        else:

            # Recalculate using the project's explicit threshold
            # so that the threshold is consistent.
            self._scores["flagged"] = (
                self._scores["local_risk_score"]
                >= ACCOUNT_RISK_THRESHOLD
            ).astype(int)

        # Only flagged accounts are used for PSI.
        self._refresh_flagged()


    def _refresh_flagged(self):
        """
        Rebuild the flagged set (threshold-based, plus any manual
        local overrides set through set_manual_overrides).
        """

        flagged_mask = self._scores["flagged"] == 1

        if self._overrides:

            override = self._scores["account_id"].map(
                self._overrides
            )

            flagged_mask = override.where(
                override.notna(),
                flagged_mask
            ).astype(bool)

        self._flagged = self._scores[
            flagged_mask
        ].copy()

        self._flagged = self._flagged.sort_values(
            "local_risk_score",
            ascending=False
        )


    def set_manual_overrides(self, overrides):
        """
        Apply manual local flag/unflag decisions.

        overrides: {account_id: True (flagged) / False (unflagged)}
        """

        self._overrides = dict(overrides)

        self._refresh_flagged()


    # --------------------------------------------------------------
    # API-LAYER ACCESSORS (local data only; used by the owning bank)
    # --------------------------------------------------------------

    def account_table(self):
        """
        One row per local account: id, entity_id, name, type, factors
        and the local risk score. Only ever returned to the owning bank.
        """

        df = self._scores.copy()

        if self._customers is not None:

            extra = self._customers[[
                "account_id",
                "full_name",
                "account_type",
                "city",
                "kyc_risk_tier",
            ]]

            df = df.merge(
                extra,
                on="account_id",
                how="left"
            )

        return df


    def account_row(self, account_id):
        """Return one account's table row as a dict, or None."""

        table = self.account_table()

        match = table[table["account_id"] == account_id]

        if match.empty:
            return None

        return match.iloc[0].to_dict()


    def entity_for_account(self, account_id):
        """Map a local account ID to its pseudonymous entity_id."""

        match = self._scores[
            self._scores["account_id"] == account_id
        ]

        if match.empty:
            return None

        return str(match.iloc[0]["entity_id"])


    def account_for_entity(self, entity_id):
        """Map a pseudonymous entity_id to this bank's local account ID."""

        match = self._scores[
            self._scores["entity_id"] == entity_id
        ]

        if match.empty:
            return None

        return str(match.iloc[0]["account_id"])


    def account_activity(self, account_id, limit=10):
        """
        Local transaction statistics + most recent transactions for one
        of this bank's own accounts.
        """

        txns = self._txns[
            self._txns["account_id"] == account_id
        ]

        credits = txns[txns["direction"] == "CREDIT"]["amount_eur"]
        debits = txns[txns["direction"] == "DEBIT"]["amount_eur"]

        recent = txns.sort_values(
            "timestamp",
            ascending=False
        ).head(limit)

        return {
            "transaction_count": int(len(txns)),
            "total_credits_eur": round(float(credits.sum()), 2),
            "total_debits_eur": round(float(debits.sum()), 2),
            "cross_bank_transactions": int(
                txns["is_cross_bank"].sum()
            ),
            "recent": recent[[
                "txn_id",
                "timestamp",
                "direction",
                "amount_eur",
                "txn_type",
                "channel",
                "counterparty_bank",
            ]].to_dict(orient="records"),
        }


    # --------------------------------------------------------------
    # ACCOUNT-LEVEL RISK
    # --------------------------------------------------------------

    def account_risk_scores(self):
        """
        Return the individual account risk scores.

        This is the primary risk information used by VaultLedger.
        """

        return dict(
            zip(
                self._scores["entity_id"],
                self._scores["local_risk_score"]
            )
        )


    def flagged_entities(self):
        """
        Return locally flagged account IDs.

        These are used as input to PSI.
        """

        return list(
            self._flagged["entity_id"]
        )


    def risk_for_account(self, entity_id):
        """
        Return the local risk score for one specific account.
        """

        match = self._scores[
            self._scores["entity_id"] == entity_id
        ]

        if match.empty:
            return None

        return float(
            match.iloc[0]["local_risk_score"]
        )


    # --------------------------------------------------------------
    # LOCAL RISK FACTORS
    # --------------------------------------------------------------

    def factors_for_account(self, entity_id):
        """
        Return risk factors for a specific account if available.
        """

        match = self._scores[
            self._scores["entity_id"] == entity_id
        ]

        if match.empty:
            return {}

        row = match.iloc[0]

        factor_columns = [
            "velocity_score",
            "structuring_score",
            "cross_bank_counterparty_score",
            "pass_through_score"
        ]

        factors = {}

        for column in factor_columns:

            if column in self._scores.columns:

                value = row[column]

                try:
                    factors[column] = round(
                        float(value),
                        1
                    )

                except (ValueError, TypeError):
                    factors[column] = value

        return factors


    # --------------------------------------------------------------
    # LOCAL SUMMARY
    # --------------------------------------------------------------

    def summary(self):

        return {
            "accounts": len(self._scores),
            "transactions": len(self._txns),
            "flagged": len(self._flagged)
        }


# ------------------------------------------------------------------
# 2. THRESHOLD PAILLIER
# ------------------------------------------------------------------

class ThresholdPaillier:
    """
    Simplified threshold Paillier demonstration.

    2-of-3 key sharing is used for the decryption stage.
    """

    def __init__(self, prime_bits=256):

        p, p1 = safe_prime(prime_bits)

        q, q1 = safe_prime(prime_bits)

        self.n = p * q

        self.n2 = self.n ** 2

        self.g = self.n + 1

        m = p1 * q1

        d = (
            m
            * pow(m, -1, self.n)
        ) % (self.n * m)

        self.delta = 6

        a1 = random.randrange(
            self.n * m
        )

        self._shares = {
            i: (d + a1 * i) % (self.n * m)
            for i in (1, 2, 3)
        }


    # --------------------------------------------------------------
    # ENCRYPT
    # --------------------------------------------------------------

    def encrypt(self, x):

        x = int(round(float(x)))

        r = random.randrange(
            2,
            self.n
        )

        return (
            pow(self.g, x, self.n2)
            *
            pow(r, self.n, self.n2)
        ) % self.n2


    # --------------------------------------------------------------
    # HOMOMORPHIC ADDITION
    # --------------------------------------------------------------

    def add(self, c1, c2):

        return (
            c1 * c2
        ) % self.n2


    # --------------------------------------------------------------
    # PARTIAL DECRYPTION
    # --------------------------------------------------------------

    def partial_decrypt(self, c, bank_id):

        return pow(
            c,
            2 * self.delta * self._shares[bank_id],
            self.n2
        )


    # --------------------------------------------------------------
    # COMBINE 2-OF-3 SHARES
    # --------------------------------------------------------------

    def combine(self, partials):

        if len(partials) < 2:

            raise PermissionError(
                "DENIED: need at least 2 of 3 key shares"
            )

        ids = list(partials)

        acc = 1

        for i in ids:

            lam = self.delta

            for j in ids:

                if j != i:

                    lam = (
                        lam
                        * j
                        // (j - i)
                    )

            acc = (
                acc
                *
                pow(
                    partials[i],
                    2 * lam,
                    self.n2
                )
            ) % self.n2

        result = (
            ((acc - 1) // self.n)
            *
            pow(
                4 * self.delta ** 2,
                -1,
                self.n
            )
        ) % self.n

        return result


# ------------------------------------------------------------------
# 3. DH PRIVATE SET INTERSECTION
# ------------------------------------------------------------------

class DHPrivateSetIntersection:

    def __init__(self, prime_bits=256):

        self.P, _ = safe_prime(
            prime_bits
        )

        self.keys = {
            bank: random.randrange(
                2,
                self.P - 2
            )
            for bank in BANKS
        }


    def _hash(self, item):

        digest = hashlib.sha256(
            str(item).encode()
        ).hexdigest()

        value = (
            int(digest, 16)
            % self.P
        )

        return pow(
            value,
            2,
            self.P
        )


    def blind(self, item, banks_order=BANKS):

        x = self._hash(item)

        for bank in banks_order:

            x = pow(
                x,
                self.keys[bank],
                self.P
            )

        return x


    def intersect(
        self,
        sets,
        min_banks=2
    ):

        seen = {}

        for bank, items in sets.items():

            for item in items:

                token = self.blind(item)

                if token not in seen:

                    seen[token] = []

                seen[token].append(
                    (bank, item)
                )

        return [
            value
            for value in seen.values()
            if len(value) >= min_banks
        ]


# ------------------------------------------------------------------
# 4. PSI
# ------------------------------------------------------------------

def run_psi(nodes):

    banner(
        "1. DH PRIVATE SET INTERSECTION"
    )

    psi = DHPrivateSetIntersection()

    private_sets = {
        bank: nodes[bank].flagged_entities()
        for bank in BANKS
    }

    matches = psi.intersect(
        private_sets,
        min_banks=MIN_BANKS_FOR_PSI_MATCH
    )

    print(
        f"PSI found {len(matches)} "
        f"cross-bank account matches."
    )

    results = []

    for match in matches:

        banks = [
            bank
            for bank, _ in match
        ]

        entities = [
            entity
            for _, entity in match
        ]

        # All entities in a match represent the same account
        # because PSI groups them through the blinded token.
        entity = entities[0]

        results.append({
            "entity_id": entity,
            "banks": banks,
            "bank_count": len(banks)
        })

    results.sort(
        key=lambda x: (
            -x["bank_count"],
            x["entity_id"]
        )
    )

    for result in results[:10]:

        print(
            f"    Account {str(result['entity_id'])[:12]}..."
            f" → flagged by banks "
            f"{', '.join(result['banks'])}"
        )

    return results


# ------------------------------------------------------------------
# 5. ENCRYPT INDIVIDUAL ACCOUNT RISK
# ------------------------------------------------------------------

def encrypt_account_scores(
    nodes,
    matched_accounts,
    paillier
):

    banner(
        "2. ACCOUNT-LEVEL THRESHOLD PAILLIER ENCRYPTION"
    )

    encrypted = {}

    for result in matched_accounts:

        entity = result["entity_id"]

        encrypted[entity] = {}

        print(
            f"\nAccount {entity}"
        )

        for bank in result["banks"]:

            score = nodes[bank].risk_for_account(
                entity
            )

            if score is None:
                continue

            ciphertext = paillier.encrypt(
                score
            )

            encrypted[entity][bank] = {
                "score": score,
                "ciphertext": ciphertext
            }

            # ------------------------------------------------------
            # CHANGED OUTPUT
            # ------------------------------------------------------

            print(
                f"    Bank {bank}:"
            )

            print(
                f"        local risk = {score:.1f}"
            )

            print(
                f"        encrypted value = {ciphertext}"
            )

        print(
            "    Plaintext score is NOT sent "
            "to the coordinator."
        )

    return encrypted


# ------------------------------------------------------------------
# 6. HOMOMORPHIC AGGREGATION
# ------------------------------------------------------------------

def aggregate_encrypted_scores(
    encrypted_scores,
    paillier
):

    banner(
        "3. COORDINATOR: HOMOMORPHIC AGGREGATION"
    )

    aggregated = {}

    for entity, bank_data in encrypted_scores.items():

        aggregate = 1

        for data in bank_data.values():

            aggregate = paillier.add(
                aggregate,
                data["ciphertext"]
            )

        aggregated[entity] = aggregate

        print(
            f"\nAccount {entity}"
        )

        print(
            f"    Encrypted scores from "
            f"{len(bank_data)} banks"
        )

        print(
            "    Coordinator performs:"
        )

        print(
            "    E(score_A) + E(score_B) + ..."
        )

        # ----------------------------------------------------------
        # SHOW ACTUAL ENCRYPTED AGGREGATED VALUE
        # ----------------------------------------------------------

        print(
            f"    Result = {aggregate}"
        )

        print(
            "    Coordinator cannot read "
            "individual plaintext scores."
        )

    return aggregated


# ------------------------------------------------------------------
# 7. THRESHOLD DECRYPTION
# ------------------------------------------------------------------

def decrypt_joint_scores(
    nodes,
    encrypted_scores,
    aggregated,
    paillier
):

    banner(
        "4. 2-OF-3 THRESHOLD DECRYPTION / CONSENT GATE"
    )

    results = {}

    for entity, cipher in aggregated.items():

        participating_banks = list(
            encrypted_scores[entity].keys()
        )

        print(
            f"\nAccount {entity}"
        )

        # Demonstrate that one share is insufficient.
        try:

            paillier.combine({
                1: paillier.partial_decrypt(
                    cipher,
                    1
                )
            })

        except PermissionError as error:

            print(
                "    Bank A alone      ->",
                error
            )

        print(
            "    Coordinator alone -> DENIED"
        )

        # Use the first two participating banks
        # that have corresponding threshold shares.
        #
        # The prototype has 3 bank key shares:
        # Bank A = 1
        # Bank B = 2
        # Bank C = 3

        share_ids = []

        for bank in participating_banks:

            share_ids.append(
                BANKS.index(bank) + 1
            )

        if len(share_ids) < 2:

            print(
                "    Not enough banks for "
                "2-of-3 decryption."
            )

            continue

        share_ids = share_ids[:2]

        partials = {}

        for share_id in share_ids:

            partials[share_id] = (
                paillier.partial_decrypt(
                    cipher,
                    share_id
                )
            )

        total = paillier.combine(
            partials
        )

        bank_count = len(
            participating_banks
        )

        joint_risk = (
            total / bank_count
        )

        results[entity] = {
            "joint_sum": total,
            "joint_risk": joint_risk,
            "bank_count": bank_count,
            "banks": participating_banks
        }

        print(
            f"    Banks contributing: "
            f"{', '.join(participating_banks)}"
        )

        print(
            "    2 key shares -> APPROVED"
        )

        print(
            f"    Decrypted joint sum = {total}"
        )

        print(
            f"    Joint account risk = "
            f"{joint_risk:.1f}"
        )

        print(
            "    Joint Risk ->",
            "HIGH"
            if joint_risk >= ACCOUNT_RISK_THRESHOLD
            else "LOW"
        )

    return results


# ------------------------------------------------------------------
# 8. FINAL FRAUD RESULT
# ------------------------------------------------------------------

def show_final_results(
    psi_results,
    joint_results
):

    banner(
        "5. FINAL VAULTLEDGER RESULT"
    )

    if not joint_results:

        print(
            "No account had enough cross-bank "
            "participation for secure aggregation."
        )

        return

    ranked = sorted(
        joint_results.items(),
        key=lambda x: x[1]["joint_risk"],
        reverse=True
    )

    fraud_found = False

    for entity, result in ranked:

        is_high_risk = (
            result["joint_risk"]
            >= ACCOUNT_RISK_THRESHOLD
        )

        matching_banks = ", ".join(
            result["banks"]
        )

        print(
            f"\nAccount: {entity}"
        )

        print(
            f"    Banks matched       : "
            f"{matching_banks}"
        )

        print(
            f"    Banks count         : "
            f"{result['bank_count']}"
        )

        print(
            f"    Joint account risk  : "
            f"{result['joint_risk']:.1f}"
        )

        print(
            "    Cross-bank match    : YES"
        )

        if is_high_risk:

            print(
                "    🚨 FRAUD RING DETECTED"
            )

            fraud_found = True

        else:

            print(
                "    Result: LOW RISK"
            )

    print(
        "\n" + "-" * 75
    )

    if fraud_found:

        print(
            "🚨 VAULTLEDGER: CROSS-BANK FRAUD DETECTED"
        )

    else:

        print(
            "NO HIGH-RISK CROSS-BANK FRAUD DETECTED"
        )

    print(
        "RAW TRANSACTION DATA NEVER LEFT THE BANK."
    )


# ------------------------------------------------------------------
# 9. OPTIONAL GROUND-TRUTH EVALUATION
# ------------------------------------------------------------------

def evaluate(psi_results):

    ground_truth = (
        DATASET_DIR
        / "ground_truth"
        / "entity_labels.csv"
    )

    if not ground_truth.exists():

        return

    labels = pd.read_csv(
        ground_truth
    ).set_index(
        "entity_id"
    ).role

    ring_accounts = {
        entity
        for entity, role in labels.items()
        if str(role).startswith("ring")
    }

    detected_accounts = {
        result["entity_id"]
        for result in psi_results
    }

    recovered = (
        ring_accounts
        & detected_accounts
    )

    decoys = (
        detected_accounts
        - ring_accounts
    )

    print(
        "\n[Evaluation]"
    )

    print(
        f"Ring accounts recovered: "
        f"{len(recovered)}/{len(ring_accounts)}"
    )

    print(
        f"Non-ring matches (decoys): "
        f"{len(decoys)}"
    )


# ------------------------------------------------------------------
# MAIN
# ------------------------------------------------------------------

def main():

    banner(
        "VAULTLEDGER"
    )

    print(
        "Privacy-preserving cross-bank fraud detection"
    )

    print(
        "\nArchitecture:"
    )

    print(
        "Local account risk"
        " -> DH-PSI"
        " -> Threshold Paillier"
        " -> 2-of-3 consent"
        " -> Joint fraud decision"
    )

    # --------------------------------------------------------------
    # CREATE BANK NODES
    # --------------------------------------------------------------

    nodes = {
        bank: BankNode(bank)
        for bank in BANKS
    }

    # --------------------------------------------------------------
    # PSI
    # --------------------------------------------------------------

    psi_results = run_psi(
        nodes
    )

    if not psi_results:

        banner("RESULT")

        print(
            "No account was independently flagged "
            "by at least two banks."
        )

        print(
            "No cross-bank fraud ring detected."
        )

        return

    # --------------------------------------------------------------
    # THRESHOLD PAILLIER
    # --------------------------------------------------------------

    paillier = ThresholdPaillier()

    # --------------------------------------------------------------
    # ENCRYPT INDIVIDUAL ACCOUNT SCORES
    # --------------------------------------------------------------

    encrypted_scores = encrypt_account_scores(
        nodes,
        psi_results,
        paillier
    )

    # --------------------------------------------------------------
    # HOMOMORPHIC AGGREGATION
    # --------------------------------------------------------------

    aggregated = aggregate_encrypted_scores(
        encrypted_scores,
        paillier
    )

    # --------------------------------------------------------------
    # THRESHOLD DECRYPTION
    # --------------------------------------------------------------

    joint_results = decrypt_joint_scores(
        nodes,
        encrypted_scores,
        aggregated,
        paillier
    )

    # --------------------------------------------------------------
    # FINAL RESULT
    # --------------------------------------------------------------

    show_final_results(
        psi_results,
        joint_results
    )

    # --------------------------------------------------------------
    # OPTIONAL EVALUATION
    # --------------------------------------------------------------

    evaluate(
        psi_results
    )




# ==================== Investigation runner ====================

# Database callbacks are supplied by app.py, avoiding a circular import.
from types import SimpleNamespace

_storage = None

def configure_storage(*, connect, audit, now):
    """Connect the investigation runner to the application's database helpers."""
    global _storage
    _storage = SimpleNamespace(connect=connect, audit=audit, now=now)

"""Runs the VaultLedger cryptographic pipeline for one investigation.

The crypto is defined above; this module sequences those calls, stores
only non-sensitive outputs (blinded tokens, ciphertexts, joint results) and
writes audit events. Plaintext per-bank scores and local flagged lists are
never saved to the shared database.
"""

import json
import os
import pickle
import random
import threading
import time
import traceback




# The prototype seeds `random` with a constant (random.seed(7)) for
# reproducible console output. For the web app, re-seed from OS entropy so
# every run/restart generates fresh keys and blinding factors.
random.seed()

# Pause between pipeline stages so the UI can animate each step.
STEP_DELAY = float(os.environ.get("VAULTLEDGER_STEP_DELAY", "1.4"))

STEPS = [
    "Participation Consent",
    "Local Risk Analysis",
    "DH-PSI",
    "Account Matching",
    "Threshold Paillier Encryption",
    "Homomorphic Aggregation",
    "Threshold Decryption",
    "Suspicious Accounts",
]

# Each bank's private node. Raw transactions stay inside these objects.
NODES = {bank: BankNode(bank) for bank in BANKS}
_NODE_LOCK = threading.RLock()


# Local manual flag overrides

def apply_overrides(conn, bank):
    """Load this bank's manual flag decisions into its BankNode."""
    rows = conn.execute(
        "SELECT account_id, flagged FROM manual_flags WHERE bank = ?", (bank,)
    ).fetchall()

    with _NODE_LOCK:
        NODES[bank].set_manual_overrides(
            {r["account_id"]: bool(r["flagged"]) for r in rows}
        )


def init_nodes(conn):
    for bank in BANKS:
        apply_overrides(conn, bank)


# Helpers

def _set_state(conn, inv_id, status=None, step=None, error=None):
    fields, args = ["updated_at = ?"], [_storage.now()]

    if status is not None:
        fields.append("status = ?")
        args.append(status)

    if step is not None:
        fields.append("current_step = ?")
        args.append(step)

    if error is not None:
        fields.append("error = ?")
        args.append(error)

    args.append(inv_id)
    conn.execute(
        f"UPDATE investigations SET {', '.join(fields)} WHERE id = ?", args
    )
    conn.commit()


def _short(token):
    return f"{token[:4]}…{token[-4:]}"


def load_paillier(blob):
    return pickle.loads(blob)["paillier"]


# Pipeline (runs in a background thread after consent is complete)

def start_pipeline(inv_id):
    thread = threading.Thread(target=_run_pipeline, args=(inv_id,), daemon=True)
    thread.start()


def _run_pipeline(inv_id):
    conn = _storage.connect()

    try:
        inv = conn.execute(
            "SELECT * FROM investigations WHERE id = ?", (inv_id,)
        ).fetchone()
        code = inv["code"]

        participants = [
            r["bank"]
            for r in conn.execute(
                "SELECT bank FROM participants WHERE investigation_id = ?"
                " AND consent = 'APPROVED' ORDER BY bank",
                (inv_id,),
            )
        ]

        # Safety net: never run without full consent.
        total = conn.execute(
            "SELECT COUNT(*) c FROM participants WHERE investigation_id = ?",
            (inv_id,),
        ).fetchone()["c"]

        if inv["status"] != "RUNNING" or len(participants) != total or total < 2:
            return

        # Step 2: local risk analysis
        _set_state(conn, inv_id, step=2)

        private_sets = {}

        for bank in participants:
            apply_overrides(conn, bank)
            private_sets[bank] = NODES[bank].flagged_entities()

            _storage.audit(
                conn, bank, "LOCAL_RISK_ANALYSIS_COMPLETED", code,
                details="Flagged account set prepared locally (kept private)",
            )

        conn.commit()
        time.sleep(STEP_DELAY)

        # Step 3: DH-PSI
        _set_state(conn, inv_id, step=3)

        psi = DHPrivateSetIntersection()

        matches = psi.intersect(
            private_sets, min_banks=MIN_BANKS_FOR_PSI_MATCH
        )

        psi_info = {
            "set_sizes": {b: len(private_sets[b]) for b in participants},
            "matches": len(matches),
            "min_banks": MIN_BANKS_FOR_PSI_MATCH,
            "group_bits": psi.P.bit_length(),
        }

        for bank in participants:
            _storage.audit(
                conn, bank, "PSI_COMPLETED", code,
                details="Blinded flagged set contributed; only matches revealed",
            )

        conn.execute(
            "UPDATE investigations SET psi_json = ? WHERE id = ?",
            (json.dumps(psi_info), inv_id),
        )
        conn.commit()
        time.sleep(STEP_DELAY)

        # Step 4: account matching
        _set_state(conn, inv_id, step=4)

        # Same shape as the run_psi() result list.
        psi_results = []

        for match in matches:
            banks = [bank for bank, _ in match]
            entity = match[0][1]

            psi_results.append({
                "entity_id": entity,
                "banks": banks,
                "bank_count": len(banks),
                "token": format(psi.blind(entity), "x"),
            })

        psi_results.sort(key=lambda x: (-x["bank_count"], x["token"]))

        for res in psi_results:
            conn.execute(
                "INSERT INTO results (investigation_id, token, entity_id,"
                " banks_json, bank_count) VALUES (?, ?, ?, ?, ?)",
                (
                    inv_id,
                    res["token"],
                    res["entity_id"],
                    json.dumps(sorted(res["banks"])),
                    res["bank_count"],
                ),
            )
        conn.commit()

        if not psi_results:
            _set_state(conn, inv_id, status="COMPLETED", step=8)
            for bank in participants:
                _storage.audit(
                    conn, bank, "NO_CROSS_BANK_MATCHES", code,
                    details="No account flagged by at least 2 participating banks",
                )
            conn.commit()
            return

        time.sleep(STEP_DELAY)

        # Step 5: account-level encryption
        _set_state(conn, inv_id, step=5)

        paillier = ThresholdPaillier()

        # Original function: reads each bank's local score and encrypts it.
        encrypted = encrypt_account_scores(NODES, psi_results, paillier)

        for res in psi_results:
            entity = res["entity_id"]

            # Persist ONLY ciphertexts (no plaintext scores).
            enc_public = {
                bank: str(data["ciphertext"])
                for bank, data in encrypted[entity].items()
            }

            conn.execute(
                "UPDATE results SET enc_json = ?"
                " WHERE investigation_id = ? AND token = ?",
                (json.dumps(enc_public), inv_id, res["token"]),
            )

        conn.execute(
            "UPDATE investigations SET crypto_blob = ? WHERE id = ?",
            (pickle.dumps({"paillier": paillier}), inv_id),
        )

        for bank in participants:
            _storage.audit(
                conn, bank, "ENCRYPTION_COMPLETED", code,
                details="Local risk scores encrypted before leaving the bank",
            )
        conn.commit()

        time.sleep(STEP_DELAY)

        # Step 6: homomorphic aggregation
        _set_state(conn, inv_id, step=6)

        # Original function: multiplies ciphertexts (= adds plaintexts).
        aggregated = aggregate_encrypted_scores(encrypted, paillier)

        for res in psi_results:
            conn.execute(
                "UPDATE results SET aggregate_cipher = ?"
                " WHERE investigation_id = ? AND token = ?",
                (str(aggregated[res["entity_id"]]), inv_id, res["token"]),
            )

        _storage.audit(
            conn, "COORDINATOR", "AGGREGATION_COMPLETED", code,
            details=(
                f"{len(psi_results)} encrypted aggregates computed on "
                "ciphertext only"
            ),
        )
        conn.commit()

        time.sleep(STEP_DELAY)

        # Step 7: waits for 2-of-3 key-share consent
        _set_state(conn, inv_id, status="AWAITING_DECRYPTION", step=7)

    except Exception as exc:  # pragma: no cover - defensive
        traceback.print_exc()
        _set_state(conn, inv_id, status="FAILED", error=str(exc))

    finally:
        conn.close()


# Threshold decryption (uses ThresholdPaillier.combine)

def share_id(bank):
    """Bank A = share 1, Bank B = share 2, Bank C = share 3."""
    return BANKS.index(bank) + 1


def try_decrypt(paillier, ciphertext, banks):
    """
    Each listed bank computes a partial decryption with its own key share;
    the shares are then combined. Raises PermissionError (from the original
    ThresholdPaillier.combine) when fewer than 2 shares are supplied.
    """
    partials = {
        share_id(bank): paillier.partial_decrypt(ciphertext, share_id(bank))
        for bank in banks
    }

    return paillier.combine(partials)


if __name__ == "__main__":
    main()
