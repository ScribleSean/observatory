// Generated from native/design-tokens.json by scripts/build-design-tokens.mjs.
namespace WorkspaceObservatory;

internal static partial class DashboardPalette
{
    internal static Color Background(bool light) => light ? Color.FromArgb(237, 234, 229) : Color.FromArgb(28, 29, 27);
    internal static Color Surface(bool light) => light ? Color.FromArgb(244, 241, 236) : Color.FromArgb(39, 40, 37);
    internal static Color Text(bool light) => light ? Color.FromArgb(41, 45, 40) : Color.FromArgb(240, 238, 232);
    internal static Color Muted(bool light) => light ? Color.FromArgb(100, 105, 95) : Color.FromArgb(179, 183, 172);
    internal static Color Strong(bool light) => light ? Color.FromArgb(54, 70, 50) : Color.FromArgb(220, 230, 210);
    internal static Color Accent(bool light) => light ? Color.FromArgb(88, 111, 80) : Color.FromArgb(173, 194, 157);
    internal static Color Track(bool light) => light ? Color.FromArgb(218, 219, 211) : Color.FromArgb(59, 62, 55);
    internal const int CardRadius = 16;
    internal const int CardPadding = 16;
    internal const int TitleSize = 22;
    internal const int SectionSize = 19;
    internal const float BodySize = 14.5f;
    internal const int MetaSize = 12;
    internal const int ChartLabelSize = 11;
    internal const int MetricSize = 38;
    internal const float TitleTracking = -0.7f;
    internal const float SectionTracking = -0.5f;
    internal const float CardShadowLight = 0.07f;
    internal const float CardShadowDark = 0.22f;
    internal const int CardShadowRadius = 12;
    internal const int CardShadowOffset = 6;
    internal static readonly int[] Spacing = [4, 8, 12, 16, 24];
}
