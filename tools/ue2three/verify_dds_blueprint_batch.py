#!/usr/bin/env python3
"""Recompile ALL original DDS Blueprint functions and compare source-verified progress.

Runs only with a read-only original Unreal project and cached UAssetAPI data.
Writes a NEW report dir outside source and refuses to overwrite existing reports.
No false "green": translated code, runtime bindings and Play 1:1 are distinct.
"""
import argparse
import collections
import json
import sys
from pathlib import Path

from blueprint_migration import migrate_blueprints


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
