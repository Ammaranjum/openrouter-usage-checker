using Microsoft.Win32;
using System.Runtime.InteropServices;

namespace OpenRouterUsage;

internal static class AppTheme
{
    public static bool Dark { get; private set; }
    public static Color Surface => SystemInformation.HighContrast ? SystemColors.Control : Dark ? Color.FromArgb(32, 32, 32) : Color.White;
    public static Color Text => SystemInformation.HighContrast ? SystemColors.ControlText : Dark ? Color.FromArgb(242, 242, 242) : Color.FromArgb(30, 30, 30);
    public static Color Muted => SystemInformation.HighContrast ? SystemColors.ControlText : Dark ? Color.FromArgb(190, 190, 190) : Color.FromArgb(90, 90, 90);
    public static Color Credit => SystemInformation.HighContrast ? SystemColors.ControlText : Dark ? Color.FromArgb(210, 210, 210) : Color.FromArgb(72, 72, 72);
    public static Color Error => SystemInformation.HighContrast ? SystemColors.ControlText : Dark ? Color.FromArgb(255, 170, 170) : Color.FromArgb(160, 24, 24);
    public static Color Accent => SystemInformation.HighContrast ? SystemColors.Highlight : Color.FromArgb(49, 113, 207);
    public static Color Track => SystemInformation.HighContrast ? SystemColors.Window : Dark ? Color.FromArgb(64, 64, 64) : Color.FromArgb(226, 230, 236);
    static Color Input => SystemInformation.HighContrast ? SystemColors.Window : Dark ? Color.FromArgb(45, 45, 45) : Color.White;
    public static Color Border => SystemInformation.HighContrast ? SystemColors.ControlText : Dark ? Color.FromArgb(64, 64, 64) : Color.FromArgb(225, 225, 225);
    public static Color Highlight => SystemInformation.HighContrast ? SystemColors.Highlight : Dark ? Color.FromArgb(62, 62, 62) : Color.FromArgb(230, 238, 249);

    public static void Read()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            Dark = !SystemInformation.HighContrast && key?.GetValue("AppsUseLightTheme") is int value && value == 0;
        }
        catch { Dark = false; }
    }

    public static void Apply(Control control)
    {
        control.BackColor = control is TextBoxBase or UpDownBase or ComboBox ? Input : Surface;
        control.ForeColor = control.Tag as string == "muted" ? Muted : control.Tag as string == "credit" ? Credit : control.Tag as string == "error" ? Error : Text;
        if (control is Button button)
        {
            button.FlatStyle = SystemInformation.HighContrast ? FlatStyle.Standard : FlatStyle.Flat;
            button.UseVisualStyleBackColor = SystemInformation.HighContrast;
            button.FlatAppearance.BorderColor = Muted;
            button.FlatAppearance.MouseOverBackColor = Highlight;
        }
        foreach (Control child in control.Controls) Apply(child);
        if (control is Form form && form.IsHandleCreated && OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000))
        {
            int dark = Dark ? 1 : 0;
            _ = DwmSetWindowAttribute(form.Handle, 20, ref dark, sizeof(int));
        }
        control.Invalidate(true);
    }

    public static void ApplyMenu(ToolStrip menu)
    {
        menu.BackColor = Surface;
        menu.ForeColor = Text;
        menu.Renderer = SystemInformation.HighContrast ? new ToolStripSystemRenderer() : new MenuRenderer();
        foreach (ToolStripItem item in menu.Items)
        {
            item.BackColor = Surface;
            item.ForeColor = item.Enabled ? Text : Muted;
            if (item is ToolStripControlHost host) Apply(host.Control);
            if (item is ToolStripMenuItem parent && parent.HasDropDownItems) ApplyMenu(parent.DropDown);
        }
    }

    sealed class MenuColors : ProfessionalColorTable
    {
        public override Color ToolStripDropDownBackground => Surface;
        public override Color ImageMarginGradientBegin => Surface;
        public override Color ImageMarginGradientMiddle => Surface;
        public override Color ImageMarginGradientEnd => Surface;
        public override Color MenuBorder => SystemInformation.HighContrast ? SystemColors.ControlText : Dark ? Color.FromArgb(96, 96, 96) : Color.FromArgb(187, 187, 187);
        public override Color MenuItemSelected => Highlight;
        public override Color MenuItemSelectedGradientBegin => Highlight;
        public override Color MenuItemSelectedGradientEnd => Highlight;
        public override Color MenuItemBorder => Highlight;
        public override Color SeparatorDark => Muted;
        public override Color SeparatorLight => Surface;
    }
    sealed class MenuRenderer() : ToolStripProfessionalRenderer(new MenuColors())
    {
        protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
        {
            e.TextColor = e.Item.Enabled ? Text : Muted;
            base.OnRenderItemText(e);
        }
    }

    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
}
