using OpenRouterUsage;

internal static class Program
{
    [STAThread]
    static void Main()
    {
        Application.SetHighDpiMode(HighDpiMode.SystemAware);
        Application.EnableVisualStyles();
        AppTheme.Read();
        using var settings = new SettingsForm(new AppSettings());
        settings.Show();
        settings.PerformLayout();
        var before = settings.ClientSize;
        foreach (string text in new[] { "Connected. Usage is up to date.", "Enter a valid sk-or-… key, or clear the field to delete it." })
        {
            settings.ShowStatus(text);
            settings.PerformLayout();
            Check(settings.ClientSize == before && !settings.AutoScroll, "Settings feedback cannot resize or scroll");
            CheckBounds(settings);
        }
        Check(All(settings).OfType<ComboBox>().Single().Text == "120 seconds", "New installs select 120 seconds");
        var buttons = All(settings).OfType<Button>().Where(b => b.Text is "Close" or "&Save and refresh").ToArray();
        foreach (var button in buttons)
            Check(button.Height >= button.GetPreferredSize(Size.Empty).Height, "Completion button has its full preferred height");
        var credit = All(settings).OfType<Label>().Single(l => l.Text == "Made by Ammar");
        var coffee = All(settings).OfType<Label>().Single(l => l.Text == "Buy me a Coffee ☕");
        int buttonBottom = buttons.Max(b => b.PointToScreen(new Point(0, b.Height)).Y);
        int footerTop = Math.Min(credit.PointToScreen(Point.Empty).Y, coffee.PointToScreen(Point.Empty).Y);
        Check(footerTop - buttonBottom >= (int)Math.Round(12 * settings.DeviceDpi / 96f), "Footer has at least 12 logical pixels below buttons");
        var key = All(settings).OfType<TextBox>().Single();
        var show = All(settings).OfType<Button>().Single(b => b.AccessibleName == "Show API key");
        Check(credit.PointToScreen(Point.Empty).X == key.PointToScreen(Point.Empty).X &&
            coffee.PointToScreen(new Point(coffee.Width, 0)).X == show.PointToScreen(new Point(show.Width, 0)).X,
            "Footer aligns with the key row outer edges");
        using var savedInterval = new SettingsForm(new AppSettings(RefreshSeconds: 600));
        Check(All(savedInterval).OfType<ComboBox>().Single().Text == "10 minutes", "A saved interval stays selected");
        using var customInterval = new SettingsForm(new AppSettings(RefreshSeconds: 660));
        Check(All(customInterval).OfType<ComboBox>().Single().Text == "11 minutes", "A saved custom interval stays selected");
        using var popup = new UsagePopup(settings.DeviceDpi / 96f, SystemIcons.Application, () => { }, () => { }, () => { }, () => { });
        var data = new UsageData(null, 15, 4.05m, "monthly", 10.95m, 0.03m, 0.13m, 10.95m);
        // Populate while hidden: menu Opening runs before controls become visible.
        popup.UpdateUsage(data, DateTimeOffset.Now, "", null);
        using var window = new Form { ClientSize = popup.Size, AutoScaleMode = AutoScaleMode.None };
        window.Controls.Add(popup);
        window.Show();
        Check(All(popup).OfType<Label>().Any(l => l.Text == "$10.95 of $15.00 monthly limit used" && l.Visible), "Closed popup populates its cap before opening");
        var size = popup.Size;
        popup.UpdateUsage(data, DateTimeOffset.Now, "Refreshing usage…", null);
        Check(popup.Size == size && All(popup).Any(c => c.Text == "$4.05" && c.Visible), "Refreshing preserves the balance and popup size");
        CheckBounds(popup);
        popup.UpdateUsage(null, null, "API key rejected (401).", null);
        Check(!All(popup).Any(c => c.Visible && c.Text == "$4.05"), "An error hides the old balance");
        Check(All(popup).Any(c => c.Visible && c.Text.Contains("401")), "An error remains visible");
        CheckBounds(popup);
        Console.WriteLine("ALL WINDOWS UI CHECKS PASSED (no API requests or settings writes)");
    }
    static IEnumerable<Control> All(Control root) => root.Controls.Cast<Control>().SelectMany(c => new[] { c }.Concat(All(c)));
    static void CheckBounds(Control root)
    {
        foreach (var child in All(root).Where(c => c.Visible))
            Check(child.Parent!.ClientRectangle.Contains(child.Bounds), "Control fits: " + child.GetType().Name);
    }
    static void Check(bool value, string name)
    {
        if (!value) throw new Exception("FAIL: " + name);
        Console.WriteLine("PASS: " + name);
    }
}

// Isolate the SettingsStore path; checks never invoke Save or access a real key.
namespace OpenRouterUsage
{
    internal static class TrayApp
    {
        internal static readonly string DataDirectory = Path.Combine(Path.GetTempPath(), "openrouter-ui-check-unused");
    }
}
