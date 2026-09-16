"""Checks for the pinned, selective Sparkle extractor."""
import importlib.util
import os
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('prepare_updater', Path(__file__).with_name('prepare-updater.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PrepareUpdaterTests(unittest.TestCase):
    def test_wrong_archive_refused_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'wrong.tar.xz'
            archive.write_bytes(b'not the pinned archive')
            with self.assertRaisesRegex(ValueError, 'checksum'):
                module.prepare(archive, root / 'output')
            self.assertFalse((root / 'output').exists())

    @unittest.skipUnless(os.environ.get('OBSERVATORY_TEST_SPARKLE_ARCHIVE'), 'Provide the pinned Sparkle archive')
    def test_exact_framework_and_notice_only(self):
        archive = Path(os.environ['OBSERVATORY_TEST_SPARKLE_ARCHIVE'])
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'prepared'
            framework = module.prepare(archive, output)
            self.assertEqual({p.name for p in output.iterdir()}, {'LICENSE', 'Sparkle.framework'})
            with tarfile.open(archive, 'r:xz') as source:
                for member in source.getmembers():
                    name = member.name.removeprefix('./').rstrip('/')
                    if name != 'LICENSE' and not name.startswith('Sparkle.framework/'):
                        continue
                    target = output / name
                    if member.isfile():
                        self.assertEqual(target.read_bytes(), source.extractfile(member).read())
                    elif member.issym():
                        self.assertEqual(os.readlink(target), member.linkname)
                        self.assertTrue(target.resolve(strict=True).is_relative_to(framework.resolve()))
            with self.assertRaises(FileExistsError):
                module.prepare(archive, output)


if __name__ == '__main__':
    unittest.main()
