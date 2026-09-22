namespace WorkspaceObservatory;

internal static partial class DashboardPalette
{
    internal static bool IsLight(Control control) => control.BackColor.GetBrightness() > .5f;
    internal static Color Grid(Control control) => Track(IsLight(control));

    internal static void Apply(Control control, bool light, bool inCard = false)
    {
        var selectedChip = control is Button && control.AccessibleDescription == "Selected";
        var muted = control.ForeColor == Color.Silver || control.ForeColor == Color.LightGray ||
            control.ForeColor.ToArgb() == Muted(false).ToArgb() || control.ForeColor.ToArgb() == Muted(true).ToArgb();
        control.BackColor = selectedChip ? Accent(light) :
            control is Button || (inCard && control is not DashboardCard) ? Surface(light) : Background(light);
        control.ForeColor = selectedChip ? Background(light) : muted ? Muted(light) : Text(light);
        if (control is LinkLabel link) link.LinkColor = link.ActiveLinkColor = link.VisitedLinkColor = Accent(light);
        if (control is DataGridView table)
        {
            table.BackgroundColor = Surface(light);
            table.DefaultCellStyle.BackColor = Surface(light);
            table.DefaultCellStyle.ForeColor = Text(light);
            table.DefaultCellStyle.SelectionBackColor = Accent(light);
            table.DefaultCellStyle.SelectionForeColor = Background(light);
            table.ColumnHeadersDefaultCellStyle.BackColor = Surface(light);
            table.ColumnHeadersDefaultCellStyle.ForeColor = Muted(light);
            // Read-only column labels should not acquire the operating system selection color.
            table.EnableHeadersVisualStyles = false;
            table.ColumnHeadersDefaultCellStyle.SelectionBackColor = Surface(light);
            table.ColumnHeadersDefaultCellStyle.SelectionForeColor = Muted(light);
        }
        foreach (var child in control.Controls.Cast<Control>().ToArray()) Apply(child, light, inCard || control is DashboardCard);
        control.Invalidate();
    }
}
