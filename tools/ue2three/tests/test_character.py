import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from character import (_publish_character, character_fingerprint, load_character_recipe,
                       package_files, validate_character_output)


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
                "animation_aliases": {"start_forward": "idle"},
            },
        }), encoding="utf-8")

    def test_recipe_and_fingerprint_track_source_bytes(self):
        recipe = load_character_recipe(self.recipe_path)
        before, _ = character_fingerprint(self.project, recipe)
        (self.root / "Content" / "Hero" / "Idle.uasset").write_bytes(b"changed")
        after, _ = character_fingerprint(self.project, recipe)
        self.assertNotEqual(before, after)
        self.assertEqual(package_files(self.project, "/Game/Hero/SK_Hero")[0].name, "SK_Hero.uasset")
        self.assertEqual(recipe["runtime"]["animation_aliases"], {"start_forward": "idle"})

    def test_recipe_rejects_unsafe_id(self):
        self.recipe_path.write_text(json.dumps({
            "schema_version": 1,
            "id": "../oops",
            "mesh": "/Game/Hero/SK_Hero",
            "clips": {"idle": "/Game/Hero/Idle"},
        }), encoding="utf-8")
        with self.assertRaises(ValueError):
            load_character_recipe(self.recipe_path)


    def test_recipe_rejects_alias_to_missing_clip(self):
        data = json.loads(self.recipe_path.read_text(encoding="utf-8"))
        data["runtime"]["animation_aliases"] = {"move": "run"}
        self.recipe_path.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "missing clips"):
            load_character_recipe(self.recipe_path)

    def test_engine_plugin_requirements_are_portable_and_validated(self):
        data = json.loads(self.recipe_path.read_text(encoding="utf-8"))
        data["export"] = {"required_engine_plugins": ["PoseSearch", "ControlRig"]}
        self.recipe_path.write_text(json.dumps(data), encoding="utf-8")
        recipe = load_character_recipe(self.recipe_path)
        self.assertEqual(recipe["export"]["required_engine_plugins"], ["ControlRig", "PoseSearch"])
        data["export"]["required_engine_plugins"] = ["../Outside"]
        self.recipe_path.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "required_engine_plugins"):
            load_character_recipe(self.recipe_path)

    def test_attachment_assets_are_fingerprinted_and_transforms_checked(self):
        package = self.root / "Content" / "Hero" / "Weapon.uasset"
        package.write_bytes(b"weapon")
        data = json.loads(self.recipe_path.read_text(encoding="utf-8"))
        data["attachment_assets"] = {"tool": {"asset": "/Game/Hero/Weapon", "bone": "hand_r"}}
        self.recipe_path.write_text(json.dumps(data), encoding="utf-8")
        recipe = load_character_recipe(self.recipe_path)
        fingerprint, records = character_fingerprint(self.project, recipe)
        self.assertEqual(recipe["attachment_assets"]["tool"]["transform"]["scale"], [1.0, 1.0, 1.0])
        self.assertIn("/Game/Hero/Weapon", {item["package"] for item in records})
        self.assertEqual(len(fingerprint), 64)
        data["attachment_assets"]["tool"]["transform"] = {"position": [0, float("nan"), 0]}
        self.recipe_path.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "finite numbers"):
            load_character_recipe(self.recipe_path)

    def test_publish_copies_only_validated_runtime_output_outside_source(self):
        output = self.root / "workspace" / "out"
        output.mkdir(parents=True)
        (output / "character.glb").write_bytes(struct.pack("<4sII", b"glTF", 2, 12))
        (output / "idle.glb").write_bytes(struct.pack("<4sII", b"glTF", 2, 12))
        (output / "manifest.json").write_text(json.dumps({
            "schema_version": 1,
            "kind": "character",
            "fingerprint": "a" * 64,
            "mesh": "character.glb",
            "clips": {"idle": "idle.glb"},
        }), encoding="utf-8")
        destination = self.root.parent / (self.root.name + "-published")
        self.addCleanup(lambda: destination.exists() and __import__("shutil").rmtree(destination))
        self.assertEqual(Path(_publish_character(output, destination, self.project)), destination.resolve())
        self.assertTrue((destination / "manifest.json").is_file())
        with self.assertRaisesRegex(ValueError, "source project"):
            _publish_character(output, self.root / "Content" / "published", self.project)

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
