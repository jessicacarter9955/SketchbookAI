"""Synthetic ZIP fixtures exercise preflight logic; not original Unreal packages."""
import tempfile
import unittest
import zipfile
from pathlib import Path

from unreal_zip_audit import inspect_archive, main


class UnrealZipAuditTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'test.zip'

    def write(self, members):
        with zipfile.ZipFile(self.path, 'w') as archive:
            for name, data in members:
                archive.writestr(name, data)

    def test_inventory_is_read_only_and_counts_package_sidecars(self):
        self.write([('Project.uproject', '{}'), ('Content/Items/Box.uasset', 'fixture'),
                    ('Content/Items/Box.uexp', 'fixture'), ('Content/World.umap', 'fixture')])
        before = self.path.read_bytes()
        report = inspect_archive(self.path)
        self.assertTrue(report['metadata_checks_passed'])
        self.assertEqual(report['package_counts']['.uasset'], 1)
        self.assertEqual(report['package_counts']['.umap'], 1)
        self.assertEqual(report['orphan_sidecar_count'], 0)
        self.assertFalse(report['extraction_performed'])
        self.assertFalse(report['original_source_authenticity_verified'])
        self.assertEqual(self.path.read_bytes(), before)

    def test_path_traversal_and_duplicate_names_are_rejected(self):
        self.write([('Project.uproject', '{}'), ('../outside.uasset', 'fixture'),
                    ('Content/Box.uasset', 'fixture'), ('content/box.uasset', 'fixture')])
        report = inspect_archive(self.path)
        self.assertFalse(report['metadata_checks_passed'])
        self.assertIn('Unsafe member path.', report['errors'])
        self.assertIn('Duplicate member path (case-insensitive).', report['errors'])

    def test_orphan_sidecars_are_reported_not_falsely_rejected(self):
        self.write([('Content/Items/Box.uexp', 'fixture')])
        report = inspect_archive(self.path)
        self.assertTrue(report['metadata_checks_passed'])
        self.assertEqual(report['orphan_sidecar_count'], 1)
        self.assertTrue(report['warnings'])

    def test_size_and_entry_limits(self):
        self.write([('Project.uproject', '0123456789'), ('Content/Box.uasset', 'fixture')])
        self.assertFalse(inspect_archive(self.path, max_entries=1)['metadata_checks_passed'])
        self.assertFalse(inspect_archive(self.path, max_uncompressed_bytes=5)['metadata_checks_passed'])

    def test_invalid_zip_fails_cli_without_extraction(self):
        self.path.write_bytes(b'not a zip')
        self.assertEqual(main([str(self.path)]), 1)


if __name__ == '__main__':
    unittest.main()
