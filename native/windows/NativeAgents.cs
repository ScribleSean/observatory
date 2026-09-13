using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal sealed partial class NativeDashboard
{
    private string agentView = "Handoff receipts", agentRecord = "", toolHost = "Windows";
    private bool showExecutionDetails;

    private JsonObject PickRecord(JsonObject[] records)
    {
        var choices = records.Select((row, index) => $"{index + 1}: {Snapshot.Text(row["model"])} · {Snapshot.Text(row["recordedAt"])}").ToArray();
        if (!choices.Contains(agentRecord)) agentRecord = choices[0];
        Choice("Record", choices, agentRecord, value => agentRecord = value);
        return records[Array.IndexOf(choices, agentRecord)];
    }

    private void Agents(JsonObject? snapshot)
    {
        Choice("Record type", ["Handoff receipts", "Local benchmarks", "Tool requests"], agentView, value => { agentView = value; agentRecord = ""; });
        if (agentView == "Handoff receipts")
        {
            var receipts = NativeHistory.Rows(snapshot?["agents"]);
            Label("Receipt source status: " + Snapshot.Text(snapshot?["agentSource"]?["status"]) + ". Coverage may be incomplete.");
            if (receipts.Length == 0) Label("No handoff receipts available. Missing receipts are not zero usage.");
            else
            {
                var receipt = PickRecord(receipts);
                Table("Handoff receipt", ["Field", "Recorded value"], new[] {
                    new[] { "Model", Snapshot.Text(receipt["model"]) },
                    new[] { "Status", Snapshot.Text(receipt["status"]) },
                    new[] { "Role", Snapshot.Text(receipt["role"]) },
                    new[] { "Recorded at", Snapshot.Text(receipt["recordedAt"]) },
                    new[] { "Latest call seconds", Snapshot.Format(Snapshot.Number(receipt["seconds"])) },
                    new[] { "Reported tokens", Snapshot.Text(receipt["status"]) == "failed" ? "Unknown" : Snapshot.Format(Snapshot.Number(receipt["total"])) }
                });
                if (receipt["failure"] is JsonValue failure) Label("Failure: " + Snapshot.Text(failure));
            }
            Label("Only saved top-level receipts are covered, not every agent or provider. The collector keeps one newest snapshot per conversation instead of summing cumulative counters. Duration describes the latest call. A returned response is not a review pass, and a requested model does not prove the serving model.");
        }
        else if (agentView == "Local benchmarks")
        {
            var source = snapshot?["localModel"];
            var runs = NativeHistory.Rows(source?["records"]);
            if (Snapshot.Text(source?["status"]) != "ok") Label("Local receipts unavailable.");
            else if (runs.Length == 0) Label("No saved local model runs.");
            else
            {
                var run = PickRecord(runs);
                Label(Snapshot.Text(run["model"]) + " · " + Snapshot.Text(run["status"]) + " · " + Snapshot.Text(run["recordedAt"]));
                Table("Local benchmark", ["Metric", "Recorded value"], new[] {
                    new[] { "Reply seconds", "seconds" }, new[] { "Input tokens", "input" }, new[] { "Cached tokens", "cached" },
                    new[] { "Output tokens", "output" }, new[] { "Time to first token seconds", "ttft" }, new[] { "Peak total GPU memory MiB", "peakGpuMiB" }
                }.Select(pair => new[] { pair[0], Snapshot.Format(Snapshot.Number(run[pair[1]])) }));
            }
            Label("Saved benchmarks are separate from cloud tokens and screen time. GPU memory is total device use, not model-only memory. These records do not prove a model is running now.");
        }
        else
        {
            Choice("Device", ["Mac", "Windows", "Ubuntu"], toolHost, value => toolHost = value);
            var source = NativeHistory.Rows(snapshot?["settings"]).FirstOrDefault(row => Snapshot.Text(row["host"]) == toolHost);
            Label("Tool source status: " + Snapshot.Text(source?["status"], "not-connected"));
            if (Snapshot.Text(source?["status"]) != "ok") Label("Tool records unavailable.");
            else
            {
                var calls = NativeHistory.Rows(source?["tools"]);
                if (calls.Length == 0) Label("No recorded tool requests.");
                else Table("Tool requests", ["Date", "Tool", "Namespace", "Category", "Requests"], calls.Select(call => new[] {
                    Snapshot.Text(call["date"]), Snapshot.Text(call["tool"]), Snapshot.Text(call["namespace"]), Snapshot.Text(call["category"]), Snapshot.Format(Snapshot.Number(call["count"])) }));
            }
            Label("Saved Codex request counts do not prove successful execution or time worked. Hosts are not summed. General SSH commands and unlogged tools are absent. Nested calls are not inferred from wrapper arguments.");
        }
    }
}
