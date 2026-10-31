"""Console-free entry point for the Windows DDS scheduled task.

The scheduled action MUST use pythonw.exe. This module captures the supervisor's
stdout/stderr in an ignored local log, because pythonw has no console streams.
Do not use python.exe, cmd.exe, or a visible PowerShell host as the task action.
"""
from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
import traceback


def main(argv=None, *, log_path=None) -> int:
    destination = Path(log_path) if log_path is not None else (
        Path(__file__).resolve().parents[2] / '.local' / 'ue2three' / 'dds-hidden-task.log')
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open('a', encoding='utf-8', buffering=1) as output:
        with redirect_stdout(output), redirect_stderr(output):
            print('DDS_HIDDEN_TICK', datetime.now(timezone.utc).isoformat(), flush=True)
            try:
                import dds_automation
                return int(dds_automation.main(argv))
            except BaseException:
                traceback.print_exc()
                return 1


if __name__ == '__main__':
    raise SystemExit(main())
