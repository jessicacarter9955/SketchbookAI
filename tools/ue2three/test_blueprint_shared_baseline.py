"""Shared-package baseline comparisons must never certify excluded coverage."""
import unittest
from compare_blueprint_reports import compare, compare_shared_packages


HASH = "a" * 64
def package(status):
    row = {"source_export_index": 1, "name": "Foo"}
    return {"source": {"source_sha256": HASH},
            "functions": {"Foo": row} if status == "translated" else {},
            "blocked": [dict(row, reason="unsupported")] if status == "blocked" else []}


class SharedBaselineTests(unittest.TestCase):
    def test_partial_coverage_disclosed(self):
        before = {"packages": {"A": package("blocked")}}
        after = {"packages": {"A": package("translated"), "B": package("blocked")}}
        result = compare_shared_packages(before, after)
        self.assertTrue(result["scoped_monotonic_source_compilation"])
        self.assertFalse(result["full_project_certified"])
        self.assertEqual(result["current_only_packages"], ["B"])
        self.assertEqual(result["new_translation_count"], 1)

    def test_real_regression_still_fails(self):
        before = {"packages": {"A": package("translated")}}
        after = {"packages": {"A": package("blocked"), "B": package("blocked")}}
        self.assertFalse(compare_shared_packages(before, after)["monotonic_source_compilation"])

    def test_source_mismatch_still_fails(self):
        before = {"packages": {"A": package("blocked")}}
        after = {"packages": {"A": package("translated")}}
        after["packages"]["A"]["source"]["source_sha256"] = "b" * 64
        self.assertFalse(compare_shared_packages(before, after)["monotonic_source_compilation"])

    def test_empty_overlap_is_rejected(self):
        with self.assertRaises(ValueError):
            compare_shared_packages({"packages": {"A": package("blocked")}},
                                    {"packages": {"B": package("translated")}})


if __name__ == "__main__":
    unittest.main()
