"""Rank real source-witnessed Blueprint dependency cascades.

An unresolved caller is *not* a translated function. This module identifies
which first unsupported source functions have the largest observed dependent
subtrees. Counts are bounded evidence, never forecasts of newly green code.
"""

from collections import defaultdict


DEPENDENCY_PREFIX = 'Untranslated function dependency: '


def dependency_cascade_impact(programs):
    """Group the compiler's *first* dependency blockers by their root cause.

    Dependencies are scoped to their original package. A missing target,
    duplicate name, or cycle is explicitly unresolved instead of assigning a
    guessed root. The report is deterministic and read-only.
    """
    if not isinstance(programs, dict) or not isinstance(programs.get('packages'), dict):
        raise ValueError('Expected packages from a Blueprint program report')
    ranked, unresolved = [], []
    blocked_total = dependency_total = attributed = 0
    for package_name, data in sorted(programs['packages'].items()):
        blocked = data.get('blocked', [])
        if not isinstance(blocked, list):
            raise ValueError(f'{package_name}: invalid blocked functions')
        by_name = defaultdict(list)
        for row in blocked:
            if (not isinstance(row, dict) or not isinstance(row.get('function'), str) or not row['function']
                    or not isinstance(row.get('reason'), str) or not row['reason']):
                raise ValueError(f'{package_name}: blocked function without source identity or reason')
            by_name[row['function']].append(row)
        blocked_total += len(blocked)
        causes = defaultdict(list)
        cache = {}

        def root_for(name, visited=()):
            if name in cache:
                return cache[name]
            if name in visited:
                return (None, 'dependency_cycle', visited + (name,))
            rows = by_name.get(name, [])
            if len(rows) != 1:
                return (None, 'missing_dependency_target' if not rows else 'ambiguous_dependency_target', (name,))
            row = rows[0]
            reason = row.get('reason')
            if not isinstance(reason, str) or not reason:
                raise ValueError(f'{package_name}: missing blocker reason')
            if not reason.startswith(DEPENDENCY_PREFIX):
                result = (name, None, ())
            else:
                callee = reason[len(DEPENDENCY_PREFIX):].strip()
                result = root_for(callee, visited + (name,)) if callee else (None, 'missing_dependency_target', (name,))
            # Caching only resolved paths avoids hiding the full error route.
            if result[0] is not None:
                cache[name] = result
            return result

        for row in blocked:
            is_dependency = row['reason'].startswith(DEPENDENCY_PREFIX)
            dependency_total += is_dependency
            root, error, path = root_for(row['function'])
            if root is None:
                unresolved.append({'package': package_name, 'function': row['function'],
                                   'source_export_index': row.get('source_export_index'),
                                   'error': error, 'path': list(path)})
                continue
            causes[root].append(row)
            attributed += 1
        for name, dependents in causes.items():
            root_rows = by_name[name]
            if len(root_rows) != 1:
                raise ValueError('Resolved root has an ambiguous source identity')
            root = root_rows[0]
            members = sorted(dependents, key=lambda row: (str(row.get('source_export_index')), row['function']))
            ranked.append({'package': package_name, 'function': name,
                           'source_export_index': root.get('source_export_index'),
                           'first_blocker': root['reason'],
                           'observed_blocked_functions': len(members),
                           'observed_dependency_callers': len(members) - 1,
                           'affected': [{'function': row['function'],
                                         'source_export_index': row.get('source_export_index')}
                                        for row in members]})
    ranked.sort(key=lambda row: (-row['observed_blocked_functions'], row['package'],
                                 row['function'], str(row['source_export_index'])))
    unresolved.sort(key=lambda row: (row['package'], row['function'], str(row['source_export_index'])))
    return {'schema_version': 1, 'blocked_functions': blocked_total,
            'first_dependency_blockers': dependency_total,
            'attributed_functions': attributed, 'unresolved_functions': len(unresolved),
            'roots': ranked, 'unresolved': unresolved,
            'interpretation': ('Each root is an observed first blocker. Affected caller counts overlap later '
                               'unknown semantic failures and must never be presented as guaranteed translations.')}
