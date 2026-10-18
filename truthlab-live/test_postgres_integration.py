"""Real PostgreSQL integration smoke test. CI supplies an ephemeral Postgres container."""
import os
import unittest

import app


@unittest.skipUnless(os.getenv("TRUTHLAB_TEST_DATABASE_URL"), "No disposable Postgres test DB")
class PostgresIntegration(unittest.TestCase):
    def test_initialize_write_recall_lease_and_reload(self):
        original = os.environ.get("TRUTHLAB_DATABASE_URL")
        try:
            os.environ["TRUTHLAB_DATABASE_URL"] = os.environ["TRUTHLAB_TEST_DATABASE_URL"]
            app.initialize()
            self.assertEqual(app.get_state()["storage_backend"], "postgresql")
            app.save_setting("goal", "Persist the entire agent conversation across database connections.")
            self.assertIn("across database connections", app.settings()["goal"])
            app.publish("Ari", "Cloud memory survives the application process.", "live", 1)
            app.publish("Noor", "Check database integrity before claiming persistence.", "live", 1)
            app.report50(1, "live")
            state = app.get_state()
            self.assertEqual(len(state["messages"]), 2)
            self.assertEqual(len(state["memories"]), 2)
            self.assertEqual(len(state["reports"][0]["body"].split()), 50)
            lease = app.claim_cycle_lease()
            self.assertIsNotNone(lease)
            self.assertIsNone(app.claim_cycle_lease())
            app.release_cycle_lease(lease)
            self.assertIsNotNone(app.claim_cycle_lease())
            # Independent connection, not just an in-memory Python cache.
            with app.connect() as db:
                n = db.execute("SELECT COUNT(*) FROM memories WHERE workflow=?", ("truthlab",)).fetchone()[0]
                self.assertEqual(n, 2)
        finally:
            if original is None:
                os.environ.pop("TRUTHLAB_DATABASE_URL", None)
            else:
                os.environ["TRUTHLAB_DATABASE_URL"] = original


if __name__ == "__main__":
    unittest.main()
