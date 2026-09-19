using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace ClownfishClient
{
    internal static class ClientBuildConfiguration
    {
#if CLOWNFISH_DEVELOPMENT
        public const bool DevelopmentFeatures = true;
#else
        public const bool DevelopmentFeatures = false;
#endif
    }

    internal static class Program
    {
        private static Mutex instanceMutex;

        [STAThread]
        private static void Main()
        {
            bool createdNew;
            instanceMutex = new Mutex(true, @"Local\Clownfish.Client", out createdNew);
            if (!createdNew)
            {
                MessageBox.Show("小丑鱼已经在运行。", "小丑鱼", MessageBoxButtons.OK, MessageBoxIcon.Information);
                instanceMutex.Dispose();
                return;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try
            {
                Application.Run(new MainForm());
            }
            finally
            {
                try { instanceMutex.ReleaseMutex(); } catch { }
                instanceMutex.Dispose();
            }
        }
    }

    internal sealed class MainForm : Form
    {
        private int port;
        private string baseUrl;
        private readonly string dataDir;
        private readonly string packageRoot;
        private readonly string sdkRoot;
        private readonly string bundledNode;
        private readonly string sidecarEntry;
        private readonly string logDir;
        private readonly string appVersion;
        private readonly string clientToken;
        private readonly string clientSession;
        private readonly string pidFile;
        private readonly WebView2 webView;
        private readonly Icon appIcon;
        private Process serverProcess;
        private bool spawnedServer;
        private DesktopToolForm desktopToolForm;
        private NotifyIcon trayIcon;
        private ContextMenuStrip trayMenu;
        private string closeBehavior;
        private string notificationPermission;
        private bool forcedExit;
        private System.Windows.Forms.Timer reminderTimer;
        private bool reminderPollRunning;
        private string lastReminderToken;
        private readonly ManualResetEventSlim readySignal = new ManualResetEventSlim(false);
        private readonly ChildProcessJob serverJob = new ChildProcessJob();
        private string readyFailure;
        private const string WebView2DownloadUrl = "https://developer.microsoft.com/en-us/microsoft-edge/webview2/";
        private const long ServerLogMaxBytes = 4L * 1024L * 1024L;
        private const int ServerLogArchiveCount = 4;
        private static readonly object ServerLogLock = new object();

        public MainForm()
        {
            port = 0;
            baseUrl = "";
            clientToken = CreateClientToken();
            clientSession = Guid.NewGuid().ToString("N");
            dataDir = Environment.GetEnvironmentVariable("CLOWNFISH_HOME");
            if (string.IsNullOrWhiteSpace(dataDir)) dataDir = Environment.GetEnvironmentVariable(new string(new[] { (char)78, (char)69, (char)77, (char)79, (char)83, (char)95, (char)67, (char)79, (char)77, (char)80, (char)65, (char)78, (char)73, (char)79, (char)78, (char)95, (char)72, (char)79, (char)77, (char)69 }));
            if (string.IsNullOrWhiteSpace(dataDir))
            {
                var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                var preferred = Path.Combine(profile, ".clownfish");
                var legacy = Path.Combine(profile, new string(new[] { (char)46, (char)110, (char)101, (char)109, (char)111, (char)115, (char)45, (char)99, (char)111, (char)109, (char)112, (char)97, (char)110, (char)105, (char)111, (char)110 }));
                dataDir = Directory.Exists(preferred) || !Directory.Exists(legacy) ? preferred : legacy;
            }
            packageRoot = Path.GetFullPath(AppContext.BaseDirectory);
            sdkRoot = ResolveAppRoot(packageRoot);
            bundledNode = Path.Combine(packageRoot, "node", "node.exe");
            sidecarEntry = Path.Combine(sdkRoot, "examples", "companion", "portable-launcher.js");
            logDir = Path.Combine(dataDir, "logs");
            pidFile = Path.Combine(dataDir, "companion-server.pid");
            appVersion = ReadManifestValue("version", "0.1.0");
            closeBehavior = ReadClientPreference("closeBehavior", "ask");
            notificationPermission = ReadClientPreference("notificationPermission", "ask");
            lastReminderToken = ReadClientPreference("lastReminderToken", "");

            Text = "小丑鱼";
            StartPosition = FormStartPosition.CenterScreen;
            KeyPreview = true;
            MinimumSize = new Size(980, 680);
            Size = new Size(1320, 900);
            BackColor = Color.FromArgb(246, 240, 230);
            appIcon = LoadAppIcon();
            Icon = appIcon ?? SystemIcons.Application;

            var menu = BuildMenu();
            menu.Visible = false;
            MainMenuStrip = menu;
            Controls.Add(menu);
            InitTrayIcon();

            webView = new WebView2 { Dock = DockStyle.Fill };
            Controls.Add(webView);
            menu.BringToFront();
            menu.SizeChanged += (sender, args) => LayoutWebViewBelowMenu();
            Resize += (sender, args) => LayoutWebViewBelowMenu();

            Shown += async (sender, args) => await BootAsync();
            KeyDown += (sender, args) =>
            {
                if (args.Control && args.Alt && args.KeyCode == Keys.N)
                {
                    OpenDesktopTool();
                    args.Handled = true;
                }
            };
            FormClosing += HandleFormClosing;
            FormClosed += (sender, args) =>
            {
                StopServerIfOwned();
                readySignal.Dispose();
                serverJob.Dispose();
                if (reminderTimer != null) reminderTimer.Dispose();
                Microsoft.Win32.SystemEvents.PowerModeChanged -= HandlePowerModeChanged;
                if (trayIcon != null) trayIcon.Dispose();
                if (trayMenu != null) trayMenu.Dispose();
                if (appIcon != null) appIcon.Dispose();
            };
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            LayoutWebViewBelowMenu();
        }

        private void LayoutWebViewBelowMenu()
        {
            var menuHeight = MainMenuStrip != null ? MainMenuStrip.Height : 0;
            if (MainMenuStrip != null && !MainMenuStrip.Visible) menuHeight = 0;
            webView.Dock = DockStyle.None;
            webView.SetBounds(0, menuHeight, ClientSize.Width, Math.Max(0, ClientSize.Height - menuHeight));
        }

        private static string CreateClientToken()
        {
            var bytes = new byte[32];
            using (var random = RandomNumberGenerator.Create()) random.GetBytes(bytes);
            return Convert.ToBase64String(bytes);
        }

        private MenuStrip BuildMenu()
        {
            var menu = new MenuStrip();
            var appMenu = new ToolStripMenuItem("小丑鱼");
            appMenu.DropDownItems.Add("\u684c\u9762\u5c0f\u5de5\u5177", null, (sender, args) => OpenDesktopTool());
            appMenu.DropDownItems.Add("\u91cd\u65b0\u52a0\u8f7d", null, (sender, args) => webView.Reload());
            appMenu.DropDownItems.Add("\u6253\u5f00\u6570\u636e\u76ee\u5f55", null, (sender, args) => OpenPath(dataDir));
            appMenu.DropDownItems.Add("\u6253\u5f00\u670d\u52a1\u65e5\u5fd7", null, (sender, args) => OpenPath(Path.Combine(logDir, "client-server.log")));
            appMenu.DropDownItems.Add(new ToolStripSeparator());
            appMenu.DropDownItems.Add("\u9000\u51fa", null, (sender, args) => ExitApplication());

            var debugMenu = new ToolStripMenuItem("\u8c03\u8bd5");
            debugMenu.DropDownItems.Add("\u5f00\u53d1\u8005\u5de5\u5177", null, (sender, args) =>
            {
                if (webView.CoreWebView2 != null) webView.CoreWebView2.OpenDevToolsWindow();
            });

            menu.Items.Add(appMenu);
            menu.Items.Add(debugMenu);
            return menu;
        }

        private static Icon LoadAppIcon()
        {
            var baseDir = AppDomain.CurrentDomain.BaseDirectory;
            var candidates = new[]
            {
                Path.Combine(baseDir, "小丑鱼.ico"),
                Path.Combine(baseDir, "assets", "clownfish.ico")
            };
            foreach (var candidate in candidates)
            {
                try
                {
                    if (File.Exists(candidate)) return new Icon(candidate);
                }
                catch
                {
                }
            }
            return null;
        }

        private void InitTrayIcon()
        {
            trayMenu = new ContextMenuStrip();
            trayMenu.Items.Add("打开小丑鱼", null, (sender, args) => RestoreFromTray());
            trayMenu.Items.Add("桌面小工具", null, (sender, args) => OpenDesktopTool());
            trayMenu.Items.Add("通知权限", null, (sender, args) => AskNotificationPermission(true));
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add("退出", null, (sender, args) => ExitApplication());

            trayIcon = new NotifyIcon
            {
                Icon = Icon ?? SystemIcons.Application,
                Text = "小丑鱼",
                ContextMenuStrip = trayMenu,
                Visible = true
            };
            trayIcon.DoubleClick += (sender, args) => RestoreFromTray();
            trayIcon.BalloonTipClicked += (sender, args) => { RestoreFromTray(); if (webView.CoreWebView2 != null) webView.CoreWebView2.Navigate(baseUrl + "/matters"); };
        }

        private void RestoreFromTray()
        {
            Show();
            ShowInTaskbar = true;
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Activate();
        }

        private void MinimizeToTray(bool showTip)
        {
            if (trayIcon != null) trayIcon.Visible = true;
            WindowState = FormWindowState.Minimized;
            ShowInTaskbar = false;
            Hide();
            var allowed = AskNotificationPermission(false);
            if (showTip && allowed && trayIcon != null)
            {
                trayIcon.ShowBalloonTip(3500, "小丑鱼已在后台运行", "小丑鱼的定时任务和提醒会继续工作。双击托盘图标可以打开窗口。", ToolTipIcon.Info);
            }
        }

        private void ExitApplication()
        {
            forcedExit = true;
            Close();
        }

        private void HandleFormClosing(object sender, FormClosingEventArgs args)
        {
            if (forcedExit || args.CloseReason != CloseReason.UserClosing) return;

            var behavior = NormalizeCloseBehavior(closeBehavior);
            if (behavior == "ask")
            {
                using (var dialog = new CloseBehaviorDialog())
                {
                    var result = dialog.ShowDialog(this);
                    if (result != DialogResult.OK)
                    {
                        args.Cancel = true;
                        return;
                    }
                    behavior = dialog.SelectedBehavior;
                    if (dialog.RememberChoice)
                    {
                        closeBehavior = behavior;
                        SaveClientPreferences();
                    }
                }
            }

            if (behavior == "minimize")
            {
                args.Cancel = true;
                MinimizeToTray(true);
                return;
            }

            forcedExit = true;
        }

        private static string NormalizeCloseBehavior(string value)
        {
            return value == "minimize" || value == "exit" ? value : "ask";
        }

        private bool AskNotificationPermission(bool forcePrompt)
        {
            if (!forcePrompt)
            {
                if (notificationPermission == "allowed") return true;
                if (notificationPermission == "blocked") return false;
            }

            var result = MessageBox.Show(
                this,
                "允许小丑鱼在后台发送系统通知吗？\n\n最小化到托盘后，小丑鱼的定时任务、提醒和交付完成提示可以通过通知告诉你。",
                "通知权限",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question,
                MessageBoxDefaultButton.Button1);
            notificationPermission = result == DialogResult.Yes ? "allowed" : "blocked";
            SaveClientPreferences();
            if (notificationPermission == "allowed" && trayIcon != null)
            {
                trayIcon.ShowBalloonTip(2500, "通知已启用", "后台提醒会通过托盘通知显示。", ToolTipIcon.Info);
            }
            return notificationPermission == "allowed";
        }

        private static void OpenPath(string path)
        {
            try
            {
                if (Directory.Exists(path) || File.Exists(path))
                {
                    Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
                }
            }
            catch
            {
                // Menu commands should never crash the client.
            }
        }

        private void OpenDesktopTool()
        {
            if (desktopToolForm == null || desktopToolForm.IsDisposed)
            {
                desktopToolForm = new DesktopToolForm();
            }
            desktopToolForm.Show();
            desktopToolForm.Activate();
        }

        private async Task BootAsync()
        {
            try
            {
                Directory.CreateDirectory(dataDir);
                Directory.CreateDirectory(logDir);
                if (!EnsureWebView2RuntimeAvailable())
                {
                    forcedExit = true;
                    Close();
                    return;
                }
                CleanupStalePidFile();
                StartServer();
                spawnedServer = true;
                await WaitForServerAsync();
                await InitWebViewAsync();
                webView.CoreWebView2.Navigate(baseUrl);
                reminderTimer = new System.Windows.Forms.Timer { Interval = 15000 };
                reminderTimer.Tick += async (sender, args) => await PollPersonalRemindersAsync();
                reminderTimer.Start();
                Microsoft.Win32.SystemEvents.PowerModeChanged += HandlePowerModeChanged;
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, "小丑鱼\u542f\u52a8\u5931\u8d25", MessageBoxButtons.OK, MessageBoxIcon.Error);
                forcedExit = true;
                Close();
            }
        }

        private void HandlePowerModeChanged(object sender, Microsoft.Win32.PowerModeChangedEventArgs args)
        {
            if (args.Mode != Microsoft.Win32.PowerModes.Resume || IsDisposed || !IsHandleCreated) return;
            BeginInvoke(new Action(async () => { if (reminderTimer != null) reminderTimer.Interval = 15000; await PollPersonalRemindersAsync(); }));
        }

        private async Task PollPersonalRemindersAsync()
        {
            if (reminderPollRunning || forcedExit || IsDisposed) return;
            reminderPollRunning = true;
            try
            {
                // Only restart an exited backend owned by this client. Never
                // replace another process; the durable worker handles recovery.
                if (spawnedServer && serverProcess != null && serverProcess.HasExited)
                {
                    StartServer();
                    await WaitForServerAsync();
                    if (webView.CoreWebView2 != null) webView.CoreWebView2.Navigate(baseUrl);
                }
                if (notificationPermission != "allowed") return;
                var json = await Task.Run(() => {
                    var request = (HttpWebRequest)WebRequest.Create(baseUrl + "/api/personal-work/reminder-summary");
                    request.Headers["X-Clownfish-Client"] = clientToken;
                    request.Proxy = null; request.Timeout = 5000; request.ReadWriteTimeout = 5000;
                    using (var response = request.GetResponse())
                    using (var reader = new StreamReader(response.GetResponseStream())) return reader.ReadToEnd();
                });
                if (forcedExit || IsDisposed) return;
                var countMatch = Regex.Match(json, "\"count\"\\s*:\\s*(\\d+)");
                var tokenMatch = Regex.Match(json, "\"token\"\\s*:\\s*\"([a-f0-9]{64})\"");
                int count;
                if (!countMatch.Success || !tokenMatch.Success || !int.TryParse(countMatch.Groups[1].Value, out count)) return;
                reminderTimer.Interval = 15000;
                var token = tokenMatch.Groups[1].Value;
                if (count > 0 && token != lastReminderToken && trayIcon != null)
                {
                    trayIcon.Visible = true;
                    // Keep private matter titles off the lock screen.
                    trayIcon.ShowBalloonTip(5000, "小丑鱼：需要你跟进", "有 " + count + " 件事项到了跟进时间。点击查看。", ToolTipIcon.Info);
                }
                if (token != lastReminderToken) { lastReminderToken = token; SaveClientPreferences(); }
            }
            catch { if (reminderTimer != null && !IsDisposed) reminderTimer.Interval = Math.Min(120000, reminderTimer.Interval * 2); }
            finally { reminderPollRunning = false; }
        }

        private async Task InitWebViewAsync()
        {
            var profileDir = Path.Combine(dataDir, "webview-profile");
            var env = await CoreWebView2Environment.CreateAsync(null, profileDir);
            await webView.EnsureCoreWebView2Async(env);
            webView.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            webView.CoreWebView2.WebResourceRequested += (sender, args) =>
            {
                if (IsTrustedSidecarUri(args.Request.Uri, port))
                {
                    args.Request.Headers.SetHeader("X-Clownfish-Client", clientToken);
                }
                else
                {
                    // Redirects can carry headers from the initiating request. Always
                    // strip the capability outside the exact runtime sidecar origin.
                    args.Request.Headers.RemoveHeader("X-Clownfish-Client");
                }
            };
            webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = ClientBuildConfiguration.DevelopmentFeatures;
            webView.CoreWebView2.Settings.AreDevToolsEnabled = ClientBuildConfiguration.DevelopmentFeatures;
            webView.CoreWebView2.NavigationStarting += (sender, args) =>
            {
                if (IsTrustedSidecarUri(args.Uri, port)) return;
                args.Cancel = true;
                if (IsSafeExternalHttpUri(args.Uri)) OpenExternalHttpUriSafely(args.Uri);
            };
            webView.CoreWebView2.FrameNavigationStarting += (sender, args) =>
            {
                if (!IsTrustedSidecarUri(args.Uri, port)) args.Cancel = true;
            };
            webView.CoreWebView2.NewWindowRequested += (sender, args) =>
            {
                args.Handled = true;
                if (IsTrustedSidecarUri(args.Uri, port))
                {
                    webView.CoreWebView2.Navigate(args.Uri);
                }
                else if (IsSafeExternalHttpUri(args.Uri))
                {
                    OpenExternalHttpUriSafely(args.Uri);
                }
            };
            webView.CoreWebView2.PermissionRequested += (sender, args) =>
            {
                if (!IsTrustedSidecarUri(args.Uri, port))
                {
                    args.Handled = true;
                    args.State = CoreWebView2PermissionState.Deny;
                    return;
                }
                if (args.PermissionKind == CoreWebView2PermissionKind.Notifications)
                {
                    args.Handled = true;
                    args.State = AskNotificationPermission(false) ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
                }
            };
            webView.CoreWebView2.WebMessageReceived += (sender, args) =>
            {
                if (!IsTrustedWebMessageSource(args.Source, webView.CoreWebView2.Source, port)) return;
                string message;
                try { message = args.TryGetWebMessageAsString() ?? ""; }
                catch { return; }
                if (message == "open-desktop-tool")
                {
                    OpenDesktopTool();
                    return;
                }
                if (message == "capture-screen")
                {
                    CaptureScreenForComposer();
                }
            };
        }

        internal static bool IsTrustedWebMessageSource(string source, string currentDocument, int expectedPort)
        {
            if (!IsTrustedSidecarUri(source, expectedPort) || !IsTrustedSidecarUri(currentDocument, expectedPort)) return false;
            Uri sourceUri;
            Uri currentUri;
            return Uri.TryCreate(source, UriKind.Absolute, out sourceUri)
                && Uri.TryCreate(currentDocument, UriKind.Absolute, out currentUri)
                && string.Equals(sourceUri.Scheme, currentUri.Scheme, StringComparison.OrdinalIgnoreCase)
                && string.Equals(sourceUri.Host, currentUri.Host, StringComparison.Ordinal)
                && sourceUri.Port == currentUri.Port;
        }

        internal static bool IsTrustedSidecarUri(string value, int expectedPort)
        {
            Uri uri;
            return expectedPort > 0
                && Uri.TryCreate(value, UriKind.Absolute, out uri)
                && string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
                && string.Equals(uri.Host, "127.0.0.1", StringComparison.Ordinal)
                && uri.Port == expectedPort
                && string.IsNullOrEmpty(uri.UserInfo);
        }

        internal static bool IsSafeExternalHttpUri(string value)
        {
            Uri uri;
            return Uri.TryCreate(value, UriKind.Absolute, out uri)
                && (string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
                    || string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
                && string.IsNullOrEmpty(uri.UserInfo);
        }

        private static void OpenExternalHttpUriSafely(string value)
        {
            if (!IsSafeExternalHttpUri(value)) return;
            var uri = new Uri(value, UriKind.Absolute);
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        }

        private async void CaptureScreenForComposer()
        {
            string error = null;
            try
            {
                var dataUrl = CaptureScreenSelectionDataUrl();
                if (string.IsNullOrWhiteSpace(dataUrl))
                {
                    await DispatchWebEventAsync("nemos-native-screenshot", "");
                    return;
                }
                await DispatchWebEventAsync("nemos-native-screenshot", dataUrl);
            }
            catch (Exception ex)
            {
                error = "\u622a\u5c4f\u5931\u8d25\uff1a" + ex.Message;
            }
            if (!string.IsNullOrEmpty(error))
            {
                await DispatchWebEventAsync("nemos-native-screenshot-error", error);
            }
        }

        private string CaptureScreenSelectionDataUrl()
        {
            var previousState = WindowState;
            var wasVisible = Visible;
            Bitmap screen = null;
            try
            {
                Hide();
                Application.DoEvents();
                Thread.Sleep(180);

                var bounds = SystemInformation.VirtualScreen;
                screen = new Bitmap(bounds.Width, bounds.Height);
                using (var g = Graphics.FromImage(screen))
                {
                    g.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size);
                }

                using (var selector = new ScreenshotSelectionForm(screen, bounds))
                {
                    if (selector.ShowDialog() != DialogResult.OK || selector.Selection.Width < 4 || selector.Selection.Height < 4)
                    {
                        return "";
                    }

                    using (var crop = new Bitmap(selector.Selection.Width, selector.Selection.Height))
                    {
                        using (var g = Graphics.FromImage(crop))
                        {
                            g.DrawImage(screen, new Rectangle(0, 0, crop.Width, crop.Height), selector.Selection, GraphicsUnit.Pixel);
                        }
                        using (var ms = new MemoryStream())
                        {
                            crop.Save(ms, ImageFormat.Png);
                            return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
                        }
                    }
                }
            }
            finally
            {
                if (screen != null) screen.Dispose();
                if (wasVisible)
                {
                    Show();
                    WindowState = previousState;
                    Activate();
                }
            }
        }

        private Task DispatchWebEventAsync(string eventName, string detail)
        {
            if (webView.CoreWebView2 == null || !IsTrustedSidecarUri(webView.CoreWebView2.Source, port)) return Task.CompletedTask;
            var script = "window.dispatchEvent(new CustomEvent('" + eventName + "', { detail: " + JsString(detail ?? "") + " }));";
            return webView.CoreWebView2.ExecuteScriptAsync(script);
        }

        private static string JsString(string value)
        {
            return "\"" + value
                .Replace("\\", "\\\\")
                .Replace("\"", "\\\"")
                .Replace("\r", "\\r")
                .Replace("\n", "\\n")
                .Replace("<", "\\u003c")
                .Replace(">", "\\u003e") + "\"";
        }

        private bool EnsureWebView2RuntimeAvailable()
        {
            while (true)
            {
                try
                {
                    var version = CoreWebView2Environment.GetAvailableBrowserVersionString();
                    if (!string.IsNullOrWhiteSpace(version)) return true;
                }
                catch (WebView2RuntimeNotFoundException)
                {
                    // Offer an explicit trusted install path below.
                }
                catch (Exception ex)
                {
                    throw new InvalidOperationException("无法检测 Microsoft Edge WebView2 Runtime：" + ex.Message, ex);
                }

                var choice = MessageBox.Show(
                    this,
                    "运行小丑鱼需要 Microsoft Edge WebView2 Runtime。\n\n"
                    + "选择“是”：打开微软官方下载页并退出小丑鱼；安装或修复完成后请重新启动。\n"
                    + "选择“否”：如果你刚完成安装或修复，立即重新检测。\n"
                    + "选择“取消”：退出。",
                    "需要安装或修复 WebView2 Runtime",
                    MessageBoxButtons.YesNoCancel,
                    MessageBoxIcon.Warning);
                if (choice == DialogResult.No) continue;
                if (choice == DialogResult.Yes) OpenOfficialWebView2DownloadPage();
                return false;
            }
        }

        private static void OpenOfficialWebView2DownloadPage()
        {
            Uri uri;
            if (!Uri.TryCreate(WebView2DownloadUrl, UriKind.Absolute, out uri)
                || !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
                || !string.Equals(uri.Host, "developer.microsoft.com", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("WebView2 下载地址未通过安全校验。");
            }
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        }

        private static string RedactServerLogText(string value)
        {
            var redacted = value ?? "";
            redacted = Regex.Replace(redacted, @"(?i)(\bBearer\s+)[A-Za-z0-9._~+/=-]+", "$1[REDACTED]");
            redacted = Regex.Replace(
                redacted,
                "(?i)((?:[\\\"']?(?:api[_-]?key|token|client[_-]?token|session|client[_-]?session|authorization|password|passphrase|client[_-]?secret)[\\\"']?)\\s*[:=]\\s*[\\\"']?)[^\\\"'\\s,;]+",
                "$1[REDACTED]");
            redacted = Regex.Replace(
                redacted,
                @"(?i)(\b(?:OPENAI_API_KEY|ZHIPU_API_KEY|ANTHROPIC_API_KEY|ALIYUN_API_KEY|CLOWNFISH_CLIENT_TOKEN|CLOWNFISH_CLIENT_SESSION)\s*=\s*)[^\r\n\s]+",
                "$1[REDACTED]");
            redacted = Regex.Replace(redacted, @"(?i)\bsk-[A-Za-z0-9_-]{8,}\b", "[REDACTED]");
            return redacted;
        }

        internal static void AppendServerLog(string path, string value)
        {
            try
            {
                lock (ServerLogLock)
                {
                    var safeValue = RedactServerLogText(value);
                    var incomingBytes = Encoding.UTF8.GetByteCount(safeValue);
                    RotateServerLogIfNeeded(path, incomingBytes);
                    File.AppendAllText(path, safeValue, Encoding.UTF8);
                }
            }
            catch
            {
                // A diagnostics write must never take down the desktop host.
            }
        }

        private static void RotateServerLogIfNeeded(string path, int incomingBytes)
        {
            var existingBytes = File.Exists(path) ? new FileInfo(path).Length : 0L;
            if (existingBytes == 0L || existingBytes + incomingBytes <= ServerLogMaxBytes) return;

            for (var index = ServerLogArchiveCount; index >= 2; index--)
            {
                var destination = path + "." + index;
                var source = path + "." + (index - 1);
                if (File.Exists(destination)) File.Delete(destination);
                if (File.Exists(source)) File.Move(source, destination);
            }
            var firstArchive = path + ".1";
            if (File.Exists(firstArchive)) File.Delete(firstArchive);
            if (File.Exists(path)) File.Move(path, firstArchive);
        }

        private void StartServer()
        {
            readySignal.Reset();
            readyFailure = null;
            port = 0;
            baseUrl = "";
            var logPath = Path.Combine(logDir, "client-server.log");
            var errPath = Path.Combine(logDir, "client-server.err.log");
            AppendServerLog(logPath, Environment.NewLine + "[" + DateTime.Now.ToString("s") + "] starting authenticated sidecar" + Environment.NewLine);

            var launch = ResolveServerLaunch();
            var command = launch[0];
            var arguments = launch[1];
            var workingDirectory = launch[2];
            AppendServerLog(logPath,
                "command: " + command + Environment.NewLine
                + "arguments: " + arguments + Environment.NewLine
                + "working directory: " + workingDirectory + Environment.NewLine);

            var info = new ProcessStartInfo
            {
                FileName = command,
                Arguments = arguments,
                WorkingDirectory = workingDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            HardenPortableNodeEnvironment(info, command);
            info.EnvironmentVariables["PORT"] = "0";
            info.EnvironmentVariables["CLOWNFISH_HOME"] = dataDir;
            info.EnvironmentVariables["CLOWNFISH_MANIFEST"] = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "manifest.json");
            info.EnvironmentVariables["CLOWNFISH_CLIENT_TOKEN"] = clientToken;
            info.EnvironmentVariables["CLOWNFISH_CLIENT_SESSION"] = clientSession;
            // Node fetch does not use HTTP_PROXY / HTTPS_PROXY unless environment proxy support is enabled.
            // Keep NO_PROXY semantics so local services continue to connect directly.
            info.EnvironmentVariables["NODE_USE_ENV_PROXY"] = "1";

            var sandboxRuntime = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "mcp-runtime");
            var sandboxNode = Path.Combine(sandboxRuntime, "node.exe");
            var sandboxVersionFile = Path.Combine(sandboxRuntime, "version.txt");
            if (File.Exists(sandboxNode) && File.Exists(sandboxVersionFile))
            {
                var sandboxVersion = File.ReadAllText(sandboxVersionFile, Encoding.UTF8).Trim();
                if (!string.IsNullOrWhiteSpace(sandboxVersion))
                {
                    info.EnvironmentVariables["NEMOS_MCP_SANDBOX_NODE"] = sandboxNode;
                    info.EnvironmentVariables["NEMOS_MCP_SANDBOX_NODE_VERSION"] = sandboxVersion;
                }
            }

            var sandboxHost = Path.Combine(sandboxRuntime, "ClownfishSandboxHost.exe");
            var sandboxPython = Path.Combine(sandboxRuntime, "python", "python.exe");
            var sandboxPythonVersionFile = Path.Combine(sandboxRuntime, "python", "version.txt");
            if (File.Exists(sandboxHost) && File.Exists(sandboxPython) && File.Exists(sandboxPythonVersionFile))
            {
                var sandboxPythonVersion = File.ReadAllText(sandboxPythonVersionFile, Encoding.UTF8).Trim();
                if (!string.IsNullOrWhiteSpace(sandboxPythonVersion))
                {
                    info.EnvironmentVariables["NEMOS_MCP_SANDBOX_HOST"] = sandboxHost;
                    info.EnvironmentVariables["NEMOS_MCP_SANDBOX_PYTHON"] = sandboxPython;
                    info.EnvironmentVariables["NEMOS_MCP_SANDBOX_PYTHON_VERSION"] = sandboxPythonVersion;
                }
            }

            var startedProcess = new Process { StartInfo = info, EnableRaisingEvents = true };
            startedProcess.OutputDataReceived += (sender, args) =>
            {
                if (args.Data == null) return;
                AppendServerLog(logPath, args.Data + Environment.NewLine);
                if (args.Data.StartsWith("CLOWNFISH_READY ", StringComparison.Ordinal)) AcceptReadyLine(args.Data, startedProcess);
            };
            startedProcess.ErrorDataReceived += (sender, args) =>
            {
                if (args.Data != null) AppendServerLog(errPath, args.Data + Environment.NewLine);
            };
            startedProcess.Exited += (sender, args) =>
            {
                try
                {
                    AppendServerLog(logPath, "[" + DateTime.Now.ToString("s") + "] server exited with code " + startedProcess.ExitCode + Environment.NewLine);
                    DeletePidIfOwned(startedProcess.Id);
                    if (!readySignal.IsSet)
                    {
                        readyFailure = "本机服务在报告就绪前退出。";
                        readySignal.Set();
                    }
                }
                catch
                {
                }
            };
            startedProcess.Start();
            try
            {
                serverJob.AddProcess(startedProcess);
            }
            catch
            {
                try { startedProcess.Kill(); } catch { }
                throw;
            }
            serverProcess = startedProcess;
            startedProcess.BeginOutputReadLine();
            startedProcess.BeginErrorReadLine();
            File.WriteAllText(pidFile, "{\"pid\":" + startedProcess.Id + ",\"clientSession\":\"" + clientSession + "\"}", Encoding.UTF8);
        }

        private void AcceptReadyLine(string line, Process process)
        {
            try
            {
                var json = line.Substring("CLOWNFISH_READY ".Length);
                var appId = ReadJsonValue(json, "appId");
                var version = ReadJsonValue(json, "version");
                var session = ReadJsonValue(json, "clientSession");
                var portText = ReadJsonNumber(json, "port");
                var pidText = ReadJsonNumber(json, "pid");
                int reportedPort;
                int reportedPid;
                if (appId != "clownfish" || version != appVersion || session != clientSession
                    || !int.TryParse(portText, out reportedPort) || reportedPort < 1 || reportedPort > 65535
                    || !int.TryParse(pidText, out reportedPid) || reportedPid != process.Id)
                {
                    throw new InvalidOperationException("本机服务身份或版本校验失败。");
                }
                port = reportedPort;
                baseUrl = "http://127.0.0.1:" + reportedPort;
            }
            catch (Exception ex)
            {
                readyFailure = ex.Message;
            }
            finally
            {
                readySignal.Set();
            }
        }

        private static string ReadJsonValue(string json, string key)
        {
            var match = Regex.Match(json ?? "", "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"((?:\\\\.|[^\"])*)\"");
            return match.Success ? Regex.Unescape(match.Groups[1].Value) : "";
        }

        private static string ReadJsonNumber(string json, string key)
        {
            var match = Regex.Match(json ?? "", "\"" + Regex.Escape(key) + "\"\\s*:\\s*(\\d+)");
            return match.Success ? match.Groups[1].Value : "";
        }

        private static string ResolveAppRoot(string root)
        {
            var portableRoot = Path.Combine(root, "app");
            if (File.Exists(Path.Combine(portableRoot, "examples", "companion", "portable-launcher.js")))
            {
                return portableRoot;
            }
#if CLOWNFISH_DEVELOPMENT
            return Path.GetFullPath(Path.Combine(root, "..", "..", "..", ".."));
#else
            return portableRoot;
#endif
        }

        private string ReadManifestValue(string key, string fallback)
        {
            try
            {
                var manifestPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "manifest.json");
                if (!File.Exists(manifestPath)) return fallback;
                var text = File.ReadAllText(manifestPath);
                var match = Regex.Match(text, "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"([^\"]+)\"");
                return match.Success ? match.Groups[1].Value : fallback;
            }
            catch
            {
                return fallback;
            }
        }

        private string ClientPreferencesFile()
        {
            return Path.Combine(dataDir, "client-preferences.json");
        }

        private string ReadClientPreference(string key, string fallback)
        {
            try
            {
                var file = ClientPreferencesFile();
                if (!File.Exists(file)) return fallback;
                var text = File.ReadAllText(file, Encoding.UTF8);
                var match = Regex.Match(text, "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"([^\"]*)\"");
                return match.Success ? match.Groups[1].Value : fallback;
            }
            catch
            {
                return fallback;
            }
        }

        private void SaveClientPreferences()
        {
            try
            {
                Directory.CreateDirectory(dataDir);
                var json = "{"
                    + "\"closeBehavior\":\"" + ClientJsonEscape(NormalizeCloseBehavior(closeBehavior)) + "\","
                    + "\"notificationPermission\":\"" + ClientJsonEscape(NormalizeNotificationPermission(notificationPermission)) + "\","
                    + "\"lastReminderToken\":\"" + ClientJsonEscape(lastReminderToken ?? "") + "\""
                    + "}";
                File.WriteAllText(ClientPreferencesFile(), json, Encoding.UTF8);
            }
            catch
            {
                // Preference persistence should not block closing or notifications.
            }
        }

        private static string NormalizeNotificationPermission(string value)
        {
            return value == "allowed" || value == "blocked" ? value : "ask";
        }

        private static string ClientJsonEscape(string value)
        {
            return (value ?? "")
                .Replace("\\", "\\\\")
                .Replace("\"", "\\\"")
                .Replace("\r", "\\r")
                .Replace("\n", "\\n");
        }

        private void CleanupStalePidFile()
        {
            try
            {
                if (!File.Exists(pidFile)) return;
                var text = File.ReadAllText(pidFile, Encoding.UTF8);
                var pidText = text.TrimStart().StartsWith("{") ? ReadJsonNumber(text, "pid") : text.Trim();
                int pid;
                if (!int.TryParse(pidText, out pid)) { File.Delete(pidFile); return; }
                try
                {
                    using (var process = Process.GetProcessById(pid))
                    {
                        if (!process.HasExited) return;
                    }
                }
                catch (ArgumentException) { }
                File.Delete(pidFile);
            }
            catch { }
        }

        private void DeletePidIfOwned(int pid)
        {
            try
            {
                if (!File.Exists(pidFile)) return;
                var text = File.ReadAllText(pidFile, Encoding.UTF8);
                if (ReadJsonNumber(text, "pid") == pid.ToString() && ReadJsonValue(text, "clientSession") == clientSession)
                {
                    File.Delete(pidFile);
                }
            }
            catch { }
        }

        internal static string[] ResolvePackagedServerLaunch(string root)
        {
            if (string.IsNullOrWhiteSpace(root)) throw new InvalidOperationException("便携包根目录无效。");
            var package = Path.GetFullPath(root);
            var app = Path.GetFullPath(Path.Combine(package, "app"));
            var node = Path.GetFullPath(Path.Combine(package, "node", "node.exe"));
            var entry = Path.GetFullPath(Path.Combine(app, "examples", "companion", "portable-launcher.js"));
            var prefix = package.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!node.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
                || !app.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
                || !entry.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("便携包运行路径超出安装目录。");
            if (!File.Exists(node))
                throw new InvalidOperationException("便携包不完整：缺少包内固定 Node 运行时 node\\node.exe。请完整解压便携包后，从包内启动小丑鱼。");
            if (!File.Exists(entry))
                throw new InvalidOperationException("便携包不完整：缺少已构建的本机服务入口 app\\examples\\companion\\portable-launcher.js。请重新完整解压便携包。");
            return new[] { node, "\"" + entry + "\"", app };
        }

        private string[] ResolveServerLaunch()
        {
            if (File.Exists(bundledNode) && File.Exists(sidecarEntry)) return ResolvePackagedServerLaunch(packageRoot);
#if CLOWNFISH_DEVELOPMENT
            return new[] { Environment.OSVersion.Platform == PlatformID.Win32NT ? "npm.cmd" : "npm", "run companion", sdkRoot };
#else
            return ResolvePackagedServerLaunch(packageRoot);
#endif
        }

        internal static void HardenPortableNodeEnvironment(ProcessStartInfo info, string nodeExecutable)
        {
            if (info == null) throw new ArgumentNullException("info");
            var remove = new List<string>();
            foreach (string key in info.EnvironmentVariables.Keys)
            {
                if (key.StartsWith("npm_", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(key, "NODE_OPTIONS", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(key, "NODE_PATH", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(key, "INIT_CWD", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(key, "PNPM_HOME", StringComparison.OrdinalIgnoreCase)
                    || key.StartsWith("YARN_", StringComparison.OrdinalIgnoreCase)
                    || key.StartsWith("COREPACK_", StringComparison.OrdinalIgnoreCase)) remove.Add(key);
            }
            foreach (var key in remove) info.EnvironmentVariables.Remove(key);
            var windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            var safePath = new List<string> { Path.GetDirectoryName(Path.GetFullPath(nodeExecutable)) };
            if (!string.IsNullOrWhiteSpace(windows))
            {
                safePath.Add(Path.Combine(windows, "System32"));
                safePath.Add(windows);
            }
            info.EnvironmentVariables["PATH"] = string.Join(";", safePath.ToArray());
        }

        private async Task WaitForServerAsync()
        {
            var signaled = await Task.Run(() => readySignal.Wait(TimeSpan.FromSeconds(30)));
            if (!signaled) throw new TimeoutException(BuildServerFailureMessage("本机服务没有报告启动身份。"));
            if (!string.IsNullOrWhiteSpace(readyFailure)) throw new InvalidOperationException(BuildServerFailureMessage(readyFailure));
            var deadline = DateTime.UtcNow.AddSeconds(30);
            while (DateTime.UtcNow < deadline)
            {
                if (await IsServerReadyAsync()) return;
                if (spawnedServer && serverProcess != null && serverProcess.HasExited)
                {
                    throw new InvalidOperationException(BuildServerFailureMessage("本机服务启动后意外退出。"));
                }
                await Task.Delay(450);
            }
            throw new TimeoutException(BuildServerFailureMessage("本机服务启动超时。"));
        }

        private string BuildServerFailureMessage(string summary)
        {
            var logPath = Path.Combine(logDir, "client-server.log");
            var errPath = Path.Combine(logDir, "client-server.err.log");
            var detail = ReadLogTail(errPath, 2400);
            return summary
                + "\n日志：" + logPath
                + "\n错误日志：" + errPath
                + (string.IsNullOrWhiteSpace(detail) ? "" : "\n\n错误详情：\n" + detail);
        }

        private static string ReadLogTail(string path, int maxLength)
        {
            try
            {
                if (!File.Exists(path)) return "";
                var text = RedactServerLogText(File.ReadAllText(path, Encoding.UTF8)).Trim();
                return text.Length <= maxLength ? text : text.Substring(text.Length - maxLength);
            }
            catch
            {
                return "";
            }
        }

        private async Task<bool> IsServerReadyAsync()
        {
            return await Task.Run(() =>
            {
                try
                {
                    if (string.IsNullOrWhiteSpace(baseUrl)) return false;
                    var request = (HttpWebRequest)WebRequest.Create(baseUrl + "/api/health");
                    request.Headers["X-Clownfish-Client"] = clientToken;
                    request.Timeout = 900;
                    request.ReadWriteTimeout = 900;
                    using (var response = (HttpWebResponse)request.GetResponse())
                    using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                    {
                        var json = reader.ReadToEnd();
                        return response.StatusCode == HttpStatusCode.OK
                            && ReadJsonValue(json, "appId") == "clownfish"
                            && ReadJsonValue(json, "version") == appVersion
                            && ReadJsonValue(json, "clientSession") == clientSession
                            && serverProcess != null
                            && ReadJsonNumber(json, "pid") == serverProcess.Id.ToString();
                    }
                }
                catch
                {
                    return false;
                }
            });
        }

        private void StopServerIfOwned()
        {
            if (!spawnedServer || serverProcess == null) return;
            try
            {
                if (!serverProcess.HasExited && !string.IsNullOrWhiteSpace(baseUrl))
                {
                    var request = (HttpWebRequest)WebRequest.Create(baseUrl + "/api/shutdown");
                    request.Method = "POST";
                    request.ContentLength = 0;
                    request.Headers["X-Clownfish-Client"] = clientToken;
                    request.Timeout = 1800;
                    request.ReadWriteTimeout = 1800;
                    using (var response = (HttpWebResponse)request.GetResponse()) { }
                }
                if (!serverProcess.HasExited) serverProcess.WaitForExit(6500);
            }
            catch { }
            finally
            {
                if (!serverProcess.HasExited) serverJob.Terminate(1);
                try { serverProcess.WaitForExit(2000); } catch { }
                DeletePidIfOwned(serverProcess.Id);
            }
        }
    }

    internal sealed class ChildProcessJob : IDisposable
    {
        private const uint JobObjectLimitKillOnJobClose = 0x00002000;
        private IntPtr handle;

        public ChildProcessJob()
        {
            handle = CreateJobObject(IntPtr.Zero, null);
            if (handle == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "无法创建本机服务进程组。");

            var limits = new JobObjectExtendedLimitInformation();
            limits.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
            var length = Marshal.SizeOf(typeof(JobObjectExtendedLimitInformation));
            var pointer = Marshal.AllocHGlobal(length);
            try
            {
                Marshal.StructureToPtr(limits, pointer, false);
                if (!SetInformationJobObject(handle, 9, pointer, (uint)length))
                {
                    throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "无法配置本机服务进程组。");
                }
            }
            catch
            {
                CloseHandle(handle);
                handle = IntPtr.Zero;
                throw;
            }
            finally
            {
                Marshal.FreeHGlobal(pointer);
            }
        }

        public void AddProcess(Process process)
        {
            if (handle == IntPtr.Zero) throw new ObjectDisposedException("ChildProcessJob");
            if (!AssignProcessToJobObject(handle, process.Handle))
            {
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "无法接管本机服务进程树。");
            }
        }

        public void Terminate(uint exitCode)
        {
            if (handle != IntPtr.Zero) TerminateJobObject(handle, exitCode);
        }

        public void Dispose()
        {
            if (handle == IntPtr.Zero) return;
            CloseHandle(handle);
            handle = IntPtr.Zero;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IoCounters
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct BasicLimitInformation
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JobObjectExtendedLimitInformation
        {
            public BasicLimitInformation BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr securityAttributes, string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetInformationJobObject(IntPtr job, int informationClass, IntPtr information, uint length);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr handle);
    }

    internal sealed class CloseBehaviorDialog : Form
    {
        private readonly CheckBox rememberBox;

        public string SelectedBehavior { get; private set; }
        public bool RememberChoice { get { return rememberBox.Checked; } }

        public CloseBehaviorDialog()
        {
            Text = "关闭小丑鱼";
            StartPosition = FormStartPosition.CenterParent;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MinimizeBox = false;
            MaximizeBox = false;
            ShowInTaskbar = false;
            ClientSize = new Size(440, 190);
            SelectedBehavior = "minimize";

            var title = new Label
            {
                Text = "关闭窗口时要怎么处理？",
                AutoSize = false,
                Location = new Point(20, 18),
                Size = new Size(400, 24),
                Font = new Font(SystemFonts.MessageBoxFont, FontStyle.Bold)
            };
            Controls.Add(title);

            var desc = new Label
            {
                Text = "选择“最小化到托盘”后，小丑鱼的定时任务和提醒会继续在后台运行；选择“直接退出”会关闭本机服务。",
                AutoSize = false,
                Location = new Point(20, 48),
                Size = new Size(400, 48)
            };
            Controls.Add(desc);

            rememberBox = new CheckBox
            {
                Text = "以后不再询问",
                AutoSize = true,
                Location = new Point(20, 105)
            };
            Controls.Add(rememberBox);

            var minimizeButton = new Button
            {
                Text = "最小化到托盘",
                DialogResult = DialogResult.OK,
                Location = new Point(142, 142),
                Size = new Size(120, 30)
            };
            minimizeButton.Click += (sender, args) => SelectedBehavior = "minimize";
            Controls.Add(minimizeButton);

            var exitButton = new Button
            {
                Text = "直接退出",
                DialogResult = DialogResult.OK,
                Location = new Point(276, 142),
                Size = new Size(96, 30)
            };
            exitButton.Click += (sender, args) => SelectedBehavior = "exit";
            Controls.Add(exitButton);

            var cancelButton = new Button
            {
                Text = "取消",
                DialogResult = DialogResult.Cancel,
                Location = new Point(20, 142),
                Size = new Size(86, 30)
            };
            Controls.Add(cancelButton);

            AcceptButton = minimizeButton;
            CancelButton = cancelButton;
        }
    }

    internal sealed class ScreenshotSelectionForm : Form
    {
        private readonly Bitmap screenshot;
        private readonly Rectangle virtualBounds;
        private bool dragging;
        private Point startPoint;
        private Point currentPoint;

        public Rectangle Selection { get; private set; }

        public ScreenshotSelectionForm(Bitmap screenshot, Rectangle virtualBounds)
        {
            this.screenshot = screenshot;
            this.virtualBounds = virtualBounds;
            StartPosition = FormStartPosition.Manual;
            Bounds = virtualBounds;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            KeyPreview = true;
            Cursor = Cursors.Cross;
            DoubleBuffered = true;
            BackColor = Color.Black;
            Selection = Rectangle.Empty;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            e.Graphics.DrawImage(screenshot, new Rectangle(0, 0, Width, Height));
            using (var shade = new SolidBrush(Color.FromArgb(96, 0, 0, 0)))
            {
                e.Graphics.FillRectangle(shade, ClientRectangle);
            }

            var rect = CurrentRectangle();
            if (rect.Width <= 0 || rect.Height <= 0) return;

            e.Graphics.DrawImage(screenshot, rect, rect, GraphicsUnit.Pixel);
            using (var pen = new Pen(Color.FromArgb(7, 193, 96), 2))
            {
                e.Graphics.DrawRectangle(pen, rect);
            }
            using (var brush = new SolidBrush(Color.FromArgb(210, 0, 0, 0)))
            using (var textBrush = new SolidBrush(Color.White))
            {
                var label = rect.Width + " 脳 " + rect.Height;
                var labelRect = new Rectangle(rect.Left, Math.Max(0, rect.Top - 26), Math.Max(82, label.Length * 8 + 14), 22);
                e.Graphics.FillRectangle(brush, labelRect);
                e.Graphics.DrawString(label, Font, textBrush, labelRect.Left + 7, labelRect.Top + 3);
            }
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button != MouseButtons.Left) return;
            dragging = true;
            startPoint = e.Location;
            currentPoint = e.Location;
            Capture = true;
            Invalidate();
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            if (!dragging) return;
            currentPoint = e.Location;
            Invalidate();
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (!dragging) return;
            dragging = false;
            Capture = false;
            currentPoint = e.Location;
            Selection = CurrentRectangle();
            DialogResult = Selection.Width >= 4 && Selection.Height >= 4 ? DialogResult.OK : DialogResult.Cancel;
            Close();
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            base.OnKeyDown(e);
            if (e.KeyCode != Keys.Escape) return;
            DialogResult = DialogResult.Cancel;
            Close();
        }

        private Rectangle CurrentRectangle()
        {
            var left = Math.Max(0, Math.Min(startPoint.X, currentPoint.X));
            var top = Math.Max(0, Math.Min(startPoint.Y, currentPoint.Y));
            var right = Math.Min(Width, Math.Max(startPoint.X, currentPoint.X));
            var bottom = Math.Min(Height, Math.Max(startPoint.Y, currentPoint.Y));
            return Rectangle.FromLTRB(left, top, right, bottom);
        }
    }

    internal sealed class DesktopToolForm : Form
    {
        internal const string DesktopToolOrigin = "https://desktop-helper.clownfish.invalid";
        private readonly WebView2 webView;
        private readonly DesktopToolBridge bridge;
        private readonly string toolRoot;

        public DesktopToolForm()
        {
            Text = "\u684c\u9762\u5c0f\u5de5\u5177";
            StartPosition = FormStartPosition.Manual;
            Size = new Size(440, 760);
            MinimumSize = new Size(380, 560);
            TopMost = true;
            ShowInTaskbar = true;
            BackColor = Color.FromArgb(245, 241, 255);

            var workingArea = Screen.PrimaryScreen.WorkingArea;
            Location = new Point(Math.Max(0, workingArea.Right - Width - 28), Math.Max(0, workingArea.Top + 48));

            toolRoot = ResolveDesktopToolRoot();
            webView = new WebView2 { Dock = DockStyle.Fill };
            bridge = new DesktopToolBridge(this, IsTrustedCurrentDocument);
            Controls.Add(webView);

            Shown += async (sender, args) => await InitAsync();
        }

        private async Task InitAsync()
        {
            var pagePath = Path.Combine(toolRoot, "index.html");
            if (!File.Exists(pagePath))
            {
                MessageBox.Show(this, "\u627e\u4e0d\u5230\u684c\u9762\u5c0f\u5de5\u5177\u9875\u9762\u6587\u4ef6\u3002", Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
                return;
            }

            var profileDir = Path.Combine(DesktopToolBridge.DataDir, "webview-profile");
            var env = await CoreWebView2Environment.CreateAsync(null, profileDir);
            await webView.EnsureCoreWebView2Async(env);
            webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = ClientBuildConfiguration.DevelopmentFeatures;
            webView.CoreWebView2.Settings.AreDevToolsEnabled = ClientBuildConfiguration.DevelopmentFeatures;
            webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "desktop-helper.clownfish.invalid",
                toolRoot,
                CoreWebView2HostResourceAccessKind.Deny);
            webView.CoreWebView2.NavigationStarting += (sender, args) =>
            {
                if (!IsTrustedDesktopToolUri(args.Uri)) args.Cancel = true;
            };
            webView.CoreWebView2.FrameNavigationStarting += (sender, args) =>
            {
                if (!IsTrustedDesktopToolUri(args.Uri)) args.Cancel = true;
            };
            webView.CoreWebView2.NewWindowRequested += (sender, args) =>
            {
                args.Handled = true;
            };
            webView.CoreWebView2.AddHostObjectToScript("desktopHelperHost", bridge);
            await webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(DesktopToolPreloadScript());
            webView.CoreWebView2.Navigate(DesktopToolOrigin + "/index.html");
        }

        internal static bool IsTrustedDesktopToolUri(string value)
        {
            Uri uri;
            return Uri.TryCreate(value, UriKind.Absolute, out uri)
                && string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
                && string.Equals(uri.Host, "desktop-helper.clownfish.invalid", StringComparison.Ordinal)
                && uri.Port == 443
                && string.IsNullOrEmpty(uri.UserInfo);
        }

        private bool IsTrustedCurrentDocument()
        {
            return webView.CoreWebView2 != null && IsTrustedDesktopToolUri(webView.CoreWebView2.Source);
        }

        private static string ResolveDesktopToolRoot()
        {
            var bundled = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "desktop-helper", "renderer");
            if (File.Exists(Path.Combine(bundled, "index.html"))) return bundled;

            var source = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "desktop-helper", "renderer"));
            if (File.Exists(Path.Combine(source, "index.html"))) return source;

            return bundled;
        }

        private static string DesktopToolPreloadScript()
        {
            return @"
(function () {
  if (window.location.origin !== 'https://desktop-helper.clownfish.invalid') return;
  const host = chrome.webview.hostObjects.desktopHelperHost;
  function parseJson(value, fallback) {
    try { return JSON.parse(value || ''); } catch { return fallback; }
  }
  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.slice(i, i + chunk));
    }
    return btoa(binary);
  }
  window.desktopHelper = {
    readClipboard: async () => host.ReadClipboard(),
    writeClipboard: async (text) => host.WriteClipboard(String(text ?? '')),
    minimize: async () => host.Minimize(),
    close: async () => host.CloseTool(),
    toggleAlwaysOnTop: async () => host.ToggleAlwaysOnTop(),
    loadData: async () => parseJson(await host.LoadData(), { currentNoteId: '', notes: [], clips: [] }),
    saveData: async (state) => host.SaveData(JSON.stringify(state || {})),
    loadSettings: async () => parseJson(await host.LoadSettings(), {}),
    saveSettings: async (settings) => parseJson(await host.SaveSettings(JSON.stringify(settings || {})), {}),
    openDataDir: async () => host.OpenDataDir(),
    transcribe: async (payload) => host.TranscribeBytes(bytesToBase64(payload && payload.bytes ? payload.bytes : [])),
    polish: async (text) => host.Polish(String(text || ''))
  };
})();";
        }
    }

    [ComVisible(true)]
    [ClassInterface(ClassInterfaceType.AutoDual)]
    public sealed class DesktopToolBridge
    {
        private const string DefaultAliyunBaseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1";
        private const string DefaultAliyunFunasrModel = "fun-asr-realtime";
        private const string DefaultAliyunFunasrWebSocketUrl = "wss://dashscope.aliyuncs.com/api-ws/v1/inference";
        private const string DefaultPolishModel = "qwen-plus";
        private readonly Form owner;
        private readonly Func<bool> isTrustedOrigin;

        // New installs share the companion data root. Existing DesktopHelperData users
        // keep using that directory unchanged; this is compatibility discovery, not migration.
        public static readonly string DataDir = ResolveDataDir();
        private static readonly string DataFile = Path.Combine(DataDir, "data.json");
        private static readonly string SettingsFile = Path.Combine(DataDir, "settings.json");
        private static readonly string RecordingsDir = Path.Combine(DataDir, "recordings");
        private static readonly string ScriptsDir = Path.Combine(DataDir, "scripts");
        private static readonly string AliyunFunasrScript = Path.Combine(ScriptsDir, "aliyun_funasr_realtime.py");
        private static readonly string DefaultAliyunFunasrPython = Path.Combine(DataDir, "funasr-env", "Scripts", "python.exe");

        public DesktopToolBridge(Form owner, Func<bool> isTrustedOrigin)
        {
            this.owner = owner;
            if (isTrustedOrigin == null) throw new ArgumentNullException("isTrustedOrigin");
            this.isTrustedOrigin = isTrustedOrigin;
            EnsureDataDir();
        }

        private void EnsureTrustedOrigin()
        {
            if (!isTrustedOrigin()) throw new UnauthorizedAccessException("DESKTOP_HELPER_ORIGIN_DENIED");
        }

        private static string ResolveDataDir()
        {
            var root = Environment.GetEnvironmentVariable("CLOWNFISH_HOME");
            if (string.IsNullOrWhiteSpace(root)) root = Environment.GetEnvironmentVariable(new string(new[] { (char)78, (char)69, (char)77, (char)79, (char)83, (char)95, (char)67, (char)79, (char)80, (char)65, (char)78, (char)73, (char)79, (char)78, (char)95, (char)72, (char)79, (char)77, (char)69 }));
            if (string.IsNullOrWhiteSpace(root))
            {
                var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                var preferred = Path.Combine(profile, ".clownfish");
                var legacyRoot = Path.Combine(profile, new string(new[] { (char)46, (char)110, (char)101, (char)109, (char)111, (char)115, (char)45, (char)99, (char)111, (char)109, (char)112, (char)97, (char)110, (char)105, (char)111, (char)110 }));
                root = Directory.Exists(preferred) || !Directory.Exists(legacyRoot) ? preferred : legacyRoot;
            }

            var primary = Path.Combine(root, "desktop-helper");
            var legacy = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "DesktopHelperData");
            return Directory.Exists(primary) || !Directory.Exists(legacy) ? primary : legacy;
        }

        public string ReadClipboard()
        {
            EnsureTrustedOrigin();
            return Clipboard.ContainsText() ? Clipboard.GetText() : "";
        }

        public bool WriteClipboard(string text)
        {
            EnsureTrustedOrigin();
            Clipboard.SetText(text ?? "");
            return true;
        }

        public bool Minimize()
        {
            EnsureTrustedOrigin();
            owner.WindowState = FormWindowState.Minimized;
            return true;
        }

        public bool CloseTool()
        {
            EnsureTrustedOrigin();
            owner.Close();
            return true;
        }

        public bool ToggleAlwaysOnTop()
        {
            EnsureTrustedOrigin();
            owner.TopMost = !owner.TopMost;
            return owner.TopMost;
        }

        public string LoadData()
        {
            EnsureTrustedOrigin();
            EnsureDataDir();
            if (!File.Exists(DataFile))
            {
                var fallback = "{\"currentNoteId\":\"\",\"notes\":[],\"clips\":[]}";
                File.WriteAllText(DataFile, fallback, Encoding.UTF8);
                return fallback;
            }
            return File.ReadAllText(DataFile, Encoding.UTF8);
        }

        public bool SaveData(string json)
        {
            EnsureTrustedOrigin();
            EnsureDataDir();
            File.WriteAllText(DataFile, string.IsNullOrWhiteSpace(json) ? "{}" : json, Encoding.UTF8);
            return true;
        }

        public string LoadSettings()
        {
            EnsureTrustedOrigin();
            var settings = ReadSettings();
            var apiKey = ReadApiKey(settings);
            var python = ReadJsonString(settings, "aliyunFunasrPython", DefaultAliyunFunasrPython);
            return "{"
                + "\"dataDir\":\"" + JsonEscape(DataDir) + "\","
                + "\"speechMode\":\"aliyun-funasr\","
                + "\"hasAliyunApiKey\":" + (string.IsNullOrWhiteSpace(apiKey) ? "false" : "true") + ","
                + "\"aliyunBaseUrl\":\"" + JsonEscape(ReadJsonString(settings, "aliyunBaseUrl", DefaultAliyunBaseUrl)) + "\","
                + "\"aliyunFunasrPython\":\"" + JsonEscape(python) + "\","
                + "\"aliyunFunasrModel\":\"" + JsonEscape(ReadJsonString(settings, "aliyunFunasrModel", DefaultAliyunFunasrModel)) + "\","
                + "\"aliyunFunasrWebSocketUrl\":\"" + JsonEscape(ReadJsonString(settings, "aliyunFunasrWebSocketUrl", DefaultAliyunFunasrWebSocketUrl)) + "\","
                + "\"aliyunFunasrReady\":" + ((!string.IsNullOrWhiteSpace(apiKey) && File.Exists(python)) ? "true" : "false") + ","
                + "\"polishModel\":\"" + JsonEscape(ReadJsonString(settings, "polishModel", DefaultPolishModel)) + "\""
                + "}";
        }

        public string SaveSettings(string json)
        {
            EnsureTrustedOrigin();
            var current = ReadSettings();
            var apiKey = ReadJsonString(json, "aliyunApiKey", "");
            var nextApiKey = string.IsNullOrWhiteSpace(apiKey) ? ReadApiKey(current) : apiKey.Trim();
            var output = "{"
                + "\"encryptedAliyunApiKey\":\"" + JsonEscape(Protect(nextApiKey)) + "\","
                + "\"aliyunBaseUrl\":\"" + JsonEscape(ReadJsonString(json, "aliyunBaseUrl", ReadJsonString(current, "aliyunBaseUrl", DefaultAliyunBaseUrl))) + "\","
                + "\"aliyunFunasrPython\":\"" + JsonEscape(ReadJsonString(json, "aliyunFunasrPython", ReadJsonString(current, "aliyunFunasrPython", DefaultAliyunFunasrPython))) + "\","
                + "\"aliyunFunasrModel\":\"" + JsonEscape(ReadJsonString(json, "aliyunFunasrModel", ReadJsonString(current, "aliyunFunasrModel", DefaultAliyunFunasrModel))) + "\","
                + "\"aliyunFunasrWebSocketUrl\":\"" + JsonEscape(ReadJsonString(json, "aliyunFunasrWebSocketUrl", ReadJsonString(current, "aliyunFunasrWebSocketUrl", DefaultAliyunFunasrWebSocketUrl))) + "\","
                + "\"polishModel\":\"" + JsonEscape(ReadJsonString(json, "polishModel", ReadJsonString(current, "polishModel", DefaultPolishModel))) + "\""
                + "}";
            EnsureDataDir();
            File.WriteAllText(SettingsFile, output, Encoding.UTF8);
            return LoadSettings();
        }

        public string OpenDataDir()
        {
            EnsureTrustedOrigin();
            EnsureDataDir();
            Process.Start(new ProcessStartInfo(DataDir) { UseShellExecute = true });
            return DataDir;
        }

        public string TranscribeBytes(string base64Wav)
        {
            EnsureTrustedOrigin();
            var settings = ReadSettings();
            var apiKey = ReadApiKey(settings);
            if (string.IsNullOrWhiteSpace(apiKey)) throw new InvalidOperationException("ALIYUN_API_KEY_MISSING");
            var python = ReadJsonString(settings, "aliyunFunasrPython", DefaultAliyunFunasrPython);
            if (!File.Exists(python)) throw new FileNotFoundException("ALIYUN_FUNASR_PYTHON_MISSING");

            EnsureDataDir();
            var bytes = Convert.FromBase64String(base64Wav ?? "");
            var wavPath = Path.Combine(RecordingsDir, "aliyun-funasr-" + DateTime.Now.ToString("yyyyMMddHHmmssfff") + ".wav");
            File.WriteAllBytes(wavPath, bytes);
            var output = RunCommand(
                python,
                "\"" + AliyunFunasrScript + "\" --file \"" + wavPath + "\" --model \"" + ReadJsonString(settings, "aliyunFunasrModel", DefaultAliyunFunasrModel) + "\" --websocket-url \"" + ReadJsonString(settings, "aliyunFunasrWebSocketUrl", DefaultAliyunFunasrWebSocketUrl) + "\"",
                DataDir,
                120000,
                apiKey);
            return CleanAliyunOutput(output);
        }

        public string Polish(string text)
        {
            EnsureTrustedOrigin();
            var settings = ReadSettings();
            var apiKey = ReadApiKey(settings);
            if (string.IsNullOrWhiteSpace(apiKey)) throw new InvalidOperationException("ALIYUN_API_KEY_MISSING");
            var url = NormalizeBaseUrl(ReadJsonString(settings, "aliyunBaseUrl", DefaultAliyunBaseUrl)) + "/chat/completions";
            var body = "{"
                + "\"model\":\"" + JsonEscape(ReadJsonString(settings, "polishModel", DefaultPolishModel)) + "\","
                + "\"messages\":["
                + "{\"role\":\"system\",\"content\":\"Only lightly polish Chinese text: fix typos, punctuation, and sentence breaks. Do not expand or change the meaning.\"},"
                + "{\"role\":\"user\",\"content\":\"" + JsonEscape(text ?? "") + "\"}"
                + "],\"temperature\":0.2}";
            var response = PostJson(url, body, apiKey, 45000);
            return ReadNestedContent(response);
        }

        private static void EnsureDataDir()
        {
            Directory.CreateDirectory(DataDir);
            Directory.CreateDirectory(RecordingsDir);
            Directory.CreateDirectory(ScriptsDir);
            if (!File.Exists(AliyunFunasrScript))
            {
                File.WriteAllText(AliyunFunasrScript, AliyunFunasrScriptContent(), Encoding.UTF8);
            }
        }

        private static string ReadSettings()
        {
            EnsureDataDir();
            return File.Exists(SettingsFile) ? File.ReadAllText(SettingsFile, Encoding.UTF8) : "{}";
        }

        private static string ReadApiKey(string settings)
        {
            var encrypted = ReadJsonString(settings, "encryptedAliyunApiKey", "");
            if (!string.IsNullOrWhiteSpace(encrypted))
            {
                try { return Unprotect(encrypted); } catch { }
            }
            return ReadJsonString(settings, "aliyunApiKey", "");
        }

        private static string Protect(string value)
        {
            if (string.IsNullOrEmpty(value)) return "";
            var bytes = ProtectedData.Protect(Encoding.UTF8.GetBytes(value), null, DataProtectionScope.CurrentUser);
            return Convert.ToBase64String(bytes);
        }

        private static string Unprotect(string value)
        {
            var bytes = ProtectedData.Unprotect(Convert.FromBase64String(value), null, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(bytes);
        }

        private static string ReadJsonString(string json, string key, string fallback)
        {
            if (string.IsNullOrEmpty(json)) return fallback;
            var match = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"((?:\\\\.|[^\"])*)\"");
            return match.Success ? Regex.Unescape(match.Groups[1].Value) : fallback;
        }

        private static string JsonEscape(string value)
        {
            if (value == null) return "";
            return value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n").Replace("\t", "\\t");
        }

        private static string RunCommand(string command, string arguments, string cwd, int timeoutMs, string apiKey)
        {
            var info = new ProcessStartInfo
            {
                FileName = command,
                Arguments = arguments,
                WorkingDirectory = cwd,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };
            info.EnvironmentVariables["DASHSCOPE_API_KEY"] = apiKey;
            info.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
            var commandDir = Path.GetDirectoryName(command);
            if (!string.IsNullOrEmpty(commandDir))
            {
                info.EnvironmentVariables["PATH"] = commandDir + ";" + info.EnvironmentVariables["PATH"];
            }

            using (var process = Process.Start(info))
            {
                var output = process.StandardOutput.ReadToEnd();
                var error = process.StandardError.ReadToEnd();
                if (!process.WaitForExit(timeoutMs))
                {
                    try { process.Kill(); } catch { }
                    throw new TimeoutException("LOCAL_TRANSCRIBE_TIMEOUT");
                }
                if (process.ExitCode != 0) throw new InvalidOperationException("LOCAL_TRANSCRIBE_FAILED: " + (error.Length > 0 ? error : output));
                return output.Length > 0 ? output : error;
            }
        }

        private static string CleanAliyunOutput(string value)
        {
            var lines = (value ?? "").Split(new[] { "\r\n", "\n" }, StringSplitOptions.RemoveEmptyEntries);
            for (var i = lines.Length - 1; i >= 0; i--)
            {
                var text = ReadJsonString(lines[i], "text", "");
                if (!string.IsNullOrWhiteSpace(text)) return text.Trim();
                var error = ReadJsonString(lines[i], "error", "");
                if (!string.IsNullOrWhiteSpace(error)) throw new InvalidOperationException(error);
            }
            return (value ?? "").Trim();
        }

        private static string PostJson(string url, string body, string apiKey, int timeoutMs)
        {
            var request = (HttpWebRequest)WebRequest.Create(url);
            request.Method = "POST";
            request.Timeout = timeoutMs;
            request.ReadWriteTimeout = timeoutMs;
            request.ContentType = "application/json";
            request.Headers["Authorization"] = "Bearer " + apiKey;
            var bytes = Encoding.UTF8.GetBytes(body);
            request.ContentLength = bytes.Length;
            using (var stream = request.GetRequestStream()) stream.Write(bytes, 0, bytes.Length);
            using (var response = (HttpWebResponse)request.GetResponse())
            using (var stream = response.GetResponseStream())
            using (var reader = new StreamReader(stream, Encoding.UTF8))
            {
                return reader.ReadToEnd();
            }
        }

        private static string ReadNestedContent(string json)
        {
            var match = Regex.Match(json ?? "", "\"content\"\\s*:\\s*\"((?:\\\\.|[^\"])*)\"");
            return match.Success ? Regex.Unescape(match.Groups[1].Value).Trim() : "";
        }

        private static string NormalizeBaseUrl(string value)
        {
            return (value ?? "").Trim().TrimEnd('/');
        }

        private static string AliyunFunasrScriptContent()
        {
            return @"import argparse
import json
import os
import sys
from http import HTTPStatus

import dashscope
from dashscope.audio.asr import Recognition

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--file', required=True)
    parser.add_argument('--model', default='fun-asr-realtime')
    parser.add_argument('--websocket-url', default='wss://dashscope.aliyuncs.com/api-ws/v1/inference')
    args = parser.parse_args()
    api_key = os.environ.get('DASHSCOPE_API_KEY', '').strip()
    if not api_key:
        print(json.dumps({'error': 'DASHSCOPE_API_KEY_MISSING'}), file=sys.stderr)
        return 2
    dashscope.api_key = api_key
    dashscope.base_websocket_api_url = args.websocket_url
    recognition = Recognition(model=args.model, format='wav', sample_rate=16000, semantic_punctuation_enabled=False, callback=None)
    result = recognition.call(args.file)
    if result.status_code != HTTPStatus.OK:
        print(json.dumps({'error': getattr(result, 'message', 'ALIYUN_FUNASR_FAILED')}, ensure_ascii=False), file=sys.stderr)
        return 3
    sentence = result.get_sentence()
    if isinstance(sentence, list):
        text = '\n'.join([item.get('text', '') for item in sentence if isinstance(item, dict) and item.get('text')])
    elif isinstance(sentence, dict):
        text = sentence.get('text', '')
    elif sentence is None:
        text = ''
    else:
        text = str(sentence)
    print(json.dumps({'text': text}, ensure_ascii=False))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
";
        }
    }
}
