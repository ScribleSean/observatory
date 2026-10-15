using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace WorkspaceObservatory;

// The shared viewer is the default main window.
internal sealed class WebDashboard : Form
{
    internal const string Page = "dashboard.html";
    private readonly WebView2 web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = DashboardPalette.Background(false) };
    private readonly string runtime;
    private readonly Task started;

    private readonly BridgeHandler? handler;
    private string? section;
    private long documentNumber;
    private bool drawn, bridgeClosed;
    private string? viewerScript;
    private Task viewerWork = Task.CompletedTask;
    private const string RuntimeMessage = "The dashboard could not start. Check that Microsoft Edge WebView2 Runtime is installed. Collection is separate from this window.";

    internal WebDashboard(string runtime, BridgeHandler? handler = null, string? section = null)
    {
        this.runtime = runtime;
        this.handler = handler;
        this.section = section is not null && Fragments.Contains(section, StringComparer.Ordinal) ? section : null;
        FormClosing += (_, _) => CloseBridge();
        Text = "Observatory";
        Size = new Size(1150, 770);
        MinimumSize = new Size(800, 550);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = DashboardPalette.Background(false);
        Controls.Add(web);
        started = Start();
    }

    // Closing the window disposes the form and its web view, which ends the
    // browser processes. Opening again creates a new window.
    private async Task Start()
    {
        try
        {
            if (WebPanel.Resolve(runtime, Page, Page) is null)
            {
                ShowError("The dashboard page is missing from this installation. Reinstall Observatory. Collection is separate from this window.");
                return;
            }
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(runtime, "WebViewCache"));
            if (IsDisposed || web.IsDisposed) return;
            await web.EnsureCoreWebView2Async(environment);
            if (IsDisposed || web.IsDisposed) return;
            var core = web.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreHostObjectsAllowed = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsWebMessageEnabled = handler is not null;
            if (handler is not null) core.WebMessageReceived += (_, e) =>
            {
                string? text;
                try { text = e.TryGetWebMessageAsString(); }
                catch (ArgumentException) { text = null; }
                var source = e.Source;
                var number = documentNumber;
                // Handle the message after this event returns, because an action may open a native dialog.
                BeginInvoke(new Action(() =>
                {
                    if (IsDisposed || Disposing || web.IsDisposed) return;
                    handler.Receive(text, source, number, json =>
                    {
                        if (!IsDisposed && !Disposing && !web.IsDisposed) core.PostWebMessageAsJson(json);
                    });
                }));
            };
            core.ProcessFailed += (_, e) =>
            {
                // Other process kinds are restarted by WebView2 and keep the document.
                if (e.ProcessFailedKind is not (CoreWebView2ProcessFailedKind.BrowserProcessExited or
                    CoreWebView2ProcessFailedKind.RenderProcessExited or CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)) return;
                documentNumber++;
                handler?.DocumentReplaced();
                if (!IsDisposed && !web.IsDisposed)
                    ShowError(drawn ? "The dashboard stopped. Close this window and open it again from the tray." : RuntimeMessage);
            };
            core.NavigationCompleted += async (_, _) =>
            {
                var number = documentNumber;
                try
                {
                    for (var attempt = 0; attempt < 400 && !IsDisposed && !web.IsDisposed && number == documentNumber; attempt++)
                    {
                        if (await core.ExecuteScriptAsync("window.observatoryDashboardReady === true") == "true")
                        { if (number == documentNumber) drawn = true; return; }
                        await Task.Delay(25);
                    }
                }
                catch { }
            };
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += (_, e) => WebPanel.Respond(environment, e, runtime, Page);
            core.NavigationStarting += (_, e) =>
            {
                if (!AllowsNavigation(e.Uri)) e.Cancel = true;
                if (!e.Cancel) { documentNumber++; handler?.DocumentReplaced(); }
            };
            core.FrameNavigationStarting += (_, e) => e.Cancel = true;
            core.NewWindowRequested += (_, e) => e.Handled = true;
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            core.DownloadStarting += (_, e) => e.Cancel = true;
            // Seed new documents with the saved viewer choices.
            var (skin, theme) = WebViewerPreferences.Read(runtime);
            viewerScript = await core.AddScriptToExecuteOnDocumentCreatedAsync(WebViewerPreferences.DocumentStartScript(skin, theme));
            if (IsDisposed || web.IsDisposed) return;
            core.Navigate(WebPanel.Origin + "/" + Page + (section is null ? "" : "#" + section));
        }
        catch
        {
            if (IsDisposed || web.IsDisposed) return;
            ShowError(RuntimeMessage);
        }
    }

    private void CloseBridge()
    {
        if (bridgeClosed) return;
        bridgeClosed = true;
        _ = handler?.CloseAsync();
    }

    // Only a fragment change, which keeps the document and any pairing session.
    internal void ShowSection(string section)
    {
        if (!Fragments.Contains(section, StringComparer.Ordinal)) return;
        this.section = section;
        if (!IsDisposed && !web.IsDisposed && started.IsCompletedSuccessfully && web.CoreWebView2 is { } core)
            core.Navigate(WebPanel.Origin + "/" + Page + "#" + section);
    }

    private void ShowError(string message)
    {
        Controls.Remove(web);
        web.Dispose();
        Controls.Add(new Label { Dock = DockStyle.Fill, ForeColor = DashboardPalette.Text(false), Padding = new Padding(30),
            Text = message });
    }

    internal void ApplyViewer(string skin, string appearance)
    {
        var previous = viewerWork;
        viewerWork = ReplaceViewer(previous, WebViewerPreferences.DocumentStartScript(skin, appearance));
    }

    private async Task ReplaceViewer(Task previous, string script)
    {
        try
        {
            await previous;
            await started;
            if (IsDisposed || web.IsDisposed || web.CoreWebView2 is not { } core) return;
            if (viewerScript is not null) core.RemoveScriptToExecuteOnDocumentCreated(viewerScript);
            viewerScript = await core.AddScriptToExecuteOnDocumentCreatedAsync(script);
            if (!IsDisposed && !web.IsDisposed) await core.ExecuteScriptAsync(script);
        }
        catch { }
    }

    internal async Task<string> RunScriptForTest(string script)
    {
        if (IsDisposed || web.IsDisposed || web.CoreWebView2 is null) return "unavailable";
        return await web.CoreWebView2.ExecuteScriptAsync(script);
    }

    internal void NavigateForTest(string uri)
    {
        if (IsDisposed || web.IsDisposed || web.CoreWebView2 is null) return;
        web.CoreWebView2.Navigate(uri);
    }

    internal async void SnapshotChanged()
    {
        try
        {
            if (IsDisposed || web.IsDisposed || !started.IsCompletedSuccessfully || web.CoreWebView2 is null) return;
            await web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new Event('observatory:snapshot-changed'))");
        }
        catch { }
    }

    // Measurement helpers for --panel-timing. They only read facts about the drawn page.
    internal async Task<string> Describe()
    {
        await started;
        for (var attempt = 0; attempt < 200; attempt++)
        {
            if (IsDisposed || web.IsDisposed || web.CoreWebView2 is null) return "unavailable";
            var facts = await web.CoreWebView2.ExecuteScriptAsync("""
                JSON.stringify({page: location.pathname, ready: window.observatoryDashboardReady === true,
                  width: innerWidth, height: innerHeight, dark: matchMedia('(prefers-color-scheme: dark)').matches,
                  font: getComputedStyle(document.querySelector('main') ?? document.body).fontFamily, textLength: document.body.innerText.length})
                """);
            if (facts.Contains("\\\"ready\\\":true", StringComparison.Ordinal)) { drawn = true; return facts; }
            await Task.Delay(50);
        }
        return IsDisposed || web.IsDisposed ? "unavailable" : "not ready";
    }

    internal async Task SavePreview(string file)
    {
        if (IsDisposed || web.IsDisposed || web.CoreWebView2 is null) return;
        using var stream = File.Create(file);
        await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
    }

    internal static readonly string[] Fragments = ["limits", "activity", "tokens", "dictation", "sources", "settings", "setup"];

    internal static bool AllowsNavigation(string uri)
    {
        if (!Uri.TryCreate(uri, UriKind.Absolute, out var parsed) ||
            parsed.Scheme != "https" || parsed.Host != "observatory.invalid" || !parsed.IsDefaultPort ||
            parsed.UserInfo.Length != 0 || parsed.AbsolutePath != "/" + Page || parsed.Query.Length != 0 ||
            uri.Contains('?') || uri.Contains("%00", StringComparison.Ordinal) || uri.Contains('\\') || uri.Contains('\0')) return false;
        // Uri can normalize escaped unreserved characters in the path.
        var pathStart = uri.IndexOf('/', uri.IndexOf("://", StringComparison.Ordinal) + 3);
        var fragmentStart = uri.IndexOf('#');
        var pathEnd = fragmentStart < 0 ? uri.Length : fragmentStart;
        if (pathStart < 0 || pathStart > pathEnd || uri[pathStart..pathEnd].Contains('%')) return false;
        return parsed.Fragment.Length == 0 ||
            (parsed.Fragment.Length > 1 && Array.IndexOf(Fragments, parsed.Fragment[1..]) >= 0);
    }

    internal static void SelfTest()
    {
        static void Check(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException("Web dashboard contract failed: " + message);
        }
        Check(AllowsNavigation(WebPanel.Origin + "/" + Page), "accepts dashboard");
        foreach (var fragment in Fragments)
            Check(AllowsNavigation(WebPanel.Origin + "/" + Page + "#" + fragment), "accepts fragment " + fragment);
        foreach (var (uri, message) in new (string, string)[]
        {
            (WebPanel.Origin + "/dashboard.html?demo", "demo query"),
            (WebPanel.Origin + "/dashboard.html?", "bare query"),
            (WebPanel.Origin + "/dashboard.html?x=1#limits", "query with fragment"),
            (WebPanel.Origin + "/dashboard.html#unknown", "unknown fragment"),
            (WebPanel.Origin + "/dashboard.html#Limits", "fragment case"),
            (WebPanel.Origin + "/dashboard.html#", "empty fragment"),
            (WebPanel.Origin + "/dashboard.html#limits/x", "fragment suffix"),
            (WebPanel.Origin + "/panel.html", "panel page"),
            (WebPanel.Origin + "/index.html", "index page"),
            (WebPanel.Origin + "/Dashboard.html", "page case"),
            (WebPanel.Origin + "/dashboard.html/", "trailing slash"),
            (WebPanel.Origin + "/assets/dashboard.html", "nested dashboard"),
            (WebPanel.Origin + "/assets/x.html", "asset HTML"),
            (WebPanel.Origin + "/dashboard%2Ehtml", "escaped dot"),
            (WebPanel.Origin + "/dashboard.html%00", "encoded NUL"),
            ("http://observatory.invalid/dashboard.html", "HTTP scheme"),
            ("https://observatory.invalid:444/dashboard.html", "nondefault port"),
            ("https://user@observatory.invalid/dashboard.html", "user info"),
            ("https://example.com/dashboard.html", "external host"),
            ("file:///C:/dashboard.html", "file scheme"),
            ("about:blank", "blank page"),
            ("", "empty URI"),
            ("not a uri", "invalid URI"),
            (WebPanel.Origin + "/dashboard.html#limits\0", "literal NUL"),
            (WebPanel.Origin + "\\dashboard.html", "backslash"),
        }) Check(!AllowsNavigation(uri), "refuses " + message);
        Check(WebPanel.RequestPath(WebPanel.Origin + "/dashboard.html?demo", Page) is null, "refuses dashboard resource demo query");
        Check(WebPanel.RequestPath(WebPanel.Origin + "/assets/x.js?v=1", Page) is null, "refuses asset resource query");
        var runtime = Path.Combine(Path.GetTempPath(), "observatory-web-dashboard-" + Guid.NewGuid().ToString("N"));
        var root = Path.Combine(Path.GetTempPath(), "observatory-dashboard-web-fixture-" + Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(Path.Combine(root, "assets"));
            File.WriteAllText(Path.Combine(root, "assets", "x.html"), "<html>Fixture asset</html>");
            File.WriteAllText(Path.Combine(root, "panel.html"), "<html>Fixture panel</html>");
            Check(WebPanel.Resolve(runtime, "assets/x.html", Page, root) is null, "refuses asset HTML resource");
            Check(WebPanel.Resolve(runtime, "panel.html", Page, root) is null, "refuses panel resource");
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
        Console.WriteLine("Web dashboard navigation contracts passed.");
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { CloseBridge(); web.Dispose(); }
        base.Dispose(disposing);
    }
}
