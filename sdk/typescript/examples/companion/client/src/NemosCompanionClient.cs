using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System;
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

namespace NemosCompanionClient
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }
    }

    internal sealed class MainForm : Form
    {
        private readonly int port;
        private readonly string baseUrl;
        private readonly string dataDir;
        private readonly string sdkRoot;
        private readonly string bundledNode;
        private readonly string logDir;
        private readonly string appVersion;
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

        public MainForm()
        {
            port = ReadPort();
            baseUrl = "http://127.0.0.1:" + port;
            dataDir = Environment.GetEnvironmentVariable("NEMOS_COMPANION_HOME");
            if (string.IsNullOrWhiteSpace(dataDir))
            {
                dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".nemos-companion");
            }
            sdkRoot = ResolveAppRoot();
            bundledNode = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "node", "node.exe");
            logDir = Path.Combine(dataDir, "logs");
            appVersion = ReadManifestValue("version", "0.1.0");
            closeBehavior = ReadClientPreference("closeBehavior", "ask");
            notificationPermission = ReadClientPreference("notificationPermission", "ask");

            Text = "Nemos Companion";
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

        private static int ReadPort()
        {
            var raw = Environment.GetEnvironmentVariable("PORT");
            int parsed;
            return int.TryParse(raw, out parsed) ? parsed : 8787;
        }

        private MenuStrip BuildMenu()
        {
            var menu = new MenuStrip();
            var appMenu = new ToolStripMenuItem("Nemos");
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
                Path.Combine(baseDir, "Nemos Companion.ico"),
                Path.Combine(baseDir, "assets", "nemos-companion.ico")
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
            trayMenu.Items.Add("打开 Nemos Companion", null, (sender, args) => RestoreFromTray());
            trayMenu.Items.Add("桌面小工具", null, (sender, args) => OpenDesktopTool());
            trayMenu.Items.Add("通知权限", null, (sender, args) => AskNotificationPermission(true));
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add("退出", null, (sender, args) => ExitApplication());

            trayIcon = new NotifyIcon
            {
                Icon = Icon ?? SystemIcons.Application,
                Text = "Nemos Companion",
                ContextMenuStrip = trayMenu,
                Visible = false
            };
            trayIcon.DoubleClick += (sender, args) => RestoreFromTray();
            trayIcon.BalloonTipClicked += (sender, args) => RestoreFromTray();
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
                trayIcon.ShowBalloonTip(3500, "Nemos Companion 已在后台运行", "知微的定时任务和提醒会继续工作。双击托盘图标可以打开窗口。", ToolTipIcon.Info);
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
                "允许 Nemos Companion 在后台发送系统通知吗？\n\n最小化到托盘后，知微的定时任务、提醒和交付完成提示可以通过通知告诉你。",
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
                BackupDataOnStartup();

                if (!await IsServerReadyAsync())
                {
                    StartServer();
                    spawnedServer = true;
                }

                await WaitForServerAsync();
                await InitWebViewAsync();
                webView.CoreWebView2.Navigate(baseUrl);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, "Nemos Companion \u542f\u52a8\u5931\u8d25", MessageBoxButtons.OK, MessageBoxIcon.Error);
                forcedExit = true;
                Close();
            }
        }

        private async Task InitWebViewAsync()
        {
            var profileDir = Path.Combine(dataDir, "webview-profile");
            var env = await CoreWebView2Environment.CreateAsync(null, profileDir);
            await webView.EnsureCoreWebView2Async(env);
            webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            webView.CoreWebView2.Settings.AreDevToolsEnabled = true;
            webView.CoreWebView2.NewWindowRequested += (sender, args) =>
            {
                args.Handled = true;
                Process.Start(new ProcessStartInfo(args.Uri) { UseShellExecute = true });
            };
            webView.CoreWebView2.PermissionRequested += (sender, args) =>
            {
                if (args.PermissionKind == CoreWebView2PermissionKind.Notifications)
                {
                    args.Handled = true;
                    args.State = AskNotificationPermission(false) ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
                }
            };
            webView.CoreWebView2.WebMessageReceived += (sender, args) =>
            {
                var message = args.TryGetWebMessageAsString() ?? "";
                if (message == "open-desktop-tool")
                {
                    OpenDesktopTool();
                    return;
                }
                if (message.IndexOf("capture-screen", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    CaptureScreenForComposer();
                }
            };
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
            if (webView.CoreWebView2 == null) return Task.CompletedTask;
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

        private void StartServer()
        {
            var logPath = Path.Combine(logDir, "client-server.log");
            var errPath = Path.Combine(logDir, "client-server.err.log");
            File.AppendAllText(logPath, Environment.NewLine + "[" + DateTime.Now.ToString("s") + "] starting " + baseUrl + Environment.NewLine);

            var command = ResolveServerCommand();
            var arguments = ResolveServerArguments();
            File.AppendAllText(logPath,
                "command: " + command + Environment.NewLine
                + "arguments: " + arguments + Environment.NewLine
                + "working directory: " + sdkRoot + Environment.NewLine);

            var info = new ProcessStartInfo
            {
                FileName = command,
                Arguments = arguments,
                WorkingDirectory = sdkRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            info.EnvironmentVariables["PORT"] = port.ToString();
            info.EnvironmentVariables["NEMOS_COMPANION_HOME"] = dataDir;
            info.EnvironmentVariables["NEMOS_COMPANION_MANIFEST"] = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "manifest.json");

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

            var sandboxHost = Path.Combine(sandboxRuntime, "NemosSandboxHost.exe");
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

            serverProcess = new Process { StartInfo = info, EnableRaisingEvents = true };
            serverProcess.OutputDataReceived += (sender, args) =>
            {
                if (args.Data != null) File.AppendAllText(logPath, args.Data + Environment.NewLine);
            };
            serverProcess.ErrorDataReceived += (sender, args) =>
            {
                if (args.Data != null) File.AppendAllText(errPath, args.Data + Environment.NewLine);
            };
            serverProcess.Exited += (sender, args) =>
            {
                try
                {
                    File.AppendAllText(logPath, "[" + DateTime.Now.ToString("s") + "] server exited with code " + serverProcess.ExitCode + Environment.NewLine);
                }
                catch
                {
                }
            };
            serverProcess.Start();
            serverProcess.BeginOutputReadLine();
            serverProcess.BeginErrorReadLine();
            File.WriteAllText(Path.Combine(dataDir, "companion-server.pid"), serverProcess.Id.ToString());
        }

        private string ResolveAppRoot()
        {
            var portableRoot = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app");
            if (File.Exists(Path.Combine(portableRoot, "examples", "companion", "server.ts")))
            {
                return portableRoot;
            }
            return Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", ".."));
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
                    + "\"notificationPermission\":\"" + ClientJsonEscape(NormalizeNotificationPermission(notificationPermission)) + "\""
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

        private void BackupDataOnStartup()
        {
            var backupRoot = Path.Combine(dataDir, "backups");
            var backupDir = Path.Combine(backupRoot, DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-v" + appVersion);
            Directory.CreateDirectory(backupDir);

            var copied = 0;
            copied += CopyIfExists(Path.Combine(dataDir, "companion.db"), Path.Combine(backupDir, "companion.db"));
            copied += CopyIfExists(Path.Combine(dataDir, "relationships.json"), Path.Combine(backupDir, "relationships.json"));
            copied += CopyIfExists(Path.Combine(dataDir, "personas.json"), Path.Combine(backupDir, "personas.json"));
            copied += CopyIfExists(Path.Combine(dataDir, "familiarity.json"), Path.Combine(backupDir, "familiarity.json"));
            copied += CopyIfExists(Path.Combine(dataDir, "groups.json"), Path.Combine(backupDir, "groups.json"));

            if (copied == 0)
            {
                Directory.Delete(backupDir, true);
            }
            else
            {
                File.WriteAllText(Path.Combine(backupDir, "README.txt"), "Nemos Companion automatic startup backup before app version " + appVersion + Environment.NewLine);
            }

            File.WriteAllText(Path.Combine(dataDir, "app-version.json"), "{\"version\":\"" + appVersion + "\",\"updatedAt\":\"" + DateTime.UtcNow.ToString("o") + "\"}");
            PruneBackups(backupRoot, 10);
        }

        private static int CopyIfExists(string source, string destination)
        {
            if (File.Exists(source))
            {
                File.Copy(source, destination, true);
                return 1;
            }
            return 0;
        }

        private static void PruneBackups(string backupRoot, int keep)
        {
            if (!Directory.Exists(backupRoot)) return;
            var dirs = new DirectoryInfo(backupRoot).GetDirectories();
            Array.Sort(dirs, (a, b) => string.CompareOrdinal(b.Name, a.Name));
            for (var i = keep; i < dirs.Length; i++)
            {
                try { dirs[i].Delete(true); } catch { }
            }
        }

        private string ResolveServerCommand()
        {
            if (File.Exists(bundledNode))
            {
                return bundledNode;
            }
            return Environment.OSVersion.Platform == PlatformID.Win32NT ? "npm.cmd" : "npm";
        }

        private string ResolveServerArguments()
        {
            if (File.Exists(bundledNode))
            {
                return "\"node_modules\\tsx\\dist\\cli.mjs\" \"examples\\companion\\server.ts\"";
            }
            return "run companion";
        }

        private async Task WaitForServerAsync()
        {
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
                var text = File.ReadAllText(path, Encoding.UTF8).Trim();
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
                    var request = (HttpWebRequest)WebRequest.Create(baseUrl + "/api/state");
                    request.Timeout = 900;
                    request.ReadWriteTimeout = 900;
                    using (var response = (HttpWebResponse)request.GetResponse())
                    {
                        return response.StatusCode == HttpStatusCode.OK;
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
            if (!spawnedServer || serverProcess == null || serverProcess.HasExited) return;
            try
            {
                var taskkill = new ProcessStartInfo
                {
                    FileName = "taskkill",
                    Arguments = "/pid " + serverProcess.Id + " /t /f",
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                Process.Start(taskkill);
                Thread.Sleep(300);
            }
            catch
            {
                try { serverProcess.Kill(); } catch { }
            }
        }
    }

    internal sealed class CloseBehaviorDialog : Form
    {
        private readonly CheckBox rememberBox;

        public string SelectedBehavior { get; private set; }
        public bool RememberChoice { get { return rememberBox.Checked; } }

        public CloseBehaviorDialog()
        {
            Text = "关闭 Nemos Companion";
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
                Text = "选择“最小化到托盘”后，知微的定时任务和提醒会继续在后台运行；选择“直接退出”会关闭本机服务。",
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
            bridge = new DesktopToolBridge(this);
            webView = new WebView2 { Dock = DockStyle.Fill };
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
            webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            webView.CoreWebView2.Settings.AreDevToolsEnabled = true;
            webView.CoreWebView2.AddHostObjectToScript("desktopHelperHost", bridge);
            await webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(DesktopToolPreloadScript());
            webView.CoreWebView2.Navigate(new Uri(pagePath).AbsoluteUri);
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

        public static readonly string DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "DesktopHelperData");
        private static readonly string DataFile = Path.Combine(DataDir, "data.json");
        private static readonly string SettingsFile = Path.Combine(DataDir, "settings.json");
        private static readonly string RecordingsDir = Path.Combine(DataDir, "recordings");
        private static readonly string ScriptsDir = Path.Combine(DataDir, "scripts");
        private static readonly string AliyunFunasrScript = Path.Combine(ScriptsDir, "aliyun_funasr_realtime.py");
        private static readonly string DefaultAliyunFunasrPython = Path.Combine(DataDir, "funasr-env", "Scripts", "python.exe");

        public DesktopToolBridge(Form owner)
        {
            this.owner = owner;
            EnsureDataDir();
        }

        public string ReadClipboard()
        {
            return Clipboard.ContainsText() ? Clipboard.GetText() : "";
        }

        public bool WriteClipboard(string text)
        {
            Clipboard.SetText(text ?? "");
            return true;
        }

        public bool Minimize()
        {
            owner.WindowState = FormWindowState.Minimized;
            return true;
        }

        public bool CloseTool()
        {
            owner.Close();
            return true;
        }

        public bool ToggleAlwaysOnTop()
        {
            owner.TopMost = !owner.TopMost;
            return owner.TopMost;
        }

        public string LoadData()
        {
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
            EnsureDataDir();
            File.WriteAllText(DataFile, string.IsNullOrWhiteSpace(json) ? "{}" : json, Encoding.UTF8);
            return true;
        }

        public string LoadSettings()
        {
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
            EnsureDataDir();
            Process.Start(new ProcessStartInfo(DataDir) { UseShellExecute = true });
            return DataDir;
        }

        public string TranscribeBytes(string base64Wav)
        {
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
