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
            timeout.Tick += (_, _) => Finish(step + ": fixture timed out after 89 s");
            timeout.Start();
            start.Start();
        }

        private void Passed()
        {
            stop.Token.ThrowIfCancellationRequested();
            Console.WriteLine("web-hosts: passed " + step);
        }

        private sealed class FixtureCheckFailed(string detail) : Exception
        {
            internal string Detail { get; } = detail;
        }

        private static void Require(bool condition, string check)
        {
            if (!condition) throw new FixtureCheckFailed(check);
        }

        private async Task RequireScript(Func<string, Task<string>> script, string expression, string check, string expected = "true")
        {
            var value = await script(expression).WaitAsync(stop.Token);
            Require(value == expected, check + ": received " + WebPanel.Untrusted(value, 2048) + ", expected " + expected);
        }

        private async Task Execute()
        {
            try
            {
                Console.WriteLine("WebView2 runtime: " + CoreWebView2Environment.GetAvailableBrowserVersionString());
                Passed();

                step = "bundle";
                Require(WebPanel.Resolve(folder, WebPanel.Page) is not null, "panel bundle page was missing, expected panel.html");
                Require(WebPanel.Resolve(folder, WebDashboard.Page, WebDashboard.Page) is not null,
                    "dashboard bundle page was missing, expected dashboard.html");
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
                Require(await panel.ShowNearTray().WaitAsync(stop.Token), "panel did not report ready, expected true");
                Passed();

                step = "panel-actions";
                await panel.RunScriptForTest("""
                    chrome.webview.postMessage({panelAction:'quit'});
                    chrome.webview.postMessage({panelAction:'refresh', extra:1});
                    chrome.webview.postMessage({panelAction:'refresh'});
                    """).WaitAsync(stop.Token);
                await Task.Delay(3000, stop.Token);
                Require(actions.SequenceEqual(new[] { "refresh" }), "actions were [" + string.Join(",", actions) + "], expected [refresh]");
                Passed();

                step = "panel-boundary";
                await CheckBoundary(panel.RunScriptForTest, dashboard: false);
                Passed();

                step = "panel-release";
                panel.Hide();
                await Poll(() => Task.FromResult(panel.IsDisposed.ToString()), value => value == "True", 5, "panel disposal, expected True");
                Passed();

                step = "panel-failed-start";
                var failedPanel = new WebPanel(folder, action => actions.Add(action), releaseAfter: TimeSpan.FromSeconds(1),
                    startOverride: () => Task.FromException(new InvalidOperationException("synthetic start failure"))) { KeepOpen = true };
                forms.Add(failedPanel);
                Require(!await failedPanel.ShowNearTray().WaitAsync(stop.Token), "failed panel reported ready, expected false");
                Require(failedPanel.FailedToStart, "failed panel FailedToStart was false, expected true");
                await Poll(() => Task.FromResult(failedPanel.IsDisposed.ToString()), value => value == "True", 3, "failed panel disposal, expected True");
                Passed();

                step = "dashboard-ready";
                var host = new FakeHost(folder);
                using var handler = new BridgeHandler(host, folder);
                var dashboard = new WebDashboard(folder, handler);
                forms.Add(dashboard);
                dashboard.Show();
                await Poll(() => dashboard.RunScriptForTest("window.observatoryDashboardReady === true").WaitAsync(stop.Token),
                    value => value == "true", 15, "dashboard ready flag, expected true");
                await RequireScript(dashboard.RunScriptForTest, "location.pathname", "dashboard path after initial navigation", "\"/dashboard.html\"");
                await CheckSkin(dashboard.RunScriptForTest);
                Passed();

                step = "dashboard-boundary";
                await CheckBoundary(dashboard.RunScriptForTest, dashboard: true);
                await dashboard.RunScriptForTest("location.href = './panel.html'").WaitAsync(stop.Token);
                await Task.Delay(1000, stop.Token);
                await RequireScript(dashboard.RunScriptForTest, "location.pathname", "dashboard path after panel.html request", "\"/dashboard.html\"");
                await dashboard.RunScriptForTest("location.replace('./dashboard.html?x')").WaitAsync(stop.Token);
                await Task.Delay(1000, stop.Token);
                await RequireScript(dashboard.RunScriptForTest, "location.pathname", "dashboard path after dashboard.html?x request", "\"/dashboard.html\"");
                await RequireScript(dashboard.RunScriptForTest, "location.search", "dashboard query after dashboard.html?x request", "\"\"");
                // A host Navigate that only changes the fragment is a same-document change,
                // so the cross-document case uses a query that the guard must refuse.
                dashboard.NavigateForTest(WebPanel.Origin + "/dashboard.html?demo#unknown");
                await Task.Delay(1000, stop.Token);
                await RequireScript(dashboard.RunScriptForTest, "location.search", "dashboard query after host dashboard.html?demo#unknown request", "\"\"");
                var fragment = await dashboard.RunScriptForTest("location.hash").WaitAsync(stop.Token);
                Require(fragment != "\"#unknown\"", "dashboard fragment after host dashboard.html?demo#unknown request was " +
                    WebPanel.Untrusted(fragment, 2048) + ", expected a fragment other than #unknown");
                // This same-document change is not seen by NavigationStarting.
                await dashboard.RunScriptForTest("location.hash = '#tokens'").WaitAsync(stop.Token);
                await Poll(() => dashboard.RunScriptForTest("location.hash === '#tokens'").WaitAsync(stop.Token),
                    value => value == "true", 3, "tokens fragment navigation, expected true");
                Passed();

                step = "bridge-status";
                const string listen = "window.bridgeResults = []; chrome.webview.addEventListener('message', event => { if (event.data?.bridgeResult) window.bridgeResults.push(event.data.bridgeResult); })";
                await dashboard.RunScriptForTest(listen).WaitAsync(stop.Token);
                await dashboard.RunScriptForTest("chrome.webview.postMessage(JSON.stringify({id:7,action:'status',args:{}}))").WaitAsync(stop.Token);
                await Poll(() => dashboard.RunScriptForTest("window.bridgeResults.some(r => r.id === 7 && r.ok === true && r.code === 'done' && r.value?.version === 1)").WaitAsync(stop.Token),
                    value => value == "true", 5, "status request 7 returned ok with code done and version 1, expected true");
                Passed();

                step = "bridge-section";
                var documentNumber = dashboard.DocumentNumber;
                dashboard.ShowSection("settings");
                await Poll(() => dashboard.RunScriptForTest("location.hash === '#settings'").WaitAsync(stop.Token),
                    value => value == "true", 3, "settings fragment navigation, expected true");
                Require(dashboard.DocumentNumber == documentNumber, "settings navigation document number was " + dashboard.DocumentNumber + ", expected " + documentNumber);
                await dashboard.RunScriptForTest("chrome.webview.postMessage(JSON.stringify({id:12,action:'status',args:{}}))").WaitAsync(stop.Token);
                await Poll(() => dashboard.RunScriptForTest("window.bridgeResults.some(r => r.id === 12 && r.ok === true && r.code === 'done')").WaitAsync(stop.Token),
                    value => value == "true", 5, "status request 12 returned ok with code done, expected true");
                Passed();

                step = "bridge-ignored";
                await dashboard.RunScriptForTest("""
                    chrome.webview.postMessage({id:8,action:'status',args:{}});
                    chrome.webview.postMessage(JSON.stringify({id:10,action:'status',args:{}}) + ' '.repeat(4097));
                    chrome.webview.postMessage('{"id":9,"action":"quit","args":{}}');
                    """).WaitAsync(stop.Token);
                await Poll(() => dashboard.RunScriptForTest("window.bridgeResults.some(r => r.id === 9 && r.ok === false && r.code === 'refused')").WaitAsync(stop.Token),
                    value => value == "true", 5, "quit request 9 returned not ok with code refused, expected true");
                await Task.Delay(300, stop.Token);
                await RequireScript(dashboard.RunScriptForTest, "!window.bridgeResults.some(r => r.id === 8 || r.id === 10)", "object request 8 and oversized request 10 ignored");
                Passed();

                step = "bridge-panel";
                var bridgePanel = new WebPanel(folder, action => actions.Add(action)) { KeepOpen = true };
                forms.Add(bridgePanel);
                Require(await bridgePanel.ShowNearTray().WaitAsync(stop.Token), "bridge panel did not report ready, expected true");
                var hostCalls = host.Calls;
                var received = handler.ReceivedCount;
                await bridgePanel.RunScriptForTest("chrome.webview.postMessage(JSON.stringify({id:7,action:'status',args:{}}))").WaitAsync(stop.Token);
                await Task.Delay(300, stop.Token);
                Require(host.Calls == hostCalls, "panel status request host calls were " + host.Calls + ", expected " + hostCalls);
                Require(handler.ReceivedCount == received, "panel status request bridge received count was " + handler.ReceivedCount + ", expected " + received);
                bridgePanel.Retire();
                Passed();

                step = "bridge-document";
                host.RefreshWait = new(TaskCreationOptions.RunContinuationsAsynchronously);
                await dashboard.RunScriptForTest("chrome.webview.postMessage(JSON.stringify({id:11,action:'refresh',args:{}}))").WaitAsync(stop.Token);
                await Poll(() => Task.FromResult(host.RefreshStarted.ToString()), value => value == "True", 5, "refresh request started, expected True");
                await dashboard.RunScriptForTest("location.reload()").WaitAsync(stop.Token);
                await Poll(() => dashboard.RunScriptForTest("window.observatoryDashboardReady === true && typeof window.bridgeResults === 'undefined'").WaitAsync(stop.Token),
                    value => value == "true", 15, "reloaded dashboard ready with no prior bridge results, expected true");
                await dashboard.RunScriptForTest(listen).WaitAsync(stop.Token);
                host.RefreshWait.SetResult(true);
                await handler.WhenIdle.WaitAsync(stop.Token);
                await Task.Delay(300, stop.Token);
                await RequireScript(dashboard.RunScriptForTest, "!window.bridgeResults.some(r => r.id === 11)", "refresh request 11 reply absent after document reload");
                Passed();

                step = "dashboard-release";
                dashboard.Close();
                await Poll(() => Task.FromResult(dashboard.IsDisposed.ToString()), value => value == "True", 3, "dashboard disposal, expected True");
                Passed();
                Finish(null);
            }
            catch (FixtureCheckFailed failure) { Finish(step + ": " + failure.Detail); }
            catch (Exception error) { Finish(step + ": " + error.GetType().Name); }
        }

        private async Task Poll(Func<Task<string>> read, Func<string, bool> accept, int seconds, string check)
        {
            var deadline = Environment.TickCount64 + seconds * 1000;
            var last = "Unknown";
            FixtureCheckFailed TimedOut() => new(check + ": timed out after " + seconds +
                " s, last result " + WebPanel.Untrusted(last, 2048));
            while (true)
            {
                stop.Token.ThrowIfCancellationRequested();
                var remaining = deadline - Environment.TickCount64;
                if (remaining <= 0) throw TimedOut();
                try
                {
                    last = await read().WaitAsync(TimeSpan.FromMilliseconds(remaining), stop.Token);
                }
                catch (TimeoutException) { throw TimedOut(); }
                if (accept(last)) return;
                await Task.Delay(50, stop.Token);
            }
        }

        private async Task CheckSkin(Func<string, Task<string>> script)
        {
            var skin = await script("document.documentElement.dataset.skin").WaitAsync(stop.Token);
            Require(WebViewerPreferences.Skins.Contains(JsonSerializer.Deserialize<string>(skin)),
                "skin was " + WebPanel.Untrusted(skin, 2048) + ", expected one of [" + string.Join(",", WebViewerPreferences.Skins) + "]");
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
                    const requests = []
                    const failures = []
                    async function request(path) {
                        try {
                            const response = await fetch(path)
                            requests.push({path, status: response.status, ok: response.ok})
                            return response
                        } catch (error) {
                            requests.push({path, status: 'network error: ' + error.name, ok: false})
                            return null
                        }
                    }
                    for (const path of blocked) {
                        await request(path)
                        const entry = requests[requests.length - 1]
                        if (entry.ok) failures.push({path, received: entry.status, expected: 'refused'})
                    }
                    const assetPath = './assets/' + asset
                    await request(assetPath)
                    const assetEntry = requests[requests.length - 1]
                    if (assetEntry.status !== 200) failures.push({path: assetPath, received: assetEntry.status, expected: 200})
                    const snapshotPath = './local/usage.json'
                    const response = await request(snapshotPath)
                    const snapshotEntry = requests[requests.length - 1]
                    if (snapshotEntry.status !== 200) failures.push({path: snapshotPath, received: snapshotEntry.status, expected: 200})
                    let parsed = false
                    let smokeTest = false
                    if (response) {
                        try {
                            const snapshot = await response.json()
                            parsed = true
                            smokeTest = snapshot?.smokeTest === true
                        } catch {}
                    }
                    snapshotEntry.parsed = parsed
                    snapshotEntry.smokeTest = smokeTest
                    if (!parsed || !smokeTest) failures.push({path: snapshotPath,
                        received: {parsed, smokeTest}, expected: {parsed: true, smokeTest: true}})
                    window.webHostsResult = JSON.stringify({passed: failures.length === 0, failures})
                } catch (e) {
                    window.webHostsResult = JSON.stringify({passed: false,
                        failures: [{path: 'script', received: 'error: ' + e.name, expected: 'no error'}]})
                }
                })()
                """).WaitAsync(stop.Token);
            await Poll(() => script("typeof window.webHostsResult === 'string'").WaitAsync(stop.Token),
                value => value == "true", 10, "boundary result available as string, expected true");
            var encoded = await script("window.webHostsResult").WaitAsync(stop.Token);
            var json = JsonSerializer.Deserialize<string>(encoded);
            Require(json is not null, "boundary result was " + WebPanel.Untrusted(encoded, 2048) + ", expected a JSON result string");
            using var result = JsonDocument.Parse(json!);
            if (!result.RootElement.GetProperty("passed").GetBoolean())
            {
                var failures = result.RootElement.GetProperty("failures").EnumerateArray().Select(failure =>
                    failure.GetProperty("path").GetString() + " returned " + failure.GetProperty("received") +
                    ", expected " + failure.GetProperty("expected"));
                throw new FixtureCheckFailed(string.Join(" | ", failures));
            }
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
                catch (Exception error) { failure ??= step + ": dispose " + error.GetType().Name; }
            }
            var line = failure is null ? "web-hosts: passed" : "web-hosts: failed " + WebPanel.Untrusted(failure, 2048);
            Environment.ExitCode = failure is null ? 0 : 1;
            try
            {
                File.WriteAllText(Path.Combine(folder, "web-hosts-result.txt"), line + Environment.NewLine);
            }
            catch (Exception error)
            {
                Environment.ExitCode = 1;
                var detail = (failure is null ? "" : failure + " | ") + "result-file: " + error.GetType().Name;
                line = "web-hosts: failed " + WebPanel.Untrusted(detail, 2048);
            }
            finally
            {
                try { Console.WriteLine(line); }
                finally { ExitThread(); }
            }
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
