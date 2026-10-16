#!/usr/bin/env python3
"""Bridge a one-time Epic authorization code to FabCLI's interactive manual login.
Code arrives over stdin, never as a command-line argument or log line.
Only success/failure is printed. FabCLI retains tokens in its local OS keyring.
"""
import json
import os
import pty
import select
import signal
import sys
import time

def login(code):
    if not 12 <= len(code) <= 512 or not code.replace('-', '').replace('_', '').isalnum():
        return False
    child, fd = pty.fork()
    if child == 0:
        os.execvp('fabcli', ['fabcli', 'auth', 'login', '--manual'])
    sent = False
    deadline = time.monotonic() + 80
    result = False
    try:
        while time.monotonic() < deadline:
            available, _, _ = select.select([fd], [], [], 0.5)
            if available:
                try: data = os.read(fd, 4096)
                except OSError: data = b''
                if not data: break
                # Waiting for the actual prompt avoids dropping the code into the wrong terminal.
                if not sent and (b'authorizationCode' in data or b'press Enter' in data):
                    os.write(fd, code.encode('ascii') + b'\n')
                    sent = True
            pid, status = os.waitpid(child, os.WNOHANG)
            if pid == child:
                result = sent and os.waitstatus_to_exitcode(status) == 0
                break
    finally:
        try: os.kill(child, signal.SIGTERM)
        except ProcessLookupError: pass
        try: os.close(fd)
        except OSError: pass
    return result

if __name__ == '__main__':
    code = sys.stdin.readline().strip()
    try: ok = login(code)
    except Exception: ok = False
    print(json.dumps({'ok': ok}))
    sys.exit(0 if ok else 1)
