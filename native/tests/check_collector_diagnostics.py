"""Verify diagnostics using an explicitly supplied, fixture-safe Mac app.

Usage: python3 native/tests/check_collector_diagnostics.py /absolute/Fixture.app
The app must implement the all-disabled --test-collector entry point. No normal
app launch, GUI test or installation occurs. This is ordinary-user isolation,
not an operating-system sandbox. Build the app from the source under test first.
"""
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile


PHASES = ['resources', 'prepare', 'save-disabled', 'collector-launch',
          'collector-wait', 'collector-check', 'config-before', 'status-initial',
          'revoke-first', 'revoke-second', 'revoked-check', 'status-revoked',
          'repair', 'repair-check', 'status-repaired', 'config-check', 'sharing',
          'complete']


def check(app):
    assert sys.platform == 'darwin' and app.is_absolute()
    binary = app / 'Contents/MacOS/WorkspaceObservatory'
    assert binary.is_file()
    with tempfile.TemporaryDirectory(prefix='collector-diagnostics-',
                                     dir=os.environ.get('TMPDIR')) as directory:
        root = Path(directory)
        for name in ['home', 'tmp']:
            (root / name).mkdir()
        env = {'PATH': '/usr/bin:/bin', 'HOME': str(root / 'home'),
               'CFFIXED_USER_HOME': str(root / 'home'),
               'TMPDIR': str(root / 'tmp') + '/', 'LANG': 'en_US.UTF-8'}
        child = subprocess.Popen([str(binary), '--test-collector'], cwd=root,
                                 env=env, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, start_new_session=True)
        try:
            stdout, stderr = child.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.communicate()
            raise AssertionError('Collector diagnostic deadline') from None
        assert child.returncode == 0, 'Collector fixture failed'
        lines = stderr.decode('utf-8').splitlines()
        matches = [re.fullmatch(r'collector-self-test phase=([a-z-]+) elapsed_ms=(\d+)',
                                line) for line in lines]
        assert all(matches), 'Unexpected diagnostic text'
        assert [match[1] for match in matches] == PHASES, 'Missing collector phase'
        elapsed = [int(match[2]) for match in matches]
        assert elapsed == sorted(elapsed), 'Nonmonotonic phase clock'
        assert b'Packaged collector self-test passed with all sources disabled' in stdout
    print('collector-diagnostics exit=0 phases=18')


if __name__ == '__main__':
    check(Path(sys.argv[1]))
