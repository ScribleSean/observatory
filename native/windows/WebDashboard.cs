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
    private readonly string page;
    private readonly Task started;

    internal WebDashboard(string runtime)
    {
        this.runtime = runtime;
        // The dashboard page is added by the viewer workstream. Until the web
        // bundle has it, the window shows the panel page through the same host.
        page = File.Exists(Path.Combine(AppContext.BaseDirectory, "Web", Page)) ? Page : WebPanel.Page;
        Text = "Observatory";
        Size = new Size(1150, 770);
        MinimumSize = new Size(800, 550);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = DashboardPalette.Background(false);
        Controls.Add(web);
        started = Start();
    }

    internal string ShownPage => page;

    // Closing the window disposes the form and its web view, which ends the
    // browser processes. Opening again creates a new window.
    private async Task Start()
    {
        try
        {
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(runtime, "WebViewCache"));
            if (IsDisposed) return;
            await web.EnsureCoreWebView2Async(environment);
            if (IsDisposed) return;
            var core = web.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreHostObjectsAllowed = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            // No action reaches the app from this window until the settings
            // bridge contract exists. The page only reads the snapshot.
            core.Settings.IsWebMessageEnabled = false;
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += (_, e) => WebPanel.Respond(environment, e, runtime, page);
            core.NavigationStarting += (_, e) => { if (!WebPanel.IsPage(e.Uri, page)) e.Cancel = true; };
            core.NewWindowRequested += (_, e) => e.Handled = true;
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            core.DownloadStarting += (_, e) => e.Cancel = true;
            core.Navigate(WebPanel.Origin + "/" + page);
        }
        catch
        {
            if (IsDisposed) return;
            web.Visible = false;
            Controls.Add(new Label { Dock = DockStyle.Fill, ForeColor = DashboardPalette.Text(false), Padding = new Padding(30),
                Text = "The dashboard could not start. Check that Microsoft Edge WebView2 Runtime is installed. Collection is separate from this window." });
        }
    }

    internal async void SnapshotChanged()
    {
        try
        {
            if (IsDisposed || !started.IsCompletedSuccessfully || web.CoreWebView2 is null) return;
            await web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new Event('observatory:snapshot-changed'))");
        }
        catch { }
    }

    // Measurement helpers for --panel-timing. They only read facts about the drawn page.
    internal async Task<string> Describe()
    {
        await started;
        for (var attempt = 0; attempt < 200 && !IsDisposed && web.CoreWebView2 is not null; attempt++)
        {
            var facts = await web.CoreWebView2.ExecuteScriptAsync("""
                JSON.stringify({page: location.pathname, ready: window.observatoryPanelReady === true || window.observatoryDashboardReady === true,
                  width: innerWidth, height: innerHeight, dark: matchMedia('(prefers-color-scheme: dark)').matches,
                  font: getComputedStyle(document.querySelector('main') ?? document.body).fontFamily, textLength: document.body.innerText.length})
                """);
            if (facts.Contains("\\\"ready\\\":true", StringComparison.Ordinal)) return facts;
            await Task.Delay(50);
        }
        return "not ready";
    }

    internal async Task SavePreview(string file)
    {
        if (IsDisposed || web.CoreWebView2 is null) return;
        using var stream = File.Create(file);
        await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) web.Dispose();
        base.Dispose(disposing);
    }
}
