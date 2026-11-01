"""Standalone SQLite process-crash probe; does not exercise Expo or power loss."""

from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import select
import sqlite3
import subprocess
import sys
import tempfile
import threading

CHILD = r"""
import sqlite3, sys, time
path, stage = sys.argv[1:]
db = sqlite3.connect(path, isolation_level=None)
db.execute('PRAGMA synchronous=FULL')
if db.execute('PRAGMA synchronous').fetchone()[0] != 2:
    raise RuntimeError('FULL synchronous mode unavailable')
if stage != 'before_begin':
    db.execute('BEGIN IMMEDIATE')
    db.execute("INSERT INTO effects VALUES ('op-1')")
    db.execute("INSERT INTO applied VALUES ('op-1')")
    if stage == 'after_commit':
        db.execute('COMMIT')
print('ready', flush=True)
time.sleep(30)
"""

INTENT_CHILD = r"""
import sqlite3, sys, time
path, stage = sys.argv[1:]
db = sqlite3.connect(path, isolation_level=None)
db.execute('PRAGMA synchronous=FULL')
if db.execute('PRAGMA synchronous').fetchone()[0] != 2:
    raise RuntimeError('FULL synchronous mode unavailable')
db.execute('BEGIN IMMEDIATE')
db.execute("INSERT INTO intents VALUES ('op-1', 'fingerprint-A')")
if stage == 'after_intent_commit':
    db.execute('COMMIT')
print('ready', flush=True)
time.sleep(30)
"""


def configure(db: sqlite3.Connection) -> None:
    mode = db.execute("PRAGMA journal_mode=WAL").fetchone()[0]
    if mode.lower() != "wal":
        raise RuntimeError(f"WAL unavailable: {mode}")
    db.execute("PRAGMA synchronous=FULL")
    if db.execute("PRAGMA synchronous").fetchone()[0] != 2:
        raise RuntimeError("FULL synchronous mode unavailable")


def kill_at_boundary(program: str, path: str, stage: str) -> None:
    process = subprocess.Popen(
        [sys.executable, "-c", program, path, stage],
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        if process.stdout is None:
            raise RuntimeError("child stdout unavailable")
        ready, _, _ = select.select([process.stdout], [], [], 5)
        if not ready or process.stdout.readline().strip() != "ready":
            raise RuntimeError(f"child did not reach {stage}")
    finally:
        process.kill()
        process.wait(timeout=5)


def replay(db: sqlite3.Connection, operation: str, fingerprint: str) -> str:
    db.execute("BEGIN IMMEDIATE")
    try:
        intent = db.execute(
            "SELECT fingerprint FROM intents WHERE id = ?", (operation,)
        ).fetchone()
        if not intent or intent[0] != fingerprint:
            raise ValueError("missing or mismatched intent")
        existing = db.execute(
            "SELECT fingerprint FROM applied_ops WHERE id = ?", (operation,)
        ).fetchone()
        if existing:
            if existing[0] != fingerprint:
                raise ValueError("operation id reused with different fingerprint")
            outcome = "already-applied"
        else:
            changed = db.execute("UPDATE counter SET value = value + 1").rowcount
            if changed != 1:
                raise ValueError("counter precondition failed")
            db.execute("INSERT INTO applied_ops VALUES (?, ?)", (operation, fingerprint))
            outcome = "applied"
        db.execute("COMMIT")
        return outcome
    except Exception:
        db.execute("ROLLBACK")
        raise


def inspect_identity(path: str, viewer: str, database_id: str) -> None:
    db = sqlite3.connect(Path(path).as_uri() + "?mode=ro", uri=True)
    try:
        rows = db.execute("SELECT viewer_id, database_id FROM identity").fetchall()
        if rows != [(viewer, database_id)]:
            raise ValueError("database identity is absent or different")
    finally:
        db.close()


def main() -> None:
    expected = {
        "before_begin": (1, 0, 0),
        "before_commit": (1, 0, 0),
        "after_commit": (1, 1, 1),
    }
    with tempfile.TemporaryDirectory(prefix="noted-intent-probe-") as directory:
        for stage, wanted in expected.items():
            path = os.path.join(directory, stage + ".db")
            db = sqlite3.connect(path, isolation_level=None)
            configure(db)
            for table in ("intents", "applied", "effects"):
                db.execute(f"CREATE TABLE {table} (id TEXT PRIMARY KEY)")
            db.execute("INSERT INTO intents VALUES ('op-1')")
            db.close()

            kill_at_boundary(CHILD, path, stage)

            check = sqlite3.connect(path)
            try:
                counts = tuple(
                    check.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                    for table in ("intents", "applied", "effects")
                )
            finally:
                check.close()
            if counts != wanted:
                raise AssertionError(f"{stage}: expected {wanted}, got {counts}")
            print(f"{stage}: intent/applied/effect={counts}")

        for stage, expected_intent in (("before_intent_commit", 0), ("after_intent_commit", 1)):
            path = os.path.join(directory, stage + ".db")
            db = sqlite3.connect(path, isolation_level=None)
            configure(db)
            db.execute("CREATE TABLE intents (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL)")
            db.close()
            kill_at_boundary(INTENT_CHILD, path, stage)
            check = sqlite3.connect(path)
            try:
                count = check.execute("SELECT COUNT(*) FROM intents").fetchone()[0]
            finally:
                check.close()
            if count != expected_intent:
                raise AssertionError(f"{stage}: expected {expected_intent}, got {count}")
            print(f"{stage}: intent={count}")

        missing = os.path.join(directory, "missing.db")
        try:
            sqlite3.connect(Path(missing).as_uri() + "?mode=ro", uri=True)
            raise AssertionError("missing database opened")
        except sqlite3.OperationalError:
            if os.path.exists(missing):
                raise AssertionError("read-only inspection created a database")
            print("missing database: rejected without creating a replacement")

        replacement = os.path.join(directory, "replacement.db")
        with open(replacement, "wb"):
            pass
        try:
            inspect_identity(replacement, "viewer-A", "database-A")
            raise AssertionError("empty replacement accepted")
        except sqlite3.DatabaseError:
            print("empty replacement: rejected without creating a schema")

        identity_path = os.path.join(directory, "identified.db")
        identity = sqlite3.connect(identity_path, isolation_level=None)
        identity.execute("CREATE TABLE identity (viewer_id TEXT, database_id TEXT)")
        identity.execute("INSERT INTO identity VALUES ('viewer-A', 'database-A')")
        identity.close()
        inspect_identity(identity_path, "viewer-A", "database-A")
        try:
            inspect_identity(identity_path, "viewer-B", "database-A")
            raise AssertionError("wrong viewer accepted")
        except ValueError:
            print("different viewer: rejected")

        path = os.path.join(directory, "replay.db")
        db = sqlite3.connect(path, isolation_level=None)
        try:
            configure(db)
            db.execute("CREATE TABLE counter (value INTEGER NOT NULL)")
            db.execute("INSERT INTO counter VALUES (0)")
            db.execute("CREATE TABLE intents (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL)")
            db.execute("CREATE TABLE applied_ops (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL)")
            try:
                replay(db, "op-1", "fingerprint-A")
                raise AssertionError("missing intent accepted")
            except ValueError:
                pass
            db.execute("BEGIN IMMEDIATE")
            db.execute("INSERT INTO intents VALUES ('op-1', 'fingerprint-A')")
            db.execute("COMMIT")
            # The caller is assumed to lose the commit response at this point.
            db.close()
            db = sqlite3.connect(path, isolation_level=None)
            db.execute("PRAGMA synchronous=FULL")
            fingerprint = db.execute(
                "SELECT fingerprint FROM intents WHERE id = ?", ("op-1",)
            ).fetchone()
            if fingerprint != ("fingerprint-A",):
                raise AssertionError("intent acknowledgement could not be reconciled")
            if replay(db, "op-1", "fingerprint-A") != "applied":
                raise AssertionError("first operation did not apply")
            if replay(db, "op-1", "fingerprint-A") != "already-applied":
                raise AssertionError("replay was not recognized")
            try:
                replay(db, "op-1", "fingerprint-B")
                raise AssertionError("mismatched operation fingerprint accepted")
            except ValueError:
                pass
            if db.execute("SELECT value FROM counter").fetchone()[0] != 1:
                raise AssertionError("counter applied more than once")
            print("intent acknowledgement lost: original fingerprint recovered")
            print("idempotent replay: counter=1; missing or mismatched intent rejected")

            db.execute("INSERT INTO intents VALUES ('op-2', 'fingerprint-C')")
            barrier = threading.Barrier(2)

            def concurrent_attempt() -> str:
                connection = sqlite3.connect(path, isolation_level=None, timeout=5)
                try:
                    connection.execute("PRAGMA synchronous=FULL")
                    barrier.wait(timeout=5)
                    return replay(connection, "op-2", "fingerprint-C")
                finally:
                    connection.close()

            with ThreadPoolExecutor(max_workers=2) as pool:
                results = sorted(future.result(timeout=10) for future in [
                    pool.submit(concurrent_attempt), pool.submit(concurrent_attempt)
                ])
            if results != ["already-applied", "applied"]:
                raise AssertionError(f"unexpected concurrent replay results: {results}")
            if db.execute("SELECT value FROM counter").fetchone()[0] != 2:
                raise AssertionError("concurrent replay applied more than once")
            print("concurrent replay: one apply and one already-applied result")

            db.execute("INSERT INTO intents VALUES ('op-conflict', 'fingerprint-E')")
            db.execute("INSERT INTO applied_ops VALUES ('op-conflict', 'fingerprint-F')")
            try:
                replay(db, "op-conflict", "fingerprint-E")
                raise AssertionError("conflicting applied marker accepted")
            except ValueError:
                pass
            if db.execute("SELECT value FROM counter").fetchone()[0] != 2:
                raise AssertionError("conflicting marker changed the counter")
            print("conflicting applied marker: rejected without mutation")

            db.execute("INSERT INTO intents VALUES ('op-3', 'fingerprint-D')")
            db.execute("DELETE FROM counter")
            try:
                replay(db, "op-3", "fingerprint-D")
                raise AssertionError("missing counter precondition accepted")
            except ValueError:
                pass
            if db.execute("SELECT COUNT(*) FROM applied_ops WHERE id = 'op-3'").fetchone()[0] != 0:
                raise AssertionError("failed operation retained an applied marker")
            print("missing mutation precondition: no applied marker")
        finally:
            db.close()


if __name__ == "__main__":
    main()
