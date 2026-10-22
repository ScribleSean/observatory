// Built locally by `npm run setup` with the C# compiler that ships with Windows
// (.NET Framework 4), so it uses C# 5 syntax only.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("Observatory")]

namespace Observatory
{
    sealed class Settings
    {
        public string node;
        public string repo;
        public string config;
        public string dataFolder;
        public int port;
    }

    sealed class Glance : ApplicationContext
    {
        readonly NotifyIcon tray = new NotifyIcon();
        readonly ContextMenuStrip menu = new ContextMenuStrip();
        readonly System.Windows.Forms.Timer tickTimer = new System.Windows.Forms.Timer();
        readonly System.Windows.Forms.Timer readTimer = new System.Windows.Forms.Timer();
        readonly Settings settings;
        Process tick;
        Process server;
        Icon icon;
        SynchronizationContext ui;
        DateTime tickStarted = DateTime.MinValue;
        bool nodeMissing;
        Font boldFont;
        readonly System.Windows.Forms.Timer openTimer = new System.Windows.Forms.Timer();
        int openTries;

        Glance()
        {
            settings = LoadSettings();
            // The menu strip is a control, so a UI context exists from here on.
            ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
            tray.ContextMenuStrip = menu;
            tray.Visible = true;
            tray.MouseUp += (sender, e) => { if (e.Button == MouseButtons.Left) ShowMenu(); };
            menu.Opening += (sender, e) => Show();
            tickTimer.Interval = 5 * 60 * 1000;
            tickTimer.Tick += (sender, e) => RunTick();
            tickTimer.Start();
            readTimer.Interval = 30 * 1000;
            readTimer.Tick += (sender, e) => Show();
            readTimer.Start();
            openTimer.Tick += (sender, e) => CheckServer();
            Show();
            RunTick();
        }

        static Settings LoadSettings()
        {
            try
            {
                string file = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "glance.json");
                return new JavaScriptSerializer().Deserialize<Settings>(File.ReadAllText(file, Encoding.UTF8));
            }
            catch { return null; }
        }

        void ShowMenu()
        {
            // NotifyIcon shows its menu on right click only. Reuse the private method for left click.
            var method = typeof(NotifyIcon).GetMethod("ShowContextMenu", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
            if (method != null) method.Invoke(tray, null);
        }

        Process Node(string script, bool keep) { return Node(script, keep, ""); }

        Process Node(string script, bool keep, string extra)
        {
            if (settings == null) return null;
            var start = new ProcessStartInfo(settings.node, "\"" + Path.Combine(settings.repo, script) + "\"" + extra);
            start.WorkingDirectory = settings.repo;
            start.EnvironmentVariables["OBSERVATORY_CONFIG"] = settings.config;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WindowStyle = ProcessWindowStyle.Hidden;
            start.RedirectStandardOutput = !keep;
            start.RedirectStandardError = !keep;
            try
            {
                var process = Process.Start(start);
                if (!keep)
                {
                    process.OutputDataReceived += (s, e) => { };
                    process.ErrorDataReceived += (s, e) => { };
                    process.BeginOutputReadLine();
                    process.BeginErrorReadLine();
                }
                nodeMissing = false;
                return process;
            }
            catch { nodeMissing = true; return null; }
        }

        void RunTick()
        {
            if (tick != null && !tick.HasExited)
            {
                if ((DateTime.UtcNow - tickStarted).TotalSeconds < 270) return;
                try { tick.Kill(); } catch { }
            }
            tickStarted = DateTime.UtcNow;
            tick = Node(Path.Combine("scripts", "tick.mjs"), false);
            if (tick == null) { Show(); return; }
            tick.EnableRaisingEvents = true;
            // Exited fires on a pool thread, so hand the update back to the UI thread.
            tick.Exited += (s, e) => ui.Post(_ => Show(), null);
            Show();
        }

        static string Span(TimeSpan age)
        {
            int minutes = (int)age.TotalMinutes;
            if (minutes < 1) return "less than a minute";
            if (minutes < 60) return minutes + " min";
            return (minutes / 60) + " h " + (minutes % 60) + " min";
        }

        void Line(string text) { Line(text, false); }
        void Line(string text, bool quiet)
        {
            if (text.Length == 0) { menu.Items.Add(new ToolStripSeparator()); return; }
            int depth = text.Length - text.TrimStart(' ').Length;
            var item = new ToolStripMenuItem(text.Trim());
            item.Padding = new Padding(depth >= 4 ? 14 : depth > 0 ? 6 : 0, 0, 0, 0);
            if (depth == 0 && !quiet) item.Font = boldFont ?? (boldFont = new Font(menu.Font, FontStyle.Bold));
            if (quiet || depth >= 4) item.ForeColor = SystemColors.GrayText;
            menu.Items.Add(item);
        }

        void Show()
        {
            menu.Items.Clear();
            string title = "?";
            bool stale = true;
            if (nodeMissing) { Line("Node was not found at the saved path. Run npm run setup again."); Line(""); }
            if (settings == null)
            {
                Line("glance.json is missing. Run npm run setup again.");
            }
            else
            {
                Dictionary<string, object> json = null;
                try
                {
                    string file = Path.Combine(settings.dataFolder, "public", "local", "combined.json");
                    var serializer = new JavaScriptSerializer();
                    serializer.MaxJsonLength = 32 * 1024 * 1024;
                    json = serializer.Deserialize<Dictionary<string, object>>(ReadShared(file));
                }
                catch { json = null; }
                object glanceValue = null;
                var glance = json != null && json.TryGetValue("glance", out glanceValue) ? glanceValue as Dictionary<string, object> : null;
                if (glance == null)
                {
                    Line("No combined.json yet. The first collection is running.");
                }
                else
                {
                    object value;
                    if (glance.TryGetValue("title", out value) && value is string) title = (string)value;
                    var lines = glance.TryGetValue("lines", out value) ? value as IList : null;
                    if (lines != null) foreach (object line in lines) Line(line as string ?? "");
                    Line("");
                    DateTime at;
                    if (json.TryGetValue("generatedAt", out value) && value is string && DateTime.TryParse((string)value, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out at))
                    {
                        var age = DateTime.UtcNow - at;
                        stale = age.TotalMinutes > 15;
                        Line("Updated " + Span(age) + " ago" + (stale ? ", not recently" : ""), true);
                    }
                    else Line("Updated: Unknown time", true);
                    object hubValue;
                    var hub = json.TryGetValue("hub", out hubValue) ? hubValue as Dictionary<string, object> : null;
                    object spokesValue = null;
                    var spokes = hub != null && hub.TryGetValue("spokes", out spokesValue) ? spokesValue as IList : null;
                    if (spokes != null)
                        foreach (object item in spokes)
                        {
                            var spoke = item as Dictionary<string, object>;
                            if (spoke == null) continue;
                            object name, pull, push;
                            string label = spoke.TryGetValue("name", out name) && name is string ? (string)name : "Other computer";
                            if (spoke.TryGetValue("pull", out pull) && pull is string && (string)pull != "ok") Line(label + ": could not read (" + pull + ")", true);
                            else if (spoke.TryGetValue("push", out push) && push is string && (string)push != "ok" && (string)push != "skipped") Line(label + ": could not write back (" + push + ")", true);
                        }
                }
            }
            if (tick != null && !tick.HasExited) Line("Refreshing...");
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Open dashboard", null, (s, e) => OpenDashboard());
            var refresh = menu.Items.Add("Refresh", null, (s, e) => RunTick());
            refresh.Enabled = tick == null || tick.HasExited;
            menu.Items.Add("Quit Observatory", null, (s, e) => Quit());
            string tip = "Observatory " + title + (stale ? " (not updated recently)" : " lowest limit left");
            tray.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip;
            SetIcon(stale ? title + "?" : title);
        }

        // The tray has no room for text, so the number is drawn into the icon.
        void SetIcon(string text)
        {
            string shown = text.Replace("%", "");
            if (shown.Length > 3) shown = shown.Substring(0, 3);
            using (var bitmap = new Bitmap(32, 32))
            using (var graphics = Graphics.FromImage(bitmap))
            using (var font = new Font("Segoe UI", shown.Length > 2 ? 13f : 16f, FontStyle.Bold, GraphicsUnit.Pixel))
            using (var background = new SolidBrush(Color.FromArgb(9, 9, 11)))
            using (var foreground = new SolidBrush(text.EndsWith("?") ? Color.FromArgb(240, 180, 60) : Color.White))
            {
                graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
                graphics.FillEllipse(background, 0, 0, 31, 31);
                var format = new StringFormat();
                format.Alignment = StringAlignment.Center;
                format.LineAlignment = StringAlignment.Center;
                graphics.DrawString(shown, font, foreground, new RectangleF(0, 0, 32, 32), format);
                var handle = bitmap.GetHicon();
                var next = (Icon)Icon.FromHandle(handle).Clone();
                DestroyIcon(handle);
                tray.Icon = next;
                if (icon != null) icon.Dispose();
                icon = next;
            }
        }

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        static extern bool DestroyIcon(IntPtr handle);

        bool Reachable(string url)
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create(url);
                request.Method = "HEAD";
                request.Timeout = 1000;
                request.Proxy = null;
                using (var response = (HttpWebResponse)request.GetResponse()) return response.StatusCode == HttpStatusCode.OK;
            }
            catch { return false; }
        }

        void OpenDashboard()
        {
            if (settings == null) return;
            string url = "http://127.0.0.1:" + settings.port + "/";
            if (Reachable(url)) { Browse(url); return; }
            if (server == null || server.HasExited) server = Node("serve-local.mjs", true, " --with-parent");
            openTries = 0;
            openTimer.Stop();
            openTimer.Interval = 500;
            openTimer.Start();
        }

        void Browse(string url)
        {
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
        }

        void CheckServer()
        {
            string url = "http://127.0.0.1:" + settings.port + "/";
            openTries++;
            if (Reachable(url) || openTries >= 20) { openTimer.Stop(); Browse(url); }
        }

        static string ReadShared(string file)
        {
            using (var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var reader = new StreamReader(stream, Encoding.UTF8)) return reader.ReadToEnd();
        }

        void Quit()
        {
            try { if (server != null && !server.HasExited) server.Kill(); } catch { }
            tray.Visible = false;
            ExitThread();
        }

        [STAThread]
        static void Main()
        {
            bool created;
            using (new Mutex(true, "Local\\ObservatoryGlance", out created))
            {
                if (!created) return;
                Application.EnableVisualStyles();
                Application.Run(new Glance());
            }
        }
    }
}
