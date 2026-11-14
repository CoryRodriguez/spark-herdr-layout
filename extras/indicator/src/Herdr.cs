using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Threading;

namespace SparkIndicator
{
    internal enum Kind { Waiting, Working, Done, Idle, Shell }

    internal sealed class Row
    {
        public string Addr;
        public string Name;
        public string Word;
        public string Tip;
        public Kind Kind;
        public bool Clickable;
        public string RawState;   // what hc reports, for the state dump
        public int Turn;
        public int Seen;
    }

    internal sealed class SpaceVM
    {
        public int Index;
        public string Id;
        public string Name;
        public string Short;
        public List<Row> Rows = new List<Row>();
        public int Waiting;
        public bool ShellOnly;
    }

    internal sealed class CmdResult
    {
        public bool Started;
        public bool TimedOut;
        public int Exit = -1;
        public string Out = "";
        public bool Ok { get { return Started && !TimedOut && Exit == 0; } }
    }

    internal sealed class AppTab
    {
        public string Id;
        public string Name;
        public List<string> Terminals = new List<string>();
    }

    internal sealed class AppSpace
    {
        public string Id;
        public string Name;
        public List<AppTab> Tabs = new List<AppTab>();
    }

    /// <summary>
    /// Talks to Herdr. Status changes arrive over one long-lived "hc events" stream (no polling);
    /// "hc get" fills in details after a change, "herdr-app ls" gives the order of spaces and tabs,
    /// and a 60 second "hc ls" cross-check catches anything the stream did not announce.
    /// Everything here runs on the UI thread except the blocking stream reader and one-shot commands.
    /// </summary>
    internal sealed class HerdrClient
    {
        public event Action Changed;

        private readonly Dispatcher _ui;
        private readonly Settings _settings;
        private readonly string _hc;
        private readonly string _app;

        private readonly Dictionary<string, Dictionary<string, object>> _terms =
            new Dictionary<string, Dictionary<string, object>>(StringComparer.Ordinal);
        private List<AppSpace> _layout;               // null = window not open, fall back to labels
        private bool _connected;
        private int _gen;
        private Process _stream;
        private int _lastLineTick;
        private int _failCount;
        private int _reconcileTicks;
        private bool _stopping;
        private bool _saidDown;

        private readonly DispatcherTimer _retryTimer;
        private readonly DispatcherTimer _reconcileTimer;
        private readonly DispatcherTimer _getTimer;
        private readonly DispatcherTimer _layoutTimer;
        private readonly DispatcherTimer _soonTimer;
        private readonly HashSet<string> _pendingGets = new HashSet<string>(StringComparer.Ordinal);
        private DateTime _lastLayoutUtc = DateTime.MinValue;
        private bool _layoutRunning;

        public readonly HashSet<string> SimulatedWaiting = new HashSet<string>(StringComparer.Ordinal);

        private static bool AsciiAlnum(char c)
        {
            return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
        }

        /// <summary>
        /// A terminal address is the only outside text that ever reaches a command line, so it must be
        /// 1 to 64 characters, start with a letter or digit, and hold only letters, digits, _ . / -
        /// </summary>
        private static bool AddrOk(string a)
        {
            if (a == null || a.Length < 1 || a.Length > 64 || !AsciiAlnum(a[0])) return false;
            foreach (char c in a)
                if (!AsciiAlnum(c) && c != '_' && c != '.' && c != '/' && c != '-') return false;
            return true;
        }

        public bool Connected { get { return _connected; } }
        public string AppPath { get { return _app; } }

        public HerdrClient(Dispatcher ui, Settings settings)
        {
            _ui = ui;
            _settings = settings;
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            _hc = Program.Opt.HcPathOverride ?? Resolve(settings.HcPath, Path.Combine(local, "Programs\\herdr-core\\hc.exe"), "hc.exe");
            _app = Resolve(settings.HerdrAppPath, Path.Combine(local, "Programs\\herdr-app\\herdr-app.exe"), "herdr-app.exe");

            _retryTimer = new DispatcherTimer(DispatcherPriority.Background, ui);
            _retryTimer.Tick += delegate { _retryTimer.Stop(); StartStream(); };

            _reconcileTimer = new DispatcherTimer(DispatcherPriority.Background, ui);
            _reconcileTimer.Interval = TimeSpan.FromSeconds(60);
            _reconcileTimer.Tick += delegate { OnReconcileTick(); };

            _getTimer = new DispatcherTimer(DispatcherPriority.Background, ui);
            _getTimer.Interval = TimeSpan.FromMilliseconds(150);
            _getTimer.Tick += delegate { _getTimer.Stop(); FlushGets(); };

            _layoutTimer = new DispatcherTimer(DispatcherPriority.Background, ui);
            _layoutTimer.Interval = TimeSpan.FromMilliseconds(400);
            _layoutTimer.Tick += delegate { _layoutTimer.Stop(); RunLayout(); };

            _soonTimer = new DispatcherTimer(DispatcherPriority.Background, ui);
            _soonTimer.Interval = TimeSpan.FromSeconds(2);
            _soonTimer.Tick += delegate { _soonTimer.Stop(); Reconcile(); };
        }

        private static string Resolve(string configured, string standard, string bare)
        {
            if (!string.IsNullOrEmpty(configured)) return configured;
            if (File.Exists(standard)) return standard;
            return bare;
        }

        public void Start()
        {
            if (Program.Opt.Fixture) { LoadFixture(); return; }
            StartStream();
            _reconcileTimer.Start();
        }

        // ------------------------------------------------------------------ test only: made-up agents
        // With --fixture nothing below this class ever starts a program: no event stream, no "hc",
        // no "herdr-app". The rows are invented and go through the same code as real ones.

        private static Dictionary<string, object> FixtureTerminal(string addr, string space, string tab, string title, string state, int turn, int seen)
        {
            Dictionary<string, object> t = new Dictionary<string, object>();
            t["address"] = addr;
            t["state"] = "live";
            t["title"] = title;
            t["turn"] = turn;
            Dictionary<string, object> labels = new Dictionary<string, object>();
            labels["where"] = space + " / " + tab;
            if (seen >= 0) labels["herdr.seen"] = seen;
            t["labels"] = labels;
            if (state != null)
            {
                Dictionary<string, object> status = new Dictionary<string, object>();
                status["state"] = state;
                status["app"] = "agent";
                t["status"] = status;
            }
            else
            {
                Dictionary<string, object> fg = new Dictionary<string, object>();
                fg["name"] = "pwsh";
                t["foreground"] = fg;
            }
            return t;
        }

        private void LoadFixture()
        {
            string[][] rows =
            {
                // address, space, tab, title, state (null = a plain shell), turn, seen
                new string[] { "f1", "Website", "1", "Landing page copy", "working", "4", "3" },
                new string[] { "f2", "Website", "2", "Pricing table", "done", "6", "5" },
                new string[] { "f3", "Website", "3", "Signup form tests", "idle", "2", "2" },
                new string[] { "f4", "Research", "1", "Competitor notes", "idle", "1", "1" },
                new string[] { "f5", "Research", "2", "Interview summaries", "working", "3", "2" },
                new string[] { "f6", "Research", "3", "", null, "0", "-1" },
                new string[] { "f7", "Mobile app", "1", "Onboarding screens", "done", "9", "9" },
            };
            _terms.Clear();
            _layout = new List<AppSpace>();
            foreach (string[] r in rows)
            {
                _terms[r[0]] = FixtureTerminal(r[0], r[1], r[2], r[3], r[4], int.Parse(r[5], CultureInfo.InvariantCulture), int.Parse(r[6], CultureInfo.InvariantCulture));
                AppSpace sp = null;
                foreach (AppSpace s in _layout) if (s.Name == r[1]) { sp = s; break; }
                if (sp == null) { sp = new AppSpace(); sp.Id = r[1]; sp.Name = r[1]; _layout.Add(sp); }
                AppTab tab = new AppTab();
                tab.Id = r[0]; tab.Name = r[2];
                tab.Terminals.Add(r[0]);
                sp.Tabs.Add(tab);
            }
            _connected = true;
            Log.Write("fixture: " + _terms.Count + " made-up terminals; no Herdr program will be started");
            Raise();
        }

        public void Stop()
        {
            _stopping = true;
            _gen++;
            _retryTimer.Stop(); _reconcileTimer.Stop(); _getTimer.Stop(); _layoutTimer.Stop(); _soonTimer.Stop();
            KillStream();
        }

        private void KillStream()
        {
            Process p = _stream;
            _stream = null;
            if (p == null) return;
            try { if (!p.HasExited) p.Kill(); } catch { }
            try { p.Dispose(); } catch { }
        }

        private static bool ProcessExists(string name)
        {
            try
            {
                Process[] ps = Process.GetProcessesByName(name);
                bool any = ps.Length > 0;
                foreach (Process p in ps) p.Dispose();
                return any;
            }
            catch { return false; }
        }

        private bool CoreRunning() { return ProcessExists(Program.Opt.CoreProcessName); }

        // ------------------------------------------------------------------ the event stream

        private void StartStream()
        {
            if (_stopping || Program.Opt.Fixture) return;
            _gen++;
            int myGen = _gen;
            KillStream();

            // Checking for the service first means a retry can never be what starts it.
            if (!CoreRunning())
            {
                SetDisconnected("service process not found");
                ScheduleRetry();
                return;
            }
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(_hc, "events --json");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardInput = true;
                psi.StandardOutputEncoding = Encoding.UTF8;
                Process p = Process.Start(psi);
                Native.AddToKillOnCloseJob(p.Handle);
                try { p.StandardInput.Close(); } catch { }
                _stream = p;
                _lastLineTick = Environment.TickCount;
                Thread t = new Thread(delegate() { ReadLoop(p, myGen); });
                t.IsBackground = true;
                t.Name = "hc-events";
                t.Start();
                Log.Write("events stream started (pid " + p.Id + ")");
            }
            catch (Exception ex)
            {
                Log.Write("could not start events stream: " + ex.Message);
                SetDisconnected("hc could not be started");
                ScheduleRetry();
            }
        }

        private void ReadLoop(Process p, int myGen)
        {
            try
            {
                JavaScriptSerializer js = new JavaScriptSerializer();
                js.MaxJsonLength = int.MaxValue;
                string line;
                while ((line = p.StandardOutput.ReadLine()) != null)
                {
                    _lastLineTick = Environment.TickCount;
                    if (line.Length < 4) continue;
                    if (line.Length < 200 && line.IndexOf("heartbeat", StringComparison.Ordinal) >= 0) continue;
                    Dictionary<string, object> d;
                    try { d = js.Deserialize<Dictionary<string, object>>(line); }
                    catch { continue; }
                    if (d == null) continue;
                    _ui.BeginInvoke(DispatcherPriority.Background, new Action(delegate { Apply(d, myGen); }));
                }
            }
            catch { }
            try { _ui.BeginInvoke(DispatcherPriority.Background, new Action(delegate { StreamEnded(myGen); })); }
            catch { }
        }

        private void StreamEnded(int myGen)
        {
            if (myGen != _gen || _stopping) return;
            Log.Write("events stream ended");
            _failCount++;
            if (!CoreRunning() || _failCount >= 3) SetDisconnected("events stream ended");
            ScheduleRetry();
        }

        private void ScheduleRetry()
        {
            if (_stopping) return;
            // Slow on purpose: 5 s for the first couple of tries, then every 15 s.
            _retryTimer.Stop();
            _retryTimer.Interval = TimeSpan.FromSeconds(_failCount <= 2 && _connected ? 5 : 15);
            _retryTimer.Start();
        }

        private void SetDisconnected(string why)
        {
            if (_connected || !_saidDown) Log.Write("Herdr not running (" + why + "); checking again every 15 s");
            _saidDown = true;
            _connected = false;
            _terms.Clear();
            _layout = null;
            _pendingGets.Clear();
            Raise();
        }

        private void Apply(Dictionary<string, object> d, int myGen)
        {
            if (myGen != _gen || _stopping) return;

            IList snapshot = J.List(d, "terminals");
            if (snapshot != null)
            {
                _terms.Clear();
                foreach (object o in snapshot)
                {
                    Dictionary<string, object> t = o as Dictionary<string, object>;
                    if (t == null) continue;
                    string a = J.Str(t, "address");
                    if (a == null) continue;
                    if (J.Str(t, "state") == "live") _terms[a] = t;
                }
                if (!_connected) Log.Write("connected: " + _terms.Count + " live terminals");
                _connected = true;
                _saidDown = false;
                _failCount = 0;
                RequestLayout();
                Raise();
                return;
            }

            if (J.Str(d, "method") != "event") return;
            Dictionary<string, object> p = J.Dict(d, "params");
            if (p == null) return;
            string addr = J.Str(p, "terminal");
            string type = J.Str(p, "type");
            Dictionary<string, object> data = J.Dict(p, "data");
            if (addr == null) { ReconcileSoon(); return; }

            Dictionary<string, object> term;
            if (_terms.TryGetValue(addr, out term) && type == "status" && data != null)
            {
                string before = StateOf(term);
                foreach (KeyValuePair<string, object> kv in data) term[kv.Key] = kv.Value;
                string after = StateOf(term);
                // A real change of state: fetch the full record once (turn count, question text, title).
                if (before != after) QueueGet(addr);
                Raise();
            }
            else
            {
                // Anything else (new terminal, labels, title, finished...): ask for the full record.
                QueueGet(addr);
            }
        }

        // ------------------------------------------------------------------ one-shot commands

        private static Task<CmdResult> RunAsync(string exe, string args, int timeoutMs)
        {
            return Task.Factory.StartNew<CmdResult>(delegate
            {
                CmdResult r = new CmdResult();
                if (Program.Opt.Fixture) return r; // test only: never start a program
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo(exe, args);
                    psi.UseShellExecute = false;
                    psi.CreateNoWindow = true;
                    psi.RedirectStandardOutput = true;
                    psi.RedirectStandardError = true;
                    psi.RedirectStandardInput = true;
                    psi.StandardOutputEncoding = Encoding.UTF8;
                    using (Process p = Process.Start(psi))
                    {
                        r.Started = true;
                        Native.AddToKillOnCloseJob(p.Handle);
                        try { p.StandardInput.Close(); } catch { }
                        Task<string> outT = p.StandardOutput.ReadToEndAsync();
                        Task<string> errT = p.StandardError.ReadToEndAsync();
                        if (!p.WaitForExit(timeoutMs))
                        {
                            r.TimedOut = true;
                            try { p.Kill(); } catch { }
                            return r;
                        }
                        p.WaitForExit();
                        r.Exit = p.ExitCode;
                        r.Out = outT.Result ?? "";
                        try { errT.Wait(1000); } catch { }
                    }
                }
                catch { }
                return r;
            }, CancellationToken.None, TaskCreationOptions.None, TaskScheduler.Default);
        }

        private void OnUi(Task<CmdResult> task, Action<CmdResult> then)
        {
            int myGen = _gen;
            task.ContinueWith(delegate(Task<CmdResult> t)
            {
                CmdResult r = t.Status == TaskStatus.RanToCompletion ? t.Result : new CmdResult();
                try
                {
                    _ui.BeginInvoke(DispatcherPriority.Background, new Action(delegate
                    {
                        if (myGen != _gen || _stopping) return;
                        then(r);
                    }));
                }
                catch { }
            });
        }

        private static Dictionary<string, object> Parse(string json)
        {
            try
            {
                JavaScriptSerializer js = new JavaScriptSerializer();
                js.MaxJsonLength = int.MaxValue;
                return js.Deserialize<Dictionary<string, object>>(json);
            }
            catch { return null; }
        }

        private void QueueGet(string addr)
        {
            if (Program.Opt.Fixture) return;
            if (!AddrOk(addr)) return;
            _pendingGets.Add(addr);
            _getTimer.Stop();
            _getTimer.Start();
        }

        private void FlushGets()
        {
            if (!_connected) { _pendingGets.Clear(); return; }
            List<string> addrs = new List<string>(_pendingGets);
            _pendingGets.Clear();
            foreach (string a in addrs)
            {
                string addr = a;
                OnUi(RunAsync(_hc, "get " + addr + " --json", 5000), delegate(CmdResult r)
                {
                    Dictionary<string, object> d = r.Ok ? Parse(r.Out) : null;
                    if (d == null) { ReconcileSoon(); return; }
                    Dictionary<string, object> old;
                    bool had = _terms.TryGetValue(addr, out old);
                    if (J.Str(d, "state") == "live")
                    {
                        bool moved = !had || PlaceOf(old) != PlaceOf(d);
                        _terms[addr] = d;
                        if (moved) RequestLayout();
                        Raise();
                    }
                    else if (had)
                    {
                        _terms.Remove(addr);
                        RequestLayout();
                        Raise();
                    }
                });
            }
        }

        private static string PlaceOf(Dictionary<string, object> t)
        {
            Dictionary<string, object> labels = J.Dict(t, "labels");
            return J.Str(labels, "herdr.space") + "|" + J.Str(labels, "herdr.tab") + "|" + J.Str(labels, "where");
        }

        private void ReconcileSoon()
        {
            if (!_soonTimer.IsEnabled) _soonTimer.Start();
        }

        private void OnReconcileTick()
        {
            if (_stopping || !_connected) return;
            Process p = _stream;
            bool dead = true;
            try { dead = p == null || p.HasExited; } catch { }
            if (dead) return; // the retry timer owns this case
            int silentMs = unchecked(Environment.TickCount - _lastLineTick);
            if (silentMs > 120000)
            {
                Log.Write("events stream silent for " + (silentMs / 1000) + " s, restarting it");
                StartStream();
                return;
            }
            Reconcile();
            _reconcileTicks++;
            if (_reconcileTicks % 5 == 0) RequestLayout();
        }

        /// <summary>Cross-check against "hc ls": the stream is trusted, but not blindly.</summary>
        private void Reconcile()
        {
            if (Program.Opt.Fixture) return;
            if (!_connected) return;
            OnUi(RunAsync(_hc, "ls --json", 5000), delegate(CmdResult r)
            {
                Dictionary<string, object> d = r.Ok ? Parse(r.Out) : null;
                IList list = J.List(d, "terminals");
                if (list == null) return;
                HashSet<string> live = new HashSet<string>(StringComparer.Ordinal);
                foreach (object o in list)
                {
                    Dictionary<string, object> t = o as Dictionary<string, object>;
                    string a = J.Str(t, "address");
                    if (a == null || J.Str(t, "state") != "live") continue;
                    live.Add(a);
                    Dictionary<string, object> mine;
                    if (!_terms.TryGetValue(a, out mine)) { QueueGet(a); continue; }
                    string theirs = J.Str(t, "status") ?? "";
                    if (theirs != (StateOf(mine) ?? "") || J.Int(t, "turn", -1) != J.Int(mine, "turn", -1))
                    {
                        Log.Write("cross-check: " + a + " differs (hc ls says '" + theirs + "'), refreshing it");
                        QueueGet(a);
                    }
                }
                bool removed = false;
                foreach (string a in new List<string>(_terms.Keys))
                    if (!live.Contains(a)) { _terms.Remove(a); removed = true; }
                if (removed) { RequestLayout(); Raise(); }
                RefreshUnseenDone();
            });
        }

        /// <summary>
        /// A green dot turns back to idle when Herdr marks the agent as seen. In case that label
        /// change is not announced on the stream, re-read the (few) green ones: on the 60 s
        /// cross-check and whenever the list opens.
        /// </summary>
        public void RefreshUnseenDone()
        {
            if (!_connected || !_settings.GreenUntilSeen) return;
            foreach (KeyValuePair<string, Dictionary<string, object>> kv in _terms)
            {
                if (StateOf(kv.Value) != "done") continue;
                int seen = J.Int(J.Dict(kv.Value, "labels"), "herdr.seen", -1);
                if (seen >= 0 && seen >= J.Int(kv.Value, "turn", 0)) continue;
                QueueGet(kv.Key);
            }
        }

        // ------------------------------------------------------------------ order of spaces and tabs

        public void RequestLayout()
        {
            if (_stopping) return;
            _layoutTimer.Stop();
            _layoutTimer.Start();
        }

        /// <summary>Called when the list opens: refresh the order if what we have is older than 5 s.</summary>
        public void RequestLayoutIfStale()
        {
            if ((DateTime.UtcNow - _lastLayoutUtc).TotalSeconds > 5) RequestLayout();
        }

        private void RunLayout()
        {
            if (Program.Opt.Fixture) return;
            if (!_connected || _layoutRunning) return;
            _lastLayoutUtc = DateTime.UtcNow;
            // Only ask the window when it is open; "herdr-app ls" is never used to open it.
            if (!ProcessExists("herdr-app"))
            {
                if (_layout != null) { _layout = null; Raise(); }
                return;
            }
            _layoutRunning = true;
            OnUi(RunAsync(_app, "ls", 5000), delegate(CmdResult r)
            {
                _layoutRunning = false;
                List<AppSpace> parsed = r.Ok ? ParseLayout(r.Out) : null;
                _layout = parsed;
                Raise();
            });
        }

        private static List<AppSpace> ParseLayout(string json)
        {
            Dictionary<string, object> d = Parse(json);
            IList spaces = J.List(d, "spaces");
            if (spaces == null) return null;
            List<AppSpace> result = new List<AppSpace>();
            foreach (object so in spaces)
            {
                Dictionary<string, object> s = so as Dictionary<string, object>;
                if (s == null) continue;
                AppSpace sp = new AppSpace();
                sp.Id = J.Str(s, "id");
                sp.Name = J.Str(s, "name");
                IList tabs = J.List(s, "tabs");
                if (tabs != null)
                    foreach (object to in tabs)
                    {
                        Dictionary<string, object> t = to as Dictionary<string, object>;
                        if (t == null) continue;
                        AppTab tab = new AppTab();
                        tab.Id = J.Str(t, "id");
                        tab.Name = J.Str(t, "name");
                        IList terms = J.List(t, "terminals");
                        if (terms != null)
                            foreach (object xo in terms)
                            {
                                Dictionary<string, object> x = xo as Dictionary<string, object>;
                                string a = J.Str(x, "terminal");
                                if (a != null) tab.Terminals.Add(a);
                            }
                        sp.Tabs.Add(tab);
                    }
                result.Add(sp);
            }
            return result;
        }

        // ------------------------------------------------------------------ what to show

        private static string StateOf(Dictionary<string, object> t)
        {
            Dictionary<string, object> st = J.Dict(t, "status");
            if (st == null) return null;
            return J.Str(st, "state") ?? J.Str(st, "kind");
        }

        public List<SpaceVM> BuildSpaces()
        {
            List<SpaceVM> result = new List<SpaceVM>();
            HashSet<string> placed = new HashSet<string>(StringComparer.Ordinal);
            int maxIndex = 0;

            if (_layout != null)
            {
                int idx = 0;
                foreach (AppSpace sp in _layout)
                {
                    idx++;
                    SpaceVM vm = new SpaceVM();
                    vm.Index = idx;
                    vm.Id = sp.Id;
                    vm.Name = sp.Name;
                    foreach (AppTab tab in sp.Tabs)
                        foreach (string addr in tab.Terminals)
                        {
                            Dictionary<string, object> t;
                            if (!_terms.TryGetValue(addr, out t) || placed.Contains(addr)) continue;
                            vm.Rows.Add(MakeRow(addr, t, tab.Name));
                            placed.Add(addr);
                            if (string.IsNullOrEmpty(vm.Name)) vm.Name = WherePart(t, 0);
                        }
                    if (vm.Rows.Count > 0) { result.Add(vm); maxIndex = idx; }
                }
            }

            // Whatever the window did not list (or everything, when the window is closed):
            // group by the space each terminal is labeled with, oldest first.
            List<KeyValuePair<string, Dictionary<string, object>>> rest = new List<KeyValuePair<string, Dictionary<string, object>>>();
            foreach (KeyValuePair<string, Dictionary<string, object>> kv in _terms)
            {
                if (placed.Contains(kv.Key)) continue;
                if (kv.Value.ContainsKey("parent") && kv.Value["parent"] != null) continue; // helpers of an agent have no tab
                rest.Add(kv);
            }
            rest.Sort(delegate(KeyValuePair<string, Dictionary<string, object>> a, KeyValuePair<string, Dictionary<string, object>> b)
            {
                int c = J.Long(a.Value, "created_ms", 0).CompareTo(J.Long(b.Value, "created_ms", 0));
                return c != 0 ? c : string.CompareOrdinal(a.Key, b.Key);
            });
            foreach (KeyValuePair<string, Dictionary<string, object>> kv in rest)
            {
                Dictionary<string, object> labels = J.Dict(kv.Value, "labels");
                string spaceName = WherePart(kv.Value, 0);
                string key = J.Str(labels, "herdr.space") ?? spaceName ?? "other";
                SpaceVM vm = null;
                foreach (SpaceVM s in result) if (s.Id == key) { vm = s; break; }
                if (vm == null)
                {
                    vm = new SpaceVM();
                    vm.Index = ++maxIndex;
                    vm.Id = key;
                    vm.Name = spaceName ?? "Other";
                    result.Add(vm);
                }
                vm.Rows.Add(MakeRow(kv.Key, kv.Value, WherePart(kv.Value, 1)));
            }

            foreach (SpaceVM vm in result)
            {
                if (string.IsNullOrEmpty(vm.Name)) vm.Name = "Space " + vm.Index;
                vm.Short = ShortName(vm.Name);
                vm.Waiting = 0;
                vm.ShellOnly = true;
                foreach (Row r in vm.Rows)
                {
                    if (r.Kind == Kind.Waiting) vm.Waiting++;
                    if (r.Kind != Kind.Shell) vm.ShellOnly = false;
                }
            }
            return result;
        }

        private static string WherePart(Dictionary<string, object> t, int part)
        {
            string where = J.Str(J.Dict(t, "labels"), "where");
            if (string.IsNullOrEmpty(where)) return null;
            int i = where.IndexOf(" / ", StringComparison.Ordinal);
            if (i < 0) return part == 0 ? where.Trim() : null;
            string s = part == 0 ? where.Substring(0, i) : where.Substring(i + 3);
            s = s.Trim();
            return s.Length == 0 ? null : s;
        }

        private string ShortName(string name)
        {
            string custom;
            if (_settings.ShortNames.TryGetValue(name, out custom) && !string.IsNullOrEmpty(custom)) return custom;
            // The words of the name: runs of letters and digits.
            List<string> w = new List<string>();
            StringBuilder word = new StringBuilder();
            foreach (char c in name)
            {
                if (AsciiAlnum(c)) { word.Append(c); continue; }
                if (word.Length > 0) { w.Add(word.ToString()); word.Length = 0; }
            }
            if (word.Length > 0) w.Add(word.ToString());
            if (w.Count == 0) return name.Length > 4 ? name.Substring(0, 4) : name;
            string first = w[0];
            if (w.Count == 1 || (first.Length >= 2 && first.Length <= 4))
                return (first.Length > 4 ? first.Substring(0, 4) : first).ToUpperInvariant();
            StringBuilder sb = new StringBuilder();
            foreach (string x in w) { if (sb.Length < 4) sb.Append(char.ToUpperInvariant(x[0])); }
            return sb.ToString();
        }

        private Row MakeRow(string addr, Dictionary<string, object> t, string tabLabel)
        {
            Row r = new Row();
            r.Addr = addr;
            Dictionary<string, object> status = J.Dict(t, "status");
            Dictionary<string, object> labels = J.Dict(t, "labels");
            Dictionary<string, object> fg = J.Dict(t, "foreground");
            string state = StateOf(t);
            string app = J.Str(status, "app");
            r.RawState = state;
            r.Turn = J.Int(t, "turn", 0);
            r.Seen = J.Int(labels, "herdr.seen", -1);

            if (status == null) { r.Kind = Kind.Shell; r.Word = "Shell"; }
            else if (state == "blocked") { r.Kind = Kind.Waiting; r.Word = "Waiting"; }
            else if (state == "working") { r.Kind = Kind.Working; r.Word = "Working"; }
            else if (state == "done")
            {
                // Herdr itself drops a finished agent back to idle once you have looked at it
                // (its herdr.seen label catches up with the turn count). Same here by default.
                bool seen = _settings.GreenUntilSeen && r.Seen >= 0 && r.Seen >= r.Turn;
                if (seen) { r.Kind = Kind.Idle; r.Word = "Idle"; }
                else { r.Kind = Kind.Done; r.Word = "Done"; }
            }
            else { r.Kind = Kind.Idle; r.Word = "Idle"; }

            string program = J.Str(fg, "name");
            if (string.IsNullOrEmpty(program))
            {
                IList argv = J.List(t, "argv");
                if (argv != null && argv.Count > 0 && argv[0] != null) program = argv[0].ToString();
            }
            string programPretty = PrettyProgram(app ?? program);

            string title = (J.Str(t, "title") ?? "").Trim();
            bool titleIsProgram = title.Length == 0
                || Same(title, app) || Same(title, program) || Same(title, StripExe(program))
                || Same(title, programPretty) || Same(title, PrettyProgram(program)) || Same(title, "claude");
            string tab = (tabLabel ?? "").Trim();
            bool tabIsNumber = true; // empty, or digits only
            foreach (char c in tab) if (c < '0' || c > '9') { tabIsNumber = false; break; }

            if (!titleIsProgram) r.Name = title;
            else if (!tabIsNumber) r.Name = tab;
            else r.Name = programPretty ?? (tab.Length > 0 ? tab : addr);

            string where = J.Str(labels, "where");
            string place = (string.IsNullOrEmpty(where) ? "" : where + "  ") + "(" + addr + ")";
            string msg = J.Str(status, "msg") ?? J.Str(status, "message") ?? J.Str(status, "text");
            r.Clickable = r.Kind != Kind.Shell;

            if (SimulatedWaiting.Contains(addr))
            {
                r.Kind = Kind.Waiting;
                r.Word = "Waiting";
                msg = "Simulated for testing: this is where the agent's question to you would appear.";
            }
            if (r.Kind == Kind.Waiting && !string.IsNullOrEmpty(msg))
            {
                // Every run of spaces, tabs and line breaks becomes one space.
                StringBuilder flat = new StringBuilder(msg.Length);
                bool gap = false;
                foreach (char c in msg)
                {
                    if (char.IsWhiteSpace(c)) { gap = true; continue; }
                    if (gap && flat.Length > 0) flat.Append(' ');
                    gap = false;
                    flat.Append(c);
                }
                msg = flat.ToString();
                if (msg.Length > 280) msg = msg.Substring(0, 277) + "...";
                r.Tip = msg + "\n" + place;
            }
            else r.Tip = place;
            return r;
        }

        private static bool Same(string a, string b)
        {
            if (a == null || b == null) return false;
            return string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);
        }

        private static string StripExe(string p)
        {
            if (string.IsNullOrEmpty(p)) return p;
            string f = p;
            int i = f.LastIndexOfAny(new char[] { '\\', '/' });
            if (i >= 0) f = f.Substring(i + 1);
            if (f.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) f = f.Substring(0, f.Length - 4);
            return f;
        }

        private static string PrettyProgram(string p)
        {
            string f = StripExe(p);
            if (string.IsNullOrEmpty(f)) return null;
            string low = f.ToLowerInvariant();
            if (low == "claude-code" || low == "claude") return "Claude Code";
            if (low == "powershell" || low == "pwsh") return "PowerShell";
            if (low == "cmd") return "Command Prompt";
            return f;
        }

        // ------------------------------------------------------------------ jump to an agent

        public string FocusCommandLine(string addr)
        {
            return "\"" + _app + "\" do agent.focus --terminal " + addr;
        }

        public void Focus(string addr)
        {
            if (!AddrOk(addr)) return;
            if (Program.Opt.DryRun || Program.Opt.Fixture)
            {
                Log.Write("DRY-RUN jump: would run  " + FocusCommandLine(addr) + "  and then bring the Herdr window forward (nothing was run)");
                return;
            }
            Log.Write("jump: " + FocusCommandLine(addr));
            bool windowOpen = BringHerdrForward();
            string app = _app;
            Task.Factory.StartNew(delegate
            {
                try
                {
                    if (!windowOpen)
                    {
                        // The window is closed: open it, give it a moment, then point it at the agent.
                        ProcessStartInfo open = new ProcessStartInfo(app);
                        open.UseShellExecute = false;
                        using (Process.Start(open)) { }
                        for (int i = 0; i < 40 && FindHerdrWindow() == IntPtr.Zero; i++) Thread.Sleep(250);
                        Thread.Sleep(500);
                    }
                    CmdResult r = RunAsync(app, "do agent.focus --terminal " + addr, 8000).Result;
                    if (!r.Ok) Log.Write("jump: herdr-app returned " + r.Exit + (r.TimedOut ? " (timed out)" : "") + " " + r.Out.Trim());
                }
                catch (Exception ex) { Log.Write("jump failed: " + ex.Message); }
            }, CancellationToken.None, TaskCreationOptions.None, TaskScheduler.Default);
        }

        private static IntPtr FindHerdrWindow()
        {
            IntPtr found = IntPtr.Zero;
            try
            {
                Process[] ps = Process.GetProcessesByName("herdr-app");
                foreach (Process p in ps)
                {
                    try { if (found == IntPtr.Zero && p.MainWindowHandle != IntPtr.Zero) found = p.MainWindowHandle; }
                    catch { }
                    p.Dispose();
                }
            }
            catch { }
            return found;
        }

        private static bool BringHerdrForward()
        {
            IntPtr h = FindHerdrWindow();
            if (h == IntPtr.Zero) return false;
            try
            {
                if (Native.IsIconic(h)) Native.ShowWindow(h, Native.SW_RESTORE);
                if (!Native.SetForegroundWindow(h)) Log.Write("jump: Windows declined to bring the Herdr window forward");
            }
            catch { }
            return true;
        }

        private void Raise()
        {
            Action h = Changed;
            if (h != null) h();
        }
    }
}
