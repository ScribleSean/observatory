using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal sealed partial class NativeDashboard
{
    private void ProviderAllowances(JsonObject? snapshot)
    {
        var source = NativeHistory.Rows(snapshot?["providerAllowances"]).FirstOrDefault(row => Snapshot.Text(row["provider"]) == "antigravity");
        var state = Snapshot.Text(source?["status"], "not-connected");
        var start = body.Controls.Count;
        Label("Antigravity").Font = heading;
        Label(state == "not-connected" ? "Collection off" : "Unknown");
        Label("Antigravity allowance reading is currently supported on Mac. Token history and allowance sharing are not connected.");
        if (source is not null) Label("Last checked: " + Freshness(Snapshot.Text(source["checkedAt"]), DateTimeOffset.UtcNow));
        GroupAccountRows(start, "Antigravity allowance");
    }
}
