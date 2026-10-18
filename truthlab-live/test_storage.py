import unittest
from types import SimpleNamespace
from storage import HybridRow, PostgresCompat


class FakeConnection:
    def __init__(self):
        self.statements = []

    def execute(self, sql, params=()):
        self.statements.append((sql, tuple(params)))
        return SimpleNamespace(rowcount=1)


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.conn = FakeConnection()
        self.adapter = PostgresCompat(self.conn)

    def test_rows_support_named_and_numeric_access(self):
        row = HybridRow(["id", "speaker"], (7, "Ari"))
        self.assertEqual(row[0], 7)
        self.assertEqual(row["speaker"], "Ari")
        self.assertEqual(dict(row), {"id": 7, "speaker": "Ari"})

    def test_translates_sqlite_table_schema(self):
        self.adapter.execute("CREATE TABLE IF NOT EXISTS memories(id INTEGER PRIMARY KEY, content TEXT)")
        self.assertIn("id BIGSERIAL PRIMARY KEY", self.conn.statements[-1][0])

    def test_ignore_insert_and_parameters(self):
        self.adapter.execute("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)", ("x", "y"))
        sql, params = self.conn.statements[-1]
        self.assertIn("ON CONFLICT DO NOTHING", sql)
        self.assertIn("VALUES(%s,%s)", sql)
        self.assertEqual(params, ("x", "y"))

    def test_pragma_column_discovery(self):
        self.adapter.execute("PRAGMA table_info(messages)")
        self.assertIn("information_schema.columns", self.conn.statements[-1][0])
        self.assertEqual(self.conn.statements[-1][1], ("messages",))
        with self.assertRaises(ValueError):
            self.adapter.execute("PRAGMA table_info(secrets)")

    def test_advisory_transaction_lock(self):
        self.adapter.execute("BEGIN IMMEDIATE")
        self.assertIn("pg_advisory_xact_lock", self.conn.statements[-1][0])

    def test_multiple_create_statements(self):
        self.adapter.executescript("CREATE TABLE a(id INTEGER PRIMARY KEY);CREATE TABLE b(id INTEGER PRIMARY KEY);")
        self.assertEqual(len(self.conn.statements), 2)


if __name__ == "__main__":
    unittest.main()
