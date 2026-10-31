"""ue2three Python tests as a distinct package.

The source tree also contains top-level test_blueprint_objects.py. Importing
these tests as tests.test_blueprint_objects avoids unittest's name collision.
Legacy fixtures import test_blueprint_migration and test_blueprint_events by
unqualified module name, so keep this directory importable for compatibility.
"""

from pathlib import Path
import sys

_fixtures_dir = str(Path(__file__).resolve().parent)
if _fixtures_dir not in sys.path:
    sys.path.insert(0, _fixtures_dir)
