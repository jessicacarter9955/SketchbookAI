"""Content-addressed compiler artifacts, independent of runtime/QA revisions."""
import re
from pathlib import Path

from core import atomic_json, digest, read_json


class BlueprintCompileCache:
    def __init__(self, directory, project):
        self.directory = Path(directory).resolve()
        self.project = str(Path(project).resolve())
        source = Path(self.project).parent
        if self.directory == source or source in self.directory.parents:
            raise ValueError('Compiled Blueprint cache must stay outside the Unreal source project')

    def path(self, key):
        if not isinstance(key, str) or not re.fullmatch(r'[0-9a-f]{64}', key):
            raise ValueError('Invalid compiler cache key')
        path = self.directory / (key + '.json')
        if self.directory not in path.resolve().parents or self.directory not in path.with_name(path.name + '.tmp').resolve().parents:
            raise ValueError('Compiled Blueprint cache path escapes its directory')
        return path

    def load(self, key):
        try:
            record = read_json(self.path(key))
            payload = record.get('payload')
            if (record.get('schema_version') == 1 and record.get('compiler_key') == key
                    and isinstance(payload, dict) and payload.get('schema_version') == 1
                    and payload.get('project') == self.project
                    and record.get('payload_sha256') == digest(payload)
                    and not any(field in payload for field in ('runtime_sources', 'fingerprint', 'content_sha256', 'compiler_fingerprint'))):
                return payload
        except (OSError, ValueError, TypeError, AttributeError):
            pass
        return None

    def save(self, key, payload):
        if payload.get('project') != self.project:
            raise ValueError('Compiled Blueprint cache belongs to another project')
        atomic_json(self.path(key), {'schema_version': 1, 'compiler_key': key,
                                    'payload_sha256': digest(payload), 'payload': payload})


def bind_runtime(payload, compiler_key, runtime_sources):
    """A runtime edit reuses IR but always changes the published proof identity."""
    report = {**payload, 'compiler_fingerprint': compiler_key, 'runtime_sources': runtime_sources,
              'fingerprint': digest({'compiler': compiler_key, 'runtime_sources': runtime_sources})}
    report['content_sha256'] = digest(report)
    return report
