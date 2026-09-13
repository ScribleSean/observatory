"""Prepare a pinned Windows Python payload without executing downloaded code."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import tarfile
import zipfile


def safe_path(name):
    parts = PurePosixPath(name).parts
    if not parts or name.startswith('/') or '\\' in name or ':' in name or '..' in parts:
        raise ValueError('Unsafe archive path')
    return parts


def checked(cache, asset):
    name = asset['filename']
    if len(safe_path(name)) != 1:
        raise ValueError('Invalid archive filename')
    file = cache / name
    if hashlib.sha256(file.read_bytes()).hexdigest() != asset['sha256']:
        raise ValueError('Runtime checksum mismatch')
    return file


def prepare(cache, output, assets):
    if any(assets['python'][key] != assets['pythonFull'][key] for key in ('version', 'build')):
        raise ValueError('Mismatched runtime and notice build')
    archives = {key: checked(cache, assets[key]) for key in ('python', 'pythonFull', 'tzdata')}
    full = archives['pythonFull']
    def read_notice(name):
        return subprocess.check_output(['tar', '-xOf', str(full), name], timeout=30)
    metadata = json.loads(read_notice('python/PYTHON.json'))
    if metadata['python_version'] != assets['python']['version'] or metadata['target_triple'] != 'x86_64-pc-windows-msvc':
        raise ValueError('Unexpected Python build identity')
    names = subprocess.check_output(['tar', '-tf', str(full)], timeout=30).decode().splitlines()
    notices = {}
    for name in names:
        parts = safe_path(name)
        if len(parts) == 3 and parts[:2] == ('python', 'licenses'):
            data = read_notice(name)
            if not data or len(data) > 1_000_000:
                raise ValueError('Invalid dependency notice')
            notices['/'.join(parts[1:])] = data
    required = {'licenses/LICENSE.' + component + '.txt' for component in
                ('cpython', 'openssl-3', 'sqlite', 'expat', 'zlib', 'bzip2', 'libffi', 'liblzma')}
    records = [metadata] + [row for rows in metadata['build_info']['extensions'].values() for row in rows]
    for row in records:
        required.update(row.get('license_paths', []))
        if row.get('license_path'):
            required.add(row['license_path'])
    if not required.issubset(notices):
        raise ValueError('Missing dependency notices')
    output.mkdir(parents=False, exist_ok=False)
    files = {}
    def write(name, data):
        safe_path(name)
        file = output / name
        file.parent.mkdir(parents=True, exist_ok=True)
        with file.open('xb') as target:
            target.write(data)
        files[name] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    with tarfile.open(archives['python'], 'r:gz') as archive:
        for item in archive:
            parts = safe_path(item.name)
            if parts[0] != 'python' or not (item.isfile() or item.isdir()):
                raise ValueError('Unexpected runtime member')
            if item.isdir() or len(parts) < 2:
                continue
            relative = parts[1:]
            if any(part in ('__pycache__', 'site-packages', 'test', 'tests', 'ensurepip') for part in relative) or item.name.endswith(('.pyc', '.pyo')):
                continue
            if relative[0] not in ('Lib', 'DLLs', 'tcl', 'LICENSE.txt', 'python.exe', 'python3.dll', 'python313.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'):
                continue
            if item.size > 100_000_000:
                raise ValueError('Oversized runtime member')
            write('/'.join(relative), archive.extractfile(item).read())
    with zipfile.ZipFile(archives['tzdata']) as archive:
        for item in archive.infolist():
            parts = safe_path(item.filename)
            if parts[0] not in ('tzdata', 'tzdata-' + assets['tzdata']['version'] + '.dist-info'):
                raise ValueError('Unexpected timezone member')
            if not item.is_dir():
                if item.file_size > 1_000_000:
                    raise ValueError('Oversized timezone member')
                write(item.filename, archive.read(item))
    for name, data in notices.items():
        write(name, data)
    write('python313._pth', b'Lib\nDLLs\n.\n')
    if not {'python.exe', 'python313.dll', 'DLLs/_sqlite3.pyd', 'DLLs/_ssl.pyd', 'Lib/encodings/__init__.py', 'LICENSE.txt'}.issubset(files):
        raise ValueError('Missing required Python components')
    manifest = {'schema': 1, 'assets': assets, 'files': files, 'bytes': sum(row['bytes'] for row in files.values())}
    with (output / 'observatory-python-manifest.json').open('x') as target:
        json.dump(manifest, target, indent=2)
    return {'files': len(files), 'bytes': manifest['bytes'], 'dependencyNotices': len(notices)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--assets', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.cache, args.output, json.loads(args.assets.read_text()))))
