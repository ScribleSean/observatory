using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;
using System.Text;
using System.Security.AccessControl;
using System.Security.Principal;

namespace WorkspaceObservatory;

internal static class RuntimeOverride
{
    private const FileSystemRights WriteRights = FileSystemRights.Write | FileSystemRights.Delete |
        FileSystemRights.DeleteSubdirectoriesAndFiles | FileSystemRights.ChangePermissions |
        FileSystemRights.TakeOwnership | (FileSystemRights)0x50000000;

    internal static string Check(string folder) => Check(folder,
        new AppIdentity(false).DefaultRuntime, new AppIdentity(true).DefaultRuntime);

    internal static string Check(string folder, params string[] realFolders)
    {
        var created = new List<string>();
        try
        {
            if (folder.StartsWith(@"\\", StringComparison.Ordinal) || folder.Contains('~') ||
                folder.Where((c, i) => c == ':' && (i != 1 || !char.IsAsciiLetter(folder[0]))).Any() ||
                !Path.IsPathFullyQualified(folder)) throw new IOException();
            var full = Normalize(folder);
            var root = Path.GetPathRoot(full) ?? throw new IOException();
            if (root.Length != 3 || root[1] != ':' || new DriveInfo(root).DriveType != DriveType.Fixed)
                throw new IOException();
            var target = new StringBuilder(32768);
            if (QueryDosDevice(root[..2], target, (uint)target.Capacity) == 0 ||
                target.ToString().StartsWith(@"\??\", StringComparison.Ordinal)) throw new IOException();
            var real = realFolders.Select(Normalize).ToArray();
            if (real.Any(path => Within(full, path) || Within(path, full))) throw new IOException();
            CheckIdentity(full, real);
            var missing = new Stack<string>();
            for (var path = full; !Directory.Exists(path); path = Path.GetDirectoryName(path) ?? throw new IOException())
                missing.Push(path);
            // An existing folder is checked in full. For a new folder only the rules it would inherit matter,
            // because the parent's owner (often SYSTEM for a profile folder) does not pass to the child.
            if (Directory.Exists(full)) CheckAccess(full);
            else CheckInherited(Ancestors(full).First(Directory.Exists));
            while (missing.TryPop(out var directory))
            {
                if (!CreateDirectory(directory, IntPtr.Zero)) throw new IOException();
                created.Add(directory);
            }
            CheckAccess(full);
            CheckIdentity(full, real);
            return ReadIdentity(full).Path;
        }
        catch
        {
            for (var i = created.Count - 1; i >= 0; i--)
            {
                try
                {
                    CheckPath(created[i]);
                    Directory.Delete(created[i], false);
                }
                catch { }
            }
            throw new IOException("Choose an absolute runtime folder outside the app data folders that you own, with no links or shared write access.");
        }
    }

    private static string Normalize(string path) => Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));
    private static bool Within(string path, string parent) => string.Equals(path, parent, StringComparison.OrdinalIgnoreCase) ||
        path.StartsWith(Path.EndsInDirectorySeparator(parent) ? parent : parent + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);

    private static IEnumerable<string> Ancestors(string full)
    {
        for (string? path = full; path is not null; path = Path.GetDirectoryName(path)) yield return path;
    }

    private static void CheckPath(string full)
    {
        foreach (var path in Ancestors(full))
        {
            var info = new DirectoryInfo(path);
            if (info.LinkTarget is not null) throw new IOException();
            var attributes = BridgeSettingsStore.Attributes(path);
            if (attributes is not null && (attributes.Value & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != FileAttributes.Directory)
                throw new IOException();
        }
    }

    private static void CheckIdentity(string full, string[] realFolders)
    {
        CheckPath(full);
        var checkedFolders = Ancestors(full).Where(Directory.Exists).Select(ReadIdentity).ToArray();
        if (checkedFolders.Length == 0) throw new IOException();
        foreach (var real in realFolders)
        {
            var protectedFolders = Ancestors(real).Where(Directory.Exists).Select(ReadIdentity).ToArray();
            if (Directory.Exists(real) && checkedFolders.Any(folder => folder.Id == protectedFolders[0].Id))
                throw new IOException();
            if (Directory.Exists(full) && protectedFolders.Any(folder => folder.Id == checkedFolders[0].Id))
                throw new IOException();
        }
    }

    internal static string FolderId(string folder) => ReadIdentity(Normalize(folder)).Id;

    private static (string Path, string Id) ReadIdentity(string path)
    {
        using var handle = CreateFile(path, 0x80, 7, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
        if (handle.IsInvalid || !ReadAttributes(handle, 9, out var attributes, 8) ||
            (attributes.Attributes & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != FileAttributes.Directory)
            throw new IOException();
        var final = new StringBuilder(32768);
        var length = GetFinalPathNameByHandle(handle, final, (uint)final.Capacity, 0);
        if (length == 0 || length >= final.Capacity || !ReadFileId(handle, 18, out var id, 24)) throw new IOException();
        var resolved = final.ToString();
        if (resolved.StartsWith(@"\\?\", StringComparison.Ordinal)) resolved = resolved[4..];
        resolved = Normalize(resolved);
        if (!string.Equals(path, resolved, StringComparison.OrdinalIgnoreCase)) throw new IOException();
        return (resolved, id.VolumeSerialNumber.ToString("X16") + id.Low.ToString("X16") + id.High.ToString("X16"));
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileIdInfo
    {
        public ulong VolumeSerialNumber;
        public ulong Low;
        public ulong High;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct AttributeTagInfo
    {
        public FileAttributes Attributes;
        public uint ReparseTag;
    }

    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", EntryPoint = "CreateDirectoryW", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateDirectory(string path, IntPtr security);
    [DllImport("kernel32.dll", EntryPoint = "QueryDosDeviceW", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern uint QueryDosDevice(string device, StringBuilder target, uint capacity);
    [DllImport("kernel32.dll", EntryPoint = "GetFinalPathNameByHandleW", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint capacity, uint flags);
    [DllImport("kernel32.dll", EntryPoint = "GetFileInformationByHandleEx", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ReadFileId(SafeFileHandle handle, int informationClass, out FileIdInfo info, uint size);
    [DllImport("kernel32.dll", EntryPoint = "GetFileInformationByHandleEx", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ReadAttributes(SafeFileHandle handle, int informationClass, out AttributeTagInfo info, uint size);
    [DllImport("kernel32.dll", EntryPoint = "GetShortPathNameW", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern uint GetShortPathName(string path, StringBuilder shortPath, uint capacity);

    [DllImport("kernel32.dll", EntryPoint = "GetLongPathNameW", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern uint GetLongPathName(string path, StringBuilder longPath, uint capacity);

    private static string SelfTestTempPath()
    {
        var path = new StringBuilder(32768);
        var length = GetLongPathName(Path.GetTempPath(), path, (uint)path.Capacity);
        if (length == 0 || length >= path.Capacity || path.ToString().Contains('~'))
            throw new IOException("Runtime self-test could not expand the temporary root to a long path without ~.");
        return path.ToString();
    }

    private static void CheckAccess(string path)
    {
        using var identity = WindowsIdentity.GetCurrent();
        if (identity.User is null) throw new IOException();
        // An elevated token creates folders owned by its default owner, often Administrators.
        CheckAccess(new DirectoryInfo(path).GetAccessControl(), identity.User, identity.Owner);
    }

    private static void CheckAccess(DirectorySecurity security, SecurityIdentifier user, SecurityIdentifier? tokenOwner = null)
    {
        var owner = security.GetOwner(typeof(SecurityIdentifier));
        var administrators = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null);
        var system = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
        var creator = new SecurityIdentifier(WellKnownSidType.CreatorOwnerSid, null);
        if (!user.Equals(owner) && !(administrators.Equals(owner) && tokenOwner is not null && administrators.Equals(tokenOwner)))
            throw new IOException();
        foreach (FileSystemAccessRule rule in security.GetAccessRules(true, true, typeof(SecurityIdentifier)))
            if (rule.AccessControlType == AccessControlType.Allow &&
                !user.Equals(rule.IdentityReference) && !Equals(owner, rule.IdentityReference) &&
                !system.Equals(rule.IdentityReference) && !administrators.Equals(rule.IdentityReference) &&
                !creator.Equals(rule.IdentityReference) &&
                (rule.FileSystemRights & WriteRights) != 0) throw new IOException();
    }

    private static void CheckInherited(string parent)
    {
        using var identity = WindowsIdentity.GetCurrent();
        if (identity.User is null) throw new IOException();
        var allowed = new[] { identity.User, new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
            new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), new SecurityIdentifier(WellKnownSidType.CreatorOwnerSid, null) };
        foreach (FileSystemAccessRule rule in new DirectoryInfo(parent).GetAccessControl().GetAccessRules(true, true, typeof(SecurityIdentifier)))
            if (rule.AccessControlType == AccessControlType.Allow && rule.InheritanceFlags.HasFlag(InheritanceFlags.ContainerInherit) &&
                !allowed.Any(sid => sid.Equals(rule.IdentityReference)) && (rule.FileSystemRights & WriteRights) != 0) throw new IOException();
    }

    internal static void SelfTest()
    {
        var root = Path.Combine(SelfTestTempPath(), "observatory-runtime-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        var real = Path.Combine(root, "real");
        var test = Path.Combine(root, "test");
        void Refused(string folder)
        {
            try { Check(folder, real, test); }
            catch (IOException) { return; }
            throw new Exception("Unsafe runtime folder accepted.");
        }
        try
        {
            try
            {
                using var identity = WindowsIdentity.GetCurrent();
                var currentUser = identity.User ?? throw new IOException("Current user SID is unavailable.");
                var rootAdministrators = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null);
                var security = new DirectorySecurity();
                security.SetAccessRuleProtection(true, false);
                security.SetOwner(identity.Owner is not null && rootAdministrators.Equals(identity.Owner) ? rootAdministrators : currentUser);
                foreach (var principal in new[] { currentUser,
                    new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), rootAdministrators })
                    security.AddAccessRule(new FileSystemAccessRule(principal, FileSystemRights.FullControl,
                        InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                        PropagationFlags.None, AccessControlType.Allow));
                new DirectoryInfo(root).SetAccessControl(security);
            }
            catch (Exception error)
            {
                throw new IOException("Runtime self-test could not set a protected ACL on its temporary root.", error);
            }
            Refused(@"\\?\" + real); Refused(@"\\.\" + real); Refused(@"\\localhost\C$\synthetic");
            Refused(real + "::$INDEX_ALLOCATION"); Refused(Path.Combine(root, "SHORT~1"));
            Refused(root);
            Refused("relative"); Refused(real); Refused(Path.Combine(real, "child")); Refused(test);
            Refused(Path.Combine(test, "child")); Refused(real.ToUpperInvariant() + Path.DirectorySeparatorChar);
            if (Directory.Exists(real) || Directory.Exists(test)) throw new Exception("Refused runtime created files.");
            Directory.CreateDirectory(real);
            var shortPath = new StringBuilder(32768);
            var shortLength = GetShortPathName(real, shortPath, (uint)shortPath.Capacity);
            if (shortLength > 0 && shortLength < shortPath.Capacity && !string.Equals(real, shortPath.ToString(), StringComparison.OrdinalIgnoreCase))
                Refused(shortPath.ToString());
            else Console.WriteLine("Runtime short-name test skipped because no different short name is available.");
            var file = Path.Combine(root, "file"); File.WriteAllText(file, "synthetic"); Refused(file);
            var link = Path.Combine(root, "link");
            bool linked = false;
            try { Directory.CreateSymbolicLink(link, root); linked = true; }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or PlatformNotSupportedException)
            { Console.WriteLine("Runtime reparse test skipped because links cannot be created."); }
            if (linked) { try { Refused(Path.Combine(link, "child")); } finally { Directory.Delete(link); } }
            var shared = Path.Combine(root, "shared"); Directory.CreateDirectory(shared);
            var info = new DirectoryInfo(shared);
            var original = info.GetAccessControl();
            var sentinel = Path.Combine(shared, "existing.txt");
            File.WriteAllText(sentinel, "synthetic");
            foreach (var propagation in new[] { PropagationFlags.None, PropagationFlags.InheritOnly })
            {
                var changed = info.GetAccessControl();
                changed.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.WorldSid, null),
                    FileSystemRights.Write, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, propagation, AccessControlType.Allow));
                try
                {
                    info.SetAccessControl(changed); Refused(shared);
                    Refused(Path.Combine(shared, "created", "child"));
                    if (Directory.Exists(Path.Combine(shared, "created"))) throw new Exception("Refused runtime left created folders.");
                    if (!Directory.Exists(shared) || File.ReadAllText(sentinel) != "synthetic")
                        throw new Exception("Runtime refusal changed existing data.");
                }
                finally { info.SetAccessControl(original); }
            }
            var genericWrite = info.GetAccessControl();
            var descriptor = new RawSecurityDescriptor(genericWrite.GetSecurityDescriptorBinaryForm(), 0);
            var acl = descriptor.DiscretionaryAcl ?? throw new Exception("Runtime test folder has no DACL.");
            var genericRule = new RawSecurityDescriptor("D:(A;OICIIO;GW;;;WD)");
            var insertion = 0;
            while (insertion < acl.Count && (acl[insertion].AceFlags & AceFlags.Inherited) == 0) insertion++;
            acl.InsertAce(insertion, genericRule.DiscretionaryAcl![0]);
            genericWrite.SetSecurityDescriptorSddlForm(descriptor.GetSddlForm(AccessControlSections.Access), AccessControlSections.Access);
            try
            {
                info.SetAccessControl(genericWrite);
                Refused(shared);
                var child = Path.Combine(shared, "generic-child");
                Refused(child);
                if (Directory.Exists(child)) throw new Exception("Generic-write refusal left a created folder.");
                if (!Directory.Exists(shared) || File.ReadAllText(sentinel) != "synthetic")
                    throw new Exception("Generic-write refusal changed existing data.");
            }
            finally { info.SetAccessControl(original); }
            var user = new SecurityIdentifier("S-1-5-21-100-200-300-1001");
            var administrators = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null);
            var world = new SecurityIdentifier(WellKnownSidType.WorldSid, null);
            DirectorySecurity Security(SecurityIdentifier owner)
            {
                var security = new DirectorySecurity();
                security.SetOwner(owner);
                return security;
            }
            void AccessRefused(DirectorySecurity security, SecurityIdentifier tokenOwner)
            {
                try { CheckAccess(security, user, tokenOwner); }
                catch (IOException) { return; }
                throw new Exception("Unsafe runtime ACL accepted.");
            }
            AccessRefused(Security(administrators), user);
            CheckAccess(Security(administrators), user, administrators);
            CheckAccess(Security(user), user, user);
            AccessRefused(Security(world), user);
            AccessRefused(Security(world), world);
            var foreignWriter = Security(user);
            foreignWriter.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier("S-1-5-21-100-200-300-1002"),
                FileSystemRights.Write, AccessControlType.Allow));
            AccessRefused(foreignWriter, user);
            foreach (var type in new[] { WellKnownSidType.WorldSid, WellKnownSidType.AuthenticatedUserSid,
                WellKnownSidType.BuiltinUsersSid, WellKnownSidType.InteractiveSid, WellKnownSidType.BuiltinGuestsSid })
            {
                foreach (var right in new[] { FileSystemRights.WriteData, FileSystemRights.AppendData,
                    FileSystemRights.WriteAttributes, FileSystemRights.WriteExtendedAttributes, FileSystemRights.Delete,
                    FileSystemRights.DeleteSubdirectoriesAndFiles, FileSystemRights.ChangePermissions, FileSystemRights.TakeOwnership })
                {
                    var security = Security(user);
                    security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(type, null), right, AccessControlType.Allow));
                    AccessRefused(security, user);
                }
            }
            var inheritOnly = Security(user);
            inheritOnly.AddAccessRule(new FileSystemAccessRule(world, FileSystemRights.Write,
                InheritanceFlags.ContainerInherit, PropagationFlags.InheritOnly, AccessControlType.Allow));
            AccessRefused(inheritOnly, user);
            foreach (var genericRight in new[] { "GW", "GA" })
            {
                var security = Security(user);
                security.SetSecurityDescriptorSddlForm($"D:(A;OICIIO;{genericRight};;;WD)", AccessControlSections.Access);
                AccessRefused(security, user);
            }
            foreach (var principal in new[] { user, administrators, new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null) })
            {
                var security = Security(user);
                security.AddAccessRule(new FileSystemAccessRule(principal, FileSystemRights.FullControl, AccessControlType.Allow));
                CheckAccess(security, user, user);
            }
            var denied = Security(user);
            denied.AddAccessRule(new FileSystemAccessRule(world, FileSystemRights.FullControl, AccessControlType.Deny));
            CheckAccess(denied, user, user);
            var fresh = Path.Combine(root, "fresh");
            if (Check(fresh, real, test) != fresh || !FirstRunSetup.Prepare(fresh)) throw new Exception("Fresh runtime rejected.");
            var suffix = AppIdentity.RuntimeSuffix(fresh);
            if (suffix.Length != 49 || suffix[0] != '.' || !suffix[1..].All(Uri.IsHexDigit))
                throw new Exception("Runtime identity is not a volume and file ID.");
            var alternate = Check(fresh.ToUpperInvariant() + Path.DirectorySeparatorChar, real, test);
            if (suffix != AppIdentity.RuntimeSuffix(alternate))
                throw new Exception("Runtime identity depends on path spelling.");
            var marker = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(Path.Combine(fresh, "setup-state.json")))!;
            var config = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(Path.Combine(fresh, "collector.config.json")))!.AsObject();
            if (marker["completed"]!.GetValue<bool>() || config.Count != 5 || config.Any(item => item.Value!.GetValue<bool>()))
                throw new Exception("Fresh runtime did not retain pending consent.");
        }
        finally { Directory.Delete(root, true); }
        Console.WriteLine("Runtime override guards passed.");
    }
}
