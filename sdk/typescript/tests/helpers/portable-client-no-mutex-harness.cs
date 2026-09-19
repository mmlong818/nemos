using System;
using System.Windows.Forms;

namespace ClownfishClient
{
    internal static class PortableClientNoMutexHarness
    {
        [STAThread]
        public static int Main(string[] args)
        {
            if (args.Length != 1 || string.IsNullOrWhiteSpace(args[0])) return 2;
            Environment.SetEnvironmentVariable("CLOWNFISH_HOME", args[0]);
            Environment.SetEnvironmentVariable("PORT", "0");
            Environment.SetEnvironmentVariable("ZHIPU_API_KEY", "");
            Environment.SetEnvironmentVariable("CLOWNFISH_CLIENT_TOKEN", "");
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
            return 0;
        }
    }
}
