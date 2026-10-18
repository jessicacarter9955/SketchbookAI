"""Database abstraction for TruthLab.

SQLite remains suitable for local tests; TRUTHLAB_DATABASE_URL enables a durable,
shared PostgreSQL database for the hosted console and independent scheduled jobs.
Never put the database URL or credentials in the repository.
"""
import os
import re
import sqlite3
from contextlib import contextmanager
from pathlib import Path


class HybridRow(dict):
    """Keep both sqlite.Row-style numeric and named column lookups."""
    def __init__(self, columns, values):
        super().__init__(zip(columns, values))
        self._values = values

    def __getitem__(self, key):
        if isinstance(key, int):
            return self._values[key]
        return super().__getitem__(key)


def hybrid_row(cursor):
    # Psycopg also calls row_factory for commands without a result set (DDL/UPDATE).
    if cursor.description is None:
        return lambda values: values
    cols = [c.name for c in cursor.description]
    return lambda values: HybridRow(cols, values)


class PostgresCompat:
    """Small, intentionally narrow adapter for the SQL used by app.py."""
    def __init__(self, connection):
        self.conn = connection

    def execute(self, query, params=()):
        sql = query.strip()
        if sql.upper().startswith("PRAGMA TABLE_INFO("):
            table = sql[len("PRAGMA table_info("):-1].strip().strip('"')
            if table not in ("messages", "reports"):
                raise ValueError("Unsupported PRAGMA table")
            return self.conn.execute(
                "SELECT ordinal_position-1 AS cid, column_name AS name "
                "FROM information_schema.columns "
                "WHERE table_schema=current_schema() AND table_name=%s "
                "ORDER BY ordinal_position", (table,))
        if sql.upper() == "BEGIN IMMEDIATE":
            # Serialize the daily-call reservation even across separate workers.
            return self.conn.execute("SELECT pg_advisory_xact_lock(71924138)")
        if sql.upper().startswith("INSERT OR IGNORE INTO "):
            sql = re.sub(r"^INSERT OR IGNORE INTO ", "INSERT INTO ", sql, flags=re.I)
            sql += " ON CONFLICT DO NOTHING"
        sql = re.sub(r"\bid INTEGER PRIMARY KEY\b", "id BIGSERIAL PRIMARY KEY", sql, flags=re.I)
        return self.conn.execute(sql.replace("?", "%s"), params)

    def executescript(self, script):
        for stmt in script.split(";"):
            if stmt.strip():
                self.execute(stmt)


@contextmanager
def connection(db_path=None, database_url=None):
    """Transactions commit on success, roll back on error, and always close."""
    url = database_url if database_url is not None else os.getenv("TRUTHLAB_DATABASE_URL", "")
    if url:
        try:
            import psycopg
        except ImportError as exc:
            raise RuntimeError("Install requirements.txt to enable PostgreSQL") from exc
        if not url.startswith(("postgresql://", "postgres://")):
            raise ValueError("TRUTHLAB_DATABASE_URL must be a PostgreSQL URL")
        # Provider URLs should use TLS (sslmode=require or stronger).
        with psycopg.connect(url, connect_timeout=12, row_factory=hybrid_row) as conn:
            yield PostgresCompat(conn)
    else:
        path = db_path or os.getenv("TRUTHLAB_DB", "/tmp/truthlab-pair-live.sqlite")
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(path, timeout=20)
        db.row_factory = sqlite3.Row
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()


def backend():
    return "postgresql" if os.getenv("TRUTHLAB_DATABASE_URL") else "sqlite-ephemeral"
