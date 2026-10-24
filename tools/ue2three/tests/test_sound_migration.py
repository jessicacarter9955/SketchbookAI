"""Sound export contracts can be checked without launching Unreal."""
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sound_migration import SoundMigrationError, select_soundwaves, validate_source_wave


class SoundMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = self.root / "Original.uproject"
        self.project.write_text("{}", encoding="utf-8")
        self.asset_file = self.root / "Content" / "Audio" / "Starter_Birds01.uasset"
        self.asset_file.parent.mkdir(parents=True)
        self.asset_file.write_bytes(b"original-unreal-asset")
        self.hash = hashlib.sha256(self.asset_file.read_bytes()).hexdigest()
        self.inventory = {"assets":[{"package":"/Game/Audio/Starter_Birds01",
                                     "path":"Content/Audio/Starter_Birds01.uasset",
                                     "sha256":self.hash}]}
        self.registry = {"assets":[{"package":"/Game/Audio/Starter_Birds01",
                                   "class":"SoundWave", "object_name":"Starter_Birds01"},
                                  {"package":"/Game/Audio/BackgroundMix","class":"SoundCue"}]}

    def test_select_original_sound_and_skip_exact_cached_source(self):
        selected = select_soundwaves(self.inventory,self.registry,self.project)
        self.assertEqual(len(selected),1)
        self.assertEqual(selected[0]["asset"],"/Game/Audio/Starter_Birds01.Starter_Birds01")
        self.assertEqual(selected[0]["filename"],f"audio/{self.hash}.wav")
        self.assertEqual(select_soundwaves(self.inventory,self.registry,self.project,
                         existing=[selected[0]]),[])
        with self.assertRaisesRegex(SoundMigrationError,"witnessed SoundWave"):
            select_soundwaves(self.inventory,self.registry,self.project,
                              requested=["/Game/Audio/BackgroundMix"])

    def test_original_hyphenated_soundwave_is_witnessed_and_safe(self):
        name = "M4A1_-Shot_10"
        path = self.asset_file.parent / (name + ".uasset")
        path.write_bytes(b"original-with-hyphen")
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        inventory = {"assets":[{"package":"/Game/Audio/" + name,
                               "path":"Content/Audio/" + name + ".uasset", "sha256":sha}]}
        registry = {"assets":[{"package":"/Game/Audio/" + name,
                              "class":"SoundWave", "object_name":name}]}
        selected = select_soundwaves(inventory, registry, self.project)
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0]["asset"], "/Game/Audio/" + name + "." + name)
        registry["assets"][0]["object_name"] = "../not-safe"
        with self.assertRaisesRegex(SoundMigrationError, "Unsafe original"):
            select_soundwaves(inventory, registry, self.project)

    def test_source_hash_mutation_and_bad_limits_fail_closed(self):
        self.asset_file.write_bytes(b"changed")
        with self.assertRaisesRegex(SoundMigrationError,"changed"):
            select_soundwaves(self.inventory,self.registry,self.project)
        with self.assertRaisesRegex(SoundMigrationError,"limit"):
            select_soundwaves(self.inventory,self.registry,self.project,limit=0)

    def test_wav_validator_rejects_random_payload(self):
        file = self.root / "test.wav"
        file.write_bytes(b"nope" * 20)
        with self.assertRaisesRegex(SoundMigrationError,"not WAV"):
            validate_source_wave(file)
        file.write_bytes(b"RIFF" + (36).to_bytes(4,"little") + b"WAVE" + b"\0" * 40)
        self.assertEqual(validate_source_wave(file), hashlib.sha256(file.read_bytes()).hexdigest())


if __name__ == "__main__":
    unittest.main()
