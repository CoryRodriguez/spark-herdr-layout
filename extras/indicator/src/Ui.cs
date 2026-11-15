using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Shapes;

namespace SparkIndicator
{
    /// <summary>One set of colors. The order of the values is the order of <see cref="Names"/>.</summary>
    internal sealed class Palette
    {
        public static readonly string[] Names =
        {
            "panel", "panelSolid", "edge", "text", "rowText", "muted", "dim",
            "amber", "amberHalo", "amberRing", "blue", "green", "ring", "hover"
        };

        public readonly string[] Hex;
        public readonly Brush[] Brushes;
        public readonly double ShadowOpacity;

        public Palette(double shadowOpacity, params string[] hex)
        {
            if (hex.Length != Names.Length) throw new ArgumentException("a palette needs " + Names.Length + " colors");
            ShadowOpacity = shadowOpacity;
            Hex = hex;
            Brushes = new Brush[hex.Length];
            for (int i = 0; i < hex.Length; i++) Brushes[i] = Theme.B(hex[i]);
        }
    }

    /// <summary>
    /// Colors and sizes. Three palettes: the original dark look (used while no choice has been
    /// saved), and "light" / "dark", which follow the day and night themes of the window look
    /// (background, hairline, text, dim text, and its working / waiting / done colors).
    /// The right-click menu switches between light and dark; nothing here is animated or timed.
    /// </summary>
    internal static class Theme
    {
        public static readonly FontFamily Font = new FontFamily("Segoe UI");

        // The look this program has always had. Used, unchanged, while settings.json has no "theme".
        private static readonly Palette Original = new Palette(0.5,
            "#EE16181D", "#FF16181D", "#FF3A3E48", "#FFE6E8EC", "#FFD5D8DE", "#FF9AA1AD", "#FF7D8694",
            "#FFF2A23A", "#44F2A23A", "#55F2A23A", "#FF5B9BFF", "#FF4CC47F", "#FF6D7380", "#1FFFFFFF");

        // Night theme: background #1c1d21, hairline #33353c, text #e6e8ec, muted #b6bac2, dim #8f949e;
        // working #62a0f8, waiting #eea840, done #4cc47f.
        private static readonly Palette Dark = new Palette(0.5,
            "#EE1C1D21", "#FF1C1D21", "#FF33353C", "#FFE6E8EC", "#FFD2D4D8", "#FFB6BAC2", "#FF8F949E",
            "#FFEEA840", "#44EEA840", "#55EEA840", "#FF62A0F8", "#FF4CC47F", "#FF787C85", "#1FFFFFFF");

        // Day theme: background #ffffff, hairline #e4e6ea (the outline uses the theme's stronger
        // line #c9ccd2 so the strip keeps an edge on a white window), text #1f2329;
        // working #1a6fe0, waiting #b85a00, done #1b8a4a.
        private static readonly Palette Light = new Palette(0.22,
            "#F7FFFFFF", "#FFFFFFFF", "#FFC9CCD2", "#FF1F2329", "#FF30353C", "#FF5C626B", "#FF767C86",
            "#FFB85A00", "#44B85A00", "#66B85A00", "#FF1A6FE0", "#FF1B8A4A", "#FF8A9099", "#141F2329");

        private static Palette _p = Original;
        private static string _name = null;

        /// <summary>null while no choice is saved (the original look), else "light" or "dark".</summary>
        public static string Name { get { return _name; } }

        /// <summary>True when what is on screen is a light look.</summary>
        public static bool IsLight { get { return _name == "light"; } }

        public static Palette Current { get { return _p; } }

        /// <summary>Picks the palette. Windows already on screen must then re-apply and re-draw.</summary>
        public static void Use(string name)
        {
            if (name == "light") { _name = "light"; _p = Light; }
            else if (name == "dark") { _name = "dark"; _p = Dark; }
            else { _name = null; _p = Original; }
        }

        public static Brush Panel { get { return _p.Brushes[0]; } }
        public static Brush PanelSolid { get { return _p.Brushes[1]; } }
        public static Brush Edge { get { return _p.Brushes[2]; } }
        public static Brush Text { get { return _p.Brushes[3]; } }
        public static Brush RowText { get { return _p.Brushes[4]; } }
        public static Brush Muted { get { return _p.Brushes[5]; } }
        public static Brush Dim { get { return _p.Brushes[6]; } }
        public static Brush Amber { get { return _p.Brushes[7]; } }
        public static Brush AmberHalo { get { return _p.Brushes[8]; } }
        public static Brush AmberRing { get { return _p.Brushes[9]; } }
        public static Brush Blue { get { return _p.Brushes[10]; } }
        public static Brush Green { get { return _p.Brushes[11]; } }
        public static Brush Ring { get { return _p.Brushes[12]; } }
        public static Brush Hover { get { return _p.Brushes[13]; } }
        public static readonly Brush Clear = B("#00FFFFFF");

        public static Brush B(string hex)
        {
            SolidColorBrush b = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
            b.Freeze();
            return b;
        }

        public static DropShadowEffect ShadowEffect()
        {
            DropShadowEffect fx = new DropShadowEffect();
            fx.BlurRadius = 14; fx.ShadowDepth = 4; fx.Direction = 270; fx.Color = Colors.Black; fx.Opacity = _p.ShadowOpacity;
            fx.Freeze();
            return fx;
        }

        public static Brush WordBrush(Kind k)
        {
            switch (k)
            {
                case Kind.Waiting: return Amber;
                case Kind.Working: return Blue;
                case Kind.Done: return Green;
                default: return Dim;
            }
        }

        public static FrameworkElement Dot(Kind k)
        {
            Grid g = new Grid();
            g.Width = 8; g.Height = 8;
            g.VerticalAlignment = VerticalAlignment.Center;
            g.IsHitTestVisible = false;
            if (k == Kind.Waiting)
            {
                Ellipse halo = new Ellipse();
                halo.Width = 14; halo.Height = 14;
                halo.Margin = new Thickness(-3);
                halo.Fill = AmberHalo;
                g.Children.Add(halo);
            }
            Ellipse e = new Ellipse();
            e.Width = 8; e.Height = 8;
            switch (k)
            {
                case Kind.Waiting: e.Fill = Amber; break;
                case Kind.Working: e.Fill = Blue; break;
                case Kind.Done: e.Fill = Green; break;
                case Kind.Idle: e.Stroke = Ring; e.StrokeThickness = 1.5; break;
                default: e.Stroke = Ring; e.StrokeThickness = 1.5; e.Opacity = 0.45; break;
            }
            g.Children.Add(e);
            return g;
        }

        public static TextBlock Label(string text, double size, Brush color, bool semibold)
        {
            TextBlock t = new TextBlock();
            t.Text = text;
            t.FontFamily = Font;
            t.FontSize = size;
            t.Foreground = color;
            t.FontWeight = semibold ? FontWeights.SemiBold : FontWeights.Normal;
            t.VerticalAlignment = VerticalAlignment.Center;
            return t;
        }
    }

    /// <summary>
    /// A borderless, see-through, always-on-top window that never takes keyboard focus,
    /// has no taskbar button and does not appear in Alt+Tab.
    /// </summary>
    internal class OverlayWindow : Window
    {
        public const double Pad = 16; // room around the box for its shadow, in layout units

        protected readonly Grid Root;
        protected readonly Border Shadow;
        public IntPtr Hwnd = IntPtr.Zero;
        public event Action<string> Command;
        public event Action DisplayChanged;

        public OverlayWindow(string title)
        {
            Title = title;
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            Topmost = true;
            ShowInTaskbar = false;
            ShowActivated = false;
            Focusable = false;
            ResizeMode = ResizeMode.NoResize;
            SizeToContent = SizeToContent.WidthAndHeight;
            WindowStartupLocation = WindowStartupLocation.Manual;
            Left = -32000; Top = -32000;
            UseLayoutRounding = true;
            SnapsToDevicePixels = true;
            FontFamily = Theme.Font;
            TextOptions.SetTextFormattingMode(this, TextFormattingMode.Display);

            Root = new Grid();
            Root.Margin = new Thickness(Pad);

            // The shadow lives on its own shape so the text above it stays sharp.
            Shadow = new Border();
            Shadow.Background = Theme.PanelSolid;
            Shadow.IsHitTestVisible = false;
            Shadow.Effect = Theme.ShadowEffect();
            Root.Children.Add(Shadow);

            Content = Root;
        }

        /// <summary>
        /// Re-reads the colors of everything this window made once and keeps (its frame). What a
        /// window draws on each Render picks the current colors up by itself on the next Render.
        /// </summary>
        public virtual void ApplyTheme()
        {
            Shadow.Background = Theme.PanelSolid;
            Shadow.Effect = Theme.ShadowEffect();
        }

        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            Hwnd = new WindowInteropHelper(this).Handle;
            long ex = Native.GetWindowLongPtr(Hwnd, Native.GWL_EXSTYLE).ToInt64();
            ex |= Native.WS_EX_NOACTIVATE | Native.WS_EX_TOOLWINDOW;
            ex &= ~Native.WS_EX_APPWINDOW;
            Native.SetWindowLongPtr(Hwnd, Native.GWL_EXSTYLE, new IntPtr(ex));
            HwndSource src = HwndSource.FromHwnd(Hwnd);
            if (src != null) src.AddHook(WndProc);
        }

        private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
        {
            if (msg == Native.WM_MOUSEACTIVATE)
            {
                handled = true;
                return new IntPtr(Native.MA_NOACTIVATE);
            }
            if (msg == Native.WM_COPYDATA)
            {
                try
                {
                    Native.COPYDATASTRUCT cds = (Native.COPYDATASTRUCT)System.Runtime.InteropServices.Marshal.PtrToStructure(lParam, typeof(Native.COPYDATASTRUCT));
                    if (cds.dwData == new IntPtr(0x48495344) && cds.cbData > 0 && cds.cbData < 4096)
                    {
                        byte[] bytes = new byte[cds.cbData];
                        System.Runtime.InteropServices.Marshal.Copy(cds.lpData, bytes, 0, cds.cbData);
                        string text = System.Text.Encoding.UTF8.GetString(bytes);
                        Action<string> h = Command;
                        if (h != null) Dispatcher.BeginInvoke(new Action(delegate { h(text); }));
                        handled = true;
                        return new IntPtr(1);
                    }
                }
                catch { }
            }
            if (msg == Native.WM_DISPLAYCHANGE)
            {
                Action h = DisplayChanged;
                if (h != null) Dispatcher.BeginInvoke(new Action(delegate { h(); }));
            }
            return IntPtr.Zero;
        }

        public double Scale
        {
            get
            {
                PresentationSource s = PresentationSource.FromVisual(this);
                if (s != null && s.CompositionTarget != null) return s.CompositionTarget.TransformToDevice.M11;
                return 1.0;
            }
        }

        public int PadPx { get { return (int)Math.Round(Pad * Scale); } }

        /// <summary>Size of the visible box (without the shadow room), in physical pixels.</summary>
        public void BoxSizePx(out int w, out int h)
        {
            double s = Scale;
            w = Math.Max(1, (int)Math.Round((ActualWidth - 2 * Pad) * s));
            h = Math.Max(1, (int)Math.Round((ActualHeight - 2 * Pad) * s));
        }

        /// <summary>Where the visible box is on screen, in physical pixels.</summary>
        public Native.RECT BoxRect()
        {
            Native.RECT r;
            Native.GetWindowRect(Hwnd, out r);
            int p = PadPx;
            int w, h;
            BoxSizePx(out w, out h);
            Native.RECT b = new Native.RECT();
            b.Left = r.Left + p; b.Top = r.Top + p; b.Right = b.Left + w; b.Bottom = b.Top + h;
            return b;
        }

        /// <summary>Put the visible box's top left corner at a screen pixel. Never activates.</summary>
        public void MoveBoxTo(int x, int y)
        {
            if (Hwnd == IntPtr.Zero) return;
            int p = PadPx;
            Native.SetWindowPos(Hwnd, Native.HWND_TOPMOST, x - p, y - p, 0, 0, Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
        }

        public void RaiseTopmost()
        {
            if (Hwnd == IntPtr.Zero) return;
            Native.SetWindowPos(Hwnd, Native.HWND_TOPMOST, 0, 0, 0, 0, Native.SWP_NOSIZE | Native.SWP_NOMOVE | Native.SWP_NOACTIVATE);
        }
    }

    // ---------------------------------------------------------------------------------- the pill

    internal sealed class PillWindow : OverlayWindow
    {
        private readonly Border _ring;       // steady amber outline while someone is waiting
        private readonly Border _ringFlash;  // bright outline, pulsed
        private readonly Border _pill;
        private readonly Border _fill;       // amber wash, pulsed

        private bool _alert;
        private bool _pressed;
        private bool _dragging;
        private string _downAddr;            // the agent whose dot the press started on, if any
        private readonly Dictionary<string, Border> _dotHits = new Dictionary<string, Border>();
        private Native.POINT _downPt;
        private Native.RECT _downRect;

        public event Action HoverEnter;
        public event Action HoverLeave;
        public event Action MenuRequested;
        public event Action DragStarted;
        public event Action DragEnded;
        public event Action<string> DotClicked;   // a plain click (no drag) on one agent's dot

        public bool IsDragging { get { return _dragging; } }

        public PillWindow(string title) : base(title)
        {
            _ring = new Border();
            _ring.Margin = new Thickness(-2);
            _ring.BorderThickness = new Thickness(2);
            _ring.BorderBrush = Theme.AmberRing;
            _ring.IsHitTestVisible = false;
            _ring.Visibility = Visibility.Collapsed;
            Root.Children.Add(_ring);

            _ringFlash = new Border();
            _ringFlash.Margin = new Thickness(-2);
            _ringFlash.BorderThickness = new Thickness(2);
            _ringFlash.BorderBrush = Theme.Amber;
            _ringFlash.IsHitTestVisible = false;
            _ringFlash.Opacity = 0;
            Root.Children.Add(_ringFlash);

            _pill = new Border();
            _pill.Background = Theme.Panel;
            _pill.BorderBrush = Theme.Edge;
            _pill.BorderThickness = new Thickness(1);
            _pill.Cursor = Cursors.SizeAll;
            Root.Children.Add(_pill);

            _fill = new Border();
            _fill.Background = Theme.Amber;
            _fill.IsHitTestVisible = false;
            _fill.Opacity = 0;
            Root.Children.Add(_fill);

            _pill.MouseEnter += delegate { if (!_dragging) Fire(HoverEnter); };
            _pill.MouseLeave += delegate { if (!_dragging) Fire(HoverLeave); };
            _pill.MouseRightButtonUp += delegate(object s, MouseButtonEventArgs e) { e.Handled = true; Fire(MenuRequested); };
            _pill.MouseLeftButtonDown += OnDown;
            _pill.MouseMove += OnMove;
            _pill.MouseLeftButtonUp += OnUp;
            _pill.LostMouseCapture += delegate { EndPress(); };
        }

        private static void Fire(Action a) { if (a != null) a(); }

        private void OnDown(object sender, MouseButtonEventArgs e)
        {
            Native.GetCursorPos(out _downPt);
            Native.GetWindowRect(Hwnd, out _downRect);
            _pressed = true;
            _dragging = false;
            _downAddr = AddrUnder(e.OriginalSource as DependencyObject);
            _pill.CaptureMouse();
            e.Handled = true;
        }

        private void OnMove(object sender, MouseEventArgs e)
        {
            if (!_pressed) return;
            Native.POINT p;
            Native.GetCursorPos(out p);
            int dx = p.X - _downPt.X, dy = p.Y - _downPt.Y;
            if (!_dragging && (Math.Abs(dx) > 3 || Math.Abs(dy) > 3))
            {
                _dragging = true;
                Fire(DragStarted);
            }
            if (_dragging)
                Native.SetWindowPos(Hwnd, Native.HWND_TOPMOST, _downRect.Left + dx, _downRect.Top + dy, 0, 0, Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
        }

        private void OnUp(object sender, MouseButtonEventArgs e)
        {
            if (!_pressed) return;
            e.Handled = true;
            string addr = _dragging ? null : _downAddr;   // a drag moves the window; only a still click jumps
            _downAddr = null;
            _pill.ReleaseMouseCapture(); // ends the press through LostMouseCapture
            if (addr != null)
            {
                Action<string> h = DotClicked;
                if (h != null) h(addr);
            }
        }

        private static string AddrUnder(DependencyObject o)
        {
            while (o != null)
            {
                FrameworkElement fe = o as FrameworkElement;
                if (fe != null && fe.Tag is string) return (string)fe.Tag;
                o = VisualTreeHelper.GetParent(o);
            }
            return null;
        }

        // One agent's dot. A clickable one sits in an invisible, slightly larger target (3 px more on
        // every side) so it is easy to hit; the margins cancel that out, so nothing moves on screen.
        private FrameworkElement DotFor(Row r, double left)
        {
            FrameworkElement d = Theme.Dot(r.Kind);
            if (!r.Clickable || string.IsNullOrEmpty(r.Addr))
            {
                d.Margin = new Thickness(left, 0, 0, 0);
                return d;
            }
            Border hit = new Border();
            hit.Background = Brushes.Transparent;
            hit.Padding = new Thickness(3);
            hit.Margin = new Thickness(left - 3, -3, -3, -3);
            hit.VerticalAlignment = VerticalAlignment.Center;
            hit.Cursor = Cursors.Hand;
            hit.Tag = r.Addr;
            hit.Child = d;
            // Hover: the dot swells by about half and settles back when the pointer leaves.
            ScaleTransform grow = new ScaleTransform(1, 1);
            d.RenderTransformOrigin = new Point(0.5, 0.5);
            d.RenderTransform = grow;
            hit.MouseEnter += delegate { Grow(grow, HoverScale); };
            hit.MouseLeave += delegate { Grow(grow, 1.0); };
            _dotHits[r.Addr] = hit;
            return hit;
        }

        private const double HoverScale = 1.45;

        private static void Grow(ScaleTransform st, double to)
        {
            DoubleAnimation a = new DoubleAnimation(to, TimeSpan.FromMilliseconds(140));
            CubicEase ease = new CubicEase();
            ease.EasingMode = EasingMode.EaseOut;
            a.EasingFunction = ease;
            st.BeginAnimation(ScaleTransform.ScaleXProperty, a);
            st.BeginAnimation(ScaleTransform.ScaleYProperty, a);
        }

        /// <summary>Test only: the same enter or leave a real pointer causes on that agent's dot.</summary>
        public bool SimulateDotHover(string addr, bool over)
        {
            Border hit;
            if (addr == null || !_dotHits.TryGetValue(addr, out hit)) return false;
            MouseEventArgs e = new MouseEventArgs(Mouse.PrimaryDevice, Environment.TickCount);
            e.RoutedEvent = over ? Mouse.MouseEnterEvent : Mouse.MouseLeaveEvent;
            hit.RaiseEvent(e);
            return true;
        }

        /// <summary>Test only: runs a press and release on that agent's dot through the real handlers.</summary>
        public bool SimulateDotClick(string addr)
        {
            Border hit;
            if (addr == null || !_dotHits.TryGetValue(addr, out hit)) return false;
            MouseButtonEventArgs down = new MouseButtonEventArgs(Mouse.PrimaryDevice, Environment.TickCount, MouseButton.Left);
            down.RoutedEvent = Mouse.MouseDownEvent;
            hit.RaiseEvent(down);
            MouseButtonEventArgs up = new MouseButtonEventArgs(Mouse.PrimaryDevice, Environment.TickCount, MouseButton.Left);
            up.RoutedEvent = Mouse.MouseUpEvent;
            _pill.RaiseEvent(up);
            return true;
        }

        private void EndPress()
        {
            if (!_pressed) return;
            _pressed = false;
            if (_dragging)
            {
                _dragging = false;
                Fire(DragEnded);
            }
        }

        private void SetRadius(double r)
        {
            Shadow.CornerRadius = new CornerRadius(r);
            _pill.CornerRadius = new CornerRadius(r);
            _fill.CornerRadius = new CornerRadius(r);
            _ring.CornerRadius = new CornerRadius(r + 2);
            _ringFlash.CornerRadius = new CornerRadius(r + 2);
        }

        public void SetAlert(bool on)
        {
            _alert = on;
            _ring.Visibility = on ? Visibility.Visible : Visibility.Collapsed;
            _pill.BorderBrush = on ? Theme.Amber : Theme.Edge;
        }

        public override void ApplyTheme()
        {
            base.ApplyTheme();
            _ring.BorderBrush = Theme.AmberRing;
            _ringFlash.BorderBrush = Theme.Amber;
            _pill.Background = Theme.Panel;
            _pill.BorderBrush = _alert ? Theme.Amber : Theme.Edge;
            _fill.Background = Theme.Amber;
        }

        /// <summary>Three pulses, then the animation is released so nothing keeps ticking.</summary>
        public void Flash()
        {
            Duration half = new Duration(TimeSpan.FromMilliseconds(260));
            DoubleAnimation a = new DoubleAnimation(0.0, 1.0, half);
            a.AutoReverse = true;
            a.RepeatBehavior = new RepeatBehavior(3);
            a.FillBehavior = FillBehavior.Stop;
            DoubleAnimation b = new DoubleAnimation(0.0, 0.30, half);
            b.AutoReverse = true;
            b.RepeatBehavior = new RepeatBehavior(3);
            b.FillBehavior = FillBehavior.Stop;
            _ringFlash.BeginAnimation(UIElement.OpacityProperty, a);
            _fill.BeginAnimation(UIElement.OpacityProperty, b);
        }

        /// <summary>For the test capture only: hold the flash at its brightest point.</summary>
        public void HoldFlashPeak(bool on)
        {
            _ringFlash.BeginAnimation(UIElement.OpacityProperty, null);
            _fill.BeginAnimation(UIElement.OpacityProperty, null);
            _ringFlash.Opacity = on ? 1.0 : 0.0;
            _fill.Opacity = on ? 0.30 : 0.0;
        }

        public void Render(List<SpaceVM> spaces, bool connected, string mode)
        {
            _dotHits.Clear();
            if (!connected || spaces.Count == 0)
            {
                SetRadius(13);
                _pill.Height = 26;
                _pill.Padding = new Thickness(10, 0, 10, 0);
                StackPanel sp = new StackPanel();
                sp.Orientation = Orientation.Horizontal;
                sp.VerticalAlignment = VerticalAlignment.Center;
                sp.Children.Add(Theme.Dot(Kind.Shell));
                TextBlock t = Theme.Label(connected ? "No agents" : "Herdr not running", 10.5, Theme.Muted, false);
                t.Margin = new Thickness(7, 0, 0, 1);
                sp.Children.Add(t);
                _pill.Child = sp;
                return;
            }

            if (mode == "stack")
            {
                SetRadius(9);
                _pill.Height = double.NaN;
                _pill.Padding = new Thickness(10, 6, 10, 6);
                StackPanel col = new StackPanel();
                col.Orientation = Orientation.Vertical;
                bool first = true;
                foreach (SpaceVM s in spaces)
                {
                    StackPanel line = new StackPanel();
                    line.Orientation = Orientation.Horizontal;
                    line.Height = 13;
                    if (!first) line.Margin = new Thickness(0, 5, 0, 0);
                    first = false;
                    TextBlock label = Theme.Label(s.Short, 10, Theme.Muted, true);
                    label.Width = 34;
                    line.Children.Add(label);
                    foreach (Row r in s.Rows)
                    {
                        line.Children.Add(DotFor(r, 6));
                    }
                    col.Children.Add(line);
                }
                _pill.Child = col;
                return;
            }

            SetRadius(13);
            _pill.Height = 26;
            _pill.Padding = new Thickness(10, 0, 10, 0);
            StackPanel strip = new StackPanel();
            strip.Orientation = Orientation.Horizontal;
            strip.VerticalAlignment = VerticalAlignment.Center;
            bool firstSpace = true;
            foreach (SpaceVM s in spaces)
            {
                if (!firstSpace)
                {
                    Border gap = new Border();
                    gap.Width = 1; gap.Height = 12;
                    gap.Background = Theme.Edge;
                    gap.Margin = new Thickness(10, 0, 10, 0);
                    gap.VerticalAlignment = VerticalAlignment.Center;
                    strip.Children.Add(gap);
                }
                firstSpace = false;
                TextBlock label = Theme.Label(s.Short, 10, Theme.Muted, true);
                label.Margin = new Thickness(0, 0, 0, 1);
                strip.Children.Add(label);
                foreach (Row r in s.Rows)
                {
                    strip.Children.Add(DotFor(r, 7));
                }
            }
            _pill.Child = strip;
        }
    }

    // ---------------------------------------------------------------------------------- the list

    internal sealed class ListWindow : OverlayWindow
    {
        private readonly Border _box;
        public event Action HoverEnter;
        public event Action HoverLeave;
        public event Action<string> RowClicked;

        public ListWindow(string title) : base(title)
        {
            Shadow.CornerRadius = new CornerRadius(9);
            _box = new Border();
            _box.Width = 246;
            _box.Background = Theme.Panel;
            _box.BorderBrush = Theme.Edge;
            _box.BorderThickness = new Thickness(1);
            _box.CornerRadius = new CornerRadius(9);
            _box.Padding = new Thickness(0, 7, 0, 6);
            Root.Children.Add(_box);
            _box.MouseEnter += delegate { Action h = HoverEnter; if (h != null) h(); };
            _box.MouseLeave += delegate { Action h = HoverLeave; if (h != null) h(); };
        }

        public override void ApplyTheme()
        {
            base.ApplyTheme();
            _box.Background = Theme.Panel;
            _box.BorderBrush = Theme.Edge;
        }

        public void Render(List<SpaceVM> spaces, bool connected)
        {
            StackPanel col = new StackPanel();
            col.Orientation = Orientation.Vertical;

            if (!connected || spaces.Count == 0)
            {
                TextBlock t = Theme.Label(connected ? "No agents running" : "Herdr not running. Will keep checking.", 11.5, Theme.Muted, false);
                t.Margin = new Thickness(11, 3, 11, 3);
                col.Children.Add(t);
                _box.Child = col;
                return;
            }

            foreach (SpaceVM s in spaces)
            {
                Grid head = new Grid();
                head.Margin = new Thickness(11, 5, 11, 2);
                head.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                TextBlock name = Theme.Label(s.Index.ToString("00") + " " + s.Name, 10, Theme.Muted, true);
                name.TextTrimming = TextTrimming.CharacterEllipsis;
                Grid.SetColumn(name, 0);
                head.Children.Add(name);
                string right = s.ShellOnly ? "shell only" : (s.Waiting > 0 ? s.Waiting + " waiting" : null);
                if (right != null)
                {
                    TextBlock rt = Theme.Label(right, 10, s.ShellOnly ? Theme.Muted : Theme.Amber, true);
                    rt.Margin = new Thickness(8, 0, 0, 0);
                    Grid.SetColumn(rt, 1);
                    head.Children.Add(rt);
                }
                col.Children.Add(head);
                if (s.ShellOnly) continue;

                foreach (Row r in s.Rows) col.Children.Add(MakeRow(r));
            }
            _box.Child = col;
        }

        private FrameworkElement MakeRow(Row r)
        {
            Border row = new Border();
            row.Padding = new Thickness(11, 2.5, 11, 2.5);
            row.Background = Theme.Clear;
            row.Cursor = r.Clickable ? Cursors.Hand : Cursors.Arrow;

            Grid g = new Grid();
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            FrameworkElement dot = Theme.Dot(r.Kind);
            dot.Margin = new Thickness(0, 0, 8, 0);
            Grid.SetColumn(dot, 0);
            g.Children.Add(dot);

            TextBlock name = Theme.Label(r.Name, 11.5, r.Kind == Kind.Shell ? Theme.Dim : Theme.RowText, false);
            name.TextTrimming = TextTrimming.CharacterEllipsis;
            Grid.SetColumn(name, 1);
            g.Children.Add(name);

            TextBlock word = Theme.Label(r.Word, 10, Theme.WordBrush(r.Kind), true);
            word.Margin = new Thickness(8, 0, 0, 0);
            Grid.SetColumn(word, 2);
            g.Children.Add(word);

            row.Child = g;

            if (!string.IsNullOrEmpty(r.Tip))
            {
                TextBlock tipText = new TextBlock();
                tipText.Text = r.Tip;
                tipText.TextWrapping = TextWrapping.Wrap;
                tipText.MaxWidth = 320;
                tipText.FontFamily = Theme.Font;
                tipText.FontSize = 11.5;
                tipText.Foreground = Theme.Text;
                ToolTip tip = new ToolTip();
                tip.Content = tipText;
                tip.Background = Theme.PanelSolid;
                tip.BorderBrush = r.Kind == Kind.Waiting ? Theme.Amber : Theme.Edge;
                tip.BorderThickness = new Thickness(1);
                tip.Padding = new Thickness(8, 5, 8, 6);
                // Beside the list, not over it (Windows flips it to the other side when there is no room).
                tip.Placement = System.Windows.Controls.Primitives.PlacementMode.Left;
                tip.PlacementTarget = row;
                tip.HorizontalOffset = -6;
                row.ToolTip = tip;
                ToolTipService.SetInitialShowDelay(row, 350);
                ToolTipService.SetShowDuration(row, 30000);
            }

            row.MouseEnter += delegate { row.Background = Theme.Hover; };
            row.MouseLeave += delegate { row.Background = Theme.Clear; };
            if (r.Clickable)
            {
                string addr = r.Addr;
                row.MouseLeftButtonUp += delegate(object s, MouseButtonEventArgs e)
                {
                    e.Handled = true;
                    Action<string> h = RowClicked;
                    if (h != null) h(addr);
                };
            }
            return row;
        }
    }

    // ---------------------------------------------------------------------------------- right-click menu

    internal sealed class MenuWindow : OverlayWindow
    {
        private readonly Border _box;
        public event Action HoverEnter;
        public event Action HoverLeave;
        public event Action<string> Picked;

        public MenuWindow(string title) : base(title)
        {
            Shadow.CornerRadius = new CornerRadius(8);
            _box = new Border();
            _box.MinWidth = 168;
            _box.Background = Theme.Panel;
            _box.BorderBrush = Theme.Edge;
            _box.BorderThickness = new Thickness(1);
            _box.CornerRadius = new CornerRadius(8);
            _box.Padding = new Thickness(0, 5, 0, 5);
            Root.Children.Add(_box);
            _box.MouseEnter += delegate { Action h = HoverEnter; if (h != null) h(); };
            _box.MouseLeave += delegate { Action h = HoverLeave; if (h != null) h(); };
        }

        public override void ApplyTheme()
        {
            base.ApplyTheme();
            _box.Background = Theme.Panel;
            _box.BorderBrush = Theme.Edge;
        }

        public void Render(string mode, bool startWithWindows)
        {
            StackPanel col = new StackPanel();
            col.Children.Add(Item("strip", "Show as strip", mode != "stack", false));
            col.Children.Add(Item("stack", "Show as stack", mode == "stack", false));
            col.Children.Add(Separator());
            // The check mark sits on the look that is on screen; before any choice that is the dark one.
            col.Children.Add(Item("light", "Light", Theme.IsLight, false));
            col.Children.Add(Item("dark", "Dark", !Theme.IsLight, false));
            col.Children.Add(Separator());
            col.Children.Add(Item("startup", "Start with Windows", startWithWindows, true));
            col.Children.Add(Separator());
            col.Children.Add(Item("quit", "Quit", false, false));
            _box.Child = col;
        }

        private static FrameworkElement Separator()
        {
            Border b = new Border();
            b.Height = 1;
            b.Background = Theme.Edge;
            b.Margin = new Thickness(0, 4, 0, 4);
            return b;
        }

        private FrameworkElement Item(string id, string text, bool on, bool box)
        {
            Border row = new Border();
            row.Padding = new Thickness(10, 4, 16, 5);
            row.Background = Theme.Clear;
            row.Cursor = Cursors.Hand;

            StackPanel sp = new StackPanel();
            sp.Orientation = Orientation.Horizontal;

            Grid mark = new Grid();
            mark.Width = 12; mark.Height = 12;
            mark.Margin = new Thickness(0, 1, 8, 0);
            mark.VerticalAlignment = VerticalAlignment.Center;
            if (box)
            {
                Border sq = new Border();
                sq.BorderBrush = Theme.Ring;
                sq.BorderThickness = new Thickness(1);
                sq.CornerRadius = new CornerRadius(2);
                mark.Children.Add(sq);
            }
            if (on)
            {
                Path check = new Path();
                check.Data = Geometry.Parse("M 2.5,6.2 L 5,8.7 L 9.6,3.4");
                check.Stroke = Theme.Text;
                check.StrokeThickness = 1.5;
                check.StrokeStartLineCap = PenLineCap.Round;
                check.StrokeEndLineCap = PenLineCap.Round;
                check.StrokeLineJoin = PenLineJoin.Round;
                mark.Children.Add(check);
            }
            sp.Children.Add(mark);
            sp.Children.Add(Theme.Label(text, 11.5, Theme.Text, false));
            row.Child = sp;

            row.MouseEnter += delegate { row.Background = Theme.Hover; };
            row.MouseLeave += delegate { row.Background = Theme.Clear; };
            row.MouseLeftButtonUp += delegate(object s, MouseButtonEventArgs e)
            {
                e.Handled = true;
                Action<string> h = Picked;
                if (h != null) h(id);
            };
            return row;
        }
    }
}
