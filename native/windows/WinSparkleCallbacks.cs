using System.Runtime.InteropServices;

namespace WorkspaceObservatory;

// Keep this object alive until native callbacks are unregistered and updater
// threads have stopped. Readiness must be thread-safe and shutdown must post a
// request, never synchronously wait on the UI or reenter WinSparkle.
internal sealed class WinSparkleCallbacks
{
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    internal delegate int Installer([MarshalAs(UnmanagedType.LPWStr)] string path);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    internal delegate int Ready();
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    internal delegate void Shutdown();

    internal Installer Install { get; }
    internal Ready CanShutdown { get; }
    internal Shutdown RequestShutdown { get; }
    private int shutdownRequested;

    internal WinSparkleCallbacks(UpdateInstallerCallback handoff, Func<bool> ready, Action requestShutdown)
    {
        ArgumentNullException.ThrowIfNull(handoff);
        ArgumentNullException.ThrowIfNull(ready);
        ArgumentNullException.ThrowIfNull(requestShutdown);
        Install = handoff.Handle;
        CanShutdown = () => { try { return ready() ? 1 : 0; } catch { return 0; } };
        RequestShutdown = () =>
        {
            if (!handoff.Accepted || Interlocked.CompareExchange(ref shutdownRequested, 1, 0) != 0) return;
            try { requestShutdown(); } catch { /* Never unwind a managed exception into native code. */ }
        };
    }

    internal static void SelfTest()
    {
        var path = Path.Combine(Path.GetTempPath(), "synthetic-voice-\u03bb.zip");
        var shutdowns = 0;
        var callbacks = new WinSparkleCallbacks(new UpdateInstallerCallback(p => p == path), () => true, () => shutdowns++);
        var install = Marshal.GetDelegateForFunctionPointer<Installer>(Marshal.GetFunctionPointerForDelegate(callbacks.Install));
        var ready = Marshal.GetDelegateForFunctionPointer<Ready>(Marshal.GetFunctionPointerForDelegate(callbacks.CanShutdown));
        var shutdown = Marshal.GetDelegateForFunctionPointer<Shutdown>(Marshal.GetFunctionPointerForDelegate(callbacks.RequestShutdown));
        GC.Collect(); GC.WaitForPendingFinalizers();
        shutdown();
        if (shutdowns != 0 || ready() != 1 || install(path) != 1) throw new Exception("Callback ordering or path marshalling failed.");
        shutdown(); shutdown();
        if (shutdowns != 1) throw new Exception("Shutdown request was repeated.");
        var refused = new WinSparkleCallbacks(new UpdateInstallerCallback(_ => throw new IOException("Synthetic uncertain launch")),
            () => throw new IOException("Synthetic busy state"), () => shutdowns++);
        if (refused.CanShutdown() != 0 || refused.Install(path) != -1) throw new Exception("Callback failure was accepted.");
        refused.RequestShutdown();
        if (shutdowns != 1) throw new Exception("Uncertain handoff requested shutdown.");
        GC.KeepAlive(callbacks);
        Console.WriteLine("Updater callback delegates retain Unicode paths, contain exceptions and gate shutdown on accepted handoff.");
    }
}
