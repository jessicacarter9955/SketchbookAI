"""Durable local agent/conversion supervisor. No dependency on an open chat.

The Windows task runs one tick at a time. Supported compilation, agent work,
cached replay, Git promotion and push have separate durable checkpoints.
Unreal export and deployment run only as explicitly configured stages.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from types import SimpleNamespace

import dds_agent as agent
from core import workspace_lock

ROOT = Path(__file__).resolve().parents[2]


class PushReconciliationBlocked(RuntimeError):
    """Git changes need a person; repeating the same merge is unsafe."""


def fingerprint(root: Path) -> str:
    paths = set((root / 'tools/ue2three').glob('*.py'))
    paths.update((root / 'src/editor').glob('ue2three*.mjs'))
    paths.update(root / name for name in ('package.json', 'package-lock.json'))
    digest = hashlib.sha256()
    for path in sorted(paths):
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(path.read_bytes() if path.is_file() else b'MISSING')
    return digest.hexdigest()


def read(path: Path, fallback=None):
    return json.loads(path.read_text(encoding='utf-8-sig')) if path.exists() else fallback


def validate_config(config: dict, root: Path) -> dict:
    value = dict(config)
    project = Path(value['project']).resolve(strict=True)
    workspace = Path(value['workspace']).resolve(strict=True)
    publish = Path(value['publish_dir']).resolve()
    state = Path(value.get('state_dir', root / '.local/ue2three/automation')).resolve()
    if project.suffix.lower() != '.uproject':
        raise ValueError('Select an existing .uproject file')
    for path in (workspace, publish, state):
        if agent._paths_overlap(path, project.parent):
            raise ValueError('Automation outputs and caches must stay outside the source project')
        if not agent._contained(path, root.resolve()):
            raise ValueError('Use an isolated checkout with its own local cache and outputs')
    if value.get('push', False) and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9/_.-]*', value.get('branch', '')):
        raise ValueError('An explicit valid destination branch is required for push')
    for name, path in [('project', project), ('workspace', workspace), ('publish_dir', publish), ('state_dir', state)]:
        value[name] = str(path)
    return value


class Supervisor:
    def __init__(self, config: dict, root: Path = ROOT):
        self.root = root.resolve()
        self.config = validate_config(config, self.root)
        self.directory = Path(self.config['state_dir'])
        self.directory.mkdir(parents=True, exist_ok=True)
        self.state_path = self.directory / 'state.json'
        self.state = read(self.state_path, {'schema_version': 1, 'events': [], 'started_epoch': time.time()})
        self.config['parallel_workers'] = self.config.get('parallel_workers', 4)
        if type(self.config['parallel_workers']) is not int or not 1 <= self.config['parallel_workers'] <= 4:
            raise ValueError('parallel_workers must be between one and four')

    def save(self, phase: str, **fields):
        self.state.update(phase=phase, updated_at=agent.utc_now(), **fields)
        self.state['events'] = (self.state.get('events', []) + [
            {'time': agent.utc_now(), 'phase': phase}])[-40:]
        agent._atomic_json(self.state_path, self.state)
        self.dashboard()

    def dashboard(self):
        # Refresh reads local durable state; no cloud request or credentials.
        events = ''.join('<li>' + html.escape(item['time'] + ' · ' + item['phase']) + '</li>'
                         for item in reversed(self.state.get('events', [])))
        content = ('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="10">'
                   '<title>ue2three · Automazione</title><style>body{background:#17212b;color:#e6eef5;'
                   'font:16px system-ui;max-width:1000px;margin:35px auto;padding:20px}pre{white-space:pre-wrap;'
                   'background:#253441;padding:20px}progress{width:100%}</style><h1>ue2three · Automazione</h1>'
                   '<p>Stato persistente del PC. La chiusura della chat non ferma il task Windows.</p>'
                   '<progress></progress><h2>' + html.escape(self.state.get('phase', 'idle')) + '</h2>'
                   '<ol>' + events + '</ol><h2>Checkpoint</h2><pre>'
                   + html.escape(json.dumps({k: v for k, v in self.state.items() if k != 'events'},
                                             ensure_ascii=False, indent=2)) + '</pre>'
                   '<p>I test del convertitore non certificano la fedeltà visiva o il gameplay completo.</p>')
        publish = Path(self.config['publish_dir'])
        publish.mkdir(parents=True, exist_ok=True)
        agent._atomic_bytes(publish / 'automation.html', content.encode('utf-8'))
        agent._atomic_json(publish / 'automation-state.json', self.state)

    def command(self, name: str, args: list[str], cwd: Path | None = None, timeout=180):
        self.save(name, active_job=name)
        log = self.directory / (name + '.log')
        flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        with log.open('ab') as output:
            process = subprocess.Popen(args, cwd=cwd or self.root, stdout=output, stderr=output,
                                       creationflags=flags, start_new_session=os.name != 'nt')
            try:
                code = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                agent._kill_process_tree(process)
                process.wait(timeout=10)
                raise RuntimeError(f'{name}: timeout; see {log.name}') from None
        self.state['active_job'] = None
        if code:
            raise RuntimeError(f'{name}: exit {code}; see {log.name}')

    def compile(self, code_root: Path | None = None, output: Path | None = None):
        code_root = code_root or self.root
        output = output or Path(self.config['publish_dir'])
        self.command('cached-blueprints', [sys.executable, str(code_root / 'tools/ue2three/ue2three.py'),
                     'migrate-blueprints', self.config['project'], '--workspace', self.config['workspace'],
                     '--publish-dir', str(output)], cwd=code_root)
        result = read(output / 'blueprint-programs.json')
        if result.get('missing_cached_packages'):
            raise RuntimeError('Replay has missing source packages; refusing promotion')
        return result

    def _changed_paths(self, base: str, commit: str) -> set[str]:
        # NUL-delimited paths preserve whitespace and newlines. --no-renames
        # counts both the old and new names, so a rename cannot evade overlap.
        try:
            result = subprocess.run(
                ['git', '-C', str(self.root), 'diff', '--no-renames', '--name-only', '-z', base, commit],
                check=True, capture_output=True, timeout=60)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
            raise RuntimeError('Unable to compare both Git revisions; push left pending') from None
        return {os.fsdecode(item) for item in result.stdout.split(b'\0') if item}

    def _reconcile_remote_for_push(self, branch: str):
        local = agent._require_clean_repo(self.root)
        git_dir = Path(agent._git(self.root, 'rev-parse', '--absolute-git-dir'))
        if any((git_dir / marker).exists() for marker in
               ('MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-apply', 'rebase-merge')):
            raise PushReconciliationBlocked('Unfinished Git operation; manual review required before push')

        # Fetch only the configured destination. The fetched commit is pinned
        # by SHA below, even if FETCH_HEAD is subsequently changed elsewhere.
        self.command('git-fetch', ['git', 'fetch', '--no-tags', 'origin', f'refs/heads/{branch}'], timeout=120)
        remote = agent._git(self.root, 'rev-parse', 'FETCH_HEAD')
        self.save('git_remote_checked', local_commit=local, remote_commit=remote)
        if remote == local:
            return
        try:
            bases = agent._git(self.root, 'merge-base', '--all', local, remote).splitlines()
        except agent.RunnerError:
            bases = []
        if len(bases) != 1:
            raise PushReconciliationBlocked('Remote and local Git histories have no unique common base; '
                                            'push requires manual review')
        base = bases[0]
        if base == remote:
            # Remote is an ancestor: the existing verified commit can be pushed.
            return

        local_paths = self._changed_paths(base, local)
        remote_paths = self._changed_paths(base, remote)
        # Windows case-insensitive checkouts also need protection from filename
        # case collisions and file-versus-directory conflicts.
        overlap = sorted({a for a in local_paths for b in remote_paths
                          if (a.casefold() == b.casefold()
                              or a.casefold().startswith(b.casefold() + '/')
                              or b.casefold().startswith(a.casefold() + '/'))})
        if overlap:
            sample = ', '.join(overlap[:8])
            if len(overlap) > 8:
                sample += f' (+{len(overlap) - 8} more)'
            raise PushReconciliationBlocked(f'Local/remote Git file overlap ({len(overlap)}): {sample}. '
                                            'No automatic merge or push; review required')

        # This durable flag is set *before* touching HEAD. Even an interrupted
        # successful merge must pass tests before a subsequent tick can push it.
        self.save('git_reconciling', push_validation_required=True,
                  reconciliation_base=base, reconciliation_remote=remote,
                  reconciliation_local=local,
                  local_changed_files=len(local_paths), remote_changed_files=len(remote_paths))
        agent._require_clean_repo(self.root)
        if agent._git(self.root, 'rev-parse', 'HEAD') != local:
            raise PushReconciliationBlocked('Local HEAD advanced during Git reconciliation; manual review required')
        # Git's own merge engine is a second check for semantic conflicts;
        # --no-ff preserves both histories for audit. Never force push.
        try:
            agent._git(self.root, 'merge', '--no-ff', '--no-edit', '-m',
                       'ue2three: reconcile disjoint remote automation changes', remote, timeout=120)
        except agent.RunnerError:
            # Do not auto-abort: the exact conflict/worktree is retained for
            # inspection, rather than risking unrelated concurrent edits.
            raise PushReconciliationBlocked('Git refused disjoint-path merge; review working tree and '
                                            'MERGE_HEAD before further automation') from None
        self.save('git_reconciled', reconciled_commit=agent._git(self.root, 'rev-parse', 'HEAD'))

    def _validate_reconciled_push(self):
        self.command('git-reconcile-python-tests',
                     [sys.executable, '-m', 'unittest', 'discover', '-s', 'tools/ue2three/tests',
                      '-p', 'test_*.py', '-q'], timeout=300)
        node_tests = sorted((self.root / 'tests').glob('ue2three-*.test.mjs'))
        if node_tests:
            node = shutil.which('node')
            if not node:
                raise RuntimeError('Node.js unavailable: cannot validate reconciled Three.js changes')
            self.command('git-reconcile-node-tests',
                         [node, '--test', *(path.relative_to(self.root).as_posix() for path in node_tests)],
                         timeout=300)
        head = agent._require_clean_repo(self.root)
        self.save('git_reconcile_validated', push_validation_required=False,
                  validated_push_head=head)

    def pending_push(self):
        if not self.state.get('pending_push'):
            return
        if not self.config.get('push', False):
            return
        if self.state.get('push_blocker'):
            raise PushReconciliationBlocked(self.state['push_blocker'])
        branch = self.config['branch']
        self._reconcile_remote_for_push(branch)
        if (self.state.get('push_validation_required')
                or (self.state.get('reconciled_commit')
                    and self.state.get('validated_push_head') != agent._git(self.root, 'rev-parse', 'HEAD'))):
            self._validate_reconciled_push()
        agent._require_clean_repo(self.root)
        self.command('git-push', ['git', 'push', 'origin', f'HEAD:refs/heads/{branch}'], timeout=120)
        self.save('pushed', pushed_commit=agent._git(self.root, 'rev-parse', 'HEAD'),
                  pending_push=False, push_validation_required=False,
                  reconciled_commit=None, push_blocker=None)

    def ensure_dependencies(self):
        if (self.root / 'node_modules/three/package.json').is_file():
            return
        if not (self.root / 'package-lock.json').is_file():
            raise RuntimeError('Lockfile missing; cannot prepare verified worker dependencies')
        npm = shutil.which('npm') or shutil.which('npm.cmd')
        if not npm:
            raise RuntimeError('npm is missing; required worker dependencies unavailable')
        self.command('worker-dependencies', [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
                     timeout=900)
        if not (self.root / 'node_modules/three/package.json').is_file():
            raise RuntimeError('npm finished but Three.js worker dependency is missing')

    def promote(self, family: str, checkpoint: dict):
        record = checkpoint['families'][family]
        head = agent._require_clean_repo(self.root)
        worker = Path(record.get('worktree_path', self.root / agent.STATE_RELATIVE / 'worktrees' / family))
        if not agent._contained(worker.resolve(), (self.root / agent.STATE_RELATIVE / 'worktrees').resolve()):
            raise RuntimeError('Worker path escapes its isolated directory')
        changed = agent._git(worker, 'diff', '--name-only').splitlines()
        changed += agent._git(worker, 'ls-files', '--others', '--exclude-standard').splitlines()
        changed = sorted(set(changed))
        allowed = ('tools/ue2three/blueprint', 'tools/ue2three/tests/', 'src/editor/ue2three-',
                   'tests/ue2three-', 'docs/')
        if not changed or any(not item.startswith(allowed) or '..' in Path(item).parts for item in changed):
            record.update(status='needs_review', result='empty_or_out_of_scope_patch')
            agent._checkpoint_event(self.root / agent.STATE_RELATIVE, checkpoint, 'needs_review', family=family)
            self.save('needs_review', family=family)
            return
        agent.verify_worker(worker, family)
        agent._git(worker, 'add', '--', *changed)
        agent._git(worker, 'diff', '--cached', '--check')
        agent._git(worker, 'commit', '-m', f'ue2three: source-verified {family} conversion')
        original_commit = agent._git(worker, 'rev-parse', 'HEAD')
        target = worker
        if record['base_head'] != head:
            # A concurrent worker was based on the previous integration HEAD.
            # Reapply in a *new* detached worktree, never into the dirty user
            # checkout. Conflicts preserve both original patch and base.
            stage_root = self.root / agent.STATE_RELATIVE / 'reconciliation'
            target = agent._worktree_for(self.root, stage_root, SimpleNamespace(family_id=family), head)
            try:
                agent._git(target, 'cherry-pick', '--no-commit', original_commit, timeout=60)
            except agent.RunnerError:
                record.update(status='needs_review', result='reconciliation_conflict',
                              original_commit=original_commit)
                agent._checkpoint_event(self.root / agent.STATE_RELATIVE, checkpoint,
                                        'needs_review', family=family)
                self.save('needs_review', family=family, reason='Concurrent patch conflict; original retained')
                return
        before = read(Path(self.config['publish_dir']) / 'blueprint-programs.json')
        after = self.compile(target, target / '.local/ue2three/replay')
        if not replay_improves(before, after):
            record.update(status='needs_review', result='no_proven_conversion_gain',
                          original_commit=original_commit)
            agent._checkpoint_event(self.root / agent.STATE_RELATIVE, checkpoint, 'needs_review', family=family)
            self.save('needs_review', family=family, reason='No proven conversion gain; patch retained')
            return
        if target != worker:
            agent.verify_worker(target, family)
            agent._git(target, 'commit', '-m', f'ue2three: reconciled {family} conversion')
        commit = agent._git(target, 'rev-parse', 'HEAD')
        # Save commit before FF: on interruption the complete candidate remains recoverable.
        self.save('promoting', candidate_commit=commit, candidate_family=family)
        agent._git(self.root, 'merge', '--ff-only', commit)
        previous = before.get('counts', {})
        verified = after['counts']
        record.update(status='integrated', commit=commit, verified_counts=verified,
                      verified_gain={'translated': verified.get('translated', 0) - previous.get('translated', 0),
                                     'blocked': previous.get('blocked', 0) - verified.get('blocked', 0)})
        checkpoint['last_status'] = 'integrated'
        agent._checkpoint_event(self.root / agent.STATE_RELATIVE, checkpoint, 'integrated', family=family, commit=commit)
        self.save('integrated', counts=after['counts'], pending_push=self.config.get('push', False))
        self.state['compiled_fingerprint'] = None
        self.compile()
        self.save('conversion_checkpoint', compiled_fingerprint=fingerprint(self.root))

    def additional_stages(self):
        statuses = {}
        for name in ('asset_export_command', 'deploy_command'):
            stage = self.config.get(name)
            if not stage:
                statuses[name] = 'not_configured'
                continue
            if (not isinstance(stage, dict) or not isinstance(stage.get('argv'), list)
                    or not stage['argv'] or any(not isinstance(x, str) for x in stage['argv'])):
                raise ValueError(f'{name}: configure an explicit argv list')
            inputs = [Path(path).resolve(strict=True) for path in stage.get('inputs', [])]
            outputs = [Path(path).resolve() for path in stage.get('outputs', [])]
            if not inputs or not outputs or any(not path.is_file() for path in inputs):
                raise ValueError(f'{name}: explicit input and output files are required')
            if any(not agent._contained(path, self.root) for path in inputs + outputs):
                raise ValueError(f'{name}: stage files must stay inside the isolated checkout')
            signature = hashlib.sha256(json.dumps(stage, sort_keys=True).encode())
            for path in inputs:
                signature.update(agent.file_hash(path).encode())
            stamp = signature.hexdigest()
            prior = self.state.setdefault('stages', {}).get(name, {})
            if prior.get('fingerprint') == stamp and all(path.is_file() and path.stat().st_size for path in outputs):
                statuses[name] = 'cached'
                continue
            self.command(name, stage['argv'], timeout=min(int(stage.get('timeout', 180)), 900))
            if any(not path.is_file() or not path.stat().st_size for path in outputs):
                raise RuntimeError(f'{name}: command finished but expected outputs are missing')
            self.state['stages'][name] = {'fingerprint': stamp, 'completed_at': agent.utc_now()}
            statuses[name] = 'command_verified_outputs_present'
        self.state['additional_stages'] = statuses

    def recover_promotion(self):
        commit = self.state.get('candidate_commit')
        family = self.state.get('candidate_family')
        if not commit or self.state.get('phase') not in ('promoting', 'failed'):
            return
        head = agent._require_clean_repo(self.root)
        if head == commit:
            checkpoint = agent._read_checkpoint(self.root / agent.STATE_RELATIVE)
            checkpoint['families'][family].update(status='integrated', commit=commit)
            agent._checkpoint_event(self.root / agent.STATE_RELATIVE, checkpoint, 'integration_recovered', family=family)
            self.save('integrated', pending_push=self.config.get('push', False), compiled_fingerprint=None)

    def tick(self):
        with workspace_lock(self.directory):
            if self.config.get('paused', False):
                self.save('paused', active_job=None)
                return self.state
            if time.time() < self.state.get('retry_after', 0):
                return {'phase': 'retry_wait', 'retry_after': self.state['retry_after']}
            try:
                self.recover_promotion()
                self.pending_push()
                session_seconds = self.config.get('session_seconds', 0)
                if session_seconds > 0 and time.time() - self.state['started_epoch'] >= session_seconds:
                    self.save('session_budget_reached', active_job=None)
                    return self.state
                agent._require_clean_repo(self.root)
                agent._disk_guard(self.root)
                current = fingerprint(self.root)
                if current != self.state.get('compiled_fingerprint'):
                    report = self.compile()
                    self.save('conversion_checkpoint', counts=report['counts'], compiled_fingerprint=current)
                checkpoint = agent._read_checkpoint(self.root / agent.STATE_RELATIVE)
                pending = [family for family, row in checkpoint['families'].items()
                           if row.get('status') == 'patch_ready_for_review']
                if pending:
                    for family in pending:
                        self.promote(family, checkpoint)
                else:
                    executable = self.config.get('codex_executable') or shutil.which('codex')
                    if not executable:
                        raise RuntimeError('Codex CLI missing; agent cannot start')
                    self.ensure_dependencies()
                    self.command('codex-auth-check', [executable, 'login', 'status'], timeout=20)
                    self.save('agent_running', active_job='source-adapter-agent')
                    result = agent.run_many(self.root, codex_executable=executable,
                                            max_workers=self.config['parallel_workers'])
                    self.save('agent_checkpoint', agent_result=result, active_job=None)
                    account_errors = {'usage_limit', 'authentication_required', 'connection_interrupted'}
                    errors = {row.get('result') for row in result.get('results', [])}
                    if errors and errors.issubset(account_errors):
                        reason = 'usage_limit' if 'usage_limit' in errors else next(iter(errors))
                        delay = 1800 if reason == 'usage_limit' else 600
                        self.save('waiting_account' if reason == 'usage_limit' else 'waiting_connection',
                                  retry_after=time.time() + delay, waiting_reason=reason, active_job=None)
                        return self.state
                    if any(row.get('status') == 'patch_ready_for_review' for row in result.get('results', [])):
                        checkpoint = agent._read_checkpoint(self.root / agent.STATE_RELATIVE)
                        for family, row in list(checkpoint['families'].items()):
                            if row.get('status') == 'patch_ready_for_review':
                                self.promote(family, checkpoint)
                self.pending_push()
                # Commands completing does not establish gameplay or visual acceptance.
                self.additional_stages()
                self.save('waiting_next_tick', active_job=None, retry_after=0)
                return self.state
            except PushReconciliationBlocked as error:
                self.save('push_needs_review', push_blocker=str(error)[:600], error=str(error)[:600],
                          active_job=None, retry_after=0)
                return self.state
            except Exception as error:
                # Preserve output/patches; never restart the entire conversion after a chat drop.
                failures = self.state.get('failures', 0) + 1
                self.save('failed', error=str(error)[:600], failures=failures, active_job=None,
                          retry_after=time.time() + min(300 * 2 ** min(failures - 1, 4), 3600))
                raise


def replay_improves(before: dict, after: dict) -> bool:
    old, new = before.get('counts', {}), after.get('counts', {})
    if after.get('missing_cached_packages') or before.get('project') != after.get('project'):
        return False
    old_packages, new_packages = before.get('packages', {}), after.get('packages', {})
    if set(old_packages) != set(new_packages):
        return False
    for name, package in old_packages.items():
        if package.get('source') != new_packages[name].get('source'):
            return False
        # Whole existing functions must stay translated, not just the aggregate count.
        if not set(package.get('functions', {})).issubset(new_packages[name].get('functions', {})):
            return False
    return (new.get('translated', 0) > old.get('translated', 0)
            and new.get('blocked', sys.maxsize) < old.get('blocked', 0))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--once', action='store_true')
    mode.add_argument('--status', action='store_true')
    args = parser.parse_args(argv)
    supervisor = Supervisor(read(args.config))
    if args.status:
        print(json.dumps(supervisor.state, ensure_ascii=True))
        return 0
    try:
        supervisor.tick()
    except Exception:
        print(json.dumps({'phase': supervisor.state.get('phase'), 'error': supervisor.state.get('error')}))
        return 1
    print(json.dumps(supervisor.state, ensure_ascii=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
