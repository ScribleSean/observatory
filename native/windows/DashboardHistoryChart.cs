using System.Drawing.Drawing2D;
using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal sealed class DashboardHistoryChart : Control
{
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    [return: System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)]
    private static extern bool SystemParametersInfo(uint action, uint parameter,
        [System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)] out bool enabled, uint flags);
    private readonly (string date, double? value)[] values;
    private readonly bool tokens;
    private readonly bool animate;
    private readonly System.Windows.Forms.Timer inkTimer = new() { Interval = 16 };
    private long inkStarted;
    private double inkOpacity = 1;
    internal int RecordedCount => values.Length;

    internal static string AxisLabel(double value)
    {
        if (!double.IsFinite(value)) return "Unknown";
        var (divisor, suffix) = value >= 999_950_000_000 ? (1_000_000_000_000d, "T") :
            value >= 999_950_000 ? (1_000_000_000d, "B") :
            value >= 999_950 ? (1_000_000d, "M") :
            value >= 999.95 ? (1_000d, "K") : (1d, "");
        return (value / divisor).ToString("0.#", System.Globalization.CultureInfo.CurrentCulture) + suffix;
    }

    internal DashboardHistoryChart(JsonObject[] days, bool tokens, bool animate = true)
    {
        this.tokens = tokens;
        this.animate = animate;
        values = days.TakeLast(30).Select(day => (Snapshot.Text(day["date"]),
            Snapshot.Number(day[tokens ? "totalTokens" : "seconds"]) / (tokens ? 1 : 60))).ToArray();
        DoubleBuffered = true;
        Height = 220;
        BackColor = DashboardCard.Surface;
        ForeColor = Color.WhiteSmoke;
        AccessibleRole = AccessibleRole.Graphic;
        AccessibleName = "Selected recorded days";
        AccessibleDescription = string.Join(". ", values.Select(row => row.date + ": " +
            (row.value is null ? "Unknown" : Snapshot.Format(row.value) + (tokens ? " tokens" : " minutes"))));
        inkTimer.Tick += (_, _) =>
        {
            var progress = Math.Clamp((Environment.TickCount64 - inkStarted) / 200d, 0, 1);
            inkOpacity = .35 + .65 * progress * progress * (3 - 2 * progress);
            if (progress >= 1) inkTimer.Stop();
            Invalidate();
        };
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        if (!animate || !SystemParametersInfo(0x1042, 0, out var animationsEnabled, 0) || !animationsEnabled) return;
        inkStarted = Environment.TickCount64;
        inkOpacity = .35;
        inkTimer.Start();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) inkTimer.Dispose();
        base.Dispose(disposing);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        if (Width < 100 || Height < 70) return;
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        const TextFormatFlags textFlags = TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix;
        Size Measure(string text) => TextRenderer.MeasureText(g, text, Font, new Size(int.MaxValue, int.MaxValue), textFlags);
        var maximum = Math.Max(1, values.Where(row => row.value is not null).Select(row => row.value!.Value).DefaultIfEmpty(0).Max());
        var ticks = Enumerable.Range(0, 3).Select(line => AxisLabel(maximum * line / 2)).ToArray();
        var tickSizes = ticks.Select(Measure).ToArray();
        var dates = values.Select(row => row.date.Length >= 10 ? row.date[5..10] : row.date).ToArray();
        var dateSizes = dates.Select(Measure).ToArray();
        var unit = tokens ? "Tokens" : "Minutes";
        var unitSize = Measure(unit);
        var axisWidth = Math.Max(66, tickSizes.Max(size => size.Width));
        var axisHeight = Math.Max(18, tickSizes.Max(size => size.Height));
        var dateHeight = Math.Max(20, dateSizes.Select(size => size.Height).DefaultIfEmpty(0).Max());
        var top = Math.Max(22, Math.Max(Font.Height, unitSize.Height) + 4);
        var bottom = Math.Max(30, Math.Max(dateHeight + 10, axisHeight / 2 + 4));
        if (Height <= top + bottom) return;
        // When labels cannot fit beside the plot, keep the bars and exact accessible values.
        var showAxis = Width - axisWidth - 24 >= Math.Max(40, unitSize.Width);
        var plot = new RectangleF(12, top, Width - (showAxis ? axisWidth + 24 : 24), Height - top - bottom);
        var muted = DashboardPalette.Muted(DashboardPalette.IsLight(this));
        if (unitSize.Width <= plot.Width)
            TextRenderer.DrawText(g, unit, Font, new Rectangle(12, 0, (int)plot.Width, unitSize.Height), muted, textFlags);
        using var grid = new Pen(DashboardPalette.Grid(this));
        var accent = DashboardPalette.Accent(DashboardPalette.IsLight(this));
        using var ink = new SolidBrush(Color.FromArgb((int)(255 * inkOpacity), accent));
        using var wash = new LinearGradientBrush(plot, Color.FromArgb((int)(255 * inkOpacity), accent),
            Color.FromArgb((int)(204 * inkOpacity), accent), LinearGradientMode.Vertical);
        for (var line = 0; line <= 2; line++)
        {
            var y = plot.Bottom - plot.Height * line / 2;
            g.DrawLine(grid, plot.Left, y, plot.Right, y);
            var labelFits = line == 2 || (line == 0 && plot.Height >= axisHeight + 4) ||
                (line == 1 && plot.Height / 2 >= axisHeight + 4);
            if (showAxis && labelFits)
                TextRenderer.DrawText(g, ticks[line], Font,
                    new Rectangle(Width - axisWidth - 6, (int)y - axisHeight / 2, axisWidth, axisHeight),
                    muted, textFlags | TextFormatFlags.Right);
        }
        var slot = plot.Width / Math.Max(1, values.Length);
        var lastDateRight = float.NegativeInfinity;
        for (var i = 0; i < values.Length; i++)
        {
            var x = plot.Left + i * slot;
            var center = x + slot / 2;
            if (values[i].value is double value && value >= 0)
            {
                var height = (float)(plot.Height * value / maximum);
                var barWidth = Math.Min(40, slot * .7f);
                if (value == 0) g.FillEllipse(ink, center - 2, plot.Bottom - 2, 4, 4);
                else
                {
                    using var bar = DashboardCard.Rounded(new RectangleF(center - barWidth / 2, plot.Bottom - height, barWidth, height), Math.Min(4, Math.Min(barWidth, height) / 2));
                    g.FillPath(wash, bar);
                }
            }
            if (i % Math.Max(1, (int)Math.Ceiling(values.Length / 5.0)) == 0)
            {
                if (dateSizes[i].Width > plot.Width) continue;
                var width = Math.Min((int)plot.Width, Math.Max(60, dateSizes[i].Width));
                var left = (int)Math.Clamp(center - width / 2f, plot.Left, plot.Right - width);
                if (left < lastDateRight + 8) continue;
                TextRenderer.DrawText(g, dates[i], Font, new Rectangle(left, (int)plot.Bottom + 6, width, dateHeight),
                    muted, textFlags | TextFormatFlags.HorizontalCenter);
                lastDateRight = left + width;
            }
        }
    }
}
