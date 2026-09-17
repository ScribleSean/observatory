using System.Drawing.Drawing2D;

namespace WorkspaceObservatory;

// Small vector symbols use the same visual concepts as the Mac sidebar.
// Labels remain native list items, so icons never replace accessible navigation names.
internal static class DashboardNavigationIcons
{
    internal static bool Draw(Graphics graphics, string section, RectangleF bounds, Color color)
    {
        if (section is not ("Allowances" or "Activity" or "Tokens" or "Dictation" or "Agents" or "Source health" or "Settings")) return false;
        if (bounds.Width <= 0 || bounds.Height <= 0) return false;
        var state = graphics.Save();
        try
        {
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            graphics.TranslateTransform(bounds.X, bounds.Y);
            graphics.ScaleTransform(bounds.Width / 24, bounds.Height / 24);
            using var pen = new Pen(color, 1.6f) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round };
            switch (section)
            {
                case "Allowances":
                    graphics.DrawEllipse(pen, 3, 3, 18, 18);
                    graphics.DrawLine(pen, 12, 12, 16, 7);
                    graphics.DrawArc(pen, 7, 7, 10, 10, 180, 45);
                    graphics.DrawLine(pen, 12, 5, 12, 6);
                    graphics.DrawLine(pen, 18, 12, 19, 12);
                    break;
                case "Activity":
                    graphics.DrawLines(pen, [new(2, 12), new(5, 12), new(7, 7), new(9, 18), new(12, 3), new(15, 21), new(17, 9), new(19, 12), new(22, 12)]);
                    break;
                case "Tokens":
                    graphics.DrawPolygon(pen, [new(3, 8), new(12, 3), new(21, 8), new(12, 13)]);
                    graphics.DrawLines(pen, [new(3, 12), new(12, 17), new(21, 12)]);
                    graphics.DrawLines(pen, [new(3, 16), new(12, 21), new(21, 16)]);
                    break;
                case "Dictation":
                    using (var mic = DashboardCard.Rounded(new RectangleF(9, 3, 6, 12), 3)) graphics.DrawPath(pen, mic);
                    graphics.DrawArc(pen, 6, 6, 12, 12, 0, 180);
                    graphics.DrawLine(pen, 6, 9, 6, 12);
                    graphics.DrawLine(pen, 18, 9, 18, 12);
                    graphics.DrawLine(pen, 12, 18, 12, 21);
                    graphics.DrawLine(pen, 8, 21, 16, 21);
                    break;
                case "Agents":
                    using (var badge = DashboardCard.Rounded(new RectangleF(4, 5, 16, 16), 2)) graphics.DrawPath(pen, badge);
                    graphics.DrawLine(pen, 8, 2, 16, 2);
                    graphics.DrawEllipse(pen, 9, 8, 6, 6);
                    graphics.DrawArc(pen, 7, 15, 10, 8, 180, 180);
                    break;
                case "Source health":
                    graphics.DrawPolygon(pen, [new(3, 16), new(7, 5), new(17, 5), new(21, 16)]);
                    graphics.DrawLine(pen, 6, 10, 18, 10);
                    graphics.DrawLine(pen, 3, 16, 5, 20);
                    graphics.DrawLine(pen, 5, 20, 19, 20);
                    graphics.DrawLine(pen, 19, 20, 21, 16);
                    break;
                case "Settings":
                    graphics.DrawEllipse(pen, 6, 6, 12, 12);
                    graphics.DrawEllipse(pen, 10, 10, 4, 4);
                    for (var i = 0; i < 8; i++)
                    {
                        var angle = i * Math.PI / 4;
                        graphics.DrawLine(pen, 12 + (float)Math.Cos(angle) * 7, 12 + (float)Math.Sin(angle) * 7,
                            12 + (float)Math.Cos(angle) * 10, 12 + (float)Math.Sin(angle) * 10);
                    }
                    break;
            }
            return true;
        }
        finally { graphics.Restore(state); }
    }
}
