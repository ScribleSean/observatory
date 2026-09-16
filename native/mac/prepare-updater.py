"""Extract only the pinned Sparkle framework and license into a new directory."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import os
import posixpath
import tarfile


def prepare(archive, output):
    asset = json.loads(Path(__file__).with_name('updater-tool.json').read_text())
    data = archive.read_bytes()
    if hashlib.sha256(data).hexdigest() != asset['sha256']:
        raise ValueError('Sparkle archive checksum mismatch')
    # Validate before writing. Do not extract test apps, signing tools or symbols.
    import io
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:xz') as source:
        selected = {}
        for member in source.getmembers():
            name = member.name.removeprefix('./').rstrip('/')
            if name != 'LICENSE' and not (name == 'Sparkle.framework' or name.startswith('Sparkle.framework/')):
                continue
            parts = PurePosixPath(name).parts
            if not parts or name.startswith('/') or '..' in parts or '\\' in name or name in selected:
                raise ValueError('Unsafe or duplicate Sparkle member')
            if not (member.isfile() or member.isdir() or member.issym()):
                raise ValueError('Unsupported Sparkle member')
            if member.issym():
                target = member.linkname
                resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), target))
                if target.startswith('/') or '\\' in target or not resolved.startswith('Sparkle.framework/'):
                    raise ValueError('Escaping Sparkle symlink')
            selected[name] = member
        for required in ('LICENSE', 'Sparkle.framework/Versions/B/Sparkle', 'Sparkle.framework/Versions/B/Resources/Info.plist'):
            if required not in selected or not selected[required].isfile():
                raise ValueError('Missing Sparkle runtime or license')
        for name in selected:
            for parent in PurePosixPath(name).parents:
                if str(parent) in selected and not selected[str(parent)].isdir():
                    raise ValueError('Archive member under non-directory')
        output.mkdir()  # Exclusive destination, never overwrite a prepared framework.
        for name, member in sorted(selected.items(), key=lambda item: (len(PurePosixPath(item[0]).parts), item[0])):
            destination = output / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            if member.isdir():
                destination.mkdir(exist_ok=True)
            elif member.isfile():
                with destination.open('xb') as handle:
                    handle.write(source.extractfile(member).read())
                destination.chmod(member.mode & 0o777)
            else:
                os.symlink(member.linkname, destination)
        for name, member in selected.items():
            if member.issym() and not (output / name).resolve(strict=True).is_relative_to(output.resolve()):
                raise ValueError('Sparkle symlink escapes output')
    return output / 'Sparkle.framework'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(prepare(args.archive, args.output))
