namespace WorkspaceObservatory;

internal static class DashboardPalette
{
    internal const int CardRadius = 16;
    internal const int CardPadding = 16;
    internal static readonly int[] Spacing = [4, 8, 12, 16, 24];
    internal static Color Accent(bool light) => light ? Color.FromArgb(88, 111, 80) : Color.FromArgb(173, 194, 157);
    internal static Color Background(bool light) => light ? Color.FromArgb(237, 234, 229) : Color.FromArgb(28, 29, 27);
    internal static Color Surface(bool light) => light ? Color.FromArgb(244, 241, 236) : DashboardCard.Surface;
    internal static Color Text(bool light) => light ? Color.FromArgb(41, 45, 40) : Color.FromArgb(240, 238, 232);
    internal static Color Muted(bool light) => light ? Color.FromArgb(100, 105, 95) : Color.FromArgb(179, 183, 172);
    internal static bool IsLight(Control control) => control.BackColor.GetBrightness() > .5f;
    internal static Color Grid(Control control) => IsLight(control) ? Color.FromArgb(209, 210, 201) : Color.FromArgb(60, 64, 58);

    internal static void Apply(Control control, bool light, bool inCard = false)
    {
        var selectedChip = control is Button && control.BackColor.ToArgb() == Color.FromArgb(177, 195, 161).ToArgb();
        var muted = control.ForeColor == Color.Silver || control.ForeColor == Color.LightGray ||
            control.ForeColor.ToArgb() == Muted(false).ToArgb() || control.ForeColor.ToArgb() == Muted(true).ToArgb();
        control.BackColor = selectedChip ? Color.FromArgb(177, 195, 161) :
            control is Button || (inCard && control is not DashboardCard) ? Surface(light) : Background(light);
        control.ForeColor = selectedChip ? Text(true) : muted ? Muted(light) : Text(light);
        if (control is LinkLabel link) link.LinkColor = light ? Color.FromArgb(66, 82, 130) : Color.LightSkyBlue;
        if (control is DataGridView table)
        {
            table.BackgroundColor = Surface(light);
            table.DefaultCellStyle.BackColor = Surface(light);
            table.DefaultCellStyle.ForeColor = Text(light);
            table.DefaultCellStyle.SelectionBackColor = light ? Color.FromArgb(211, 222, 200) : Color.FromArgb(66, 79, 62);
            table.DefaultCellStyle.SelectionForeColor = Text(light);
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
