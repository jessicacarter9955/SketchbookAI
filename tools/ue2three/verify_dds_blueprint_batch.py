#!/usr/bin/env python3
"""Recompile ALL original DDS Blueprint functions and compare source-verified progress.

Runs only with a read-only original Unreal project and cached UAssetAPI data.
Writes a NEW report dir outside source and refuses to overwrite existing reports.
No false "green": translated code, runtime bindings and Play 1:1 are distinct.
"""
import argparse
import collections
import json
import re
import sys
from pathlib import Path

from blueprint_migration import migrate_blueprints
from compare_blueprint_reports import compare, entries



def validate_source_replay(reference, result):
    """Fail closed on changed original sources, missing functions or fake count gains.

    Function names alone are not stable identities: use the original export index,
    original package SHA-256 and parsed-package SHA-256 before reporting any gain.
    This is a compiler/source gate, NOT a UE runtime or Play certification.
    """
    previous, current = reference['packages'], result['packages']
    if set(previous) != set(current):
        raise RuntimeError('Original Blueprint package inventory differs')
    if result.get('missing_cached_packages'):
        raise RuntimeError('Original cached Blueprint packages are missing')
    if reference.get('project') != result.get('project'):
        raise RuntimeError('Original Unreal project identity differs')
    valid_sha = re.compile(r'^[0-9a-f]{64}
    project = Path(project).resolve(strict=True)
    workspace = Path(workspace).resolve(strict=True)
    baseline = Path(baseline).resolve(strict=True)
    output = Path(output).resolve()
    if not project.is_file() or project.suffix.lower() != '.uproject':
        raise ValueError('Requires original source .uproject')
    if (output.exists() or project.parent == output or project.parent in output.parents
            or output == workspace or workspace in output.parents):
        raise ValueError('Output must be new and outside the source and cache workspace')
    reference = json.loads(baseline.read_text(encoding='utf-8-sig'))
    if (reference.get('project') != str(project) or
            not isinstance(reference.get('packages'), dict) or
            reference.get('counts', {}).get('translated') is None):
        raise ValueError('Baseline is not the same original DDS source inventory')
    result = migrate_blueprints(project, workspace, output)
    previous, current = reference['packages'], result['packages']
    if set(previous) != set(current):
        raise RuntimeError('Original Blueprint package inventory differs')
    gained, regressed = [], []
    causes = collections.Counter()
    reasons_changed = []
    for name in sorted(previous):
        old, new = previous[name], current[name]
        before = set(old['functions'])
        after = set(new['functions'])
        gained.extend([{'package': name, 'function': f} for f in sorted(after - before)])
        regressed.extend([{'package': name, 'function': f} for f in sorted(before - after)])
        old_reason = {x['function']: x['reason'] for x in old['blocked']}
        new_reason = {x['function']: x['reason'] for x in new['blocked']}
        causes.update(new_reason.values())
        for function, reason in old_reason.items():
            if function in new_reason and new_reason[function] != reason:
                reasons_changed.append({'package': name, 'function': function,
                                        'before': reason, 'after': new_reason[function]})
    expected = result['counts']['translated'] - reference['counts']['translated']
    if expected != len(gained) - len(regressed):
        raise RuntimeError('Translated Blueprint census or per-function comparison differs')
    summary = {'source': str(project), 'baseline': str(baseline),
               'output': str(output / 'blueprint-programs.json'),
               'counts': result['counts'], 'baseline_counts': reference['counts'],
               'gained_functions': gained, 'regressed_functions': regressed,
               'changed_blocker_reasons': reasons_changed,
               'blocker_counts': causes.most_common(),
               'cache_missing': result['missing_cached_packages'],
               'source_identity_gate_passed': True,
               'source_export_identity_count': len(entries(result)),
               'runtime_three_play_1to1_certified': False}
    report_file = output / 'blueprint-source-progress.json'
    report_file.write_text(json.dumps(summary, indent=2, sort_keys=True), encoding='utf-8')
    print('ORIGINAL_BLUEPRINT_COUNTS', result['counts'], flush=True)
    print('GAINED', len(gained), gained[:15], flush=True)
    print('REGRESSED', len(regressed), regressed[:15], flush=True)
    print('BLOCKERS_TOP', causes.most_common(20), flush=True)
    print('REASONS_CHANGED', len(reasons_changed), reasons_changed[:10], flush=True)
    print('CACHE_MISSING', len(result['missing_cached_packages']), flush=True)
    print('REPORT', report_file, flush=True)
    if regressed or result['missing_cached_packages']:
        raise RuntimeError('Regression or missing original cached source: report is not certifiable')
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path, required=True)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        verify(args.project, args.workspace, args.baseline, args.output)
    except (ValueError, RuntimeError, OSError, KeyError) as error:
        print('BLUEPRINT_SOURCE_PROGRESS_ERROR', str(error), file=sys.stderr)
        raise SystemExit(2)


if __name__ == '__main__':
    main()
).fullmatch
    for name in sorted(previous):
        old_source = previous[name].get('source', {})
        new_source = current[name].get('source', {})
        for field in ('source_sha256', 'parsed_sha256'):
            before, after = old_source.get(field), new_source.get(field)
            if not (isinstance(before, str) and valid_sha(before) and before == after):
                raise RuntimeError(f'Original {field} witness differs: {name}')
        for function in set(previous[name].get('functions', {})) & set(current[name].get('functions', {})):
            old = previous[name]['functions'][function]
            new = current[name]['functions'][function]
            for field in ('source_bytecode_sha256', 'source_export_index'):
                if old.get(field) != new.get(field):
                    raise RuntimeError(f'Original {field} function witness differs: {name}::{function}')
    audit = compare(reference, result)
    if not audit['same_source_snapshot'] or not audit['monotonic_source_compilation']:
        raise RuntimeError('Original-source function identity, regression or disappearance detected')
    old_entries, new_entries = entries(reference), entries(result)
    if set(old_entries) != set(new_entries):
        raise RuntimeError('Original function export inventory differs')
    for report, indexed in ((reference, old_entries), (result, new_entries)):
        counts = report.get('counts', {})
        translated = sum(item['status'] == 'translated' for item in indexed.values())
        blocked = len(indexed) - translated
        if counts.get('translated') != translated or counts.get('blocked') != blocked:
            raise RuntimeError('Function census disagrees with source export identities')
    if (audit['new_translation_count'] !=
            result['counts']['translated'] - reference['counts']['translated']):
        raise RuntimeError('Translation gain disagrees with original source export identities')
    return audit


def verify(project, workspace, baseline, output):
    project = Path(project).resolve(strict=True)
    workspace = Path(workspace).resolve(strict=True)
    baseline = Path(baseline).resolve(strict=True)
    output = Path(output).resolve()
    if not project.is_file() or project.suffix.lower() != '.uproject':
        raise ValueError('Requires original source .uproject')
    if (output.exists() or project.parent == output or project.parent in output.parents
            or output == workspace or workspace in output.parents):
        raise ValueError('Output must be new and outside the source and cache workspace')
    reference = json.loads(baseline.read_text(encoding='utf-8-sig'))
    if (reference.get('project') != str(project) or
            not isinstance(reference.get('packages'), dict) or
            reference.get('counts', {}).get('translated') is None):
        raise ValueError('Baseline is not the same original DDS source inventory')
    result = migrate_blueprints(project, workspace, output)
    audit = validate_source_replay(reference, result)
    gained = [{'package': row['package'], 'function': row['after']['function'],
               'source_export_index': int(row['export_index'])}
              for row in audit['new_translations']]
    regressed = [{'package': row['package'], 'function': row['before']['function'],
                  'source_export_index': int(row['export_index'])}
                 for row in audit['regressions']]
    causes = collections.Counter(
        item['reason'] for package in result['packages'].values()
        for item in package.get('blocked', []))
    reasons_changed = [{'package': row['package'],
                        'function': row['before']['function'],
                        'before': row['before']['reason'], 'after': row['after']['reason']}
                       for row in audit['changed_functions']
                       if row['before'] and row['after']
                       and row['before']['status'] == row['after']['status'] == 'blocked'
                       and row['before']['reason'] != row['after']['reason']]
    summary = {'source': str(project), 'baseline': str(baseline),
               'output': str(output / 'blueprint-programs.json'),
               'counts': result['counts'], 'baseline_counts': reference['counts'],
               'gained_functions': gained, 'regressed_functions': regressed,
               'changed_blocker_reasons': reasons_changed,
               'blocker_counts': causes.most_common(),
               'cache_missing': result['missing_cached_packages'],
               'runtime_three_play_1to1_certified': False}
    report_file = output / 'blueprint-source-progress.json'
    report_file.write_text(json.dumps(summary, indent=2, sort_keys=True), encoding='utf-8')
    print('ORIGINAL_BLUEPRINT_COUNTS', result['counts'], flush=True)
    print('GAINED', len(gained), gained[:15], flush=True)
    print('REGRESSED', len(regressed), regressed[:15], flush=True)
    print('BLOCKERS_TOP', causes.most_common(20), flush=True)
    print('REASONS_CHANGED', len(reasons_changed), reasons_changed[:10], flush=True)
    print('CACHE_MISSING', len(result['missing_cached_packages']), flush=True)
    print('REPORT', report_file, flush=True)
    if regressed or result['missing_cached_packages']:
        raise RuntimeError('Regression or missing original cached source: report is not certifiable')
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path, required=True)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        verify(args.project, args.workspace, args.baseline, args.output)
    except (ValueError, RuntimeError, OSError, KeyError) as error:
        print('BLUEPRINT_SOURCE_PROGRESS_ERROR', str(error), file=sys.stderr)
        raise SystemExit(2)


if __name__ == '__main__':
    main()
