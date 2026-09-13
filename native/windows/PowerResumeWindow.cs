namespace WorkspaceObservatory;

// A hidden top-level window receives broadcasts even when the dashboard is closed.
// A message-only window would not receive these system broadcasts.
internal sealed class PowerResumeWindow : NativeWindow, IDisposable
{
    private readonly Action resumed;
    private bool disposed;

    internal PowerResumeWindow(Action resumed)
    {
        this.resumed = resumed;
        CreateHandle(new CreateParams { Caption = "Observatory power notifications" });
    }

    protected override void WndProc(ref Message message)
    {
        // Windows sends automatic resume first, then may send user resume (7).
        // Handle only the first event to avoid duplicate refreshes.
        if (!disposed && message.Msg == 0x218 && message.WParam == (IntPtr)18)
            resumed();
        base.WndProc(ref message);
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        DestroyHandle();
    }

    internal static void SelfTest()
    {
        var calls = 0;
        using var window = new PowerResumeWindow(() => calls++);
        foreach (var (kind, value) in new[] { (0x218, 4), (0x218, 18), (0x218, 7), (0x400, 18) })
        {
            var message = Message.Create(window.Handle, kind, (IntPtr)value, IntPtr.Zero);
            window.WndProc(ref message);
        }
        if (calls != 1) throw new Exception("Power resume routing duplicated or missed refresh.");
        window.Dispose();
        if (window.Handle != IntPtr.Zero) throw new Exception("Power notification window was not released.");
        Console.WriteLine("Hidden power resume routing and disposal passed.");
    }
}
