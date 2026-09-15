using System.Drawing.Drawing2D;

namespace WorkspaceObservatory;

internal sealed class DashboardButton : Button
{
    private bool hovered, pressed;
    [System.ComponentModel.DefaultValue(20f)]
    internal float CornerRadius { get; set; } = 20;
    internal DashboardButton()
    {
        Height = 40;
        BackColor = DashboardCard.Surface;
        FlatStyle = FlatStyle.Flat;
        FlatAppearance.BorderSize = 0;
        SetStyle(ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint, true);
    }
    protected override void OnMouseEnter(EventArgs e) { hovered = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hovered = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnMouseDown(MouseEventArgs e) { pressed = true; Invalidate(); base.OnMouseDown(e); }
    protected override void OnMouseUp(MouseEventArgs e) { pressed = false; Invalidate(); base.OnMouseUp(e); }
    protected override void OnKeyDown(KeyEventArgs e) { if (e.KeyCode is Keys.Space or Keys.Enter) { pressed = true; Invalidate(); } base.OnKeyDown(e); }
    protected override void OnKeyUp(KeyEventArgs e) { pressed = false; Invalidate(); base.OnKeyUp(e); }
    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.Clear(Parent?.BackColor ?? Color.FromArgb(28, 29, 27));
        if (Width < 8 || Height < 8) return;
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var rect = new RectangleF(2, pressed ? 3 : 1, Width - 4, Height - 5);
        var radius = Math.Min(CornerRadius, rect.Height / 2);
        using var shadowPath = DashboardCard.Rounded(new RectangleF(2, 4, Width - 4, Height - 5), radius);
        using var shadow = new SolidBrush(Color.FromArgb(35, Color.Black));
        e.Graphics.FillPath(shadow, shadowPath);
        using var shape = DashboardCard.Rounded(rect, radius);
        var lift = pressed ? 2 : hovered ? 24 : 14;
        var highlight = Color.FromArgb(Math.Min(255, BackColor.R + lift), Math.Min(255, BackColor.G + lift), Math.Min(255, BackColor.B + lift));
        using var fill = new LinearGradientBrush(rect, highlight, BackColor, LinearGradientMode.Vertical);
        e.Graphics.FillPath(fill, shape);
        TextRenderer.DrawText(e.Graphics, Text, Font, Rectangle.Round(rect), Enabled ? ForeColor : Color.Gray,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.WordBreak);
        if (Focused && ShowFocusCues)
            ControlPaint.DrawFocusRectangle(e.Graphics, new Rectangle(7, 6, Width - 14, Height - 13));
    }
}
