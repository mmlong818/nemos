using Microsoft.Web.WebView2.WinForms;
using System;
using System.Linq;
using System.Windows.Forms;

namespace ClownfishClient
{
    internal static class PortableDesktopToolHarness
    {
        [STAThread]
        private static int Main()
        {
            Application.EnableVisualStyles();
            var form = new DesktopToolForm();
            form.ShowInTaskbar = false;
            form.StartPosition = FormStartPosition.Manual;
            form.Location = new System.Drawing.Point(-32000, -32000);
            var deadline = DateTime.UtcNow.AddSeconds(30);
            var phase = 0;
            var busy = false;
            var success = false;
            var detail = "";
            var timer = new Timer { Interval = 150 };
            timer.Tick += async (sender, args) =>
            {
                if (busy) return;
                busy = true;
                try
                {
                    var view = form.Controls.OfType<WebView2>().FirstOrDefault();
                    if (view == null || view.CoreWebView2 == null) return;
                    if (DateTime.UtcNow >= deadline)
                    {
                        detail = "timeout source=" + view.CoreWebView2.Source;
                        form.Close();
                        return;
                    }
                    if (phase == 0 && DesktopToolForm.IsTrustedDesktopToolUri(view.CoreWebView2.Source))
                    {
                        var probe = await view.CoreWebView2.ExecuteScriptAsync("window.location.origin + '|' + typeof window.desktopHelper");
                        if (probe.IndexOf("https://desktop-helper.clownfish.invalid|object", StringComparison.Ordinal) < 0) return;
                        await view.CoreWebView2.ExecuteScriptAsync("void (async () => { await window.desktopHelper.loadData(); document.title = 'bridge-ok'; })()");
                        phase = 1;
                        return;
                    }
                    if (phase == 1)
                    {
                        var title = await view.CoreWebView2.ExecuteScriptAsync("document.title");
                        if (title.IndexOf("bridge-ok", StringComparison.Ordinal) < 0) return;
                        view.CoreWebView2.Navigate("file:///C:/Windows/win.ini");
                        phase = 2;
                        return;
                    }
                    if (phase == 2 && DesktopToolForm.IsTrustedDesktopToolUri(view.CoreWebView2.Source))
                    {
                        success = true;
                        detail = "trusted virtual origin loaded, bridge called, file navigation blocked";
                        form.Close();
                    }
                }
                catch (Exception ex)
                {
                    detail = ex.GetType().Name + ": " + ex.Message;
                    form.Close();
                }
                finally
                {
                    busy = false;
                }
            };
            form.Shown += (sender, args) => timer.Start();
            Application.Run(form);
            timer.Dispose();
            form.Dispose();
            Console.WriteLine("{\"success\":" + (success ? "true" : "false") + ",\"detail\":\"" + detail.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"}");
            return success ? 0 : 20;
        }
    }
}
