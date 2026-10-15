"""Prepare the pinned Apple Silicon runtime payload without executing its binaries."""

import argparse
import copy
import hashlib
import gzip
import io
import json
from pathlib import Path, PurePosixPath
import posixpath
import subprocess
import tarfile


def verified_archive(cache, asset):
    filename = asset['filename']
    if Path(filename).name != filename or '/' in filename or '\\' in filename:
        raise ValueError('Invalid archive filename')
    archive = cache / filename
    if hashlib.sha256(archive.read_bytes()).hexdigest() != asset['sha256']:
        raise ValueError(f'Checksum mismatch: {filename}')
    return archive


def validate_member(member):
    name = PurePosixPath(member.name)
    if name.is_absolute() or '..' in name.parts or '\\' in member.name:
        raise ValueError('Unsafe archive path')
    if not (member.isfile() or member.isdir() or member.issym()):
        raise ValueError('Unsupported archive member')
    if member.issym():
        target = member.linkname
        resolved = posixpath.normpath(posixpath.join(str(name.parent), target))
        if target.startswith('/') or '\\' in target or resolved.split('/')[0] != name.parts[0]:
            raise ValueError('Escaping archive symlink')


def python_notices(archive, asset):
    def read(name):
        return subprocess.check_output(['tar', '-xOf', str(archive), name], timeout=30)
    metadata = json.loads(read('python/PYTHON.json'))
    if metadata['python_version'] != asset['version'] or metadata['target_triple'] != 'aarch64-apple-darwin':
        raise ValueError('Unexpected Python build')
    members = set(subprocess.check_output(['tar', '-tf', str(archive)], timeout=30).decode().splitlines())
    paths = set()
    extensions = metadata['build_info']['extensions']
    records = [metadata] + [item for variants in extensions.values() for item in variants]
    for record in records:
        paths.update(record.get('license_paths', []))
        if record.get('license_path'):
            paths.add(record['license_path'])
    notices = {}
    exceptions = []
    for name in sorted(paths):
        if PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts or '\\' in name:
            raise ValueError('Unsafe license path')
        if 'python/' + name not in members:
            # This exact upstream build lists a generic zlib-ng notice although
            # every affected extension links Apple's system zlib, not zlib-ng.
            affected = [record for record in records if name in record.get('license_paths', [])]
            system_zlib = affected and all(
                any(link.get('name') == 'z' and link.get('system') is True for link in record.get('links', []))
                and not any('zlib' in link.get('name', '') or
                            (link.get('name') == 'z' and link.get('system') is not True)
                            for link in record.get('links', []))
                for record in affected)
            if name != 'licenses/LICENSE.zlib-ng.txt' or asset['build'] != '20260901' or not system_zlib:
                raise ValueError(f'Missing upstream license: {name}')
            exceptions.append({'path': name, 'reason': 'Manifest references zlib-ng, but affected extensions link system zlib. No zlib-ng library is bundled.'})
            continue
        notices[name] = read('python/' + name)
        if not notices[name] or len(notices[name]) > 1000000:
            raise ValueError('Invalid license payload')
    return notices, exceptions


def prepare(cache, output, assets):
    if any(assets['python'].get(key) != assets['pythonFull'].get(key) for key in ('version', 'build')):
        raise ValueError('License archive does not match the Python runtime version/build')
    archives = {name: verified_archive(cache, asset) for name, asset in assets.items()}
    notices, exceptions = python_notices(archives['pythonFull'], assets['pythonFull'])
    manifest = {'schema': 1, 'assets': assets, 'licenseExceptions': exceptions, 'files': {}, 'symlinks': {}}
    with output.open('xb') as handle, gzip.GzipFile(filename='', fileobj=handle, mode='wb', mtime=0) as compressed, tarfile.open(fileobj=compressed, mode='w') as target:
        def add_bytes(name, data):
            member = tarfile.TarInfo(name)
            member.size, member.mode = len(data), 0o644
            target.addfile(member, io.BytesIO(data))
            manifest['files'][name] = hashlib.sha256(data).hexdigest()

        for kind in ('node', 'python'):
            with tarfile.open(archives[kind], 'r:gz') as source:
                members = source.getmembers()
                for member in members:
                    validate_member(member)
                selected = set()
                for member in members:
                    if kind == 'node':
                        relative = '/'.join(PurePosixPath(member.name).parts[1:])
                        if relative not in ('bin/node', 'LICENSE'):
                            continue
                        selected.add(relative)
                        name = 'node/' + relative
                    else:
                        if PurePosixPath(member.name).parts[0] != 'python':
                            raise ValueError('Unexpected Python archive root')
                        if '__pycache__' in PurePosixPath(member.name).parts or member.name.endswith(('.pyc', '.pyo')):
                            continue
                        name = member.name
                    item = copy.copy(member)
                    item.name = name
                    item.mode &= 0o777
                    item.uid = item.gid = item.mtime = 0
                    item.uname = item.gname = ''
                    item.pax_headers = {}
                    if item.isfile():
                        data = source.extractfile(member).read()
                        manifest['files'][name] = hashlib.sha256(data).hexdigest()
                        target.addfile(item, io.BytesIO(data))
                    else:
                        if item.issym():
                            manifest['symlinks'][name] = item.linkname
                        target.addfile(item)
                if kind == 'node' and selected != {'bin/node', 'LICENSE'}:
                    raise ValueError('Missing Node executable or license')
        for name, data in notices.items():
            add_bytes('python/' + name, data)
        add_bytes('runtime-manifest.json', (json.dumps(manifest, indent=2) + '\n').encode())
    return {'bytes': output.stat().st_size, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
            'pythonDependencyNotices': len(notices), 'licenseExceptions': exceptions}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--assets', type=Path, default=Path(__file__).with_name('runtime-assets.json'))
    args = parser.parse_args()
    print(json.dumps(prepare(args.cache, args.output, json.loads(args.assets.read_text()))))
