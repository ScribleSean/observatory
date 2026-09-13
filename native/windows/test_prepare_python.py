import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('prepare_python', Path(__file__).with_name('prepare-python.py'))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class RuntimeTests(unittest.TestCase):
    def test_archive_paths_reject_escape_and_windows_streams(self):
        for name in ('/escape', '../escape', 'python/../../escape', 'C:/escape', 'python\\escape', 'python/file:stream', ''):
            with self.subTest(name=name), self.assertRaises(ValueError):
                runtime.safe_path(name)
        self.assertEqual(runtime.safe_path('python/Lib/encodings/__init__.py'), ('python', 'Lib', 'encodings', '__init__.py'))

    def test_archive_hash_is_required(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'fixture').write_bytes(b'fixture')
            asset = {'filename': 'fixture', 'sha256': hashlib.sha256(b'fixture').hexdigest()}
            self.assertEqual(runtime.checked(root, asset), root / 'fixture')
            with self.assertRaises(ValueError):
                runtime.checked(root, {**asset, 'sha256': '0' * 64})
            with self.assertRaises(ValueError):
                runtime.checked(root, {**asset, 'filename': 'nested/fixture'})

    def test_mismatched_notice_build_rejected_before_output_creation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                runtime.prepare(root, root / 'output', {'python': {'version': '3.13.15', 'build': 'a'},
                    'pythonFull': {'version': '3.13.15', 'build': 'b'}})
            self.assertFalse((root / 'output').exists())


if __name__ == '__main__':
    unittest.main()
