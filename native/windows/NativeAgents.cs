using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal sealed partial class NativeDashboard
{
    private void Agents(JsonObject? snapshot)
    {
        Label("Saved handoff receipts").Font = heading;
        var receipts = NativeHistory.Rows(snapshot?["agents"]);
        Label("Receipt source status: " + Snapshot.Text(snapshot?["agentSource"]?["status"]) + ". Coverage may be incomplete.");
        if (receipts.Length == 0) Label("No handoff receipts available. Missing receipts are not zero usage.");
        foreach (var receipt in receipts)
        {
            AddCard(new DashboardValueCard(Snapshot.Text(receipt["model"]) + " · " + Snapshot.Text(receipt["status"]), [
                ("Role", Snapshot.Text(receipt["role"])),
                ("Recorded at", Snapshot.Text(receipt["recordedAt"])),
                ("Latest call seconds", Snapshot.Format(Snapshot.Number(receipt["seconds"]))),
                ("Reported tokens", Snapshot.Text(receipt["status"]) == "failed" ? "Unknown" : Snapshot.Format(Snapshot.Number(receipt["total"])))
            ]) { AccessibleName = "Handoff receipt" }, "Handoff receipt");
            if (receipt["failure"] is JsonValue failure) Label("Failure: " + Snapshot.Text(failure));
        }
        Label("Only saved top-level receipts are covered, not every agent or provider. One newest snapshot per conversation avoids summing cumulative counters. Duration describes the latest call. A returned response is not a review pass, and a requested model does not prove the serving model.");

        Label("Local model runs").Font = heading;
        var local = snapshot?["localModel"];
        var runs = NativeHistory.Rows(local?["records"]);
        if (Snapshot.Text(local?["status"]) != "ok") Label("Local receipts unavailable.");
        else if (runs.Length == 0) Label("No saved local model runs.");
        else foreach (var run in runs)
            AddCard(new DashboardValueCard(Snapshot.Text(run["model"]) + " · " + Snapshot.Text(run["status"]), [
                ("Recorded at", Snapshot.Text(run["recordedAt"])),
                ("Reply seconds", Snapshot.Format(Snapshot.Number(run["seconds"]))),
                ("Input tokens", Snapshot.Format(Snapshot.Number(run["input"]))),
                ("Cached tokens", Snapshot.Format(Snapshot.Number(run["cached"]))),
                ("Output tokens", Snapshot.Format(Snapshot.Number(run["output"]))),
                ("Time to first token seconds", Snapshot.Format(Snapshot.Number(run["ttft"]))),
                ("Peak total GPU memory MiB", Snapshot.Format(Snapshot.Number(run["peakGpuMiB"])))
            ]) { AccessibleName = "Local benchmark" }, "Local benchmark");
        Label("Saved benchmarks are separate from cloud tokens and screen time. GPU memory is total device use, not model-only memory. These records do not prove a model is running now.");

        Label("Recorded tool calls").Font = heading;
        var sources = NativeHistory.Rows(snapshot?["settings"]);
        if (sources.Length == 0) Label("No saved tool-call sources.");
        foreach (var source in sources)
        {
            Label(Snapshot.Text(source["host"])).Font = heading;
            if (Snapshot.Text(source["status"]) != "ok") { Label("Tool records unavailable."); continue; }
            var calls = NativeHistory.Rows(source["tools"]);
            if (calls.Length == 0) Label("No recorded tool requests.");
            foreach (var call in calls)
                AddCard(new DashboardValueCard(Snapshot.Text(call["tool"], "Unknown tool"), [
                    ("Tool", Snapshot.Text(call["tool"])), ("Namespace", Snapshot.Text(call["namespace"])),
                    ("Category", Snapshot.Text(call["category"])), ("Date", Snapshot.Text(call["date"])),
                    ("Requests", Snapshot.Format(Snapshot.Number(call["count"])))
                ]) { AccessibleName = "Tool requests" }, "Tool requests");
        }
        Label("Saved Codex request counts do not prove successful execution or time worked. Hosts are not summed. General SSH commands and unlogged tools are absent. Nested calls are not inferred from wrapper arguments.");
    }
}
