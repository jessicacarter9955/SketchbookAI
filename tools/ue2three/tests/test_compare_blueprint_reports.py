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
        self.assertTrue(result['monotonic_source_compilation'])
        self.assertEqual(result['new_translation_count'], 1)
        self.assertEqual(result['regression_count'], 0)

    def test_different_original_package_hash_is_not_certifiable(self):
        result = compare(report(), report(translated=True, source="b" * 64))
        self.assertFalse(result["same_source_snapshot"])
        self.assertFalse(result["certifiable_gain"])

    def test_changed_block_reason_is_not_a_translated_function(self):
        result = compare(report(), report(reason="Unresolved source struct"))
        self.assertEqual(result["changed_count"], 1)
        self.assertFalse(result["certifiable_gain"])
        self.assertTrue(result['monotonic_source_compilation'])

    def test_real_regression_is_explicit_and_not_green(self):
        before, after = report(translated=True), report()
        result = compare(before, after)
        self.assertEqual(result['regression_count'], 1)
        self.assertFalse(result['monotonic_source_compilation'])
        self.assertFalse(result['certifiable_gain'])
        self.assertEqual(result['regressions'][0]['before']['function'], 'UpdateBlend')

    def test_missing_translated_function_is_a_hard_regression(self):
        before, after = report(translated=True), report()
        after['packages']['/Game/BP_Original']['blocked'].clear()
        result = compare(before, after)
        self.assertEqual(result['disappeared_count'], 1)
        self.assertEqual(result['regression_count'], 1)
        self.assertFalse(result['monotonic_source_compilation'])

    def test_missing_source_hash_is_not_a_matching_snapshot(self):
        before, after = report(), report(translated=True)
        before['packages']['/Game/BP_Original']['source'].pop('source_sha256')
        after['packages']['/Game/BP_Original']['source'].pop('source_sha256')
        result = compare(before, after)
        self.assertFalse(result['same_source_snapshot'])
        self.assertFalse(result['certifiable_gain'])

    def test_net_gain_with_an_unrelated_regression_is_not_certifiable(self):
        before, after = report(), report(translated=True)
        before['packages']['/Game/BP_Original']['functions']['Old'] = {
            'name': 'Old', 'source_export_index': 3}
        after['packages']['/Game/BP_Original']['blocked'].append({
            'function': 'Old', 'source_export_index': 3, 'reason': 'Unsupported opcode: EX_Context'})
        result = compare(before, after)
        self.assertEqual(result['new_translation_count'], 1)
        self.assertEqual(result['regression_count'], 1)
        self.assertFalse(result['certifiable_gain'])

    def test_duplicate_source_export_identity_fails_closed(self):
        value = report(translated=True)
        value["packages"]["/Game/BP_Original"]["blocked"] = [
            {"source_export_index": 17, "function": "UpdateBlend", "reason": "bad"}]
        with self.assertRaisesRegex(ValueError, "Duplicate export index"):
            entries(value)


if __name__ == "__main__":
    unittest.main()
