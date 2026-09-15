namespace WorkspaceObservatory;

internal sealed class DashboardFilters : Panel
{
    private readonly Label caption;
    private readonly FlowLayoutPanel chips = new() { WrapContents = true, Margin = Padding.Empty };

    internal DashboardFilters(string name, string[] values, string selected, Action<string> changed)
    {
        AccessibleName = name;
        AccessibleRole = AccessibleRole.Grouping;
        caption = new Label { Text = name, AutoSize = false, TextAlign = ContentAlignment.MiddleLeft };
        Controls.Add(caption); Controls.Add(chips);
        foreach (var value in values)
        {
            var button = new DashboardButton {
                CornerRadius = 20,
                Text = value, AccessibleName = value, Tag = value,
                Width = Math.Max(82, TextRenderer.MeasureText(value, Font).Width + 28), Height = 38,
                FlatStyle = FlatStyle.Flat, Margin = new Padding(0, 0, 8, 8),
                BackColor = value == selected ? Color.FromArgb(177, 195, 161) : DashboardCard.Surface,
                ForeColor = value == selected ? Color.FromArgb(28, 29, 27) : Color.WhiteSmoke,
                AccessibleDescription = value == selected ? "Selected" : "Not selected"
            };
            button.FlatAppearance.BorderSize = 0;
            button.Click += (_, _) => changed(value);
            chips.Controls.Add(button);
        }
    }

    protected override void OnLayout(LayoutEventArgs e)
    {
        base.OnLayout(e);
        var stacked = Width < 460;
        caption.SetBounds(0, 0, stacked ? Width : 108, 38);
        var left = stacked ? 0 : 120;
        var top = stacked ? 38 : 0;
        var width = Math.Max(100, Math.Min(680, Width) - left);
        foreach (Button button in chips.Controls)
            button.Width = Math.Max(TextRenderer.MeasureText(button.Text, button.Font).Width + 28,
                width / Math.Max(1, chips.Controls.Count) - 8);
        var height = chips.GetPreferredSize(new Size(width, 0)).Height;
        chips.SetBounds(left, top, width, Math.Max(44, height));
        Height = top + chips.Height;
    }
}
