// Built locally by `npm run setup` with the C# compiler that ships with Windows
// (.NET Framework 4), so it uses C# 5 syntax only.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Runtime.InteropServices;
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

    // Panel state, parsed from combined.json. Mirrors the Mac app's PanelState.
    sealed class LimitRow
    {
        public string Provider, Name, Window;
        public double? Remaining;
        public DateTime? ResetsAt;
    }

    sealed class DeviceRow
    {
        public string Name, FullName, Problem;
        public double? Seconds, Tokens, Usd;
        public DateTime? LastSeen;
        public bool Current;
    }

    sealed class PanelState
    {
        public const double Low = 15;
        public List<LimitRow> Limits = new List<LimitRow>();
        public List<DeviceRow> Devices = new List<DeviceRow>();
        public DateTime? Updated;
        public string Notice;
        public bool Refreshing;
        public DateTime Now = DateTime.UtcNow;

        public bool Old { get { return Updated.HasValue && (Now - Updated.Value).TotalMinutes > 15; } }

        public static DateTime? Date(object value)
        {
            DateTime at;
            var text = value as string;
            if (text != null && DateTime.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out at)) return at;
            return null;
        }

        static double? Number(object value)
        {
            if (!(value is double || value is int || value is decimal || value is long)) return null;
            double number = Convert.ToDouble(value, CultureInfo.InvariantCulture);
            return Double.IsNaN(number) || Double.IsInfinity(number) || number < 0 ? (double?)null : number;
        }

        static object Get(Dictionary<string, object> row, string key)
        {
            object value;
            return row != null && row.TryGetValue(key, out value) ? value : null;
        }

        // Keep this pure rule in sync with lib/glance-limits.mjs and the Mac app.
        public static double? LimitRemaining(Dictionary<string, object> row, DateTime now)
        {
            object stale = Get(row, "stale");
            if (!(stale is bool) || (bool)stale) return null;
            double? remaining = Number(Get(row, "remaining"));
            if (!remaining.HasValue || remaining.Value > 100) return null;
            DateTime? checkedAt = Date(Get(row, "checkedAt"));
            if (!checkedAt.HasValue || now < checkedAt.Value || (now - checkedAt.Value).TotalMinutes >= 10) return null;
            DateTime? reset = Date(Get(row, "resetsAt"));
            if (reset.HasValue && reset.Value <= now) return null;
            return remaining;
        }

        public static PanelState Parse(Dictionary<string, object> json, DateTime now)
        {
            var state = new PanelState { Now = now, Updated = Date(Get(json, "generatedAt")) };
            var glance = Get(json, "glance") as Dictionary<string, object>;
            if (glance == null) { state.Notice = "Collecting the first reading\u2026"; return state; }
            var limits = (Get(glance, "limits") as IList ?? new object[0]).OfType<Dictionary<string, object>>().Select(row => new LimitRow
            {
                Provider = Get(row, "provider") as string ?? "",
                Name = Get(row, "name") as string ?? "Unknown",
                Window = Get(row, "window") as string ?? "",
                Remaining = LimitRemaining(row, now),
                ResetsAt = Date(Get(row, "resetsAt")),
            });
            // Scarcest first. Unknown readings go last, in their original order (OrderBy is stable).
            state.Limits = limits.OrderBy(row => row.Remaining.HasValue ? 0 : 1).ThenBy(row => row.Remaining ?? 0).ToList();
            var problems = new Dictionary<string, string>();
            var hub = Get(json, "hub") as Dictionary<string, object>;
            foreach (var spoke in (Get(hub, "spokes") as IList ?? new object[0]).OfType<Dictionary<string, object>>())
            {
                var host = Get(spoke, "host") as string;
                var pull = Get(spoke, "pull") as string;
                var push = Get(spoke, "push") as string;
                if (host == null) continue;
                if (pull != null && pull != "ok") problems[host] = "Could not read (" + pull + ")";
                else if (push != null && push != "ok" && push != "skipped") problems[host] = "Could not write back (" + push + ")";
            }
            foreach (var row in (Get(glance, "today") as IList ?? new object[0]).OfType<Dictionary<string, object>>())
            {
                var host = Get(row, "host") as string ?? "";
                var seen = Date(Get(row, "collectedAt"));
                var freshness = Get(row, "freshness") as Dictionary<string, object>;
                bool stale = !(Get(freshness, "stale") is bool) || (bool)Get(freshness, "stale");
                string problem;
                problems.TryGetValue(host, out problem);
                // Same rule as the dashboard and the Mac app: today's numbers only while the reading is recent and from today.
                state.Devices.Add(new DeviceRow
                {
                    Name = host == "Windows" ? "PC" : host == "Mac" ? "Mac" : Get(row, "name") as string ?? host,
                    FullName = Get(row, "name") as string ?? host,
                    Seconds = Number(Get(row, "seconds")),
                    Tokens = Number(Get(row, "tokens")),
                    Usd = Number(Get(row, "usd")),
                    LastSeen = seen,
                    Current = !stale && seen.HasValue && (now - seen.Value).TotalMinutes <= 15 && seen.Value.ToLocalTime().Date == now.ToLocalTime().Date,
                    Problem = problem,
                });
            }
            return state;
        }
    }

    static class Format
    {
        public static string Duration(double seconds)
        {
            int minutes = (int)Math.Round(seconds / 60);
            return minutes < 60 ? minutes + "m" : (minutes / 60) + "h " + (minutes % 60) + "m";
        }

        public static string Compact(double value)
        {
            var units = new[] { Tuple.Create(1e12, "T"), Tuple.Create(1e9, "B"), Tuple.Create(1e6, "M"), Tuple.Create(1e3, "K"), Tuple.Create(1.0, "") };
            for (int index = 0; index < units.Length; index++)
            {
                if (value < units[index].Item1 && index < units.Length - 1) continue;
                double scaled = value / units[index].Item1;
                string text = scaled >= 100 || units[index].Item2 == "" ? Math.Round(scaled).ToString(CultureInfo.InvariantCulture) : scaled.ToString("0.0", CultureInfo.InvariantCulture);
                // Rounding can reach the next unit (999,960 is 1000K), so step up instead.
                if (text == "1000" && index > 0) return "1" + units[index - 1].Item2;
                return text + units[index].Item2;
            }
            return Math.Round(value).ToString(CultureInfo.InvariantCulture);
        }

        public static string Money(double value)
        {
            return value >= 10 ? "$" + Math.Round(value).ToString(CultureInfo.InvariantCulture) : "$" + value.ToString("0.00", CultureInfo.InvariantCulture);
        }

        public static string Clock(DateTime utc, DateTime now)
        {
            DateTime local = utc.ToLocalTime();
            string time = local.ToString("t", CultureInfo.CurrentCulture);
            if (local.Date == now.ToLocalTime().Date) return time;
            if (Math.Abs((utc - now).TotalDays) < 6) return local.ToString("ddd", CultureInfo.CurrentCulture) + " " + time;
            return local.ToString("MMM d", CultureInfo.CurrentCulture) + " " + time;
        }

        public static string Age(TimeSpan age)
        {
            int minutes = (int)age.TotalMinutes;
            if (minutes < 60) return minutes + " min ago";
            if (minutes < 48 * 60) return (minutes / 60) + "h " + (minutes % 60) + "m ago";
            return (minutes / 1440) + "d ago";
        }

        public static string Today(DeviceRow device)
        {
            var parts = new List<string>();
            if (device.Seconds.HasValue) parts.Add(Duration(device.Seconds.Value));
            if (device.Tokens.HasValue) parts.Add(Compact(device.Tokens.Value) + " tokens");
            if (device.Usd.HasValue) parts.Add(Money(device.Usd.Value));
            return parts.Count == 0 ? "Unknown" : string.Join("  \u00B7  ", parts);
        }
    }

    // Mirrors app/design-tokens.css, like the Mac panel.
    sealed class Palette
    {
        public Color Background, Surface, Text, Muted, Track, Claude, Codex, Warning, Error, Hairline;

        public static Palette Of(bool dark)
        {
            Func<int, Color> hex = value => Color.FromArgb(value >> 16 & 255, value >> 8 & 255, value & 255);
            return dark
                ? new Palette { Background = hex(0x1c1d1b), Surface = hex(0x272825), Text = hex(0xf0eee8), Muted = hex(0xb3b7ac), Track = hex(0x3b3e37),
                    Claude = hex(0xcb7550), Codex = hex(0x4f95cf), Warning = hex(0xe2b866), Error = hex(0xe58a80), Hairline = Color.FromArgb(20, 255, 255, 255) }
                : new Palette { Background = hex(0xedeae5), Surface = hex(0xf4f1ec), Text = hex(0x292d28), Muted = hex(0x5b6056), Track = hex(0xdadbd3),
                    Claude = hex(0xb5633c), Codex = hex(0x2e6e9e), Warning = hex(0x94620f), Error = hex(0xa23b32), Hairline = Color.FromArgb(20, 0, 0, 0) };
        }

        public Color Provider(string name) { return name == "claude" ? Claude : name == "codex" ? Codex : Muted; }

        public static bool SystemDark()
        {
            try
            {
                using (var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
                    return key != null && Convert.ToInt32(key.GetValue("AppsUseLightTheme", 1)) == 0;
            }
            catch { return false; }
        }
    }

    // Draws the panel. One routine both measures (draw: false) and paints, so the layout cannot drift.
    static class Painter
    {
        public const int Width = 340;
        const int Pad = 14, Gap = 12, ButtonHeight = 30, IconButton = 34;

        public static void Telescope(Graphics g, RectangleF box, Color color, float stroke)
        {
            // The mark from public/brand/telescope.svg, in its 24 unit box.
            var state = g.Save();
            g.TranslateTransform(box.X, box.Y);
            g.ScaleTransform(box.Width / 24f, box.Height / 24f);
            using (var pen = new Pen(color, stroke))
            {
                pen.StartCap = pen.EndCap = LineCap.Round;
                pen.LineJoin = LineJoin.Round;
                g.DrawPolygon(pen, new[] { new PointF(5, 10), new PointF(16, 4), new PointF(19, 9), new PointF(8, 15) });
                g.DrawLine(pen, 16, 3, 20, 10);
                g.DrawLine(pen, 5.8f, 12, 3, 13.5f);
                g.DrawLine(pen, 12, 13, 12, 22);
                g.DrawLines(pen, new[] { new PointF(7, 21), new PointF(12, 16), new PointF(17, 21) });
            }
            g.Restore(state);
        }

        static GraphicsPath Rounded(RectangleF r, float radius)
        {
            var path = new GraphicsPath();
            float d = Math.Min(radius * 2, Math.Min(r.Width, r.Height));
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        static void Card(Graphics g, Palette p, RectangleF r)
        {
            using (var path = Rounded(r, 14))
            using (var fill = new SolidBrush(p.Surface))
            using (var line = new Pen(p.Hairline))
            {
                g.FillPath(fill, path);
                g.DrawPath(line, path);
            }
        }

        static void Pill(Graphics g, Palette p, RectangleF r)
        {
            using (var path = Rounded(r, r.Height / 2))
            using (var fill = new SolidBrush(p.Surface))
            using (var line = new Pen(p.Hairline))
            {
                g.FillPath(fill, path);
                g.DrawPath(line, path);
            }
        }

        static void Ring(Graphics g, Color color, float x, float y)
        {
            using (var pen = new Pen(color, 1.2f)) g.DrawEllipse(pen, x, y, 6.5f, 6.5f);
        }

        // GDI+ text, so it follows the DPI and render scale transforms (TextRenderer ignores them).
        static void Text(Graphics g, string text, Font font, Color color, float x, float y)
        {
            using (var brush = new SolidBrush(color)) g.DrawString(text, font, brush, x, y, StringFormat.GenericTypographic);
        }

        static float Measure(Graphics g, string text, Font font)
        {
            return g.MeasureString(text, font, PointF.Empty, StringFormat.GenericTypographic).Width;
        }

        // Returns the panel height. Fills hits with the three buttons: dashboard, refresh, quit.
        public static int Paint(Graphics g, PanelState s, Palette p, bool draw, List<Tuple<RectangleF, string>> hits)
        {
            using (var body = new Font("Segoe UI", 13, GraphicsUnit.Pixel))
            using (var strong = new Font("Segoe UI Semibold", 13, GraphicsUnit.Pixel))
            using (var title = new Font("Segoe UI Semibold", 15, GraphicsUnit.Pixel))
            using (var small = new Font("Segoe UI", 12, GraphicsUnit.Pixel))
            using (var glyph = new Font("Segoe MDL2 Assets", 12, GraphicsUnit.Pixel))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                if (draw) g.Clear(p.Background);
                if (hits != null) hits.Clear();
                float y = Pad;
                float left = Pad, right = Width - Pad;

                // Header
                if (draw)
                {
                    Telescope(g, new RectangleF(left + 2, y + 1, 18, 18), p.Text, 1.7f);
                    Text(g, "Observatory", title, p.Text, left + 28, y);
                    string status = s.Refreshing ? "Refreshing\u2026" : s.Old && s.Updated.HasValue ? "Updated " + Format.Age(s.Now - s.Updated.Value) : null;
                    if (status != null) Text(g, status, small, s.Refreshing ? p.Muted : p.Warning, right - 2 - Measure(g, status, small), y + 2);
                }
                y += 20 + Gap;

                if (s.Notice != null)
                {
                    float h = Pad * 2 + 18;
                    if (draw) { Card(g, p, new RectangleF(left, y, right - left, h)); Text(g, s.Notice, body, p.Muted, left + Pad, y + Pad); }
                    y += h + Gap;
                }
                else
                {
                    var known = s.Limits.Where(row => row.Remaining.HasValue).ToList();
                    var unknown = s.Limits.Where(row => !row.Remaining.HasValue).ToList();
                    if (s.Limits.Count > 0)
                    {
                        // Limits without a current reading collapse into one quiet line that wraps instead of a row each.
                        string missing = unknown.Count == 0 ? null : known.Count == 0 ? "No current limit reading"
                            : "No current reading: " + string.Join(", ", unknown.Select(limit => (limit.Name + " " + limit.Window).Trim()));
                        float missingWidth = right - left - Pad * 2 - 13;
                        float missingHeight = missing == null ? 0 : (float)Math.Ceiling(g.MeasureString(missing, body, (int)missingWidth, StringFormat.GenericTypographic).Height);
                        int lines = known.Count + (missing != null ? 1 : 0);
                        float h = Pad * 2 + known.Count * 29 + missingHeight + Math.Max(0, lines - 1) * Gap;
                        if (draw)
                        {
                            Card(g, p, new RectangleF(left, y, right - left, h));
                            float row = y + Pad, inner = left + Pad, end = right - Pad;
                            foreach (var limit in known)
                            {
                                double value = limit.Remaining.Value;
                                Color? tint = value <= 0.5 ? p.Error : value <= PanelState.Low ? p.Warning : (Color?)null;
                                using (var dot = new SolidBrush(p.Provider(limit.Provider))) g.FillEllipse(dot, inner, row + 6, 7, 7);
                                Text(g, limit.Name, strong, p.Text, inner + 13, row);
                                Text(g, limit.Window, body, p.Muted, inner + 13 + Measure(g, limit.Name, strong) + 5, row);
                                string percent = Math.Round(value) + "%";
                                float percentWidth = Measure(g, percent, strong);
                                Text(g, percent, strong, tint ?? p.Text, end - percentWidth, row);
                                if (value <= PanelState.Low && limit.ResetsAt.HasValue)
                                {
                                    string back = "back " + Format.Clock(limit.ResetsAt.Value, s.Now);
                                    Text(g, back, small, tint ?? p.Muted, end - percentWidth - 6 - Measure(g, back, small), row + 1);
                                }
                                var track = new RectangleF(inner, row + 24, end - inner, 5);
                                using (var path = Rounded(track, 2.5f)) using (var brush = new SolidBrush(p.Track)) g.FillPath(brush, path);
                                if (value > 0)
                                    using (var path = Rounded(new RectangleF(track.X, track.Y, Math.Max(5, track.Width * (float)(value / 100)), 5), 2.5f))
                                    using (var brush = new SolidBrush(tint ?? p.Provider(limit.Provider))) g.FillPath(brush, path);
                                row += 29 + Gap;
                            }
                            if (missing != null)
                            {
                                Ring(g, p.Muted, inner, row + 6);
                                using (var brush = new SolidBrush(p.Muted))
                                    g.DrawString(missing, body, brush, new RectangleF(inner + 13, row, missingWidth, missingHeight + 2), StringFormat.GenericTypographic);
                            }
                        }
                        y += h + Gap;
                    }
                    if (s.Devices.Count > 0)
                    {
                        float h = Pad * 2 + s.Devices.Count * 18 + (s.Devices.Count - 1) * Gap;
                        if (draw)
                        {
                            Card(g, p, new RectangleF(left, y, right - left, h));
                            float row = y + Pad, inner = left + Pad, end = right - Pad;
                            foreach (var device in s.Devices)
                            {
                                if (hits != null) hits.Add(Tuple.Create(new RectangleF(inner, row, end - inner, 18), "tip:" + device.FullName + (device.Problem != null ? "\n" + device.Problem : "") + (device.Current && device.Usd.HasValue ? "\nCost is an API-equivalent estimate" : "")));
                                Text(g, device.Name, strong, p.Text, inner, row);
                                string value = device.Current ? Format.Today(device)
                                    : device.LastSeen.HasValue ? "last seen " + Format.Clock(device.LastSeen.Value, s.Now) : "Unknown";
                                float width = Measure(g, value, body);
                                Text(g, value, body, device.Current ? p.Text : p.Muted, end - width, row);
                                if (!device.Current) Ring(g, p.Muted, end - width - 12, row + 6);
                                // One quiet mark per computer: a sync problem shows only while its data is otherwise current.
                                else if (device.Problem != null) Text(g, "\uE7BA", glyph, p.Warning, end - width - 18, row + 3);
                                row += 18 + Gap;
                            }
                        }
                        y += h + Gap;
                    }
                }

                // Footer: Open dashboard, Refresh, Quit
                var quit = new RectangleF(right - IconButton, y, IconButton, ButtonHeight);
                var refresh = new RectangleF(quit.X - 8 - IconButton, y, IconButton, ButtonHeight);
                var open = new RectangleF(left, y, refresh.X - 8 - left, ButtonHeight);
                if (hits != null)
                {
                    hits.Add(Tuple.Create(open, "dashboard"));
                    hits.Add(Tuple.Create(refresh, "refresh"));
                    hits.Add(Tuple.Create(quit, "quit"));
                }
                if (draw)
                {
                    Pill(g, p, open);
                    Pill(g, p, refresh);
                    Pill(g, p, quit);
                    string label = "Open dashboard";
                    Text(g, label, strong, p.Text, open.X + (open.Width - Measure(g, label, strong)) / 2, open.Y + 7);
                    Text(g, "\uE72C", glyph, s.Refreshing ? p.Muted : p.Text, refresh.X + 11, refresh.Y + 9);
                    Text(g, "\uE7E8", glyph, p.Text, quit.X + 11, quit.Y + 9);
                }
                y += ButtonHeight + Pad;
                return (int)Math.Ceiling(y);
            }
        }

        public static Bitmap Render(PanelState state, bool dark, float scale)
        {
            int height;
            using (var probe = new Bitmap(1, 1))
            using (var g = Graphics.FromImage(probe)) height = Paint(g, state, Palette.Of(dark), false, null);
            var bitmap = new Bitmap((int)(Width * scale), (int)(height * scale));
            using (var g = Graphics.FromImage(bitmap))
            {
                g.ScaleTransform(scale, scale);
                Paint(g, state, Palette.Of(dark), true, null);
            }
            return bitmap;
        }
    }

    // A borderless flyout above the tray, like Windows' own quick settings.
    sealed class PanelForm : Form
    {
        public PanelState State = new PanelState();
        public Action<string> Act = name => { };
        readonly List<Tuple<RectangleF, string>> hits = new List<Tuple<RectangleF, string>>();
        readonly ToolTip tip = new ToolTip();
        string tipText;
        float scale = 1;
        Screen screen;

        [DllImport("dwmapi.dll")]
        static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
        [DllImport("user32.dll")]
        static extern IntPtr MonitorFromPoint(Point point, uint flags);
        [DllImport("shcore.dll")]
        static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint dpiX, out uint dpiY);
        const int WM_DPICHANGED = 0x02E0;

        public PanelForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            DoubleBuffered = true;
            KeyPreview = true;
            // On a short screen the panel scrolls rather than cutting off its buttons.
            AutoScroll = true;
            Scroll += (sender, e) => Invalidate();
            MouseWheel += (sender, e) => Invalidate();
            Text = "Observatory";
        }

        protected override CreateParams CreateParams
        {
            // A tool window stays out of Alt+Tab.
            get { var p = base.CreateParams; p.ExStyle |= 0x80; return p; }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            // Rounded corners on Windows 11. Older Windows keeps square corners.
            int round = 2;
            try { DwmSetWindowAttribute(Handle, 33, ref round, sizeof(int)); } catch { }
        }

        // Opens on the screen and corner of the taskbar that was clicked. Later refreshes keep that screen.
        public void Place(bool reanchor)
        {
            if (reanchor || screen == null) screen = Screen.FromPoint(Cursor.Position);
            using (var g = CreateGraphics())
            {
                scale = ScaleOf(screen, g);
                int height = Painter.Paint(g, State, Palette.Of(Palette.SystemDark()), false, null);
                Rectangle area = screen.WorkingArea, bounds = screen.Bounds;
                int margin = (int)(12 * scale);
                int full = (int)(height * scale);
                int w = (int)(Painter.Width * scale), h = Math.Min(full, area.Height - 2 * margin);
                AutoScrollMinSize = h < full ? new Size(0, full) : Size.Empty;
                // The taskbar is on the edge where the work area is smaller than the screen. Auto-hide leaves none, so use bottom right.
                bool left = area.Left > bounds.Left, top = area.Top > bounds.Top && area.Bottom == bounds.Bottom;
                int x = left ? area.Left + margin : area.Right - w - margin;
                int y = top ? area.Top + margin : area.Bottom - h - margin;
                SetBounds(x, Math.Max(area.Top + margin, y), w, h);
            }
            Invalidate();
        }

        // Each screen has its own scale (Windows 8.1 and later). Older Windows has one for all screens.
        static float ScaleOf(Screen screen, Graphics g)
        {
            try
            {
                uint dpiX, dpiY;
                var middle = new Point(screen.Bounds.Left + screen.Bounds.Width / 2, screen.Bounds.Top + screen.Bounds.Height / 2);
                // 2 is MONITOR_DEFAULTTONEAREST, 0 is MDT_EFFECTIVE_DPI (the scale set in Display settings).
                if (GetDpiForMonitor(MonitorFromPoint(middle, 2), 0, out dpiX, out dpiY) == 0 && dpiX > 0) return dpiX / 96f;
            }
            catch { }
            return g.DpiX / 96f;
        }

        // Sent when the panel lands on a screen with another scale, or the scale changes while it is open.
        // Place sizes the panel for its screen, so Windows' suggested rectangle is not used.
        protected override void WndProc(ref Message m)
        {
            base.WndProc(ref m);
            if (m.Msg == WM_DPICHANGED && screen != null) Place(false);
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            var point = new PointF((e.X - AutoScrollPosition.X) / scale, (e.Y - AutoScrollPosition.Y) / scale);
            string text = null;
            foreach (var hit in hits) if (hit.Item2.StartsWith("tip:") && hit.Item1.Contains(point)) text = hit.Item2.Substring(4);
            if (text == tipText) return;
            tipText = text;
            if (text == null) tip.Hide(this); else tip.Show(text, this, e.X + 12, e.Y + 16);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.TranslateTransform(AutoScrollPosition.X, AutoScrollPosition.Y);
            e.Graphics.ScaleTransform(scale, scale);
            Painter.Paint(e.Graphics, State, Palette.Of(Palette.SystemDark()), true, hits);
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            if (e.Button != MouseButtons.Left) return;
            var point = new PointF((e.X - AutoScrollPosition.X) / scale, (e.Y - AutoScrollPosition.Y) / scale);
            foreach (var hit in hits) if (!hit.Item2.StartsWith("tip:") && hit.Item1.Contains(point)) { Act(hit.Item2); return; }
        }

        protected override void OnDeactivate(EventArgs e)
        {
            base.OnDeactivate(e);
            Hide();
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Escape) Hide();
            else if (e.Control && e.KeyCode == Keys.D) Act("dashboard");
            else if (e.Control && e.KeyCode == Keys.R) Act("refresh");
            else if (e.Control && e.KeyCode == Keys.Q) Act("quit");
        }
    }

    sealed class Glance : ApplicationContext
    {
        readonly NotifyIcon tray = new NotifyIcon();
        readonly ContextMenuStrip menu = new ContextMenuStrip();
        readonly PanelForm panel = new PanelForm();
        readonly System.Windows.Forms.Timer tickTimer = new System.Windows.Forms.Timer();
        readonly System.Windows.Forms.Timer readTimer = new System.Windows.Forms.Timer();
        readonly Settings settings;
        Process tick;
        Process server;
        Icon icon;
        SynchronizationContext ui;
        DateTime tickStarted = DateTime.MinValue;
        bool nodeMissing;
        readonly System.Windows.Forms.Timer openTimer = new System.Windows.Forms.Timer();
        int openTries;
        ToolStripItem refreshItem;
        bool openAtPress;

        Glance()
        {
            settings = LoadSettings();
            // The menu strip is a control, so a UI context exists from here on.
            ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
            // Right click keeps a short native menu. Left click opens the panel.
            menu.Items.Add("Open dashboard", null, (sender, e) => OpenDashboard());
            refreshItem = menu.Items.Add("Refresh", null, (sender, e) => RunTick());
            menu.Items.Add("Quit Observatory", null, (sender, e) => Quit());
            menu.Opening += (sender, e) => refreshItem.Enabled = tick == null || tick.HasExited;
            tray.ContextMenuStrip = menu;
            tray.Visible = true;
            // A click on the icon first takes focus from an open panel, which hides it. Remember whether it was open when the press began.
            tray.MouseDown += (sender, e) => { if (e.Button == MouseButtons.Left) openAtPress = panel.Visible; };
            tray.MouseUp += (sender, e) => { if (e.Button == MouseButtons.Left) TogglePanel(); };
            panel.Act = name =>
            {
                if (name == "dashboard") { panel.Hide(); OpenDashboard(); }
                else if (name == "refresh") RunTick();
                else if (name == "quit") Quit();
            };
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

        [DllImport("user32.dll")]
        static extern bool SetForegroundWindow(IntPtr window);

        void TogglePanel()
        {
            if (panel.Visible || openAtPress) { panel.Hide(); openAtPress = false; return; }
            Show();
            panel.Place(true);
            panel.Show();
            panel.Activate();
            // Windows can refuse focus to a tray app. Without focus the panel would never hide on an outside click.
            if (Form.ActiveForm != panel) SetForegroundWindow(panel.Handle);
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
                StopTree(tick);
            }
            tickStarted = DateTime.UtcNow;
            tick = Node(Path.Combine("scripts", "tick.mjs"), false);
            if (tick == null) { Show(); return; }
            tick.EnableRaisingEvents = true;
            // Exited fires on a pool thread, so hand the update back to the UI thread.
            tick.Exited += (s, e) => ui.Post(_ => Show(), null);
            Show();
        }

        static void StopTree(Process process)
        {
            try
            {
                if (process == null || process.HasExited) return;
                var start = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "taskkill.exe"), "/PID " + process.Id + " /T /F");
                start.UseShellExecute = false;
                start.CreateNoWindow = true;
                using (var killer = Process.Start(start)) killer.WaitForExit();
                process.WaitForExit();
            }
            catch { }
        }

        static Dictionary<string, object> ReadCombined(string file)
        {
            try
            {
                var serializer = new JavaScriptSerializer();
                serializer.MaxJsonLength = 32 * 1024 * 1024;
                return serializer.Deserialize<Dictionary<string, object>>(ReadShared(file));
            }
            catch { return null; }
        }

        void Show()
        {
            PanelState state;
            if (settings == null) state = new PanelState { Notice = "Settings are missing. Run npm run setup again." };
            else
            {
                var json = ReadCombined(Path.Combine(settings.dataFolder, "public", "local", "combined.json"));
                state = json == null ? new PanelState { Notice = "Collecting the first reading\u2026" } : PanelState.Parse(json, DateTime.UtcNow);
            }
            if (nodeMissing) state.Notice = "Node was not found. Run npm run setup again.";
            state.Refreshing = tick != null && !tick.HasExited;
            panel.State = state;
            if (panel.Visible) panel.Place(false);
            bool current = state.Notice == null && !state.Old && state.Limits.Any(row => row.Remaining.HasValue);
            tray.Text = current ? "Observatory" : "Observatory: not updated recently";
            SetIcon(!current);
        }

        // The telescope, drawn to match the taskbar theme. A quiet, dimmed mark when nothing current is known.
        void SetIcon(bool stale)
        {
            bool light = false;
            try
            {
                using (var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
                    light = key != null && Convert.ToInt32(key.GetValue("SystemUsesLightTheme", 0)) == 1;
            }
            catch { }
            using (var bitmap = new Bitmap(32, 32))
            using (var graphics = Graphics.FromImage(bitmap))
            {
                graphics.SmoothingMode = SmoothingMode.AntiAlias;
                Painter.Telescope(graphics, new RectangleF(0, 0, 32, 32), Color.FromArgb(stale ? 120 : 255, light ? Color.FromArgb(28, 29, 27) : Color.White), 1.7f);
                var handle = bitmap.GetHicon();
                var next = (Icon)Icon.FromHandle(handle).Clone();
                DestroyIcon(handle);
                tray.Icon = next;
                if (icon != null) icon.Dispose();
                icon = next;
            }
        }

        [DllImport("user32.dll")]
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
            tickTimer.Stop();
            readTimer.Stop();
            openTimer.Stop();
            StopTree(tick);
            StopTree(server);
            panel.Hide();
            tray.Visible = false;
            ExitThread();
        }

        [DllImport("user32.dll")]
        static extern bool SetProcessDpiAwarenessContext(IntPtr context);
        [DllImport("shcore.dll")]
        static extern int SetProcessDpiAwareness(int value);
        [DllImport("user32.dll")]
        static extern bool SetProcessDPIAware();
        static readonly IntPtr PerMonitorAwareV2 = new IntPtr(-4);

        // Per-monitor awareness keeps the panel sharp on a second screen with a different scale, where
        // system awareness has Windows stretch it. V2 needs Windows 10 1703, V1 (2) Windows 8.1.
        static void UseMonitorDpi()
        {
            try { if (SetProcessDpiAwarenessContext(PerMonitorAwareV2)) return; } catch { }
            try { if (SetProcessDpiAwareness(2) == 0) return; } catch { }
            try { SetProcessDPIAware(); } catch { }
        }

        // `ObservatoryGlance.exe --render combined.json out.png light|dark [now]` draws the panel to a PNG
        // without a tray, for checking the layout and for documentation screenshots.
        static int Render(string[] args)
        {
            int at = Array.IndexOf(args, "--render");
            if (args.Length < at + 4) return 2;
            var json = ReadCombined(args[at + 1]);
            if (json == null) return 2;
            DateTime now = args.Length > at + 4 && PanelState.Date(args[at + 4]).HasValue ? PanelState.Date(args[at + 4]).Value : DateTime.UtcNow;
            using (var image = Painter.Render(PanelState.Parse(json, now), args[at + 3] == "dark", 2)) image.Save(args[at + 2], System.Drawing.Imaging.ImageFormat.Png);
            return 0;
        }

        [STAThread]
        static int Main(string[] args)
        {
            if (Array.IndexOf(args, "--render") >= 0) return Render(args);
            UseMonitorDpi();
            bool created;
            using (new Mutex(true, "Local\\ObservatoryGlance", out created))
            {
                if (!created) return 0;
                Application.EnableVisualStyles();
                Application.Run(new Glance());
            }
            return 0;
        }
    }
}
