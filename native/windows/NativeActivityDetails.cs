using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal sealed partial class NativeDashboard
{
    private string activityDetailDate = "";
    private void ActivityDetails(JsonObject[] days)
    {
        if (days.Length == 0) return;
        var dates = days.Select(day => Snapshot.Text(day["date"])).ToArray();
        if (!dates.Contains(activityDetailDate)) activityDetailDate = dates[^1];
        if (days.Length > 1) Choice("Activity detail date", dates, activityDetailDate, value => activityDetailDate = value);
        var day = days[Array.IndexOf(dates, activityDetailDate)];
        Label("Recorded activity detail · " + activityDetailDate);
        if (day["hours"] is JsonArray hours && hours.Count == 24 && hours.All(hour => Snapshot.Number(hour) is not null))
            body.Controls.Add(new ActivityHourGraph(hours.Select(hour => Snapshot.Number(hour)!.Value).ToArray()) { Width = ContentWidth, Height = 170 });
        else Label("Hourly breakdown unavailable.");
        Label("New York clock hours. Repeated daylight-saving hours share a cell. Gaps may be idle time or missing tracking.");
        if (Snapshot.Number(day["trackedSeconds"]) == 0 && Snapshot.Number(day["seconds"]) == 0)
            Label("No tracking records for this date. Zero recorded activity does not establish inactivity.");
        var categories = Counters(day["categories"]).Where(row => row.Value > 0).ToArray();
        if (categories.Length == 0) Label("No category breakdown available.");
        else Table("Activity categories", ["Category", "Recorded time"], categories.Select(row => new[] {
            row.Key == "Mixed activity" ? "Device overlap" : row.Key, Snapshot.Duration(row.Value) }));
        var apps = categories.Where(row => row.Key != "Mixed activity").SelectMany(category =>
            Counters(day["apps"]?[category.Key]).Select(app => new[] { category.Key, app.Key, Snapshot.Duration(app.Value) })).ToArray();
        if (apps.Length > 0) Table("Recorded apps", ["Category", "App", "Recorded time"], apps);
        else Label("Recorded app breakdown unavailable.");
        Label("Device overlap counts simultaneous categories once without guessing attention. AI-app foreground time is not model execution time. ChatGPT and Codex share a process label in these records.");
        Label("ActivityWatch foreground intervals intersect non-idle intervals. Only recognized app labels are shown. Window titles stay on the device.");
    }
    private static KeyValuePair<string, double>[] Counters(JsonNode? node) => node is JsonObject values
        ? values.Where(pair => Snapshot.Number(pair.Value) is not null).Select(pair => new KeyValuePair<string, double>(pair.Key, Snapshot.Number(pair.Value)!.Value))
            .OrderByDescending(pair => pair.Value).ThenBy(pair => pair.Key, StringComparer.Ordinal).ToArray() : [];
}

internal sealed class ActivityHourGraph : Control
{
    private readonly double[] seconds;
    internal ActivityHourGraph(double[] seconds)
    {
        this.seconds = seconds;
        DoubleBuffered = true; BackColor = Color.FromArgb(24, 25, 27); ForeColor = Color.WhiteSmoke;
        AccessibleRole = AccessibleRole.Graphic; AccessibleName = "Recorded activity by New York clock hour";
        AccessibleDescription = string.Join(". ", seconds.Select((value, hour) => $"{hour:00}:00: {value / 60:0.#} recorded minutes"))
            + ". Empty hours may be idle time or missing tracking.";
    }
    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var box = new RectangleF(42, 12, Math.Max(1, Width - 52), Math.Max(1, Height - 42));
        var maximum = Math.Max(3600, seconds.Max());
        using var brush = new SolidBrush(ForeColor);
        using var line = new Pen(Color.FromArgb(65, 66, 68));
        e.Graphics.DrawLine(line, box.Left, box.Bottom, box.Right, box.Bottom);
        e.Graphics.DrawString($"{maximum / 60:0} min", Font, brush, 0, box.Top);
        var slot = box.Width / 24;
        for (var hour = 0; hour < 24; hour++)
        {
            var height = (float)(seconds[hour] / maximum) * box.Height;
            e.Graphics.FillRectangle(brush, box.Left + slot * hour + 1, box.Bottom - height, Math.Max(1, slot - 2), height);
            if (hour % 6 == 0 || hour == 23) e.Graphics.DrawString(hour.ToString("00"), Font, brush, box.Left + slot * hour, box.Bottom + 5);
        }
    }
}
