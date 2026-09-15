using System.Drawing.Drawing2D;

namespace WorkspaceObservatory;

internal sealed class DashboardToggle : CheckBox
{
    internal DashboardToggle()
    {
        AutoSize = false;
        Height = 44;
        Margin = new Padding(0, 0, 0, 6);
        SetStyle(ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint, true);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.Clear(BackColor);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var track = new Rectangle(Width - 48, (Height - 24) / 2, 42, 24);
        using var path = new GraphicsPath();
        path.AddArc(track.Left, track.Top, 24, 24, 90, 180);
        path.AddArc(track.Right - 24, track.Top, 24, 24, 270, 180);
        path.CloseFigure();
        using var fill = new SolidBrush(Checked ? Color.FromArgb(177, 195, 161) : Color.FromArgb(83, 83, 85));
        e.Graphics.FillPath(fill, path);
        using var thumb = new SolidBrush(Color.WhiteSmoke);
        e.Graphics.FillEllipse(thumb, Checked ? track.Right - 21 : track.Left + 3, track.Top + 3, 18, 18);
        TextRenderer.DrawText(e.Graphics, Text, Font, new Rectangle(0, 0, Math.Max(1, Width - 62), Height),
            Enabled ? ForeColor : SystemColors.GrayText, TextFormatFlags.VerticalCenter | TextFormatFlags.WordBreak);
        if (Focused && ShowFocusCues) ControlPaint.DrawFocusRectangle(e.Graphics, new Rectangle(1, 1, Width - 3, Height - 3));
    }
}
