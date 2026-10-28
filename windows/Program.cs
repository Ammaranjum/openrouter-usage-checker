using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace OpenRouterUsage;

internal static class Program
{
    [STAThread]
    static void Main()
    {
        using var mutex = new Mutex(true, @"Local\OpenRouterUsage.Windows", out bool first);
        ApplicationConfiguration.Initialize();
        if (!first)
        {
            MessageBox.Show("OpenRouter Usage is already running. Look for OR near the Windows clock.", "OpenRouter Usage");
            return;
        }
        Application.Run(new TrayApp());
    }
}

internal sealed class TrayApp : ApplicationContext
{
    internal static readonly string DataDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OpenRouterUsage");
    readonly string historyPath = Path.Combine(DataDirectory, "usage-history.json");
    readonly NotifyIcon tray;
    readonly ContextMenuStrip menu = new() { ShowImageMargin = false, Padding = new Padding(1) };
    readonly ContextMenuStrip historyMenu = new() { ShowImageMargin = false, Padding = new Padding(1) };
    readonly UsagePopup popup;
    readonly ToolStripControlHost popupHost;
    readonly System.Windows.Forms.Timer timer = new();
    readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(15) };
    readonly OpenRouterClient client;
    readonly Icon appIcon;
    AppSettings settings = new();
    CancellationTokenSource? request;
    SettingsForm? settingsWindow;
    UsageData? usage;
    DateTimeOffset? updated;
    string status = "Starting…";
    string? historyWarning;
    bool exiting;

    public TrayApp()
    {
        AppTheme.Read();
        client = new(http);
        appIcon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!) ?? (Icon)SystemIcons.Application.Clone();
        tray = new NotifyIcon { Icon = appIcon, Text = "OpenRouter Usage", ContextMenuStrip = menu, Visible = true };
        // Create the UI context before awaiting HTTP or constructing the DPI-sized popup.
        _ = menu.Handle;
        popup = new UsagePopup(menu.DeviceDpi / 96f, appIcon, () => { _ = RefreshAsync(); }, ShowRecent,
            () => { menu.Close(); ShowSettings(); }, () => ExitThread());
        popupHost = new ToolStripControlHost(popup) { AutoSize = false, Size = popup.Size, Margin = Padding.Empty, Padding = Padding.Empty };
        menu.Items.Add(popupHost);
        menu.Closed += (_, _) => { historyMenu.Close(); menu.AutoClose = true; };
        historyMenu.Closed += (_, e) =>
        {
            menu.AutoClose = true;
            if (e.CloseReason is ToolStripDropDownCloseReason.AppClicked or ToolStripDropDownCloseReason.AppFocusChange)
                menu.Close();
        };
        tray.MouseClick += (_, e) =>
        {
            if (e.Button != MouseButtons.Left) return;
            ShowUsageMenu(Cursor.Position);
        };
        menu.Opening += (_, _) => BuildMenu();
        SystemEvents.UserPreferenceChanged += ThemeChanged;
        timer.Tick += async (_, _) => await RefreshAsync();
        string? loadError = null;
        try { settings = SettingsStore.Load(); }
        catch { loadError = "Saved settings could not be read. Please enter your key again."; }
        timer.Interval = settings.RefreshSeconds * 1000;
        timer.Start();
        BuildMenu();
        menu.BeginInvoke((Action)(async () =>
        {
            if (loadError is not null) MessageBox.Show(loadError, "OpenRouter Usage", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            if (settings.Key.Length == 0) ShowSettings();
            await RefreshAsync();
        }));
    }

    async Task RefreshAsync()
    {
        request?.Cancel();
        request?.Dispose();
        var current = request = new CancellationTokenSource();
        string key = settings.Key;
        if (key.Length == 0) { usage = null; updated = null; }
        status = key.Length == 0 ? "No API key. Open Settings to add one." : "Refreshing usage…";
        if (usage is null) tray.Text = "OpenRouter Usage — " + (key.Length == 0 ? "no key" : "refreshing");
        BuildMenu();
        if (key.Length == 0) return;
        try
        {
            var observation = await client.FetchAsync(key, current.Token);
            if (exiting || request != current || current.IsCancellationRequested) return;
            usage = observation.Data;
            updated = observation.ObservedAt;
            historyWarning = null;
            try { UsageFiles.Record(historyPath, key, observation); }
            catch { historyWarning = "Latest usage could not be saved; existing history was preserved."; }
            status = "";
            string text = "OpenRouter • " + UsageFiles.PanelText(usage);
            tray.Text = text.Length > 63 ? text[..63] : text;
        }
        catch (OperationCanceledException)
        {
            if (exiting || request != current || current.IsCancellationRequested) return;
            usage = null;
            updated = null;
            status = "Request timed out. Check your connection and refresh.";
            tray.Text = "OpenRouter Usage — request timed out";
        }
        catch (Exception error)
        {
            if (exiting || request != current) return;
            usage = null;
            updated = null;
            // Never display request headers, the key, or raw server response bodies.
            status = error is HttpRequestException && error.Message.StartsWith("API key rejected")
                ? error.Message : "Could not load usage. Check your connection or API key, then refresh.";
            tray.Text = "OpenRouter Usage — unable to refresh";
        }
        if (!exiting && request == current)
        {
            settingsWindow?.ShowStatus(status.Length == 0 ? "Connected. Usage is up to date." : status, status.Length != 0);
            BuildMenu();
        }
    }

    void BuildMenu()
    {
        AppTheme.Read();
        popup.UpdateUsage(usage, updated, status, historyWarning);
        popupHost.Size = popup.Size;
        AppTheme.ApplyMenu(menu);
        menu.PerformLayout();
    }

    void ShowRecent()
    {
        if (historyMenu.Visible) { historyMenu.Close(); return; }
        foreach (ToolStripItem item in historyMenu.Items.Cast<ToolStripItem>().ToArray()) item.Dispose();
        historyMenu.Items.Clear();
        Control panel;
        try
        {
            var history = UsageFiles.ReadHistory(historyPath);
            panel = popup.History(UsageFiles.RecentDays(history, settings.Key).ToArray(), null, () => historyMenu.Close());
        }
        catch { panel = popup.History([], "Could not read saved history", () => historyMenu.Close()); }
        historyMenu.Items.Add(new ToolStripControlHost(panel) { AutoSize = false, Size = panel.Size,
            Margin = Padding.Empty, Padding = Padding.Empty });
        AppTheme.ApplyMenu(historyMenu);
        var size = historyMenu.GetPreferredSize(Size.Empty);
        var screen = Screen.FromControl(menu).WorkingArea;
        int x = menu.Left - size.Width - 6;
        if (x < screen.Left) x = Math.Min(menu.Right + 6, screen.Right - size.Width);
        int y = Math.Clamp(popup.RecentAnchor.Y, screen.Top, Math.Max(screen.Top, screen.Bottom - size.Height));
        menu.AutoClose = false;
        historyMenu.Show(new Point(Math.Max(screen.Left, x), y));
        SetForegroundWindow(historyMenu.Handle);
    }

    void ThemeChanged(object sender, UserPreferenceChangedEventArgs e)
    {
        if (exiting || menu.IsDisposed || !menu.IsHandleCreated) return;
        try
        {
            menu.BeginInvoke((Action)(() =>
            {
                if (exiting) return;
                AppTheme.Read();
                if (settingsWindow is not null) AppTheme.Apply(settingsWindow);
                BuildMenu();
                AppTheme.ApplyMenu(historyMenu);
            }));
        }
        catch (InvalidOperationException) { /* The app may be closing. */ }
    }

    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr window);

    void ShowUsageMenu(Point anchor)
    {
        if (menu.Visible) { menu.Close(); return; }
        menu.Show(anchor, ToolStripDropDownDirection.AboveLeft);
        SetForegroundWindow(menu.Handle);
    }

    void ShowSettings()
    {
        if (settingsWindow is not null) { settingsWindow.Activate(); return; }
        settingsWindow = new SettingsForm(settings);
        settingsWindow.Saved += async value =>
        {
            settings = value;
            usage = null;
            updated = null;
            historyWarning = null;
            timer.Interval = settings.RefreshSeconds * 1000;
            await RefreshAsync();
        };
        settingsWindow.FormClosed += (_, _) => settingsWindow = null;
        settingsWindow.Show();
    }

    protected override void ExitThreadCore()
    {
        exiting = true;
        SystemEvents.UserPreferenceChanged -= ThemeChanged;
        timer.Stop();
        timer.Dispose();
        request?.Cancel();
        request?.Dispose();
        settingsWindow?.Close();
        tray.Visible = false;
        tray.Dispose();
        historyMenu.Dispose();
        menu.Dispose();
        appIcon.Dispose();
        http.Dispose();
        base.ExitThreadCore();
    }
}
