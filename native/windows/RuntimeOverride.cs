using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;
using System.Text;
using System.Security.AccessControl;
using System.Security.Principal;

namespace WorkspaceObservatory;

internal static class RuntimeOverride
{
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
            while (missing.TryPop(out var directory))
            {
                // Record only directories this call created.
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
            // A missing child's existing parent can be shared with the real folder.
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
        if (!user.Equals(owner) && (tokenOwner is null || !tokenOwner.Equals(owner))) throw new IOException();
        var broad = new[] { WellKnownSidType.WorldSid, WellKnownSidType.AuthenticatedUserSid, WellKnownSidType.BuiltinUsersSid }
            .Select(type => new SecurityIdentifier(type, null)).ToArray();
        const FileSystemRights writes = FileSystemRights.Write | FileSystemRights.Delete | FileSystemRights.DeleteSubdirectoriesAndFiles |
            FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership;
        foreach (FileSystemAccessRule rule in security.GetAccessRules(true, true, typeof(SecurityIdentifier)))
            if (rule.AccessControlType == AccessControlType.Allow && broad.Any(sid => sid.Equals(rule.IdentityReference)) &&
                (rule.FileSystemRights & writes) != 0) throw new IOException();
    }

    internal static void SelfTest()
    {
        var root = Path.Combine(Path.GetTempPath(), "observatory-runtime-" + Guid.NewGuid().ToString("N"));
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
            var changed = info.GetAccessControl();
            changed.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.WorldSid, null),
                FileSystemRights.Write, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
            try
            {
                info.SetAccessControl(changed); Refused(shared);
                Refused(Path.Combine(shared, "created", "child"));
                if (Directory.Exists(Path.Combine(shared, "created"))) throw new Exception("Refused runtime left created folders.");
            }
            finally { info.SetAccessControl(original); }
            using var identity = WindowsIdentity.GetCurrent();
            var foreignOwner = new DirectorySecurity();
            foreignOwner.SetOwner(new SecurityIdentifier(WellKnownSidType.WorldSid, null));
            bool ownerRefused = false;
            try { CheckAccess(foreignOwner, identity.User!); } catch (IOException) { ownerRefused = true; }
            if (!ownerRefused) throw new Exception("Foreign runtime owner accepted.");
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
