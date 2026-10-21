"""Parallel Unreal cache selection never changes the original source scope."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from blueprint_precache_parallel import select_packages


class ParallelPrecacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.cache = Path(self.temp.name)
        self.registry = {"assets": [
            {"package": "/Game/Fixers/Core/BP_Combat", "class": "BlueprintGeneratedClass"},
            {"package": "/Game/Fixers/UI/WBP_HUD", "class": "WidgetBlueprintGeneratedClass"},
            {"package": "/Game/Unrelated/SM_Tree", "class": "StaticMesh"},
        ]}
        self.inventory = {"assets": [
            {"package": "/Game/Fixers/Core/BP_Combat", "sha256": "a" * 64},
            {"package": "/Game/Fixers/UI/WBP_HUD", "sha256": "b" * 64},
            {"package": "/Game/Unrelated/SM_Tree", "sha256": "c" * 64},
        ]}

    def test_auto_prefers_gameplay_core_without_discarding_ui(self):
        self.assertEqual(select_packages(self.registry, self.inventory, self.cache, auto=True, limit=2),
                         ["/Game/Fixers/Core/BP_Combat", "/Game/Fixers/UI/WBP_HUD"])

    def test_cached_source_is_skipped_for_auto_batch(self):
        (self.cache / ("a"*64 + ".json")).write_text("{}", encoding="utf-8")
        self.assertEqual(select_packages(self.registry, self.inventory, self.cache, auto=True),
                         ["/Game/Fixers/UI/WBP_HUD"])

    def test_rejects_uninventoried_and_nonblueprint_assets(self):
        with self.assertRaises(ValueError):
            select_packages(self.registry, self.inventory, self.cache, requested=["/Game/Unrelated/SM_Tree"])
        with self.assertRaises(ValueError):
            select_packages(self.registry, self.inventory, self.cache, requested=["/Game/Other/Missing"])
        with self.assertRaises(ValueError):
            select_packages(self.registry, self.inventory, self.cache, auto=True, requested=["/Game/Fixers/Core/BP_Combat"])
