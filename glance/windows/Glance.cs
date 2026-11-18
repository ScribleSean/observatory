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

    sealed class LimitRow
    {
        public string Engine, Name, Percent, Resets, Tone;
        // Share used, 0 to 1, or null when Unknown.
        public double? Fraction;
    }

    sealed class SessionRow
    {
        public string Title, Machine, Rate;
    }

    sealed class FlagRow
    {
        public int Count;
        public string Subject, Text;
    }

    sealed class EngineRow
    {
        // Headline and Resets are the hub's stored words for this engine (lib/forecast.mjs), shown as they are.
        public string Id, Name, Status, Headline, Window, Resets;
        public double? Remaining;
    }

    sealed class PanelState
    {
        public const double Low = 15;
        public const string GlanceSchema = "observatory-glance/1";
        // Copies of lib/freshness.mjs. test/repo-rules.test.mjs checks they match.
        public const double ReadingFreshMinutes = 10;
        public const double DeviceFreshMinutes = 15;
        // From glance.json (lib/glance-view.mjs), or worked out from combined.json when that file is missing.
        public string Headline, HeadEngine, Used, Resets, BarText, RunningTitle, RunningSummary, UpdatedText;
        public string HeadTone = "unknown";
        public double? Fraction, Ring;
        public List<LimitRow> Limits = new List<LimitRow>();
        public List<SessionRow> Sessions = new List<SessionRow>();
        public FlagRow Flag;
        // Read only from combined.json, the fallback.
        public string Sentence, Menu;
        public DateTime? Updated;
        public string Notice;
        public bool Refreshing;
        public DateTime Now = DateTime.UtcNow;

        public bool Old { get { return Updated.HasValue && (Now - Updated.Value).TotalMinutes > DeviceFreshMinutes; } }
        public bool Empty { get { return Headline == null && Limits.Count == 0; } }

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

        static double? Share(object value)
        {
            double? number = Number(value);
            return number.HasValue && number.Value <= 1 ? number : null;
        }

        public static object Get(Dictionary<string, object> row, string key)
        {
            object value;
            return row != null && row.TryGetValue(key, out value) ? value : null;
        }

        static IEnumerable<Dictionary<string, object>> Rows(object value)
        {
            return (value as IList ?? new object[0]).OfType<Dictionary<string, object>>();
        }

        static string Whole(double value)
        {
            return value.ToString("0", CultureInfo.InvariantCulture);
        }

        // Keep this pure rule in sync with lib/glance-limits.mjs and the Mac app.
        public static double? LimitRemaining(Dictionary<string, object> row, DateTime now)
        {
            object stale = Get(row, "stale");
            if (!(stale is bool) || (bool)stale) return null;
            double? remaining = Number(Get(row, "remaining"));
            if (!remaining.HasValue || remaining.Value > 100) return null;
            DateTime? checkedAt = Date(Get(row, "checkedAt"));
            if (!checkedAt.HasValue || now < checkedAt.Value || (now - checkedAt.Value).TotalMinutes >= ReadingFreshMinutes) return null;
            DateTime? reset = Date(Get(row, "resetsAt"));
            if (reset.HasValue && reset.Value <= now) return null;
            return remaining;
        }

        // glance.json: drawn as it is.
        public static PanelState ParseGlance(Dictionary<string, object> json, DateTime now)
        {
            var state = new PanelState { Now = now, Updated = Date(Get(json, "updatedAt")), UpdatedText = Get(json, "updated") as string };
            // Nothing read yet: the first-run notice, the same as with no snapshot at all.
            object collecting = Get(json, "collecting");
            if (collecting is bool && (bool)collecting) state.Notice = "Collecting the first reading\u2026";
            var bar = Get(json, "bar") as Dictionary<string, object>;
            state.Ring = Share(Get(bar, "ring"));
            object show = Get(bar, "showPercent");
            state.BarText = show is bool && (bool)show ? Get(bar, "text") as string : null;
            var head = Get(json, "headline") as Dictionary<string, object>;
            state.Headline = Get(head, "text") as string;
            state.HeadTone = Get(head, "tone") as string ?? "unknown";
            state.HeadEngine = Get(head, "engine") as string;
            state.Used = Get(head, "used") as string;
            state.Resets = Get(head, "resets") as string;
            state.Fraction = Share(Get(head, "fraction"));
            foreach (var row in Rows(Get(json, "limits")))
            {
                state.Limits.Add(new LimitRow
                {
                    Engine = Get(row, "engine") as string ?? "",
                    Name = Get(row, "name") as string ?? "Unknown",
                    Fraction = Share(Get(row, "fraction")),
                    Percent = Get(row, "percent") as string ?? "Unknown",
                    Resets = Get(row, "resets") as string,
                    Tone = Get(row, "tone") as string ?? "muted",
                });
            }
            var running = Get(json, "running") as Dictionary<string, object>;
            if (running != null)
            {
                state.RunningTitle = Get(running, "title") as string;
                state.RunningSummary = Get(running, "summary") as string;
                foreach (var row in Rows(Get(running, "sessions")))
                {
                    state.Sessions.Add(new SessionRow
                    {
                        Title = Get(row, "title") as string ?? "Unknown",
                        Machine = Get(row, "machine") as string ?? "",
                        Rate = Get(row, "rate") as string ?? "Unknown",
                    });
                }
            }
            var flag = Get(json, "flag") as Dictionary<string, object>;
            var flagText = Get(flag, "text") as string;
            if (flagText != null)
            {
                double? count = Number(Get(flag, "count"));
                state.Flag = new FlagRow { Count = count.HasValue ? (int)count.Value : 1, Subject = Get(flag, "subject") as string, Text = flagText };
            }
            return state;
        }

        // combined.json, when glance.json is missing: the forecast and the limit rows, no sessions or flag.
        public static PanelState Parse(Dictionary<string, object> json, DateTime now)
        {
            var state = new PanelState { Now = now, Updated = Date(Get(json, "generatedAt")) };
            var glance = Get(json, "glance") as Dictionary<string, object>;
            if (glance == null) { state.Notice = "Collecting the first reading…"; return state; }
            var engines = new List<EngineRow>();
            var forecast = Get(glance, "forecast") as Dictionary<string, object>;
            if (forecast != null)
            {
                state.Sentence = Get(forecast, "sentence") as string;
                state.Menu = Get(forecast, "menu") as string;
                string scarce = Get(Get(forecast, "scarce") as Dictionary<string, object>, "engine") as string;
                foreach (var row in Rows(Get(forecast, "engines")))
                {
                    double? remaining = Number(Get(row, "remaining"));
                    engines.Add(new EngineRow
                    {
                        Id = Get(row, "engine") as string ?? "",
                        Name = Get(row, "name") as string ?? "Unknown",
                        Status = Get(row, "status") as string ?? "unknown",
                        Headline = Get(row, "headline") as string,
                        Window = Get(row, "window") as string,
                        Resets = Get(row, "resets") as string,
                        Remaining = remaining.HasValue && remaining.Value <= 100 ? remaining : null,
                    });
                }
                var lead = engines.FirstOrDefault(engine => engine.Id == scarce);
                // The stored words only. A combined.json from before they were stored reads Unknown.
                if (lead != null)
                {
                    state.Headline = lead.Headline ?? "Unknown";
                    state.Resets = lead.Resets;
                    state.HeadTone = lead.Status;
                    state.HeadEngine = lead.Id;
                }
                else state.Headline = Get(forecast, "asOf") is string ? state.Sentence : "Unknown";
            }
            var head = engines.FirstOrDefault(engine => engine.Id == state.HeadEngine);
            bool placed = false;
            foreach (var row in Rows(Get(glance, "limits")))
            {
                string provider = Get(row, "provider") as string ?? "", window = Get(row, "window") as string ?? "";
                if (window.Length == 0 || Get(row, "absent") is string) continue;
                double? left = LimitRemaining(row, now);
                double? used = left.HasValue ? Math.Round(100 - left.Value, MidpointRounding.AwayFromZero) : (double?)null;
                if (head != null && !placed && provider == head.Id && window == head.Window)
                {
                    placed = true;
                    state.Fraction = state.Ring = used.HasValue ? used.Value / 100 : (double?)null;
                    if (used.HasValue && (head.Status == "out" || head.Status == "runs-out")) state.BarText = Whole(used.Value) + "%";
                    continue;
                }
                string name = engines.Where(engine => engine.Id == provider).Select(engine => engine.Name).FirstOrDefault() ?? Get(row, "name") as string ?? "Unknown";
                object spent = Get(row, "spent"), low = Get(row, "low");
                state.Limits.Add(new LimitRow
                {
                    Engine = provider,
                    Name = name + " " + window,
                    Fraction = used.HasValue ? used.Value / 100 : (double?)null,
                    Percent = used.HasValue ? Whole(used.Value) + "%" : "Unknown",
                    Tone = !used.HasValue ? "muted" : spent is bool && (bool)spent ? "out" : low is bool && (bool)low ? "low" : "normal",
                });
            }
            return state;
        }
    }

    static class Format
    {
        public static string Span(TimeSpan span)
        {
            int minutes = (int)Math.Round(Math.Max(0, span.TotalMinutes), MidpointRounding.AwayFromZero);
            if (minutes < 60) return minutes + "m";
            int hours = minutes / 60;
            if (hours < 48) return hours + "h " + (minutes % 60) + "m";
            return (hours / 24) + "d " + (hours % 24) + "h";
        }

        public static string Age(TimeSpan age)
        {
            return Span(age) + " ago";
        }
    }

    sealed class Palette
    {
        public bool Dark;
        public Color Background, Surface, Footer, Button, Text, Muted, Track, Claude, Codex, Warning, Error, Hairline;

        public static Palette Of(bool dark)
        {
            Func<int, Color> hex = value => Color.FromArgb(value >> 16 & 255, value >> 8 & 255, value & 255);
            return dark
                ? new Palette { Dark = true, Background = hex(0x1c1d1b), Surface = hex(0x272825), Footer = hex(0x171816), Button = hex(0x2f302d), Text = hex(0xf0eee8), Muted = hex(0xb3b7ac), Track = hex(0x3b3e37),
                    Claude = hex(0xcb7550), Codex = hex(0x4f95cf), Warning = hex(0xe2b866), Error = hex(0xe58a80), Hairline = Color.FromArgb(20, 255, 255, 255) }
                : new Palette { Background = hex(0xedeae5), Surface = hex(0xf4f1ec), Footer = hex(0xe5e2dc), Button = hex(0xfbfaf8), Text = hex(0x292d28), Muted = hex(0x5b6056), Track = hex(0xdadbd3),
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

    static class Painter
    {
        public const int Width = 360;
        const int Pad = 16, Inner = 12, Row = 26, Gap = 10, FooterHeight = 60;

        public static void Telescope(Graphics g, RectangleF box, Color color, float stroke)
        {
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

        // The tray icon: a ring filled to the share used of the scarcer limit.
        public static void Ring(Graphics g, RectangleF box, Color color, double fraction, float stroke)
        {
            using (var track = new Pen(Color.FromArgb(80, color), stroke)) g.DrawEllipse(track, box);
            if (fraction <= 0) return;
            using (var arc = new Pen(color, stroke))
            {
                arc.StartCap = arc.EndCap = LineCap.Round;
                g.DrawArc(arc, box, -90, (float)(360 * Math.Min(1, fraction)));
            }
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

        static void Box(Graphics g, Color fill, Color line, RectangleF r, float radius)
        {
            using (var path = Rounded(r, radius))
            using (var brush = new SolidBrush(fill))
            using (var pen = new Pen(line))
            {
                g.FillPath(brush, path);
                g.DrawPath(pen, path);
            }
        }

        static void Bar(Graphics g, Palette p, RectangleF track, double? fraction, Color color)
        {
            using (var path = Rounded(track, track.Height / 2)) using (var brush = new SolidBrush(p.Track)) g.FillPath(brush, path);
            if (!fraction.HasValue || fraction.Value <= 0) return;
            var fill = new RectangleF(track.X, track.Y, Math.Max(track.Height, track.Width * (float)Math.Min(1, fraction.Value)), track.Height);
            using (var path = Rounded(fill, track.Height / 2)) using (var brush = new SolidBrush(color)) g.FillPath(brush, path);
        }

        // GDI+ text, so it follows the DPI and render scale transforms (TextRenderer ignores them).
        static void Text(Graphics g, string text, Font font, Color color, float x, float y)
        {
            using (var brush = new SolidBrush(color)) g.DrawString(text, font, brush, x, y, StringFormat.GenericTypographic);
        }

        // One line, cut with an ellipsis when it does not fit.
        static void Line(Graphics g, string text, Font font, Color color, RectangleF box, StringAlignment align)
        {
            using (var format = new StringFormat(StringFormat.GenericTypographic))
            using (var brush = new SolidBrush(color))
            {
                format.FormatFlags |= StringFormatFlags.NoWrap;
                format.Trimming = StringTrimming.EllipsisCharacter;
                format.Alignment = align;
                g.DrawString(text, font, brush, box, format);
            }
        }

        static float Measure(Graphics g, string text, Font font)
        {
            return g.MeasureString(text, font, PointF.Empty, StringFormat.GenericTypographic).Width;
        }

        // Words in two weights wrapped to a width, for the flag's subject in bold and then its text. Returns the height.
        static float Flow(Graphics g, List<Tuple<string, Font>> words, Color color, float x, float y, float width, float lineHeight, bool draw)
        {
            if (words.Count == 0) return 0;
            float space = Measure(g, "a b", words[words.Count - 1].Item2) - Measure(g, "ab", words[words.Count - 1].Item2);
            float cx = 0, cy = 0;
            foreach (var word in words)
            {
                float w = Measure(g, word.Item1, word.Item2);
                if (cx > 0 && cx + w > width) { cx = 0; cy += lineHeight; }
                if (draw) Text(g, word.Item1, word.Item2, color, x + cx, y + cy);
                cx += w + space;
            }
            return cy + lineHeight;
        }

        public static int Paint(Graphics g, PanelState s, Palette p, bool draw, List<Tuple<RectangleF, string>> hits)
        {
            using (var body = new Font("Segoe UI", 13, GraphicsUnit.Pixel))
            using (var strong = new Font("Segoe UI Semibold", 13, GraphicsUnit.Pixel))
            using (var title = new Font("Segoe UI Semibold", 15, GraphicsUnit.Pixel))
            using (var small = new Font("Segoe UI", 12, GraphicsUnit.Pixel))
            using (var smallStrong = new Font("Segoe UI Semibold", 12, GraphicsUnit.Pixel))
            using (var badgeFont = new Font("Segoe UI Semibold", 10.5f, GraphicsUnit.Pixel))
            using (var wrap = new StringFormat(StringFormat.GenericTypographic))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                if (draw) g.Clear(p.Background);
                if (hits != null) hits.Clear();
                float left = Pad, right = Width - Pad, y = Pad;
                // An old glance stays readable but dimmed, under the "Updated … ago" warning.
                Func<Color, Color> fade = shade => Color.FromArgb(s.Old ? 150 : 255, shade);

                if (s.Notice != null || s.Empty)
                {
                    string notice = s.Notice ?? "Collecting the first reading…";
                    float h = Inner * 2 + 18;
                    if (draw) { Box(g, p.Surface, p.Hairline, new RectangleF(left, y, right - left, h), 6); Text(g, notice, body, p.Muted, left + Inner, y + Inner); }
                    y += h + Gap;
                }
                else
                {
                    // The forecast for the scarcer limit, with its share used and its reset.
                    string headline = s.Headline ?? "Unknown";
                    float headHeight = (float)Math.Ceiling(g.MeasureString(headline, title, (int)(right - left), wrap).Height);
                    if (draw) using (var brush = new SolidBrush(fade(p.Text))) g.DrawString(headline, title, brush, new RectangleF(left, y, right - left, headHeight + 2), wrap);
                    y += headHeight + 5;
                    if (draw)
                    {
                        if (s.Used != null) Text(g, s.Used, small, fade(p.Muted), left, y);
                        if (s.Resets != null) Text(g, s.Resets, small, fade(p.Muted), right - Measure(g, s.Resets, small), y);
                    }
                    y += 16 + 6;
                    var engine = new EngineRow { Id = s.HeadEngine ?? "", Status = s.HeadTone };
                    Color tone = s.Old ? p.Muted : engine.Status == "out" ? p.Error : engine.Status == "runs-out" ? p.Warning : p.Provider(engine.Id);
                    if (draw) Bar(g, p, new RectangleF(left, y, right - left, 6), s.Fraction, tone);
                    y += 6 + 14;

                    // Every other limit window, any engine.
                    if (s.Limits.Count > 0)
                    {
                        float h = 8 + Row * s.Limits.Count + 8;
                        if (draw)
                        {
                            Box(g, p.Surface, p.Hairline, new RectangleF(left, y, right - left, h), 6);
                            float rowTop = y + 8, cx = left + Inner, cr = right - Inner;
                            float resetsX = cr - 64, percentRight = resetsX - 10, barX = percentRight - 48 - 56;
                            foreach (var row in s.Limits)
                            {
                                float mid = rowTop + Row / 2f;
                                Color color = p.Provider(row.Engine);
                                using (var dot = new SolidBrush(fade(color))) g.FillEllipse(dot, cx, mid - 3.5f, 7, 7);
                                Line(g, row.Name, body, fade(p.Text), new RectangleF(cx + 15, mid - 9, barX - 8 - cx - 15, 18), StringAlignment.Near);
                                Bar(g, p, new RectangleF(barX, mid - 2, 56, 4), row.Fraction, fade(color));
                                Color figure = row.Tone == "out" ? p.Error : row.Tone == "low" ? p.Warning : row.Tone == "muted" ? p.Muted : p.Text;
                                Line(g, row.Percent, body, fade(figure), new RectangleF(percentRight - 48, mid - 9, 48, 18), StringAlignment.Far);
                                if (row.Resets != null) Line(g, row.Resets, small, fade(p.Muted), new RectangleF(resetsX, mid - 8, cr - resetsX, 18), StringAlignment.Far);
                                rowTop += Row;
                            }
                        }
                        y += h + Gap;
                    }

                    // What is running across computers, fastest first.
                    if (s.RunningTitle != null)
                    {
                        float h = 10 + 18 + Row * s.Sessions.Count + 6;
                        float cx = left + Inner, cr = right - Inner;
                        if (draw)
                        {
                            Box(g, p.Surface, p.Hairline, new RectangleF(left, y, right - left, h), 6);
                            string summary = s.RunningSummary ?? "";
                            Text(g, s.RunningTitle, smallStrong, fade(p.Muted), cx, y + 10);
                            Text(g, summary, small, fade(p.Muted), cr - Measure(g, summary, small), y + 10);
                        }
                        float rowTop = y + 10 + 18;
                        foreach (var session in s.Sessions)
                        {
                            float mid = rowTop + Row / 2f;
                            float rateWidth = Measure(g, session.Rate, body);
                            float room = cr - rateWidth - 12 - cx;
                            float machineWidth = Math.Min(Measure(g, session.Machine, small) + 2, room * 0.4f);
                            float fullTitle = Measure(g, session.Title, body) + 2;
                            float titleWidth = Math.Min(fullTitle, room - machineWidth - 6);
                            var titleBox = new RectangleF(cx, mid - 9, titleWidth, 18);
                            if (draw)
                            {
                                Line(g, session.Title, body, fade(p.Text), titleBox, StringAlignment.Near);
                                Line(g, session.Machine, small, fade(p.Muted), new RectangleF(cx + titleWidth + 6, mid - 8, machineWidth, 18), StringAlignment.Near);
                                Text(g, session.Rate, body, fade(p.Text), cr - rateWidth, mid - 9);
                            }
                            if (hits != null && fullTitle > titleWidth) hits.Add(Tuple.Create(titleBox, "tip:" + session.Title));
                            rowTop += Row;
                        }
                        y += h + Gap;
                    }

                    // One flag: the count of flags, then the top one.
                    if (s.Flag != null)
                    {
                        var words = new List<Tuple<string, Font>>();
                        if (s.Flag.Subject != null) foreach (var word in s.Flag.Subject.Split(' ').Where(part => part.Length > 0)) words.Add(Tuple.Create(word, strong));
                        foreach (var word in s.Flag.Text.Split(' ').Where(part => part.Length > 0)) words.Add(Tuple.Create(word, body));
                        float tx = left + Inner + 18 + 10, width = right - Inner - tx;
                        float h = 10 + Math.Max(18, Flow(g, words, p.Text, tx, 0, width, 18, false)) + 10;
                        if (draw)
                        {
                            Box(g, p.Surface, p.Hairline, new RectangleF(left, y, right - left, h), 6);
                            var badge = new RectangleF(left + Inner, y + 10, 18, 18);
                            using (var path = Rounded(badge, 4)) using (var brush = new SolidBrush(fade(p.Warning))) g.FillPath(brush, path);
                            string count = s.Flag.Count.ToString(CultureInfo.InvariantCulture);
                            Text(g, count, badgeFont, p.Dark ? Color.FromArgb(42, 36, 22) : Color.White, badge.X + (18 - Measure(g, count, badgeFont)) / 2, badge.Y + 3);
                            Flow(g, words, fade(p.Text), tx, y + 10, width, 18, true);
                        }
                        y += h + Gap;
                    }
                }

                // The footer band: one button and when the data was made.
                y += 2;
                var open = new RectangleF(left, y + 15, Measure(g, "Open dashboard", body) + 26, 30);
                if (hits != null) hits.Add(Tuple.Create(open, "dashboard"));
                if (draw)
                {
                    using (var brush = new SolidBrush(p.Footer)) g.FillRectangle(brush, new RectangleF(0, y, Width, FooterHeight));
                    using (var pen = new Pen(p.Hairline)) g.DrawLine(pen, 0, y, Width, y);
                    Box(g, p.Button, p.Hairline, open, 4);
                    Text(g, "Open dashboard", body, p.Text, open.X + 13, open.Y + 7);
                    string status = s.Refreshing ? "Refreshing…" : s.Old && s.Updated.HasValue ? "Updated " + Format.Age(s.Now - s.Updated.Value) : s.UpdatedText;
                    if (status != null) Text(g, status, small, s.Old && !s.Refreshing ? p.Warning : p.Muted, right - Measure(g, status, small), y + 23);
                }
                y += FooterHeight;
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

        static Dictionary<string, object> ReadJson(string file)
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
                state = Read(Path.Combine(settings.dataFolder, "public", "local"), DateTime.UtcNow) ?? new PanelState { Notice = "Collecting the first reading\u2026" };
            }
            if (nodeMissing) state.Notice = "Node was not found. Run npm run setup again.";
            state.Refreshing = tick != null && !tick.HasExited;
            panel.State = state;
            if (panel.Visible) panel.Place(false);
            bool current = state.Notice == null && !state.Old && !state.Empty;
            // The tray tip carries the forecast. Windows refuses a tip of 64 characters or more.
            tray.Text = Tip(current ? (state.Headline ?? state.Menu ?? "Observatory") : "Observatory: not updated recently");
            SetIcon(current, state.Ring);
        }

        static string Tip(string text)
        {
            return text.Length > 63 ? text.Substring(0, 62) + "\u2026" : text;
        }

        // glance.json from the tick is drawn as it is. Without it (an older collector, or a failed glance step) the
        // panel falls back to the forecast in combined.json.
        static PanelState Read(string folder, DateTime now)
        {
            var glance = ReadJson(Path.Combine(folder, "glance.json"));
            if (glance != null && (PanelState.Get(glance, "schema") as string) == PanelState.GlanceSchema) return PanelState.ParseGlance(glance, now);
            var combined = ReadJson(Path.Combine(folder, "combined.json"));
            return combined == null ? null : PanelState.Parse(combined, now);
        }

        // The ring alone, filled to the scarcer limit. With no current share the telescope stands in, never an empty ring.
        void SetIcon(bool current, double? ring)
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
                Color ink = light ? Color.FromArgb(28, 29, 27) : Color.White;
                if (current && ring.HasValue) Painter.Ring(graphics, new RectangleF(4, 4, 24, 24), ink, ring.Value, 3.4f);
                else Painter.Telescope(graphics, new RectangleF(0, 0, 32, 32), Color.FromArgb(current ? 255 : 120, ink), 1.7f);
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

        // `ObservatoryGlance.exe --render glance.json|combined.json out.png light|dark [now]` draws the panel to a PNG
        // without a tray, for checking the layout and for documentation screenshots.
        static int Render(string[] args)
        {
            int at = Array.IndexOf(args, "--render");
            if (args.Length < at + 4) return 2;
            var json = ReadJson(args[at + 1]);
            if (json == null) return 2;
            DateTime now = args.Length > at + 4 && PanelState.Date(args[at + 4]).HasValue ? PanelState.Date(args[at + 4]).Value : DateTime.UtcNow;
            var state = (PanelState.Get(json, "schema") as string) == PanelState.GlanceSchema ? PanelState.ParseGlance(json, now) : PanelState.Parse(json, now);
            using (var image = Painter.Render(state, args[at + 3] == "dark", 2)) image.Save(args[at + 2], System.Drawing.Imaging.ImageFormat.Png);
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
