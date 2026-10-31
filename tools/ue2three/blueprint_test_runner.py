"""Load ue2three test modules by path, avoiding duplicate test-module names.

Some historical detached DDS worktrees contain both
tools/ue2three/test_blueprint_objects.py and
tools/ue2three/tests/test_blueprint_objects.py. Standard unittest discovery
imports both as test_blueprint_objects, rejecting otherwise valid patches.
This runner executes *all* matching files under unique module names while
keeping old unqualified fixture imports compatible.
"""
from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path
import sys
import unittest


def run_tests(test_root: Path, pattern: str) -> int:
    test_root = test_root.resolve()
    if not test_root.is_dir():
        raise FileNotFoundError(f'Blueprint tests directory not found: {test_root}')
    files = sorted(test_root.glob(pattern))
    if not files:
        raise RuntimeError(f'No Python tests match {pattern!r} in {test_root}')
    # Existing tests use "from test_blueprint_migration import node"; also
    # keep sibling compiler modules importable from the current checkout.
    compiler_root = test_root.parent.resolve()
    for root in (compiler_root, test_root):
        value = str(root)
        if value in sys.path:
            sys.path.remove(value)
        sys.path.insert(0, value)
    suite = unittest.TestSuite()
    for index, path in enumerate(files):
        unique_name = f'_ue2three_scoped_{index}_{path.stem}'
        spec = importlib.util.spec_from_file_location(unique_name, path)
        if spec is None or spec.loader is None:
            raise ImportError(f'Cannot import Blueprint test: {path}')
        module = importlib.util.module_from_spec(spec)
        sys.modules[unique_name] = module
        spec.loader.exec_module(module)
        suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(module))
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    return 0 if result.wasSuccessful() else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pattern', default='test_blueprint*.py')
    parser.add_argument('--tests-dir', default='tests', type=Path)
    args = parser.parse_args(argv)
    if args.tests_dir.is_absolute():
        parser.error('--tests-dir must be relative to the checkout compiler root')
    root = Path.cwd().resolve()
    target = (root / args.tests_dir).resolve()
    if not target.is_relative_to(root):
        parser.error('--tests-dir cannot escape the checkout compiler root')
    return run_tests(target, args.pattern)


if __name__ == '__main__':
    raise SystemExit(main())
