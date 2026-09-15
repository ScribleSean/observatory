namespace WorkspaceObservatory;

// This only requests a normal quit. The updater must separately acquire its
// installation locks and authenticate the candidate before replacing files.
internal static class UpdateQuit
{
    internal const string RequestName = "Local\\WorkspaceObservatory.QuitForUpdate";
    internal enum Result { Stopped, Unsupported, TimedOut }

    internal static Result Request(string singletonName, string requestName, TimeSpan timeout)
    {
        if (!Mutex.TryOpenExisting(singletonName, out var singleton)) return Result.Stopped;
        using (singleton)
        {
            if (!EventWaitHandle.TryOpenExisting(requestName, out var request)) return Result.Unsupported;
            using (request) request.Set();
            bool acquired;
            try { acquired = singleton.WaitOne(timeout); }
            catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) return Result.TimedOut;
            singleton.ReleaseMutex();
            return Result.Stopped;
        }
    }

    internal static void SelfTest()
    {
        var prefix = "Local\\ObservatoryQuitTest-" + Guid.NewGuid().ToString("N");
        if (Request(prefix, prefix + ".request", TimeSpan.Zero) != Result.Stopped)
            throw new Exception("Absent application must not be launched by update quit.");
        foreach (var mode in new[] { "unsupported", "busy", "complete" })
        {
            using var ready = new ManualResetEventSlim();
            using var finish = new ManualResetEventSlim();
            var received = false;
            var owner = Task.Run(() =>
            {
                using var singleton = new Mutex(true, prefix);
                using var request = mode == "unsupported" ? null : new EventWaitHandle(false, EventResetMode.AutoReset, prefix + ".request");
                try
                {
                    ready.Set();
                    if (request is not null) received = request.WaitOne(TimeSpan.FromSeconds(3));
                    if (mode != "complete") finish.Wait(TimeSpan.FromSeconds(3));
                }
                finally { singleton.ReleaseMutex(); }
            });
            try
            {
                if (!ready.Wait(TimeSpan.FromSeconds(3))) throw new Exception("Quit fixture did not start.");
                var result = Request(prefix, prefix + ".request", mode == "busy" ? TimeSpan.FromMilliseconds(40) : TimeSpan.FromSeconds(3));
                var expected = mode == "unsupported" ? Result.Unsupported : mode == "busy" ? Result.TimedOut : Result.Stopped;
                if (result != expected) throw new Exception("Update quit reported the wrong completion state.");
            }
            finally { finish.Set(); owner.GetAwaiter().GetResult(); }
            if (mode != "unsupported" && !received) throw new Exception("Normal quit was not requested.");
        }
        Console.WriteLine("Update quit handles absent, unsupported, busy and completed applications without force termination.");
    }
}
