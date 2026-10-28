using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace OpenRouterUsage;

internal sealed record AppSettings(string Key = "", int RefreshSeconds = 120);
internal sealed record SavedSettings(string EncryptedKey, int RefreshSeconds);

internal static class SettingsStore
{
    static readonly string FilePath = Path.Combine(TrayApp.DataDirectory, "settings.json");

    public static AppSettings Load()
    {
        if (!File.Exists(FilePath)) return new();
        var saved = JsonSerializer.Deserialize<SavedSettings>(File.ReadAllText(FilePath), UsageFiles.Json)
            ?? throw new InvalidDataException("Invalid settings.");
        string key = saved.EncryptedKey.Length == 0 ? "" : Encoding.UTF8.GetString(ProtectedData.Unprotect(
            Convert.FromBase64String(saved.EncryptedKey), null, DataProtectionScope.CurrentUser));
        return new(key, saved.RefreshSeconds is >= 30 and <= 3600 ? saved.RefreshSeconds : 120);
    }

    public static void Save(AppSettings settings)
    {
        string encrypted = settings.Key.Length == 0 ? "" : Convert.ToBase64String(ProtectedData.Protect(
            Encoding.UTF8.GetBytes(settings.Key), null, DataProtectionScope.CurrentUser));
        UsageFiles.Write(FilePath, JsonSerializer.Serialize(new SavedSettings(encrypted, settings.RefreshSeconds), UsageFiles.Json));
    }
}

internal sealed class SettingsForm : Form
{
    readonly TextBox key;
    readonly ComboBox interval;
    sealed record RefreshOption(int Seconds, string Label);
    readonly Label feedback;
    readonly Button delete;
    public event Action<AppSettings>? Saved;

    public SettingsForm(AppSettings settings)
    {
        Text = "OpenRouter Usage";
        Font = new Font("Segoe UI", 9.5f);
        AutoScaleDimensions = new SizeF(96, 96);
        AutoScaleMode = AutoScaleMode.Dpi;
        AutoSize = false;
        AutoScroll = false;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        ClientSize = new Size(448, 256);
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false;
        MinimizeBox = false;
        Icon = System.Drawing.Icon.ExtractAssociatedIcon(Environment.ProcessPath!);
        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill, Padding = new Padding(16), ColumnCount = 1,
            RowCount = 7, AutoSize = false, Margin = Padding.Empty
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        // Every row, including feedback, has space before a key is saved.
        foreach (int height in new[] { 20, 30, 24, 42, 32 })
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
        // Let native button/font measurements determine the final two rows.
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        Controls.Add(layout);
        Label Note(string text) => new()
        {
            Text = text, Dock = DockStyle.Fill, Tag = "muted",
            TextAlign = ContentAlignment.MiddleLeft, Margin = Padding.Empty
        };
        layout.Controls.Add(new Label { Text = "&API key", Dock = DockStyle.Fill, Margin = Padding.Empty });
        var keyRow = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, Margin = Padding.Empty };
        keyRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        keyRow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 66));
        keyRow.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        key = new TextBox { Text = settings.Key, UseSystemPasswordChar = true, Dock = DockStyle.Fill, AccessibleName = "OpenRouter API key", Margin = new Padding(0, 3, 6, 0) };
        var show = new Button { Text = "&Show", Dock = DockStyle.Fill, Margin = Padding.Empty, AccessibleName = "Show API key" };
        show.Click += (_, _) =>
        {
            key.UseSystemPasswordChar = !key.UseSystemPasswordChar;
            show.Text = key.UseSystemPasswordChar ? "&Show" : "&Hide";
            show.AccessibleName = key.UseSystemPasswordChar ? "Show API key" : "Hide API key";
        };
        keyRow.Controls.Add(key);
        keyRow.Controls.Add(show);
        layout.Controls.Add(keyRow);
        layout.Controls.Add(Note("Encrypted for your Windows account."));
        var intervalRow = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 4, RowCount = 1, Margin = new Padding(0, 12, 0, 0) };
        intervalRow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 92));
        intervalRow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 120));
        intervalRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        intervalRow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 136));
        intervalRow.Controls.Add(new Label { Text = "&Refresh every:", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft, Margin = Padding.Empty }, 0, 0);
        interval = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Dock = DockStyle.Fill,
            DisplayMember = nameof(RefreshOption.Label), AccessibleName = "Refresh interval", Margin = new Padding(0, 3, 0, 0) };
        // Preserve an existing custom interval when opening the new preset dropdown.
        foreach (int seconds in new[] { 30, 60, 90, 120, 300, 600, 1800, 3600 }.Append(settings.RefreshSeconds).Distinct().Order())
        {
            var option = new RefreshOption(seconds, seconds > 120 && seconds % 60 == 0 ? $"{seconds / 60} minutes" : $"{seconds} seconds");
            interval.Items.Add(option);
            if (seconds == settings.RefreshSeconds) interval.SelectedItem = option;
        }
        intervalRow.Controls.Add(interval, 1, 0);
        delete = new Button { Text = "&Delete saved key", Dock = DockStyle.Fill, Enabled = settings.Key.Length != 0, Margin = Padding.Empty };
        intervalRow.Controls.Add(delete, 3, 0);
        layout.Controls.Add(intervalRow);
        feedback = new Label { Dock = DockStyle.Fill, AutoSize = false, AccessibleName = "Settings status", TextAlign = ContentAlignment.MiddleLeft, Margin = Padding.Empty };
        layout.Controls.Add(feedback);
        var buttons = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Top, FlowDirection = FlowDirection.RightToLeft, WrapContents = false, Margin = new Padding(0, 8, 0, 0) };
        var save = new Button { Text = "&Save and refresh", AutoSize = true, Padding = new Padding(6, 2, 6, 2), Margin = new Padding(6, 0, 0, 0) };
        var cancel = new Button { Text = "Close", AutoSize = true, Padding = new Padding(6, 2, 6, 2), DialogResult = DialogResult.Cancel, Margin = Padding.Empty };
        buttons.Controls.Add(save);
        buttons.Controls.Add(cancel);
        layout.Controls.Add(buttons);
        var footer = new TableLayoutPanel { AutoSize = true, Dock = DockStyle.Top, MinimumSize = new Size(0, 24), ColumnCount = 2, RowCount = 1, Margin = new Padding(0, 16, 0, 0) };
        footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        var credit = new PopupLabel { Text = "Made by Ammar", Dock = DockStyle.Fill, Tag = "credit", Margin = Padding.Empty };
        credit.Font = new Font("Segoe Script", 9);
        footer.Controls.Add(credit);
        var coffee = new PopupLabel { Text = "Buy me a Coffee ☕", Dock = DockStyle.Fill, Tag = "credit", Margin = Padding.Empty };
        coffee.TextAlign = ContentAlignment.MiddleRight;
        footer.Controls.Add(coffee);
        layout.Controls.Add(footer);
        AcceptButton = save;
        CancelButton = cancel;
        cancel.Click += (_, _) => Close();
        save.Click += (_, _) => Save();
        delete.Click += (_, _) => { key.Clear(); Save(deleting: true); };
        void FitHeight()
        {
            if (IsDisposed || Disposing) return;
            int height = layout.GetPreferredSize(new Size(layout.Width, 0)).Height;
            if (height != ClientSize.Height) ClientSize = new Size(ClientSize.Width, height);
        }
        Shown += (_, _) => FitHeight();
        DpiChanged += (_, _) => BeginInvoke((Action)FitHeight);
        HandleCreated += (_, _) => AppTheme.Apply(this);
        AppTheme.Apply(this);
    }

    public void ShowStatus(string text, bool error = false)
    {
        feedback.Tag = error ? "error" : null;
        feedback.ForeColor = error ? AppTheme.Error : AppTheme.Text;
        feedback.Text = text;
    }

    void Save(bool deleting = false)
    {
        string value = key.Text.Trim();
        if (value.Length != 0 && !Regex.IsMatch(value, @"\Ask-or-[A-Za-z0-9_.-]{16,}\z"))
        {
            ShowStatus("Enter a valid sk-or-… key, or clear the field to delete it.", error: true);
            key.Focus();
            return;
        }
        try
        {
            var settings = new AppSettings(value, ((RefreshOption)interval.SelectedItem!).Seconds);
            SettingsStore.Save(settings);
            delete.Enabled = value.Length != 0;
            ShowStatus(value.Length == 0
                ? "Key deleted. Enter a new key and save."
                : "Saved. Checking connection…");
            Saved?.Invoke(settings);
            if (deleting) key.Focus();
        }
        catch
        {
            ShowStatus("Could not save settings. Check local folder permissions.", error: true);
        }
    }
}
