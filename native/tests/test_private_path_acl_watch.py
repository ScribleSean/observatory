"""Kernel vnode checks on disposable synthetic folders only."""
from contextlib import contextmanager
import ctypes
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


@contextmanager
def private_tree():
    base = Path(__file__).resolve().parents[2] / ".test-runtime" / "private-path-acl-watch"
    os.makedirs(base, mode=0o700, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=os.path.realpath(base)) as tree:
        ancestor = Path(tree) / "ancestor"
        ancestor.mkdir(mode=0o700)
        private = ancestor / "leaf"
        private.mkdir(mode=0o700)
        (private / "fictional.txt").touch(mode=0o600)
        try:
            yield ancestor, private
        finally:
            os.chmod(ancestor, 0o700)
            os.chmod(private, 0o700)


class ActionReader(policy.NativeReader):
    """Run one synchronous action at the selected observation of one folder."""
    def __init__(self, stage, action, target="ancestor"):
        super().__init__()
        self.stage = stage
        self.action = action
        self.target = target
        self.target_fd = None
        self.action_calls = 0

    def open(self, name, parent, directory):
        fd = super().open(name, parent, directory)
        if name == self.target:
            self.target_fd = fd
        return fd

    def run_action(self, stage, selected):
        if self.stage == stage and selected and not self.action_calls:
            self.action_calls += 1
            self.action()

    def named_stat(self, name, parent):
        self.run_action("named_stat", name == self.target)
        return super().named_stat(name, parent)

    def acl(self, fd):
        self.run_action("acl", fd == self.target_fd)
        return super().acl(fd)


@unittest.skipUnless(sys.platform == "darwin", "Darwin full verifier checks required")
class KernelVerificationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with private_tree() as (_, private):
            try:
                policy.verify_directory(os.path.realpath(private), private=True,
                                        reader=policy.NativeReader())
            except (OSError, policy.UnsafePath) as error:
                raise AssertionError(
                    "Untouched synthetic tree failed NativeReader verification "
                    "(filesystem or ancestor policy unsupported): "
                    f"{type(error).__name__}: {error}") from error

    def verify_action(self, action, *, allowed, target="ancestor"):
        for stage in ("named_stat", "acl"):
            with self.subTest(stage=stage), private_tree() as (ancestor, private):
                reader = ActionReader(stage, lambda: action(ancestor, private), target)
                if allowed:
                    policy.verify_directory(os.path.realpath(private), private=True, reader=reader)
                else:
                    with self.assertRaises(policy.UnsafePath):
                        policy.verify_directory(os.path.realpath(private), private=True, reader=reader)
                self.assertEqual(reader.action_calls, 1)

    @staticmethod
    def file_churn(folder):
        child = folder / "temporary.txt"
        child.touch(mode=0o600)
        child.unlink()

    def test_ancestor_file_churn_passes(self):
        self.verify_action(lambda ancestor, private: self.file_churn(ancestor), allowed=True)

    def test_ancestor_subfolder_creation_passes(self):
        self.verify_action(lambda ancestor, private: (ancestor / "child").mkdir(mode=0o700),
                           allowed=True)

    def test_ancestor_chmod_and_back_refuses(self):
        def action(ancestor, private):
            try:
                os.chmod(ancestor, 0o777)
            finally:
                os.chmod(ancestor, 0o700)
        self.verify_action(action, allowed=False)

    def test_ancestor_acl_and_back_refuses(self):
        def action(ancestor, private):
            subprocess.run(["/bin/chmod", "+a", "everyone allow add_file,delete_child",
                            str(ancestor)], check=True)
            subprocess.run(["/bin/chmod", "-a#", "0", str(ancestor)], check=True)
        self.verify_action(action, allowed=False)

    def test_ancestor_chflags_and_back_refuses(self):
        def action(ancestor, private):
            original = ancestor.stat().st_flags
            try:
                os.chflags(ancestor, original | stat.UF_HIDDEN)
            finally:
                os.chflags(ancestor, original)
        self.verify_action(action, allowed=False)

    def test_ancestor_rename_and_back_refuses(self):
        def action(ancestor, private):
            renamed = ancestor.with_name("renamed")
            ancestor.rename(renamed)
            renamed.rename(ancestor)
        self.verify_action(action, allowed=False)

    def test_ancestor_xattr_and_back_refuses(self):
        def action(ancestor, private):
            name = "com.observatory.fixture"
            if hasattr(os, "setxattr") and hasattr(os, "removexattr"):
                os.setxattr(ancestor, name, b"fictional")
                os.removexattr(ancestor, name)
            else:
                subprocess.run(["/usr/bin/xattr", "-w", name, "fictional", str(ancestor)],
                               check=True)
                subprocess.run(["/usr/bin/xattr", "-d", name, str(ancestor)], check=True)
        self.verify_action(action, allowed=False)

    def test_ancestor_utime_and_back_refuses(self):
        def action(ancestor, private):
            original = ancestor.stat()
            try:
                os.utime(ancestor, ns=(1_000_000_000, 1_000_000_000))
            finally:
                os.utime(ancestor, ns=(original.st_atime_ns, original.st_mtime_ns))
        self.verify_action(action, allowed=False)

    def test_ancestor_atomic_swap_and_back_refuses(self):
        try:
            library = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
            renamex = library.renamex_np
        except (OSError, AttributeError) as error:
            self.skipTest(f"renamex_np unavailable: {type(error).__name__}: {error}")
        renamex.argtypes = (ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint)
        renamex.restype = ctypes.c_int

        def swap(source, target):
            if renamex(os.fsencode(source), os.fsencode(target), 0x2) != 0:
                error = ctypes.get_errno()
                raise OSError(error, os.strerror(error))

        def action(ancestor, private):
            sibling = ancestor.with_name("swap")
            sibling.mkdir(mode=0o700)
            swap(sibling, ancestor)
            # Keep the ancestor path as the swap target both times.
            swap(ancestor, sibling)
        self.verify_action(action, allowed=False)

    def test_private_file_churn_refuses(self):
        # A change inside the private folder before its own watch starts is
        # outside the check, as it was before ancestor churn was ignored. Run
        # it at the private folder's own first stat and ACL read instead.
        self.verify_action(lambda ancestor, private: self.file_churn(private), allowed=False,
                           target="leaf")


if __name__ == "__main__":
    unittest.main()
