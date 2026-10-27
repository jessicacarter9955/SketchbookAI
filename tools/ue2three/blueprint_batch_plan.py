#!/usr/bin/env python3
"""Census every cached source call/opcode to plan shared Blueprint adapter batches.

Source occurrences are candidates, never proof of unsupported execution or unlocked
functions. First compiler failures remain separate evidence. No Unreal/source edits.
"""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
import hashlib
import html
import json
from pathlib import Path
import re

VERSION = 1
CALL_OPS = {'EX_CallMath', 'EX_FinalFunction', 'EX_LocalFinalFunction',
            'EX_VirtualFunction', 'EX_LocalVirtualFunction'}


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def digest(value):
    return hashlib.sha256(value).hexdigest()


def walk(value, path='$'):
    if isinstance(value, dict):
        yield path, value
        for key, child in value.items():
            if isinstance(child, (dict, list)):
                yield from walk(child, path + '/' + str(key))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from walk(child, path + '/' + str(index))


def opcode(node):
    name = str(node.get('$type', '')).split(',', 1)[0].rsplit('.', 1)[-1]
    return name if name.startswith('EX_') else None


def resolve_reference(document, reference):
    """Exact serialized import/export identity, rejecting cycles and bad indexes."""
    names, seen = [], set()
    for _ in range(64):
        if type(reference) is not int or reference == 0 or reference in seen:
            return None
        seen.add(reference)
        objects = document.get('Imports' if reference < 0 else 'Exports', [])
        index = -reference - 1 if reference < 0 else reference - 1
        if not 0 <= index < len(objects):
            return None
        item = objects[index]
        names.append(str(item.get('ObjectName', '')))
        if item.get('ClassName') == 'Package':
            return list(reversed(names))
        parent = item.get('OuterIndex', 0)
        if not parent and reference > 0:
            return list(reversed(names))
        reference = parent
    return None


def census_package(name, document):
    functions = []
    for index, export in enumerate(document.get('Exports', []), 1):
        bytecode = export.get('ScriptBytecode')
        if not bytecode:
            continue
        name_ = export.get('ObjectName', '')
        row = {'id': name + '::' + name_, 'package': name, 'function': name_,
               'source_export_index': index, 'owner': export.get('OuterIndex'),
               'opcodes': {}, 'calls': [], 'properties': []}
        ops = defaultdict(list)
        for path, node in walk(bytecode, '$/ScriptBytecode'):
            kind = opcode(node)
            if kind:
                ops[kind].append(path)
            if kind in CALL_OPS:
                reference = node.get('StackNode')
                identity = resolve_reference(document, reference)
                call = {'opcode': kind, 'path': path, 'identity': identity,
                        'name': node.get('VirtualFunctionName') or (identity[-1] if identity else None)}
                if type(reference) is int and reference > 0 and identity:
                    call['exact_callee'] = name + '::' + identity[-1]
                elif identity and identity[0].startswith('/Game/') and len(identity) >= 3:
                    call['exact_callee'] = identity[0] + '::' + identity[-1]
                row['calls'].append(call)
        row['opcodes'] = dict(ops)
        row['properties'] = [{'name': p.get('Name'), 'type': p.get('SerializedType')}
                             for p in export.get('LoadedProperties', [])]
        functions.append(row)
    return functions


def read_package(name, source, cache_root, census_root, implementation):
    sha = source.get('source_sha256', '')
    if not re.fullmatch('[0-9a-f]{64}', sha):
        raise ValueError('Invalid source SHA for ' + name)
    parsed_sha = source.get('parsed_sha256')
    key = digest((implementation + ':' + str(parsed_sha) + ':' + sha).encode())
    saved = census_root / (key + '.json')
    # Reusing a census avoids JSON decoding, but its source witness must still
    # match the current bytes. Never trust an old report over changed cache data.
    path = cache_root / (sha + '.json')
    raw = path.read_bytes()
    actual = digest(raw)
    if parsed_sha and actual != parsed_sha:
        raise ValueError('Parsed source hash differs for ' + name)
    if saved.is_file():
        cached = load(saved)
        # Package identities are external to a content hash; never reuse aliases.
        if cached.get('package') == name:
            return cached['functions'], True
    result = census_package(name, json.loads(raw.decode('utf-8-sig')))
    saved.write_text(json.dumps({'package': name, 'functions': result}, sort_keys=True), encoding='utf-8')
    return result, False


def reverse_closure(seeds, reverse):
    visited, todo = set(seeds), list(seeds)
    while todo:
        for caller in reverse.get(todo.pop(), ()):
            if caller not in visited:
                visited.add(caller)
                todo.append(caller)
    return visited


def build_plan(report, functions):
    rows = {row['id']: row for row in functions}
    blocked, translated, failure = set(), set(), {}
    for package, result in report['packages'].items():
        blocked.update(package + '::' + row['function'] for row in result.get('blocked', []))
        translated.update(package + '::' + function for function in result.get('functions', {}))
        failure.update((package + '::' + row['function'], row['reason']) for row in result.get('blocked', []))
    reverse = defaultdict(set)
    families = {}

    def family(key, category, row, witness):
        target = families.setdefault(key, {'family': key, 'category': category,
                                         'blocked_source_functions': set(), 'translated_source_functions': set(),
                                         'first_failure_functions': set(), 'witnesses': []})
        if row['id'] in blocked:
            target['blocked_source_functions'].add(row['id'])
        elif row['id'] in translated:
            target['translated_source_functions'].add(row['id'])
        if len(target['witnesses']) < 12:
            target['witnesses'].append({'function': row['id'], **witness})
        return target

    known_opcode_failures = set()
    for reason in failure.values():
        known_opcode_failures.update(re.findall(r'\bEX_[A-Za-z0-9_]+\b', reason))
    for row in functions:
        reason = failure.get(row['id'], '')
        for kind, paths in row['opcodes'].items():
            item = family('opcode:' + kind, 'opcode', row, {'path': paths[0], 'occurrences': len(paths)})
            item['reported_unsupported_somewhere'] = kind in known_opcode_failures
            if kind in set(re.findall(r'\bEX_[A-Za-z0-9_]+\b', reason)):
                item['first_failure_functions'].add(row['id'])
        for call in row['calls']:
            target = call.get('exact_callee')
            if target in rows:
                reverse[target].add(row['id'])
            identity = call.get('identity')
            if identity and identity[0].startswith('/Script/'):
                key = 'native:' + '.'.join(identity)
                item = family(key, 'native_call', row, {'path': call['path'], 'identity': identity,
                                                      'opcode': call['opcode']})
                # Generic first failures cannot identify a specific call in a graph.
                if re.search(r'(?<![A-Za-z0-9_])' + re.escape(identity[-1]) + r'(?![A-Za-z0-9_])', reason):
                    item['first_failure_functions'].add(row['id'])
        for prop in row['properties']:
            type_ = prop.get('type')
            if type_:
                item = family('property:' + type_, 'property_type', row, {'property': prop['name']})
                if 'property type: ' + type_ in reason:
                    item['first_failure_functions'].add(row['id'])
    result = []
    for item in families.values():
        direct = item['blocked_source_functions']
        if not direct:
            continue
        callers = (reverse_closure(direct, reverse) & blocked) - direct
        item['transitive_blocked_callers'] = sorted(callers)
        for key in ('blocked_source_functions', 'translated_source_functions', 'first_failure_functions'):
            item[key] = sorted(item[key])
            item[key + '_count'] = len(item[key])
        item['transitive_blocked_callers_count'] = len(callers)
        item['estimated_affected_union_count'] = len(direct | callers)
        item['proven_unlocked_count'] = None
        item['rank_eligible'] = (item['category'] == 'native_call' and not item['translated_source_functions_count']
                                 or bool(item['first_failure_functions_count']))
        result.append(item)
    result.sort(key=lambda item: (not item['rank_eligible'], -item['estimated_affected_union_count'],
                                 -item['first_failure_functions_count'], item['family']))
    return {'schema_version': VERSION, 'source_counts': report['counts'],
            'function_census_count': len(rows), 'blocked_functions_without_source': sorted(blocked - rows.keys()),
            'exact_source_call_edges': sum(map(len, reverse.values())),
            'limitations': [
                'Every nested bytecode opcode and static call is censused, including code after the first compiler error.',
                'Source occurrences are adapter candidates, not a complete semantic unsupported-operation diagnosis.',
                'First-failure evidence is taken from the supplied compiler report; generic errors do not identify a call.',
                'Affected counts overlap and cannot be added. Supporting one family may expose further blockers.',
                'Transitive callers use resolved static source references only; virtual dispatch and runtime reachability are not inferred.',
                'Proven unlocked counts require a later complete compiler replay and are never estimated here.',
                'No Play, visual, runtime binding or original-game fidelity is certified by this census.'],
            'families': result, 'functions': functions}


def markdown(plan):
    text = ['# Blueprint batch candidates', '',
            'Affected functions are source witnesses, **not proven unlocks**. Counts overlap.', '',
            '| Family | Blocked source functions | Static callers | Affected union | First failures |',
            '| --- | ---: | ---: | ---: | ---: |']
    for item in [row for row in plan['families'] if row['rank_eligible']][:30]:
        text.append('| ' + item['family'] + ' | ' + ' | '.join(str(item[key]) for key in (
            'blocked_source_functions_count', 'transitive_blocked_callers_count',
            'estimated_affected_union_count', 'first_failure_functions_count')) + ' |')
    text.extend(['', *('- ' + note for note in plan['limitations']), ''])
    return '\n'.join(text)


def html_page(plan):
    counts=plan['source_counts']; translated=counts.get('translated',0); blocked=counts.get('blocked',0)
    total=translated+blocked; percent=100*translated/total if total else 0
    rows=''.join('<tr><td>'+html.escape(row['family'])+'</td><td>'+str(row['blocked_source_functions_count'])
        +'</td><td>'+str(row['transitive_blocked_callers_count'])+'</td><td>'+str(row['estimated_affected_union_count'])
        +'</td></tr>' for row in plan['families'] if row['rank_eligible'])
    return ('<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
        '<title>ue2three · Batch Blueprint</title><style>body{background:#111b25;color:#e8f0f5;font:16px system-ui;margin:24px;max-width:1200px}'
        'progress{width:100%;height:26px}table{border-collapse:collapse;width:100%}th,td{padding:10px;border:1px solid #344d61;text-align:left}'
        'th{background:#1b3040}.note{color:#bdd0df}</style><h1>Blueprint · Conversione in batch</h1>'
        '<p><strong>'+str(translated)+' / '+str(total)+' funzioni tradotte ('+f'{percent:.1f}'+'%)</strong> · '
        +str(blocked)+' ancora bloccate.</p><progress max="'+str(max(total,1))+'" value="'+str(translated)+'"></progress>'
        '<p class="note">Censimento completato. Le cifre sotto indicano funzioni coinvolte, con sovrapposizioni: '
        'non sono conversioni promesse o verifiche del gioco 1:1.</p>'
        '<table><thead><tr><th>Famiglia condivisa</th><th>Funzioni bloccate coinvolte</th><th>Chiamanti statici ulteriori</th>'
        '<th>Unione dei candidati</th></tr></thead><tbody>'+rows+'</tbody></table></html>')


def run(report_path, cache_root, output, workers=2):
    if not 1 <= workers <= 4:
        raise ValueError('workers must be 1..4')
    report_path, cache_root, output = map(lambda path: Path(path).resolve(), (report_path, cache_root, output))
    if cache_root == output or cache_root in output.parents:
        raise ValueError('Output must be outside original source cache')
    report = load(report_path)
    if report.get('project'):
        source_project=Path(report['project']).resolve().parent
        if output==source_project or source_project in output.parents:
            raise ValueError('Batch planning output must stay outside the original project')
    output.mkdir(parents=True, exist_ok=True)
    census = output / 'package-census'
    census.mkdir(exist_ok=True)
    implementation = digest(Path(__file__).read_bytes())
    tasks = sorted(report['packages'].items())
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(lambda task: read_package(task[0], task[1]['source'], cache_root, census,
                                                        implementation), tasks))
    plan = build_plan(report, [row for functions, _ in results for row in functions])
    plan.update({'compiler_report': str(report_path), 'compiler_report_sha256': digest(report_path.read_bytes()),
                 'package_census_reused': sum(reused for _, reused in results),
                 'package_census_decoded': sum(not reused for _, reused in results), 'workers': workers})
    (output / 'blueprint-batch-plan.json').write_text(json.dumps(plan, indent=2, sort_keys=True), encoding='utf-8')
    (output / 'blueprint-batch-plan.md').write_text(markdown(plan), encoding='utf-8')
    (output / 'blueprint-batch-plan.html').write_text(html_page(plan), encoding='utf-8')
    return plan


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--source-cache', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--workers', type=int, default=2)
    args = parser.parse_args()
    plan = run(args.report, args.source_cache, args.output, args.workers)
    print(json.dumps({key: plan[key] for key in ('source_counts', 'function_census_count',
                                              'package_census_reused', 'package_census_decoded')}))
    print(markdown(plan))


if __name__ == '__main__':
    main()
