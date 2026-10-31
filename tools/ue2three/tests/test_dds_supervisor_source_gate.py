"""Offline DDS promotion gate: 276 source packages and 1,957 original exports.

These synthetic reports exercise the *gate*, not Unreal source compilation.
No fixture is presented as a new source-witnessed translated DDS function.
"""
import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dds_automation import replay_improves


SOURCE_SHA = "a" * 64
PARSED_SHA = "b" * 64
BYTECODE_SHA = "c" * 64


def original_inventory():
    packages = {}
    for index in range(276):
        name = f"/Game/Fixture/BP_{index:03d}"
        # 25 * 8 + 251 * 7 = 1,957 distinct original export identities.
        count = 8 if index < 25 else 7
        functions = {}
        for export in range(1, count + 1):
            function = f"Original_{index}_{export}"
            functions[function] = {
                "name": function, "source_export_index": export,
                "source_bytecode_sha256": BYTECODE_SHA,
                "steps": [{"op": "return", "value": {"op": "constant", "value": export}}],
            }
        packages[name] = {
            "source": {"source_sha256": SOURCE_SHA, "parsed_sha256": PARSED_SHA},
            "functions": functions, "blocked": [],
        }
    # A single source export is initially blocked and later translated.
    package = packages["/Game/Fixture/BP_000"]
    original = package["functions"].pop("Original_0_1")
    package["blocked"] = [{
        "function": original["name"], "source_export_index": original["source_export_index"],
        "reason": "Unresolved native source bytecode",
    }]
    before = {
        "project": "/original/VIPExtractionKitDDS.uproject",
        "packages": packages,
        "counts": {"translated": 1956, "blocked": 1},
        "missing_cached_packages": [],
    }
    after = copy.deepcopy(before)
    target = after["packages"]["/Game/Fixture/BP_000"]
    target["blocked"] = []
    target["functions"]["Original_0_1"] = original
    after["counts"] = {"translated": 1957, "blocked": 0}
    return before, after


class DDSCandidatePromotionGateTests(unittest.TestCase):
    def test_exact_full_inventory_one_original_export_gain_passes(self):
        before, after = original_inventory()
        self.assertEqual(len(before["packages"]), 276)
        self.assertEqual(sum(len(p["functions"]) + len(p["blocked"])
                             for p in before["packages"].values()), 1957)
        self.assertTrue(replay_improves(before, after))

    def test_no_gain_or_count_inflation_cannot_promote(self):
        before, after = original_inventory()
        self.assertFalse(replay_improves(before, before))
        after["counts"]["translated"] += 1
        self.assertFalse(replay_improves(before, after))

    def test_changed_source_and_parsed_sha_cannot_promote(self):
        for field in ("source_sha256", "parsed_sha256"):
            before, after = original_inventory()
            after["packages"]["/Game/Fixture/BP_000"]["source"][field] = "d" * 64
            with self.subTest(field=field):
                self.assertFalse(replay_improves(before, after))

    def test_existing_translated_bytecode_and_export_identity_cannot_change(self):
        for field, value in (("source_bytecode_sha256", "d" * 64),
                             ("source_export_index", 999)):
            before, after = original_inventory()
            after["packages"]["/Game/Fixture/BP_000"]["functions"]["Original_0_2"][field] = value
            with self.subTest(field=field):
                self.assertFalse(replay_improves(before, after))

    def test_unwitnessed_new_function_cannot_promote(self):
        for field, value in (("source_bytecode_sha256", None),
                             ("name", "InventedMethod")):
            before, after = original_inventory()
            after["packages"]["/Game/Fixture/BP_000"]["functions"]["Original_0_1"][field] = value
            with self.subTest(field=field):
                self.assertFalse(replay_improves(before, after))

    def test_missing_package_export_or_cache_cannot_promote(self):
        for defect in ("package", "export", "cache"):
            before, after = original_inventory()
            if defect == "package":
                del after["packages"]["/Game/Fixture/BP_275"]
            elif defect == "export":
                del after["packages"]["/Game/Fixture/BP_275"]["functions"]["Original_275_1"]
            else:
                after["missing_cached_packages"] = ["/Game/Fixture/BP_001"]
            with self.subTest(defect=defect):
                self.assertFalse(replay_improves(before, after))

    def test_duplicate_export_identity_cannot_promote(self):
        before, after = original_inventory()
        after["packages"]["/Game/Fixture/BP_000"]["functions"]["Original_0_2"]["source_export_index"] = 1
        self.assertFalse(replay_improves(before, after))

    def test_regression_in_another_original_function_cannot_promote(self):
        before, after = original_inventory()
        pkg = after["packages"]["/Game/Fixture/BP_001"]
        del pkg["functions"]["Original_1_1"]
        pkg["blocked"].append({"function": "Original_1_1", "source_export_index": 1,
                               "reason": "New blocker"})
        after["counts"]["translated"] -= 1
        after["counts"]["blocked"] += 1
        self.assertFalse(replay_improves(before, after))

    def test_partial_inventory_even_with_consistent_counts_cannot_promote(self):
        before, after = original_inventory()
        for report in (before, after):
            del report["packages"]["/Game/Fixture/BP_275"]
            report["counts"]["translated"] -= 7
        self.assertFalse(replay_improves(before, after))


if __name__ == "__main__":
    unittest.main()
