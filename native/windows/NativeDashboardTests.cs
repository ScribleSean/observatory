using System.Drawing.Imaging;
using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal static class NativeDashboardTests
{
    internal static void Run(string output)
    {
        var data = JsonNode.Parse("""
          {"schema":2,"collectedAt":"2026-09-12T12:00:00Z",
          "activityHistory":[{"host":"Windows","status":"ok","days":[
          {"date":"2026-09-01","seconds":600},{"date":"2026-09-06","seconds":1200},{"date":"2026-09-12","seconds":1800}]}],
          "tokens":[{"host":"Windows","status":"ok","days":[{"date":"2026-09-12","totalTokens":60,"inputTokens":40,"outputTokens":20}]}],
          "combinedTokens":{"status":"ok","verification":{"status":"overlap"},"days":[{"date":"2026-09-12","totalTokens":999}]},
          "quota":{"status":"stale","checkedAt":"2026-09-12T12:00:00Z","windows":[
          {"bucket":"codex","window":"primary","remainingPercent":65},
          {"bucket":"spark","window":"primary","remainingPercent":90}],"history":[],"dailyUsageBuckets":[]}}
          """)!.AsObject();
        var refreshes = 0;
        using var form = new NativeDashboard(() => data, () => { refreshes++; return Task.CompletedTask; });
        form.Shown += async (_, _) =>
        {
            try
            {
                await Task.Delay(200);
                Check(Texts(form).Contains("30 min"), "Day total");
                await Select(form, "Period", "Week");
                Check(Texts(form).Contains("50 min"), "Calendar week total");
                await Select(form, "Period", "All retained");
                Check(Texts(form).Contains("1h 0m"), "Retained total");
                Check(Children(form).OfType<DataGridView>().Single().Rows.Count == 3, "Missing dates not fabricated");
                Capture(form, output, "native-activity");
                await Select(form, "Device", "Mac");
                Check(Texts(form).Any(value => value.StartsWith("No verified records")), "Unavailable host");
                var sections = Children(form).OfType<ListBox>().Single();
                sections.SelectedItem = "Tokens";
                await Select(form, "Device", "Windows");
                Check(Texts(form).Contains("60 tokens"), "Token total");
                Capture(form, output, "native-tokens");
                await Select(form, "Device", "All");
                Check(Texts(form).Any(value => value.StartsWith("No verified records")), "Unverified combined tokens");
                sections.SelectedItem = "Allowances";
                Check(Children(form).OfType<QuotaGraph>().Count() == 1, "Retired allowance hidden");
                Capture(form, output, "native-allowances");
                sections.SelectedItem = "Sources";
                Check(Children(form).OfType<DataGridView>().Single().Rows.Count == 2, "Source rows");
                Capture(form, output, "native-sources");
                Children(form).OfType<Button>().Single(button => button.Text == "Refresh sources").PerformClick();
                Check(refreshes == 1, "Refresh callback");
                for (var i = 0; i < 20; i++) form.Reload();
                File.WriteAllText(Path.Combine(output, "native-result.txt"), "native-dashboard: passed");
            }
            catch (Exception error)
            {
                File.WriteAllText(Path.Combine(output, "native-result.txt"), "native-dashboard: failed " + error.Message);
                Environment.ExitCode = 1;
            }
            finally { form.Close(); }
        };
        Application.Run(form);
    }
    private static IEnumerable<Control> Children(Control parent)
    {
        foreach (Control child in parent.Controls) { yield return child; foreach (var nested in Children(child)) yield return nested; }
    }
    private static string[] Texts(Control parent) => Children(parent).OfType<Label>().Select(label => label.Text).ToArray();
    private static async Task Select(Control parent, string name, string value)
    {
        Children(parent).OfType<ComboBox>().Single(choice => choice.AccessibleName == name).SelectedItem = value;
        await Task.Delay(100);
    }
    private static void Check(bool value, string name) { if (!value) throw new InvalidOperationException(name); }
    private static void Capture(Form form, string output, string name)
    {
        using var bitmap = new Bitmap(form.Width, form.Height);
        form.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size));
        bitmap.Save(Path.Combine(output, name + ".png"), ImageFormat.Png);
    }
}
