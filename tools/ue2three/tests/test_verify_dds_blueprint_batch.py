"""Source-witnessed DDS replay must never claim a gain from a changed snapshot."""
import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from verify_dds_blueprint_batch import validate_source_replay


SOURCE = "a" * 64
PARSED = "b" * 64
BYTECODE = "c" * 64


def snapshot(*, translated=False):
    function = {"name": "ResetRaidConfig", "source_export_index": 7,
                "source_bytecode_sha256": BYTECODE,
                "steps": [{"op": "return", "value": {"op": "constant", "value": 7}}]}
    package = {
        "source": {"source_sha256": SOURCE, "parsed_sha256": PARSED},
        "functions": {"ResetRaidConfig": function} if translated else {},
        "blocked": [] if translated else [{
            "function": "ResetRaidConfig", "source_export_index": 7,
            "reason": "Original native call unresolved"}],
    }
    return {"project": "/original/VIPExtractionKitDDS.uproject",
            "packages": {"/Game/Fixers/BP_GI_Fixers": package},
            "counts": {"translated": int(translated), "blocked": int(not translated)},
            "missing_cached_packages": []}


class SourceReplayGateTests(unittest.TestCase):
    def test_original_export_gain_passes_without_claiming_play(self):
        before, after = snapshot(), snapshot(translated=True)
        result = validate_source_replay(before, after)
        self.assertEqual(result["new_translation_count"], 1)
        self.assertTrue(result["monotonic_source_compilation"])

    def test_standalone_replay_rejects_unexecutable_source_witnessed_gains(self):
        # A genuine source hash is necessary, never sufficient: the standalone
        # report must not claim a gain that supervisor promotion would reject.
        defects = [
            ("missing", None, "executable steps"),
            ("empty", [], "executable steps"),
            ("stub", [{"op": "stub"}], "stub/no-op"),
            ("noop", [{"op": "noop"}], "stub/no-op"),
            ("no_op", [{"op": "no_op"}], "stub/no-op"),
            ("not-a-step", ["return"], "stub/no-op"),
            ("empty-return", [{"op": "return", "value": {"op": "constant", "value": None}}],
             "empty returns"),
        ]
        for label, steps, message in defects:
            with self.subTest(defect=label):
                before, after = snapshot(), snapshot(translated=True)
                program = after["packages"]["/Game/Fixers/BP_GI_Fixers"]["functions"]["ResetRaidConfig"]
                if label == "missing":
                    del program["steps"]
                else:
                    program["steps"] = steps
                with self.assertRaisesRegex(RuntimeError, message):
                    validate_source_replay(before, after)

    def test_standalone_replay_rejects_mixed_noop_with_real_steps(self):
        before, after = snapshot(), snapshot(translated=True)
        program = after["packages"]["/Game/Fixers/BP_GI_Fixers"]["functions"]["ResetRaidConfig"]
        program["steps"].append({"op": "noop"})
        with self.assertRaisesRegex(RuntimeError, "stub/no-op"):
            validate_source_replay(before, after)

    def test_changed_original_source_or_parsed_package_rejected(self):
        for field in ("source_sha256", "parsed_sha256"):
            with self.subTest(field=field):
                before, after = snapshot(), snapshot(translated=True)
                after["packages"]["/Game/Fixers/BP_GI_Fixers"]["source"][field] = "f" * 64
                with self.assertRaisesRegex(RuntimeError, field):
                    validate_source_replay(before, after)

    def test_missing_or_invalid_source_witness_rejected(self):
        for value in (None, "not-a-sha", "Z" * 64):
            with self.subTest(value=value):
                before, after = snapshot(), snapshot(translated=True)
                before["packages"]["/Game/Fixers/BP_GI_Fixers"]["source"]["parsed_sha256"] = value
                with self.assertRaisesRegex(RuntimeError, "parsed_sha256"):
                    validate_source_replay(before, after)

    def test_regression_and_disappeared_export_rejected(self):
        before, after = snapshot(translated=True), snapshot()
        with self.assertRaisesRegex(RuntimeError, "regression"):
            validate_source_replay(before, after)
        after["packages"]["/Game/Fixers/BP_GI_Fixers"]["blocked"].clear()
        after["counts"]["blocked"] = 0
        with self.assertRaisesRegex(RuntimeError, "regression"):
            validate_source_replay(before, after)

    def test_duplicate_original_export_index_rejected(self):
        before, after = snapshot(), snapshot(translated=True)
        after["packages"]["/Game/Fixers/BP_GI_Fixers"]["blocked"].append({
            "function": "Impostor", "source_export_index": 7, "reason": "unresolved"})
        with self.assertRaisesRegex(ValueError, "Duplicate export index"):
            validate_source_replay(before, after)

    def test_function_count_cannot_be_inflated(self):
        before, after = snapshot(), snapshot(translated=True)
        after["counts"]["translated"] = 2
        with self.assertRaisesRegex(RuntimeError, "census"):
            validate_source_replay(before, after)

    def test_original_bytecode_and_export_identity_cannot_change(self):
        before, after = snapshot(translated=True), snapshot(translated=True)
        name = "/Game/Fixers/BP_GI_Fixers"
        after["packages"][name]["functions"]["ResetRaidConfig"]["source_bytecode_sha256"] = "d" * 64
        with self.assertRaisesRegex(RuntimeError, "source_bytecode_sha256"):
            validate_source_replay(before, after)
        after = snapshot(translated=True)
        after["packages"][name]["functions"]["ResetRaidConfig"]["source_export_index"] = 8
        with self.assertRaisesRegex(RuntimeError, "source_export_index"):
            validate_source_replay(before, after)

    def test_renamed_original_export_and_unwitnessed_gain_rejected(self):
        before, after = snapshot(), snapshot(translated=True)
        name = "/Game/Fixers/BP_GI_Fixers"
        after["packages"][name]["functions"]["ResetRaidConfig"]["name"] = "FakeReset"
        with self.assertRaisesRegex(RuntimeError, "function name changed"):
            validate_source_replay(before, after)
        after = snapshot(translated=True)
        after["packages"][name]["functions"]["ResetRaidConfig"].pop("source_bytecode_sha256")
        with self.assertRaisesRegex(RuntimeError, "bytecode SHA-256"):
            validate_source_replay(before, after)

    def test_missing_package_or_cache_rejected(self):
        before, after = snapshot(), snapshot(translated=True)
        after["packages"].clear()
        with self.assertRaisesRegex(RuntimeError, "package inventory"):
            validate_source_replay(before, after)
        after = snapshot(translated=True)
        after["missing_cached_packages"] = ["/Game/Another"]
        with self.assertRaisesRegex(RuntimeError, "cached"):
            validate_source_replay(before, after)

    def test_different_unreal_project_rejected(self):
        before, after = snapshot(), snapshot(translated=True)
        after["project"] = "/another/Unreal.uproject"
        with self.assertRaisesRegex(RuntimeError, "project identity"):
            validate_source_replay(before, after)


if __name__ == "__main__":
    unittest.main()
