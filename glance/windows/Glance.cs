// Observatory tray item. It runs the five-minute tick hidden, shows the glance
// block from combined.json, and opens the read-only dashboard in the browser.
// Built locally by `npm run setup` with the C# compiler that ships with Windows
// (.NET Framework 4), so it uses C# 5 syntax only. Settings come from glance.json
// beside the executable.
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
            // The hub may write a new combined.json at any time.
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

        Process Node(string script, bool keep)
        {
            if (settings == null) return null;
            var start = new ProcessStartInfo(settings.node, "\"" + Path.Combine(settings.repo, script) + "\"");
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
            // tick.mjs stops itself after 4 minutes. This is the backstop if it hangs anyway.
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

        // Section names in bold, rows in the normal colour, detail rows a step quieter.
        // Rows stay enabled so they read as text, not greyed-out items. Clicking one does nothing.
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
            int waiting = 0;
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
                    if (glance.TryGetValue("waiting", out value) && value is int) waiting = (int)value;
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
                }
            }
            if (tick != null && !tick.HasExited) Line("Refreshing...");
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Open dashboard", null, (s, e) => OpenDashboard());
            var refresh = menu.Items.Add("Refresh", null, (s, e) => RunTick());
            refresh.Enabled = tick == null || tick.HasExited;
            menu.Items.Add("Quit Observatory", null, (s, e) => Quit());
            string tip = "Observatory " + title + (stale ? " (not updated recently)" : waiting > 0 ? " left, " + waiting + " waiting on you" : " lowest limit left");
            tray.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip;
            SetIcon(stale ? title + "?" : title, waiting > 0 && !stale);
        }

        // The tray has no room for text, so the number is drawn into the icon.
        void SetIcon(string text, bool attention)
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
                // An amber dot in the corner when an agent is waiting on you.
                if (attention)
                    using (var dot = new SolidBrush(Color.FromArgb(240, 160, 40)))
                    using (var ring = new Pen(Color.FromArgb(9, 9, 11), 2f))
                    { graphics.FillEllipse(dot, 21, 1, 10, 10); graphics.DrawEllipse(ring, 21, 1, 10, 10); }
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
            if (server == null || server.HasExited) server = Node("serve-local.mjs", true);
            // Wait for the server without freezing the menu: check every half second for up to 10 seconds.
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

        // The tray app reads while the hub or tick may be replacing the file, so allow both.
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
