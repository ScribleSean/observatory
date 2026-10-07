"""Source runner contracts with inert children and modeled POSIX locks.

No collector, provider or permission verifier is executed. All writes are inside
an owned fictional runtime. These tests do not establish real flock behavior.
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch


RUNNER = Path(__file__).resolve().parents[2] / 'scripts' / 'run-collector.py'


def load_runner():
    locks = types.SimpleNamespace(LOCK_EX=2, LOCK_NB=4, flock=Mock())
    with patch.dict(sys.modules, {'fcntl': locks}):
        spec = importlib.util.spec_from_file_location('source_runtime_runner', RUNNER)
        assert spec is not None and spec.loader is not None
        runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
    return runner, locks


class SourceRuntimeTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(
            prefix='observatory-source-runtime-', dir=os.environ.get('TMPDIR'))
        self.addCleanup(temporary.cleanup)
        self.fixture = Path(temporary.name).resolve()
        self.source = self.fixture / 'source-tree'
        self.runtime = self.fixture / 'writable-runtime'
        self.resources = self.fixture / 'Fictional.app' / 'Contents' / 'Resources'
        for directory in (self.source / 'scripts', self.runtime,
                          self.resources / 'Collector' / 'scripts',
                          self.resources / 'Runtime' / 'python' / 'bin'):
            directory.mkdir(parents=True)
        self.selected = str(self.resources / 'Runtime' / 'python' / 'bin' / 'python3')
        # A permission-checkable fixture, never an executable child.
        descriptor = os.open(self.selected, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o700)
        os.close(descriptor)
        self.node = str(self.fixture / 'fictional-node')
        self.runner, self.locks = load_runner()
        # Only the runner's lock descriptor is modeled. Status writes are real
        # writes in the owned fixture, not a fake collector-success override.
        setattr(self.runner, 'os', types.SimpleNamespace(**vars(os)))
        self.runner.os.O_NOFOLLOW = getattr(os, 'O_NOFOLLOW', 0x20000)
        self.runner.os.open = Mock(return_value=731)
        self.runner.os.close = Mock()
        self.runner.os.environ = {'PATH': str(self.fixture / 'unrelated-tools'),
                                  'OBSERVATORY_PYTHON': str(self.fixture / 'stale-python')}
        setattr(self.runner, 'sys', types.SimpleNamespace(executable=self.selected))
        self.child = Mock()
        self.child.wait.return_value = 0
        self.child.poll.return_value = 0
        self.launches = []
        setattr(self.runner, 'subprocess', types.SimpleNamespace(
            DEVNULL=subprocess.DEVNULL, TimeoutExpired=subprocess.TimeoutExpired,
            Popen=Mock(side_effect=self.fake_launch)))

    def fake_launch(self, command, *, cwd, env, stdout, stderr, start_new_session):
        # Record only the selected synthetic fields, never an inherited env.
        self.launches.append(dict(command=command, cwd=cwd,
                                  python=env.get('OBSERVATORY_PYTHON'),
                                  runtime=env.get('OBSERVATORY_RUNTIME'),
                                  stdout=stdout, stderr=stderr,
                                  start_new_session=start_new_session))
        (cwd / 'public' / 'local' / 'usage.json').write_text(json.dumps({
            'collectedAt': self.runner.stamp(), 'activity': [{'status': 'ok'}]}))
        return self.child

    def assert_launch(self, root, collector, selected, runtime):
        self.assertEqual(len(self.launches), 1)
        self.assertEqual(self.launches[0], dict(
            command=[self.node, str(collector)], cwd=root, python=selected,
            runtime=runtime, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=True))
        self.locks.flock.assert_called_once_with(731, self.locks.LOCK_EX | self.locks.LOCK_NB)
        self.runner.os.open.assert_called_once_with(
            root / '.runtime' / 'collector.lock',
            os.O_CREAT | os.O_RDWR | self.runner.os.O_NOFOLLOW, 0o600)
        self.runner.os.close.assert_called_once_with(731)
        status = json.loads((root / 'public' / 'local' / 'collector.json').read_text())
        self.assertEqual(status['state'], 'ok')
        self.assertEqual(status['sourcesRead'], 1)
        self.assertNotIn(self.selected, json.dumps(status))

    def test_default_source_entry_supplies_running_python_before_child_launch(self):
        result = self.runner.run_collection(self.source, self.node)
        self.assertEqual(result, 'ok')
        self.assert_launch(self.source, self.source / 'scripts' / 'collect-dashboard.mjs',
                           self.selected, None)

    def test_explicit_packaged_entry_preserves_selected_python_and_separate_runtime(self):
        collector = self.resources / 'Collector' / 'scripts' / 'collect-mac.mjs'
        result = self.runner.run_collection(self.runtime, self.node, collector=collector,
                                            python=self.selected)
        self.assertEqual(result, 'ok')
        self.assert_launch(self.runtime, collector, self.selected, str(self.runtime))
        self.assertFalse((self.resources / 'public').exists())
        self.assertFalse((self.source / 'public').exists())

    def test_source_without_inherited_python_supplies_running_interpreter(self):
        del self.runner.os.environ['OBSERVATORY_PYTHON']
        self.assertEqual(self.runner.run_collection(self.source, self.node), 'ok')
        self.assert_launch(self.source, self.source / 'scripts' / 'collect-dashboard.mjs',
                           self.selected, None)

    def test_source_explicit_python_overrides_running_and_inherited_interpreters(self):
        self.runner.sys.executable = str(self.fixture / 'unselected-python')
        self.assertEqual(self.runner.run_collection(self.source, self.node,
                                                    python=self.selected), 'ok')
        self.assert_launch(self.source, self.source / 'scripts' / 'collect-dashboard.mjs',
                           self.selected, None)

    def assert_refused(self, value, collector=None):
        self.runner.subprocess.Popen.reset_mock()
        self.runner.os.close.reset_mock()
        folder = self.runtime / 'public' / 'local'
        folder.mkdir(parents=True, exist_ok=True)
        snapshot = folder / 'usage.json'
        snapshot.write_text('preserved fictional snapshot')
        result = self.runner.run_collection(self.runtime, self.node,
                                            python=value, collector=collector)
        self.assertEqual(result, 'failed')
        self.runner.subprocess.Popen.assert_not_called()
        self.runner.os.close.assert_called_once_with(731)
        self.assertEqual(snapshot.read_text(), 'preserved fictional snapshot')
        status = json.loads((folder / 'collector.json').read_text())
        self.assertEqual(status['state'], 'failed')
        self.assertNotIn('python', status)
        self.assertNotIn(self.selected, json.dumps(status))

    def test_invalid_explicit_python_never_falls_back_or_launches(self):
        values = ['', 'python3', '../python3', str(self.fixture / 'missing-python'),
                  str(self.resources), self.selected + '\n', self.selected + '\r',
                  self.selected + '\0', False, 42]
        for collector in (None, self.resources / 'Collector' / 'scripts' / 'collect-mac.mjs'):
            for value in values:
                with self.subTest(collector=collector is not None, python=value):
                    self.assert_refused(value, collector)

    def test_nonexecutable_selected_python_is_refused_before_child_launch(self):
        # Modeled access denial, no ACL query or mutation.
        self.runner.os.access = Mock(return_value=False)
        self.assert_refused(self.selected)

    def test_missing_running_interpreter_is_refused_without_discovery(self):
        self.runner.sys.executable = str(self.fixture / 'missing-running-python')
        self.assert_refused(None)

    def test_busy_lock_keeps_status_and_snapshot_without_child_launch(self):
        folder = self.runtime / 'public' / 'local'
        folder.mkdir(parents=True)
        (folder / 'collector.json').write_text('preserved running status')
        (folder / 'usage.json').write_text('preserved snapshot')
        self.locks.flock.side_effect = BlockingIOError
        self.assertEqual(self.runner.run_collection(self.runtime, self.node), 'busy')
        self.runner.subprocess.Popen.assert_not_called()
        self.runner.os.close.assert_called_once_with(731)
        self.assertEqual((folder / 'collector.json').read_text(), 'preserved running status')
        self.assertEqual((folder / 'usage.json').read_text(), 'preserved snapshot')

    def test_explicit_dashboard_entry_preserves_bundled_source_selection(self):
        collector = self.resources / 'Collector' / 'scripts' / 'collect-dashboard.mjs'
        self.assertEqual(self.runner.run_collection(self.runtime, self.node,
                                                    collector=collector), 'ok')
        self.assert_launch(self.runtime, collector, self.selected, str(self.runtime))
        self.assertFalse((self.resources / 'public').exists())


if __name__ == '__main__':
    unittest.main()
