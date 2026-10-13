using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Text.Json;

namespace WorkspaceObservatory;

// Spike for the shared web viewer. Shown only with --web-panel. The native
// UsagePopup stays the default and is not used or changed by this class.
internal sealed class WebPanel : Form
{
    private const string Origin = "https://observatory.invalid";
    private const string Page = "panel.html";
    private const int PanelWidth = 388;
    internal static readonly string[] Actions = ["refresh", "check-updates", "open-settings", "open-dashboard"];
    private readonly WebView2 web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = DashboardPalette.Background(false) };
    private readonly string runtime;
    private readonly Action<string> act;
    private Task? started;

    internal WebPanel(string runtime, Action<string> act)
    {
        this.runtime = runtime; this.act = act;
        Text = "Observatory";
        AccessibleName = "Observatory usage overview";
        BackColor = DashboardPalette.Background(false);
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false; StartPosition = FormStartPosition.Manual;
        ClientSize = new Size(LogicalToDeviceUnits(PanelWidth), LogicalToDeviceUnits(560));
        Controls.Add(web);
        // Close when another window is activated, as tray panels usually do.
        Deactivate += async (_, _) =>
        {
            // Focus moving into the page also raises Deactivate, because the
            // web view is a child window owned by another process. Hide only
            // when a different top-level window has become the foreground one.
            await Task.Delay(60);
            if (KeepOpen || IsDisposed || !Visible || !IsHandleCreated || IsForeground) return;
            dismissed = Environment.TickCount64; Hide();
        };
    }

    // Set by the timing harness only. An app that Windows did not bring to the
    // foreground cannot hold it, so an unattended opening would close at once.
    internal bool KeepOpen;
    internal bool IsForeground => IsHandleCreated && GetForegroundWindow() == Handle;

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    // A click on the tray icon deactivates the panel before the click handler
    // runs. Without this, that click would hide the panel and open it again.
    private long? dismissed;
    internal bool DismissedJustNow => dismissed is { } at && Environment.TickCount64 - at < 400;

    // The web view is created on the first opening and kept afterwards, so a
    // later opening only shows an existing window. Closing hides the panel.
    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (e.CloseReason == CloseReason.UserClosing && !retire) { e.Cancel = true; Hide(); }
        base.OnFormClosing(e);
    }

    private bool retire;
    internal void Retire() { retire = true; Close(); }

    // Completes when the panel is visible and the page reports that it has drawn.
    internal async Task<bool> ShowNearTray()
    {
        var area = Screen.FromPoint(Cursor.Position).WorkingArea;
        Place(area);
        Show(); Activate();
        try
        {
            await (started ??= Start());
            for (var attempt = 0; attempt < 400 && !IsDisposed && Visible; attempt++)
            {
                if (await web.CoreWebView2.ExecuteScriptAsync("window.observatoryPanelReady === true") == "true")
                {
                    await FitContent();
                    return true;
                }
                await Task.Delay(25);
            }
        }
        catch { started = null; }
        return false;
    }

    private void Place(Rectangle area)
    {
        Height = Math.Min(Height, area.Height - 24); Width = Math.Min(Width, area.Width - 24);
        Location = new Point(Math.Clamp(Cursor.Position.X - Width, area.Left, area.Right - Width),
            Math.Clamp(Cursor.Position.Y - Height, area.Top, area.Bottom - Height));
    }

    private const string ContentHeight = "(() => { const panel = document.querySelector('main'); const body = getComputedStyle(document.body); " +
        "return Math.ceil((panel ?? document.documentElement).getBoundingClientRect().bottom + scrollY + parseFloat(body.marginBottom) + parseFloat(body.paddingBottom)); })()";

    private async Task FitContent()
    {
        if (IsDisposed || web.CoreWebView2 is null) return;
        // The document is at least as tall as the window, so measure the panel element itself.
        var measured = await web.CoreWebView2.ExecuteScriptAsync(ContentHeight);
        if (IsDisposed || !double.TryParse(measured, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var height) || height < 1) return;
        var area = Screen.FromControl(this).WorkingArea;
        var bottom = Bottom;
        ClientSize = new Size(ClientSize.Width, Math.Min(LogicalToDeviceUnits((int)Math.Min(height, 4000)), area.Height - 24));
        // Keep the lower edge beside the tray while the height follows the page.
        Location = new Point(Math.Clamp(Left, area.Left, Math.Max(area.Left, area.Right - Width)),
            Math.Clamp(bottom - Height, area.Top, Math.Max(area.Top, area.Bottom - Height)));
    }

    internal async void SnapshotChanged()
    {
        try
        {
            if (IsDisposed || started is null || !started.IsCompletedSuccessfully) return;
            await web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new Event('observatory:snapshot-changed'))");
            if (!Visible) return;
            await Task.Delay(400);
            if (Visible) await FitContent();
        }
        catch { }
    }

    // Measurement helpers for --panel-timing. They read facts about the drawn
    // page and press its own buttons. They add no way for the page to reach the app.
    internal async Task<string> Describe()
    {
        if (IsDisposed || web.CoreWebView2 is null) return "unavailable";
        return await web.CoreWebView2.ExecuteScriptAsync("""
            JSON.stringify({ready: window.observatoryPanelReady === true, width: innerWidth, windowHeight: innerHeight,
              panelBottom: Math.ceil(document.querySelector('main')?.getBoundingClientRect().bottom ?? -1),
              panelFont: getComputedStyle(document.querySelector('main') ?? document.body).fontFamily,
              scale: devicePixelRatio, interTightLoaded: document.fonts.check("16px 'Inter Tight'"),
              dark: matchMedia('(prefers-color-scheme: dark)').matches,
              background: getComputedStyle(document.body).backgroundColor, buttons: document.querySelectorAll('.ob-actions button').length,
              limitRows: document.querySelectorAll('.ob-limit').length, textLength: document.body.innerText.length})
            """);
    }

    internal async Task Press(int button)
    {
        if (IsDisposed || web.CoreWebView2 is null) return;
        await web.CoreWebView2.ExecuteScriptAsync("document.querySelectorAll('.ob-actions button')[" + button + "]?.click()");
    }

    internal async Task SavePreview(string file)
    {
        if (IsDisposed || web.CoreWebView2 is null) return;
        using var stream = File.Create(file);
        await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
    }

    private async Task Start()
    {
        var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(runtime, "WebViewCache"));
        await web.EnsureCoreWebView2Async(environment);
        var core = web.CoreWebView2;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreHostObjectsAllowed = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        // The page sends four fixed action names. Nothing is sent to the page.
        core.Settings.IsWebMessageEnabled = true;
        core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += (_, e) => Serve(environment, e);
        core.NavigationStarting += (_, e) => { if (!IsPanel(e.Uri)) e.Cancel = true; };
        core.NewWindowRequested += (_, e) => e.Handled = true;
        core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
        core.DownloadStarting += (_, e) => e.Cancel = true;
        core.WebMessageReceived += (_, e) =>
        {
            if (!IsPanel(e.Source)) return;
            if (ParseAction(e.WebMessageAsJson) is { } action) act(action);
        };
        // The control forwards accelerator keys pressed inside the page.
        web.KeyDown += (_, e) => { if (e.KeyCode == Keys.Escape) { e.Handled = true; Hide(); } };
        core.Navigate(Origin + "/" + Page);
    }

    protected override bool ProcessCmdKey(ref Message message, Keys keyData)
    {
        if (keyData == Keys.Escape) { Hide(); return true; }
        return base.ProcessCmdKey(ref message, keyData);
    }

    // Exactly { "panelAction": name } with one of the four names. Anything
    // else, including extra fields or arguments, is ignored.
    internal static string? ParseAction(string json)
    {
        try
        {
            if (json.Length > 256) return null;
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            string? name = null;
            var count = 0;
            foreach (var property in root.EnumerateObject())
            {
                count++;
                if (property.Name != "panelAction" || property.Value.ValueKind != JsonValueKind.String) return null;
                name = property.Value.GetString();
            }
            return count == 1 && name is not null && Array.IndexOf(Actions, name) >= 0 ? name : null;
        }
        catch (JsonException) { return null; }
    }

    private static bool IsLocal(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
        uri.Scheme == "https" && uri.Host == "observatory.invalid" && uri.IsDefaultPort && uri.UserInfo.Length == 0;

    internal static bool IsPanel(string value) => IsLocal(value) && new Uri(value) is { } uri &&
        uri.AbsolutePath == "/" + Page && uri.Fragment.Length == 0 && uri.Query is "" or "?demo";

    // Returns the bundled file for a request path, or null when the path is
    // outside what the panel may load: its own page, bundled assets and the
    // sanitized snapshot.
    internal static string? Resolve(string runtime, string relative)
    {
        if (relative == "local/usage.json") return Snapshot.DashboardFile(runtime, "usage.json");
        if (relative != Page && !relative.StartsWith("assets/", StringComparison.Ordinal)) return null;
        if (Path.GetExtension(relative).Equals(".json", StringComparison.OrdinalIgnoreCase)) return null;
        if (relative.Contains('\\') || relative.Contains(':') || relative.Contains('\0') || relative.Split('/').Contains("..")) return null;
        return Snapshot.UnlinkedFile(Path.Combine(AppContext.BaseDirectory, "Web"), relative);
    }

    private void Serve(CoreWebView2Environment environment, CoreWebView2WebResourceRequestedEventArgs e)
    {
        const string policy = "Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff";
        try
        {
            if (e.Request.Method != "GET" || !IsLocal(e.Request.Uri)) throw new InvalidOperationException();
            var relative = Uri.UnescapeDataString(new Uri(e.Request.Uri).AbsolutePath).TrimStart('/');
            var file = Resolve(runtime, relative) ?? throw new InvalidOperationException();
            var info = new FileInfo(file);
            if (!info.Exists || info.Length > Snapshot.MaxBytes || info.Attributes.HasFlag(FileAttributes.ReparsePoint)) throw new InvalidOperationException();
            var mime = Path.GetExtension(file) switch
            {
                ".html" => "text/html", ".js" => "text/javascript", ".css" => "text/css", ".json" => "application/json",
                ".svg" => "image/svg+xml", ".png" => "image/png", ".woff2" => "font/woff2", ".ttf" => "font/ttf",
                _ => throw new InvalidOperationException()
            };
            e.Response = environment.CreateWebResourceResponse(new MemoryStream(File.ReadAllBytes(file)), 200, "OK", "Content-Type: " + mime + "\r\n" + policy);
        }
        catch { e.Response = environment.CreateWebResourceResponse(new MemoryStream(), 404, "Unavailable", policy); }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) web.Dispose();
        base.Dispose(disposing);
    }

    internal static void SelfTest()
    {
        void Check(bool value, string message) { if (!value) throw new InvalidOperationException("Web panel contract failed: " + message); }
        foreach (var name in Actions) Check(ParseAction("{\"panelAction\":\"" + name + "\"}") == name, "accepts " + name);
        foreach (var rejected in new[] { "", "null", "\"refresh\"", "[]", "{}", "{\"panelAction\":\"quit\"}", "{\"panelAction\":\"Refresh\"}",
            "{\"panelAction\":\"refresh \"}", "{\"panelAction\":1}", "{\"panelAction\":null}", "{\"panelAction\":[\"refresh\"]}",
            "{\"panelAction\":\"refresh\",\"argument\":\"x\"}", "{\"action\":\"refresh\"}", "{\"panelAction\":\"refresh\",\"panelAction\":\"refresh\"}",
            "{\"panelAction\":\"" + new string('a', 300) + "\"}", "{\"panelAction\":\"refresh\"" })
            Check(ParseAction(rejected) is null, "rejects " + (rejected.Length > 40 ? rejected[..40] : rejected));
        Check(IsPanel(Origin + "/panel.html") && IsPanel(Origin + "/panel.html?demo"), "panel page");
        foreach (var other in new[] { Origin + "/index.html", Origin + "/panel.html?skin=x", Origin + "/panel.html#a", Origin + "/panel.html/x",
            "http://observatory.invalid/panel.html", "https://observatory.invalid:444/panel.html", "https://user@observatory.invalid/panel.html",
            "https://example.com/panel.html", "file:///C:/panel.html", "" })
            Check(!IsPanel(other), "other page " + other);
        var runtime = Path.Combine(Path.GetTempPath(), "observatory-web-panel-" + Guid.NewGuid().ToString("N"));
        foreach (var path in new[] { "index.html", "local/collector.json", "local/setup.json", "private-sync/pairing.json", "assets/../panel.html",
            "assets/data.json", "assets\\x.js", "assets/c:x.js", "panel.html/", "Panel.html", "" })
            Check(Resolve(runtime, path) is null, "refuses " + path);
        Console.WriteLine("Web panel action, page and file contracts passed.");
    }
}
