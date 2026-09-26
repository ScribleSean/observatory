using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace WorkspaceObservatory;

// One invocation owns one job. No provider discovery or sign-in occurs here.
// JOB_LIST assigns the job before any child thread runs (Windows 10+).
// https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute
// https://learn.microsoft.com/windows/win32/procthread/job-objects
internal static class AntigravityUsageProcess
{
    private static readonly string[] Arguments = ["--print", "/usage", "--print-timeout", "20s", "--output-format", "json"];
    internal const int TimeoutMilliseconds = 25000, OutputLimit = 65536, CleanupMilliseconds = 3000;

    internal static Task<string> Read(string executable, CancellationToken cancellation) =>
        RunContained(executable, Arguments, TimeoutMilliseconds, OutputLimit, cancellation);

    // The caller writes byte 1 to a dedicated stdin pipe and keeps it open.
    // EOF, extra input, or caller death cancels the read. The provider receives
    // NUL as stdin and cannot inherit this pipe or the job handle.
    internal static Task<int> Command(string executable) => WithCallerLifetime(token => Read(executable, token));

    internal static async Task<int> WithCallerLifetime(Func<CancellationToken, Task<string>> read)
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10) || !Console.IsInputRedirected) return 1;
        using var lifetime = new CancellationTokenSource();
        var ready = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var watcher = new Thread(() =>
        {
            try
            {
                var input = Console.OpenStandardInput();
                var valid = input.ReadByte() == 1;
                ready.TrySetResult(valid);
                if (valid) _ = input.ReadByte();
            }
            catch { ready.TrySetResult(false); }
            finally { try { lifetime.Cancel(); } catch (ObjectDisposedException) { } }
        }) { IsBackground = true, Name = "Allowance caller lifetime" };
        watcher.Start();
        try
        {
            if (!await ready.Task.WaitAsync(TimeSpan.FromSeconds(2))) return 1;
            var output = await read(lifetime.Token);
            lifetime.Token.ThrowIfCancellationRequested();
            // A caller that stops draining stdout must not pin this helper.
            // The job has already been emptied. Process exit stops this worker.
            var bytes = Encoding.UTF8.GetBytes(output);
            await Task.Run(() => Console.OpenStandardOutput().Write(bytes))
                .WaitAsync(TimeSpan.FromSeconds(2), lifetime.Token);
            return 0;
        }
        catch { return 1; }
    }

    // Separate fixture entrypoints supply fictional processes. Production uses
    // Read above and cannot accept arbitrary command arguments or limits.
    internal static async Task<string> RunContained(string executable, IReadOnlyList<string> arguments,
        int timeoutMilliseconds, int outputLimit, CancellationToken cancellation, bool invalidJobForTest = false)
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10) || !Path.IsPathFullyQualified(executable) ||
            !executable.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) || executable.Length > 4096 ||
            executable.IndexOfAny(['\0', '\r', '\n']) >= 0 ||
            (File.GetAttributes(executable) & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0 ||
            timeoutMilliseconds <= 0 || timeoutMilliseconds > TimeoutMilliseconds || outputLimit <= 0 || outputLimit > OutputLimit)
            throw new InvalidOperationException("Allowance executable unavailable.");
        cancellation.ThrowIfCancellationRequested();
        using var job = Native.CreateJobObject(IntPtr.Zero, null);
        if (job.IsInvalid) throw new Win32Exception();
        var limits = new Native.ExtendedLimits { Basic = new Native.BasicLimits { Flags = 0x2000 } }; // KILL_ON_JOB_CLOSE
        if (!Native.SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<Native.ExtendedLimits>()))
            throw new Win32Exception();
        var security = new Native.SecurityAttributes { Length = Marshal.SizeOf<Native.SecurityAttributes>(), Inherit = true };
        if (!Native.CreatePipe(out var pipeRead, out var pipeWrite, ref security, 0)) throw new Win32Exception();
        using var readHandle = pipeRead;
        using var writeHandle = pipeWrite;
        if (!Native.SetHandleInformation(readHandle, 1, 0)) throw new Win32Exception();
        using var nul = Native.CreateFile("NUL", 0xc0000000, 3, ref security, 3, 0, IntPtr.Zero);
        if (nul.IsInvalid) throw new Win32Exception();
        using var attributes = new Attributes(invalidJobForTest ? IntPtr.Zero : job.DangerousGetHandle(),
            [writeHandle.DangerousGetHandle(), nul.DangerousGetHandle()]);
        var startup = new Native.StartupInfoEx
        {
            Startup = new Native.StartupInfo { Size = Marshal.SizeOf<Native.StartupInfoEx>(), Flags = 0x100,
                Input = nul.DangerousGetHandle(), Output = writeHandle.DangerousGetHandle(), Error = nul.DangerousGetHandle() },
            Attributes = attributes.Pointer
        };
        cancellation.ThrowIfCancellationRequested();
        var commandLine = new StringBuilder(string.Join(" ", new[] { executable }.Concat(arguments).Select(Quote)));
        if (!Native.CreateProcess(executable, commandLine, IntPtr.Zero, IntPtr.Zero, true,
            0x08080000, IntPtr.Zero, null, ref startup, out var created)) // NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT
            throw new Win32Exception();
        using var process = new SafeFileHandle(created.Process, true);
        using var thread = new SafeFileHandle(created.Thread, true);
        using var output = new MemoryStream();
        var buffer = new byte[4096];
        try
        {
            writeHandle.Dispose();
            nul.Dispose();
            var elapsed = Stopwatch.StartNew();
            while (true)
            {
                cancellation.ThrowIfCancellationRequested();
                ReadAvailable(readHandle, output, buffer, outputLimit);
                var state = Native.WaitForSingleObject(process, 0);
                if (state == 0) break;
                if (state != 258 || elapsed.ElapsedMilliseconds >= timeoutMilliseconds)
                    throw new TimeoutException("Allowance command unavailable.");
                await Task.Delay(10, cancellation);
            }
            if (!Native.GetExitCodeProcess(process, out var exit) || exit != 0)
                throw new InvalidOperationException("Allowance command unavailable.");
        }
        finally
        {
            // Root exit is independent of pipe EOF: descendants can retain the
            // pipe after the CLI exits. Terminate the job on success as well.
            try { await StopJob(job); }
            finally { job.Dispose(); }
        }
        // All owned writers are gone. Drain bounded buffered output to EOF.
        // There is exactly one reader, never a concurrent pending pipe read.
        var drain = Stopwatch.StartNew();
        while (!ReadAvailable(readHandle, output, buffer, outputLimit))
        {
            cancellation.ThrowIfCancellationRequested();
            if (drain.ElapsedMilliseconds >= CleanupMilliseconds)
                throw new TimeoutException("Allowance output cleanup unavailable.");
            await Task.Delay(10, cancellation);
        }
        cancellation.ThrowIfCancellationRequested();
        return new UTF8Encoding(false, true).GetString(output.ToArray());
    }

    private static bool ReadAvailable(SafeFileHandle pipe, MemoryStream output, byte[] buffer, int limit)
    {
        if (!Native.PeekNamedPipe(pipe, IntPtr.Zero, 0, IntPtr.Zero, out var available, IntPtr.Zero))
        {
            if (Marshal.GetLastWin32Error() == 109) return true; // ERROR_BROKEN_PIPE
            throw new Win32Exception();
        }
        if (available == 0) return false;
        // Read only bytes already present. No other reader can consume them.
        if (!Native.ReadFile(pipe, buffer, Math.Min((uint)buffer.Length, available), out var count, IntPtr.Zero))
            throw new Win32Exception();
        if (count == 0 || output.Length + count > limit) throw new IOException("Allowance output limit exceeded.");
        output.Write(buffer, 0, checked((int)count));
        return false;
    }

    private static async Task StopJob(SafeFileHandle job)
    {
        if (!Native.TerminateJobObject(job, 1)) throw new Win32Exception();
        var elapsed = Stopwatch.StartNew();
        do
        {
            if (!Native.QueryInformationJobObject(job, 1, out var accounting, (uint)Marshal.SizeOf<Native.Accounting>(), IntPtr.Zero))
                throw new Win32Exception();
            if (accounting.ActiveProcesses == 0) return;
            await Task.Delay(20);
        } while (elapsed.ElapsedMilliseconds < CleanupMilliseconds);
        throw new TimeoutException("Allowance cleanup unavailable.");
    }

    internal static string Quote(string value)
    {
        if (value.IndexOf('\0') >= 0) throw new ArgumentException("Invalid process argument.");
        var result = new StringBuilder("\"");
        var slashes = 0;
        foreach (var character in value)
        {
            if (character == '\\') { slashes++; continue; }
            result.Append('\\', character == '"' ? slashes * 2 + 1 : slashes);
            result.Append(character); slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }

    private sealed class Attributes : IDisposable
    {
        internal IntPtr Pointer;
        private IntPtr jobPointer, handlePointer;
        private bool initialized;
        internal Attributes(IntPtr job, IntPtr[] handles)
        {
            try
            {
                nuint size = 0;
                _ = Native.InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
                if (size == 0 || size > 65536) throw new Win32Exception();
                Pointer = Marshal.AllocHGlobal(checked((int)size));
                if (!Native.InitializeProcThreadAttributeList(Pointer, 2, 0, ref size)) throw new Win32Exception();
                initialized = true;
                jobPointer = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobPointer, job);
                handlePointer = Marshal.AllocHGlobal(IntPtr.Size * handles.Length); Marshal.Copy(handles, 0, handlePointer, handles.Length);
                if (!Native.UpdateProcThreadAttribute(Pointer, 0, 0x2000d, jobPointer, (nuint)IntPtr.Size, IntPtr.Zero, IntPtr.Zero) ||
                    !Native.UpdateProcThreadAttribute(Pointer, 0, 0x20002, handlePointer, (nuint)(IntPtr.Size * handles.Length), IntPtr.Zero, IntPtr.Zero))
                    throw new Win32Exception();
            }
            catch { Dispose(); throw; }
        }
        public void Dispose()
        {
            if (initialized) Native.DeleteProcThreadAttributeList(Pointer);
            Marshal.FreeHGlobal(Pointer); Marshal.FreeHGlobal(jobPointer); Marshal.FreeHGlobal(handlePointer);
            initialized = false; Pointer = jobPointer = handlePointer = IntPtr.Zero;
        }
    }

    private static class Native
    {
        [StructLayout(LayoutKind.Sequential)] internal struct SecurityAttributes { internal int Length; internal IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] internal bool Inherit; }
        [StructLayout(LayoutKind.Sequential)] internal struct BasicLimits { internal long ProcessTime, JobTime; internal uint Flags; internal nuint MinimumWorkingSet, MaximumWorkingSet; internal uint ActiveLimit; internal nuint Affinity; internal uint Priority, Scheduling; }
        [StructLayout(LayoutKind.Sequential)] internal struct IoCounters { internal ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; }
        [StructLayout(LayoutKind.Sequential)] internal struct ExtendedLimits { internal BasicLimits Basic; internal IoCounters Io; internal nuint ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory; }
        [StructLayout(LayoutKind.Sequential)] internal struct Accounting { internal long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime; internal uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses; }
        [StructLayout(LayoutKind.Sequential)] internal struct StartupInfo { internal int Size; internal IntPtr Reserved, Desktop, Title; internal uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags; internal ushort Show, ReservedSize; internal IntPtr ReservedBytes, Input, Output, Error; }
        [StructLayout(LayoutKind.Sequential)] internal struct StartupInfoEx { internal StartupInfo Startup; internal IntPtr Attributes; }
        [StructLayout(LayoutKind.Sequential)] internal struct ProcessInformation { internal IntPtr Process, Thread; internal uint ProcessId, ThreadId; }
        [DllImport("kernel32.dll", EntryPoint = "CreateJobObjectW", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern SafeFileHandle CreateJobObject(IntPtr security, string? name);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetInformationJobObject(SafeFileHandle job, int information, ref ExtendedLimits limits, uint length);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool QueryInformationJobObject(SafeFileHandle job, int information, out Accounting accounting, uint length, IntPtr returned);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool TerminateJobObject(SafeFileHandle job, uint exitCode);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool CreatePipe(out SafeFileHandle read, out SafeFileHandle write, ref SecurityAttributes security, uint size);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetHandleInformation(SafeFileHandle handle, uint mask, uint flags);
        [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern SafeFileHandle CreateFile(string name, uint access, uint share, ref SecurityAttributes security, uint disposition, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref nuint size);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, nuint attribute, IntPtr value, nuint size, IntPtr previous, IntPtr returned);
        [DllImport("kernel32.dll")] internal static extern void DeleteProcThreadAttributeList(IntPtr list);
        [DllImport("kernel32.dll", EntryPoint = "CreateProcessW", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool CreateProcess(string application, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint flags, IntPtr environment, string? directory, ref StartupInfoEx startup, out ProcessInformation process);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool PeekNamedPipe(SafeFileHandle pipe, IntPtr buffer, uint length, IntPtr read, out uint available, IntPtr left);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool ReadFile(SafeFileHandle pipe, [Out] byte[] buffer, uint length, out uint read, IntPtr overlapped);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint WaitForSingleObject(SafeFileHandle process, uint milliseconds);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetExitCodeProcess(SafeFileHandle process, out uint code);
    }
}
