"""Serialize local collection and publish a small status record, without log text."""
import argparse
import datetime as dt
import fcntl
import json
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import tempfile


def stamp():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z')


def write_status(folder, value, name='collector.json'):
    if name not in ('collector.json', 'allowance-collector.json'):
        raise ValueError('Unsupported status record')
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    if folder.is_symlink():
        raise ValueError('Status folder must not be a symlink')
    handle, temporary = tempfile.mkstemp(prefix='.collector-', suffix='.tmp', dir=folder)
    try:
        with os.fdopen(handle, 'w') as stream:
            json.dump(value, stream, allow_nan=False)
        os.replace(temporary, folder / name)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def stop_child(child):
    # This process group was created exclusively for this collection.
    if child.poll() is not None:
        return
    try:
        os.killpg(child.pid, signal.SIGTERM)
        child.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait()
    except ProcessLookupError:
        pass


def run_collection(root, node, interval=0, timeout=240, *, collector=None, python=None, quota_only=False):
    if not isinstance(quota_only, bool):
        raise ValueError('Invalid collection mode')
    if quota_only and (collector is None or pathlib.Path(collector).name != 'collect-mac.mjs'):
        raise ValueError('Allowance mode requires the native collector')
    root = pathlib.Path(root).resolve(strict=True)
    runtime = root / '.runtime'
    runtime.mkdir(mode=0o700, exist_ok=True)
    if runtime.is_symlink():
        raise ValueError('Runtime folder must not be a symlink')
    lock = os.open(runtime / 'collector.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 'busy'
        started = stamp()
        state = dict(state='running', startedAt=started, finishedAt=None,
                     intervalSeconds=interval, maxRunSeconds=timeout)
        folder = root / 'public' / 'local'
        status_name = 'allowance-collector.json' if quota_only else 'collector.json'
        write_status(folder, state, status_name)
        child = None
        try:
            # Keep the normal installed tool locations available at login.
            env = dict(os.environ)
            env['PATH'] = os.pathsep.join(dict.fromkeys([
                str(pathlib.Path(node).parent), '/opt/homebrew/bin', '/usr/local/bin',
                '/usr/bin', '/bin', env.get('PATH', '')]))
            if collector is not None:
                collector = pathlib.Path(collector)
                if not collector.is_absolute() or collector.name not in ('collect-mac.mjs', 'collect-dashboard.mjs'):
                    raise ValueError('Unsupported collector entrypoint')
                env['OBSERVATORY_RUNTIME'] = str(root)
                env['OBSERVATORY_PYTHON'] = python or sys.executable
                if not os.path.isabs(env['OBSERVATORY_PYTHON']):
                    raise ValueError('Absolute Python executable required')
            command = [node, str(collector or root / 'scripts' / 'collect-dashboard.mjs')]
            if quota_only:
                command.append('--quota-only')
            child = subprocess.Popen(command,
                                     cwd=root, env=env, stdout=subprocess.DEVNULL,
                                     stderr=subprocess.DEVNULL, start_new_session=True)
            if child.wait(timeout=timeout) != 0:
                raise ValueError('Collector failed')
            snapshot_file = folder / 'usage.json'
            if snapshot_file.stat().st_size > 16_000_000:
                raise ValueError('Snapshot too large')
            snapshot = json.loads(snapshot_file.read_text())
            snapshot_at = snapshot.get('collectedAt')
            if not isinstance(snapshot_at, str) or (not quota_only and dt.datetime.fromisoformat(snapshot_at.replace('Z', '+00:00')) < dt.datetime.fromisoformat(started.replace('Z', '+00:00'))):
                raise ValueError('No new snapshot')
            dt.datetime.fromisoformat(snapshot_at.replace('Z', '+00:00'))
            sources = snapshot.get('activity', []) + snapshot.get('tokens', []) + snapshot.get('settings', []) + snapshot.get('dictation', [])
            sources += snapshot.get('providerTokenSources', [])
            sources += [snapshot[k] for k in ('quota', 'localModel', 'agentSource') if isinstance(snapshot.get(k), dict)]
            if quota_only:
                if not isinstance(snapshot.get('quota'), dict):
                    raise ValueError('Missing allowance result')
                sources = [snapshot['quota']]
            sources = [s for s in sources if s.get('status') != 'not-connected']
            read = sum(s.get('status') == 'ok' for s in sources)
            state.update(state='ok' if sources and read == len(sources) else 'partial',
                         snapshotAt=snapshot_at, sourcesRead=read, sourcesConfigured=len(sources))
        except (Exception, KeyboardInterrupt):
            if child is not None:
                stop_child(child)
            state['state'] = 'failed'
        state['finishedAt'] = stamp()
        write_status(folder, state, status_name)
        return state['state']
    finally:
        os.close(lock)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--node', default=shutil.which('node'))
    parser.add_argument('--interval', type=int, default=0)
    parser.add_argument('--runtime', type=pathlib.Path)
    parser.add_argument('--collector', type=pathlib.Path)
    parser.add_argument('--python', default=sys.executable)
    parser.add_argument('--quota-only', action='store_true')
    args = parser.parse_args()
    if not args.node or not os.path.isabs(args.node) or args.interval not in (0, 300):
        parser.error('Use an absolute Node path and a zero or 300-second cadence')
    if args.runtime is not None and not args.runtime.is_absolute():
        parser.error('Use an absolute runtime directory')
    def interrupted(signum, frame):
        raise InterruptedError('Collection stopped')
    signal.signal(signal.SIGTERM, interrupted)
    result = run_collection(args.runtime or pathlib.Path(__file__).resolve().parent.parent, args.node, args.interval,
                            collector=args.collector, python=args.python, quota_only=args.quota_only)
    print(json.dumps(dict(collection=result)))
    raise SystemExit(1 if result == 'failed' else 0)
