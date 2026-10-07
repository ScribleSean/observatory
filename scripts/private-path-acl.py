"""Read-only macOS directory trust and private-leaf policy.

The caller must keep its own lock and create new files with mode 0600 and new
directories with mode 0700. This is a metadata preflight, not an atomic lease
against the current account or root changing the tree after it returns.

CLI: [--ancestor|--private] ABSOLUTE_DIRECTORY, default --private. Success is
exit 0 and exactly 'private-path-acl: ok' on stdout, with no newline. All other
outcomes fail. Only 64-bit Darwin, local APFS/HFS and inspectable canonical
ancestors are supported. No permission repair, subprocesses or content reads.

ABI sources, also checked against the installed MacOSX26.5 SDK headers/manuals:
https://github.com/apple-oss-distributions/Libc/tree/main/posix1e
https://github.com/apple-oss-distributions/Libc/blob/main/gen/filesec.c
https://github.com/apple-oss-distributions/Libc/blob/main/sys/statx_np.c
https://github.com/apple-oss-distributions/Libc/blob/main/include/sys/acl.h
https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/mount.h
"""
import sys
sys.dont_write_bytecode = True

from dataclasses import dataclass
from contextlib import ExitStack
import ctypes as C
import errno
import os
import posixpath
import stat

# MacOSX26.5.sdk/usr/include/sys/acl.h. These are Darwin, not Linux, values.
ACL_TYPE_EXTENDED = 0x100
ACL_FIRST_ENTRY = 0
ACL_NEXT_ENTRY = -1
ACL_LAST_ENTRY = -2
ACL_EXTENDED_ALLOW = 1
ACL_EXTENDED_DENY = 2
ACL_MAX_ENTRIES = 128
ACL_FLAG_NO_INHERIT = 1 << 17
ENTRY_FLAGS = sum(1 << bit for bit in range(4, 9))
KNOWN_PERMISSIONS = sum(1 << bit for bit in range(1, 14)) | (1 << 20)
# WRITE_DATA/ADD_FILE, DELETE, APPEND_DATA/ADD_SUBDIRECTORY, DELETE_CHILD,
# WRITE_ATTRIBUTES, WRITE_EXTATTRIBUTES, WRITE_SECURITY and CHANGE_OWNER.
MODIFY_PERMISSIONS = sum(1 << bit for bit in (2, 4, 5, 6, 8, 10, 12, 13))
MAX_CHILDREN = 10
MAX_COMPONENTS = 128


class UnsafePath(Exception):
    pass


@dataclass(frozen=True)
class ACE:
    tag: int
    permissions: int
    flags: int
    principal_kind: str
    principal_id: object
    qualifier: bytes = b""


@dataclass(frozen=True)
class ACL:
    entries: tuple = ()
    flags: int = 0


def check_access(mode, owner, acl, uid, *, private):
    """Reject broad grants without assuming that deny order cancels them.

    Ancestors may expose read/search metadata but must not be mutable by any
    untrusted account. Private objects allow no untrusted nonzero grant. Apply
    this even to inherit-only entries, which can expose newly created files.
    Deny-only ACLs restrict access and need no principal membership lookup.
    """
    if private:
        if owner != uid or mode & 0o7077:
            raise UnsafePath()
    elif owner not in (0, uid) or mode & 0o022:
        raise UnsafePath()
    if not (stat.S_ISDIR(mode) or (private and stat.S_ISREG(mode))):
        raise UnsafePath()
    if acl.flags & ~ACL_FLAG_NO_INHERIT or len(acl.entries) > ACL_MAX_ENTRIES:
        raise UnsafePath()
    for entry in acl.entries:
        if (entry.tag not in (ACL_EXTENDED_ALLOW, ACL_EXTENDED_DENY)
                or entry.permissions & ~KNOWN_PERMISSIONS
                or entry.flags & ~ENTRY_FLAGS):
            raise UnsafePath()
        if entry.tag == ACL_EXTENDED_DENY:
            continue
        if entry.principal_kind not in ("uid", "gid"):
            raise UnsafePath()
        if entry.principal_kind == "uid" and entry.principal_id in (0, uid):
            continue
        if entry.permissions & (KNOWN_PERMISSIONS if private else MODIFY_PERMISSIONS):
            raise UnsafePath()


class NativeACL:
    """Darwin's public ACL API with explicit ABI and allocation ownership.

    References: SDK sys/acl.h, membership.h, acl_get_entry(3),
    acl_get_qualifier(3), acl_free(3), acl_copy_ext(3). The last manual says
    not to assume the binary external layout. We do not parse that layout.
    Apple Libc posix1e/acl_entry.c and acl_flag.c confirm iterator and full
    32-bit flag probing semantics. Unknown flag probes failing is a failure,
    not permission to ignore a bit. No filesystem ACL setter is bound.
    """
    def __init__(self, lib):
        self.lib = lib
        pointer = C.c_void_p
        out_pointer = C.POINTER(pointer)
        declarations = {
            "acl_init": ([C.c_int], pointer),
            "acl_size": ([pointer], C.c_ssize_t),
            "acl_valid": ([pointer], C.c_int),
            "acl_free": ([pointer], C.c_int),
            "acl_get_fd_np": ([C.c_int, C.c_int], pointer),
            "acl_get_entry": ([pointer, C.c_int, out_pointer], C.c_int),
            "acl_get_tag_type": ([pointer, C.POINTER(C.c_int)], C.c_int),
            "acl_get_permset_mask_np": ([pointer, C.POINTER(C.c_uint64)], C.c_int),
            "acl_maximal_permset_mask_np": ([C.POINTER(C.c_uint64)], C.c_int),
            "acl_get_flagset_np": ([pointer, out_pointer], C.c_int),
            "acl_get_flag_np": ([pointer, C.c_int], C.c_int),
            "acl_get_qualifier": ([pointer], pointer),
            "mbr_uuid_to_id": ([pointer, C.POINTER(C.c_uint32), C.POINTER(C.c_int)], C.c_int),
        }
        for name, (args, result) in declarations.items():
            bind(lib, name, args, result)
        maximal = C.c_uint64()
        checked(lib.acl_maximal_permset_mask_np(C.byref(maximal)))
        if maximal.value != KNOWN_PERMISSIONS:
            raise UnsafePath()
        empty = lib.acl_init(0)
        if not empty or empty == 1:
            raise UnsafePath()
        try:
            self.empty_size = lib.acl_size(empty)
            if self.empty_size <= 0:
                raise UnsafePath()
        finally:
            checked(lib.acl_free(empty))

    def flags(self, obj, allowed):
        flags = C.c_void_p()
        checked(self.lib.acl_get_flagset_np(obj, C.byref(flags)))
        if not flags.value:
            raise UnsafePath()
        mask = 0
        for bit in range(32):
            present = self.lib.acl_get_flag_np(flags.value, C.c_int(1 << bit).value)
            if present not in (0, 1):
                raise UnsafePath()
            if present:
                mask |= 1 << bit
        if mask & ~allowed:
            raise UnsafePath()
        return mask

    def entry(self, entry):
        tag = C.c_int()
        permissions = C.c_uint64()
        checked(self.lib.acl_get_tag_type(entry, C.byref(tag)))
        checked(self.lib.acl_get_permset_mask_np(entry, C.byref(permissions)))
        if (tag.value not in (ACL_EXTENDED_ALLOW, ACL_EXTENDED_DENY)
                or permissions.value & ~KNOWN_PERMISSIONS):
            raise UnsafePath()
        flags = self.flags(entry, ENTRY_FLAGS)
        qualifier = self.lib.acl_get_qualifier(entry)
        if not qualifier or qualifier == 1:
            raise UnsafePath()
        try:
            # guid_t and uuid_t have 16 bytes. This is owned memory, not a string.
            raw = C.string_at(qualifier, 16)
            kind, identifier = "opaque", raw
            if tag.value == ACL_EXTENDED_ALLOW:
                uid_or_gid = C.c_uint32()
                id_type = C.c_int(-1)
                checked(self.lib.mbr_uuid_to_id(qualifier, C.byref(uid_or_gid), C.byref(id_type)))
                # membership.h: ID_TYPE_UID=0, ID_TYPE_GID=1. No group is trusted.
                if id_type.value not in (0, 1):
                    raise UnsafePath()
                kind = "uid" if id_type.value == 0 else "gid"
                identifier = uid_or_gid.value
            return ACE(tag.value, permissions.value, flags, kind, identifier, raw)
        finally:
            checked(self.lib.acl_free(qualifier))

    def read(self, fd):
        C.set_errno(0)
        acl = self.lib.acl_get_fd_np(fd, ACL_TYPE_EXTENDED)
        if not acl:
            # Apple Libc posix1e/acl_file.c -> gen/filesec.c returns ENOENT for
            # an absent FILESEC_ACL property, also confirmed on a fresh macOS
            # directory. This is an FD query, not a pathname lookup. The caller
            # brackets it with identity checks on a supported local filesystem.
            if C.get_errno() == errno.ENOENT:
                return ACL()
            raise UnsafePath()
        if acl == 1:
            raise UnsafePath()
        try:
            checked(self.lib.acl_valid(acl))
            size = self.lib.acl_size(acl)
            if size < self.empty_size:
                raise UnsafePath()
            flags = self.flags(acl, ACL_FLAG_NO_INHERIT)
            entries = []
            seen = set()
            last = None
            while True:
                entry = C.c_void_p()
                C.set_errno(0)
                result = self.lib.acl_get_entry(
                    acl, ACL_FIRST_ENTRY if not entries else ACL_NEXT_ENTRY, C.byref(entry))
                if result == -1 and C.get_errno() == errno.EINVAL:
                    break
                if result != 0 or not entry.value or entry.value in seen:
                    raise UnsafePath()
                if len(entries) == ACL_MAX_ENTRIES:
                    raise UnsafePath()
                seen.add(entry.value)
                last = entry.value
                entries.append(self.entry(entry.value))
            # EINVAL is Darwin's end marker, not Linux's return-zero marker.
            # Distinguish an early EINVAL from a complete iteration. Never ask
            # for LAST on an empty ACL (older Libc may return an invalid slot).
            if not entries:
                if size != self.empty_size:
                    raise UnsafePath()
            else:
                end = C.c_void_p()
                checked(self.lib.acl_get_entry(acl, ACL_LAST_ENTRY, C.byref(end)))
                if end.value != last or size <= self.empty_size:
                    raise UnsafePath()
            checked(self.lib.acl_valid(acl))
            if self.lib.acl_size(acl) != size:
                raise UnsafePath()
            return ACL(tuple(entries), flags)
        finally:
            checked(self.lib.acl_free(acl))


def checked(result):
    if result != 0:
        raise UnsafePath()


def bind(lib, name, args, result):
    function = getattr(lib, name)
    function.argtypes = args
    function.restype = result
    return function


@dataclass(frozen=True)
class FileSystem:
    kind: bytes
    flags: int
    owner: int
    identity: tuple
    subtype: int
    extended_flags: int


def check_filesystem(filesystem, uid):
    # SDK sys/mount.h: MNT_LOCAL, MNT_IGNORE_OWNERSHIP, MNT_UNION.
    # Support only local APFS/HFS with real ownership. Network, synthetic,
    # union, FSKit and unknown filesystem semantics are intentionally rejected.
    if (filesystem.kind not in (b"apfs", b"hfs")
            or not filesystem.flags & 0x00001000
            or filesystem.flags & (0x00200000 | 0x00000020)
            or filesystem.owner not in (0, uid)
            or filesystem.extended_flags & ~0x00000001):
        raise UnsafePath()


class StatFS(C.Structure):
    """SDK sys/mount.h __DARWIN_STRUCT_STATFS64, natural 64-bit ABI layout."""
    _fields_ = [
        ("f_bsize", C.c_uint32), ("f_iosize", C.c_int32),
        ("f_blocks", C.c_uint64), ("f_bfree", C.c_uint64), ("f_bavail", C.c_uint64),
        ("f_files", C.c_uint64), ("f_ffree", C.c_uint64),
        ("f_fsid", C.c_int32 * 2), ("f_owner", C.c_uint32),
        ("f_type", C.c_uint32), ("f_flags", C.c_uint32), ("f_fssubtype", C.c_uint32),
        ("f_fstypename", C.c_char * 16), ("f_mntonname", C.c_char * 1024),
        ("f_mntfromname", C.c_char * 1024), ("f_flags_ext", C.c_uint32),
        ("f_reserved", C.c_uint32 * 7),
    ]


class NativeFS:
    def __init__(self, lib, machine):
        # SDK sys/cdefs.h maps Intel inode64 calls to a suffixed symbol.
        if machine not in ("arm64", "x86_64") or C.sizeof(C.c_void_p) != 8:
            raise UnsafePath()
        if C.sizeof(StatFS) != 2168 or StatFS.f_flags_ext.offset != 2136:
            raise UnsafePath()
        symbol = "fstatfs" if machine == "arm64" else "fstatfs$INODE64"
        self.query = bind(lib, symbol, [C.c_int, C.POINTER(StatFS)], C.c_int)

    def read(self, fd):
        value = StatFS()
        checked(self.query(fd, C.byref(value)))
        return FileSystem(value.f_fstypename, value.f_flags, value.f_owner,
                          tuple(value.f_fsid), value.f_fssubtype, value.f_flags_ext)


class NativeReader:
    def __init__(self):
        if sys.platform != "darwin":
            raise UnsafePath()
        self.os = os
        self.uid = os.getuid()
        if self.uid != os.geteuid() or os.getgid() != os.getegid():
            raise UnsafePath()
        lib = C.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
        self.native_fs = NativeFS(lib, os.uname().machine)
        self.native_acl = NativeACL(lib)

    def canonical(self, path):
        return self.os.path.realpath(path, strict=True)

    def named_stat(self, name, parent):
        return self.os.stat(name, dir_fd=parent, follow_symlinks=False)

    def open(self, name, parent, directory):
        flags = self.os.O_NOFOLLOW | self.os.O_NONBLOCK | self.os.O_CLOEXEC
        # Darwin O_SEARCH includes O_DIRECTORY without ancestor data reads.
        # O_EVTONLY is not a substitute under metadata-only sandbox access.
        flags |= self.os.O_SEARCH if directory else self.os.O_EVTONLY
        return self.os.open(name, flags, dir_fd=parent)

    def close(self, fd):
        self.os.close(fd)

    def fstat(self, fd):
        return self.os.fstat(fd)

    def filesystem(self, fd):
        return self.native_fs.read(fd)

    def acl(self, fd):
        return self.native_acl.read(fd)

    def names(self, fd):
        # Only private-leaf enumeration needs a readable directory handle.
        readable = self.os.open(".", self.os.O_RDONLY | self.os.O_DIRECTORY
                                | self.os.O_NOFOLLOW | self.os.O_CLOEXEC, dir_fd=fd)
        try:
            names = []
            with self.os.scandir(readable) as entries:
                for entry in entries:
                    if len(names) == MAX_CHILDREN:
                        raise UnsafePath()
                    names.append(entry.name)
            return tuple(names)
        finally:
            self.os.close(readable)


def fingerprint(value):
    # Exclude atime, which directory enumeration may legitimately update.
    return (value.st_dev, value.st_ino, value.st_mode, value.st_uid, value.st_gid,
            value.st_nlink, value.st_size, value.st_mtime_ns, value.st_ctime_ns,
            value.st_flags)


def bounded_names(reader, fd):
    names = reader.names(fd)
    if len(names) > MAX_CHILDREN or len(set(names)) != len(names):
        raise UnsafePath()
    if any(not isinstance(name, str) or name in ("", ".", "..")
           or "/" in name or "\0" in name for name in names):
        raise UnsafePath()
    return tuple(sorted(names))


def verify_directory(path, *, private=True, reader=None):
    """Verify held root-to-leaf descriptors, then recheck names and metadata.

    --ancestor inspects only the directory chain. --private additionally
    inspects the owner-only leaf and at most ten immediate, single-link,
    owner-only regular files. No recursion or contents inspection is performed.
    Existing read-only or deny-protected objects may pass. This does not promise
    that subsequent application writes will succeed.
    """
    if (not isinstance(path, str) or not path.startswith("/") or path.startswith("//")
            or "\0" in path or posixpath.normpath(path) != path):
        raise UnsafePath()
    components = [] if path == "/" else path[1:].split("/")
    if len(components) > MAX_COMPONENTS:
        raise UnsafePath()
    reader = reader if reader is not None else NativeReader()
    if reader.canonical(path) != path:
        raise UnsafePath()
    snapshots = []
    with ExitStack() as handles:
        def inspect(name, parent, directory, private_object):
            before = reader.named_stat(name, parent)
            if not (stat.S_ISDIR(before.st_mode) if directory else stat.S_ISREG(before.st_mode)):
                raise UnsafePath()
            if before.st_nlink < 1 or (not directory and before.st_nlink != 1):
                raise UnsafePath()
            # Reject obviously unsafe objects before opening them. Actual ACL
            # checks follow on the opened descriptor, not on a pathname.
            check_access(before.st_mode, before.st_uid, ACL(), reader.uid, private=private_object)
            identity = fingerprint(before)
            fd = reader.open(name, parent, directory)
            handles.callback(reader.close, fd)
            if fingerprint(reader.fstat(fd)) != identity:
                raise UnsafePath()
            filesystem = reader.filesystem(fd)
            check_filesystem(filesystem, reader.uid)
            acl = reader.acl(fd)
            check_access(before.st_mode, before.st_uid, acl, reader.uid, private=private_object)
            if (fingerprint(reader.fstat(fd)) != identity
                    or fingerprint(reader.named_stat(name, parent)) != identity):
                raise UnsafePath()
            snapshots.append((fd, parent, name, identity, filesystem, acl))
            return fd

        parent = None
        chain = ["/"] + components
        for index, name in enumerate(chain):
            parent = inspect(name, parent, True, private and index == len(chain) - 1)
        if private:
            names = bounded_names(reader, parent)
            for name in names:
                inspect(name, parent, False, True)
            if bounded_names(reader, parent) != names:
                raise UnsafePath()
        for fd, parent_fd, name, identity, filesystem, acl in reversed(snapshots):
            if (fingerprint(reader.fstat(fd)) != identity
                    or reader.filesystem(fd) != filesystem or reader.acl(fd) != acl
                    or fingerprint(reader.fstat(fd)) != identity
                    or fingerprint(reader.named_stat(name, parent_fd)) != identity):
                raise UnsafePath()
        if reader.canonical(path) != path:
            raise UnsafePath()


def main(arguments=None):
    arguments = list(sys.argv[1:] if arguments is None else arguments)
    try:
        private = True
        if len(arguments) == 2 and arguments[0] in ("--private", "--ancestor"):
            private = arguments.pop(0) == "--private"
        if len(arguments) != 1 or not arguments[0].startswith("/"):
            raise UnsafePath()
        verify_directory(arguments[0], private=private)
        sys.stdout.write("private-path-acl: ok")
        return 0
    except (Exception, KeyboardInterrupt):
        # Do not expose paths, qualifiers, account IDs or native exceptions.
        sys.stderr.write("private-path-acl: verification failed\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
