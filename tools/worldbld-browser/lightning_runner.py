#!/usr/bin/env python3
"""Safety-first Lightning Studio orchestration.

Nothing is started by importing this file. Dry run is the default. A GPU can only
start when --execute --allow-gpu and LIGHTNING_ALLOW_GPU=YES are all present.
A Studio is STOPPED in finally, even when a test fails. Saving files to a
persistent workspace is the caller's responsibility BEFORE process completion.
This does not claim to run proprietary WorldBLD plugins on Linux.
"""
import argparse
import json
import os
import signal
import sys
import time

def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--studio", default="worldbld-prototype")
    parser.add_argument("--teamspace", default=os.getenv("LIGHTNING_TEAMSPACE", ""))
    parser.add_argument("--org", default=os.getenv("LIGHTNING_ORG", ""))
    parser.add_argument("--machine", default="CPU")
    parser.add_argument("--command", default="python --version")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--allow-gpu", action="store_true")
    parser.add_argument("--maximum-seconds", type=int, default=900)
    args = parser.parse_args(argv)
    gpu = args.machine.upper() not in ("CPU", "CPU-4")
    assert 30 <= args.maximum_seconds <= 1800, "Hard upper time limit is 30 min"
    if gpu and not (args.execute and args.allow_gpu and os.getenv("LIGHTNING_ALLOW_GPU") == "YES"):
        raise SystemExit("GPU disabled: require --execute --allow-gpu and LIGHTNING_ALLOW_GPU=YES")
    if not args.execute:
        print(json.dumps({"dry_run": True, "machine": args.machine, "gpu_started": False,
             "will_stop_on_success_or_failure": True, "max_seconds": args.maximum_seconds}))
        return 0
    if not os.getenv("LIGHTNING_API_KEY"):
        raise SystemExit("LIGHTNING_API_KEY not configured; never print tokens")
    if not args.teamspace:
        raise SystemExit("--teamspace required; never guess a billing destination")
    # Import only after credentials and explicit activation are checked.
    from lightning_sdk import Machine, Studio, Teamspace
    kwargs = {"org": args.org} if args.org else {}
    teamspace = Teamspace(args.teamspace, **kwargs)
    studio = Studio(args.studio, teamspace=teamspace, create_ok=False)
    previous_alarm = signal.getsignal(signal.SIGALRM)
    def timeout_handler(signum, frame):
        raise TimeoutError("Studio runtime exceeded configured wall-time limit")
    signal.signal(signal.SIGALRM, timeout_handler)
    started_or_starting = False
    began = time.monotonic()
    try:
        signal.alarm(args.maximum_seconds)
        started_or_starting = True
        studio.start(machine=Machine.from_str(args.machine))
        print("Studio started; executing verified one-shot command.")
        output, exit_code = studio.run_with_exit_code(args.command)
        print(output)
        if exit_code != 0:
            raise RuntimeError("Remote command returned exit code " + str(exit_code))
        print(json.dumps({"executed": True, "success": True, "elapsed_seconds": int(time.monotonic()-began)}))
        return 0
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous_alarm)
        if started_or_starting:
            print("Stopping Studio to release billed compute, preserving files.", flush=True)
            try:
                studio.stop()
                print("Studio.stop() returned normally.", flush=True)
            except Exception as exc:
                print("CRITICAL: Could not confirm Studio stop: " + repr(exc), file=sys.stderr, flush=True)
                raise

if __name__ == "__main__":
    sys.exit(main())
