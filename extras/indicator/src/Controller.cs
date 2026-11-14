using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Threading;

namespace SparkIndicator
{
    /// <summary>Ties the Herdr data to the three little windows. All of it runs on the UI thread.</summary>
    internal sealed class Controller
    {
        private readonly Settings _settings;
        private readonly HerdrClient _client;
        private PillWindow _pill;
        private ListWindow _list;
        private MenuWindow _menu;

        private List<SpaceVM> _spaces = new List<SpaceVM>();
        private string _signature = null;
        private HashSet<string> _waiting = new HashSet<string>(StringComparer.Ordinal);
        private bool _alert;
        private bool _listPinned;     // test switch: keep the list open
        private bool _holdFlash;      // test switch: hold the flash at its peak
        private int _flashCount;

        private readonly DispatcherTimer _openTimer;
        private readonly DispatcherTimer _hideTimer;
        private readonly DispatcherTimer _menuTimer;

        public Controller(Settings settings)
        {
            _settings = settings;
            Dispatcher ui = Dispatcher.CurrentDispatcher;
            _client = new HerdrClient(ui, settings);

            _openTimer = new DispatcherTimer(DispatcherPriority.Normal, ui);
            _openTimer.Interval = TimeSpan.FromMilliseconds(120);
            _openTimer.Tick += delegate { _openTimer.Stop(); ShowList(); };

            _hideTimer = new DispatcherTimer(DispatcherPriority.Normal, ui);
            _hideTimer.Interval = TimeSpan.FromMilliseconds(350);
            _hideTimer.Tick += delegate { _hideTimer.Stop(); if (!_listPinned) HideList(); };

            _menuTimer = new DispatcherTimer(DispatcherPriority.Normal, ui);
            _menuTimer.Tick += delegate { _menuTimer.Stop(); HideMenu(); };
        }

        public void Start()
        {
            _pill = new PillWindow(Program.Opt.WindowTitle);
            _list = new ListWindow(Program.Opt.WindowTitle + " List");
            _menu = new MenuWindow(Program.Opt.WindowTitle + " Menu");

            _pill.HoverEnter += OnPillEnter;
            _pill.HoverLeave += OnPillLeave;
            _pill.MenuRequested += ToggleMenu;
            _pill.DragStarted += delegate { _openTimer.Stop(); HideList(); HideMenu(); };
            _pill.DragEnded += OnDragEnded;
            _pill.Command += OnCommand;
            _pill.DisplayChanged += delegate { EnsureOnScreen(); ApplyAnchor(); };
            _pill.SizeChanged += delegate { ApplyAnchor(); if (_list.IsVisible) PositionList(); };

            _list.HoverEnter += delegate { _hideTimer.Stop(); };
            _list.HoverLeave += delegate { if (!_listPinned) { _hideTimer.Stop(); _hideTimer.Start(); } };
            _list.RowClicked += OnRowClicked;

            _menu.HoverEnter += delegate { _menuTimer.Stop(); };
            _menu.HoverLeave += delegate { _menuTimer.Stop(); _menuTimer.Interval = TimeSpan.FromMilliseconds(600); _menuTimer.Start(); };
            _menu.Picked += OnMenuPicked;

            _client.Changed += Refresh;

            _pill.Render(_spaces, false, _settings.Mode);
            _pill.Show();
            _pill.UpdateLayout();
            EnsureOnScreen();
            ApplyAnchor();

            _client.Start();
        }

        public void Shutdown()
        {
            _client.Stop();
        }

        // ------------------------------------------------------------------ data -> picture

        private void Refresh()
        {
            List<SpaceVM> spaces = _client.Connected ? _client.BuildSpaces() : new List<SpaceVM>();
            string sig = Signature(spaces, _client.Connected);
            if (sig == _signature) return;
            _signature = sig;
            _spaces = spaces;

            HashSet<string> now = new HashSet<string>(StringComparer.Ordinal);
            bool someoneNew = false;
            foreach (SpaceVM s in spaces)
                foreach (Row r in s.Rows)
                    if (r.Kind == Kind.Waiting)
                    {
                        now.Add(r.Addr);
                        if (!_waiting.Contains(r.Addr)) someoneNew = true;
                    }
            _waiting = now;
            _alert = now.Count > 0;

            _pill.Render(spaces, _client.Connected, _settings.Mode);
            _pill.SetAlert(_alert);
            if (someoneNew)
            {
                _flashCount++;
                Log.Write("flash: an agent started waiting");
                if (!_holdFlash) _pill.Flash();
            }
            _pill.RaiseTopmost();
            if (_list.IsVisible)
            {
                _list.Render(spaces, _client.Connected);
                _list.UpdateLayout();
                PositionList();
            }
        }

        private void ForceRefresh()
        {
            _signature = null;
            Refresh();
        }

        private string Signature(List<SpaceVM> spaces, bool connected)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append(connected ? "1" : "0").Append('|').Append(_settings.Mode);
            foreach (SpaceVM s in spaces)
            {
                sb.Append("\n#").Append(s.Index).Append('|').Append(s.Name).Append('|').Append(s.Short);
                foreach (Row r in s.Rows)
                    sb.Append("\n ").Append(r.Addr).Append('|').Append(r.Name).Append('|').Append((int)r.Kind).Append('|').Append(r.Tip);
            }
            return sb.ToString();
        }

        // ------------------------------------------------------------------ position

        private void DefaultPosition()
        {
            // Top right of the primary monitor, in the title bar row, just left of where a
            // maximized window keeps its minimize / maximize / close buttons.
            double s = _pill.Scale;
            Native.RECT work = Native.PrimaryWorkArea();
            _settings.AnchorRight = true;
            _settings.X = work.Right - (int)Math.Round(150 * s);
            _settings.Y = work.Top + (int)Math.Round(3 * s);
        }

        private void EnsureOnScreen()
        {
            bool ok = _settings.HasPosition;
            if (ok)
            {
                int probeX = _settings.AnchorRight ? _settings.X - 20 : _settings.X + 20;
                ok = Native.PointOnAnyMonitor(probeX, _settings.Y + 10);
            }
            if (!ok)
            {
                DefaultPosition();
            }
        }

        private void ApplyAnchor()
        {
            if (_pill == null || _pill.Hwnd == IntPtr.Zero || _pill.IsDragging) return;
            int w, h;
            _pill.BoxSizePx(out w, out h);
            int left = _settings.AnchorRight ? _settings.X - w : _settings.X;
            _pill.MoveBoxTo(left, _settings.Y);
        }

        private void OnDragEnded()
        {
            Native.RECT box = _pill.BoxRect();
            Native.RECT mon;
            Native.RECT work = Native.WorkAreaAt((box.Left + box.Right) / 2, (box.Top + box.Bottom) / 2, out mon);
            int w = box.Width, h = box.Height;
            int x = Math.Max(mon.Left, Math.Min(box.Left, mon.Right - w));
            int y = Math.Max(mon.Top, Math.Min(box.Top, mon.Bottom - h));
            _settings.AnchorRight = (x + w / 2) > (work.Left + work.Right) / 2;
            _settings.X = _settings.AnchorRight ? x + w : x;
            _settings.Y = y;
            _settings.HasPosition = true;
            _settings.Save();
            ApplyAnchor();
            Log.Write("moved to x=" + _settings.X + " y=" + _settings.Y + " anchorRight=" + _settings.AnchorRight);
        }

        private void PositionList()
        {
            double s = _pill.Scale;
            Native.RECT box = _pill.BoxRect();
            Native.RECT mon;
            Native.RECT work = Native.WorkAreaAt((box.Left + box.Right) / 2, (box.Top + box.Bottom) / 2, out mon);
            int w, h;
            _list.BoxSizePx(out w, out h);
            int gap = (int)Math.Round(8 * s);
            int edge = (int)Math.Round(4 * s);
            int x = _settings.AnchorRight ? box.Right - w : box.Left;
            x = Math.Max(work.Left + edge, Math.Min(x, work.Right - w - edge));
            int y = box.Bottom + gap;
            if (y + h > work.Bottom - edge && box.Top - gap - h >= mon.Top) y = box.Top - gap - h;
            _list.MoveBoxTo(x, y);
        }

        // ------------------------------------------------------------------ hover list

        private void OnPillEnter()
        {
            if (_menu.IsVisible) return;
            _hideTimer.Stop();
            if (!_list.IsVisible) { _openTimer.Stop(); _openTimer.Start(); }
        }

        private void OnPillLeave()
        {
            _openTimer.Stop();
            if (_list.IsVisible && !_listPinned) { _hideTimer.Stop(); _hideTimer.Start(); }
        }

        private void ShowList()
        {
            if (_pill.IsDragging) return;
            _client.RequestLayoutIfStale();
            _client.RefreshUnseenDone();
            _list.Render(_spaces, _client.Connected);
            if (!_list.IsVisible) _list.Show();
            _list.UpdateLayout();
            PositionList();
        }

        private void HideList()
        {
            _hideTimer.Stop();
            if (_list.IsVisible) _list.Hide();
        }

        private void OnRowClicked(string addr)
        {
            _client.Focus(addr);
            if (!_listPinned) HideList();
        }

        // ------------------------------------------------------------------ right-click menu

        private string StartupLinkPath()
        {
            string dir = Program.Opt.StartupDirOverride ?? Environment.GetFolderPath(Environment.SpecialFolder.Startup);
            return Path.Combine(dir, "Spark Indicator.lnk");
        }

        private bool StartupOn() { try { return File.Exists(StartupLinkPath()); } catch { return false; } }

        private void ToggleMenu()
        {
            if (_menu.IsVisible) { HideMenu(); return; }
            ShowMenu();
        }

        private void ShowMenu()
        {
            _openTimer.Stop();
            HideList();
            _menu.Render(_settings.Mode, StartupOn());
            if (!_menu.IsVisible) _menu.Show();
            _menu.UpdateLayout();

            double s = _pill.Scale;
            Native.RECT box = _pill.BoxRect();
            Native.RECT mon;
            Native.RECT work = Native.WorkAreaAt((box.Left + box.Right) / 2, (box.Top + box.Bottom) / 2, out mon);
            int w, h;
            _menu.BoxSizePx(out w, out h);
            int gap = (int)Math.Round(6 * s);
            int x = _settings.AnchorRight ? box.Right - w : box.Left;
            x = Math.Max(work.Left + 4, Math.Min(x, work.Right - w - 4));
            int y = box.Bottom + gap;
            if (y + h > work.Bottom - 4 && box.Top - gap - h >= mon.Top) y = box.Top - gap - h;
            _menu.MoveBoxTo(x, y);

            // No focus is taken, so there is no "click elsewhere" to close it: it closes on a pick,
            // on a second right-click, or shortly after the pointer leaves it.
            _menuTimer.Stop();
            _menuTimer.Interval = TimeSpan.FromSeconds(4);
            _menuTimer.Start();
        }

        private void HideMenu()
        {
            _menuTimer.Stop();
            if (_menu.IsVisible) _menu.Hide();
        }

        private void OnMenuPicked(string id)
        {
            HideMenu();
            if (id == "strip" || id == "stack") SetMode(id);
            else if (id == "light" || id == "dark") SetTheme(id);
            else if (id == "startup") ToggleStartup();
            else if (id == "quit") Quit();
        }

        private void SetMode(string mode)
        {
            if (_settings.Mode == mode) return;
            _settings.Mode = mode;
            _settings.Save();
            ForceRefresh();
            _pill.UpdateLayout();
            ApplyAnchor();
        }

        /// <summary>
        /// Light or dark, from the right-click menu: saved, and on screen at once. Every window
        /// re-reads its frame colors and is drawn again; nothing is restarted.
        /// </summary>
        private void SetTheme(string name)
        {
            if (name != "light" && name != "dark") return;
            if (_settings.ThemeName == name) return;
            _settings.ThemeName = name;
            _settings.Save();
            ApplyTheme();
            Log.Write("look: " + name);
        }

        private void ApplyTheme()
        {
            Theme.Use(_settings.ThemeName);
            _pill.ApplyTheme();
            _list.ApplyTheme();
            _menu.ApplyTheme();
            _pill.Render(_spaces, _client.Connected, _settings.Mode);
            _pill.SetAlert(_alert);
            if (_list.IsVisible) _list.Render(_spaces, _client.Connected);
            if (_menu.IsVisible) _menu.Render(_settings.Mode, StartupOn());
            _pill.RaiseTopmost();
        }

        private void ToggleStartup()
        {
            string link = StartupLinkPath();
            try
            {
                if (File.Exists(link))
                {
                    File.Delete(link);
                    Log.Write("Start with Windows: off (removed " + link + ")");
                    return;
                }
                Type t = Type.GetTypeFromProgID("WScript.Shell");
                object shell = Activator.CreateInstance(t);
                object sc = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { link });
                Type st = sc.GetType();
                st.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { Program.ExePath });
                st.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { Program.BaseDir });
                st.InvokeMember("Description", BindingFlags.SetProperty, null, sc, new object[] { "Herdr agent status indicator" });
                st.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, new object[0]);
                Log.Write("Start with Windows: on (created " + link + ")");
            }
            catch (Exception ex) { Log.Write("Start with Windows toggle failed: " + ex.Message); }
        }

        private void Quit()
        {
            Log.Write("quit requested");
            try { _client.Stop(); } catch { }
            Application.Current.Shutdown();
        }

        // ------------------------------------------------------------------ test switches
        // Sent by a second copy:  SparkIndicator.exe [--instance name] --send "<command>"
        // None of these talk to Herdr.

        private void OnCommand(string text)
        {
            string cmd = text.Trim();
            string arg = "";
            int sp = cmd.IndexOf(' ');
            if (sp > 0) { arg = cmd.Substring(sp + 1).Trim(); cmd = cmd.Substring(0, sp); }
            Log.Write("command: " + text.Trim());
            switch (cmd)
            {
                case "quit": Quit(); break;
                case "open-list": _listPinned = true; _hideTimer.Stop(); HideMenu(); ShowList(); break;
                case "close-list": _listPinned = false; HideList(); break;
                case "hover-on": OnPillEnter(); break;     // same code path as the pointer entering the pill
                case "hover-off": OnPillLeave(); break;    // same code path as the pointer leaving it
                case "sim-wait": _client.SimulatedWaiting.Add(arg); ForceRefresh(); break;
                case "sim-clear": _client.SimulatedWaiting.Clear(); _holdFlash = false; _pill.HoldFlashPeak(false); ForceRefresh(); break;
                case "flash": _pill.Flash(); break;
                case "hold-flash": _holdFlash = arg != "off"; _pill.HoldFlashPeak(_holdFlash); break;
                case "menu": ShowMenu(); _menuTimer.Stop(); break;
                case "menu-close": HideMenu(); break;
                case "mode": if (arg == "strip" || arg == "stack") SetMode(arg); break;
                case "menu-pick":
                    // The same code a click on that menu row runs. Only the rows that change how it looks.
                    if (arg == "light" || arg == "dark" || arg == "strip" || arg == "stack") OnMenuPicked(arg);
                    break;
                case "theme-unset":
                    // Back to "never chosen" (the original look), for comparing against it.
                    _settings.ThemeName = null; _settings.Save(); ApplyTheme();
                    break;
                case "dump": Dump(arg); break;
                case "sim-drag":
                    {
                        // Moves the window by dx,dy pixels and then runs the same "drag ended" code a real drag ends with.
                        string[] parts = arg.Split(new char[] { ' ', ',' }, StringSplitOptions.RemoveEmptyEntries);
                        int dx, dy;
                        if (parts.Length == 2 && int.TryParse(parts[0], out dx) && int.TryParse(parts[1], out dy))
                        {
                            Native.RECT wr;
                            Native.GetWindowRect(_pill.Hwnd, out wr);
                            Native.SetWindowPos(_pill.Hwnd, Native.HWND_TOPMOST, wr.Left + dx, wr.Top + dy, 0, 0, Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
                            OnDragEnded();
                        }
                    }
                    break;
                case "click":
                    if (Program.Opt.DryRun) OnRowClicked(arg);
                    else Log.Write("command 'click' ignored: only honored with --dry-run");
                    break;
                case "toggle-startup":
                    if (Program.Opt.StartupDirOverride != null) ToggleStartup();
                    else Log.Write("command 'toggle-startup' ignored: only honored with --startup-dir");
                    break;
            }
        }

        private static string RectText(Native.RECT r)
        {
            return "[" + r.Left + "," + r.Top + "," + r.Right + "," + r.Bottom + "]";
        }

        private void Dump(string path)
        {
            try
            {
                if (string.IsNullOrEmpty(path)) path = Path.Combine(Program.BaseDir, "state_dump" + Program.Opt.Suffix + ".json");
                JavaScriptSerializer js = new JavaScriptSerializer();
                StringBuilder sb = new StringBuilder();
                Native.RECT wr;
                sb.Append("{\n");
                sb.Append("  \"time_local\": ").Append(js.Serialize(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture))).Append(",\n");
                sb.Append("  \"connected\": ").Append(_client.Connected ? "true" : "false").Append(",\n");
                sb.Append("  \"mode\": ").Append(js.Serialize(_settings.Mode)).Append(",\n");
                sb.Append("  \"theme_setting\": ").Append(js.Serialize(_settings.ThemeName)).Append(",\n");
                sb.Append("  \"palette\": {");
                for (int i = 0; i < Palette.Names.Length; i++)
                    sb.Append(i == 0 ? "" : ", ").Append(js.Serialize(Palette.Names[i])).Append(": ").Append(js.Serialize(Theme.Current.Hex[i]));
                sb.Append(", \"shadowOpacity\": ").Append(Theme.Current.ShadowOpacity.ToString(CultureInfo.InvariantCulture)).Append("},\n");
                sb.Append("  \"fixture\": ").Append(Program.Opt.Fixture ? "true" : "false").Append(",\n");
                sb.Append("  \"green_until_seen\": ").Append(_settings.GreenUntilSeen ? "true" : "false").Append(",\n");
                sb.Append("  \"amber_outline\": ").Append(_alert ? "true" : "false").Append(",\n");
                sb.Append("  \"flashes_so_far\": ").Append(_flashCount).Append(",\n");
                sb.Append("  \"dry_run\": ").Append(Program.Opt.DryRun ? "true" : "false").Append(",\n");
                List<string> identity = new List<string>();
                foreach (System.Collections.DictionaryEntry de in Environment.GetEnvironmentVariables())
                {
                    string k = (string)de.Key;
                    if (k.StartsWith("CLAUDE_", StringComparison.OrdinalIgnoreCase) || k.StartsWith("CLAUDECODE", StringComparison.OrdinalIgnoreCase) || k.StartsWith("HC_TERMINAL", StringComparison.OrdinalIgnoreCase))
                        identity.Add(k);
                }
                sb.Append("  \"agent_identity_env_vars_in_this_process\": ").Append(js.Serialize(identity)).Append(",\n");
                sb.Append("  \"foreground_hwnd\": ").Append(Native.GetForegroundWindow().ToInt64()).Append(",\n");
                sb.Append("  \"pill_hwnd\": ").Append(_pill.Hwnd.ToInt64()).Append(",\n");
                sb.Append("  \"list_hwnd\": ").Append(_list.Hwnd.ToInt64()).Append(",\n");
                sb.Append("  \"menu_hwnd\": ").Append(_menu.Hwnd.ToInt64()).Append(",\n");
                Native.GetWindowRect(_pill.Hwnd, out wr);
                sb.Append("  \"pill_window_px\": ").Append(RectText(wr)).Append(",\n");
                sb.Append("  \"pill_box_px\": ").Append(RectText(_pill.BoxRect())).Append(",\n");
                sb.Append("  \"list_visible\": ").Append(_list.IsVisible ? "true" : "false").Append(",\n");
                if (_list.IsVisible)
                {
                    Native.GetWindowRect(_list.Hwnd, out wr);
                    sb.Append("  \"list_window_px\": ").Append(RectText(wr)).Append(",\n");
                    sb.Append("  \"list_box_px\": ").Append(RectText(_list.BoxRect())).Append(",\n");
                }
                sb.Append("  \"menu_visible\": ").Append(_menu.IsVisible ? "true" : "false").Append(",\n");
                if (_menu.IsVisible)
                {
                    Native.GetWindowRect(_menu.Hwnd, out wr);
                    sb.Append("  \"menu_window_px\": ").Append(RectText(wr)).Append(",\n");
                }
                sb.Append("  \"jump_command_form\": ").Append(js.Serialize(_client.FocusCommandLine("<address>"))).Append(",\n");
                sb.Append("  \"spaces\": [");
                bool firstSpace = true;
                foreach (SpaceVM s in _spaces)
                {
                    sb.Append(firstSpace ? "\n" : ",\n");
                    firstSpace = false;
                    sb.Append("    {\"index\": ").Append(s.Index).Append(", \"name\": ").Append(js.Serialize(s.Name))
                      .Append(", \"strip_label\": ").Append(js.Serialize(s.Short))
                      .Append(", \"waiting\": ").Append(s.Waiting)
                      .Append(", \"shell_only\": ").Append(s.ShellOnly ? "true" : "false").Append(", \"rows\": [");
                    bool firstRow = true;
                    foreach (Row r in s.Rows)
                    {
                        sb.Append(firstRow ? "\n" : ",\n");
                        firstRow = false;
                        sb.Append("      {\"address\": ").Append(js.Serialize(r.Addr))
                          .Append(", \"dot\": ").Append(js.Serialize(r.Kind.ToString().ToLowerInvariant()))
                          .Append(", \"name\": ").Append(js.Serialize(r.Name))
                          .Append(", \"word\": ").Append(js.Serialize(r.Word))
                          .Append(", \"hc_state\": ").Append(js.Serialize(r.RawState))
                          .Append(", \"turn\": ").Append(r.Turn)
                          .Append(", \"seen\": ").Append(r.Seen)
                          .Append(", \"tooltip\": ").Append(js.Serialize(r.Tip)).Append("}");
                    }
                    sb.Append(firstRow ? "]}" : "\n    ]}");
                }
                sb.Append(firstSpace ? "]\n" : "\n  ]\n");
                sb.Append("}\n");
                File.WriteAllText(path, sb.ToString(), new UTF8Encoding(false));
            }
            catch (Exception ex) { Log.Write("dump failed: " + ex.Message); }
        }
    }
}
