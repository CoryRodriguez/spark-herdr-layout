using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows;

[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8", FrameworkDisplayName = ".NET Framework 4.8")]
[assembly: AssemblyTitle("Spark Indicator")]
[assembly: AssemblyProduct("Spark Indicator")]
[assembly: AssemblyVersion("1.0.0.0")]

namespace SparkIndicator
{
    internal sealed class Options
    {
        public string Instance = "";          // "" = the real one; anything else = an isolated test instance
        public bool DryRun = false;           // log the jump command, never run it
        public string Send = null;            // send a debug command to a running instance and exit
        public string StartupDirOverride = null;
        public string CoreProcessName = "herdr-core";
        public string HcPathOverride = null;
        public bool Fixture = false;          // test only: draw made-up agents and never start or ask any Herdr program

        public string Suffix { get { return Instance.Length == 0 ? "" : "." + Instance; } }
        public string WindowTitle { get { return Instance.Length == 0 ? "Spark Indicator" : "Spark Indicator [" + Instance + "]"; } }
    }

    internal static class Log
    {
        private static readonly object Gate = new object();
        private static string _path;

        public static void Init(string path)
        {
            _path = path;
            try
            {
                FileInfo fi = new FileInfo(path);
                if (fi.Exists && fi.Length > 512 * 1024)
                {
                    string old = path + ".1";
                    if (File.Exists(old)) File.Delete(old);
                    File.Move(path, old);
                }
            }
            catch { }
        }

        public static void Write(string msg)
        {
            if (_path == null) return;
            try
            {
                lock (Gate)
                {
                    File.AppendAllText(_path,
                        DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture) + " local  " + msg + "\r\n",
                        new UTF8Encoding(false));
                }
            }
            catch { }
        }
    }

    internal sealed class Settings
    {
        public string Mode = "strip";         // strip | stack
        public string ThemeName = null;       // "light" | "dark"; null = never chosen, which keeps the original dark look
        public bool HasPosition = false;
        public bool AnchorRight = true;       // which edge of the pill stays put when it grows
        public int X = 0;                     // physical pixels: right edge if AnchorRight, else left edge
        public int Y = 0;                     // physical pixels: top edge of the pill
        public bool GreenUntilSeen = true;    // done = finished and not yet looked at in Herdr
        public Dictionary<string, string> ShortNames = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        public string HcPath = null;
        public string HerdrAppPath = null;

        private string _file;

        public static Settings Load(string file)
        {
            Settings s = new Settings();
            s._file = file;
            try
            {
                if (File.Exists(file))
                {
                    JavaScriptSerializer js = new JavaScriptSerializer();
                    Dictionary<string, object> d = js.Deserialize<Dictionary<string, object>>(File.ReadAllText(file, Encoding.UTF8));
                    if (d != null)
                    {
                        string mode = J.Str(d, "mode");
                        if (mode == "stack" || mode == "strip") s.Mode = mode;
                        string theme = J.Str(d, "theme");
                        if (theme == "light" || theme == "dark") s.ThemeName = theme;
                        if (d.ContainsKey("x") && d.ContainsKey("y") && d["x"] != null && d["y"] != null)
                        {
                            s.X = J.Int(d, "x", 0);
                            s.Y = J.Int(d, "y", 0);
                            s.HasPosition = true;
                        }
                        if (d.ContainsKey("anchorRight") && d["anchorRight"] is bool) s.AnchorRight = (bool)d["anchorRight"];
                        if (d.ContainsKey("greenUntilSeen") && d["greenUntilSeen"] is bool) s.GreenUntilSeen = (bool)d["greenUntilSeen"];
                        s.HcPath = J.Str(d, "hcPath");
                        s.HerdrAppPath = J.Str(d, "herdrAppPath");
                        Dictionary<string, object> sn = J.Dict(d, "shortNames");
                        if (sn != null)
                            foreach (KeyValuePair<string, object> kv in sn)
                                if (kv.Value != null) s.ShortNames[kv.Key] = kv.Value.ToString();
                    }
                }
            }
            catch (Exception ex) { Log.Write("settings load failed: " + ex.Message); }
            return s;
        }

        public void Save()
        {
            try
            {
                JavaScriptSerializer js = new JavaScriptSerializer();
                StringBuilder sb = new StringBuilder();
                sb.Append("{\n");
                sb.Append("  \"mode\": ").Append(js.Serialize(Mode)).Append(",\n");
                if (ThemeName != null) sb.Append("  \"theme\": ").Append(js.Serialize(ThemeName)).Append(",\n");
                if (HasPosition)
                {
                    sb.Append("  \"anchorRight\": ").Append(AnchorRight ? "true" : "false").Append(",\n");
                    sb.Append("  \"x\": ").Append(X.ToString(CultureInfo.InvariantCulture)).Append(",\n");
                    sb.Append("  \"y\": ").Append(Y.ToString(CultureInfo.InvariantCulture)).Append(",\n");
                }
                sb.Append("  \"greenUntilSeen\": ").Append(GreenUntilSeen ? "true" : "false").Append(",\n");
                sb.Append("  \"shortNames\": ").Append(js.Serialize(ShortNames)).Append(",\n");
                sb.Append("  \"hcPath\": ").Append(js.Serialize(HcPath)).Append(",\n");
                sb.Append("  \"herdrAppPath\": ").Append(js.Serialize(HerdrAppPath)).Append("\n");
                sb.Append("}\n");
                string tmp = _file + ".tmp";
                File.WriteAllText(tmp, sb.ToString(), new UTF8Encoding(false));
                if (File.Exists(_file)) File.Delete(_file);
                File.Move(tmp, _file);
            }
            catch (Exception ex) { Log.Write("settings save failed: " + ex.Message); }
        }
    }

    /// <summary>Small helpers for the loosely typed JSON that JavaScriptSerializer returns.</summary>
    internal static class J
    {
        public static Dictionary<string, object> Dict(Dictionary<string, object> d, string key)
        {
            object o;
            if (d == null || !d.TryGetValue(key, out o)) return null;
            return o as Dictionary<string, object>;
        }

        public static IList List(Dictionary<string, object> d, string key)
        {
            object o;
            if (d == null || !d.TryGetValue(key, out o)) return null;
            if (o is string) return null;
            return o as IList;
        }

        public static string Str(Dictionary<string, object> d, string key)
        {
            object o;
            if (d == null || !d.TryGetValue(key, out o) || o == null) return null;
            string s = o as string;
            if (s != null) return s;
            if (o is Dictionary<string, object> || o is IList) return null;
            return Convert.ToString(o, CultureInfo.InvariantCulture);
        }

        public static int Int(Dictionary<string, object> d, string key, int fallback)
        {
            object o;
            if (d == null || !d.TryGetValue(key, out o) || o == null) return fallback;
            try
            {
                if (o is string)
                {
                    int v;
                    return int.TryParse((string)o, NumberStyles.Integer, CultureInfo.InvariantCulture, out v) ? v : fallback;
                }
                return Convert.ToInt32(o, CultureInfo.InvariantCulture);
            }
            catch { return fallback; }
        }

        public static long Long(Dictionary<string, object> d, string key, long fallback)
        {
            object o;
            if (d == null || !d.TryGetValue(key, out o) || o == null) return fallback;
            try { return Convert.ToInt64(o, CultureInfo.InvariantCulture); }
            catch { return fallback; }
        }
    }

    internal static class Program
    {
        public static Options Opt = new Options();
        public static string BaseDir;
        public static string ExePath;

        [STAThread]
        private static int Main(string[] args)
        {
            ExePath = Assembly.GetExecutingAssembly().Location;
            BaseDir = Path.GetDirectoryName(ExePath);

            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (a == "--dry-run") Opt.DryRun = true;
                else if (a == "--instance" && i + 1 < args.Length) Opt.Instance = Sanitize(args[++i]);
                else if (a == "--send" && i + 1 < args.Length) Opt.Send = args[++i];
                else if (a == "--startup-dir" && i + 1 < args.Length) Opt.StartupDirOverride = args[++i];
                else if (a == "--core-process-name" && i + 1 < args.Length) Opt.CoreProcessName = args[++i];
                else if (a == "--hc-path" && i + 1 < args.Length) Opt.HcPathOverride = args[++i];
                else if (a == "--fixture") Opt.Fixture = true;
            }

            if (Opt.Send != null)
            {
                // Only ever the copy that runs from this folder: the window must belong to the process
                // named in this folder's pid file, and that process must be this very program file.
                // A copy installed somewhere else, with the same window title, is never spoken to.
                IntPtr target = FindOwnWindow();
                if (target == IntPtr.Zero) return 2;
                return Native.SendCommand(target, Opt.Send) ? 0 : 3;
            }

            // Nothing this process starts may inherit the identity of the session that launched it.
            ScrubEnvironment();

            bool created;
            Mutex mutex = new Mutex(true, "Local\\SparkIndicator" + Opt.Suffix + "." + StableHash(ExePath), out created);
            if (!created) return 0; // already running: stay quiet

            Log.Init(Path.Combine(BaseDir, "indicator" + Opt.Suffix + ".log"));
            string pidFile = Path.Combine(BaseDir, "indicator" + Opt.Suffix + ".pid");
            try { File.WriteAllText(pidFile, Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture), new UTF8Encoding(false)); }
            catch { }
            Log.Write("start pid=" + Process.GetCurrentProcess().Id + " dryRun=" + Opt.DryRun + " instance='" + Opt.Instance + "'" + (Opt.Fixture ? " fixture=True" : ""));

            AppDomain.CurrentDomain.UnhandledException += delegate(object s, UnhandledExceptionEventArgs e)
            {
                Log.Write("unhandled: " + e.ExceptionObject);
            };
            System.Threading.Tasks.TaskScheduler.UnobservedTaskException += delegate(object s, System.Threading.Tasks.UnobservedTaskExceptionEventArgs e)
            {
                Log.Write("unobserved task: " + e.Exception.Message);
                e.SetObserved();
            };

            int code = 0;
            try
            {
                // Three tiny, mostly static windows: drawing them without the graphics card keeps
                // the process small (no 3D device, fewer threads) and costs nothing measurable.
                if (Environment.GetEnvironmentVariable("SPARK_INDICATOR_HW") != "1")
                    System.Windows.Media.RenderOptions.ProcessRenderMode = System.Windows.Interop.RenderMode.SoftwareOnly;
                Application app = new Application();
                app.ShutdownMode = ShutdownMode.OnExplicitShutdown;
                app.DispatcherUnhandledException += delegate(object s, System.Windows.Threading.DispatcherUnhandledExceptionEventArgs e)
                {
                    Log.Write("ui exception (swallowed): " + e.Exception);
                    e.Handled = true;
                };
                Settings settings = Settings.Load(Path.Combine(BaseDir, "settings" + Opt.Suffix + ".json"));
                Theme.Use(settings.ThemeName);
                Controller controller = new Controller(settings);
                controller.Start();
                app.Run();
                controller.Shutdown();
            }
            catch (Exception ex)
            {
                Log.Write("fatal: " + ex);
                code = 1;
            }
            finally
            {
                try { if (File.Exists(pidFile)) File.Delete(pidFile); } catch { }
                Log.Write("exit code=" + code);
                GC.KeepAlive(mutex);
            }
            return code;
        }

        private static IntPtr FindOwnWindow()
        {
            try
            {
                string pidFile = Path.Combine(BaseDir, "indicator" + Opt.Suffix + ".pid");
                if (!File.Exists(pidFile)) return IntPtr.Zero;
                int id;
                if (!int.TryParse(File.ReadAllText(pidFile).Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out id) || id <= 0) return IntPtr.Zero;
                using (Process p = Process.GetProcessById(id))
                {
                    if (!string.Equals(p.MainModule.FileName, ExePath, StringComparison.OrdinalIgnoreCase)) return IntPtr.Zero;
                }
                return Native.FindWindowOfProcess(Opt.WindowTitle, (uint)id);
            }
            catch { return IntPtr.Zero; }
        }

        private static void ScrubEnvironment()
        {
            try
            {
                List<string> kill = new List<string>();
                foreach (DictionaryEntry de in Environment.GetEnvironmentVariables())
                {
                    string k = (string)de.Key;
                    if (k.StartsWith("CLAUDE_", StringComparison.OrdinalIgnoreCase) ||
                        k.StartsWith("CLAUDECODE", StringComparison.OrdinalIgnoreCase) ||
                        k.StartsWith("HC_TERMINAL", StringComparison.OrdinalIgnoreCase))
                        kill.Add(k);
                }
                foreach (string k in kill) Environment.SetEnvironmentVariable(k, null);
            }
            catch { }
        }

        private static string Sanitize(string s)
        {
            StringBuilder sb = new StringBuilder();
            foreach (char c in s) if (char.IsLetterOrDigit(c) || c == '-' || c == '_') sb.Append(c);
            return sb.ToString();
        }

        private static string StableHash(string s)
        {
            unchecked
            {
                uint h = 2166136261;
                foreach (char c in s.ToLowerInvariant()) { h ^= c; h *= 16777619; }
                return h.ToString("x8", CultureInfo.InvariantCulture);
            }
        }
    }
}
