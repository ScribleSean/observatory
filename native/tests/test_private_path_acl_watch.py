"""Kernel vnode checks on disposable synthetic folders only."""
import os
from pathlib import Path
import select
import stat
import subprocess
import sys
import tempfile
import unittest

from test_private_path_acl import policy


@unittest.skipUnless(sys.platform == "darwin", "Darwin vnode events required")
class KernelWatcherTests(unittest.TestCase):
    def observe(self, action, *, allowed):
        with tempfile.TemporaryDirectory() as base:
            folder = Path(base) / "watched"
            folder.mkdir(mode=0o700)
            reader = policy.NativeReader()
            fd = reader.open(str(folder), None, True)
            watcher = reader.watcher()
            try:
                watcher.register(fd, False)
                action(folder)
                events = watcher.queue.control(None, 64, 0)
                self.assertTrue(events)
                bits = 0
                for event in events:
                    self.assertEqual(event.ident, fd)
                    self.assertEqual(event.filter, select.KQ_FILTER_VNODE)
                    self.assertEqual(event.flags & (select.KQ_EV_ERROR | select.KQ_EV_EOF), 0)
                    bits |= event.fflags
                outside = bits & ~(select.KQ_NOTE_WRITE | select.KQ_NOTE_LINK)
                if allowed:
                    self.assertEqual(outside, 0)
                else:
                    self.assertNotEqual(outside, 0)
            finally:
                watcher.close()
                reader.close(fd)

    def test_child_entry_churn(self):
        def file_churn(folder):
            child = folder / "fictional.txt"
            child.write_text("fictional fixture")
            child.unlink()
        def mkdir(folder):
            (folder / "child").mkdir()
        def rename_child(folder):
            child = folder / "fictional.txt"
            child.touch()
            child.rename(folder / "renamed.txt")
        for action in (file_churn, mkdir, rename_child):
            with self.subTest(action=action.__name__):
                self.observe(action, allowed=True)

    def test_chmod_and_back(self):
        def action(folder):
            os.chmod(folder, 0o755)
            os.chmod(folder, 0o700)
        self.observe(action, allowed=False)

    def test_chflags_and_back(self):
        def action(folder):
            original = folder.stat().st_flags
            os.chflags(folder, original | stat.UF_HIDDEN)
            os.chflags(folder, original)
        self.observe(action, allowed=False)

    def test_chgrp_and_back(self):
        with tempfile.TemporaryDirectory() as base:
            original = os.stat(base).st_gid
        groups = [group for group in os.getgroups() if group != original]
        if not groups:
            self.skipTest("No other supplementary group")
        def action(folder):
            original = folder.stat().st_gid
            group = next((group for group in groups if group != original), None)
            if group is None:
                self.skipTest("No other supplementary group for fixture")
            os.chown(folder, -1, group)
            os.chown(folder, -1, original)
        self.observe(action, allowed=False)

    def test_acl_and_back(self):
        def action(folder):
            subprocess.run(["/bin/chmod", "+a", "everyone deny delete", str(folder)], check=True)
            subprocess.run(["/bin/chmod", "-a#", "0", str(folder)], check=True)
        self.observe(action, allowed=False)

    def test_xattr_and_back(self):
        def action(folder):
            subprocess.run(["/usr/bin/xattr", "-w", "com.observatory.fixture",
                            "fictional", str(folder)], check=True)
            subprocess.run(["/usr/bin/xattr", "-d", "com.observatory.fixture",
                            str(folder)], check=True)
        self.observe(action, allowed=False)

    def test_utime(self):
        self.observe(lambda folder: os.utime(folder, ns=(1, 1)), allowed=False)

    def test_rename_and_back(self):
        def action(folder):
            renamed = folder.with_name("renamed")
            folder.rename(renamed)
            renamed.rename(folder)
        self.observe(action, allowed=False)

    def test_delete(self):
        self.observe(lambda folder: folder.rmdir(), allowed=False)


if __name__ == "__main__":
    unittest.main()
