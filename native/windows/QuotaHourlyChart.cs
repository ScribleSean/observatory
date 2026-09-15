using System.Drawing.Drawing2D;
using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal sealed record QuotaHour(DateTimeOffset Hour, double Rate, double ObservedMinutes);

internal sealed class QuotaHourlyChart : Control
{
    private readonly QuotaHour[] hours;
    internal static QuotaHour[] Read(JsonObject quota, JsonObject window, TimeZoneInfo? zone = null)
    {
        zone ??= TimeZoneInfo.Local;
        var totals = new Dictionary<DateTimeOffset, (double used, double seconds)>();
        (DateTimeOffset at, double used, string reset)? previous = null;
        foreach (var sample in NativeHistory.Rows(quota["history"]))
        {
            var row = NativeHistory.Rows(sample["windows"]).FirstOrDefault(item =>
                Snapshot.Text(item["bucket"]) == Snapshot.Text(window["bucket"]) &&
                Snapshot.Text(item["window"]) == Snapshot.Text(window["window"]));
            if (!DateTimeOffset.TryParse(Snapshot.Text(sample["checkedAt"]), out var at) ||
                Snapshot.Number(row?["remainingPercent"]) is not double remaining ||
                !double.IsFinite(remaining) || remaining < 0 || remaining > 100)
            { previous = null; continue; }
            var used = 100 - remaining;
            var reset = Snapshot.Text(row?["resetsAt"]);
            if (previous is { } before)
            {
                var seconds = (at - before.at).TotalSeconds;
                var local = TimeZoneInfo.ConvertTime(before.at, zone);
                // Preserve the UTC offset so repeated daylight-saving hours remain distinct.
                var hour = new DateTimeOffset(local.Year, local.Month, local.Day, local.Hour, 0, 0, local.Offset);
                var sameReset = reset == before.reset ||
                    (DateTimeOffset.TryParse(reset, out var nextReset) && DateTimeOffset.TryParse(before.reset, out var priorReset) &&
                     Math.Abs((nextReset - priorReset).TotalSeconds) <= 2);
                if (seconds > 0 && seconds <= 630 && used >= before.used && sameReset && at <= hour.AddHours(1))
                {
                    var total = totals.GetValueOrDefault(hour);
                    totals[hour] = (total.used + used - before.used, total.seconds + seconds);
                }
            }
            previous = (at, used, reset);
        }
        return totals.OrderBy(row => row.Key).Select(row =>
            new QuotaHour(row.Key, row.Value.used * 3600 / row.Value.seconds, row.Value.seconds / 60)).ToArray();
    }

    internal QuotaHourlyChart(QuotaHour[] hours)
    {
        this.hours = hours;
        Height = 150;
        BackColor = DashboardCard.Surface;
        DoubleBuffered = true;
        AccessibleRole = AccessibleRole.Graphic;
        AccessibleName = "Usage pace by hour";
        AccessibleDescription = string.Join(". ", hours.Select(hour =>
            $"{hour.Hour:yyyy-MM-dd HH:mm zzz}: {hour.Rate:0.#} percentage points per hour, based on {hour.ObservedMinutes:0.#} observed minutes"));
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        if (hours.Length == 0 || Width < 120 || Height < 70) return;
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var plot = new RectangleF(12, 12, Width - 76, Height - 44);
        var maximum = Math.Max(1, hours.Max(hour => hour.Rate));
        var span = Math.Max(1, (hours[^1].Hour - hours[0].Hour).TotalHours + 1);
        using var grid = new Pen(DashboardPalette.Grid(this));
        using var ink = new SolidBrush(DashboardPalette.Accent(DashboardPalette.IsLight(this)));
        var muted = DashboardPalette.Muted(DashboardPalette.IsLight(this));
        for (var index = 0; index <= 2; index++)
        {
            var y = plot.Bottom - plot.Height * index / 2;
            g.DrawLine(grid, plot.Left, y, plot.Right, y);
            TextRenderer.DrawText(g, DashboardHistoryChart.AxisLabel(maximum * index / 2), Font,
                new Rectangle(Width - 60, (int)y - 8, 56, 18), muted, TextFormatFlags.Right);
        }
        var lastLabel = float.NegativeInfinity;
        foreach (var hour in hours)
        {
            var center = plot.Left + (float)(((hour.Hour - hours[0].Hour).TotalHours + .5) / span) * plot.Width;
            var width = Math.Min(40, (float)(plot.Width / span * .7));
            var height = (float)(plot.Height * hour.Rate / maximum);
            if (hour.Rate == 0) g.FillEllipse(ink, center - 2, plot.Bottom - 2, 4, 4);
            else
            {
                using var bar = DashboardCard.Rounded(new RectangleF(center - width / 2, plot.Bottom - height, width, height),
                    Math.Min(4, Math.Min(width, height) / 2));
                g.FillPath(ink, bar);
            }
            if (center - lastLabel >= 72)
            {
                TextRenderer.DrawText(g, hour.Hour.ToString("HH:mm"), Font,
                    new Rectangle((int)center - 32, (int)plot.Bottom + 8, 64, 20), muted, TextFormatFlags.HorizontalCenter);
                lastLabel = center;
            }
        }
    }
}
