using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Diagnostics;

namespace WorkspaceObservatory;

internal sealed class Dashboard : Form
{
    private const string Origin = "https://observatory.invalid";
    private readonly WebView2 web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(9, 9, 11) };
    private readonly string runtime;
    private readonly bool smokeTest;
    private readonly bool firstRunTest;

    internal Dashboard(string runtime, bool smokeTest = false, bool firstRunTest = false)
    {
        this.runtime = runtime;
        this.smokeTest = smokeTest;
        this.firstRunTest = firstRunTest;
        Text = "Observatory";
        Size = new Size(1150, 770);
        MinimumSize = new Size(800, 550);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(9, 9, 11);
        Controls.Add(web);
        Shown += async (_, _) => await Initialize();
        FormClosed += (_, _) => web.Dispose();
    }

    private async Task Initialize()
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
            core.Settings.IsWebMessageEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += (_, e) => Serve(environment, e);
            core.NavigationStarting += (_, e) =>
            {
                if (IsLocal(e.Uri)) return;
                e.Cancel = true;
                if (e.IsUserInitiated) OpenExternal(e.Uri);
            };
            core.NewWindowRequested += (_, e) => { e.Handled = true; if (e.IsUserInitiated) OpenExternal(e.Uri); };
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            core.DownloadStarting += (_, e) => e.Cancel = true;
            core.Navigate(Origin + "/index.html");
            if (smokeTest)
            {
                var passed = false;
                for (var attempt = 0; attempt < 100 && !IsDisposed; attempt++)
                {
                    await Task.Delay(200);
                    if (IsDisposed) return;
                    var ready = await core.ExecuteScriptAsync("Boolean(window.observatoryBundleReady && document.body.innerText.includes('Observatory'))");
                    if (ready != "true") continue;
                    if (firstRunTest)
                    {
                        if (File.Exists(Path.Combine(runtime, "public", "local", "usage.json"))) break;
                        var configured = File.Exists(Path.Combine(runtime, "collector.config.json"));
                        var expected = configured
                            ? "document.body.innerText.includes('Could not reload.') && !document.body.innerText.includes('Set up Windows collection')"
                            : "document.body.innerText.includes('Set up Windows collection') && !document.body.innerText.includes('Could not reload.')";
                        for (var poll = 0; poll < 60 && !IsDisposed; poll++)
                        {
                            if (await core.ExecuteScriptAsync(expected) == "true") { passed = true; break; }
                            await Task.Delay(200);
                        }
                        break;
                    }
                    // ExecuteScriptAsync does not await promises. Verify fetch through a completion flag.
                    await core.ExecuteScriptAsync("window.__observatoryTest = null; (async () => { const r = await fetch('/local/usage.json'); if (!r.ok) throw Error(); const d = await r.json(); for (const path of ['/private-sync/pairing.json', '/private-sync/setup.pending.json', '/assets/private-sync/setup.pending.json', '/assets/private-linked/secret.js', '/assets/%2e%2e/private-sync/pairing.json', '/local/../private-sync/setup.pending.json']) { try { const blocked = await fetch(path); if (blocked.ok) throw Error('Unexpected private route'); } catch (e) { if (e.message === 'Unexpected private route') throw e; } } return Boolean(d && d.schema === 2 && Array.isArray(d.tokens)); })().then(ok => { window.__observatoryTest = ok; }).catch(() => { window.__observatoryTest = false; });");
                    for (var poll = 0; poll < 25 && !IsDisposed; poll++)
                    {
                        await Task.Delay(200);
                        if (IsDisposed) return;
                        var fetched = await core.ExecuteScriptAsync("window.__observatoryTest");
                        if (fetched == "null") continue;
                        passed = fetched == "true";
                        break;
                    }
                    break;
                }
                var demo = Snapshot.Read(Path.Combine(runtime, "public", "local", "usage.json"))?["demo"];
                if (passed && demo is System.Text.Json.Nodes.JsonValue demoValue && demoValue.TryGetValue<bool>(out var synthetic) && synthetic)
                {
                    var visible = false;
                    for (var attempt = 0; attempt < 25 && !IsDisposed; attempt++)
                    {
                        if (await core.ExecuteScriptAsync("document.body.innerText.includes('Synthetic demo')") == "true") { visible = true; break; }
                        await Task.Delay(200);
                    }
                    if (!visible) passed = false;
                    else
                    {
                        // Capture this WebView only, and only when using explicit synthetic fixtures.
                        using var capture = File.Create(Path.Combine(runtime, "web-smoke.png"));
                        await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, capture);
                    }
                }
                Console.WriteLine(passed ? "web-smoke: ok" : "web-smoke: failed");
                Environment.ExitCode = passed ? 0 : 1;
                Close();
            }
        }
        catch (Exception error)
        {
            if (IsDisposed) return;
            if (smokeTest) { Console.WriteLine($"web-smoke: renderer unavailable ({error.GetType().Name}, 0x{error.HResult:X8})"); Environment.ExitCode = 1; Close(); return; }
            web.Visible = false;
            var label = new Label { Dock = DockStyle.Fill, ForeColor = Color.White, Padding = new Padding(30),
                Text = "The dashboard renderer could not start. Check that Microsoft Edge WebView2 Runtime is installed. Tracking is separate from this window." };
            Controls.Add(label);
        }
    }

    private static bool IsLocal(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
        uri.Scheme == "https" && uri.Host == "observatory.invalid" && uri.IsDefaultPort && uri.UserInfo.Length == 0;

    private static void OpenExternal(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != "https" ||
            uri.Host is not ("github.com" or "developers.openai.com")) return;
        Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
    }

    private void Serve(CoreWebView2Environment environment, CoreWebView2WebResourceRequestedEventArgs e)
    {
        const string policy = "Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff";
        try
        {
            if (e.Request.Method != "GET" || !IsLocal(e.Request.Uri)) throw new InvalidOperationException();
            var uri = new Uri(e.Request.Uri);
            var relative = Uri.UnescapeDataString(uri.AbsolutePath).TrimStart('/');
            if (relative.Length == 0) relative = "index.html";
            if (relative == "local/setup.json")
            {
                var configured = File.Exists(Path.Combine(runtime, "collector.config.json"));
                var json = System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(new { version = 1, platform = "windows", configured });
                e.Response = environment.CreateWebResourceResponse(new MemoryStream(json), 200, "OK", "Content-Type: application/json\r\n" + policy);
                return;
            }
            string file;
            if (relative is "local/usage.json" or "local/collector.json")
                file = Snapshot.DashboardFile(runtime, relative[6..]) ?? throw new InvalidOperationException();
            else
            {
                if (relative != "index.html" && !relative.StartsWith("assets/", StringComparison.Ordinal)) throw new InvalidOperationException();
                if (Path.GetExtension(relative).Equals(".json", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException();
                if (relative.Contains('\\') || relative.Contains(':') || relative.Contains('\0') || relative.Split('/').Contains("..")) throw new InvalidOperationException();
                file = Snapshot.UnlinkedFile(Path.Combine(AppContext.BaseDirectory, "Web"), relative) ?? throw new InvalidOperationException();
            }
            var info = new FileInfo(file);
            if (!info.Exists || info.Length > Snapshot.MaxBytes || info.Attributes.HasFlag(FileAttributes.ReparsePoint)) throw new InvalidOperationException();
            var mime = Path.GetExtension(file) switch
            {
                ".html" => "text/html", ".js" => "text/javascript", ".css" => "text/css", ".json" => "application/json",
                ".svg" => "image/svg+xml", ".png" => "image/png", ".woff2" => "font/woff2", _ => throw new InvalidOperationException()
            };
            e.Response = environment.CreateWebResourceResponse(new MemoryStream(File.ReadAllBytes(file)), 200, "OK", "Content-Type: " + mime + "\r\n" + policy);
        }
        catch { e.Response = environment.CreateWebResourceResponse(new MemoryStream(), 404, "Unavailable", policy); }
    }
}
