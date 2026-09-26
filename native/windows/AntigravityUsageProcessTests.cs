using System.ComponentModel;
using System.Diagnostics;
using System.Text.Json;

namespace WorkspaceObservatory;

// Fictional subprocesses only. No installed provider, configuration, or auth reads.
internal static class AntigravityUsageProcessTests
{
    private const string Flag = "--test-antigravity-process";
    private const string Payload = "{\"fictionalAllowance\":true}";
    private static string Executable => Environment.ProcessPath ?? throw new IOException("Test executable unavailable.");

    internal static async Task<int> Command(string[] args)
    {
        try
        {
            if (args.SequenceEqual(new[] { "--test-antigravity-runner" })) { await Check(); return 0; }
            if (args.Length < 3 || args[0] != Flag || !ValidDirectory(args[2])) return 64;
            if (args[1] == "argv") { Console.Write(JsonSerializer.Serialize(args.Skip(3))); return 0; }
            return args.Length == 3 ? await Fixture(args[1], args[2]) : 64;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("Synthetic allowance runner failed: " + error.GetType().Name + ": " + error.Message);
            return 1;
        }
    }

    private static bool ValidDirectory(string directory) => Path.IsPathFullyQualified(directory) &&
        Path.GetFileName(Path.GetDirectoryName(directory))!.StartsWith("observatory-allowance-fixture-", StringComparison.Ordinal) &&
        File.Exists(Path.Combine(directory, ".synthetic"));

    private static string[] Arguments(string scenario, string directory) => [Flag, scenario, directory];
    private static Task<string> Run(string scenario, string directory, CancellationToken token = default,
        int timeout = 12000, int limit = 4096, bool invalidJob = false) =>
        AntigravityUsageProcess.RunContained(Executable, Arguments(scenario, directory), timeout, limit, token, invalidJob);

    private static async Task Check()
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10)) throw new PlatformNotSupportedException();
        var root = Path.Combine(Path.GetTempPath(), "observatory-allowance-fixture-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        var passed = new List<string>();
        Process? sentinel = null;
        try
        {
            var sentinelDirectory = NewCase(root, "sentinel");
            sentinel = Start("sentinel", sentinelDirectory);
            await Ready(sentinelDirectory, "sentinel");
            foreach (var scenario in new[] { "exit-inherited", "exit-closed", "fail", "overflow", "hang" })
            {
                var directory = NewCase(root, scenario);
                var elapsed = Stopwatch.StartNew();
                var task = Run(scenario, directory, timeout: scenario == "hang" ? 10000 : 12000);
                if (scenario.StartsWith("exit-", StringComparison.Ordinal))
                    Require(await task == (scenario == "exit-inherited" ? "child\ngrandchild\n" + Payload : Payload), scenario + " exact output");
                else await Reject(task, scenario, scenario == "fail" ? typeof(InvalidOperationException) :
                    scenario == "overflow" ? typeof(IOException) : typeof(TimeoutException));
                Require(elapsed.ElapsedMilliseconds < 18000, scenario + " bounded return");
                Require(File.Exists(Path.Combine(directory, "ready")), scenario + " reached fictional tree");
                await Gone(directory, "root", "child", "grandchild");
                Require(!sentinel.HasExited, "unrelated sentinel survived " + scenario);
                passed.Add(scenario);
            }
            {
                var directory = NewCase(root, "cancel");
                using var cancel = new CancellationTokenSource();
                var task = Run("hang", directory, cancel.Token);
                try
                {
                    await Ready(directory, "root");
                    await Until(() => File.Exists(Path.Combine(directory, "ready")), "cancel tree ready");
                    cancel.Cancel();
                    await Reject(task, "cancel", typeof(OperationCanceledException));
                    await Gone(directory, "root", "child", "grandchild");
                    passed.Add("cancel");
                }
                finally
                {
                    cancel.Cancel();
                    try { await task; } catch { } // Settle cleanup even if readiness assertions fail.
                }
            }
            foreach (var setupFailure in new[] { "pre-cancel", "invalid-job" })
            {
                var directory = NewCase(root, setupFailure);
                using var cancel = new CancellationTokenSource();
                if (setupFailure == "pre-cancel") cancel.Cancel();
                await Reject(Run("hang", directory, cancel.Token, invalidJob: setupFailure == "invalid-job"), setupFailure,
                    setupFailure == "pre-cancel" ? typeof(OperationCanceledException) : typeof(Win32Exception));
                Require(!File.Exists(Path.Combine(directory, "root.pid")), setupFailure + " launched nothing");
                passed.Add(setupFailure);
            }
            {
                var directory = NewCase(root, "owner-success");
                using var owner = Start("owner-success", directory);
                try
                {
                    await Lease(owner); // Keep the caller pipe open through success.
                    await owner.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(15));
                    Require(owner.ExitCode == 0 && await owner.StandardOutput.ReadToEndAsync() == Payload, "leased success result");
                    await Gone(directory, "owner", "root", "child", "grandchild");
                    passed.Add("owner-success");
                }
                finally { await StopOwned(owner); }
            }
            foreach (var mode in new[] { "missing-lease", "invalid-lease" })
            {
                var directory = NewCase(root, mode);
                using var owner = Start("owner", directory);
                try
                {
                    if (mode == "invalid-lease")
                    {
                        await owner.StandardInput.BaseStream.WriteAsync(new byte[] { 2 });
                        await owner.StandardInput.BaseStream.FlushAsync();
                    }
                    await owner.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(8));
                    Require(owner.ExitCode != 0 && !File.Exists(Path.Combine(directory, "root.pid")), mode + " launched nothing");
                    Require(await owner.StandardOutput.ReadToEndAsync() == "", mode + " returned no result");
                    passed.Add(mode);
                }
                finally { await StopOwned(owner); }
            }
            foreach (var mode in new[] { "helper-death", "caller-close", "caller-extra-byte", "parent-death" })
            {
                var directory = NewCase(root, mode);
                using var owner = Start(mode == "parent-death" ? "parent" : "owner", directory);
                try
                {
                    if (mode != "parent-death") await Lease(owner);
                    await Until(() => File.Exists(Path.Combine(directory, "ready")), mode + " tree ready");
                    if (mode is "helper-death" or "parent-death") owner.Kill(); // This exact owned process only.
                    else if (mode == "caller-close") owner.StandardInput.Close();
                    else { await owner.StandardInput.BaseStream.WriteAsync(new byte[] { 2 }); await owner.StandardInput.BaseStream.FlushAsync(); }
                    await owner.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(8));
                    Require(owner.ExitCode != 0, mode + " failed closed");
                    await Gone(directory, "root", "child", "grandchild", "owner");
                    Require(!sentinel.HasExited, "unrelated sentinel survived " + mode);
                    Require(await owner.StandardOutput.ReadToEndAsync() == "", mode + " returned no partial result");
                    passed.Add(mode);
                }
                finally { await StopOwned(owner); }
            }
            {
                var directory = NewCase(root, "outer-job");
                Require(await Run("nested", directory, timeout: 20000) == Payload, "nested job result");
                await Gone(directory, "nested", "root", "child", "grandchild");
                passed.Add("outer-job");
            }
            {
                var directory = NewCase(root, "argv");
                string[] values = ["", "two words", "quote\"here", "trailing\\", "slashes\\\"quoted", "single'quote", "&$()%!"];
                var output = await AntigravityUsageProcess.RunContained(Executable,
                    new[] { Flag, "argv", directory }.Concat(values).ToArray(), 12000, 4096, CancellationToken.None);
                Require(JsonSerializer.Deserialize<string[]>(output)!.SequenceEqual(values), "argv exact round trip");
                passed.Add("argv");
            }
            Require(!sentinel.HasExited, "unrelated sentinel remained alive");
            Console.WriteLine(JsonSerializer.Serialize(new { status = "synthetic-only", passed = passed.Count, cases = passed }));
        }
        finally
        {
            if (sentinel is not null) { await StopOwned(sentinel); sentinel.Dispose(); }
            Directory.Delete(root, true);
        }
    }

    private static async Task<int> Fixture(string scenario, string directory)
    {
        if (scenario is "owner" or "owner-success")
        {
            Mark(directory, "owner");
            return await AntigravityUsageProcess.WithCallerLifetime(token =>
                Run(scenario == "owner-success" ? "exit-closed" : "hang", directory, token));
        }
        if (scenario == "parent")
        {
            using var helper = Start("owner", directory);
            await Lease(helper);
            await Task.Delay(TimeSpan.FromSeconds(90));
            await StopOwned(helper);
            return 1;
        }
        if (scenario == "nested")
        {
            Mark(directory, "nested");
            Console.Write(await Run("exit-closed", directory));
            return 0;
        }
        if (scenario is "grandchild-inherited" or "grandchild-closed" or "sentinel")
        {
            if (scenario == "grandchild-inherited") { Console.Write("grandchild\n"); Console.Out.Flush(); }
            Mark(directory, scenario == "sentinel" ? "sentinel" : "grandchild");
            await Task.Delay(TimeSpan.FromSeconds(scenario == "sentinel" ? 300 : 90));
            return 0;
        }
        if (scenario is "child-inherited" or "child-closed")
        {
            Mark(directory, "child");
            if (scenario == "child-inherited") { Console.Write("child\n"); Console.Out.Flush(); }
            using var grandchild = Start(scenario == "child-inherited" ? "grandchild-inherited" : "grandchild-closed",
                directory, redirectOutput: scenario == "child-closed");
            await Ready(directory, "grandchild");
            File.WriteAllText(Path.Combine(directory, "child-ready"), "synthetic");
            await Task.Delay(TimeSpan.FromSeconds(90));
            return 0;
        }
        if (scenario is not ("exit-inherited" or "exit-closed" or "hang" or "fail" or "overflow")) return 64;
        Mark(directory, "root");
        using var child = Start(scenario == "exit-closed" ? "child-closed" : "child-inherited", directory,
            redirectOutput: scenario == "exit-closed");
        await Until(() => File.Exists(Path.Combine(directory, "child-ready")), "fictional descendants ready");
        File.WriteAllText(Path.Combine(directory, "ready"), "synthetic");
        if (scenario.StartsWith("exit-", StringComparison.Ordinal)) { Console.Write(Payload); return 0; }
        if (scenario == "fail") return 7;
        if (scenario == "overflow") { Console.Write(new string('x', 8192)); Console.Out.Flush(); }
        await Task.Delay(TimeSpan.FromSeconds(90));
        return 1;
    }

    private static Process Start(string scenario, string directory, bool redirectOutput = true)
    {
        var start = new ProcessStartInfo(Executable) { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = redirectOutput, RedirectStandardError = true };
        foreach (var argument in Arguments(scenario, directory)) start.ArgumentList.Add(argument);
        return Process.Start(start) ?? throw new IOException("Fictional process did not start.");
    }

    private static async Task Lease(Process process)
    {
        await process.StandardInput.BaseStream.WriteAsync(new byte[] { 1 });
        await process.StandardInput.BaseStream.FlushAsync();
    }
    private static async Task StopOwned(Process process)
    {
        if (!process.HasExited) process.Kill();
        await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
    }
    private static string NewCase(string root, string name)
    {
        var directory = Path.Combine(root, name);
        Directory.CreateDirectory(directory);
        File.WriteAllText(Path.Combine(directory, ".synthetic"), "fictional process fixture");
        return directory;
    }
    private static void Mark(string directory, string role) => File.WriteAllText(Path.Combine(directory, role + ".pid"), Environment.ProcessId.ToString());
    private static Task Ready(string directory, string role) => Until(() =>
        File.Exists(Path.Combine(directory, role + ".pid")) && int.TryParse(File.ReadAllText(Path.Combine(directory, role + ".pid")), out _), role + " ready");
    private static async Task Gone(string directory, params string[] roles)
    {
        foreach (var role in roles)
        {
            var pid = int.Parse(File.ReadAllText(Path.Combine(directory, role + ".pid")));
            await Until(() =>
            {
                try { using var process = Process.GetProcessById(pid); return process.HasExited; }
                catch (ArgumentException) { return true; }
            }, role + " exited", 5000);
        }
    }
    private static async Task Until(Func<bool> check, string label, int milliseconds = 10000)
    {
        var elapsed = Stopwatch.StartNew();
        while (!check())
        {
            if (elapsed.ElapsedMilliseconds >= milliseconds) throw new TimeoutException(label);
            await Task.Delay(20);
        }
    }
    private static async Task Reject(Task<string> operation, string label, Type expected)
    {
        try { await operation; }
        catch (Exception error) when (expected.IsInstanceOfType(error)) { return; }
        throw new IOException(label + " unexpectedly succeeded");
    }
    private static void Require(bool valid, string label) { if (!valid) throw new IOException(label); }
}
