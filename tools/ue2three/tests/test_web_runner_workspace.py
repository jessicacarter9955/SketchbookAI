"""Regression tests for deterministic canonical ue2three workspace reuse."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from web_runner import reusable_workspace


class ReusableWorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = self.root / "source" / "DDS.uproject"
        self.project.parent.mkdir(parents=True)
        self.project.write_text("{}", encoding="utf-8")
        self.jobs = self.root / "cache" / "jobs"
        self.preferred = self.jobs / "canonical"

    def write_state(self, folder, project=None, verified=True):
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "state.json").write_text(json.dumps({
            "config": {"project": str(project or self.project)},
            "source_verification_status": "verified" if verified else "unverified",
        }), encoding="utf-8")

    def test_valid_canonical_skips_recursively_scanning_other_jobs(self):
        self.write_state(self.preferred)
        with patch.object(Path, "rglob", side_effect=AssertionError("must not crawl cache")):
            self.assertEqual(reusable_workspace(self.root / "cache", self.preferred, self.project), self.preferred)

    def test_stale_canonical_uses_verified_other_workspace(self):
        self.write_state(self.preferred, verified=False)
        old = self.jobs / "prior-verified"
        self.write_state(old)
        (old / "maps" / "runs").mkdir(parents=True)
        self.assertEqual(reusable_workspace(self.root / "cache", self.preferred, self.project), old)

    def test_canonical_must_match_exact_source_project(self):
        other = self.root / "source" / "Other.uproject"
        other.write_text("{}", encoding="utf-8")
        self.write_state(self.preferred, project=other)
        self.assertEqual(reusable_workspace(self.root / "cache", self.preferred, self.project), self.preferred)
