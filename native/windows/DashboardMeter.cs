using System.Drawing.Drawing2D;

namespace WorkspaceObservatory;

// Read-only presentation of a verified fraction. Missing values never create a meter.
internal sealed class DashboardMeter : Control
{
    internal double Fraction { get; }
    internal static readonly Color FillColor = Color.FromArgb(179, 196, 163);
    internal static readonly Color TrackColor = Color.FromArgb(61, 65, 56);

    internal DashboardMeter(double fraction, string name)
    {
        if (!double.IsFinite(fraction) || fraction < 0 || fraction > 1)
            throw new ArgumentOutOfRangeException(nameof(fraction));
        Fraction = fraction;
        AccessibleName = name;
        AccessibleRole = AccessibleRole.ProgressBar;
        TabStop = false;
        Height = 10;
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
            ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
    }

    protected override AccessibleObject CreateAccessibilityInstance() => new MeterAccessibility(this);

    private sealed class MeterAccessibility(DashboardMeter owner) : ControlAccessibleObject(owner)
    {
        public override string? Value { get => $"{owner.Fraction * 100:0.#}%"; set { } }
        public override AccessibleStates State => base.State | AccessibleStates.ReadOnly;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.Clear(Parent?.BackColor ?? DashboardCard.Surface);
        if (Width < 2 || Height < 2) return;
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var bounds = new RectangleF(0, 0, Width - 1, Height - 1);
        using var track = DashboardCard.Rounded(bounds, Math.Min(bounds.Height, bounds.Width) / 2);
        using var trackInk = new SolidBrush(TrackColor);
        e.Graphics.FillPath(trackInk, track);
        if (Fraction == 0) return;
        var state = e.Graphics.Save();
        e.Graphics.SetClip(track);
        using var fill = new SolidBrush(FillColor);
        e.Graphics.FillRectangle(fill, 0, 0, (float)(bounds.Width * Fraction), bounds.Height);
        e.Graphics.Restore(state);
    }
}
