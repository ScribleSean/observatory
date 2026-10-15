using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace WorkspaceObservatory;

// The shared viewer in the main window. Shown only with --web-dashboard. The
// native dashboard stays the default and is not used or changed by this class.
internal sealed class WebDashboard : Form
{
    internal const string Page = "dashboard.html";
    private readonly WebView2 web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = DashboardPalette.Background(false) };
    private readonly string runtime;
    private readonly Task started;

    internal WebDashboard(string runtime)
    {
        this.runtime = runtime;
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
            // No action reaches the app from this window until the settings
            // bridge contract exists. The page only reads the snapshot.
            core.Settings.IsWebMessageEnabled = false;
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += (_, e) => WebPanel.Respond(environment, e, runtime, Page);
            core.NavigationStarting += (_, e) => { if (!AllowsNavigation(e.Uri)) e.Cancel = true; };
            core.FrameNavigationStarting += (_, e) => e.Cancel = true;
            core.NewWindowRequested += (_, e) => e.Handled = true;
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            core.DownloadStarting += (_, e) => e.Cancel = true;
            // Read once per web view. Changes apply when the next window is created.
            var (skin, theme) = WebViewerPreferences.Read(runtime);
            await core.AddScriptToExecuteOnDocumentCreatedAsync(WebViewerPreferences.DocumentStartScript(skin, theme));
            if (IsDisposed || web.IsDisposed) return;
            core.Navigate(WebPanel.Origin + "/" + Page);
        }
        catch
        {
            if (IsDisposed || web.IsDisposed) return;
            ShowError("The dashboard could not start. Check that Microsoft Edge WebView2 Runtime is installed. Collection is separate from this window.");
        }
    }

    private void ShowError(string message)
    {
        Controls.Remove(web);
        web.Dispose();
        Controls.Add(new Label { Dock = DockStyle.Fill, ForeColor = DashboardPalette.Text(false), Padding = new Padding(30),
            Text = message });
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
            if (facts.Contains("\\\"ready\\\":true", StringComparison.Ordinal)) return facts;
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
        if (disposing) web.Dispose();
        base.Dispose(disposing);
    }
}
