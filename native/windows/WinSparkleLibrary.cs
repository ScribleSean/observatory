using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace WorkspaceObservatory;

// A pinned library load is separate from updater initialization. This boundary
// never configures a feed, starts background checks or reads signing secrets.
internal sealed class WinSparkleLibrary : IDisposable
{
    private const string ExpectedSha256 = "9b43b1c16ee39fb9a91b5bd75138767898779510e0836be2919250607cdbe8ab";
    private nint handle;
    private readonly FileStream file;

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int SetPublicKey([MarshalAs(UnmanagedType.LPUTF8Str)] string key);

    internal WinSparkleLibrary(string libraryPath)
    {
        if (!Path.IsPathFullyQualified(libraryPath) || Path.GetFullPath(libraryPath) != libraryPath ||
            Path.GetFileName(libraryPath) != "WinSparkle.dll")
            throw new IOException("Canonical updater library path required.");
        for (var directory = new DirectoryInfo(Path.GetDirectoryName(libraryPath)!); directory is not null; directory = directory.Parent)
            if (!directory.Exists || directory.Attributes.HasFlag(FileAttributes.ReparsePoint))
                throw new IOException("Unlinked updater library directories required.");
        if (File.GetAttributes(libraryPath).HasFlag(FileAttributes.ReparsePoint))
            throw new IOException("Linked updater library refused.");
        file = new FileStream(libraryPath, FileMode.Open, FileAccess.Read, FileShare.Read);
        try
        {
            if (file.Length != 2886144 || Convert.ToHexString(SHA256.HashData(file)).ToLowerInvariant() != ExpectedSha256)
                throw new IOException("Updater library does not match the pinned runtime.");
            // Absolute primary DLL, system-only dependency lookup. Never search
            // the current directory, PATH or a downloaded candidate directory.
            handle = NativeLibrary.Load(libraryPath, typeof(WinSparkleLibrary).Assembly, DllImportSearchPath.System32);
        }
        catch { file.Dispose(); throw; }
    }

    private T Export<T>(string name) where T : Delegate
    {
        ObjectDisposedException.ThrowIf(handle == 0, this);
        return Marshal.GetDelegateForFunctionPointer<T>(NativeLibrary.GetExport(handle, name));
    }

    internal void CheckBindings()
    {
        ObjectDisposedException.ThrowIf(handle == 0, this);
        foreach (var export in new[] { "win_sparkle_init", "win_sparkle_cleanup", "win_sparkle_set_appcast_url",
            "win_sparkle_set_app_details", "win_sparkle_set_app_build_version", "win_sparkle_set_automatic_check_for_updates",
            "win_sparkle_set_user_run_installer_callback", "win_sparkle_set_can_shutdown_callback",
            "win_sparkle_set_shutdown_request_callback", "win_sparkle_check_update_with_ui" })
            _ = NativeLibrary.GetExport(handle, export);
        var setKey = Export<SetPublicKey>("win_sparkle_set_eddsa_public_key");
        if (setKey("invalid") != 0) throw new IOException("Updater accepted an invalid public key.");
        // Public RFC 8032 test-vector key, never a production release key.
        var synthetic = Convert.ToBase64String(Convert.FromHexString("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"));
        if (setKey(synthetic) != 1) throw new IOException("Updater rejected a valid synthetic public key.");
    }

    public void Dispose()
    {
        // No initialized updater may use this probe-only wrapper yet.
        if (handle != 0) { NativeLibrary.Free(handle); handle = 0; }
        file.Dispose();
    }
}
