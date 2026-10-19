"""Read-only inventory and safety preflight for Unreal project ZIP archives.

Does not extract files, invoke Unreal, or assert source authenticity.
"""
from __future__ import annotations

import argparse
import json
import re
import stat
import zipfile
from pathlib import Path

PACKAGE_SUFFIXES = ('.uasset', '.umap', '.uexp', '.ubulk', '.uptnl')
SIDECARS = ('.uexp', '.ubulk', '.uptnl')


def inspect_archive(path: str | Path, *, max_entries: int = 500_000,
                    max_uncompressed_bytes: int = 200 * 1024 ** 3) -> dict:
    """Inspect central-directory metadata only; never extract archive members."""
    path = Path(path)
    counts = {suffix: 0 for suffix in (*PACKAGE_SUFFIXES, '.uproject')}
    errors: list[str] = []
    warnings: list[str] = []
    seen: set[str] = set()
    sidecars: list[str] = []
    total_size = 0
    total_compressed = 0
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > max_entries:
            errors.append('Archive exceeds configured entry limit.')
        for entry in entries:
            raw = entry.filename.replace('\\', '/')
            parts = raw.split('/')
            if (not raw or raw.startswith('/') or raw.startswith('//')
                    or re.match(r'^[A-Za-z]:', raw)
                    or any(part in ('', '..', '.') for part in parts if part != parts[-1])
                    or '..' in parts or '\x00' in raw):
                errors.append('Unsafe member path.')
                continue
            if entry.is_dir():
                continue
            if any(part in ('', '.') for part in parts):
                errors.append('Unsafe member path.')
                continue
            canonical = raw.casefold()
            if canonical in seen:
                errors.append('Duplicate member path (case-insensitive).')
                continue
            seen.add(canonical)
            if entry.create_system == 3 and stat.S_ISLNK(entry.external_attr >> 16):
                errors.append('Symbolic link member not permitted.')
            if entry.flag_bits & 1:
                errors.append('Encrypted member not supported.')
            total_size += entry.file_size
            total_compressed += entry.compress_size
            if total_size > max_uncompressed_bytes:
                errors.append('Archive exceeds configured uncompressed size limit.')
                break
            suffix = Path(raw).suffix.casefold()
            if suffix in counts:
                counts[suffix] += 1
            if suffix in SIDECARS:
                sidecars.append(canonical[: -len(suffix)] + '.uasset')
    orphans = sum(1 for parent in sidecars if parent not in seen)
    if orphans:
        warnings.append(f'{orphans} sidecar(s) have no matching .uasset; verify the original export.')
    if not counts['.uproject']:
        warnings.append('No .uproject file in archive; this may be a Content-only export.')
    if not (counts['.uasset'] or counts['.umap']):
        warnings.append('No Unreal package files found.')
    return {
        'schema': 'ue2three-zip-preflight-v1',
        'archive_name': path.name,
        'entry_count': len(entries),
        'uncompressed_bytes': total_size,
        'compressed_bytes': total_compressed,
        'package_counts': counts,
        'orphan_sidecar_count': orphans,
        'metadata_checks_passed': not errors,
        'errors': sorted(set(errors)),
        'warnings': warnings,
        'extraction_performed': False,
        'original_source_authenticity_verified': False,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path, help='Existing Unreal project ZIP')
    parser.add_argument('--max-entries', type=int, default=500_000)
    parser.add_argument('--max-uncompressed-gib', type=int, default=200)
    args = parser.parse_args(argv)
    if args.max_entries <= 0 or args.max_uncompressed_gib <= 0:
        parser.error('Limits must be positive.')
    try:
        report = inspect_archive(args.archive, max_entries=args.max_entries,
                                 max_uncompressed_bytes=args.max_uncompressed_gib * 1024 ** 3)
    except (OSError, zipfile.BadZipFile, zipfile.LargeZipFile) as exc:
        report = {'schema': 'ue2three-zip-preflight-v1', 'metadata_checks_passed': False,
                  'errors': [type(exc).__name__], 'extraction_performed': False,
                  'original_source_authenticity_verified': False}
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if report['metadata_checks_passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
