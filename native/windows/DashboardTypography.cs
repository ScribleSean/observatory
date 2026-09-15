using System.Drawing.Text;
using System.Runtime.InteropServices;

namespace WorkspaceObservatory;

internal static class DashboardTypography
{
    private static readonly PrivateFontCollection Fonts = new();
    private static readonly FontFamily Family = Load();
    [DllImport("gdi32.dll", CharSet = CharSet.Unicode)]
    private static extern int AddFontResourceEx(string file, uint flags, IntPtr reserved);

    private static FontFamily Load()
    {
        try
        {
            var path = Path.Combine(AppContext.BaseDirectory, "Fonts", "InterTight.ttf");
            if (File.Exists(path) && AddFontResourceEx(path, 0x10, IntPtr.Zero) > 0)
            {
                Fonts.AddFontFile(path);
                if (Fonts.Families.Length > 0) return Fonts.Families[0];
            }
        }
        catch { /* A system font keeps the dashboard usable if the bundled font cannot load. */ }
        return new FontFamily("Segoe UI");
    }

    internal static Font AtPixels(float pixels, FontStyle style = FontStyle.Regular) =>
        new(Family, pixels, Family.IsStyleAvailable(style) ? style : FontStyle.Regular, GraphicsUnit.Pixel);
}
