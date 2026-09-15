using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal sealed record ArchiveChart(int Width, int Height, byte[] Pixels, long From, long To, long Observations, long Gaps)
{
    internal static ArchiveChart Parse(JsonObject value)
    {
        long Integer(string name, long maximum = 9007199254740991) {
            if (value[name] is not JsonValue node || !node.TryGetValue<long>(out var number) || number < 0 || number > maximum)
                throw new InvalidOperationException("Invalid chart metadata.");
            return number;
        }
        var width = (int)Integer("width", 1024); var height = (int)Integer("height", 160);
        var from = Integer("from", 253402300799999); var to = Integer("to", 253402300799999);
        var observations = Integer("observations"); var gaps = Integer("gaps"); var segments = Integer("segments");
        var encoded = Snapshot.Text(value["pixels"], "");
        if (Integer("version") != 1 || width < 2 || height < 2 || to <= from || observations > Integer("scanned") ||
            gaps > observations || segments > observations || Snapshot.Text(value["encoding"]) != "ink-mask-u8" || encoded.Length > 218456)
            throw new InvalidOperationException("Invalid chart payload.");
        var pixels = Convert.FromBase64String(encoded);
        if (pixels.Length != width * height || pixels.Any(pixel => pixel > 3)) throw new InvalidOperationException("Invalid chart pixels.");
        if (observations == 0) {
            if (new[] { "firstAt", "lastAt", "minUsed", "maxUsed" }.Any(key => value[key] is not null) || pixels.Any(pixel => pixel != 0))
                throw new InvalidOperationException("Empty chart contains observations.");
        } else {
            var first = Integer("firstAt"); var last = Integer("lastAt");
            var min = Snapshot.Number(value["minUsed"]); var max = Snapshot.Number(value["maxUsed"]);
            if (first < from || last > to || first > last || min is not double low || max is not double high ||
                !double.IsFinite(low) || !double.IsFinite(high) || low < 0 || high > 100 || low > high || !pixels.Contains((byte)3))
                throw new InvalidOperationException("Invalid chart observation range.");
        }
        return new(width, height, pixels, from, to, observations, gaps);
    }
}

internal sealed class ArchiveChartControl : Control
{
    private readonly ArchiveChart chart;
    private readonly Bitmap bitmap;
    internal ArchiveChartControl(ArchiveChart chart)
    {
        this.chart = chart; DoubleBuffered = true; Height = 200;
        bitmap = new Bitmap(chart.Width, chart.Height);
        var ink = DashboardPalette.Accent(false);
        for (var y = 0; y < chart.Height; y++)
            for (var x = 0; x < chart.Width; x++) {
                var pixel = chart.Pixels[y * chart.Width + x];
                bitmap.SetPixel(x, y, Color.FromArgb(pixel == 0 ? 0 : pixel == 2 ? 110 : 255, ink));
            }
        AccessibleRole = AccessibleRole.Graphic;
        AccessibleName = "Allowance used, full selected range";
        AccessibleDescription = $"{chart.Observations} observations processed. {chart.Gaps} unknown coverage gaps. Dashed pixels are not estimated percentages.";
    }
    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        using var brush = new SolidBrush(DashboardPalette.Muted(false));
        var box = new Rectangle(42, 8, Math.Max(1, Width - 54), Math.Max(1, Height - 40));
        foreach (var percent in new[] { 0, 50, 100 })
            e.Graphics.DrawString(percent + "%", Font, brush, 0, box.Bottom - box.Height * percent / 100 - 7);
        if (chart.Observations == 0) TextRenderer.DrawText(e.Graphics, "No observations. Missing is not zero.", Font, box, ForeColor);
        else {
            e.Graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.NearestNeighbor;
            e.Graphics.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.Half;
            e.Graphics.DrawImage(bitmap, box);
        }
        string DateLabel(long stamp) => DateTimeOffset.FromUnixTimeMilliseconds(stamp).ToLocalTime().ToString("yyyy-MM-dd");
        e.Graphics.DrawString(DateLabel(chart.From), Font, brush, box.Left, box.Bottom + 7);
        var end = DateLabel(chart.To);
        e.Graphics.DrawString(end, Font, brush, box.Right - e.Graphics.MeasureString(end, Font).Width, box.Bottom + 7);
    }
    protected override void Dispose(bool disposing) { if (disposing) bitmap.Dispose(); base.Dispose(disposing); }
}
