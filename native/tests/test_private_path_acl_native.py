"""Fake Darwin C adapter tests. Runnable on Windows without native ACL calls."""
import ctypes as C
import errno
import stat
import types
import unittest

from test_private_path_acl import policy
from test_private_path_acl_walk import FakeReader


def put(pointer, ctype, value):
    C.cast(pointer, C.POINTER(ctype))[0] = value


class Function:
    def __init__(self, callback):
        self.callback = callback
        self.argtypes = None
        self.restype = None

    def __call__(self, *args):
        return self.callback(*args)


class FakeLib:
    """Addresses exceed 32 bits to catch undeclared pointer return types."""
    ACL_HANDLE = 0x123400000000
    EMPTY_HANDLE = ACL_HANDLE + 0x1000
    ENTRY_BASE = ACL_HANDLE + 0x2000

    def __init__(self, entries=(), flags=0):
        # Each entry is (tag, permissions, flags, resolved ID type, resolved ID).
        self.entries = list(entries)
        self.flags = flags
        self.index = -1
        self.freed = []
        self.iteration = []
        self.probed_bits = []
        self.allocations = {}
        self.overrides = {}
        self.calls = []
        for name in ("acl_init", "acl_size", "acl_valid", "acl_free", "acl_get_fd_np",
                     "acl_get_entry", "acl_get_tag_type", "acl_get_permset_mask_np",
                     "acl_maximal_permset_mask_np", "acl_get_flagset_np", "acl_get_flag_np",
                     "acl_get_qualifier", "mbr_uuid_to_id"):
            setattr(self, name, Function(self.dispatch(name)))

    def dispatch(self, name):
        def call(*args):
            self.calls.append(name)
            if name in self.overrides:
                return self.overrides[name](*args)
            return getattr(self, "_" + name)(*args)
        return call

    @staticmethod
    def fail(code=errno.EIO, result=-1):
        C.set_errno(code)
        return result

    def _acl_init(self, count):
        assert count == 0
        return self.EMPTY_HANDLE

    def _acl_size(self, acl):
        # Deliberately not Darwin's current external layout. Do not parse it.
        return 80 if acl == self.EMPTY_HANDLE else 80 + len(self.entries) * 40

    def _acl_valid(self, acl):
        assert acl in (self.ACL_HANDLE, self.EMPTY_HANDLE)
        return 0

    def _acl_free(self, address):
        self.freed.append(address)
        return 0

    def _acl_get_fd_np(self, fd, acl_type):
        assert fd == 9 and acl_type == 0x100
        return self.ACL_HANDLE

    def _acl_get_entry(self, acl, which, target):
        assert acl == self.ACL_HANDLE
        self.iteration.append(which)
        if which == 0:
            self.index = 0
        elif which == -1:
            self.index += 1
        elif which == -2:
            self.index = len(self.entries) - 1
        else:
            raise AssertionError("Not a Darwin iterator constant")
        if not 0 <= self.index < len(self.entries):
            return self.fail(errno.EINVAL)
        put(target, C.c_void_p, self.ENTRY_BASE + self.index * 16)
        return 0

    def entry(self, address):
        return self.entries[(address - self.ENTRY_BASE) // 16]

    def _acl_get_tag_type(self, entry, target):
        put(target, C.c_int, self.entry(entry)[0])
        return 0

    def _acl_get_permset_mask_np(self, entry, target):
        put(target, C.c_uint64, self.entry(entry)[1])
        return 0

    def _acl_maximal_permset_mask_np(self, target):
        put(target, C.c_uint64, sum(1 << n for n in range(1, 14)) | (1 << 20))
        return 0

    def _acl_get_flagset_np(self, obj, target):
        put(target, C.c_void_p, obj + 1)
        return 0

    def _acl_get_flag_np(self, flagset, bit):
        self.probed_bits.append(bit & 0xffffffff)
        obj = flagset - 1
        flags = self.flags if obj == self.ACL_HANDLE else self.entry(obj)[2]
        return int(bool(flags & (bit & 0xffffffff)))

    def _acl_get_qualifier(self, entry):
        index = (entry - self.ENTRY_BASE) // 16
        buffer = C.create_string_buffer(bytes([index + 1]) * 16, 16)
        address = C.addressof(buffer)
        self.allocations[address] = buffer
        return address

    def _mbr_uuid_to_id(self, uuid, id_pointer, type_pointer):
        index = C.string_at(uuid, 16)[0] - 1
        entry = self.entries[index]
        put(id_pointer, C.c_uint32, entry[4])
        put(type_pointer, C.c_int, entry[3])
        return 0


class NativeACLTests(unittest.TestCase):
    def read(self, lib):
        return policy.NativeACL(lib).read(9)

    def test_darwin_zero_success_and_einval_end_do_not_lose_first_entry(self):
        lib = FakeLib([(1, 2, 0, 0, 501), (2, 16, 16, 1, 20)])
        acl = self.read(lib)
        self.assertEqual(len(acl.entries), 2)
        self.assertEqual(acl.entries[0].principal_kind, "uid")
        self.assertEqual(acl.entries[0].principal_id, 501)
        self.assertEqual(acl.entries[1].principal_kind, "opaque")
        self.assertEqual(lib.iteration, [0, -1, -1, -2])
        self.assertEqual(lib.freed.count(lib.ACL_HANDLE), 1)
        self.assertEqual(lib.freed.count(lib.EMPTY_HANDLE), 1)
        self.assertTrue(all(lib.freed.count(p) == 1 for p in lib.allocations))

    def test_empty_acl_is_distinguished_from_query_failure(self):
        self.assertEqual(self.read(FakeLib()), policy.ACL())
        lib = FakeLib()
        lib.overrides["acl_get_fd_np"] = lambda *args: lib.fail(result=None)
        with self.assertRaises(policy.UnsafePath):
            self.read(lib)
        self.assertNotIn(lib.ACL_HANDLE, lib.freed)

    def test_descriptor_enoent_is_absent_acl_not_path_absence(self):
        lib = FakeLib()
        lib.overrides["acl_get_fd_np"] = lambda *args: lib.fail(errno.ENOENT, None)
        self.assertEqual(self.read(lib), policy.ACL())
        for error in (0, errno.EACCES, errno.EBADF, errno.ENOTSUP, errno.EINVAL):
            lib.overrides["acl_get_fd_np"] = lambda *args: lib.fail(error, None)
            with self.subTest(error=error), self.assertRaises(policy.UnsafePath):
                self.read(lib)

    def test_pointer_and_mask_abi_are_declared(self):
        lib = FakeLib()
        self.read(lib)
        self.assertIs(lib.acl_get_fd_np.restype, C.c_void_p)
        self.assertIs(lib.acl_get_qualifier.restype, C.c_void_p)
        self.assertEqual(lib.acl_get_entry.argtypes,
                         [C.c_void_p, C.c_int, C.POINTER(C.c_void_p)])
        self.assertEqual(lib.acl_get_permset_mask_np.argtypes,
                         [C.c_void_p, C.POINTER(C.c_uint64)])
        self.assertEqual(lib.mbr_uuid_to_id.argtypes,
                         [C.c_void_p, C.POINTER(C.c_uint32), C.POINTER(C.c_int)])
        self.assertIs(lib.acl_size.restype, C.c_ssize_t)

    def test_all_flag_bits_are_queried_not_only_known_flags(self):
        lib = FakeLib(flags=1 << 31)
        with self.assertRaises(policy.UnsafePath):
            self.read(lib)
        self.assertIn(1 << 31, lib.probed_bits)

    def test_unknown_permission_bits_and_tags_fail_closed(self):
        for entry in ((1, 1 << 40, 0, 0, 501), (3, 2, 0, 0, 501),
                      (2, 2, 1 << 31, 0, 501)):
            lib = FakeLib([entry])
            with self.subTest(entry=entry), self.assertRaises(policy.UnsafePath):
                self.read(lib)
            self.assertIn(lib.ACL_HANDLE, lib.freed)

    def test_return_one_is_not_linux_style_success(self):
        lib = FakeLib([(1, 2, 0, 0, 501)])
        lib.overrides["acl_get_entry"] = lambda *args: 1
        with self.assertRaises(policy.UnsafePath):
            self.read(lib)
        self.assertIn(lib.ACL_HANDLE, lib.freed)

    def test_premature_einval_is_not_treated_as_empty_or_finished(self):
        for after in (0, 1):
            lib = FakeLib([(1, 2, 0, 0, 501), (1, 2, 0, 0, 502)])
            def iterate(acl, which, target):
                if (which == 0 and after == 0) or (which == -1 and after == 1):
                    return lib.fail(errno.EINVAL)
                return lib._acl_get_entry(acl, which, target)
            lib.overrides["acl_get_entry"] = iterate
            with self.subTest(after=after), self.assertRaises(policy.UnsafePath):
                self.read(lib)

    def test_all_inspection_failures_reject_and_free_owned_memory(self):
        calls = ("acl_valid", "acl_size", "acl_get_entry", "acl_get_tag_type",
                 "acl_get_permset_mask_np", "acl_maximal_permset_mask_np",
                 "acl_get_flagset_np", "acl_get_flag_np", "mbr_uuid_to_id")
        for call in calls:
            lib = FakeLib([(1, 2, 0, 0, 501)])
            lib.overrides[call] = lambda *args: lib.fail()
            with self.subTest(call=call), self.assertRaises(policy.UnsafePath):
                self.read(lib)
            self.assertTrue(all(lib.freed.count(p) == 1 for p in lib.allocations))

    def test_null_pointer_success_is_rejected(self):
        for call in ("acl_get_qualifier", "acl_get_flagset_np", "acl_get_entry"):
            lib = FakeLib([(1, 2, 0, 0, 501)])
            lib.overrides[call] = lambda *args: 0
            with self.subTest(call=call), self.assertRaises(policy.UnsafePath):
                self.read(lib)
            self.assertIn(lib.ACL_HANDLE, lib.freed)

    def test_unknown_membership_type_is_not_root(self):
        lib = FakeLib([(1, 2, 0, 4, 0)])
        with self.assertRaises(policy.UnsafePath):
            self.read(lib)
        self.assertTrue(all(lib.freed.count(p) == 1 for p in lib.allocations))

    def test_entry_bound_is_enforced(self):
        self.assertEqual(len(self.read(FakeLib([(2, 16, 0, 0, 0)] * 128)).entries), 128)
        with self.assertRaises(policy.UnsafePath):
            self.read(FakeLib([(2, 16, 0, 0, 0)] * 129))


class FilesystemABITests(unittest.TestCase):
    def test_statfs_layout_matches_sdk_header_dump(self):
        self.assertEqual(C.sizeof(policy.StatFS), 2168)
        for name, offset in (("f_fsid", 48), ("f_owner", 56), ("f_flags", 64),
                             ("f_fstypename", 72), ("f_mntonname", 88),
                             ("f_mntfromname", 1112), ("f_flags_ext", 2136)):
            self.assertEqual(getattr(policy.StatFS, name).offset, offset)

    def test_architecture_uses_correct_inode64_symbol_and_declares_abi(self):
        for machine, name in (("arm64", "fstatfs"), ("x86_64", "fstatfs$INODE64")):
            def read(fd, pointer):
                self.assertEqual(fd, 9)
                result = C.cast(pointer, C.POINTER(policy.StatFS)).contents
                result.f_fstypename = b"apfs"
                result.f_flags = 0x1000
                result.f_owner = 501
                result.f_fsid[0] = 12
                result.f_fsid[1] = 34
                return 0
            lib = types.SimpleNamespace(**{name: Function(read)})
            filesystem = policy.NativeFS(lib, machine).read(9)
            self.assertEqual(filesystem.kind, b"apfs")
            self.assertEqual(filesystem.identity, (12, 34))
            function = getattr(lib, name)
            self.assertEqual(function.argtypes, [C.c_int, C.POINTER(policy.StatFS)])
            self.assertIs(function.restype, C.c_int)

    def test_filesystem_query_failure_is_not_an_empty_success(self):
        lib = types.SimpleNamespace(fstatfs=Function(lambda *args: -1))
        with self.assertRaises(policy.UnsafePath):
            policy.NativeFS(lib, "arm64").read(9)

    def test_unknown_architecture_is_rejected(self):
        with self.assertRaises(policy.UnsafePath):
            policy.NativeFS(types.SimpleNamespace(), "unrecognized")


class OSReaderTests(unittest.TestCase):
    def reader(self):
        reader = policy.NativeReader.__new__(policy.NativeReader)
        reader.os = types.SimpleNamespace(O_RDONLY=0, O_NOFOLLOW=0x100, O_NONBLOCK=4,
                                          O_DIRECTORY=0x100000, O_CLOEXEC=0x1000000,
                                          O_EVTONLY=0x8000, O_SEARCH=0x40100000)
        return reader

    def test_open_is_relative_search_only_or_event_only_with_guards(self):
        reader = self.reader()
        seen = []
        def open_fd(name, flags, *, dir_fd):
            seen.append((name, flags, dir_fd))
            return 8
        reader.os.open = open_fd
        self.assertEqual(reader.open("leaf", 7, True), 8)
        self.assertEqual(reader.open("file", 8, False), 8)
        self.assertEqual(seen, [("leaf", 0x40100000 | 0x1000104, 7), ("file", 0x1008104, 8)])
        for _, flags, _ in seen:
            self.assertEqual(flags & (1 | 2 | 0x200 | 0x400), 0)

    def test_missing_search_flag_fails_without_any_fallback_open(self):
        reader = self.reader()
        del reader.os.O_SEARCH
        opened = []
        reader.os.open = lambda *args, **kwargs: opened.append((args, kwargs))
        with self.assertRaises(AttributeError):
            reader.open("leaf", 7, True)
        self.assertEqual(opened, [])

    def test_named_stat_never_follows_links(self):
        reader = self.reader()
        seen = []
        def named(name, *, dir_fd, follow_symlinks):
            seen.append((name, dir_fd, follow_symlinks))
            return "metadata"
        reader.os.stat = named
        self.assertEqual(reader.named_stat("leaf", 7), "metadata")
        self.assertEqual(seen, [("leaf", 7, False)])

    def test_scandir_is_bounded_and_closed_without_reading_contents(self):
        reader = self.reader()
        opened, scanned, closed = [], [], []
        def open_fd(name, flags, *, dir_fd):
            opened.append((name, flags, dir_fd))
            return 8
        reader.os.open = open_fd
        reader.os.close = closed.append
        class Entries:
            consumed = 0
            closed = False
            def __enter__(self):
                return self
            def __exit__(self, *args):
                self.closed = True
            def __iter__(self):
                for index in range(10000):
                    self.consumed += 1
                    yield types.SimpleNamespace(name=f"file{index}")
        entries = Entries()
        def scandir(fd):
            scanned.append(fd)
            return entries
        reader.os.scandir = scandir
        with self.assertRaises(policy.UnsafePath):
            reader.names(7)
        self.assertEqual(entries.consumed, 11)
        self.assertTrue(entries.closed)
        self.assertEqual(opened, [(".", 0x1100100, 7)])
        self.assertEqual(scanned, [8])
        self.assertEqual(closed, [8])


class SearchOnlyOS:
    """Model the observed Darwin sandbox access split, not a real sandbox.

    Ancestors permit metadata/search only. Even O_EVTONLY failed there.
    Directory data access is limited to '.' on the held private-leaf FD.
    All ACL, filesystem, identity and walk decisions still run in real code.
    """
    # SDK sys/fcntl.h: O_SEARCH = O_EXEC (0x40000000) | O_DIRECTORY.
    O_RDONLY = 0
    O_NOFOLLOW = 0x100
    O_NONBLOCK = 4
    O_DIRECTORY = 0x100000
    O_CLOEXEC = 0x1000000
    O_EVTONLY = 0x8000
    O_SEARCH = 0x40100000
    PRIVATE = "/safe/private"

    def __init__(self):
        self.tree = FakeReader()
        self.path = types.SimpleNamespace(realpath=self.realpath)
        self.attempts = []
        self.flags = {}
        self.scanned = []
        self.iterators = []
        self.scan_failure = None

    def realpath(self, path, *, strict):
        assert strict
        return self.tree.canonical(path)

    def live(self, fd):
        assert fd in self.tree.handles and fd not in self.tree.closed
        return self.tree.handles[fd]

    def stat(self, name, *, dir_fd, follow_symlinks):
        assert not follow_symlinks
        if dir_fd is not None:
            self.live(dir_fd)
        return self.tree.named_stat(name, dir_fd)

    def open(self, name, flags, *, dir_fd):
        if dir_fd is None:
            assert name == "/"
        else:
            self.live(dir_fd)
            assert "/" not in name and name not in ("", "..")
        path = self.live(dir_fd) if name == "." else self.tree.path(name, dir_fd)
        self.attempts.append((name, flags, dir_fd, path))
        directory = stat.S_ISDIR(self.tree.nodes[path].st_mode)
        guards = self.O_NOFOLLOW | self.O_CLOEXEC
        if name == ".":
            assert path == self.PRIVATE
            assert flags == guards | self.O_RDONLY | self.O_DIRECTORY
            if self.scan_failure == "open":
                raise OSError(errno.EACCES, "fictional leaf enumeration open failure")
        elif directory:
            if flags != guards | self.O_NONBLOCK | self.O_SEARCH:
                raise PermissionError(errno.EPERM, "ancestor data access is denied")
        else:
            assert flags == guards | self.O_NONBLOCK | self.O_EVTONLY
        # Allocate the fictional handle after enforcing the FD-relative request.
        fd = self.tree.open(path, None, directory)
        self.flags[fd] = flags
        return fd

    def close(self, fd):
        self.live(fd)
        self.tree.close(fd)

    def fstat(self, fd):
        self.live(fd)
        return self.tree.fstat(fd)

    def scandir(self, fd):
        assert self.live(fd) == self.PRIVATE
        assert self.flags[fd] == self.O_RDONLY | self.O_DIRECTORY | self.O_NOFOLLOW | self.O_CLOEXEC
        self.scanned.append(fd)
        if self.scan_failure == "scandir":
            raise OSError(errno.EIO, "fictional scandir creation failure")
        entries = self.Entries(self.tree.names(fd), self.scan_failure)
        self.iterators.append(entries)
        return entries

    class Entries:
        def __init__(self, names, failure):
            self.names = names
            self.failure = failure
            self.closed = False

        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.closed = True

        def __iter__(self):
            for name in self.names:
                yield types.SimpleNamespace(name=name)
                if self.failure == "iterate":
                    raise OSError(errno.EIO, "fictional directory iteration failure")


class SearchOnlyTraversalTests(unittest.TestCase):
    def verify(self, fake, *, private):
        reader = policy.NativeReader.__new__(policy.NativeReader)
        reader.os = fake
        reader.uid = fake.tree.uid
        reader.native_fs = types.SimpleNamespace(read=fake.tree.filesystem)
        reader.native_acl = types.SimpleNamespace(read=fake.tree.acl)
        try:
            policy.verify_directory(fake.PRIVATE, private=private, reader=reader)
        except (OSError, policy.UnsafePath) as error:
            return error
        finally:
            self.assertCountEqual(fake.tree.closed, fake.tree.handles)
            self.assertTrue(all(entries.closed for entries in fake.iterators))
        return None

    def test_ancestor_mode_succeeds_with_search_only_access_and_no_enumeration(self):
        fake = SearchOnlyOS()
        self.assertIsNone(self.verify(fake, private=False))
        self.assertEqual(fake.tree.opened, ["/", "/safe", fake.PRIVATE])
        self.assertEqual(fake.scanned, [])
        self.assertEqual([name for name, _, _, _ in fake.attempts], ["/", "safe", "private"])
        for path in fake.tree.opened:
            self.assertEqual(fake.tree.acl_calls.count(path), 2)

    def test_private_mode_reads_only_dot_relative_to_held_leaf_and_closes_all_fds(self):
        fake = SearchOnlyOS()
        self.assertIsNone(self.verify(fake, private=True))
        leaf_fd = next(fd for fd, path in fake.tree.handles.items() if path == fake.PRIVATE)
        reads = [(name, parent, path) for name, _, parent, path in fake.attempts if name == "."]
        self.assertEqual(reads, [(".", leaf_fd, fake.PRIVATE)] * 2)
        self.assertEqual(len(fake.scanned), 2)
        self.assertNotIn(leaf_fd, fake.scanned)
        self.assertEqual(fake.tree.name_calls, 2)
        for path in fake.tree.nodes:
            self.assertEqual(fake.tree.acl_calls.count(path), 2)

    def test_leaf_enumeration_failures_close_readable_and_search_handles(self):
        for stage in ("open", "scandir", "iterate"):
            with self.subTest(stage=stage):
                fake = SearchOnlyOS()
                fake.scan_failure = stage
                result = self.verify(fake, private=True)
                self.assertIsInstance(result, OSError)
                self.assertEqual(result.errno, errno.EACCES if stage == "open" else errno.EIO)
                self.assertEqual(fake.attempts[-1][0], ".")

    def test_excess_leaf_names_close_readable_and_search_handles(self):
        fake = SearchOnlyOS()
        fake.tree.names = lambda fd: tuple(f"file{index}" for index in range(10000))
        self.assertIsInstance(self.verify(fake, private=True), policy.UnsafePath)
        self.assertEqual(len(fake.scanned), 1)

    def test_acl_rejection_still_closes_handles_before_or_after_enumeration(self):
        for path, permissions, enumerations in (("/safe", 1 << 6, 0),
                                               ("/safe/private/snapshot.json", 2, 1)):
            with self.subTest(path=path):
                fake = SearchOnlyOS()
                fake.tree.acls[path] = policy.ACL((policy.ACE(1, permissions, 0, "uid", 502),))
                self.assertIsInstance(self.verify(fake, private=True), policy.UnsafePath)
                self.assertEqual(len(fake.scanned), enumerations)


if __name__ == "__main__":
    unittest.main()
