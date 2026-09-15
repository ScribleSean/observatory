using System.Drawing.Drawing2D;
using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal sealed class DashboardHistoryChart : Control
{
    private readonly (string date, double? value)[] values;
    private readonly bool tokens;
    internal int RecordedCount => values.Length;

    internal static string AxisLabel(double value)
    {
        var (divisor, suffix) = value >= 1_000_000_000_000 ? (1_000_000_000_000d, "T") :
            value >= 1_000_000_000 ? (1_000_000_000d, "B") :
            value >= 1_000_000 ? (1_000_000d, "M") :
            value >= 1_000 ? (1_000d, "K") : (1d, "");
        return (value / divisor).ToString("0.#", System.Globalization.CultureInfo.CurrentCulture) + suffix;
    }

    internal DashboardHistoryChart(JsonObject[] days, bool tokens)
    {
        this.tokens = tokens;
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
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        if (Width < 100 || Height < 70) return;
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var plot = new RectangleF(12, 22, Width - 90, Height - 52);
        var maximum = Math.Max(1, values.Where(row => row.value is not null).Select(row => row.value!.Value).DefaultIfEmpty(0).Max());
        using var grid = new Pen(DashboardPalette.Grid(this));
        using var ink = new SolidBrush(tokens ? Color.FromArgb(171, 151, 192) : Color.FromArgb(177, 195, 161));
        for (var line = 0; line <= 2; line++)
        {
            var y = plot.Bottom - plot.Height * line / 2;
            g.DrawLine(grid, plot.Left, y, plot.Right, y);
            TextRenderer.DrawText(g, AxisLabel(maximum * line / 2), Font, new Rectangle(Width - 72, (int)y - 8, 66, 18), DashboardPalette.Muted(DashboardPalette.IsLight(this)), TextFormatFlags.Right);
        }
        var slot = plot.Width / Math.Max(1, values.Length);
        for (var i = 0; i < values.Length; i++)
        {
            var x = plot.Left + i * slot;
            var center = x + slot / 2;
            if (values[i].value is double value && value >= 0)
            {
                var height = (float)(plot.Height * value / maximum);
                var barWidth = Math.Min(40, slot * .7f);
                if (value == 0) g.FillEllipse(ink, center - 2, plot.Bottom - 2, 4, 4);
                else g.FillRectangle(ink, center - barWidth / 2, plot.Bottom - height, barWidth, height);
            }
            if (i % Math.Max(1, (int)Math.Ceiling(values.Length / 5.0)) == 0)
                TextRenderer.DrawText(g, values[i].date.Length >= 10 ? values[i].date[5..10] : values[i].date,
                    Font, new Rectangle((int)center - 30, (int)plot.Bottom + 6, 60, 20), DashboardPalette.Muted(DashboardPalette.IsLight(this)), TextFormatFlags.HorizontalCenter);
        }
    }
}
