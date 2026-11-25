using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;

internal static class Launcher {
    [STAThread]
    private static void Main() {
        try {
            var assembly = Assembly.GetExecutingAssembly();
            var cache = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                                     "Degerlendirici", assembly.ManifestModule.ModuleVersionId.ToString("N"));
            var exe = Path.Combine(cache, "obs-bridge.exe");
            if (!File.Exists(exe)) {
                var stage = cache + "-" + Guid.NewGuid().ToString("N");
                Directory.CreateDirectory(stage);
                try {
                    using (var data = assembly.GetManifestResourceStream("runtime.zip"))
                    using (var zip = new ZipArchive(data)) {
                        zip.ExtractToDirectory(stage);
                    }
                    try { Directory.Move(stage, cache); }
                    catch (IOException) { if (!File.Exists(exe)) throw; }
                } finally {
                    if (Directory.Exists(stage)) Directory.Delete(stage, true);
                }
            }
            Process.Start(new ProcessStartInfo(exe) { WorkingDirectory = cache, UseShellExecute = false });
        } catch (Exception e) {
            MessageBox.Show(e.Message, "Değerlendirici OBS Köprüsü", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
