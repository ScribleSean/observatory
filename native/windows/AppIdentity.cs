namespace WorkspaceObservatory;

// Installed identity comes from the installer's owned marker, never a launch
// flag. Shortcuts, direct launches and login startup therefore select alike.
internal sealed record AppIdentity(bool IsTest)
{
    internal const string TestName = "Workspace Observatory Installer Test";
    internal const string TestId = "WorkspaceObservatoryInstallerTest";
    private static readonly Lazy<AppIdentity> selected = new(() => Read(AppContext.BaseDirectory));
    internal static AppIdentity Current => selected.Value;
    internal string DataName => IsTest ? TestName : "Workspace Observatory";
    internal string StartupName => IsTest ? TestId : "WorkspaceObservatory";
    internal string SingletonName => "Local\\" + (IsTest ? TestId + ".App" : StartupName);
    internal string SetupName => IsTest ? "Local\\" + TestId : InstallationGate.Name;
    internal string ActivationName => SingletonName + ".Open";
    internal string QuitName => SingletonName + ".QuitForUpdate";
    internal string Runtime => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), DataName);

    private static AppIdentity Read(string directory)
    {
        var name = Path.GetFileName(Path.TrimEndingDirectorySeparator(directory));
        var marker = Path.Combine(directory, "installer-owner.ini");
        FileAttributes attributes;
        try { attributes = File.GetAttributes(marker); }
        catch (FileNotFoundException) { return Select(name, null); }
        catch (DirectoryNotFoundException) { return Select(name, null); }
        if ((attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0 || new FileInfo(marker).Length > 4096)
            throw new IOException("Invalid installation identity.");
        return Select(name, File.ReadAllText(marker));
    }

    internal static AppIdentity Select(string directoryName, string? owner)
    {
        var testDirectory = string.Equals(directoryName, TestName, StringComparison.OrdinalIgnoreCase);
        if (owner is null)
        {
            if (testDirectory) throw new IOException("TEST installation identity is missing.");
            return new(false); // Uninstalled source builds retain the ordinary identity.
        }
        var lines = owner.Replace("\r\n", "\n").TrimEnd('\n').Split('\n');
        if (lines.Length != 3 || lines[0] != "[Owner]" || !lines[2].StartsWith("Revision=", StringComparison.Ordinal) ||
            lines[2].Length != 49 || lines[2][9..].Any(c => !(c is >= '0' and <= '9' or >= 'a' and <= 'f')))
            throw new IOException("Invalid installation identity.");
        var isTest = lines[1] == "Product=" + TestId;
        if ((!isTest && lines[1] != "Product=WorkspaceObservatorySetup") || (testDirectory && !isTest))
            throw new IOException("Unknown or conflicting installation identity.");
        return new(isTest);
    }
}
