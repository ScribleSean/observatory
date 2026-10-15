using System.Security.AccessControl;
using System.Security.Principal;

namespace WorkspaceObservatory;

internal static class RuntimeOverride
{
    internal static string Check(string folder) => Check(folder,
        new AppIdentity(false).DefaultRuntime, new AppIdentity(true).DefaultRuntime);

    internal static string Check(string folder, params string[] realFolders)
    {
        try
        {
            if (!Path.IsPathFullyQualified(folder)) throw new IOException();
            var full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(folder));
            foreach (var realFolder in realFolders)
            {
                var real = Path.TrimEndingDirectorySeparator(Path.GetFullPath(realFolder));
                if (string.Equals(full, real, StringComparison.OrdinalIgnoreCase) ||
                    full.StartsWith(Path.EndsInDirectorySeparator(real) ? real : real + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                    throw new IOException();
            }
            CheckPath(full);
            if (Directory.Exists(full)) CheckAccess(full);
            else
            {
                Directory.CreateDirectory(full);
                CheckPath(full);
                CheckAccess(full);
            }
            return full;
        }
        catch
        {
            throw new IOException("Choose an absolute runtime folder outside the app data folders that you own, with no links or shared write access.");
        }
    }

    private static void CheckPath(string full)
    {
        for (string? path = full; path is not null; path = Path.GetDirectoryName(path))
        {
            var info = new DirectoryInfo(path);
            if (info.LinkTarget is not null) throw new IOException();
            var attributes = BridgeSettingsStore.Attributes(path);
            if (attributes is not null && (attributes.Value & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != FileAttributes.Directory)
                throw new IOException();
        }
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
            Refused("relative"); Refused(real); Refused(Path.Combine(real, "child")); Refused(test);
            Refused(Path.Combine(test, "child")); Refused(real.ToUpperInvariant() + Path.DirectorySeparatorChar);
            if (Directory.Exists(real) || Directory.Exists(test)) throw new Exception("Refused runtime created files.");
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
                FileSystemRights.Write, AccessControlType.Allow));
            try { info.SetAccessControl(changed); Refused(shared); }
            finally { info.SetAccessControl(original); }
            using var identity = WindowsIdentity.GetCurrent();
            var foreignOwner = new DirectorySecurity();
            foreignOwner.SetOwner(new SecurityIdentifier(WellKnownSidType.WorldSid, null));
            bool ownerRefused = false;
            try { CheckAccess(foreignOwner, identity.User!); } catch (IOException) { ownerRefused = true; }
            if (!ownerRefused) throw new Exception("Foreign runtime owner accepted.");
            var fresh = Path.Combine(root, "fresh");
            if (Check(fresh, real, test) != fresh || !FirstRunSetup.Prepare(fresh)) throw new Exception("Fresh runtime rejected.");
            var marker = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(Path.Combine(fresh, "setup-state.json")))!;
            var config = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(Path.Combine(fresh, "collector.config.json")))!.AsObject();
            if (marker["completed"]!.GetValue<bool>() || config.Count != 5 || config.Any(item => item.Value!.GetValue<bool>()))
                throw new Exception("Fresh runtime did not retain pending consent.");
        }
        finally { Directory.Delete(root, true); }
        Console.WriteLine("Runtime override guards passed.");
    }
}
