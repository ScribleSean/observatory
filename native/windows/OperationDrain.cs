namespace WorkspaceObservatory;

// Serializes new work against a graceful shutdown request. Stopping does not
// cancel an operation that may be publishing a snapshot or pairing state.
internal sealed class OperationDrain
{
    private readonly object sync = new();
    private bool busy, stopping;
    private TaskCompletionSource? completion;
    internal bool Busy { get { lock (sync) return busy; } }
    internal bool Stopping { get { lock (sync) return stopping; } }
    internal bool TryBegin()
    {
        lock (sync)
        {
            if (busy || stopping) return false;
            busy = true;
            completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
            return true;
        }
    }
    internal void Complete()
    {
        lock (sync)
        {
            if (!busy) throw new InvalidOperationException("No operation is running.");
            busy = false;
            completion!.TrySetResult();
        }
    }
    internal Task Stop()
    {
        lock (sync) { stopping = true; return busy ? completion!.Task : Task.CompletedTask; }
    }
    internal void Resume() { lock (sync) stopping = false; }

    internal static void SelfTest()
    {
        var gate = new OperationDrain();
        if (!gate.TryBegin() || gate.TryBegin()) throw new Exception("Operation exclusion failed.");
        var stopped = gate.Stop();
        if (stopped.IsCompleted || gate.TryBegin()) throw new Exception("Shutdown bypassed active work.");
        Task.Run(gate.Complete).GetAwaiter().GetResult();
        stopped.WaitAsync(TimeSpan.FromSeconds(2)).GetAwaiter().GetResult();
        if (gate.Busy || gate.TryBegin()) throw new Exception("Shutdown allowed new work.");
        gate.Resume();
        if (!gate.TryBegin()) throw new Exception("Cancelled shutdown could not resume.");
        gate.Complete();
        if (!gate.Stop().IsCompleted) throw new Exception("Idle shutdown did not complete.");
        Console.WriteLine("Operation draining, exclusion and resume passed.");
    }
}
