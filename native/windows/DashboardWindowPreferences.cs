using Microsoft.Win32;

namespace WorkspaceObservatory;

internal static class DashboardWindowPreferences
{
    private const string Key = @"Software\Observatory\Dashboard";

    // Called only for the installed app, never by the synthetic dashboard harness.
    internal static void Attach(Form form, Size available)
    {
        try
        {
            using var saved = Registry.CurrentUser.OpenSubKey(Key);
            if (saved?.GetValue("Width") is int width && saved.GetValue("Height") is int height)
                form.ClientSize = new Size(Math.Clamp(width, form.MinimumSize.Width, Math.Max(form.MinimumSize.Width, available.Width - 48)),
                    Math.Clamp(height, form.MinimumSize.Height, Math.Max(form.MinimumSize.Height, available.Height - 80)));
            if (saved?.GetValue("Maximized") is int maximized && maximized == 1) form.WindowState = FormWindowState.Maximized;
        }
        catch { /* Unavailable preferences never prevent the dashboard opening. */ }
        var normalSize = form.ClientSize;
        form.Resize += (_, _) => { if (form.WindowState == FormWindowState.Normal) normalSize = form.ClientSize; };
        form.FormClosing += (_, _) =>
        {
            try
            {
                using var saved = Registry.CurrentUser.CreateSubKey(Key);
                saved.SetValue("Width", normalSize.Width);
                saved.SetValue("Height", normalSize.Height);
                saved.SetValue("Maximized", form.WindowState == FormWindowState.Maximized ? 1 : 0);
            }
            catch { /* Layout persistence is optional, unlike saved usage data. */ }
        };
    }
}
