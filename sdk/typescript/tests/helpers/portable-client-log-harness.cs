using System;
using System.Diagnostics;
using System.IO;
using System.Linq;

namespace ClownfishClient
{
    internal static class PortableClientLogHarness
    {
        [STAThread]
        private static int Main(string[] args)
        {
            if (args.Length != 2) return 10;
            bool expectedDevelopment;
            if (!bool.TryParse(args[0], out expectedDevelopment)) return 11;
            if (ClientBuildConfiguration.DevelopmentFeatures != expectedDevelopment) return 12;
            if (!MainForm.IsTrustedSidecarUri("http://127.0.0.1:42123/overview?x=1", 42123)) return 13;
            if (MainForm.IsTrustedSidecarUri("http://127.0.0.1.evil:42123/", 42123)) return 14;
            if (MainForm.IsTrustedSidecarUri("http://localhost:42123/", 42123)) return 15;
            if (MainForm.IsTrustedSidecarUri("https://127.0.0.1:42123/", 42123)) return 16;
            if (MainForm.IsTrustedSidecarUri("http://127.0.0.1:42124/", 42123)) return 17;
            if (MainForm.IsTrustedSidecarUri("http://user@127.0.0.1:42123/", 42123)) return 18;
            if (!MainForm.IsSafeExternalHttpUri("https://example.invalid/path")) return 19;
            if (MainForm.IsSafeExternalHttpUri("javascript:alert(1)") || MainForm.IsSafeExternalHttpUri("file:///secret")) return 25;
            if (!DesktopToolForm.IsTrustedDesktopToolUri(DesktopToolForm.DesktopToolOrigin + "/index.html")) return 26;
            if (DesktopToolForm.IsTrustedDesktopToolUri("file:///index.html")) return 27;
            if (DesktopToolForm.IsTrustedDesktopToolUri("https://desktop-helper.clownfish.invalid.evil/index.html")) return 28;
            if (DesktopToolForm.IsTrustedDesktopToolUri("https://desktop-helper.clownfish.invalid:444/index.html")) return 29;

            using (var owner = new System.Windows.Forms.Form())
            {
                var deniedBridge = new DesktopToolBridge(owner, () => false);
                try
                {
                    deniedBridge.LoadData();
                    return 30;
                }
                catch (UnauthorizedAccessException)
                {
                    // An untrusted document cannot call even a read-only bridge method.
                }
            }

            var outputDirectory = args[1];
            Directory.CreateDirectory(outputDirectory);
            var packageRoot = Path.Combine(outputDirectory, "portable package");
            var packageNode = Path.Combine(packageRoot, "node", "node.exe");
            var packageEntry = Path.Combine(packageRoot, "app", "examples", "companion", "portable-launcher.js");
            Directory.CreateDirectory(Path.GetDirectoryName(packageNode));
            Directory.CreateDirectory(Path.GetDirectoryName(packageEntry));
            File.WriteAllText(packageNode, "fixture");
            File.WriteAllText(packageEntry, "fixture");
            var sourceTrap = Path.Combine(outputDirectory, "sdk", "typescript", "examples", "node_modules", "npm", "bin");
            Directory.CreateDirectory(sourceTrap);
            File.WriteAllText(Path.Combine(sourceTrap, "npm-cli.js"), "throw new Error('must not run')");
            var previousDirectory = Environment.CurrentDirectory;
            try
            {
                Environment.CurrentDirectory = Path.Combine(outputDirectory, "sdk", "typescript", "examples");
                var launch = MainForm.ResolvePackagedServerLaunch(packageRoot);
                if (launch[0] != packageNode || launch[1] != "\"" + packageEntry + "\"" || launch[2] != Path.Combine(packageRoot, "app")) return 31;
            }
            finally { Environment.CurrentDirectory = previousDirectory; }
            Directory.Delete(Path.Combine(outputDirectory, "sdk"), true);
            var launchWithoutSource = MainForm.ResolvePackagedServerLaunch(packageRoot);
            if (launchWithoutSource[0] != packageNode || launchWithoutSource[1].IndexOf("npm", StringComparison.OrdinalIgnoreCase) >= 0) return 32;

            var polluted = new ProcessStartInfo { UseShellExecute = false };
            polluted.EnvironmentVariables["PATH"] = sourceTrap + ";C:\\malicious-npm-shim";
            polluted.EnvironmentVariables["npm_config_prefix"] = sourceTrap;
            polluted.EnvironmentVariables["NPM_CONFIG_USERCONFIG"] = Path.Combine(sourceTrap, "npmrc");
            polluted.EnvironmentVariables["npm_execpath"] = Path.Combine(sourceTrap, "npm-cli.js");
            polluted.EnvironmentVariables["NODE_OPTIONS"] = "--require " + Path.Combine(sourceTrap, "npm-prefix.js");
            polluted.EnvironmentVariables["NODE_PATH"] = sourceTrap;
            polluted.EnvironmentVariables["INIT_CWD"] = sourceTrap;
            MainForm.HardenPortableNodeEnvironment(polluted, packageNode);
            if (polluted.EnvironmentVariables.Keys.Cast<string>().Any(key => key.StartsWith("npm_", StringComparison.OrdinalIgnoreCase))) return 33;
            if (polluted.EnvironmentVariables["NODE_OPTIONS"] != null || polluted.EnvironmentVariables["NODE_PATH"] != null || polluted.EnvironmentVariables["INIT_CWD"] != null) return 34;
            if (!polluted.EnvironmentVariables["PATH"].StartsWith(Path.GetDirectoryName(packageNode), StringComparison.OrdinalIgnoreCase)
                || polluted.EnvironmentVariables["PATH"].IndexOf("malicious-npm-shim", StringComparison.OrdinalIgnoreCase) >= 0) return 35;
            File.Delete(packageEntry);
            try { MainForm.ResolvePackagedServerLaunch(packageRoot); return 36; }
            catch (InvalidOperationException error) { if (error.Message.IndexOf("portable-launcher.js", StringComparison.Ordinal) < 0) return 37; }

            var logPath = Path.Combine(outputDirectory, "client-server.log");
            var secret = "sk-phase1-ROTATION-TEST-CREDENTIAL";
            var chunk = new string('x', 700000)
                + " authorization=Bearer " + secret
                + " apiKey=" + secret
                + " ZHIPU_API_KEY=" + secret
                + Environment.NewLine;

            for (var index = 0; index < 40; index++) MainForm.AppendServerLog(logPath, chunk);

            var files = Directory.GetFiles(outputDirectory, "client-server.log*");
            if (files.Length != 5) return 20;
            if (files.Count(path => path.EndsWith(".1") || path.EndsWith(".2") || path.EndsWith(".3") || path.EndsWith(".4")) != 4) return 21;
            if (files.Any(path => new FileInfo(path).Length > 4L * 1024L * 1024L)) return 22;
            if (files.Any(path => File.ReadAllText(path).Contains(secret))) return 23;
            if (files.Any(path => !File.ReadAllText(path).Contains("[REDACTED]"))) return 24;

            Console.WriteLine("PASS build=" + (expectedDevelopment ? "development" : "release") + " files=" + files.Length);
            return 0;
        }
    }
}
