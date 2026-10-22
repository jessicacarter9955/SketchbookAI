import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from map_actor_selection import resolve_actor_selection


class ActorSelectionTests(unittest.TestCase):
    class Actor:
        def __init__(self, name):
            self.name = name

        def get_name(self):
            return self.name

    def test_all_actors_preserves_legacy_empty_set_contract(self):
        selected, summary = resolve_actor_selection([self.Actor("Hero"), self.Actor("Door")])
        self.assertEqual(selected, set())
        self.assertEqual(summary, {"mode": "all", "available": 2, "selected": 2})

    def test_subset_selects_exact_source_identifiers(self):
        actors = [self.Actor("Hero"), self.Actor("Door"), self.Actor("WorldSettings")]
        selected, summary = resolve_actor_selection(actors, ["Door", "Hero"])
        self.assertEqual({actor.get_name() for actor in selected}, {"Hero", "Door"})
        self.assertEqual(summary["actor_names"], ["Door", "Hero"])
        self.assertEqual(summary["available"], 3)
        self.assertEqual(summary["selected"], 2)

    def test_never_interprets_empty_or_invalid_subset_as_all(self):
        actors = [self.Actor("Hero")]
        for requested in ([], "Hero", ["Missing"], ["Hero", "Hero"], [""], ["A\x00B"]):
            with self.subTest(requested=requested), self.assertRaises(ValueError):
                resolve_actor_selection(actors, requested)

    def test_duplicate_world_names_are_rejected(self):
        with self.assertRaises(ValueError):
            resolve_actor_selection([self.Actor("Hero"), self.Actor("Hero")], ["Hero"])


if __name__ == "__main__":
    unittest.main()
