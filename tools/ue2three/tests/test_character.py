import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from character import character_fingerprint, load_character_recipe, package_files, validate_character_output


class CharacterMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = self.root / "Game.uproject"
        self.project.write_text("{}", encoding="utf-8")
        (self.root / "Content" / "Hero").mkdir(parents=True)
        (self.root / "Content" / "Hero" / "SK_Hero.uasset").write_bytes(b"mesh")
        (self.root / "Content" / "Hero" / "Idle.uasset").write_bytes(b"idle")
        self.recipe_path = self.root / "recipe.json"
        self.recipe_path.write_text(json.dumps({
            "schema_version": 1,
            "id": "hero",
            "mesh": "/Game/Hero/SK_Hero",
            "clips": {"idle": "/Game/Hero/Idle"},
            "runtime": {
                "required_bones": ["root", "pelvis"],
                "attachments": {"weapon": "hand_r"},
                "root_motion": "strip_root_translation",
            },
        }), encoding="utf-8")

    def test_recipe_and_fingerprint_track_source_bytes(self):
        recipe = load_character_recipe(self.recipe_path)
        before, _ = character_fingerprint(self.project, recipe)
        (self.root / "Content" / "Hero" / "Idle.uasset").write_bytes(b"changed")
        after, _ = character_fingerprint(self.project, recipe)
        self.assertNotEqual(before, after)
        self.assertEqual(package_files(self.project, "/Game/Hero/SK_Hero")[0].name, "SK_Hero.uasset")

    def test_recipe_rejects_unsafe_id(self):
        self.recipe_path.write_text(json.dumps({
            "schema_version": 1,
            "id": "../oops",
            "mesh": "/Game/Hero/SK_Hero",
            "clips": {"idle": "/Game/Hero/Idle"},
        }), encoding="utf-8")
        with self.assertRaises(ValueError):
            load_character_recipe(self.recipe_path)

    def test_output_validation_checks_manifest_fingerprint_and_glb_header(self):
        recipe = load_character_recipe(self.recipe_path)
        fingerprint, _ = character_fingerprint(self.project, recipe)
        output = self.root / "out"
        output.mkdir()

        def write_glb(name):
            path = output / name
            path.write_bytes(struct.pack("<4sII", b"glTF", 2, 12))
            return name

        (output / "manifest.json").write_text(json.dumps({
            "schema_version": 1,
            "kind": "character",
            "fingerprint": fingerprint,
            "mesh": write_glb("hero.glb"),
            "clips": {"idle": write_glb("idle.glb")},
        }), encoding="utf-8")

        result = validate_character_output(output, fingerprint)
        self.assertEqual(result["validated"]["mesh"]["bytes"], 12)
        with self.assertRaises(ValueError):
            validate_character_output(output, "wrong")


if __name__ == "__main__":
    unittest.main()
