using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace ClownfishPortableLauncher
{
    internal static class Program
    {
        [STAThread]
        public static int Main()
        {
            var root = Path.GetFullPath(AppContext.BaseDirectory);
            var target = Path.GetFullPath(Path.Combine(root, "portable", "小丑鱼", "小丑鱼.exe"));
            var prefix = root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || !File.Exists(target))
            {
                MessageBox.Show(
                    "当前目录不是完整的小丑鱼便携包。\n\n请完整解压发布 ZIP，然后启动解压目录中的“小丑鱼.exe”；不要单独复制或启动构建中间文件。",
                    "小丑鱼便携包不完整",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return 2;
            }
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = target,
                    WorkingDirectory = Path.GetDirectoryName(target),
                    UseShellExecute = false
                });
                return 0;
            }
            catch (Exception error)
            {
                MessageBox.Show(
                    "无法启动便携客户端：" + error.Message,
                    "小丑鱼启动失败",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return 3;
            }
        }
    }
}
