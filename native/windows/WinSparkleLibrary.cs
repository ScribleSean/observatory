using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace WorkspaceObservatory;

// Initialization requires explicit trust and callbacks. Once initialized, native
// code and delegates remain rooted until process exit, including after cleanup.
internal sealed class WinSparkleLibrary : IDisposable
{
    private const string ExpectedSha256 = "9b43b1c16ee39fb9a91b5bd75138767898779510e0836be2919250607cdbe8ab";
    private static int owned;
    private static WinSparkleLibrary? processOwner;
    private readonly int ownerThread = Environment.CurrentManagedThreadId;
    private nint handle;
    private readonly FileStream file;
    private WinSparkleCallbacks? callbacks;
    private bool trusted, callbacksAttached, initialized, stopped;

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void Invoke();
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void SetInt(int value);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void SetWide([MarshalAs(UnmanagedType.LPWStr)] string value);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void SetDetails([MarshalAs(UnmanagedType.LPWStr)] string company,
        [MarshalAs(UnmanagedType.LPWStr)] string app, [MarshalAs(UnmanagedType.LPWStr)] string version);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int SetPublicKey([MarshalAs(UnmanagedType.LPUTF8Str)] string key);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void SetUtf8([MarshalAs(UnmanagedType.LPUTF8Str)] string value);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void SetCallback(nint callback);

    internal void AttachCallbacks(WinSparkleCallbacks value)
    {
        EnsureConfigurable();
        ArgumentNullException.ThrowIfNull(value);
        if (callbacks is not null) throw new InvalidOperationException("Updater callbacks are already attached.");
        // Retain all delegates even if a later registration fails.
        callbacks = value;
        Export<SetCallback>("win_sparkle_set_user_run_installer_callback")(Marshal.GetFunctionPointerForDelegate(value.Install));
        Export<SetCallback>("win_sparkle_set_can_shutdown_callback")(Marshal.GetFunctionPointerForDelegate(value.CanShutdown));
        Export<SetCallback>("win_sparkle_set_shutdown_request_callback")(Marshal.GetFunctionPointerForDelegate(value.RequestShutdown));
        callbacksAttached = true;
    }

    internal void ConfigureTrust(UpdateTrust trust)
    {
        EnsureConfigurable();
        ArgumentNullException.ThrowIfNull(trust);
        trusted = false;
        if (Export<SetPublicKey>("win_sparkle_set_eddsa_public_key")(trust.PublicKey) != 1)
            throw new IOException("Updater did not accept the installed public key.");
        Export<SetUtf8>("win_sparkle_set_appcast_url")(UpdateTrust.Feed);
        trusted = true;
    }

    internal void Initialize(string version, long build) => Initialize(version, build, @"Software\Observatory\Updates");

    private void Initialize(string version, long build, string registryPath)
    {
        EnsureConfigurable();
        if (!trusted || !callbacksAttached) throw new InvalidOperationException("Updater trust and callbacks are required.");
        if (!Version.TryParse(version, out var parsed) || parsed.ToString() != version || build <= 0)
            throw new ArgumentException("Canonical release version and positive build required.");
        Export<SetUtf8>("win_sparkle_set_registry_path")(registryPath);
        Export<SetDetails>("win_sparkle_set_app_details")("Observatory", "Observatory", version);
        Export<SetWide>("win_sparkle_set_app_build_version")(build.ToString(System.Globalization.CultureInfo.InvariantCulture));
        // User-initiated checks only. Do not inherit automatic-check consent.
        Export<SetInt>("win_sparkle_set_automatic_check_for_updates")(0);
        using (var settings = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(registryPath))
            if (settings?.GetValue("CheckForUpdates") is not string automatic || automatic != "0")
                throw new IOException("Updater manual-only settings were not saved.");
        var start = Export<Invoke>("win_sparkle_init");
        // Retain before entering native code, even if initialization fails.
        processOwner = this;
        initialized = true;
        start();
    }

    internal void CheckForUpdates()
    {
        EnsureOwner();
        if (!initialized) throw new InvalidOperationException("Updater is not initialized.");
        Export<Invoke>("win_sparkle_check_update_with_ui")();
    }

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
        if (Interlocked.CompareExchange(ref owned, 1, 0) != 0)
        {
            file.Dispose();
            throw new InvalidOperationException("Only one updater library owner is allowed per process.");
        }
        try
        {
            if (file.Length != 2886144 || Convert.ToHexString(SHA256.HashData(file)).ToLowerInvariant() != ExpectedSha256)
                throw new IOException("Updater library does not match the pinned runtime.");
            // Absolute primary DLL, system-only dependency lookup. Never search
            // the current directory, PATH or a downloaded candidate directory.
            handle = NativeLibrary.Load(libraryPath, typeof(WinSparkleLibrary).Assembly, DllImportSearchPath.System32);
        }
        catch { file.Dispose(); Volatile.Write(ref owned, 0); throw; }
    }

    private void EnsureOwner()
    {
        if (Environment.CurrentManagedThreadId != ownerThread)
            throw new InvalidOperationException("Updater configuration must remain on its owning thread.");
        ObjectDisposedException.ThrowIf(handle == 0 || stopped, this);
    }

    private void EnsureConfigurable()
    {
        EnsureOwner();
        if (initialized) throw new InvalidOperationException("Initialized updater configuration is immutable.");
    }

    private T Export<T>(string name) where T : Delegate
    {
        EnsureOwner();
        return Marshal.GetDelegateForFunctionPointer<T>(NativeLibrary.GetExport(handle, name));
    }

    internal void CheckBindings()
    {
        EnsureConfigurable();
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
        var config = System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(new {
            schema = 1, platform = "windows-x64", feedUrl = UpdateTrust.Feed, publicKey = synthetic });
        ConfigureTrust(UpdateTrust.Parse(config));
        AttachCallbacks(new WinSparkleCallbacks(new UpdateInstallerCallback(_ => false), () => false, () => { }));
    }

    public void Dispose()
    {
        if (stopped) return;
        if (handle != 0)
        {
            EnsureOwner();
            if (initialized)
            {
                var cleanup = Export<Invoke>("win_sparkle_cleanup");
                stopped = true;
                cleanup();
                // Workers can still invoke callbacks. Keep processOwner, the
                // native handle, file lease and ownership reservation alive.
                return;
            }
            if (callbacks is not null)
            {
                foreach (var name in new[] { "win_sparkle_set_user_run_installer_callback", "win_sparkle_set_can_shutdown_callback",
                    "win_sparkle_set_shutdown_request_callback" }) Export<SetCallback>(name)(0);
            }
            NativeLibrary.Free(handle); handle = 0;
            GC.KeepAlive(callbacks); callbacks = null;
            file.Dispose();
            Volatile.Write(ref owned, 0);
        }
    }

    internal void CheckIsolatedLifecycle()
    {
        var registry = @"Software\ObservatoryUpdaterTest-" + Guid.NewGuid().ToString("N");
        using var hive = Microsoft.Win32.RegistryKey.OpenBaseKey(Microsoft.Win32.RegistryHive.CurrentUser, Microsoft.Win32.RegistryView.Default);
        using (var existing = hive.OpenSubKey(registry))
            if (existing is not null) throw new IOException("Synthetic updater registry path already exists.");
        try
        {
            try { Initialize("0.0.1", 1, registry); throw new IOException("Untrusted updater initialized."); }
            catch (InvalidOperationException) { }
            try { CheckForUpdates(); throw new IOException("Uninitialized updater accepted a check."); }
            catch (InvalidOperationException) { }
            CheckBindings();
            Initialize("0.0.1", 1, registry);
            using (var settings = hive.OpenSubKey(registry))
                if (Convert.ToInt32(settings?.GetValue("CheckForUpdates") ?? -1) != 0 || settings?.GetValue("UpdateTempDir") is not null)
                    throw new IOException("Synthetic updater settings are not isolated and manual-only.");
            try { Initialize("0.0.1", 1, registry); throw new IOException("Updater initialized twice."); }
            catch (InvalidOperationException) { }
            Dispose();
            if (processOwner != this || handle == 0 || callbacks is null || Volatile.Read(ref owned) != 1)
                throw new IOException("Initialized updater lifetime was released prematurely.");
            try { CheckForUpdates(); throw new IOException("Stopped updater accepted a check."); }
            catch (ObjectDisposedException) { }
        }
        finally { Dispose(); hive.DeleteSubKeyTree(registry, throwOnMissingSubKey: false); }
    }
}
