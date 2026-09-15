namespace WorkspaceObservatory;

internal sealed class DashboardDisclosureButton : Button
{
    private bool hovered;
    internal DashboardDisclosureButton()
    {
        FlatStyle = FlatStyle.Flat;
        FlatAppearance.BorderSize = 0;
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
    }
    protected override void OnMouseEnter(EventArgs e) { hovered = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hovered = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnPaint(PaintEventArgs e)
    {
        var light = DashboardPalette.IsLight(this);
        e.Graphics.Clear(hovered ? DashboardPalette.Background(light) : DashboardPalette.Surface(light));
        TextRenderer.DrawText(e.Graphics, Text, Font, new Rectangle(6, 0, Math.Max(1, Width - 12), Height), ForeColor,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
        if (Focused && ShowFocusCues && Width > 6 && Height > 6)
            ControlPaint.DrawFocusRectangle(e.Graphics, new Rectangle(3, 3, Width - 6, Height - 6));
    }
}
