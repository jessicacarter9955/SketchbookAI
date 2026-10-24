import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from compare_blueprint_reports import compare, entries


def report(*, translated=False, source="a" * 64, reason="Unsupported native math call: FInterpTo"):
    record = {"source": {"source_sha256": source}, "functions": {}, "blocked": []}
    if translated:
        record["functions"]["UpdateBlend"] = {"name": "UpdateBlend", "source_export_index": 17}
    else:
        record["blocked"].append({"function": "UpdateBlend", "source_export_index": 17, "reason": reason})
    return {"counts": {"translated": int(translated), "blocked": int(not translated)},
            "packages": {"/Game/BP_Original": record}}


class CompareBlueprintReportsTests(unittest.TestCase):
    def test_translated_function_mapping_is_a_real_source_witnessed_gain(self):
        before, after = report(), report(translated=True)
        result = compare(before, after)
        self.assertTrue(result["same_source_snapshot"])
        self.assertTrue(result["certifiable_gain"])
        self.assertEqual(result["changed_count"], 1)
        self.assertEqual(result["changed_functions"][0]["before"]["status"], "blocked")
        self.assertEqual(result["changed_functions"][0]["after"]["status"], "translated")

    def test_different_original_package_hash_is_not_certifiable(self):
        result = compare(report(), report(translated=True, source="b" * 64))
        self.assertFalse(result["same_source_snapshot"])
        self.assertFalse(result["certifiable_gain"])

    def test_changed_block_reason_is_not_a_translated_function(self):
        result = compare(report(), report(reason="Unresolved source struct"))
        self.assertEqual(result["changed_count"], 1)
        self.assertFalse(result["certifiable_gain"])

    def test_duplicate_source_export_identity_fails_closed(self):
        value = report(translated=True)
        value["packages"]["/Game/BP_Original"]["blocked"] = [
            {"source_export_index": 17, "function": "UpdateBlend", "reason": "bad"}]
        with self.assertRaisesRegex(ValueError, "Duplicate export index"):
            entries(value)


if __name__ == "__main__":
    unittest.main()
