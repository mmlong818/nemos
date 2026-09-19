using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System;
using System.IO;
using System.Windows.Forms;

namespace ClownfishClient
{
    internal sealed class PortableWebViewSecurityHarness : Form
    {
        private readonly WebView2 webView = new WebView2 { Dock = DockStyle.Fill };
        private readonly WebView2 hostileMessageProbe = new WebView2 { Width = 2, Height = 2 };
        private readonly int trustedPort;
        private readonly string trustedBaseUrl;
        private readonly string hostileBaseUrl;
        private readonly string token;
        private readonly string profileDirectory;
        private readonly Timer timeout = new Timer { Interval = 100 };
        private DateTime deadline;
        private int trustedMessages;
        private int rejectedMessages;
        private int externalNavigationsBlocked;
        private int untrustedFramesObserved;
        private string failure = "";

        private PortableWebViewSecurityHarness(string trustedBaseUrl, string hostileBaseUrl, string token, string profileDirectory)
        {
            this.trustedBaseUrl = trustedBaseUrl;
            this.hostileBaseUrl = hostileBaseUrl;
            this.token = token;
            this.profileDirectory = profileDirectory;
            trustedPort = new Uri(trustedBaseUrl).Port;
            Controls.Add(webView);
            Controls.Add(hostileMessageProbe);
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            Location = new System.Drawing.Point(-32000, -32000);
            Size = new System.Drawing.Size(320, 240);
            Shown += async (sender, args) => await InitializeAsync();
            timeout.Tick += (sender, args) =>
            {
                if ((trustedMessages >= 1 && rejectedMessages >= 1 && externalNavigationsBlocked >= 1)
                    || DateTime.UtcNow >= deadline) Close();
            };
        }

        private async System.Threading.Tasks.Task InitializeAsync()
        {
            try
            {
                var environment = await CoreWebView2Environment.CreateAsync(null, profileDirectory);
                await webView.EnsureCoreWebView2Async(environment);
                webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
                webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                webView.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
                webView.CoreWebView2.WebResourceRequested += (sender, args) =>
                {
                    if (MainForm.IsTrustedSidecarUri(args.Request.Uri, trustedPort))
                        args.Request.Headers.SetHeader("X-Clownfish-Client", token);
                    else
                        args.Request.Headers.RemoveHeader("X-Clownfish-Client");
                };
                webView.CoreWebView2.NavigationStarting += (sender, args) =>
                {
                    if (MainForm.IsTrustedSidecarUri(args.Uri, trustedPort)) return;
                    args.Cancel = true;
                    externalNavigationsBlocked++;
                };
                webView.CoreWebView2.FrameNavigationStarting += (sender, args) =>
                {
                    if (MainForm.IsTrustedSidecarUri(args.Uri, trustedPort)) return;
                    // Production cancels here. The harness deliberately observes the
                    // hostile frame so the message-source guard is tested as a second layer.
                    untrustedFramesObserved++;
                };
                webView.CoreWebView2.WebMessageReceived += (sender, args) =>
                {
                    if (MainForm.IsTrustedSidecarUri(args.Source, trustedPort)) trustedMessages++;
                    else rejectedMessages++;
                };
                await hostileMessageProbe.EnsureCoreWebView2Async(environment);
                hostileMessageProbe.CoreWebView2.Settings.AreDevToolsEnabled = false;
                hostileMessageProbe.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
                hostileMessageProbe.CoreWebView2.WebResourceRequested += (sender, args) =>
                {
                    if (MainForm.IsTrustedSidecarUri(args.Request.Uri, trustedPort))
                        args.Request.Headers.SetHeader("X-Clownfish-Client", token);
                    else
                        args.Request.Headers.RemoveHeader("X-Clownfish-Client");
                };
                hostileMessageProbe.CoreWebView2.WebMessageReceived += (sender, args) =>
                {
                    if (MainForm.IsTrustedSidecarUri(args.Source, trustedPort)) trustedMessages++;
                    else rejectedMessages++;
                };
                deadline = DateTime.UtcNow.AddSeconds(20);
                timeout.Start();
                webView.CoreWebView2.Navigate(trustedBaseUrl + "/test");
                // Production would cancel this top-level navigation. This isolated
                // probe loads it only to exercise the message-source guard itself.
                hostileMessageProbe.CoreWebView2.Navigate(hostileBaseUrl + "/message-top");
            }
            catch (Exception ex)
            {
                failure = ex.GetType().Name + ": " + ex.Message;
                Close();
            }
        }

        [STAThread]
        private static int Main(string[] args)
        {
            if (args.Length != 4) return 10;
            Application.EnableVisualStyles();
            var harness = new PortableWebViewSecurityHarness(args[0], args[1], args[2], args[3]);
            Application.Run(harness);
            var output = "{\"trustedMessages\":" + harness.trustedMessages
                + ",\"rejectedMessages\":" + harness.rejectedMessages
                + ",\"externalNavigationsBlocked\":" + harness.externalNavigationsBlocked
                + ",\"untrustedFramesObserved\":" + harness.untrustedFramesObserved
                + ",\"failure\":\"" + Escape(harness.failure) + "\"}";
            var success = string.IsNullOrEmpty(harness.failure)
                && harness.trustedMessages >= 1
                && harness.rejectedMessages >= 1
                && harness.externalNavigationsBlocked >= 1
                && harness.untrustedFramesObserved >= 1;
            harness.Dispose();
            Console.WriteLine(output);
            return success ? 0 : 20;
        }

        private static string Escape(string value)
        {
            return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
        }
    }
}
