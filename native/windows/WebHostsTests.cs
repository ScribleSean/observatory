using Microsoft.Web.WebView2.Core;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Diagnostics;

namespace WorkspaceObservatory;

// This fixture briefly shows the panel and dashboard window on screen.
// Run it on Windows outside a Claude desktop session.
internal static class WebHostsTests
{
    internal static string RuntimeVersion()
    {
        try { return CoreWebView2Environment.GetAvailableBrowserVersionString(); }
        catch { return "Unknown"; }
    }

    internal static void Run(string folder)
    {
        using var context = new FixtureContext(folder);
        Application.Run(context);
    }

    internal sealed class FakeHost(string runtime) : IBridgeHost
    {
        internal int Calls;
        internal TaskCompletionSource<bool>? RefreshWait;
        internal bool RefreshStarted;
        private readonly BridgeSettingsStore settings = new(runtime);
        public BridgeSettingsStore Settings { get { Calls++; return settings; } }
        public DateTimeOffset Now => new(2026, 10, 14, 12, 0, 0, TimeSpan.Zero);
        public Version? AppVersion => new(1, 2, 3, 4);
        public bool CollectorBusy => false;
        public bool CollectionPaused => false;
        public bool RuntimeOverride => false;
        public void CompleteSetup() => ShellBridgeHost.CompleteSetup(runtime, () => CollectionPaused, StartCollector);
        public bool NativePairingOpen => false;
        public bool NativeDialogOpen => false;
        public bool Confirm(string title, string text) { Calls++; return false; }
        public string? ChooseExportFile() { Calls++; return null; }
        public void CopyInvitation(string invitation) => throw new InvalidOperationException("Unexpected fixture action.");
        public Task RefreshAllowancesThenAll()
        { Calls++; RefreshStarted = true; return (Task?)RefreshWait?.Task ?? Task.CompletedTask; }
        public Task Refresh() { Calls++; return Task.CompletedTask; }
        public Task CheckUpdates() { Calls++; return Task.CompletedTask; }
        public void OpenDashboard(string section) { Calls++; }
        public JsonObject ReadConfiguration() { Calls++; return new() { ["activity"] = true }; }
        public void UpdateConfiguration(JsonObject expected, JsonObject desired) => throw new InvalidOperationException("Unexpected fixture action.");
        public void StartCollector() => throw new InvalidOperationException("Unexpected fixture action.");
        public bool ReadStartup() { Calls++; return false; }
        public void SetStartup(bool enabled) => throw new InvalidOperationException("Unexpected fixture action.");
        public Task<QuotaSharingStatus> Sharing(string action, string? token, SharingChannel channel)
        { Calls++; return Task.FromResult(new QuotaSharingStatus(false, false, "pairing-unavailable", null)); }
        public Action<bool> BeginDirectPairing() => throw new InvalidOperationException("Unexpected fixture action.");
        public IBridgePairingSession CreatePairingSession() => throw new InvalidOperationException("Unexpected fixture action.");
        public Task DisconnectPairing() => throw new InvalidOperationException("Unexpected fixture action.");
        public Task PreparePairingRepair() => throw new InvalidOperationException("Unexpected fixture action.");
        public Task<BridgeScriptResult> RunScript(ProcessStartInfo start) => throw new InvalidOperationException("Unexpected fixture action.");
        public Task<string> ReadTailscaleStatus() { Calls++; return Task.FromResult("unavailable"); }
    }

    private sealed class FixtureContext : ApplicationContext
    {
        private readonly string folder;
        private readonly List<Form> forms = new();
        private readonly List<string> actions = new();
        private readonly CancellationTokenSource stop = new();
        private readonly System.Windows.Forms.Timer start = new() { Interval = 1 };
        private readonly System.Windows.Forms.Timer timeout = new() { Interval = 89_000 };
        private string step = "runtime";
        private bool finished;

        internal FixtureContext(string folder)
        {
            this.folder = folder;
            start.Tick += async (_, _) =>
            {
                start.Stop();
                await Execute();
            };
            timeout.Tick += (_, _) => Finish("timeout");
            timeout.Start();
            start.Start();
        }

        private void Passed()
        {
            stop.Token.ThrowIfCancellationRequested();
            Console.WriteLine("web-hosts: passed " + step);
        }

        private static void Require(bool condition)
        {
            if (!condition) throw new InvalidOperationException("Fixture check failed.");
        }

        private async Task Execute()
        {
            try
            {
                Console.WriteLine("WebView2 runtime: " + CoreWebView2Environment.GetAvailableBrowserVersionString());
                Passed();

                step = "bundle";
                Require(WebPanel.Resolve(folder, WebPanel.Page) is not null &&
                    WebPanel.Resolve(folder, WebDashboard.Page, WebDashboard.Page) is not null);
                Passed();

                step = "snapshot";
                new BridgeSettingsStore(folder).WriteViewer("sage", "system");
                var local = Path.Combine(folder, "public", "local");
                Directory.CreateDirectory(local);
                File.WriteAllText(Path.Combine(local, "usage.json"), """
                    {"schema":2,"collectedAt":"2026-09-08T12:00:00Z","demo":true,"smokeTest":true,"activity":[],"tokens":[],"agents":[],"dictation":[]}
                    """);
                File.WriteAllText(Path.Combine(local, "collector.json"), """{"state":"ok"}""");
                Passed();

                step = "panel-ready";
                var panel = new WebPanel(folder, action => actions.Add(action), releaseAfter: TimeSpan.FromSeconds(1)) { KeepOpen = true };
                forms.Add(panel);
                Require(await panel.ShowNearTray().WaitAsync(stop.Token));
                Passed();

                step = "panel-actions";
                await panel.RunScriptForTest("""
                    chrome.webview.postMessage({panelAction:'quit'});
                    chrome.webview.postMessage({panelAction:'refresh', extra:1});
                    chrome.webview.postMessage({panelAction:'refresh'});
                    """).WaitAsync(stop.Token);
                await Task.Delay(3000, stop.Token);
                Require(actions.SequenceEqual(new[] { "refresh" }));
                Passed();

                step = "panel-boundary";
                await CheckBoundary(panel.RunScriptForTest, dashboard: false);
                Passed();

                step = "panel-release";
                panel.Hide();
                await Poll(() => Task.FromResult(panel.IsDisposed), 5);
                Passed();

                step = "panel-failed-start";
                var failedPanel = new WebPanel(folder, action => actions.Add(action), releaseAfter: TimeSpan.FromSeconds(1),
                    startOverride: () => Task.FromException(new InvalidOperationException("synthetic start failure"))) { KeepOpen = true };
                forms.Add(failedPanel);
                Require(!await failedPanel.ShowNearTray().WaitAsync(stop.Token));
                Require(failedPanel.FailedToStart);
                await Poll(() => Task.FromResult(failedPanel.IsDisposed), 3);
                Passed();

                step = "dashboard-ready";
                var host = new FakeHost(folder);
                using var handler = new BridgeHandler(host, folder);
                var dashboard = new WebDashboard(folder, handler);
                forms.Add(dashboard);
                dashboard.Show();
                await Poll(async () => await dashboard.RunScriptForTest("window.observatoryDashboardReady === true") == "true", 15);
                Require(await dashboard.RunScriptForTest("location.pathname === '/dashboard.html'").WaitAsync(stop.Token) == "true");
                await CheckSkin(dashboard.RunScriptForTest);
                Passed();

                step = "dashboard-boundary";
                await CheckBoundary(dashboard.RunScriptForTest, dashboard: true);
                await dashboard.RunScriptForTest("location.href = './panel.html'").WaitAsync(stop.Token);
                await Task.Delay(1000, stop.Token);
                Require(await dashboard.RunScriptForTest("location.pathname === '/dashboard.html'").WaitAsync(stop.Token) == "true");
                await dashboard.RunScriptForTest("location.replace('./dashboard.html?x')").WaitAsync(stop.Token);
                await Task.Delay(1000, stop.Token);
                Require(await dashboard.RunScriptForTest("location.pathname === '/dashboard.html' && location.search === ''").WaitAsync(stop.Token) == "true");
                // A host Navigate that only changes the fragment is a same-document change,
                // so the cross-document case uses a query that the guard must refuse.
                dashboard.NavigateForTest(WebPanel.Origin + "/dashboard.html?demo#unknown");
                await Task.Delay(1000, stop.Token);
                Require(await dashboard.RunScriptForTest("location.search === '' && location.hash !== '#unknown'").WaitAsync(stop.Token) == "true");
                // This same-document change is not seen by NavigationStarting.
                await dashboard.RunScriptForTest("location.hash = '#tokens'").WaitAsync(stop.Token);
                await Poll(async () => await dashboard.RunScriptForTest("location.hash === '#tokens'") == "true", 3);
                Passed();

                step = "bridge-status";
                const string listen = "window.bridgeResults = []; chrome.webview.addEventListener('message', event => { if (event.data?.bridgeResult) window.bridgeResults.push(event.data.bridgeResult); })";
                await dashboard.RunScriptForTest(listen).WaitAsync(stop.Token);
                await dashboard.RunScriptForTest("chrome.webview.postMessage(JSON.stringify({id:7,action:'status',args:{}}))").WaitAsync(stop.Token);
                await Poll(async () => await dashboard.RunScriptForTest("window.bridgeResults.some(r => r.id === 7 && r.ok === true && r.code === 'done' && r.value?.version === 1)") == "true", 5);
                Passed();

                step = "bridge-section";
                var documentNumber = dashboard.DocumentNumber;
                dashboard.ShowSection("settings");
                await Poll(async () => await dashboard.RunScriptForTest("location.hash === '#settings'") == "true", 3);
                Require(dashboard.DocumentNumber == documentNumber);
                await dashboard.RunScriptForTest("chrome.webview.postMessage(JSON.stringify({id:12,action:'status',args:{}}))").WaitAsync(stop.Token);
                await Poll(async () => await dashboard.RunScriptForTest("window.bridgeResults.some(r => r.id === 12 && r.ok === true && r.code === 'done')") == "true", 5);
                Passed();

                step = "bridge-ignored";
                await dashboard.RunScriptForTest("""
                    chrome.webview.postMessage({id:8,action:'status',args:{}});
                    chrome.webview.postMessage(JSON.stringify({id:10,action:'status',args:{}}) + ' '.repeat(4097));
                    chrome.webview.postMessage('{"id":9,"action":"quit","args":{}}');
                    """).WaitAsync(stop.Token);
                await Poll(async () => await dashboard.RunScriptForTest("window.bridgeResults.some(r => r.id === 9 && r.ok === false && r.code === 'refused')") == "true", 5);
                await Task.Delay(300, stop.Token);
                Require(await dashboard.RunScriptForTest("!window.bridgeResults.some(r => r.id === 8 || r.id === 10)").WaitAsync(stop.Token) == "true");
                Passed();

                step = "bridge-panel";
                var bridgePanel = new WebPanel(folder, action => actions.Add(action)) { KeepOpen = true };
                forms.Add(bridgePanel);
                Require(await bridgePanel.ShowNearTray().WaitAsync(stop.Token));
                var hostCalls = host.Calls;
                var received = handler.ReceivedCount;
                await bridgePanel.RunScriptForTest("chrome.webview.postMessage(JSON.stringify({id:7,action:'status',args:{}}))").WaitAsync(stop.Token);
                await Task.Delay(300, stop.Token);
                Require(host.Calls == hostCalls && handler.ReceivedCount == received);
                bridgePanel.Retire();
                Passed();

                step = "bridge-document";
                host.RefreshWait = new(TaskCreationOptions.RunContinuationsAsynchronously);
                await dashboard.RunScriptForTest("chrome.webview.postMessage(JSON.stringify({id:11,action:'refresh',args:{}}))").WaitAsync(stop.Token);
                await Poll(() => Task.FromResult(host.RefreshStarted), 5);
                await dashboard.RunScriptForTest("location.reload()").WaitAsync(stop.Token);
                await Poll(async () => await dashboard.RunScriptForTest("window.observatoryDashboardReady === true && typeof window.bridgeResults === 'undefined'") == "true", 15);
                await dashboard.RunScriptForTest(listen).WaitAsync(stop.Token);
                host.RefreshWait.SetResult(true);
                await handler.WhenIdle.WaitAsync(stop.Token);
                await Task.Delay(300, stop.Token);
                Require(await dashboard.RunScriptForTest("!window.bridgeResults.some(r => r.id === 11)").WaitAsync(stop.Token) == "true");
                Passed();

                step = "dashboard-release";
                dashboard.Close();
                await Poll(() => Task.FromResult(dashboard.IsDisposed), 3);
                Passed();
                Finish(null);
            }
            catch { Finish(step); }
        }

        private async Task Poll(Func<Task<bool>> check, int seconds)
        {
            var deadline = Environment.TickCount64 + seconds * 1000;
            while (true)
            {
                stop.Token.ThrowIfCancellationRequested();
                var remaining = deadline - Environment.TickCount64;
                if (remaining <= 0) throw new TimeoutException();
                if (await check().WaitAsync(TimeSpan.FromMilliseconds(remaining), stop.Token)) return;
                await Task.Delay(50, stop.Token);
            }
        }

        private async Task CheckSkin(Func<string, Task<string>> script)
        {
            var skin = await script("document.documentElement.dataset.skin").WaitAsync(stop.Token);
            Require(WebViewerPreferences.Skins.Contains(JsonSerializer.Deserialize<string>(skin)));
        }

        private async Task CheckBoundary(Func<string, Task<string>> script, bool dashboard)
        {
            var asset = Path.GetFileName(Directory.EnumerateFiles(Path.Combine(AppContext.BaseDirectory, "Web", "assets"), "*.js").First());
            var assetPath = "./assets/" + asset;
            var blocked = new List<string>
            {
                "./local/collector.json", "./local/usage.json?x=1", assetPath + "/", assetPath + "%2F",
                assetPath + ".", assetPath + "%20", "./assets/" + asset.ToUpperInvariant(),
                dashboard ? "./panel.html" : "./dashboard.html", "./index.html", "./private-sync/pairing.json"
            };
            if (dashboard) blocked.Add("./dashboard.html?demo");
            // ExecuteScriptAsync does not await promises. Poll the stored JSON result.
            await script("window.webHostsResult = null; void (async () => {\n" +
                "const blocked = " + JsonSerializer.Serialize(blocked) + ";\n" +
                "const asset = " + JsonSerializer.Serialize(asset) + ";\n" + """
                try {
                    let denied = true;
                    for (const path of blocked) {
                        try { if ((await fetch(path)).ok) denied = false; } catch {}
                    }
                    const assetResponse = await fetch('./assets/' + asset);
                    const response = await fetch('./local/usage.json');
                    const snapshot = await response.json();
                    window.webHostsResult = JSON.stringify({passed: denied && assetResponse.ok && response.ok && snapshot.smokeTest === true});
                } catch {
                    window.webHostsResult = JSON.stringify({passed: false});
                }
                })()
                """).WaitAsync(stop.Token);
            await Poll(async () => await script("typeof window.webHostsResult === 'string'") == "true", 10);
            var encoded = await script("window.webHostsResult").WaitAsync(stop.Token);
            var json = JsonSerializer.Deserialize<string>(encoded);
            Require(json is not null);
            using var result = JsonDocument.Parse(json!);
            Require(result.RootElement.GetProperty("passed").GetBoolean());
            await CheckSkin(script);
        }

        private void Finish(string? failure)
        {
            if (finished) return;
            finished = true;
            start.Stop();
            timeout.Stop();
            stop.Cancel();
            foreach (var form in forms)
            {
                try { form.Dispose(); }
                catch { failure ??= step; }
            }
            var line = failure is null ? "web-hosts: passed" : "web-hosts: failed " + failure;
            Environment.ExitCode = failure is null ? 0 : 1;
            try
            {
                Console.WriteLine(line);
                File.WriteAllText(Path.Combine(folder, "web-hosts-result.txt"), line + Environment.NewLine);
            }
            catch
            {
                Environment.ExitCode = 1;
                Console.WriteLine("web-hosts: failed result-file");
            }
            finally { ExitThread(); }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                if (!finished) Finish(step);
                start.Dispose();
                timeout.Dispose();
                stop.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
