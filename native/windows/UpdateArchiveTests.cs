using System.IO.Compression;
using System.Text;

namespace WorkspaceObservatory;

internal static class UpdateArchiveTests
{
    internal static void Run()
    {
        var root = Directory.CreateTempSubdirectory("observatory-archive-test-").FullName;
        try
        {
            string Make(params (string name, string text, int attributes)[] entries)
            {
                var file = Path.Combine(root, Guid.NewGuid().ToString("N") + ".zip");
                using var archive = ZipFile.Open(file, ZipArchiveMode.Create);
                foreach (var item in entries)
                {
                    var entry = archive.CreateEntry(item.name);
                    entry.ExternalAttributes = item.attributes;
                    using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(false));
                    writer.Write(item.text);
                }
                return file;
            }
            void Reject(string file, UpdateArchive.Limits? limits = null)
            {
                var before = Directory.GetDirectories(root).Length;
                var rejected = false;
                try { UpdateArchive.Extract(file, root, limits: limits); }
                catch (IOException) { rejected = true; }
                if (!rejected || Directory.GetDirectories(root).Length != before) throw new Exception("Unsafe archive created staging content.");
            }
            var good = Make(("Fonts/InterTight.ttf", "Synthetic font", 0), ("empty.txt", "", 0));
            var staged = UpdateArchive.Extract(good, root);
            if (File.ReadAllText(Path.Combine(staged, "Fonts", "InterTight.ttf")) != "Synthetic font" ||
                new FileInfo(Path.Combine(staged, "empty.txt")).Length != 0) throw new Exception("Archive bytes changed.");
            foreach (var name in new[] { "../escape", "/absolute", "C:/absolute", "a\\escape", "a:stream", "NUL.txt", "trailing.", "a//b" })
                Reject(Make((name, "Synthetic rejected data", 0)));
            Reject(Make(("same.txt", "a", 0), ("SAME.txt", "b", 0)));
            Reject(Make(("parent", "a", 0), ("parent/child", "b", 0)));
            Reject(Make(("link", "target", unchecked((int)0xa1ff0000))));
            Reject(Make(("reparse", "target", (int)FileAttributes.ReparsePoint)));
            Reject(good, new UpdateArchive.Limits(ArchiveBytes: 1));
            Reject(good, new UpdateArchive.Limits(FileBytes: 1));
            Reject(good, new UpdateArchive.Limits(ExpandedBytes: 1));
            Reject(good, new UpdateArchive.Limits(Entries: 1));
            using var cancelled = new CancellationTokenSource();
            cancelled.Cancel();
            var beforeCancel = Directory.GetDirectories(root).Length;
            var cancellationObserved = false;
            try { UpdateArchive.Extract(good, root, cancelled.Token); }
            catch (OperationCanceledException) { cancellationObserved = true; }
            if (!cancellationObserved || beforeCancel != Directory.GetDirectories(root).Length) throw new Exception("Cancelled extraction wrote files.");
            Console.WriteLine("Update archive staging preserves bytes and rejects unsafe paths, links, conflicts, size limits and cancellation.");
        }
        finally { Directory.Delete(root, true); }
    }
}
