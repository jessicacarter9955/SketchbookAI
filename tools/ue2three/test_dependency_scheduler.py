"""Regression tests for source-witnessed ue2three scheduling and trace comparison."""
import unittest
from dependency_scheduler import schedule, compare_traces


class DependencySchedulerTests(unittest.TestCase):
    def test_shared_blockers_are_ranked_and_distributed(self):
        plan = {"programs_content_sha256": "snapshot", "modules": [
            {"id": "objects", "first_blocked_functions": 2},
            {"id": "events", "first_blocked_functions": 1}],
            "functions": [
                {"package": "/Game/A", "export_index": 1, "modules": ["objects", "events"]},
                {"package": "/Game/A", "export_index": 2, "modules": ["objects"]}]}
        result = schedule(plan, workers=2)
        self.assertEqual(result["source_programs_sha256"], "snapshot")
        self.assertEqual(result["workers"][0]["tasks"][0]["id"], "objects")
        self.assertEqual(result["workers"][1]["tasks"][0]["id"], "events")
        self.assertEqual(result["status"], "proposed_only")

    def test_no_false_parity_on_missing_event(self):
        result = compare_traces({"events": ["fire", "hit"]}, {"events": ["fire"]})
        self.assertFalse(result["pass"])

    def test_no_false_parity_on_type_coercion(self):
        self.assertFalse(compare_traces({"damage": 1}, {"damage": 1.0})["pass"])

    def test_tolerance_is_explicit(self):
        self.assertTrue(compare_traces({"position": [1.0]}, {"position": [1.0000001]})["pass"])
        self.assertFalse(compare_traces({"position": [1.0]}, {"position": [1.1]})["pass"])

    def test_invalid_worker_count(self):
        with self.assertRaises(ValueError):
            schedule({}, workers=0)


if __name__ == "__main__":
    unittest.main()
