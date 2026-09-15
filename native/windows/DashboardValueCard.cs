namespace WorkspaceObservatory;

internal sealed class DashboardValueCard : Panel
{
    private readonly Font titleFont = DashboardTypography.AtPixels(19, FontStyle.Bold);
    internal DashboardValueCard(string title, (string label, string value)[] rows)
    {
        Height = 40 + rows.Length * 30;
        BackColor = DashboardCard.Surface;
        AccessibleName = title;
        var heading = new Label { Text = title, Font = titleFont, Dock = DockStyle.Top, Height = 40 };
        var values = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = rows.Length };
        values.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        values.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        for (var index = 0; index < rows.Length; index++)
        {
            values.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));
            values.Controls.Add(new Label { Text = rows[index].label, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }, 0, index);
            values.Controls.Add(new Label { Text = rows[index].value, AccessibleName = rows[index].label + " value", Dock = DockStyle.Fill,
                ForeColor = Color.FromArgb(183, 186, 177), TextAlign = ContentAlignment.MiddleRight }, 1, index);
        }
        Controls.Add(values); Controls.Add(heading);
    }
    protected override void Dispose(bool disposing) { base.Dispose(disposing); if (disposing) titleFont.Dispose(); }
}
