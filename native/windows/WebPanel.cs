using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Text.Json;

namespace WorkspaceObservatory;

// Spike for the shared web viewer. Shown only with --web-panel. The native
// UsagePopup stays the default and is not used or changed by this class.
internal sealed class WebPanel : Form
{
    internal const string Origin = "https://observatory.invalid";
    internal const string Page = "panel.html";
    private const int PanelWidth = 388;
    internal static readonly string[] Actions = ["refresh", "check-updates", "open-settings", "open-dashboard"];
    private readonly WebView2 web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = DashboardPalette.Background(false) };
    private readonly string runtime;
    private readonly Action<string> act;
    private Task? started;
    private bool failed;
    private readonly Func<Task>? startOverride;

    internal WebPanel(string runtime, Action<string> act, TimeSpan? releaseAfter = null, Func<Task>? startOverride = null)
    {
        this.runtime = runtime; this.act = act;
        this.startOverride = startOverride;
        release.Interval = (int)Math.Clamp((releaseAfter ?? DefaultReleaseAfter).TotalMilliseconds, 100, int.MaxValue);
        Text = "Observatory";
        AccessibleName = "Observatory usage overview";
        BackColor = DashboardPalette.Background(false);
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false; StartPosition = FormStartPosition.Manual;
        // A tray panel stays above other windows while it is shown.
        TopMost = true;
        ClientSize = new Size(LogicalToDeviceUnits(PanelWidth), LogicalToDeviceUnits(560));
        Controls.Add(web);
        VisibleChanged += (_, _) => { release.Stop(); if (ShouldRelease(Visible, IsDisposed, started is not null, failed)) release.Start(); };
        release.Tick += (_, _) => { release.Stop(); if (ShouldRelease(Visible, IsDisposed, started is not null, failed)) Retire(); };
        // Close when another window comes to the foreground, as tray panels do.
        // The form's Deactivate event is not used: it also fires when focus
        // moves into the page, and then does not fire again. The foreground
        // window is read on a short timer while the panel is shown instead.
        watch.Tick += (_, _) =>
        {
            if (IsDisposed || !Visible || !IsHandleCreated) { watch.Stop(); return; }
            var front = GetForegroundWindow();
            var ours = front == Handle || (front != IntPtr.Zero && GetAncestor(front, 3) == Handle);
            // Only a panel that has held the foreground can lose it. One that
            // Windows never brought forward stays until it is used or closed.
            if (ours) { held = true; return; }
            if (!held || KeepOpen || front == IntPtr.Zero) return;
            dismissed = Environment.TickCount64; Hide();
        };
        VisibleChanged += (_, _) => { held = false; if (Visible) watch.Start(); else watch.Stop(); };
    }

    private readonly System.Windows.Forms.Timer watch = new() { Interval = 150 };
    private bool held;

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr window, uint flags);

    // Set by the timing harness only, so an unattended opening is not closed
    // while it is being measured.
    internal bool KeepOpen;
    internal bool IsForeground => IsHandleCreated && GetForegroundWindow() == Handle;

    // A click on the tray icon deactivates the panel before the click handler
    // runs. Without this, that click would hide the panel and open it again.
    private long? dismissed;
    internal bool DismissedJustNow => dismissed is { } at && Environment.TickCount64 - at < 400;

    // The web view is created when the panel opens. Closing hides the panel, so
    // reopening soon is fast. After the panel has stayed hidden for a minute the
    // form and its web view are disposed, which ends the browser processes. The
    // owner then creates a new panel on the next opening.
    internal static readonly TimeSpan DefaultReleaseAfter = TimeSpan.FromSeconds(60);
    private readonly System.Windows.Forms.Timer release = new();

    internal static bool ShouldRelease(bool visible, bool disposed, bool started, bool failed) =>
        !visible && !disposed && (started || failed);
    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (e.CloseReason == CloseReason.UserClosing && !retire) { e.Cancel = true; Hide(); }
        base.OnFormClosing(e);
    }

    private bool retire;
    internal void Retire()
    {
        if (retire || IsDisposed) return;
        retire = true;
        Close();
    }

    // Completes when the panel is visible and the page reports that it has drawn.
    internal async Task<bool> ShowNearTray()
    {
        var area = Screen.FromPoint(Cursor.Position).WorkingArea;
        Place(area);
        Show(); Activate();
        try
        {
            await (started ??= startOverride is null ? Start() : startOverride());
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
        catch
        {
            failed = true;
            if (!IsDisposed && !retire)
            {
                Hide();
                Retire();
            }
        }
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

    internal async Task<string> RunScriptForTest(string script)
    {
        if (IsDisposed || web.IsDisposed || web.CoreWebView2 is null) return "unavailable";
        return await web.CoreWebView2.ExecuteScriptAsync(script);
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
        if (IsDisposed) return;
        await web.EnsureCoreWebView2Async(environment);
        if (IsDisposed) return;
        var core = web.CoreWebView2;
        core.ProcessFailed += (_, _) =>
        {
            if (IsDisposed) return;
            if (InvokeRequired)
            {
                try { BeginInvoke(new Action(Retire)); }
                catch (InvalidOperationException) when (IsDisposed || Disposing || !IsHandleCreated) { }
            }
            else Retire();
        };
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
        core.WebResourceRequested += (_, e) => Respond(environment, e, runtime, Page);
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
        // Read once per web view. Changes apply when the next panel is created.
        var (skin, theme) = WebViewerPreferences.Read();
        await core.AddScriptToExecuteOnDocumentCreatedAsync(WebViewerPreferences.DocumentStartScript(skin, theme));
        if (IsDisposed) return;
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

    internal static bool IsPanel(string value) => IsPage(value, Page);

    internal static bool IsPage(string value, string page) => IsLocal(value) && new Uri(value) is { } uri &&
        uri.AbsolutePath == "/" + page && uri.Fragment.Length == 0 && uri.Query is "" or "?demo";

    internal static string? RequestPath(string uri, string page)
    {
        if (!IsLocal(uri)) return null;
        var request = new Uri(uri);
        var relative = Uri.UnescapeDataString(request.AbsolutePath).TrimStart('/');
        if (relative.Contains('\0')) return null;
        if (request.Query.Length != 0 && !(page == Page && relative == Page && request.Query == "?demo")) return null;
        return relative;
    }

    // Returns the bundled file for a request path, or null when the path is
    // outside what a shared viewer page may load: that one page, bundled assets
    // and the sanitized snapshot.
    internal static string? Resolve(string runtime, string relative, string page = Page, string? webRoot = null)
    {
        if (page is not (Page or WebDashboard.Page)) return null;
        if (relative.EndsWith('/') || relative.Contains('\\') || relative.Contains(':') || relative.Contains('\0') ||
            relative.Split('/').Any(part => part is "." or "..")) return null;
        if (relative == "local/usage.json") return Snapshot.DashboardFile(runtime, "usage.json");
        if (relative != page && !relative.StartsWith("assets/", StringComparison.Ordinal)) return null;
        var file = Snapshot.UnlinkedFile(webRoot ?? Path.Combine(AppContext.BaseDirectory, "Web"), relative);
        if (file is null) return null;
        var extension = Path.GetExtension(file);
        if (extension.Equals(".json", StringComparison.OrdinalIgnoreCase) ||
            (extension.Equals(".html", StringComparison.OrdinalIgnoreCase) && relative != page)) return null;
        return file;
    }

    internal static string Untrusted(string? text, int max = 2048)
    {
        if (text is null) return "Unknown";
        const string marker = "...[truncated]";
        max = Math.Max(0, max);
        var truncated = text.Length > max;
        var length = truncated ? Math.Max(0, max - marker.Length) : text.Length;
        var clean = new string(text.Take(length).Select(character => char.IsControl(character) ? ' ' : character).ToArray());
        return truncated ? clean + marker[..Math.Min(max, marker.Length)] : clean;
    }

    internal static void Respond(CoreWebView2Environment environment, CoreWebView2WebResourceRequestedEventArgs e, string runtime, string page)
    {
        const string policy = "Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff";
        try
        {
            if (e.Request.Method != "GET") throw new InvalidOperationException();
            var relative = RequestPath(e.Request.Uri, page) ?? throw new InvalidOperationException();
            var file = Resolve(runtime, relative, page) ?? throw new InvalidOperationException();
            var info = new FileInfo(file);
            if (!info.Exists || info.Length > Snapshot.MaxBytes || info.Attributes.HasFlag(FileAttributes.ReparsePoint)) throw new InvalidOperationException();
            var mime = Path.GetExtension(file) switch
            {
                ".html" => "text/html", ".js" => "text/javascript", ".css" => "text/css", ".json" => "application/json",
                ".txt" => "text/plain; charset=utf-8", ".ico" => "image/x-icon", ".woff" => "font/woff",
                ".svg" => "image/svg+xml", ".png" => "image/png", ".woff2" => "font/woff2", ".ttf" => "font/ttf",
                _ => throw new InvalidOperationException()
            };
            e.Response = environment.CreateWebResourceResponse(new MemoryStream(File.ReadAllBytes(file)), 200, "OK", "Content-Type: " + mime + "\r\n" + policy);
        }
        catch { e.Response = environment.CreateWebResourceResponse(new MemoryStream(), 404, "Unavailable", policy); }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { release.Dispose(); watch.Dispose(); web.Dispose(); }
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
            "assets/data.json", "assets/data.json/", "assets/data.json/.", "assets/x.json/", "assets/./x.js", "assets/page.html", "assets\\x.js", "assets/c:x.js", "panel.html/", "Panel.html", "" })
            Check(Resolve(runtime, path) is null, "refuses " + path);
        Check(IsPage(Origin + "/dashboard.html", WebDashboard.Page) && !IsPage(Origin + "/panel.html", WebDashboard.Page) &&
            !IsPage(Origin + "/dashboard.html", Page) && !IsPage(Origin + "/index.html", WebDashboard.Page), "dashboard page");
        foreach (var path in new[] { "panel.html", "index.html", "local/collector.json", "private-sync/pairing.json", "assets/../dashboard.html", "Dashboard.html" })
            Check(Resolve(runtime, path, WebDashboard.Page) is null, "dashboard refuses " + path);
        Check(Resolve(runtime, "panel.html", "index.html") is null && Resolve(runtime, "index.html", "index.html") is null, "unknown page");
        foreach (var visible in new[] { false, true })
        foreach (var disposed in new[] { false, true })
        foreach (var hasStarted in new[] { false, true })
        foreach (var hasFailed in new[] { false, true })
            Check(ShouldRelease(visible, disposed, hasStarted, hasFailed) == (!visible && !disposed && (hasStarted || hasFailed)),
                "release truth table");
        Check(RequestPath(Origin + "/assets/x.js", Page) == "assets/x.js", "asset request");
        Check(RequestPath(Origin + "/panel.html?demo", Page) == Page, "panel demo request");
        Check(RequestPath(Origin + "/dashboard.html?demo", WebDashboard.Page) is null, "dashboard demo refused");
        foreach (var uri in new[] { Origin + "/assets/x.js?v=1", Origin + "/local/usage.json?x", Origin + "/panel.html?skin=x",
            "http://observatory.invalid/panel.html", "https://observatory.invalid:444/panel.html", "https://user@observatory.invalid/panel.html",
            "https://example.com/panel.html", Origin + "/assets/x%00.js" })
            Check(RequestPath(uri, Page) is null, "request refused " + uri);
        var trailing = RequestPath(Origin + "/assets/x.json%2F", Page);
        Check(trailing == "assets/x.json/" && Resolve(runtime, trailing) is null, "encoded trailing slash refused");
        var traversal = RequestPath(Origin + "/assets/..%2Fpanel.html", Page);
        Check(traversal is not null && Resolve(runtime, traversal) is null, "encoded traversal refused");
        var root = Path.Combine(Path.GetTempPath(), "observatory-web-fixture-" + Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(Path.Combine(root, "assets"));
            File.WriteAllText(Path.Combine(root, Page), "<html>Fixture panel</html>");
            File.WriteAllText(Path.Combine(root, WebDashboard.Page), "<html>Fixture dashboard</html>");
            File.WriteAllText(Path.Combine(root, "assets", "app.js"), "void 0");
            File.WriteAllText(Path.Combine(root, "assets", "data.json"), "{}");
            File.WriteAllText(Path.Combine(root, "assets", "inner.html"), "<html>Fixture asset</html>");
            Check(Resolve(runtime, Page, Page, root) is { } panelFile && Path.GetFullPath(panelFile) == Path.GetFullPath(Path.Combine(root, Page)), "fixture panel");
            Check(Resolve(runtime, "assets/app.js", Page, root) is { } scriptFile && Path.GetFullPath(scriptFile) == Path.GetFullPath(Path.Combine(root, "assets", "app.js")), "fixture script");
            Check(Resolve(runtime, WebDashboard.Page, WebDashboard.Page, root) is { } dashboardFile && Path.GetFullPath(dashboardFile) == Path.GetFullPath(Path.Combine(root, WebDashboard.Page)), "fixture dashboard");
            foreach (var path in new[] { "assets/data.json", "assets/data.json/", "assets/data.json/.", "assets/inner.html", WebDashboard.Page })
                Check(Resolve(runtime, path, Page, root) is null, "fixture refuses " + path);
            Check(trailing is not null && Resolve(runtime, trailing, Page, root) is null, "fixture encoded trailing slash refused");
            Check(traversal is not null && Resolve(runtime, traversal, Page, root) is null, "fixture encoded traversal refused");
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
        Check(Untrusted(null) == "Unknown", "missing page text");
        var capped = Untrusted(new string('a', 5000));
        Check(capped.Length == 2048 && capped.EndsWith("...[truncated]", StringComparison.Ordinal), "page text capped");
        Check(Untrusted("a\r\nb") == "a  b" && Untrusted("a\0\tb") == "a  b", "page controls removed");
        Console.WriteLine("Web panel action, page and file contracts passed.");
    }
}
