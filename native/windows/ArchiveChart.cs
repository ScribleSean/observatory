using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal sealed record ArchiveChart(int Width, int Height, byte[] Pixels, long From, long To, long Observations, long Gaps)
{
    internal static void SelfTest()
    {
        void Check(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
        const string rasterJson = """
            {"version":1,"width":2,"height":2,"from":0,"to":1000,"encoding":"ink-mask-u8","pixels":"AAMAAA==",
             "scanned":1,"observations":1,"gaps":0,"segments":1,"firstAt":500,"lastAt":500,"minUsed":50,"maxUsed":50}
            """;
        var raster = ArchiveChart.Parse(JsonNode.Parse(rasterJson)!.AsObject());
        Check(raster.Observations == 1 && raster.Pixels.Length == 4, "Full archive mask has bounded decoded data");
        Check(raster.MatchesRange(0, 1000) && !raster.MatchesRange(1, 1000), "Chart response stays bound to requested dates");
        var gapMask = new byte[121 * 101];
        for (var x = 20; x <= 100; x++)
            gapMask[50 * 121 + x] = (byte)(x <= 40 || x >= 80 ? 1 : x % 7 < 3 ? 2 : 0);
        foreach (var x in new[] { 20, 40, 80, 100 }) gapMask[50 * 121 + x] = 3;
        foreach (var light in new[] { false, true }) {
            using var view = new ArchiveChartControl(new ArchiveChart(121, 101, gapMask, 1735689600000, 1735776000000, 4, 1)) {
                Size = new Size(660, 220), BackColor = light ? Color.FromArgb(244, 241, 236) : Color.FromArgb(39, 40, 37),
                ForeColor = light ? Color.Black : Color.WhiteSmoke };
            using var picture = new Bitmap(view.Width, view.Height);
            view.DrawToBitmap(picture, new Rectangle(Point.Empty, picture.Size));
        }
        foreach (var replacement in new[] { ("\"width\":2", "\"width\":1025"), ("AAMAAA==", "AAQAAA=="),
            ("AAMAAA==", "AA=="), ("\"observations\":1", "\"observations\":0"), ("\"firstAt\":500", "\"firstAt\":2000") }) {
            var rejected = false;
            try { ArchiveChart.Parse(JsonNode.Parse(rasterJson.Replace(replacement.Item1, replacement.Item2))!.AsObject()); }
            catch { rejected = true; }
            Check(rejected, "Malformed full archive mask is rejected");
        }
        using (var chart = new ArchiveChartControl(raster) { Size = new Size(600, 220) })
        using (var bitmap = new Bitmap(600, 220)) {
            chart.DrawToBitmap(bitmap, new Rectangle(0, 0, 600, 220));
            Check(chart.AccessibleDescription!.Contains("1 observations"), "Archive raster retains observation count accessibility");
        }
    }

    internal bool MatchesRange(long from, long to) => From == from && To == to;
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
        for (var y = 0; y < chart.Height; y++)
            for (var x = 0; x < chart.Width; x++) {
                var pixel = chart.Pixels[y * chart.Width + x];
                bitmap.SetPixel(x, y, Color.FromArgb(pixel == 0 ? 0 : pixel == 2 ? 210 : 255, Color.White));
            }
        AccessibleRole = AccessibleRole.Graphic;
        AccessibleName = "Allowance used, full selected range";
        AccessibleDescription = $"{chart.Observations} observations processed. {chart.Gaps} unknown coverage gaps. Dashed pixels are not estimated percentages.";
    }
    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var light = BackColor.GetBrightness() > .5f;
        using var brush = new SolidBrush(DashboardPalette.Muted(light));
        var box = new Rectangle(42, 8, Math.Max(1, Width - 54), Math.Max(1, Height - 40));
        foreach (var percent in new[] { 0, 50, 100 })
            e.Graphics.DrawString(percent + "%", Font, brush, 0, box.Bottom - box.Height * percent / 100 - 7);
        if (chart.Observations == 0) TextRenderer.DrawText(e.Graphics, "No observations. Missing is not zero.", Font, box, ForeColor);
        else {
            e.Graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.NearestNeighbor;
            e.Graphics.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.Half;
            var ink = DashboardPalette.Accent(light);
            using var tint = new System.Drawing.Imaging.ImageAttributes();
            tint.SetColorMatrix(new System.Drawing.Imaging.ColorMatrix(new float[][] {
                [ink.R / 255f, 0, 0, 0, 0], [0, ink.G / 255f, 0, 0, 0], [0, 0, ink.B / 255f, 0, 0],
                [0, 0, 0, 1, 0], [0, 0, 0, 0, 1] }));
            e.Graphics.DrawImage(bitmap, box, 0, 0, chart.Width, chart.Height, GraphicsUnit.Pixel, tint);
        }
        string DateLabel(long stamp) => DateTimeOffset.FromUnixTimeMilliseconds(stamp).ToLocalTime().ToString("yyyy-MM-dd");
        e.Graphics.DrawString(DateLabel(chart.From), Font, brush, box.Left, box.Bottom + 7);
        var end = DateLabel(chart.To);
        e.Graphics.DrawString(end, Font, brush, box.Right - e.Graphics.MeasureString(end, Font).Width, box.Bottom + 7);
    }
    protected override void Dispose(bool disposing) { if (disposing) bitmap.Dispose(); base.Dispose(disposing); }
}
