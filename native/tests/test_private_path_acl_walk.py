"""Synthetic named-object and identity-change checks. No path replacement I/O."""
from contextlib import redirect_stderr, redirect_stdout
import io
import stat
import types
import unittest
from unittest.mock import patch

from test_private_path_acl import policy


def metadata(inode, mode, owner=501, **changes):
    values = dict(st_dev=1, st_ino=inode, st_mode=mode, st_uid=owner, st_gid=20,
                  st_nlink=1, st_size=0, st_mtime_ns=1, st_ctime_ns=1,
                  st_flags=0)
    values.update(changes)
    return types.SimpleNamespace(**values)


class FakeSelect:
    KQ_FILTER_VNODE = -4
    KQ_EV_ADD = 1
    KQ_EV_CLEAR = 32
    KQ_EV_ERROR = 16384
    KQ_EV_EOF = 32768
    KQ_NOTE_DELETE = 1
    KQ_NOTE_WRITE = 2
    KQ_NOTE_EXTEND = 4
    KQ_NOTE_ATTRIB = 8
    KQ_NOTE_LINK = 16
    KQ_NOTE_RENAME = 32
    KQ_NOTE_REVOKE = 64

    def __init__(self, reader):
        self.reader = reader
        self.registrations = []
        self.events = []
        self.failure = None
        self.closed = False
        self.drains = 0

    def kqueue(self):
        if self.failure == "create":
            raise OSError("fictional queue failure")
        return self

    def kevent(self, ident, **kwargs):
        return types.SimpleNamespace(ident=ident, **kwargs)

    def control(self, changes, count, timeout):
        assert timeout == 0
        if self.failure == ("register" if changes else "drain"):
            raise OSError("fictional watcher failure")
        if changes:
            assert count == 0
            self.registrations.extend(changes)
            for event in changes:
                self.reader.hook("register", self.reader.handles[event.ident])
            return []
        self.drains += 1
        events, self.events = self.events[:count], self.events[count:]
        return events

    def close(self):
        self.closed = True
        if self.failure == "close":
            raise OSError("fictional close failure")

    def emit(self, path, fflags=0, **overrides):
        fd = next(fd for fd, name in self.reader.handles.items() if name == path)
        values = dict(ident=fd, fflags=fflags, flags=0, filter=self.KQ_FILTER_VNODE)
        values.update(overrides)
        self.events.append(types.SimpleNamespace(**values))


class FakeReader:
    def __init__(self):
        self.uid = 501
        self.nodes = {"/": metadata(1, stat.S_IFDIR | 0o755, 0),
                      "/safe": metadata(2, stat.S_IFDIR | 0o755, 0),
                      "/safe/private": metadata(3, stat.S_IFDIR | 0o700),
                      "/safe/private/snapshot.json": metadata(4, stat.S_IFREG | 0o600)}
        self.acls = {}
        self.handles = {}
        self.opened = []
        self.closed = []
        self.acl_calls = []
        self.name_calls = 0
        self.hook = lambda event, path: None
        self.mount = None
        self.select = FakeSelect(self)

    def watcher(self):
        return policy.VnodeWatcher(self.select)

    def canonical(self, path):
        self.hook("canonical", path)
        return path

    def path(self, name, parent):
        return name if parent is None else self.handles[parent].rstrip("/") + "/" + name

    def named_stat(self, name, parent):
        path = self.path(name, parent)
        self.hook("named_stat", path)
        if path not in self.nodes:
            raise FileNotFoundError("fictional secret path")
        return self.nodes[path]

    def open(self, name, parent, directory):
        path = self.path(name, parent)
        self.hook("open", path)
        fd = len(self.opened) + 100
        self.opened.append(path)
        self.handles[fd] = path
        return fd

    def close(self, fd):
        self.closed.append(fd)

    def fstat(self, fd):
        self.hook("fstat", self.handles[fd])
        return self.nodes[self.handles[fd]]

    def filesystem(self, fd):
        self.hook("filesystem", self.handles[fd])
        return self.mount or policy.FileSystem(b"apfs", 0x1000, 0, (1, 2), 0, 0)

    def acl(self, fd):
        path = self.handles[fd]
        self.acl_calls.append(path)
        self.hook("acl", path)
        return self.acls.get(path, policy.ACL())

    def names(self, fd):
        self.name_calls += 1
        path = self.handles[fd]
        self.hook("names", path)
        prefix = path.rstrip("/") + "/"
        return tuple(k[len(prefix):] for k in self.nodes if k.startswith(prefix)
                     and "/" not in k[len(prefix):])


class WalkTests(unittest.TestCase):
    def verify(self, reader=None, private=True, path="/safe/private"):
        reader = reader or FakeReader()
        try:
            policy.verify_directory(path, private=private, reader=reader)
        finally:
            self.assertEqual(len(reader.closed), len(reader.opened))
            self.assertEqual(len(reader.closed), len(set(reader.closed)))
        return reader

    def test_trustworthy_chain_and_private_file_are_inspected_twice(self):
        reader = self.verify()
        self.assertEqual(set(reader.opened), set(reader.nodes))
        self.assertEqual(reader.name_calls, 2)
        for path in reader.nodes:
            self.assertEqual(reader.acl_calls.count(path), 2)

    def test_ancestor_mode_does_not_read_unrelated_children(self):
        reader = self.verify(private=False)
        self.assertNotIn("/safe/private/snapshot.json", reader.opened)
        self.assertEqual(reader.name_calls, 0)

    def test_root_and_each_ancestor_require_trusted_modes_and_owners(self):
        for path in ("/", "/safe", "/safe/private"):
            for attribute, value in (("st_uid", 502), ("st_mode", stat.S_IFDIR | 0o777)):
                reader = FakeReader()
                setattr(reader.nodes[path], attribute, value)
                with self.subTest(path=path, attribute=attribute), self.assertRaises(policy.UnsafePath):
                    self.verify(reader)

    def test_ancestor_acl_is_checked_before_descending(self):
        reader = FakeReader()
        reader.acls["/safe"] = policy.ACL((policy.ACE(1, 1 << 6, 0, "gid", 20),))
        with self.assertRaises(policy.UnsafePath):
            self.verify(reader)
        self.assertNotIn("/safe/private", reader.opened)

    def test_file_acl_is_not_ignored(self):
        reader = FakeReader()
        reader.acls["/safe/private/snapshot.json"] = policy.ACL((policy.ACE(1, 2, 0, "uid", 502),))
        with self.assertRaises(policy.UnsafePath):
            self.verify(reader)

    def test_links_nonregular_children_and_hardlinks_are_rejected(self):
        for kind, nlink in ((stat.S_IFLNK, 1), (stat.S_IFDIR, 1), (stat.S_IFIFO, 1),
                            (stat.S_IFCHR, 1), (stat.S_IFSOCK, 1), (stat.S_IFREG, 2)):
            reader = FakeReader()
            reader.nodes["/safe/private/snapshot.json"] = metadata(4, kind | 0o600, st_nlink=nlink)
            with self.subTest(kind=kind, nlink=nlink), self.assertRaises(policy.UnsafePath):
                self.verify(reader)

    def test_symlink_or_file_in_directory_chain_is_rejected(self):
        for path in ("/safe", "/safe/private"):
            for kind in (stat.S_IFLNK, stat.S_IFREG):
                reader = FakeReader()
                reader.nodes[path].st_mode = kind | 0o700
                with self.subTest(path=path, kind=kind), self.assertRaises(policy.UnsafePath):
                    self.verify(reader)

    def test_child_count_is_bounded_at_ten(self):
        reader = FakeReader()
        for index in range(9):
            reader.nodes[f"/safe/private/entry{index}"] = metadata(10 + index, stat.S_IFREG | 0o600)
        self.verify(reader)
        reader = FakeReader()
        for index in range(10):
            reader.nodes[f"/safe/private/entry{index}"] = metadata(10 + index, stat.S_IFREG | 0o600)
        with self.assertRaises(policy.UnsafePath):
            self.verify(reader)

    def test_noncanonical_inputs_are_rejected_before_any_open(self):
        for path in ("", "relative", "//safe/private", "/safe//private", "/safe/../private",
                     "/safe/./private", "/safe/private/", "/safe/\0private", "/x" * 129):
            reader = FakeReader()
            with self.subTest(path=path), self.assertRaises(policy.UnsafePath):
                self.verify(reader, path=path)
            self.assertEqual(reader.opened, [])

    def test_realpath_disagreement_is_rejected(self):
        reader = FakeReader()
        reader.canonical = lambda path: "/different"
        with self.assertRaises(policy.UnsafePath):
            self.verify(reader)

    def test_synthetic_identity_or_metadata_change_during_acl_query_rejects(self):
        for attribute in ("st_ino", "st_dev", "st_ctime_ns", "st_mtime_ns", "st_uid", "st_gid",
                          "st_mode", "st_nlink", "st_size", "st_flags"):
            reader = FakeReader()
            def mutate(event, path):
                if event == "acl" and path == "/safe/private":
                    node = reader.nodes[path]
                    values = vars(node).copy()
                    values[attribute] += 1
                    reader.nodes[path] = types.SimpleNamespace(**values)
            reader.hook = mutate
            with self.subTest(attribute=attribute), self.assertRaises(policy.UnsafePath):
                self.verify(reader)

    def test_registration_precedes_directory_observations_and_file_fd_checks(self):
        for private in (False, True):
            reader = FakeReader()
            calls = []
            reader.hook = lambda event, path: calls.append((event, path))
            self.verify(reader, private=private)
            self.assertEqual([e.ident for e in reader.select.registrations], list(reader.handles))
            for event in reader.select.registrations:
                self.assertEqual(event.filter, reader.select.KQ_FILTER_VNODE)
                self.assertEqual(event.flags, reader.select.KQ_EV_ADD | reader.select.KQ_EV_CLEAR)
                self.assertEqual(event.fflags, 127)
            for path in reader.opened:
                if stat.S_ISDIR(reader.nodes[path].st_mode):
                    self.assertLess(calls.index(("register", path)), calls.index(("named_stat", path)))
                else:
                    self.assertLess(calls.index(("named_stat", path)), calls.index(("open", path)))
                self.assertLess(calls.index(("open", path)), calls.index(("register", path)))
                self.assertLess(calls.index(("register", path)), calls.index(("fstat", path)))
                self.assertLess(calls.index(("register", path)), calls.index(("acl", path)))
            self.assertTrue(reader.select.closed)

    def test_ancestor_attrib_at_first_named_stat_refuses_without_stat_change(self):
        for private in (False, True):
            reader = FakeReader()
            emitted = []
            def mutate(event, path):
                if event == "named_stat" and path == "/safe" and not emitted:
                    fd = next(fd for fd, name in reader.handles.items() if name == path)
                    self.assertIn(fd, [entry.ident for entry in reader.select.registrations])
                    reader.select.emit(path, reader.select.KQ_NOTE_ATTRIB)
                    emitted.append(path)
            reader.hook = mutate
            with self.subTest(private=private), self.assertRaises(policy.UnsafePath):
                self.verify(reader, private=private)
            self.assertEqual(emitted, ["/safe"])

    def test_ancestor_entry_churn_passes_but_security_fields_refuse(self):
        churn = ("st_mtime_ns", "st_ctime_ns", "st_nlink", "st_size")
        security = ("st_ino", "st_dev", "st_uid", "st_gid", "st_mode", "st_flags")
        for private in (True, False):
            ancestors = ("/", "/safe") if private else ("/", "/safe", "/safe/private")
            for target in ancestors:
                for attribute in churn + security:
                    for bits in ((2, 18) if attribute in churn else (0,)):
                        with self.subTest(private=private, path=target, attribute=attribute, bits=bits):
                            reader = FakeReader()
                            def mutate(event, path):
                                if event == "acl" and path == target:
                                    values = vars(reader.nodes[path]).copy()
                                    values[attribute] += 1
                                    reader.nodes[path] = types.SimpleNamespace(**values)
                                    if attribute in churn:
                                        reader.select.emit(path, bits)
                            reader.hook = mutate
                            if attribute in churn:
                                self.verify(reader, private=private)
                            else:
                                with self.assertRaises(policy.UnsafePath):
                                    self.verify(reader, private=private)

    def test_private_file_refuses_all_fingerprint_changes(self):
        for attribute in vars(metadata(1, stat.S_IFREG | 0o600)):
            with self.subTest(attribute=attribute):
                reader = FakeReader()
                def mutate(event, path):
                    if event == "acl" and path == "/safe/private/snapshot.json":
                        values = vars(reader.nodes[path]).copy()
                        values[attribute] += 1
                        reader.nodes[path] = types.SimpleNamespace(**values)
                reader.hook = mutate
                with self.assertRaises(policy.UnsafePath):
                    self.verify(reader)

    def test_events_refuse_transient_changes_with_unchanged_stat(self):
        for private in (True, False):
            paths = ("/", "/safe", "/safe/private")
            if private:
                paths += ("/safe/private/snapshot.json",)
            for target in paths:
                for bits in (0, 1, 2, 4, 8, 16, 18, 32, 64, 128, 10):
                    with self.subTest(private=private, path=target, bits=bits):
                        reader = FakeReader()
                        reader.hook = lambda event, path: (
                            reader.select.emit(path, bits) if event == "acl" and path == target else None)
                        is_private = private and target.startswith("/safe/private")
                        if is_private or bits & ~18:
                            with self.assertRaises(policy.UnsafePath):
                                self.verify(reader, private=private)
                        else:
                            self.verify(reader, private=private)

    def test_malformed_events_refuse(self):
        for overrides in (dict(ident=999), dict(flags=16384), dict(flags=32768), dict(filter=-1)):
            reader = FakeReader()
            reader.hook = lambda event, path: (
                reader.select.emit(path, 2, **overrides) if event == "acl" and path == "/" else None)
            with self.subTest(overrides=overrides), self.assertRaises(policy.UnsafePath):
                self.verify(reader)

    def test_watcher_failures_refuse_and_close_resources(self):
        for stage in ("create", "register", "drain", "close"):
            reader = FakeReader()
            reader.select.failure = stage
            with self.subTest(stage=stage), self.assertRaises(policy.UnsafePath):
                self.verify(reader)
            self.assertEqual(reader.select.closed, stage != "create")

    def test_drain_continues_after_full_batch_and_runs_after_final_canonical(self):
        for unsafe in (False, True):
            reader = FakeReader()
            def emit(event, path):
                if event == "canonical" and reader.handles:
                    for _ in range(128):
                        reader.select.emit("/", 2)
                    if unsafe:
                        reader.select.emit("/", 8)
            reader.hook = emit
            if unsafe:
                with self.assertRaises(policy.UnsafePath):
                    self.verify(reader)
            else:
                self.verify(reader)
            self.assertEqual(reader.select.drains, 3)

    def test_acl_change_without_stat_change_rejects(self):
        reader = FakeReader()
        def mutate(event, path):
            if event == "acl" and reader.acl_calls.count(path) == 2:
                reader.acls[path] = policy.ACL((policy.ACE(2, 16, 0, "opaque", b"x" * 16),))
        reader.hook = mutate
        with self.assertRaises(policy.UnsafePath):
            self.verify(reader)

    def test_entry_enumeration_change_rejects(self):
        reader = FakeReader()
        def mutate(event, path):
            if event == "names" and reader.name_calls == 2:
                reader.nodes["/safe/private/added"] = metadata(7, stat.S_IFREG | 0o600)
        reader.hook = mutate
        with self.assertRaises(policy.UnsafePath):
            self.verify(reader)

    def test_inspection_errors_do_not_become_absent_success(self):
        for stage in ("canonical", "named_stat", "open", "fstat", "filesystem", "acl", "names"):
            reader = FakeReader()
            def fail(event, path):
                if event == stage:
                    raise OSError("fictional secret path and identity")
            reader.hook = fail
            with self.subTest(stage=stage), self.assertRaises((OSError, policy.UnsafePath)):
                self.verify(reader)

    def test_remote_unknown_or_owner_ignoring_filesystems_reject(self):
        mounts = ((b"nfs", 0x1000, 0, 0), (b"apfs", 0, 0, 0),
                  (b"apfs", 0x201000, 0, 0), (b"apfs", 0x1020, 0, 0),
                  (b"apfs", 0x1000, 502, 0), (b"apfs", 0x1000, 0, 2))
        for kind, flags, owner, extended in mounts:
            reader = FakeReader()
            reader.mount = policy.FileSystem(kind, flags, owner, (1, 2), 0, extended)
            with self.subTest(mount=reader.mount), self.assertRaises(policy.UnsafePath):
                self.verify(reader)


class CLITests(unittest.TestCase):
    def run_cli(self, args, verifier):
        out, err = io.StringIO(), io.StringIO()
        with patch.object(policy, "verify_directory", verifier), redirect_stdout(out), redirect_stderr(err):
            code = policy.main(args)
        return code, out.getvalue(), err.getvalue()

    def test_exact_success_and_modes(self):
        seen = []
        def verify(path, *, private):
            seen.append((path, private))
        for args in (["/safe"], ["--private", "/safe"], ["--ancestor", "/safe"]):
            self.assertEqual(self.run_cli(args, verify), (0, "private-path-acl: ok", ""))
        self.assertEqual(seen, [("/safe", True), ("/safe", True), ("/safe", False)])

    def test_all_errors_are_generic_nonzero_and_never_echo_input(self):
        def fail(*args, **kwargs):
            raise OSError("SECRET PATH RAW ACL USER ID")
        args_list = ([], ["--other", "/secret"], ["--private", "--ancestor", "/secret"],
                     ["--private"], ["/secret"], ["--ancestor", "/secret"])
        for args in args_list:
            code, out, err = self.run_cli(args, fail)
            self.assertEqual((code, out, err), (1, "", "private-path-acl: verification failed\n"))

    def test_non_darwin_is_not_silently_validated(self):
        for platform_name in ("win32", "linux", "freebsd"):
            with self.subTest(platform_name=platform_name), patch.object(policy.sys, "platform", platform_name):
                with self.assertRaises(policy.UnsafePath):
                    policy.NativeReader()


if __name__ == "__main__":
    unittest.main()
