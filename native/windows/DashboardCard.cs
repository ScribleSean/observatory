using System.Drawing.Drawing2D;

namespace WorkspaceObservatory;

// Presentation only. Child controls retain their native accessibility and keyboard behavior.
internal sealed class DashboardCard : Panel
{
    internal static readonly Color Surface = Color.FromArgb(39, 41, 38);

    internal DashboardCard()
    {
        DoubleBuffered = true;
        Padding = new Padding(16);
        Margin = new Padding(0, 0, 0, 16);
        AccessibleRole = AccessibleRole.Grouping;
        ResizeRedraw = true;
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        base.OnPaintBackground(e);
        if (Width < 40 || Height < 40) return;
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        for (var layer = 3; layer > 0; layer--)
        {
            using var shadow = Rounded(new RectangleF(3 - layer, 5 - layer, Width - 6 + layer * 2, Height - 10 + layer * 2), 16);
            using var ink = new SolidBrush(Color.FromArgb(12, Color.Black));
            e.Graphics.FillPath(ink, shadow);
        }
        using var shape = Rounded(new RectangleF(2, 2, Width - 5, Height - 7), 16);
        using var surface = new SolidBrush(DashboardPalette.Surface(DashboardPalette.IsLight(this)));
        e.Graphics.FillPath(surface, shape);
    }

    internal static GraphicsPath Rounded(RectangleF rect, float radius)
    {
        var path = new GraphicsPath();
        var diameter = radius * 2;
        path.AddArc(rect.Left, rect.Top, diameter, diameter, 180, 90);
        path.AddArc(rect.Right - diameter, rect.Top, diameter, diameter, 270, 90);
        path.AddArc(rect.Right - diameter, rect.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(rect.Left, rect.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }
}
