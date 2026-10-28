using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;

namespace OpenRouterUsage;

// Logical pixels follow the approved 288px prototype; the host supplies the DPI scale.
internal sealed class UsagePopup : UserControl
{
    readonly float scale;
    readonly Panel summary = new(), actions = new(), progress = new();
    readonly Label credit, amount, remaining, cap, daily, weekly, monthly, updated, message;
    readonly Button refresh;
    readonly Font bodyFont = new("Segoe UI", 9.75f), titleFont = new("Segoe UI Semibold", 9.75f),
        signatureFont = new("Segoe Script", 10.5f), balanceFont = new("Segoe UI Semibold", 21),
        captionFont = new("Segoe UI", 9), updatedFont = new("Segoe UI", 8.625f);
    readonly Dictionary<string, Bitmap> icons = new();
    readonly Bitmap logo;
    readonly ToolTip tips = new();
    readonly List<Control> stats = new();
    decimal fraction;

    public UsagePopup(float dpiScale, Icon appIcon, Action onRefresh, Action onRecent, Action onSettings, Action onExit)
    {
        scale = dpiScale;
        AutoScaleMode = AutoScaleMode.None;
        Font = bodyFont;
        Size = new Size(S(286), S(346));
        DoubleBuffered = true;
        foreach (string name in new[] { "refresh-cw", "calendar-days", "settings", "power", "chevron-left" })
        {
            using var stream = typeof(UsagePopup).Assembly.GetManifestResourceStream($"OpenRouterUsage.Assets.{name}.png")!;
            using var source = new Bitmap(stream);
            icons[name] = new Bitmap(source);
        }
        logo = appIcon.ToBitmap();
        Controls.Add(summary);
        Controls.Add(actions);
        summary.SetBounds(0, 0, S(286), S(243));
        actions.SetBounds(0, S(243), S(286), S(103));
        actions.Paint += (_, e) => { using var pen = new Pen(AppTheme.Border); e.Graphics.DrawLine(pen, 0, 0, actions.Width, 0); };
        var mark = new PictureBox { Image = logo, SizeMode = PictureBoxSizeMode.Zoom };
        mark.SetBounds(S(12), S(17), S(18), S(18));
        summary.Controls.Add(mark);
        Add("OpenRouter Usage", titleFont, 37, 12, 197, 28);
        refresh = new PopupButton("", icons["refresh-cw"], scale) { AccessibleName = "Refresh usage" };
        refresh.SetBounds(S(246), S(12), S(28), S(28));
        refresh.Click += (_, _) => onRefresh();
        tips.SetToolTip(refresh, "Refresh now");
        summary.Controls.Add(refresh);
        credit = Add("Made by Ammar", signatureFont, 12, 40, 262, 20, muted: true);
        amount = Add("", balanceFont, 12, 66, 262, 34);
        remaining = Add("remaining", bodyFont, 12, 80, 75, 18, muted: true);
        cap = Add("", captionFont, 12, 105, 262, 16, muted: true);
        progress.SetBounds(S(12), S(128), S(262), S(5));
        progress.AccessibleName = "Key spending cap used";
        progress.Paint += (_, e) =>
        {
            using var track = new SolidBrush(AppTheme.Track);
            using var fill = new SolidBrush(AppTheme.Accent);
            e.Graphics.FillRectangle(track, progress.ClientRectangle);
            e.Graphics.FillRectangle(fill, 0, 0, (int)(progress.Width * fraction), progress.Height);
        };
        summary.Controls.Add(progress);
        stats.Add(progress);
        daily = Stat("Today", 142);
        weekly = Stat("This week", 166);
        monthly = Stat("This month", 190);
        updated = Add("", updatedFont, 12, 217, 262, 16, muted: true);
        message = Add("", captionFont, 12, 66, 262, 48);
        message.Visible = false;
        foreach (var (text, icon, handler, y) in new[]
        {
            ("Recent days", "calendar-days", onRecent, 4),
            ("Settings", "settings", onSettings, 36),
            ("Exit", "power", onExit, 68)
        })
        {
            var button = new PopupButton(text, icons[icon], scale, text == "Recent days" ? icons["chevron-left"] : null);
            button.SetBounds(0, S(y), S(286), S(32));
            button.Click += (_, _) => handler();
            actions.Controls.Add(button);
        }
        AppTheme.Apply(this);
    }

    int S(float value) => (int)Math.Round(value * scale);

    Label Add(string text, Font font, int x, int y, int width, int height, bool muted = false)
    {
        var label = new PopupLabel { Text = text, Font = font, Tag = muted ? "muted" : null,
            TextAlign = ContentAlignment.MiddleLeft, AutoSize = false, Margin = Padding.Empty };
        label.SetBounds(S(x), S(y), S(width), S(height));
        summary.Controls.Add(label);
        return label;
    }

    Label Stat(string name, int y)
    {
        var label = Add(name, bodyFont, 12, y, 132, 24, muted: true);
        var value = Add("", bodyFont, 144, y, 130, 24);
        value.TextAlign = ContentAlignment.MiddleRight;
        stats.Add(label);
        stats.Add(value);
        return value;
    }

    public void UpdateUsage(UsageData? data, DateTimeOffset? observed, string status, string? warning)
    {
        SuspendLayout();
        bool loading = status == "Refreshing usage…";
        refresh.Enabled = !loading;
        foreach (var control in stats) control.Visible = data is not null;
        amount.Visible = remaining.Visible = updated.Visible = data is not null;
        bool hasCap = data?.Limit is > 0 && data.LimitRemaining.HasValue;
        cap.Visible = progress.Visible = hasCap;
        int bottom = S(66);
        if (data is not null)
        {
            amount.Text = data.LimitRemaining.HasValue ? UsageFiles.Money(data.LimitRemaining) : "Not reported";
            // Leave room for unusually large balances instead of clipping the amount.
            int amountWidth = TextRenderer.MeasureText(amount.Text, balanceFont, Size.Empty, TextFormatFlags.NoPadding).Width;
            int remainingWidth = TextRenderer.MeasureText("remaining", bodyFont, Size.Empty, TextFormatFlags.NoPadding).Width;
            bool sameLine = amountWidth + S(7) + remainingWidth <= S(262);
            amount.SetBounds(S(12), S(66), Math.Min(amountWidth + S(2), S(262)), S(34));
            remaining.SetBounds(sameLine ? S(12) + amountWidth + S(7) : S(12), S(sameLine ? 80 : 100), remainingWidth + S(2), S(18));
            bottom = S(sameLine ? 105 : 123);
            if (hasCap)
            {
                decimal used = Math.Clamp(data.Limit!.Value - data.LimitRemaining!.Value, 0, data.Limit.Value);
                fraction = used / data.Limit.Value;
                string period = data.LimitReset == "monthly" ? "monthly limit" : "limit";
                cap.Text = $"{UsageFiles.Money(used)} of {UsageFiles.Money(data.Limit)} {period} used";
                int height = Math.Max(S(16), TextRenderer.MeasureText(cap.Text, captionFont,
                    new Size(S(262), int.MaxValue), TextFormatFlags.WordBreak | TextFormatFlags.NoPadding).Height);
                cap.SetBounds(S(12), bottom, S(262), height);
                progress.SetBounds(S(12), bottom + height + S(7), S(262), S(5));
                progress.AccessibleName = $"Key cap {fraction:P0} used";
                bottom += height + S(21);
            }
            int row = 0;
            foreach (var control in stats.Where(c => c != progress))
            {
                control.Top = bottom + S((row / 2) * 24);
                row++;
            }
            daily.Text = UsageFiles.Money(data.UsageDaily);
            weekly.Text = UsageFiles.Money(data.UsageWeekly);
            monthly.Text = UsageFiles.Money(data.UsageMonthly);
            updated.Text = loading ? "Refreshing…" : UsageFiles.UpdatedText(observed, DateTimeOffset.Now);
            updated.Top = bottom + S(75);
            bottom = updated.Bottom;
        }
        message.Text = data is null ? status : warning ?? "";
        bool hasMessage = message.Text.Length != 0;
        message.Visible = hasMessage;
        if (hasMessage)
        {
            int height = Math.Max(S(32), TextRenderer.MeasureText(message.Text, captionFont,
                new Size(S(262), int.MaxValue), TextFormatFlags.WordBreak | TextFormatFlags.NoPadding).Height);
            message.SetBounds(S(12), bottom + (data is null ? 0 : S(4)), S(262), height);
            bottom = message.Bottom;
        }
        summary.Height = bottom + S(10);
        actions.Top = summary.Bottom;
        Height = actions.Bottom;
        AppTheme.Apply(this);
        ResumeLayout();
        Invalidate(true);
    }

    public Point RecentAnchor => PointToScreen(new Point(0, actions.Top + S(4)));

    public Control History(IReadOnlyList<KeyValuePair<string, DailyUsage>> days, string? error, Action close)
    {
        int count = Math.Max(1, days.Count);
        var panel = new Panel { Size = new Size(S(224), S(48 + count * 27)), Font = bodyFont };
        var title = new PopupLabel { Text = "Recent days", Font = titleFont, TextAlign = ContentAlignment.MiddleLeft };
        title.SetBounds(S(12), S(10), S(176), S(28));
        panel.Controls.Add(title);
        var dismiss = new Button { Text = "×", FlatStyle = FlatStyle.Flat, AccessibleName = "Close recent days" };
        dismiss.FlatAppearance.BorderSize = 0;
        dismiss.SetBounds(S(188), S(10), S(24), S(24));
        dismiss.Click += (_, _) => close();
        panel.Controls.Add(dismiss);
        for (int i = 0; i < days.Count; i++)
        {
            var (date, day) = days[i];
            var label = new PopupLabel { Text = DateOnly.ParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture).ToString("dd MMM", CultureInfo.InvariantCulture), TextAlign = ContentAlignment.MiddleLeft };
            label.SetBounds(S(12), S(38 + i * 27), S(110), S(27));
            panel.Controls.Add(label);
            var value = new PopupLabel { Text = UsageFiles.Money(day.UsageUsd), TextAlign = ContentAlignment.MiddleRight };
            value.SetBounds(S(122), S(38 + i * 27), S(90), S(27));
            panel.Controls.Add(value);
        }
        if (days.Count == 0)
        {
            var label = new PopupLabel { Text = error ?? "No saved days yet", TextAlign = ContentAlignment.MiddleLeft };
            label.SetBounds(S(12), S(38), S(200), S(32));
            panel.Controls.Add(label);
        }
        AppTheme.Apply(panel);
        return panel;
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (!disposing) return;
        foreach (var image in icons.Values) image.Dispose();
        foreach (var font in new[] { bodyFont, titleFont, signatureFont, balanceFont, captionFont, updatedFont }) font.Dispose();
        logo.Dispose();
        tips.Dispose();
    }
}

internal sealed class PopupButton(string text, Image icon, float scale, Image? arrow = null) : Button
{
    bool hover;
    protected override void OnCreateControl()
    {
        base.OnCreateControl();
        Text = text;
        AccessibleName ??= text;
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
    }
    protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
    protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }
    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.Clear(hover && Enabled ? AppTheme.Highlight : AppTheme.Surface);
        e.Graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
        var color = hover && Enabled && SystemInformation.HighContrast ? SystemColors.HighlightText : Enabled ? AppTheme.Text : AppTheme.Muted;
        using var tint = new ImageAttributes();
        tint.SetColorMatrix(new ColorMatrix(new[] {
            new float[] { 0, 0, 0, 0, 0 }, new float[] { 0, 0, 0, 0, 0 },
            new float[] { 0, 0, 0, 0, 0 }, new float[] { 0, 0, 0, 1, 0 },
            new float[] { color.R / 255f, color.G / 255f, color.B / 255f, 0, 1 } }));
        int s(float value) => (int)Math.Round(value * scale);
        int size = s(15), x = text.Length == 0 ? (Width - size) / 2 : s(12), y = (Height - size) / 2;
        void Draw(Image image, int left) => e.Graphics.DrawImage(image, new Rectangle(left, y, size, size), 0, 0, image.Width, image.Height, GraphicsUnit.Pixel, tint);
        Draw(icon, x);
        if (text.Length != 0)
            TextRenderer.DrawText(e.Graphics, text, Font, new Rectangle(s(36), 0, Width - s(60), Height), color,
                TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.NoPadding);
        if (arrow is not null) Draw(arrow, Width - s(27));
        if (Focused && ShowFocusCues) ControlPaint.DrawFocusRectangle(e.Graphics, Rectangle.Inflate(ClientRectangle, -3, -3), color, AppTheme.Surface);
    }
}

internal sealed class PopupLabel : Label
{
    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.Clear(BackColor);
        var flags = TextFormatFlags.NoPadding | TextFormatFlags.VerticalCenter | TextFormatFlags.WordBreak;
        if (TextAlign == ContentAlignment.MiddleRight) flags |= TextFormatFlags.Right;
        TextRenderer.DrawText(e.Graphics, Text, Font, ClientRectangle, ForeColor, flags);
    }
}
