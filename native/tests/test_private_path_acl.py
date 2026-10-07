"""Synthetic policy tests. No platform ACL changes or real private data."""
import importlib.util
import pathlib
import stat
import sys
import unittest

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location(
    "private_path_acl", pathlib.Path(__file__).resolve().parents[2] / "scripts/private-path-acl.py")
policy = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = policy
SPEC.loader.exec_module(policy)


class PolicyTests(unittest.TestCase):
    def check(self, entries=(), *, mode=0o700, owner=501, private=True, flags=0):
        policy.check_access(stat.S_IFDIR | mode, owner, policy.ACL(tuple(entries), flags),
                            501, private=private)

    def test_owner_only_mode_is_accepted_without_an_acl(self):
        policy.check_access(stat.S_IFDIR | 0o700, 501, policy.ACL(), 501, private=True)

    def test_owner_only_mode_does_not_hide_an_extended_allow(self):
        acl = policy.ACL((policy.ACE(1, 1 << 1, 0, "uid", 502),))
        with self.assertRaises(policy.UnsafePath):
            policy.check_access(stat.S_IFDIR | 0o700, 501, acl, 501, private=True)

    def test_root_owned_readable_ancestor_is_trusted(self):
        self.check(mode=0o755, owner=0, private=False)

    def test_current_account_and_root_grants_are_trusted(self):
        for uid in (0, 501):
            with self.subTest(uid=uid):
                self.check([policy.ACE(1, (1 << 1) | (1 << 12), 0, "uid", uid)])

    def test_group_identifiers_are_not_user_identifiers(self):
        for gid in (0, 501):
            with self.subTest(gid=gid), self.assertRaises(policy.UnsafePath):
                self.check([policy.ACE(1, 1 << 1, 0, "gid", gid)])

    def test_deny_only_inherited_defaults_do_not_broaden_access(self):
        self.check([policy.ACE(2, 1 << 4, (1 << 4) | (1 << 5) | (1 << 6),
                              "opaque", b"fictional-deny!!")])

    def test_untrusted_owners_are_rejected_even_with_restrictive_modes(self):
        for private in (True, False):
            with self.subTest(private=private), self.assertRaises(policy.UnsafePath):
                self.check(owner=502, private=private)

    def test_private_leaf_must_be_owned_by_process_account(self):
        with self.assertRaises(policy.UnsafePath):
            self.check(owner=0)

    def test_writable_ancestors_rejected_even_if_sticky_or_root_group(self):
        for mode in (0o775, 0o757, 0o1777):
            with self.subTest(mode=mode), self.assertRaises(policy.UnsafePath):
                self.check(mode=mode, owner=0, private=False)

    def test_private_group_or_other_bits_and_special_bits_are_rejected(self):
        for mode in (0o701, 0o710, 0o740, 0o770, 0o1700, 0o4700):
            with self.subTest(mode=mode), self.assertRaises(policy.UnsafePath):
                self.check(mode=mode)

    def test_foreign_read_search_grants_do_not_make_ancestor_writable(self):
        self.check([policy.ACE(1, (1 << 1) | (1 << 3) | (1 << 7) | (1 << 11),
                              0, "gid", 20)], mode=0o755, owner=0, private=False)

    def test_all_ancestor_modification_rights_are_rejected(self):
        for bit in (2, 4, 5, 6, 8, 10, 12, 13):
            with self.subTest(bit=bit), self.assertRaises(policy.UnsafePath):
                self.check([policy.ACE(1, 1 << bit, 0, "uid", 502)], private=False)

    def test_inherited_and_inherit_only_allows_are_not_ignored(self):
        for flags in (1 << 4, 1 << 5, 1 << 6, (1 << 5) | (1 << 8),
                      (1 << 6) | (1 << 7) | (1 << 8)):
            with self.subTest(flags=flags), self.assertRaises(policy.UnsafePath):
                self.check([policy.ACE(1, 1 << 1, flags, "uid", 502)])

    def test_denies_do_not_excuse_broad_allows(self):
        with self.assertRaises(policy.UnsafePath):
            self.check([policy.ACE(2, 1 << 1, 0, "uid", 502),
                        policy.ACE(1, 1 << 1, 0, "uid", 502)])

    def test_unknown_acl_semantics_fail_closed_even_for_root_or_deny(self):
        entries = (policy.ACE(3, 1 << 1, 0, "uid", 0),
                   policy.ACE(2, 1 << 31, 0, "uid", 0),
                   policy.ACE(1, 1 << 21, 0, "uid", 0),
                   policy.ACE(2, 1 << 1, 1 << 10, "uid", 0),
                   policy.ACE(1, 1 << 1, 0, "unknown", 0))
        for entry in entries:
            with self.subTest(entry=entry), self.assertRaises(policy.UnsafePath):
                self.check([entry])

    def test_acl_no_inherit_is_allowed_but_deferred_or_unknown_flags_are_not(self):
        self.check(flags=1 << 17)
        for flags in (1, 1 << 16, 1 << 31):
            with self.subTest(flags=flags), self.assertRaises(policy.UnsafePath):
                self.check(flags=flags)

    def test_acl_entry_count_is_bounded(self):
        deny = policy.ACE(2, 1 << 4, 0, "opaque", b"x" * 16)
        self.check([deny] * 128)
        with self.assertRaises(policy.UnsafePath):
            self.check([deny] * 129)


if __name__ == "__main__":
    unittest.main()
