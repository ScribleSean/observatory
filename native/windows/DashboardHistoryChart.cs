using System.Drawing.Drawing2D;
using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal sealed class DashboardHistoryChart : Control
{
    private readonly (string date, double? value)[] values;
    private readonly bool tokens;
    internal int RecordedCount => values.Length;

    internal DashboardHistoryChart(JsonObject[] days, bool tokens)
    {
        this.tokens = tokens;
        values = days.TakeLast(30).Select(day => (Snapshot.Text(day["date"]),
            Snapshot.Number(day[tokens ? "totalTokens" : "seconds"]) / (tokens ? 1 : 60))).ToArray();
        DoubleBuffered = true;
        Height = 180;
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
        var plot = new RectangleF(48, 22, Width - 60, Height - 52);
        var maximum = Math.Max(1, values.Where(row => row.value is not null).Select(row => row.value!.Value).DefaultIfEmpty(0).Max());
        using var grid = new Pen(Color.FromArgb(60, 64, 58));
        using var ink = new SolidBrush(tokens ? Color.FromArgb(171, 151, 192) : Color.FromArgb(177, 195, 161));
        for (var line = 0; line <= 2; line++)
        {
            var y = plot.Bottom - plot.Height * line / 2;
            g.DrawLine(grid, plot.Left, y, plot.Right, y);
            TextRenderer.DrawText(g, Snapshot.Format(maximum * line / 2), Font, new Rectangle(0, (int)y - 8, 42, 18), Color.Silver, TextFormatFlags.Right);
        }
        var slot = plot.Width / Math.Max(1, values.Length);
        for (var i = 0; i < values.Length; i++)
        {
            var x = plot.Left + i * slot;
            if (values[i].value is double value && value >= 0)
            {
                var height = (float)(plot.Height * value / maximum);
                if (value == 0) g.FillEllipse(ink, x + slot / 2 - 2, plot.Bottom - 2, 4, 4);
                else g.FillRectangle(ink, x + slot * .15f, plot.Bottom - height, slot * .7f, height);
            }
            if (i % Math.Max(1, (int)Math.Ceiling(values.Length / 5.0)) == 0)
                TextRenderer.DrawText(g, values[i].date.Length >= 10 ? values[i].date[5..10] : values[i].date,
                    Font, new Rectangle((int)x, (int)plot.Bottom + 6, Math.Max(48, (int)slot), 20), Color.Silver, TextFormatFlags.Left);
        }
    }
}
